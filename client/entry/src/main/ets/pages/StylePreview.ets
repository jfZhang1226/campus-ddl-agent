import router from '@ohos.router';
import { AppTheme } from '../ui/AppTheme';
import { MessageBubble } from '../ui/MessageBubble';

@Entry
@Component
struct StylePreviewPage {
  build() {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        Button('返回').id('style-preview-back').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
          .borderRadius(14).onClick(() => { router.back(); })
        Text('对话样式').fontSize(19).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink)
        Blank().layoutWeight(1)
        Text('合成预览').fontSize(11).fontColor(AppTheme.muted)
      }.width('100%').padding({ left: 20, right: 20, top: 12 })
      Scroll() {
        Column({ space: 14 }) {
          MessageBubble({ role: 'user', content: '老师通知：实验报告12月18日18点前交，PDF和源代码一起上传。' })
          MessageBubble({ content: '整理好了，截止时间和要准备的材料都在下面。还想调整的话，继续告诉我。' })
          Column({ space: 14 }) {
            Text('待确认的任务').fontSize(12).fontColor(AppTheme.primary)
            Text('实验报告').fontSize(22).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink)
            Row({ space: 12 }) {
              Text('截止').fontSize(12).fontColor(AppTheme.muted)
              Text('12月18日 · 18:00').fontSize(16).fontWeight(FontWeight.Medium).fontColor(AppTheme.primary)
            }
            Divider().color(AppTheme.border)
            Text('需要准备').fontSize(12).fontColor(AppTheme.muted)
            Text('PDF 报告  ·  源代码').fontSize(14).fontColor(AppTheme.ink)
            Text('确认并保存').fontSize(14).fontColor(AppTheme.onPrimary).width('100%').height(44)
              .textAlign(TextAlign.Center).backgroundColor(AppTheme.primary).borderRadius(14)
          }.width('100%').alignItems(HorizontalAlign.Start).padding(20).backgroundColor(AppTheme.surface)
            .borderRadius(22).border({ width: 1, color: AppTheme.border })
          MessageBubble({ role: 'user', content: '再提醒我准备演示。' })
        }.width('100%').padding({ left: 22, right: 22, top: 6, bottom: 12 })
      }.layoutWeight(1).width('100%')
      Row() {
        Text('输入通知，或继续补充…').fontSize(14).fontColor(AppTheme.muted).layoutWeight(1)
        Text('发送').fontSize(13).fontColor(AppTheme.onPrimary).padding({ left: 18, right: 18, top: 11, bottom: 11 })
          .backgroundColor(AppTheme.primary).borderRadius(13)
      }.width('92%').padding(15).backgroundColor(AppTheme.surface).borderRadius(23).border({ width: 1, color: AppTheme.border }).margin({ bottom: 15 })
    }.width('100%').height('100%').backgroundColor(AppTheme.canvas)
  }
}
