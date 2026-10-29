import { ChatClock, ChatMessage, ChatState, GatewayCall, GatewayConfig, GatewayTransport, SystemChatClock,
  TurnResult } from './ChatModels';
import { decodeTurn, errorText, validateConfig } from './GatewayProtocol';

export class ChatController {
  private state: ChatState = new ChatState();
  private config: GatewayConfig = new GatewayConfig();
  private listener: ((state: ChatState) => void) | undefined;
  private active: GatewayCall | undefined;
  private timer: number | undefined;
  private generation: number = 0;
  private nextId: number = 0;
  private retryRow: string = '';
  private retryDraft: string = '';
  private disposed: boolean = false;

  constructor(private transport: GatewayTransport, private clock: ChatClock = new SystemChatClock()) {}

  configuration(): GatewayConfig {
    return new GatewayConfig(this.config.baseUrl, this.config.token, this.config.timeoutMs);
  }

  snapshot(): ChatState {
    const copy = new ChatState();
    copy.draft = this.state.draft;
    copy.messages = this.state.messages.map((row: ChatMessage) => new ChatMessage(row.id, row.role, row.text, row.phase));
    copy.busy = this.state.busy;
    copy.configured = this.state.configured;
    copy.notice = this.state.notice;
    copy.errorCode = this.state.errorCode;
    copy.requestId = this.state.requestId;
    copy.canRetry = !copy.busy && this.retryRow.length > 0 && copy.draft === this.retryDraft;
    return copy;
  }

  subscribe(listener: (state: ChatState) => void): void {
    this.listener = listener;
    this.publish();
  }

  unsubscribe(): void {
    this.listener = undefined;
  }

  configure(config: GatewayConfig): boolean {
    if (this.disposed || this.state.busy) {
      return false;
    }
    const error = validateConfig(config);
    if (error.length > 0) {
      this.showError(error);
      return false;
    }
    this.config = new GatewayConfig(config.baseUrl.trim().replace(/\/+$/, ''), config.token, config.timeoutMs);
    this.state.configured = true;
    this.state.notice = '网关设置已应用，可发送问题。';
    this.state.errorCode = '';
    this.state.requestId = '';
    this.publish();
    return true;
  }

  setDraft(value: string): void {
    if (!this.disposed) {
      this.state.draft = value;
      this.publish();
    }
  }

  send(): void {
    if (this.disposed || this.state.busy) {
      return;
    }
    const draft = this.state.draft;
    const message = draft.trim();
    const configError = validateConfig(this.config);
    if (message.length === 0 || draft.length > 4000 || configError.length > 0) {
      this.showError(message.length === 0 ? 'EMPTY_MESSAGE' : (draft.length > 4000 ? 'MESSAGE_TOO_LONG' : configError));
      return;
    }
    let rowId = this.retryRow;
    if (rowId.length === 0 || draft !== this.retryDraft) {
      rowId = this.newId();
      this.state.messages.push(new ChatMessage(rowId, 'user', message, 'pending'));
    } else {
      this.markRow(rowId, 'pending');
    }
    this.retryRow = rowId;
    this.retryDraft = draft;
    this.state.busy = true;
    this.state.notice = '';
    this.state.errorCode = '';
    this.state.requestId = '';
    const generation = ++this.generation;
    this.publish();
    this.timer = this.clock.schedule(() => this.stop('TIMEOUT'), this.config.timeoutMs);
    try {
      const call = this.transport.start(this.config, message);
      this.active = call;
      call.result.then((response) => {
        this.finish(generation, rowId, draft, decodeTurn(response));
      }).catch((error: Error) => {
        this.finish(generation, rowId, draft, new TurnResult('', error.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK'));
      });
    } catch (_) {
      this.finish(generation, rowId, draft, new TurnResult('', 'NETWORK'));
    }
  }

  stop(reason: string = 'CANCELLED'): void {
    if (!this.state.busy) {
      return;
    }
    ++this.generation;
    this.release();
    this.state.busy = false;
    this.markRow(this.retryRow, reason === 'TIMEOUT' ? 'failed' : 'stopped');
    this.showError(reason);
  }

  dispose(): void {
    this.stop('BACKGROUND');
    this.unsubscribe();
    this.config = new GatewayConfig();
    this.state = new ChatState();
    this.disposed = true;
  }

  private finish(generation: number, rowId: string, draft: string, result: TurnResult): void {
    if (generation !== this.generation || !this.state.busy || this.disposed) {
      return;
    }
    this.release();
    this.state.busy = false;
    this.state.requestId = result.requestId;
    if (result.errorCode.length > 0) {
      this.markRow(rowId, 'failed');
      this.showError(result.errorCode, result.requestId);
      return;
    }
    this.markRow(rowId, 'done');
    this.state.messages.push(new ChatMessage(this.newId(), 'assistant', result.text));
    if (this.state.draft === draft) {
      this.state.draft = '';
    }
    this.retryRow = '';
    this.retryDraft = '';
    this.state.notice = '';
    this.state.errorCode = '';
    this.publish();
  }

  private release(): void {
    if (this.timer !== undefined) {
      this.clock.cancel(this.timer);
      this.timer = undefined;
    }
    const call = this.active;
    this.active = undefined;
    if (call !== undefined) {
      call.cancel();
    }
  }

  private markRow(id: string, phase: string): void {
    this.state.messages.forEach((row: ChatMessage) => {
      if (row.id === id) {
        row.phase = phase;
      }
    });
  }

  private showError(code: string, requestId: string = ''): void {
    this.state.errorCode = code;
    this.state.notice = errorText(code);
    this.state.requestId = requestId;
    this.publish();
  }

  private newId(): string {
    return String(++this.nextId);
  }

  private publish(): void {
    if (this.listener !== undefined && !this.disposed) {
      this.listener(this.snapshot());
    }
  }
}
