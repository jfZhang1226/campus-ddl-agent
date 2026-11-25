import { AppTheme } from '../ui/AppTheme';
import router from '@ohos.router';
@Entry
@Component
struct DebugToolsPage {
  @State notice: string = '';
  private open(page: string): void { router.pushUrl({ url: page }).catch(() => { this.notice = '暂时无法打开，请稍后重试。'; }); }
  build() {
    Column({ space: 18 }) {
      Row({ space: 14 }) {
        Button('返回').id('debug-back').fontSize(12).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(14).onClick(() => router.back())
        Text('调试工具').fontSize(22).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink)
      }.width('100%')
      Scroll() {
        Column({ space: 12 }) {
          Text('诊断与预览').fontSize(12).fontColor(AppTheme.muted).margin({ bottom: 6 })
          Button('语音链路诊断').id('debug-voice-chat').width('100%').height(44).fontSize(14).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).borderRadius(14).onClick(() => this.open('pages/VoiceChat'))
          Button('通知草案诊断').id('debug-notice-chat').width('100%').height(44).fontSize(14).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).borderRadius(14).onClick(() => this.open('pages/NoticeChat'))
          Button('语音能力探测').id('debug-speech-probe').width('100%').height(44).fontSize(14).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).borderRadius(14).onClick(() => this.open('pages/SpeechProbe'))
          Button('小助手动作预览').id('debug-mascot-preview').width('100%').height(44).fontSize(14).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).borderRadius(14).onClick(() => this.open('pages/MascotPreview'))
          Button('启动封面预览').id('debug-cover-preview').width('100%').height(44).fontSize(14).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).borderRadius(14).onClick(() => this.open('pages/CoverPreview'))
          Button('对话样式预览').id('debug-style-preview').width('100%').height(44).fontSize(14).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).borderRadius(14).onClick(() => this.open('pages/StylePreview'))
          if (this.notice.length > 0) { Text(this.notice).fontSize(12).fontColor(AppTheme.amber) }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.width('100%').layoutWeight(1).align(Alignment.Top)
    }.width('100%').height('100%').padding(22).backgroundColor(AppTheme.canvas)
  }
}
