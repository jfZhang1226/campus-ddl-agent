import router from '@ohos.router';
import { AppTheme } from '../ui/AppTheme';
import { AssistantMascot } from '../ui/AssistantMascot';

@Entry
@Component
struct MascotPreview {
  @State mode: string = 'idle';
  @State active: boolean = true;
  onPageShow(): void { this.active = true; }
  onPageHide(): void { this.active = false; }
  build() {
    Column({ space: 22 }) {
      Row({ space: 12 }) {
        Button('返回').id('mascot-preview-back').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { router.back(); })
        Text('小助手动作').fontSize(23).fontWeight(FontWeight.Bold).layoutWeight(1)
      }.width('100%')
      Text('仅预览动作，不发送消息或保存任务').fontSize(13).fontColor(AppTheme.muted)
      Blank()
      AssistantMascot({ mode: this.mode, active: this.active, size: 240, tag: 'preview' })
      Text(this.mode === 'idle' ? '眨眨眼，随时待命' : this.mode === 'wave' ? '你好呀' : this.mode === 'think' ? '想一想，怎么安排' : '拿小本子记下来')
        .id('mascot-preview-label').fontSize(18).fontColor(AppTheme.primary)
      Blank()
      Row({ space: 8 }) {
        Button('待机').id('mascot-preview-idle').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.mode = 'idle'; })
        Button('挥手').id('mascot-preview-wave').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.mode = 'wave'; })
        Button('思考').id('mascot-preview-think').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.mode = 'think'; })
        Button('记笔记').id('mascot-preview-write').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.mode = 'write'; })
      }.width('100%')
    }.width('100%').height('100%').padding(22).backgroundColor(AppTheme.canvas)
  }
}
