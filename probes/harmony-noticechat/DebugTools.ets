import { AppTheme } from '../ui/AppTheme';
import router from '@ohos.router';
@Entry
@Component
struct DebugToolsPage {
  @State notice: string = '';
  private open(page: string): void { router.pushUrl({ url: page }).catch(() => { this.notice = '无法打开诊断页面。'; }); }
  build() {
    Column({ space: 14 }) {
      Button('返回设置').id('debug-back').onClick(() => router.back())
      Text('调试工具').fontSize(23).fontWeight(FontWeight.Bold)
      Text('旧探测页面保留在这里。进入本页不会自动录音、播报或发送消息。').fontSize(14)
      Button('语音链路诊断').id('debug-voice-chat').onClick(() => this.open('pages/VoiceChat'))
      Button('通知草案诊断').id('debug-notice-chat').onClick(() => this.open('pages/NoticeChat'))
      Button('语音能力探测').id('debug-speech-probe').onClick(() => this.open('pages/SpeechProbe'))
      Button('小助手动作预览').id('debug-mascot-preview').onClick(() => this.open('pages/MascotPreview'))
      Button('启动封面预览').id('debug-cover-preview').onClick(() => this.open('pages/CoverPreview'))
      Button('对话样式预览').id('debug-style-preview').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => this.open('pages/StylePreview'))
      Text(this.notice).fontSize(13)
    }.width('100%').height('100%').padding(18).backgroundColor('#F2F6F7')
  }
}
