import router from '@ohos.router';
import { AppTheme } from '../ui/AppTheme';
import { BrandCover } from '../ui/BrandCover';

@Entry
@Component
struct CoverPreviewPage {
  build() {
    Column() {
      Row() {
        Button('返回').id('cover-preview-back').fontSize(13).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { router.back(); })
        Text('启动封面').fontSize(15).fontColor(AppTheme.muted).margin({ left: 14 })
      }.width('100%').padding({ left: 18, right: 18, top: 10 })
      BrandCover({ caption: '' }).layoutWeight(1)
    }.width('100%').height('100%').backgroundColor(AppTheme.canvas)
  }
}
