import { ChatClock, ChatMessage, GatewayCall, GatewayConfig, GatewayResponse, SystemChatClock } from '../chat/ChatModels';
import { errorText, validateConfig } from '../chat/GatewayProtocol';
import { TaskRepository } from '../data/TaskRepository';
import { LocalStore } from '../data/LocalStore';
import { CommitProposal, CommitReceipt, ProposalDraft } from '../domain/CommitModels';
import { TaskDetail, TaskQuery } from '../domain/TaskContracts';
import { SpeechSession, SpeechView } from '../speech/VoiceChatController';
import { UnavailableSpeechSession } from '../speech/UnavailableSpeechSession';
import { Notice, Task } from '../domain/StorageModels';
import { StorageFailure, storageSuccess } from '../data/storage/StorageTypes';
import { queryPlanningRange } from '../planning/PlanningQuery';
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
  speech: SpeechView = new SpeechView();
  speechEnabled: boolean = false;
  savedDetails: TaskDetail[] = [];
  detailsPending: boolean = false;
  candidates: Task[] = [];
  candidatesTruncated: boolean = false;
  selectedTask: TaskDetail | null = null;
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
  private speech: SpeechSession;
  private recording: boolean = false;
  private inputVersion: number = 0;
  private recordingVersion: number = 0;
  constructor(private session: TaskAgentSession, private transport: AgentGatewayTransport,
    private tasks: TaskRepository, private store: LocalStore, private clock: ChatClock = new SystemChatClock(),
    speech?: SpeechSession) {
    this.speech = speech === undefined ? new UnavailableSpeechSession() : speech;
    this.view.speechEnabled = speech !== undefined;
    this.speech.subscribe((state: SpeechView): void => {
      if (this.disposed) return;
      this.view.speech = Object.assign(new SpeechView(), state);
      if (this.recording && !state.busy) {
        this.recording = false;
        if (state.phase === 'ready' && this.recordingVersion === this.inputVersion) {
          this.view.input = state.text.slice(0, 4000);
          this.view.notice = '转写好了，可以编辑后发送。';
        }
      }
      this.publish();
    });
  }
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
  busy(): boolean { return this.disposed || this.view.phase !== 'idle' || this.view.speech.busy; }
  configure(config: GatewayConfig): boolean {
    if (this.busy() && this.view.phase !== 'initializing') return false;
    const code: string = validateConfig(config);
    if (code.length > 0) { this.view.configured = false; this.fail(code); return false; }
    this.config = new GatewayConfig(config.baseUrl.trim(), config.token, config.timeoutMs);
    this.view.configured = true; this.publish(); return true;
  }
  edit(text: string): void {
    if (this.disposed || this.view.phase !== 'idle') return;
    this.inputVersion++;
    this.view.input = text.slice(0, 4000);
    this.speech.edit(this.view.input);
    this.publish();
  }
  async chooseTask(id: string): Promise<void> {
    if (this.busy() || this.view.historyPending || this.view.recoveryRequired || !this.view.candidates.some(task => task.id === id)) return;
    this.view.phase = 'selecting'; this.publish();
    try {
      const result = await this.tasks.get(id);
      if (!result.success || result.data === null) throw new StorageFailure(result.errorCode || 'STORAGE_FAILED', result.message);
      const task: Task = result.data.task;
      const choice: string = '我选择任务“' + task.title + '”，课程“' + (task.course || '未知') + '”，编号 ' + task.id + '；请仅修改这个既有任务，保留原来源和材料。';
      const text: string = (this.view.input.length === 0 ? '' : this.view.input + '\n') + choice;
      if (text.length > 4000) throw new StorageFailure('MESSAGE_TOO_LONG', '输入已接近长度上限，请先整理文字再选择任务。');
      this.view.selectedTask = result.data; this.view.input = text; this.inputVersion++;
      this.view.notice = '已选好任务，告诉我想怎么改。'; this.view.errorCode = '';
    } catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  clearTaskChoice(): void {
    if (this.busy()) return;
    this.view.selectedTask = null; this.view.notice = '已取消选择。'; this.publish();
  }
  async record(): Promise<void> {
    if (this.busy() || !this.view.speechEnabled || this.view.historyPending || this.view.recoveryRequired) return;
    this.speech.edit(this.view.input);
    this.recordingVersion = this.inputVersion; this.recording = true;
    await this.speech.record();
  }
  finishRecording(): void { if (!this.disposed) this.speech.finishRecording(); }
  cancelVoice(): void {
    if (this.disposed) return;
    this.recording = false; this.speech.cancel();
  }
  async speakProposal(): Promise<void> {
    if (this.busy() || !this.view.speechEnabled || this.view.proposal === null || !this.sourceReady) return;
    const proposal = this.view.proposal;
    let text: string = '本次改动尚未保存，请核对后在屏幕确认。';
    for (const change of proposal.changes) {
      const draft = change.draft;
      text += (change.action === 'create' ? '新增' : '更新') + draft.title + '。';
      text += draft.deadlinePrecision === 'exact' ? '截止时间' + draft.dueAt + '，时区' + draft.timezone + '。' :
        draft.deadlinePrecision === 'date_only' ? '截止日期' + draft.deadlineDate + '，具体时刻未知。' : '截止待补充。';
      const materials = (proposal.checklistItems || []).filter(item => item.taskId === change.taskId);
      if (materials.length > 0) text += '新增材料：' + materials.map(item => item.label).join('、') + '。';
      if (change.action === 'update') text += '已有材料要求保留，请查看任务详情。';
    }
    if (text.length > 500) {
      text = text.slice(0, 480);
      const last: number = text.charCodeAt(text.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) text = text.slice(0, -1);
      text += '。其余内容请看屏幕。';
    }
    await this.speech.speak(text);
  }
  private async readSavedDetails(): Promise<void> {
    this.view.savedDetails = []; this.view.detailsPending = false;
    if (this.view.receipt === null) return;
    for (const task of this.view.receipt.tasks) {
      try {
        const result = await this.tasks.get(task.id);
        if (!result.success || result.data === null) { this.view.detailsPending = true; continue; }
        this.view.savedDetails.push(result.data);
      } catch (_) { this.view.detailsPending = true; }
    }
  }
  async initialize(): Promise<void> {
    if (this.disposed) return;
    this.view.phase = 'initializing'; this.publish();
    try {
      await this.session.open(); this.view.sources = await this.session.sourceDetails(); this.sourceReady = true;
      this.view.receipt = await this.session.latestReceipt();
      await this.readSavedDetails();
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
    const selection: TaskDetail | null = this.view.selectedTask === null ? null : JSON.parse(JSON.stringify(this.view.selectedTask)) as TaskDetail;
    this.retryText = message;
    this.cancelRequested = ''; this.view.phase = 'preparing'; this.view.errorCode = ''; this.view.notice = ''; this.view.toolActions = []; this.publish();
    try {
      const pending = this.session.proposal();
      if (pending !== null) { this.prior = pending; await this.session.cancelPending(); }
      await this.session.append('user', message);
      if (generation !== this.generation || this.cancelRequested.length > 0) return;
      this.view.input = ''; this.view.phase = 'running'; this.publish();
      const context: Object = Object.assign({}, await this.session.context(this.prior), {
        userSelectedTask: selection === null ? null : { taskId: selection.task.id, version: selection.task.version },
        selectionPolicy: 'userSelectedTask只来自用户屏幕选择；存在时既有任务更新必须使用这个ID和版本。多候选未选择时应追问，不猜同名任务。'
      });
      if (generation !== this.generation) return;
      this.timer = this.clock.schedule(() => { this.stop('TIMEOUT'); }, 90000);
      let ambiguousIds: string[] = [];
      let structureRepairs: number = 0;
      const executor = new AgentExecutor({ list: async (query: Object) => {
        const result = await this.tasks.list(query as TaskQuery);
        if (!result.success || result.data === null) return result;
        ambiguousIds = result.data.tasks.length > 1 ? result.data.tasks.map(task => task.id) : [];
        if (generation === this.generation) {
          this.view.candidates = result.data.tasks.slice(0, 30); this.view.candidatesTruncated = result.data.tasks.length > 30; this.publish();
        }
        return storageSuccess({ tasks: result.data.tasks.slice(0, 30), revision: result.data.revision,
          total: result.data.tasks.length, truncated: result.data.tasks.length > 30 });
      },
        get: async (id: string) => this.tasks.get(id) }, this.store, { stage: async (input: Object) => {
          const proposal = input as ProposalDraft;
          const updates = proposal.changes.filter(change => change.action === 'update');
          if (selection !== null && updates.some(change => change.taskId !== selection.task.id || change.expectedVersion !== selection.task.version)) {
            return { success: false, data: null, errorCode: 'INVALID_ARGUMENT', message: '更新对象或版本与用户屏幕选择不一致，请重新读取并由用户选择，不能改其他任务。' };
          }
          if (selection === null && updates.some(change => ambiguousIds.includes(change.taskId || ''))) {
            return { success: false, data: null, errorCode: 'INVALID_ARGUMENT', message: '本轮查询命中多个候选，请让用户用屏幕选择实际任务后继续，不能猜测更新对象。' };
          }
          return this.session.stage(input);
        } }, { read: async (dateFrom: string, dateTo: string) => {
          const result = await this.store.read();
          if (!result.success || result.data === null) return result;
          return storageSuccess(queryPlanningRange(result.data, dateFrom, dateTo));
        } });
      const loop = new AgentLoop({ turn: async (text, state, tools, results) => {
        if (generation !== this.generation || this.cancelRequested.length > 0) return agentError(this.cancelRequested || 'CANCELLED');
        try {
          const request = async (context: Object): Promise<GatewayResponse> => {
            const call = this.transport.start(this.config, encodeAgentTurn(text, context, tools, results)); this.call = call;
            const response = await call.result;
            if (this.call === call) this.call = undefined;
            return response;
          };
          let response = await request(state);
          if (generation !== this.generation || this.cancelRequested.length > 0) return agentError(this.cancelRequested || 'CANCELLED');
          let decoded = decodeAgentTurn(response);
          if (decoded.errorCode === 'INVALID_RESPONSE' && response.status >= 200 && response.status < 300 && structureRepairs < 1) {
            structureRepairs++;
            response = await request(Object.assign({}, state, { protocolRepair: {
              attempt: 1, maximum: 1,
              instruction: '上一次回包未通过客户端协议校验，尚未执行其中任何工具。请按同一用户消息和工具schema重新输出合法回答或工具请求，只修正结构，不猜缺失信息、不改变原用户目标、来源、日期或选择对象。exact必须deadlineDate=null且dueAt是带偏移时刻；date_only必须dueAt=null；unknown两者null。草案字段须完整，未知合法可空字段用真正null。不要声称保存成功。'
            } }));
            if (generation !== this.generation || this.cancelRequested.length > 0) return agentError(this.cancelRequested || 'CANCELLED');
            decoded = decodeAgentTurn(response);
          }
          return decoded;
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
        await this.session.append('assistant', '整理好了，看看下面的任务。');
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
      this.view.notice = '正在收尾，完成后就会停止。'; this.publish(); return;
    }
    const generation: number = ++this.generation;
    this.call?.cancel(); this.call = undefined; this.clock.cancel(this.timer); this.timer = -1;
    this.view.phase = 'stopping'; this.fail(reason);
    if (this.view.input.length === 0) this.view.input = this.retryText;
    try { await this.session.append('assistant', this.view.notice, 'answer', 'stopped'); }
    catch (error) { this.handle(error as Error); }
    finally { if (generation === this.generation) { this.view.phase = 'idle'; this.publish(); } }
  }
  async editDeadline(taskId: string, date: string, time: string): Promise<boolean> {
    if (this.busy() || this.view.historyPending || this.view.recoveryRequired) return false;
    this.view.phase = 'staging'; this.view.errorCode = ''; this.publish();
    try {
      await this.session.editDeadline(taskId, date, time);
      this.view.sources = await this.session.sourceDetails(); this.sourceReady = true;
      this.view.notice = '截止时间已调整，确认后保存。'; return true;
    } catch (error) { this.handle(error as Error); return false; }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async confirm(): Promise<void> {
    if (this.busy() || this.session.proposal() === null || !this.sourceReady) return;
    this.view.phase = 'saving'; this.view.errorCode = ''; this.publish();
    try {
      this.view.receipt = await this.session.confirm();
      this.view.selectedTask = null; this.view.candidates = []; this.view.candidatesTruncated = false;
      this.prior = null;
      this.view.notice = '任务已保存。';
      await this.readSavedDetails();
      try { await this.session.append('assistant', '任务已保存，可以在“任务”查看。'); }
      catch (_) { this.view.notice += ' 对话记录保存失败，请重试记录；任务不会重复提交。'; }
    } catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async recover(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'recovering'; this.publish();
    try { await this.session.recover(); this.view.sources = await this.session.sourceDetails(); this.sourceReady = true;
      this.view.receipt = await this.session.latestReceipt(); await this.readSavedDetails();
      this.view.notice = '已重新加载。'; this.view.errorCode = ''; }
    catch (error) { this.sourceReady = false; this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async cancelProposal(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'cancelling'; this.publish();
    try { await this.session.cancelPending(); this.view.notice = '这次先不保存。'; }
    catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async retryHistory(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'recovering'; this.publish();
    try { await this.session.retryHistory(); this.view.notice = '对话已保存。'; }
    catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  async fresh(): Promise<void> {
    if (this.busy()) return;
    this.view.phase = 'preparing'; this.publish();
    try { await this.session.fresh(); this.prior = null; const speechEnabled: boolean = this.view.speechEnabled;
      this.view = new TaskAgentView(); this.view.speechEnabled = speechEnabled; this.view.speech = this.speech.snapshot();
      this.view.configured = validateConfig(this.config).length === 0; this.view.phase = 'idle'; }
    catch (error) { this.handle(error as Error); }
    finally { this.view.phase = 'idle'; this.publish(); }
  }
  pause(): void { this.cancelVoice(); this.stop('BACKGROUND'); }
  dispose(): void {
    this.pause(); this.disposed = true; this.observer = undefined; this.speech.dispose();
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
