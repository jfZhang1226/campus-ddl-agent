import { SessionIndex, SessionIssue } from '../data/SessionStore';
import { StorageResult } from '../data/storage/StorageTypes';
import { Message, Session, SessionDocument } from '../domain/StorageModels';
import { ChatController } from './ChatController';
import { ChatState } from './ChatModels';

export interface HistorySource {
  list(): Promise<StorageResult<SessionIndex>>;
  get(id: string): Promise<StorageResult<SessionDocument>>;
}

export class HistoryMessageView {
  id: string = '';
  role: string = '';
  kind: string = '';
  status: string = '';
  time: string = '';
  text: string = '';
  calls: string = '';
  results: string = '';
  legacy: string = '';
}

export function historyTime(value: string): string {
  // Preserve the recorded offset instead of silently presenting another timezone.
  return value.replace('T', ' ').replace('Z', ' UTC');
}

export function historyMessage(message: Message): HistoryMessageView {
  const view: HistoryMessageView = new HistoryMessageView();
  view.id = message.id;
  view.role = message.role === 'user' ? '你' : (message.role === 'tool' ? '工具记录' :
    (message.role === 'system' ? '系统记录' : '校园助手'));
  view.kind = message.type === 'clarification' ? '追问' : (message.type === 'tool_calls' ? '工具调用' :
    (message.type === 'tool_result' ? '工具结果' : (message.type === 'legacy_tool' ? '旧版工具摘要' : '消息')));
  view.status = message.status === 'pending' || message.status === 'interrupted' ? '请求未完成，未自动重发' :
    (message.status === 'failed' ? '未获得回复' : (message.status === 'stopped' ? '已停止等待' :
      (message.status === 'completed' || message.status === 'done' ? '已完成' : message.status)));
  view.time = historyTime(message.createdAt);
  view.text = message.text === null ? '' : message.text;
  view.calls = message.calls.length === 0 ? '' : JSON.stringify(message.calls, null, 2);
  view.results = message.results.length === 0 ? '' : JSON.stringify(message.results, null, 2);
  view.legacy = (message.toolName === null ? '' : message.toolName) +
    (message.toolResultSummary === null ? '' : '\n' + message.toolResultSummary);
  return view;
}

export function historyError(code: string): string {
  if (code === 'NOT_FOUND') return '未找到这个会话，原有对话与输入已保留。';
  if (code === 'CORRUPT_DATA') return '这个会话暂时无法读取，原文件已保留。';
  if (code === 'UNSUPPORTED_SCHEMA') return '这个会话由其他版本保存，请使用支持该版本的应用读取。';
  if (code === 'RECOVERY_REQUIRED') return '这个会话需要恢复处理，原文件已保留，未自动覆盖。';
  if (code === 'VERSION_CONFLICT') return '会话已变化，请保留输入并重新读取后确认。';
  return '读取本机历史失败，请重试；原有对话与输入已保留。';
}

export class HistoryViewState {
  page: string = 'chat';
  loading: boolean = false;
  switching: boolean = false;
  listLoaded: boolean = false;
  sessions: Session[] = [];
  issues: SessionIssue[] = [];
  selectedId: string = '';
  detail: SessionDocument | null = null;
  messages: HistoryMessageView[] = [];
  error: string = '';
  notice: string = '';
  confirmation: string = '';
  confirmDraft: string = '';
  confirmSessionId: string = '';
  confirmTarget: string = '';
  confirmUnsaved: boolean = false;
  confirmToken: string = '';
}

/** Page navigation is read-only. Only explicit continuation delegates to the one chat owner. */
export class HistoryController {
  private state: HistoryViewState = new HistoryViewState();
  private listener: ((state: HistoryViewState) => void) | undefined;
  private generation: number = 0;
  private disposed: boolean = false;

  constructor(private source: HistorySource, private chat: ChatController) {}

  snapshot(): HistoryViewState { return JSON.parse(JSON.stringify(this.state)) as HistoryViewState; }
  subscribe(listener: (state: HistoryViewState) => void): void { this.listener = listener; this.publish(); }
  dispose(): void { this.disposed = true; ++this.generation; this.listener = undefined; }

  async showList(): Promise<boolean> {
    if (!this.available()) return false;
    const request: number = ++this.generation;
    this.state.page = 'list'; this.state.loading = true; this.state.error = ''; this.state.notice = '';
    this.state.detail = null; this.state.messages = []; this.state.selectedId = ''; this.publish();
    try {
      const result: StorageResult<SessionIndex> = await this.source.list();
      if (!this.current(request)) return false;
      if (!result.success || result.data === null) return this.failed(result.errorCode);
      this.state.sessions = result.data.sessions; this.state.issues = result.data.issues;
      this.state.listLoaded = true; return true;
    } catch (_) { if (this.current(request)) this.failed('STORAGE_FAILED'); return false; }
    finally { if (this.current(request)) { this.state.loading = false; this.publish(); } }
  }

  async openDetail(id: string): Promise<boolean> {
    if (!this.available() || id.length === 0) return false;
    const request: number = ++this.generation;
    this.state.page = 'detail'; this.state.loading = true; this.state.selectedId = id;
    this.state.detail = null; this.state.messages = []; this.state.error = ''; this.state.notice = ''; this.publish();
    try {
      const result: StorageResult<SessionDocument> = await this.source.get(id);
      if (!this.current(request)) return false;
      if (!result.success || result.data === null) return this.failed(result.errorCode);
      this.state.detail = result.data;
      this.state.messages = result.data.messages.map((message: Message) => historyMessage(message));
      return true;
    } catch (_) { if (this.current(request)) this.failed('STORAGE_FAILED'); return false; }
    finally { if (this.current(request)) { this.state.loading = false; this.publish(); } }
  }

  showChat(): boolean {
    if (this.disposed || this.state.switching || this.state.confirmation.length > 0) return false;
    ++this.generation; this.state.page = 'chat'; this.state.loading = false;
    this.state.error = ''; this.state.notice = ''; this.publish(); return true;
  }

  requestNew(): Promise<boolean> { return this.request('new', ''); }
  requestOpen(id: string): Promise<boolean> { return this.request('open', id); }

  private async request(action: string, id: string): Promise<boolean> {
    if (!this.available() || (action === 'open' && id.length === 0)) return false;
    const chat: ChatState = this.chat.snapshot();
    if (action === 'open' && chat.sessionId === id && chat.historyReady) return this.showChat();
    if (chat.draft.length > 0 || chat.savePending) {
      this.state.confirmation = action; this.state.confirmTarget = id;
      this.state.confirmDraft = chat.draft; this.state.confirmSessionId = chat.sessionId;
      this.state.confirmUnsaved = chat.savePending; this.state.confirmToken = chat.navigationToken;
      this.state.notice = ''; this.state.error = ''; this.publish(); return false;
    }
    return this.commit(action, id, false);
  }

  cancelConfirmation(): void {
    if (this.state.switching || this.disposed) return;
    this.clearConfirmation(); this.publish();
  }

  async confirmDiscard(): Promise<boolean> {
    if (this.disposed || this.state.confirmation.length === 0 || this.state.switching) return false;
    const chat: ChatState = this.chat.snapshot();
    const action: string = this.state.confirmation;
    const target: string = this.state.confirmTarget;
    const saveToken: string = this.state.confirmUnsaved ? this.state.confirmToken : '';
    const unchanged: boolean = chat.draft === this.state.confirmDraft && chat.sessionId === this.state.confirmSessionId &&
      chat.savePending === this.state.confirmUnsaved && chat.navigationToken === this.state.confirmToken;
    this.clearConfirmation();
    if (!unchanged) {
      this.state.notice = '当前输入、会话或保存状态已变化，请重新选择并确认。'; this.publish(); return false;
    }
    if (!this.available()) return false;
    return this.commit(action, target, true, saveToken);
  }

  private async commit(action: string, id: string, discard: boolean, saveToken: string = ''): Promise<boolean> {
    const request: number = ++this.generation;
    this.state.switching = true; this.state.error = ''; this.state.notice = ''; this.publish();
    try {
      const success: boolean = action === 'new' ? this.chat.newConversation(discard, saveToken) :
        await this.chat.openHistory(id, discard, saveToken);
      if (!this.current(request)) return false;
      if (success) {
        this.state.page = 'chat'; this.state.detail = null; this.state.messages = []; this.state.selectedId = '';
      } else {
        const code: string = this.chat.snapshot().storageErrorCode;
        this.state.error = code.length > 0 ? historyError(code) : '暂时无法切换，请保留输入后重试。';
      }
      return success;
    } catch (_) { if (this.current(request)) this.failed('STORAGE_FAILED'); return false; }
    finally { if (this.current(request)) { this.state.switching = false; this.publish(); } }
  }

  private available(): boolean {
    if (this.disposed || this.state.switching || this.state.loading || this.state.confirmation.length > 0) return false;
    const chat: ChatState = this.chat.snapshot();
    if (chat.busy || chat.historyLoading || (chat.savePending && !chat.canAbandonSave)) {
      this.state.notice = '请先结束当前请求或完成对话保存，再查看或切换会话。'; this.publish(); return false;
    }
    return true;
  }
  private failed(code: string | null): false {
    this.state.error = historyError(code === null ? 'STORAGE_FAILED' : code);
    if (this.state.page === 'list' && this.state.listLoaded) this.state.notice = '以下保留上次读取的列表。';
    return false;
  }
  private clearConfirmation(): void {
    this.state.confirmation = ''; this.state.confirmDraft = ''; this.state.confirmSessionId = ''; this.state.confirmTarget = '';
    this.state.confirmUnsaved = false; this.state.confirmToken = '';
  }
  private current(request: number): boolean { return !this.disposed && this.generation === request; }
  private publish(): void { if (!this.disposed && this.listener !== undefined) this.listener(this.snapshot()); }
}
