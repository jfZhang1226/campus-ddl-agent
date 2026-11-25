import { AppTheme } from './AppTheme';

@Component
export struct BrandCover {
  @Prop caption: string = '正在打开你的任务…';
  build() {
    Column({ space: 12 }) {
      Blank().layoutWeight(1)
      Text('校园里的事，一件件安排好').fontSize(13).fontColor(AppTheme.muted).letterSpacing(1)
      Image($r('app.media.assistant_cover_v1')).width('92%').aspectRatio(0.8)
        .constraintSize({ maxWidth: 360, maxHeight: 420 }).objectFit(ImageFit.Contain)
        .accessibilityText('绿色方块小助手拿着笔和本子').id('brand-cover-art')
      Text('课事清').fontSize(38).fontWeight(FontWeight.Bold).fontColor(AppTheme.primary).letterSpacing(6).id('brand-cover-title')
      Text('通知、截止、材料，帮你一起整理').fontSize(14).fontColor(AppTheme.muted).textAlign(TextAlign.Center)
      Blank().layoutWeight(1)
      Text(this.caption).fontSize(12).fontColor(AppTheme.muted).textAlign(TextAlign.Center).id('brand-cover-caption')
    }.width('100%').height('100%').padding({ left: 20, right: 20, top: 16, bottom: 24 }).backgroundColor(AppTheme.canvas)
  }
}
