import { AppTheme } from './AppTheme';

/** Presentation only; message content and actions remain owned by the task page. */
@Component
export struct MessageBubble {
  @StorageLink('largeSimpleMode') largeSimpleMode: boolean = false;
  @Prop role: string = 'assistant';
  @Prop content: string = '';
  @Prop phase: string = 'done';
  build() {
    Row() {
      Column({ space: 9 }) {
        if (this.role !== 'user' && !this.largeSimpleMode) {
          Row({ space: 7 }) {
            Circle().width(5).height(5).fill(AppTheme.primary)
            Text('课事清').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.primary).fontWeight(FontWeight.Medium)
          }
        }
        Text(this.content).fontSize(AppTheme.font(15, this.largeSimpleMode)).fontColor(AppTheme.ink).lineHeight(AppTheme.line(26, this.largeSimpleMode)).copyOption(CopyOptions.InApp)
        if (this.phase !== 'done') {
          Text(this.phase === 'pending' ? '正在整理…' : '这次未完成，可以重试').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.amber)
        }
      }.constraintSize({ maxWidth: this.role === 'user' ? '88%' : '100%' })
        .alignItems(HorizontalAlign.Start)
        .padding(this.role === 'user' ? { left: 17, right: 17, top: 13, bottom: 13 } : { left: 0, right: 6, top: 5, bottom: 5 })
        .backgroundColor(this.role === 'user' ? AppTheme.userMessage : Color.Transparent)
        .borderRadius(this.role === 'user' ? 20 : 0)
    }.width('100%').justifyContent(this.role === 'user' ? FlexAlign.End : FlexAlign.Start)
      .padding({ top: 5, bottom: 9 })
  }
}
