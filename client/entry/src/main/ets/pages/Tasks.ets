import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { getClientStorage } from '../data/ClientStorage';
import { TaskBoardController, TaskBoardRow, TaskBoardView } from '../tasks/TaskBoardController';
import { ChecklistItem, Notice } from '../domain/StorageModels';

@Entry
@Component
struct TasksPage {
  @State view: TaskBoardView = new TaskBoardView();
  private controller: TaskBoardController | null = null;
  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.controller = new TaskBoardController(getClientStorage(context.filesDir).tasks);
    this.controller.subscribe((view: TaskBoardView) => { this.view = view; });
    this.controller.reload();
  }
  aboutToDisappear(): void { this.controller?.dispose(); this.controller = null; }
  onBackPress(): boolean {
    if (this.view.detail !== null) { this.controller?.closeDetail(); return true; }
    return false;
  }
  private status(value: string): string {
    return value === 'todo' ? '待办' : value === 'in_progress' ? '进行中' : value === 'ready' ? '准备完成' :
      value === 'submitted' ? '用户标记已提交' : value === 'done' ? '已完成' : '已取消';
  }
  @Builder
  detail() {
    if (this.view.detail !== null) {
      Column({ space: 12 }) {
        Text(this.view.detail.task.title).id('task-board-detail-title').fontSize(22).fontWeight(FontWeight.Bold)
        Text(this.view.detailDeadline).id('task-board-detail-deadline').fontSize(15).fontColor('#176766')
        Text('课程：' + (this.view.detail.task.course || '未提供') + ' · ' + this.status(this.view.detail.task.status))
          .fontSize(13).fontColor('#617589')
        Text('提交渠道：' + (this.view.detail.task.submissionChannel || '未提供')).fontSize(13)
        Text('材料要求').fontSize(17).fontWeight(FontWeight.Medium)
        if (this.view.detail.checklistItems.length === 0) { Text('没有记录材料要求。').fontSize(13).fontColor('#617589') }
        ForEach(this.view.detail.checklistItems, (item: ChecklistItem) => {
          Text((item.state === 'prepared' ? '已准备 · ' : '待准备 · ') + item.label).fontSize(14)
        }, (item: ChecklistItem) => item.id + ':' + item.state)
        Text('准备完成与用户标记提交分开记录，不代表学校平台已收到。').fontSize(12).fontColor('#617589')
        Text('通知与变更来源').fontSize(17).fontWeight(FontWeight.Medium)
        if (this.view.detail.notices.length === 0) { Text('没有关联通知来源。').fontSize(13).fontColor('#617589') }
        ForEach(this.view.detail.notices, (notice: Notice) => {
          Column({ space: 5 }) {
            Text(notice.sourceLabel || '来源未知').fontSize(12).fontColor('#176766')
            Text(notice.rawText).fontSize(14).copyOption(CopyOptions.InApp)
            Text('发布时间：' + (notice.publishedAt || '未知') + '；导入时间：' + notice.importedAt).fontSize(10).fontColor('#617589')
          }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#FFFFFF').borderRadius(10)
        }, (notice: Notice) => notice.id)
        Text('读取版本：' + String(this.view.detail.revision)).fontSize(11).fontColor('#617589')
      }.width('100%').alignItems(HorizontalAlign.Start).padding(16)
    }
  }
  build() {
    Column({ space: 10 }) {
      Row({ space: 10 }) {
        Button('返回').id('task-board-back').fontSize(12).onClick(() => {
          if (!this.onBackPress()) router.back();
        })
        Text(this.view.detail === null ? '我的任务' : '任务详情').fontSize(23).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('刷新').id('task-board-refresh').fontSize(12).enabled(!this.view.loading).onClick(() => { this.controller?.reload(); })
      }.width('100%').padding(14)
      if (this.view.error.length > 0) { Text(this.view.error).id('task-board-error').fontSize(13).fontColor('#9A541B').padding(12) }
      if (this.view.loading) { LoadingProgress().width(30).height(30) }
      if (this.view.detail !== null) {
        Scroll() { this.detail() }.layoutWeight(1).width('100%')
      } else {
        TextInput({ text: this.view.keyword, placeholder: '按标题或课程查找' }).id('task-board-search')
          .maxLength(100).onChange((text: string) => { this.controller?.editKeyword(text); }).margin({ left: 14, right: 14 })
        Row({ space: 5 }) {
          Button('待办').id('task-board-active').fontSize(11).onClick(() => { this.controller?.setFilter('active'); })
          Button('七天内').id('task-board-week').fontSize(11).onClick(() => { this.controller?.setFilter('week'); })
          Button('待补日期').id('task-board-undated').fontSize(11).onClick(() => { this.controller?.setFilter('undated'); })
          Button('全部').id('task-board-all').fontSize(11).onClick(() => { this.controller?.setFilter('all'); })
        }.width('100%').padding({ left: 12, right: 12 })
        Text(this.view.today + ' · 北京时间 · 显示 ' + String(this.view.rows.length) + '/' + String(this.view.total) + ' 项')
          .fontSize(12).fontColor('#617589')
        Text('按截止日期查看任务；工作时段安排和系统提醒正在接入。').fontSize(11).fontColor('#617589')
        Scroll() {
          Column({ space: 10 }) {
            if (!this.view.loading && this.view.rows.length === 0) { Text('当前筛选下没有任务。').fontSize(15).fontColor('#617589').padding(22) }
            ForEach(this.view.rows, (row: TaskBoardRow) => {
              Column({ space: 7 }) {
                Text(row.section).fontSize(11).fontColor(row.section === '已逾期' ? '#A15028' : '#176766')
                Text(row.task.title).fontSize(17).fontWeight(FontWeight.Medium)
                Text(row.deadlineText).fontSize(13).fontColor('#617589')
                Text((row.task.course || '课程未提供') + ' · ' + this.status(row.task.status)).fontSize(12).fontColor('#617589')
                Button('查看详情').id('task-board-open-' + row.task.id).fontSize(12)
                  .enabled(!this.view.loading && !this.view.stale).onClick(() => { this.controller?.select(row.task.id); })
              }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor('#FFFFFF').borderRadius(12)
            }, (row: TaskBoardRow) => row.task.id + ':' + String(row.task.version) + ':' + row.section)
          }.width('100%').padding(14)
        }.layoutWeight(1).width('100%')
      }
    }.width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
