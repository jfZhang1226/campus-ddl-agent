export class GatewayConfig {
  constructor(public baseUrl: string = '', public token: string = '', public timeoutMs: number = 45000) {}
}

export class ChatMessage {
  constructor(public id: string, public role: string, public text: string, public phase: string = 'done') {}
}

export class ChatState {
  draft: string = '';
  messages: ChatMessage[] = [];
  busy: boolean = false;
  configured: boolean = false;
  notice: string = '';
  errorCode: string = '';
  requestId: string = '';
  canRetry: boolean = false;
}

export class GatewayResponse {
  constructor(public status: number, public body: string) {}
}

export class TurnResult {
  constructor(public text: string = '', public errorCode: string = '', public requestId: string = '') {}
}

export interface GatewayCall {
  result: Promise<GatewayResponse>;
  cancel(): void;
}

export interface GatewayTransport {
  start(config: GatewayConfig, message: string): GatewayCall;
}

export interface ChatClock {
  schedule(callback: () => void, milliseconds: number): number;
  cancel(id: number): void;
}

export class SystemChatClock implements ChatClock {
  schedule(callback: () => void, milliseconds: number): number {
    return setTimeout(callback, milliseconds);
  }

  cancel(id: number): void {
    clearTimeout(id);
  }
}
