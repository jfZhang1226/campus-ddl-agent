import { ChatClock, ChatMessage, GatewayCall, GatewayConfig, SystemChatClock } from '../chat/ChatModels';
import { errorText, validateConfig } from '../chat/GatewayProtocol';
import { TaskRepository } from '../data/TaskRepository';
import { LocalStore } from '../data/LocalStore';
import { CommitProposal, CommitReceipt } from '../domain/CommitModels';
import { TaskQuery } from '../domain/TaskContracts';
import { Notice } from '../domain/StorageModels';
import { StorageFailure, storageSuccess } from '../data/storage/StorageTypes';
import { AgentExecutor } from './AgentExecutor';
import { AgentLoop } from './AgentLoop';
import { ToolCall, ToolResult, normalizeResult } from './AgentTools';
import { AgentGatewayTransport, agentError, decodeAgentTurn, encodeAgentTurn } from './AgentGatewayProtocol';
import { TaskAgentSession } from './TaskAgentSession';

export class TaskAgentView {
  phase: string = 'initializing';
  input: string = '';
  messages: ChatMessage[] = [];
  notice: string = '';
  errorCode: string = '';
  configured: boolean = false;
  historyPending: boolean = false;
  recoveryRequired: boolean = false;
  proposal: CommitProposal | null = null;
  receipt: CommitReceipt | null = null;
  toolActions: string[] = [];
  sources: Notice[] = [];
}

/** One explicit user turn at a time; the model sees only read/stage capabilities. */
export class TaskAgentController {
  private view: TaskAgentView = new TaskAgentView();
  private observer: ((view: TaskAgentView) => void) | undefined;
  private config: GatewayConfig = new GatewayConfig();
  private call: GatewayCall | undefined;
  private timer: number = -1;
  private generation: number = 0;
  private disposed: boolean = false;
  private cancelRequested: string = '';
  private prior: CommitProposal | null = null;
  private retryText: string = '';
  private sourceReady: boolean = false;
  constructor(private session: TaskAgentSession, private transport: AgentGatewayTransport,
    private tasks: TaskRepository, private store: LocalStore, private clock: ChatClock = new SystemChatClock()) {}
  snapshot(): TaskAgentView { return JSON.parse(JSON.stringify(this.view)) as TaskAgentView; }
  subscribe(observer: (view: TaskAgentView) => void): void { this.observer = observer; this.publish(); }
  unsubscribe(): void { this.observer = undefined; }
  private publish(): void {
    if (this.disposed) return;
    this.view.messages = this.session.snapshot().messages;
    this.view.historyPending = this.session.historyNeedsRetry();
    this.view.recoveryRequired = this.session.locked() || (this.session.proposal() !== null && !this.sourceReady);
    this.view.proposal = this.session.proposal();
    this.observer?.(this.snapshot());
  }
  busy(): boolean { return this.disposed || this.view.phase !== 'idle'; }
  configure(config: GatewayConfig): boolean {
    if (this.busy() && this.view.phase !== 'initializing') return false;
    const code: string = validateConfig(config);
    if (code.length > 0) { this.view.configured = false; this.fail(code); return false; }
    this.config = new GatewayConfig(config.baseUrl.trim(), config.token, config.timeoutMs);
    this.view.configured = true; this.publish(); return true;
  }
  edit(text: string): void { if (!this.busy()) { this.view.input = text; this.publish(); } }
  async initialize(): Promise<void> {
    if (this.disposed) return;
    this.view.phase = 'initializing'; this.publish();
    try {
      await this.session.open(); this.view.sources = await this.session.sourceDetails(); this.sourceReady = true;
      this.view.receipt = await this.session.latestReceipt();
      const rows = this.session.snapshot().messages;
      const last = rows.length === 0 ? undefined : rows[rows.length - 1];
      if (last !== undefined && last.role === 'user' && last.phase !== 'done') this.view.input = last.text;
    } catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async send(): Promise<void> {
    if (this.busy() || this.view.historyPending || this.session.locked()) return;
    if (!this.view.configured) { this.fail('CONFIG_URL'); return; }
    const message: string = this.view.input.trim();
    if (message.length === 0 || message.length > 4000) { this.fail(message.length === 0 ? 'EMPTY_MESSAGE' : 'MESSAGE_TOO_LONG'); return; }
    const generation: number = ++this.generation;
    this.retryText = message;
    this.cancelRequested = ''; this.view.phase = 'preparing'; this.view.errorCode = ''; this.view.notice = ''; this.view.toolActions = []; this.publish();
    try {
      const pending = this.session.proposal();
      if (pending !== null) { this.prior = pending; await this.session.cancelPending(); }
      await this.session.append('user', message);
      if (generation !== this.generation || this.cancelRequested.length > 0) return;
      this.view.input = ''; this.view.phase = 'running'; this.publish();
      const context: Object = await this.session.context(this.prior);
      if (generation !== this.generation) return;
      this.timer = this.clock.schedule(() => { this.stop('TIMEOUT'); }, 90000);
      const executor = new AgentExecutor({ list: async (query: Object) => {
        const result = await this.tasks.list(query as TaskQuery);
        if (!result.success || result.data === null) return result;
        return storageSuccess({ tasks: result.data.tasks.slice(0, 30), revision: result.data.revision,
          total: result.data.tasks.length, truncated: result.data.tasks.length > 30 });
      },
        get: async (id: string) => this.tasks.get(id) }, this.store, this.session);
      const loop = new AgentLoop({ turn: async (text, state, tools, results) => {
        if (generation !== this.generation || this.cancelRequested.length > 0) return agentError(this.cancelRequested || 'CANCELLED');
        try {
          const call = this.transport.start(this.config, encodeAgentTurn(text, state, tools, results)); this.call = call;
          const response = await call.result;
          if (this.call === call) this.call = undefined;
          if (generation !== this.generation || this.cancelRequested.length > 0) return agentError(this.cancelRequested || 'CANCELLED');
          return decodeAgentTurn(response);
        } catch (error) {
          const code: string = (error as Error).message;
          return agentError(code === 'TIMEOUT' || code === 'REQUEST_TOO_LARGE' ? code : 'NETWORK');
        }
      } }, { execute: async (call: ToolCall): Promise<ToolResult> => {
        if (generation !== this.generation || this.cancelRequested.length > 0) return normalizeResult(call.id, call.action, call.params, false, null, 'CANCELLED', '本次请求已停止。');
        this.view.toolActions.push(call.action); this.view.phase = call.action === 'propose_task_changes' ? 'staging' : 'running'; this.publish();
        const result = await executor.execute(call);
        if (generation === this.generation) { this.view.phase = 'running'; this.publish(); }
        return result;
      } });
      const outcome = await loop.run(message, context);
      if (generation !== this.generation || this.disposed) return;
      await this.session.recover(); this.view.sources = await this.session.sourceDetails(); this.sourceReady = true;
      if (outcome.kind === 'proposal') {
        const actual = this.session.proposal();
        if (actual === null || actual.id !== outcome.proposalId) throw new StorageFailure('RECOVERY_REQUIRED', '方案结果不一致，请重新读取。');
        this.prior = actual;
        await this.session.append('assistant', '已整理为待确认方案，尚未保存任务。请核对下方任务、材料及原文，再点确认。');
      } else if (outcome.kind === 'answer' || outcome.kind === 'clarification') {
        await this.session.append('assistant', outcome.text, outcome.kind);
      } else {
        const code: string = outcome.kind === 'limit' ? 'AGENT_LIMIT' : outcome.errorCode;
        if (this.view.input.length === 0) this.view.input = message;
        this.fail(code); await this.session.append('assistant', this.view.notice, 'answer', 'failed');
      }
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        if (this.view.input.length === 0) this.view.input = message;
        this.handle(error as Error);
        try { await this.session.recover(); this.view.sources = await this.session.sourceDetails(); this.sourceReady = true; }
        catch (_) { this.sourceReady = false; }
      }
    } finally {
      if (generation === this.generation) { this.clock.cancel(this.timer); this.timer = -1; this.view.phase = 'idle'; this.publish(); }
    }
  }
  async stop(reason: string = 'CANCELLED'): Promise<void> {
    if (this.disposed || !['running', 'preparing', 'staging'].includes(this.view.phase)) return;
    this.cancelRequested = reason;
    if (this.view.phase === 'staging' || this.view.phase === 'preparing') {
      this.view.notice = '正在完成本地步骤，完成后停止后续模型请求。'; this.publish(); return;
    }
    const generation: number = ++this.generation;
    this.call?.cancel(); this.call = undefined; this.clock.cancel(this.timer); this.timer = -1;
    this.view.phase = 'stopping'; this.fail(reason);
    if (this.view.input.length === 0) this.view.input = this.retryText;
    try { await this.session.append('assistant', this.view.notice, 'answer', 'stopped'); }
    catch (error) { this.handle(error as Error); }
    finally { if (generation === this.generation) { this.view.phase = 'idle'; this.publish(); } }
  }
  async confirm(): Promise<void> {
    if (this.busy() || this.session.proposal() === null || !this.sourceReady) return;
    this.view.phase = 'saving'; this.view.errorCode = ''; this.publish();
    try {
      this.view.receipt = await this.session.confirm();
      this.view.notice = '已正式保存，可在下方核对实际回执；用户声明不代表学校平台已收到。';
      try { await this.session.append('assistant', '已正式保存，任务编号：' + this.view.receipt.tasks.map(task => task.id).join('、') + '。这是本机回执，不代表学校平台已收到。'); }
      catch (_) { this.view.notice += ' 对话记录保存失败，请重试记录；任务不会重复提交。'; }
    } catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async recover(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'recovering'; this.publish();
    try { await this.session.recover(); this.view.sources = await this.session.sourceDetails(); this.sourceReady = true;
      this.view.receipt = await this.session.latestReceipt(); this.view.notice = '已读取实际方案和提交回执；没有自动确认。'; this.view.errorCode = ''; }
    catch (error) { this.sourceReady = false; this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async cancelProposal(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'cancelling'; this.publish();
    try { await this.session.cancelPending(); this.view.notice = '已取消未保存方案，原对话保留。'; }
    catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async retryHistory(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'recovering'; this.publish();
    try { await this.session.retryHistory(); this.view.notice = '本机对话记录已保存，没有重发模型或提交任务。'; }
    catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async fresh(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'preparing'; this.publish();
    try { await this.session.fresh(); this.prior = null; this.view = new TaskAgentView(); this.view.configured = validateConfig(this.config).length === 0; this.view.phase = 'idle'; }
    catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  pause(): void { this.stop('BACKGROUND'); }
  dispose(): void {
    this.pause(); this.disposed = true; this.observer = undefined;
  }
  private fail(code: string): void {
    this.view.errorCode = code;
    this.view.notice = code === 'AGENT_LIMIT' ? '本轮已达查询上限，请补充信息后重试。' :
      code === 'REQUEST_TOO_LARGE' ? '本轮上下文较长，请先处理现有方案或开始新对话。' : errorText(code);
    this.publish();
  }
  private handle(error: Error): void {
    this.view.errorCode = error instanceof StorageFailure ? error.code : 'STORAGE_FAILED';
    this.view.notice = error instanceof StorageFailure ? error.message : '本机处理未完成，请重新读取实际结果；不要重复创建。'; this.publish();
  }
}
