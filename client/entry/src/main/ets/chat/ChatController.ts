import { ChatClock, ChatHistoryPort, ChatHistorySnapshot, ChatMessage, ChatState, GatewayCall, GatewayConfig,
  GatewayTransport, SystemChatClock, TurnResult } from './ChatModels';
import { decodeTurn, errorText, validateConfig } from './GatewayProtocol';
import { StorageResult } from '../data/storage/StorageTypes';

export class ChatController {
  private state: ChatState = new ChatState();
  private config: GatewayConfig = new GatewayConfig();
  private listener: ((state: ChatState) => void) | undefined;
  private active: GatewayCall | undefined;
  private timer: number | undefined;
  private generation: number = 0;
  private saveSerial: number = 0;
  private draftSerial: number = 0;
  private nextId: number = 0;
  private retryRow: string = '';
  private retryDraft: string = '';
  private waiting: boolean = false;
  private pendingAnswer: boolean = false;
  private answerDraft: string = '';
  private disposed: boolean = false;
  private loading: Promise<boolean> | null = null;

  constructor(private transport: GatewayTransport, private clock: ChatClock = new SystemChatClock(),
    private history: ChatHistoryPort | undefined = undefined) {
    this.state.historyReady = history === undefined;
  }

  configuration(): GatewayConfig {
    return new GatewayConfig(this.config.baseUrl, this.config.token, this.config.timeoutMs);
  }

  snapshot(): ChatState {
    const copy = new ChatState();
    copy.draft = this.state.draft;
    copy.messages = this.state.messages.map((row: ChatMessage) => new ChatMessage(row.id, row.role, row.text, row.phase, row.type));
    copy.busy = this.state.busy;
    copy.configured = this.state.configured;
    copy.notice = this.state.notice;
    copy.errorCode = this.state.errorCode;
    copy.requestId = this.state.requestId;
    copy.historyReady = this.state.historyReady;
    copy.historyLoading = this.state.historyLoading;
    copy.savePending = this.state.savePending;
    copy.canAbandonSave = copy.savePending && !copy.busy && !copy.historyLoading &&
      this.state.storageErrorCode.length > 0;
    copy.navigationToken = String(this.generation) + ':' + String(this.saveSerial) + ':' + String(this.draftSerial);
    copy.storageErrorCode = this.state.storageErrorCode;
    copy.storageNotice = this.state.storageNotice;
    copy.sessionId = this.state.sessionId;
    copy.sessionTitle = this.state.sessionTitle;
    copy.sessionRevision = this.state.sessionRevision;
    copy.canRetry = !copy.busy && !copy.savePending && copy.historyReady &&
      this.retryRow.length > 0 && copy.draft === this.retryDraft;
    return copy;
  }

  subscribe(listener: (state: ChatState) => void): void { this.listener = listener; this.publish(); }
  unsubscribe(): void { this.listener = undefined; }

  initializeHistory(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.state.historyReady) return Promise.resolve(true);
    if (this.loading !== null) return this.loading;
    const request: Promise<boolean> = this.readHistory('');
    this.loading = request;
    request.then(() => { if (this.loading === request) this.loading = null; });
    return request;
  }

  openHistory(id: string, discardDraft: boolean = false, discardSaveToken: string = ''): Promise<boolean> {
    if (!this.canSwitch(discardDraft, discardSaveToken) || id.length === 0) return Promise.resolve(false);
    return this.readHistory(id, discardDraft);
  }

  /** Explicit user action. An empty chat is not written until the first send. */
  newConversation(discardDraft: boolean = false, discardSaveToken: string = ''): boolean {
    if (!this.canSwitch(discardDraft, discardSaveToken)) return false;
    if (this.history !== undefined) this.history.fresh();
    this.state = new ChatState();
    this.state.configured = validateConfig(this.config).length === 0;
    this.retryRow = ''; this.retryDraft = ''; this.pendingAnswer = false; this.answerDraft = '';
    ++this.generation; ++this.saveSerial;
    this.publish();
    return true;
  }

  private canSwitch(discardDraft: boolean, discardSaveToken: string): boolean {
    if (this.disposed || this.state.busy || this.state.historyLoading) return false;
    if (this.state.savePending && (!discardDraft || !this.snapshot().canAbandonSave ||
      discardSaveToken.length === 0 || discardSaveToken !== this.snapshot().navigationToken)) return false;
    if (!discardDraft && this.state.draft.length > 0) {
      this.state.storageNotice = '输入尚未发送，请先保留输入，再确认切换会话。';
      this.publish(); return false;
    }
    return true;
  }

  private async readHistory(id: string, discardDraft: boolean = false): Promise<boolean> {
    if (this.history === undefined) return true;
    const readyBefore: boolean = this.state.historyReady;
    this.state.historyLoading = true; this.state.historyReady = false;
    const draftBefore: string = this.state.draft;
    const generation: number = ++this.generation;
    this.publish();
    try {
      const result: StorageResult<ChatHistorySnapshot> = await this.history.read(id);
      if (this.disposed || generation !== this.generation) return false;
      if (!result.success || result.data === null) {
        this.state.storageErrorCode = result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode;
        this.state.storageNotice = result.message;
        return false;
      }
      const data: ChatHistorySnapshot = result.data;
      this.state.messages = data.messages;
      this.metadata(data);
      this.state.historyReady = true; this.state.savePending = false; this.state.storageErrorCode = '';
      this.state.notice = ''; this.state.errorCode = ''; this.state.requestId = '';
      this.retryRow = ''; this.retryDraft = ''; this.pendingAnswer = false;
      // Do not erase text entered while the initial disk read was pending.
      if (this.state.draft === draftBefore && (discardDraft || draftBefore.length === 0)) {
        this.state.draft = '';
        const last: ChatMessage | undefined = data.messages[data.messages.length - 1];
        if (last !== undefined && last.role === 'user' && last.type === 'text' &&
          ['interrupted', 'failed', 'stopped'].includes(last.phase)) {
          this.retryRow = last.id; this.retryDraft = last.text; this.state.draft = last.text;
        }
      }
      this.state.storageNotice = data.warning.length > 0 ? data.warning :
        (data.sessionId.length > 0 ? '已从本机恢复对话；未完成请求不会自动重发。' : '本机尚无会话，发送后会保存对话。');
      return true;
    } catch (_) {
      if (this.disposed || generation !== this.generation) return false;
      this.state.storageErrorCode = 'STORAGE_FAILED';
      this.state.storageNotice = '读取历史失败，请保留输入后重试。';
      return false;
    } finally {
      if (!this.disposed && generation === this.generation) {
        // A failed target read must not abandon the original unsaved transcript or disable its local retry.
        if (this.state.savePending) this.state.historyReady = readyBefore;
        this.state.historyLoading = false; this.loading = null; this.publish();
      }
    }
  }

  configure(config: GatewayConfig): boolean {
    if (this.disposed || this.state.busy) return false;
    const error = validateConfig(config);
    if (error.length > 0) { this.showError(error); return false; }
    this.config = new GatewayConfig(config.baseUrl.trim().replace(/\/+$/, ''), config.token, config.timeoutMs);
    this.state.configured = true;
    this.state.notice = '网关设置已应用，可发送问题。';
    this.state.errorCode = ''; this.state.requestId = ''; this.publish();
    return true;
  }

  setDraft(value: string): void {
    if (!this.disposed) {
      if (value !== this.state.draft) ++this.draftSerial;
      this.state.draft = value; this.publish();
    }
  }

  send(): void {
    if (this.disposed || this.state.busy || !this.state.historyReady || this.state.savePending) return;
    const draft: string = this.state.draft;
    const message: string = draft.trim();
    const configError: string = validateConfig(this.config);
    if (message.length === 0 || draft.length > 4000 || configError.length > 0) {
      this.showError(message.length === 0 ? 'EMPTY_MESSAGE' : (draft.length > 4000 ? 'MESSAGE_TOO_LONG' : configError));
      return;
    }
    let rowId: string = this.retryRow;
    if (rowId.length === 0 || draft !== this.retryDraft) {
      rowId = this.newId(); this.state.messages.push(new ChatMessage(rowId, 'user', message, 'pending'));
    } else { this.markRow(rowId, 'pending'); }
    this.retryRow = rowId; this.retryDraft = draft;
    this.state.busy = true; this.waiting = true;
    this.state.notice = ''; this.state.errorCode = ''; this.state.requestId = '';
    const generation: number = ++this.generation;
    this.publish();
    if (this.history === undefined) this.startRequest(generation, rowId, draft, message);
    else this.persist().then((saved: boolean) => {
      if (generation !== this.generation || this.disposed) return;
      if (saved) this.startRequest(generation, rowId, draft, message);
      else {
        this.waiting = false; this.state.busy = false;
        this.markRow(rowId, 'interrupted');
        this.publish();
      }
    });
  }

  private startRequest(generation: number, rowId: string, draft: string, message: string): void {
    this.timer = this.clock.schedule(() => this.stop('TIMEOUT'), this.config.timeoutMs);
    try {
      const call: GatewayCall = this.transport.start(this.config, message);
      this.active = call;
      call.result.then((response) => this.finish(generation, rowId, draft, decodeTurn(response)))
        .catch((error: Error) => this.finish(generation, rowId, draft,
          new TurnResult('', error.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK')));
    } catch (_) { this.finish(generation, rowId, draft, new TurnResult('', 'NETWORK')); }
  }

  stop(reason: string = 'CANCELLED'): void {
    if (!this.waiting) return;
    this.waiting = false;
    const generation: number = ++this.generation;
    this.release();
    this.markRow(this.retryRow, reason === 'TIMEOUT' ? 'failed' : 'stopped');
    this.showError(reason); this.settle(generation);
  }

  /** Explicit retry of local persistence only; it never calls the gateway. */
  async retryHistorySave(): Promise<boolean> {
    if (this.disposed || this.state.busy || this.state.historyLoading || !this.state.savePending ||
      this.history === undefined) return false;
    const generation: number = this.generation;
    this.state.busy = true;
    const saved: boolean = await this.persist(true);
    if (this.disposed || generation !== this.generation) return false;
    this.state.busy = false;
    if (saved && this.pendingAnswer) this.completeAnswer();
    this.publish(); return saved;
  }

  dispose(): void {
    this.stop('BACKGROUND'); this.unsubscribe();
    this.config = new GatewayConfig(); this.state = new ChatState(); this.disposed = true;
    ++this.generation; ++this.saveSerial;
  }

  private finish(generation: number, rowId: string, draft: string, result: TurnResult): void {
    if (generation !== this.generation || !this.waiting || this.disposed) return;
    this.waiting = false; this.release(); this.state.requestId = result.requestId;
    if (result.errorCode.length > 0) {
      this.markRow(rowId, 'failed'); this.showError(result.errorCode, result.requestId);
      this.settle(generation); return;
    }
    this.markRow(rowId, 'done');
    this.state.messages.push(new ChatMessage(this.newId(), 'assistant', result.text, 'done', result.type));
    this.pendingAnswer = true; this.answerDraft = draft;
    this.settle(generation);
  }

  private settle(generation: number): void {
    if (this.history === undefined) {
      this.state.busy = false;
      if (this.pendingAnswer) this.completeAnswer();
      this.publish(); return;
    }
    this.persist().then((saved: boolean) => {
      if (this.disposed || generation !== this.generation) return;
      this.state.busy = false;
      if (saved && this.pendingAnswer) this.completeAnswer();
      this.publish();
    });
  }

  private completeAnswer(): void {
    if (this.state.draft === this.answerDraft) this.state.draft = '';
    this.retryRow = ''; this.retryDraft = ''; this.pendingAnswer = false;
    this.state.notice = ''; this.state.errorCode = '';
  }

  private async persist(retry: boolean = false): Promise<boolean> {
    if (this.history === undefined) return true;
    const serial: number = ++this.saveSerial;
    this.state.savePending = true; this.publish();
    try {
      const result: StorageResult<ChatHistorySnapshot> = await this.history.save(this.snapshot().messages, retry);
      if (this.disposed || serial !== this.saveSerial) return false;
      if (result.success && result.data !== null) {
        this.metadata(result.data); this.state.savePending = false; this.state.storageErrorCode = '';
        this.state.storageNotice = '对话记录已保存到本机。'; return true;
      }
      this.state.storageErrorCode = result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode;
      this.state.storageNotice = result.message;
    } catch (_) {
      this.state.storageErrorCode = 'STORAGE_FAILED';
      this.state.storageNotice = '对话记录尚未保存，请保留输入并明确重试。';
    }
    return false;
  }

  private metadata(data: ChatHistorySnapshot): void {
    this.state.sessionId = data.sessionId; this.state.sessionTitle = data.title; this.state.sessionRevision = data.revision;
  }
  private release(): void {
    if (this.timer !== undefined) { this.clock.cancel(this.timer); this.timer = undefined; }
    const call: GatewayCall | undefined = this.active;
    this.active = undefined; if (call !== undefined) call.cancel();
  }
  private markRow(id: string, phase: string): void {
    this.state.messages.forEach((row: ChatMessage) => { if (row.id === id) row.phase = phase; });
  }
  private showError(code: string, requestId: string = ''): void {
    this.state.errorCode = code; this.state.notice = errorText(code); this.state.requestId = requestId; this.publish();
  }
  private newId(): string {
    let id: string = String(++this.nextId);
    while (this.state.messages.some((row: ChatMessage) => row.id === id)) id = String(++this.nextId);
    return id;
  }
  private publish(): void { if (this.listener !== undefined && !this.disposed) this.listener(this.snapshot()); }
}
