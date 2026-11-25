import router from '@ohos.router';
@Entry
@Component
struct DebugToolsPage {
  @State notice: string = '';
  private open(page: string): void { router.pushUrl({ url: page }).catch(() => { this.notice = '无法打开检查页面。'; }); }
  build() {
    Column({ space: 14 }) {
      Button('返回设置').id('debug-back').onClick(() => router.back())
      Text('调试工具').fontSize(23).fontWeight(FontWeight.Bold)
      Text('用于排错；老师演示请从任务助手开始。不会在进入此页时自动运行检查。').fontSize(14)
      Button('通知导入检查').onClick(() => this.open('pages/NoticeImport'))
      Button('存储检查').onClick(() => this.open('pages/StorageCheck'))
      Button('任务检查').onClick(() => this.open('pages/TaskCheck'))
      Button('提交检查').onClick(() => this.open('pages/CommitCheck'))
      Button('历史检查').onClick(() => this.open('pages/HistoryCheck'))
      Button('小助手动作预览').id('debug-mascot-preview').onClick(() => this.open('pages/MascotPreview'))
      Button('启动封面预览').id('debug-cover-preview').onClick(() => this.open('pages/CoverPreview'))
      Text(this.notice).fontSize(13)
    }.width('100%').height('100%').padding(18).backgroundColor('#F2F6F7')
  }
}
