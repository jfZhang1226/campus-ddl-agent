import { ChatController } from '../chat/ChatController';
import { ChatMessage, ChatState, GatewayConfig } from '../chat/ChatModels';

// Structural port: the shared coordinator never imports a HarmonyOS Kit.
export class SpeechView {
  phase: string = 'idle';
  text: string = '';
  partial: string = '';
  message: string = '';
  errorCode: string = '';
  busy: boolean = false;
}
export interface SpeechSession {
  snapshot(): SpeechView;
  subscribe(listener: (view: SpeechView) => void): void;
  edit(text: string): void;
  record(): Promise<void>;
  finishRecording(): void;
  speak(text: string): Promise<void>;
  cancel(): void;
  dispose(): void;
}
export class VoiceChatView {
  chat: ChatState = new ChatState();
  speech: SpeechView = new SpeechView();
  notice: string = '';
  canSpeak: boolean = false;
}

/** T15 coordination only. ChatController retains the sole model request path. */
export class VoiceChatController {
  private chat: ChatController;
  private speech: SpeechSession;
  private speechView: SpeechView = new SpeechView();
  private observer: ((view: VoiceChatView) => void) | undefined;
  private recording: boolean = false;
  private disposed: boolean = false;
  private notice: string = '';

  constructor(chat: ChatController, speech: SpeechSession) {
    this.chat = chat;
    this.speech = speech;
    this.chat.subscribe((): void => this.emit());
    this.speech.subscribe((view: SpeechView): void => {
      this.speechView = Object.assign(new SpeechView(), view);
      if (this.recording && !view.busy) {
        this.recording = false;
        // Only a completed recognition can fill the composer. Cancellation invalidates first.
        if (view.phase === 'ready' && !this.disposed) {
          this.chat.setDraft(view.text);
          this.notice = '转写已放入输入框；请核对，再点发送。';
        }
      }
      this.emit();
    });
  }

  snapshot(): VoiceChatView {
    const value = new VoiceChatView();
    value.chat = this.chat.snapshot();
    value.speech = Object.assign(new SpeechView(), this.speechView);
    value.notice = this.notice;
    value.canSpeak = !value.chat.busy && !value.speech.busy &&
      value.chat.messages.some((row: ChatMessage) => row.role === 'assistant' && row.phase === 'done');
    return value;
  }
  subscribe(observer: (view: VoiceChatView) => void): void { this.observer = observer; this.emit(); }
  detach(): void { this.observer = undefined; }
  private emit(): void { if (!this.disposed && this.observer) this.observer(this.snapshot()); }
  configure(config: GatewayConfig): boolean {
    if (this.disposed || this.speechView.busy) return false;
    return this.chat.configure(config);
  }
  configuration(): GatewayConfig { return this.chat.configuration(); }
  edit(text: string): void {
    if (this.disposed) return;
    // Every edit, including editing back to the old value, advances the native session's edit counter.
    this.speech.edit(text);
    this.chat.setDraft(text.slice(0, 4000));
    this.notice = '';
    this.emit();
  }
  async record(): Promise<void> {
    if (this.disposed || this.chat.snapshot().busy || this.speechView.busy) return;
    this.speech.edit(this.chat.snapshot().draft);
    this.recording = true;
    this.notice = '';
    await this.speech.record();
  }
  finishRecording(): void { if (!this.disposed) this.speech.finishRecording(); }
  cancelVoice(): void {
    if (this.disposed) return;
    this.recording = false;
    this.speech.cancel();
  }
  send(): void {
    if (this.disposed || this.speechView.busy) return;
    this.notice = '';
    this.chat.send();
  }
  stopWaiting(): void { if (!this.disposed) this.chat.stop(); }
  async speakLastReply(): Promise<void> {
    if (this.disposed || this.chat.snapshot().busy || this.speechView.busy) return;
    const messages = this.chat.snapshot().messages;
    let reply: string = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].phase === 'done') { reply = messages[i].text; break; }
    }
    if (!reply.trim()) { this.notice = '暂无可播报的完整回复。'; this.emit(); return; }
    const prefix = '以下是文字回复，本页没有保存任务。';
    const limit = 500 - prefix.length;
    let excerpt = reply.slice(0, limit);
    const end = excerpt.charCodeAt(excerpt.length - 1);
    if (end >= 0xD800 && end <= 0xDBFF) excerpt = excerpt.slice(0, -1);
    this.notice = reply.length > limit ? '仅播报回复开头，完整内容请看文字。' : '手动播报本次文字回复。';
    await this.speech.speak(prefix + excerpt);
  }
  pause(): void {
    if (this.disposed) return;
    this.recording = false;
    this.speech.cancel();
    this.chat.stop('BACKGROUND');
  }
  dispose(): void {
    if (this.disposed) return;
    this.recording = false;
    this.observer = undefined;
    this.disposed = true;
    this.speech.dispose();
    this.chat.dispose();
  }
}
