import { AssistantFrame, AssistantMotionPlayer } from './AssistantMotion';

@Component
export struct AssistantMascot {
  @Prop @Watch('syncMode') mode: string = 'idle';
  @Prop @Watch('syncActive') active: boolean = true;
  @Prop size: number = 112;
  tag: string = 'main';
  @State private spriteMode: string = 'idle';
  @State private cell: number = 0;
  private player: AssistantMotionPlayer | null = null;
  aboutToAppear(): void {
    this.player = new AssistantMotionPlayer((frame: AssistantFrame): void => { this.spriteMode = frame.mode; this.cell = frame.cell; });
    this.player.setMode(this.mode); this.player.setActive(this.active);
  }
  aboutToDisappear(): void { this.player?.dispose(); this.player = null; }
  private syncMode(): void { this.player?.setMode(this.mode); }
  private syncActive(): void { this.player?.setActive(this.active); }
  private sprite(): Resource {
    return this.spriteMode === 'wave' ? $r('app.media.assistant_wave_sheet') : this.spriteMode === 'think' ? $r('app.media.assistant_think_sheet') :
      this.spriteMode === 'write' ? $r('app.media.assistant_write_sheet') : $r('app.media.assistant_blink_sheet');
  }
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Image(this.sprite()).width(this.size * 2).height(this.size * 2).objectFit(ImageFit.Fill)
        .position({ x: -(this.cell % 2) * this.size, y: -Math.floor(this.cell / 2) * this.size })
        .id('mascot-sprite-' + this.tag + '-' + this.spriteMode + '-' + String(this.cell))
    }.width(this.size).height(this.size).clip(true).id('assistant-mascot-' + this.tag)
      .accessibilityText('课事清小助手，点击打招呼').onClick(() => { this.player?.greet(); })
  }
}
