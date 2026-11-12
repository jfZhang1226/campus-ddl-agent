import { GatewayConfig } from '../../client/entry/src/main/ets/chat/ChatModels';
import { NoticeImportController, NoticeImportWriter } from '../../client/entry/src/main/ets/notice/NoticeImportController';
import { NoticeExtractionTransport } from '../../client/entry/src/main/ets/notice/NoticeImportProtocol';
import { SpeechSession, SpeechView } from '../../client/entry/src/main/ets/speech/VoiceChatController';

/** T19 composition: native speech edits the original notification, never confirms a task. */
export class NoticeVoiceController extends NoticeImportController {
  private speech: SpeechSession;
  private speechView: SpeechView = new SpeechView();
  private speechObserver: ((view: SpeechView) => void) | undefined;
  private recording: boolean = false;
  private released: boolean = false;
  private inputVersion: number = 0;
  private recordingVersion: number = 0;

  constructor(transport: NoticeExtractionTransport, writer: NoticeImportWriter, speech: SpeechSession) {
    super(transport, writer);
    this.speech = speech;
    speech.subscribe((view: SpeechView): void => {
      if (this.released) return;
      this.speechView = Object.assign(new SpeechView(), view);
      if (this.recording && !view.busy) {
        this.recording = false;
        if (view.phase === 'ready' && this.recordingVersion === this.inputVersion &&
          this.snapshot().phase !== 'saved') super.setRawText(view.text);
      }
      if (this.speechObserver !== undefined) this.speechObserver(this.speechSnapshot());
    });
  }

  speechSnapshot(): SpeechView { return Object.assign(new SpeechView(), this.speechView); }
  subscribeSpeech(observer: (view: SpeechView) => void): void {
    this.speechObserver = observer;
    observer(this.speechSnapshot());
  }

  private blocked(): boolean {
    const phase: string = this.snapshot().phase;
    return this.released || ['extracting', 'saving', 'refreshing', 'saved'].includes(phase);
  }

  setRawText(value: string): void {
    if (this.blocked()) return;
    this.inputVersion++;
    // Every manual edit advances the speech adapter's input generation, including editing back.
    this.speech.edit(value);
    super.setRawText(value);
  }

  async record(): Promise<void> {
    if (this.blocked() || this.speechView.busy) return;
    this.speech.edit(this.snapshot().rawText);
    this.recordingVersion = this.inputVersion;
    this.recording = true;
    await this.speech.record();
  }
  finishRecording(): void { if (!this.released) this.speech.finishRecording(); }
  cancelVoice(): void {
    if (this.released) return;
    this.recording = false;
    this.speech.cancel();
  }

  configure(config: GatewayConfig): boolean {
    return !this.released && !this.speechView.busy && super.configure(config);
  }
  extract(): void { if (!this.released && !this.speechView.busy) super.extract(); }
  async confirm(): Promise<void> {
    if (!this.released && !this.speechView.busy) await super.confirm();
  }
  async refreshRevision(): Promise<void> {
    if (!this.released && !this.speechView.busy) await super.refreshRevision();
  }

  async speakDraft(): Promise<void> {
    if (this.blocked() || this.speechView.busy) return;
    const view = this.snapshot();
    if (view.draft === null) return;
    let deadline: string = '截止时间待补充';
    if (view.deadlinePrecision === 'date_only') deadline = '截止日期' + view.deadlineDate + '，具体时刻未提供';
    if (view.deadlinePrecision === 'exact') deadline = '截止时间' + view.deadlineDate + ' ' + view.deadlineTime;
    let text: string = '这是待确认草案，尚未保存任务。' + view.title + '。' + deadline + '。';
    if (view.materials.length > 0) text += '材料要求：' + view.materials.join('、') + '。';
    text = text.slice(0, 500);
    const last: number = text.charCodeAt(text.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) text = text.slice(0, -1);
    await this.speech.speak(text);
  }

  cancel(): void {
    if (this.released || this.snapshot().phase === 'saving') return;
    this.cancelVoice();
    super.cancel();
  }
  pause(): void {
    if (this.released) return;
    this.cancelVoice();
    super.pause();
  }
  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.recording = false;
    this.speechObserver = undefined;
    this.speech.dispose();
    super.dispose();
  }
}
