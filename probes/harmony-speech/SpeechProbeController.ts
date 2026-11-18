// Platform-neutral control logic for T09 only. No model, task write or persistence.
export class ProbeView {
  phase: string = 'idle';
  text: string = '';
  partial: string = '';
  message: string = '尚未运行语音探测。';
  errorCode: string = '';
  busy: boolean = false;
}

export interface RecognitionEvents {
  started(id: string): void;
  result(id: string, text: string, final: boolean): void;
  completed(id: string): void;
  failed(id: string, code: string): void;
}
export interface PlaybackEvents {
  started(id: string): void;
  completed(id: string): void;
  stopped(id: string): void;
  failed(id: string, code: string): void;
}
export interface ProbePort {
  microphone(): Promise<boolean>;
  listen(id: string, events: RecognitionEvents): Promise<void>;
  finish(id: string): void;
  cancel(id: string): void;
  speak(id: string, text: string, events: PlaybackEvents): Promise<void>;
  stop(): void;
  release(): void;
}
export interface ProbeClock {
  schedule(action: () => void, ms: number): number;
  cancel(id: number): void;
}

export class SpeechProbeController {
  private view: ProbeView = new ProbeView();
  private sequence: number = 0;
  private id: string = '';
  private editVersion: number = 0;
  private startedEditVersion: number = 0;
  private candidate: string = '';
  private timer: number = -1;
  private disposed: boolean = false;
  private observer: ((view: ProbeView) => void) | undefined;

  constructor(private port: ProbePort, private clock: ProbeClock) {}
  snapshot(): ProbeView { return Object.assign(new ProbeView(), this.view); }
  subscribe(observer: (view: ProbeView) => void): void {
    this.observer = observer;
    this.emit();
  }
  detach(): void { this.observer = undefined; }
  private emit(): void { if (this.observer) this.observer(this.snapshot()); }
  edit(text: string): void {
    if (this.disposed) return;
    this.editVersion++;
    this.view.text = text.slice(0, 4000);
    this.emit();
  }
  private active(id: string): boolean { return !this.disposed && id === this.id && this.view.busy; }
  private clearTimer(): void { this.clock.cancel(this.timer); this.timer = -1; }
  private limit(id: string, ms: number): void {
    this.clearTimer();
    this.timer = this.clock.schedule(() => this.fail(id, 'TIMEOUT'), ms);
  }
  private finishState(phase: string, message: string): void {
    this.clearTimer(); this.id = '';
    this.view.busy = false; this.view.phase = phase; this.view.message = message;
    this.emit();
  }
  private fail(id: string, code: string): void {
    if (!this.active(id)) return;
    this.id = ''; this.clearTimer();
    this.stopNative(id);
    this.view.busy = false; this.view.phase = 'error';
    // Do not show raw native error messages, recognition text or credentials in diagnostics.
    this.view.errorCode = /^[A-Z0-9_-]{1,40}$/.test(code) ? code : 'NATIVE_ERROR';
    this.view.message = '语音步骤未完成，已有文字保留。可重试或继续文字操作。';
    this.emit();
  }
  private stopNative(id: string): boolean {
    let stopped = true;
    try { this.port.cancel(id); } catch (_) { stopped = false; }
    try { this.port.stop(); } catch (_) { stopped = false; }
    return stopped;
  }
  async record(): Promise<void> {
    if (this.disposed || this.view.busy) return;
    const id = 'asr-' + Date.now() + '-' + (++this.sequence);
    this.id = id; this.candidate = ''; this.startedEditVersion = this.editVersion;
    this.view.phase = 'permission'; this.view.busy = true; this.view.partial = '';
    this.view.errorCode = ''; this.view.message = '等待麦克风权限；不会自动发送文字。'; this.emit();
    this.limit(id, 60000);
    try {
      const allowed = await this.port.microphone();
      if (!this.active(id)) return;
      if (!allowed) { this.fail(id, 'MICROPHONE_DENIED'); return; }
      this.view.phase = 'initializing'; this.view.message = '正在创建本机识别引擎。'; this.emit();
      this.limit(id, 15000);
      await this.port.listen(id, {
        started: (eventId: string): void => {
          if (!this.active(eventId)) return;
          this.view.phase = 'recording'; this.view.message = '正在录音，可点结束录音或取消。'; this.emit();
          this.limit(id, 30000);
        },
        result: (eventId: string, text: string, final: boolean): void => {
          if (!this.active(eventId)) return;
          this.view.partial = text.slice(0, 4000);
          if (final) this.candidate = this.view.partial;
          this.emit();
        },
        completed: (eventId: string): void => {
          if (!this.active(eventId)) return;
          if (!this.candidate.trim()) { this.fail(id, 'EMPTY_RECOGNITION'); return; }
          if (this.editVersion === this.startedEditVersion) this.view.text = this.candidate;
          this.finishState('ready', this.editVersion === this.startedEditVersion
            ? '转写已显示，请核对或编辑；本探测页不发送给模型。'
            : '识别已结束；你编辑过文字，识别结果没有覆盖输入框。');
        },
        failed: (eventId: string, code: string): void => this.fail(eventId, code)
      });
    } catch (_) { this.fail(id, 'ASR_START_FAILED'); }
  }
  finishRecording(): void {
    if (this.view.phase !== 'recording') return;
    const id = this.id;
    this.view.phase = 'recognizing'; this.view.message = '录音已请求结束，等待实际识别结果。'; this.emit();
    this.limit(id, 10000);
    try { this.port.finish(id); } catch (_) { this.fail(id, 'ASR_FINISH_FAILED'); }
  }
  async speak(text: string): Promise<void> {
    if (this.disposed || this.view.busy) return;
    if (!text.trim() || text.length > 500) {
      this.view.errorCode = 'SPEECH_TEXT_INVALID'; this.view.message = '请输入 1～500 字的播报内容。'; this.emit(); return;
    }
    // Core Speech TTS requestId accepts letters/digits/Chinese, unlike ASR sessionId.
    const id = 'tts' + Date.now() + 'n' + (++this.sequence);
    this.id = id; this.view.phase = 'tts_initializing'; this.view.busy = true; this.view.errorCode = '';
    this.view.message = '正在创建本机播报引擎。'; this.emit(); this.limit(id, 15000);
    try {
      await this.port.speak(id, text, {
        started: (eventId: string): void => {
          if (!this.active(eventId)) return;
          this.view.phase = 'speaking'; this.view.message = '正在播报，可点停止播报。'; this.emit(); this.limit(id, 120000);
        },
        completed: (eventId: string): void => {
          if (this.active(eventId)) this.finishState('ready', '收到播报完成回调；实际声音需本人核对。');
        },
        stopped: (eventId: string): void => {
          if (this.active(eventId)) this.finishState('ready', '收到停止回调；实际声音是否停止需本人核对。');
        },
        failed: (eventId: string, code: string): void => this.fail(eventId, code)
      });
    } catch (_) { this.fail(id, 'TTS_START_FAILED'); }
  }
  cancel(): void {
    const oldId = this.id;
    this.id = ''; this.clearTimer(); // Invalidate before native calls can synchronously invoke a listener.
    this.candidate = ''; this.view.partial = ''; // Discard unconfirmed capture while preserving edited text.
    const stopped = this.stopNative(oldId);
    if (!this.disposed) {
      if (!stopped) this.view.errorCode = 'STOP_FAILED';
      this.finishState(stopped ? (this.view.text ? 'ready' : 'idle') : 'error', stopped
        ? '已请求停止并作废旧结果，文字保留。'
        : '停止原生资源时发生错误；请离开探测页并核对麦克风或声音状态。');
    }
  }
  dispose(): void {
    this.cancel(); this.disposed = true;
    try { this.port.release(); } finally { this.detach(); }
  }
}
