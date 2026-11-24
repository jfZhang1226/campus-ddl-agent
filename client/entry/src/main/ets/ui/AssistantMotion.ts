export class AssistantFrame {
  constructor(public mode: string, public cell: number, public delay: number) {}
}
export interface AssistantMotionClock {
  now(): number;
  schedule(callback: () => void, delay: number): number;
  cancel(id: number): void;
}
class SystemAssistantClock implements AssistantMotionClock {
  now(): number { return Date.now(); }
  schedule(callback: () => void, delay: number): number { return setTimeout(callback, delay); }
  cancel(id: number): void { clearTimeout(id); }
}
export function assistantMode(phase: string, errorCode: string = ''): string {
  if (errorCode.length > 0) return 'idle';
  if (phase === 'saving') return 'write';
  return ['initializing', 'preparing', 'running', 'staging', 'recovering', 'selecting', 'stopping'].includes(phase) ? 'think' : 'idle';
}
export function assistantFrame(mode: string, index: number): AssistantFrame {
  const safe = ['idle', 'wave', 'think', 'write'].includes(mode) ? mode : 'idle';
  const cell = Number.isSafeInteger(index) ? ((index % 4) + 4) % 4 : 0;
  const delays = safe === 'idle' ? [2800, 80, 100, 160] : safe === 'wave' ? [150, 150, 150, 150] :
    safe === 'think' ? [480, 400, 480, 400] : [150, 180, 160, 150];
  return new AssistantFrame(safe, cell, delays[cell]);
}
export function shouldFinishWriting(previousPhase: string, phase: string, errorCode: string, receiptBefore: string, receiptNow: string): boolean {
  return previousPhase === 'saving' && phase === 'idle' && errorCode.length === 0 && receiptNow.length > 0 && receiptNow !== receiptBefore;
}
/** Decorative only: owns a single bounded timer, no business, network, speech or storage ports. */
export class AssistantMotionPlayer {
  private active: boolean = false;
  private disposed: boolean = false;
  private mode: string = 'idle';
  private greetingUntil: number = 0;
  private index: number = 0;
  private timer: number = -1;
  private generation: number = 0;
  constructor(private observer: (frame: AssistantFrame) => void, private clock: AssistantMotionClock = new SystemAssistantClock()) {}
  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active; this.reset();
  }
  setMode(mode: string): void {
    if (this.disposed) return;
    const safe = assistantFrame(mode, 0).mode;
    if (safe === this.mode && this.greetingUntil === 0) return;
    this.mode = safe; this.greetingUntil = 0; this.reset();
  }
  greet(): void {
    if (this.disposed || !this.active || this.mode !== 'idle') return;
    this.greetingUntil = this.clock.now() + 1800; this.reset();
  }
  private reset(): void {
    this.generation++; this.clock.cancel(this.timer); this.timer = -1; this.index = 0;
    if (this.active && !this.disposed) this.tick(this.generation);
  }
  private tick(generation: number): void {
    if (this.disposed || !this.active || generation !== this.generation) return;
    if (this.greetingUntil > 0 && this.clock.now() >= this.greetingUntil) { this.greetingUntil = 0; this.index = 0; }
    const frame = assistantFrame(this.greetingUntil > 0 ? 'wave' : this.mode, this.index++);
    this.observer(frame);
    if (this.disposed || !this.active || generation !== this.generation) return;
    this.timer = this.clock.schedule(() => { this.tick(generation); }, frame.delay);
  }
  dispose(): void { this.disposed = true; this.active = false; this.generation++; this.clock.cancel(this.timer); this.timer = -1; }
}
