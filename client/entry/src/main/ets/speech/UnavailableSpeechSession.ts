import { SpeechSession, SpeechView } from './VoiceChatController';

/** Explicit text-only port. Native speech is supplied only by a platform owner. */
export class UnavailableSpeechSession implements SpeechSession {
  private view: SpeechView = new SpeechView();
  private observer: ((view: SpeechView) => void) | undefined;
  private disposed: boolean = false;

  snapshot(): SpeechView { return Object.assign(new SpeechView(), this.view); }
  subscribe(observer: (view: SpeechView) => void): void {
    if (this.disposed) return;
    this.observer = observer;
    this.publish();
  }
  private publish(): void {
    if (!this.disposed && this.observer !== undefined) this.observer(this.snapshot());
  }
  edit(text: string): void {
    if (this.disposed) return;
    this.view.text = text;
    this.view.errorCode = '';
    this.view.phase = 'idle';
    this.publish();
  }
  private unavailable(): void {
    if (this.disposed) return;
    this.view.phase = 'error';
    this.view.errorCode = 'UNSUPPORTED_PLATFORM';
    this.view.message = '此入口支持文字输入。';
    this.publish();
  }
  async record(): Promise<void> { this.unavailable(); }
  finishRecording(): void {}
  async speak(_text: string): Promise<void> { this.unavailable(); }
  cancel(): void {
    if (this.disposed) return;
    this.view.phase = 'idle'; this.view.errorCode = ''; this.view.message = '';
    this.publish();
  }
  dispose(): void { this.disposed = true; this.observer = undefined; }
}
