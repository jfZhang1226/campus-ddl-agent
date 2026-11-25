import { AppTheme } from './AppTheme';
import { deadlineLabel } from './DeadlineInput';
import { TaskActionsView } from '../tasks/TaskActionsController';
import { ProposedTaskChange, ProposedChecklistState } from '../domain/CommitModels';

@CustomDialog
export struct TaskChangeDialog {
  controller: CustomDialogController;
  @StorageLink('largeSimpleMode') largeSimpleMode: boolean = false;
  @Link view: TaskActionsView;
  onConfirm: () => void = (): void => {};
  onCancel: () => void = (): void => {};
  onRecover: () => void = (): void => {};
  private status(value: string): string {
    if (value === 'ready') return '准备完成';
    if (value === 'submitted') return '已标记提交';
    if (value === 'done') return '已完成';
    if (value === 'cancelled') return '已取消';
    return value === 'in_progress' ? '进行中' : '待办';
  }
  private progress(change: ProposedTaskChange): string {
    if (this.view.pending === null) return '';
    if (change.draft.status === 'cancelled') return '取消后移出待办，原有记录保留';
    const before = (this.view.pending.checklistBefore || []).filter(item => item.taskId === change.taskId);
    const added = (this.view.pending.checklistItems || []).filter(item => item.taskId === change.taskId);
    const updates = this.view.pending.checklistUpdates || [];
    const total: number = before.length + added.length;
    if (total === 0) return '';
    const prepared: number = before.filter(item => (updates.find(update => update.itemId === item.id)?.state || item.state) === 'prepared').length;
    return prepared === total ? '全部事项已完成，保存后移入已完成' : String(prepared) + '/' + String(total) + ' 项已完成，保存后保留在待办';
  }
  build() {
    Column({ space: 16 }) {
      Text('确认修改').fontSize(AppTheme.font(22, this.largeSimpleMode)).fontWeight(FontWeight.Bold).fontColor(AppTheme.ink)
      Scroll() {
        Column({ space: 12 }) {
          if (this.view.pending !== null) {
            ForEach(this.view.pending.changes, (change: ProposedTaskChange) => {
              Text(change.draft.title).fontSize(AppTheme.font(17, this.largeSimpleMode)).fontWeight(FontWeight.Medium)
              if (change.before?.status !== change.draft.status) {
                Text('状态：' + this.status(change.before?.status || 'todo') + ' → ' + this.status(change.draft.status)).fontSize(AppTheme.font(14, this.largeSimpleMode))
              }
              if (this.progress(change).length > 0) { Text(this.progress(change)).fontSize(AppTheme.font(14, this.largeSimpleMode)).fontColor(AppTheme.primary) }
              Text('截止：' + (change.before === null ? '待定' : deadlineLabel(change.before)) + ' → ' + deadlineLabel(change.draft)).fontSize(AppTheme.font(14, this.largeSimpleMode)).fontColor(AppTheme.primary)
              Text('提交到：' + (change.draft.submissionChannel || '未填写')).fontSize(AppTheme.font(13, this.largeSimpleMode))
              Text('剩余工时：' + (change.before?.remainingMinutes === null || change.before === null ? '未填写' : String(change.before.remainingMinutes) + '分钟') + ' → ' + (change.draft.remainingMinutes === null ? '未填写' : String(change.draft.remainingMinutes) + '分钟')).fontSize(AppTheme.font(13, this.largeSimpleMode))
              if (change.confirmSubmission) { Text('记录你的提交声明，学校平台的实际提交结果请自行核对。').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted) }
            }, (change: ProposedTaskChange) => change.taskId)
            if ((this.view.pending.checklistBefore || []).length > 0) {
              Text('原有事项：' + (this.view.pending.checklistBefore || []).map(item => item.label + (item.state === 'prepared' ? '（已完成）' : '（待完成）')).join('、')).fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted)
            }
            ForEach(this.view.pending.checklistUpdates || [], (item: ProposedChecklistState) => {
              Text(item.before.label + '：' + (item.before.state === 'prepared' ? '已完成' : '待完成') + ' → ' + (item.state === 'prepared' ? '已完成' : '待完成')).fontSize(AppTheme.font(14, this.largeSimpleMode))
            }, (item: ProposedChecklistState) => item.itemId)
            if ((this.view.pending.checklistItems || []).length > 0) {
              Text('新增事项：' + (this.view.pending.checklistItems || []).map(item => item.label).join('、')).fontSize(AppTheme.font(14, this.largeSimpleMode))
            }
          }
          if (this.view.errorCode.length > 0 || this.view.recoveryRequired) {
            Text(this.view.notice).fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.amber)
            Button('重新读取结果').id('task-dialog-recover').enabled(!this.view.busy).onClick(this.onRecover)
              .fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.constraintSize({ maxHeight: this.largeSimpleMode ? 390 : 330 }).width('100%').edgeEffect(EdgeEffect.None)
      Row({ space: 12 }) {
        Button('取消修改').id('task-action-cancel').layoutWeight(1).height(this.largeSimpleMode ? 56 : 46)
          .fontSize(AppTheme.font(14, this.largeSimpleMode)).labelStyle({ maxLines: 2 }).backgroundColor(AppTheme.soft).fontColor(AppTheme.primary)
          .enabled(!this.view.busy && !this.view.recoveryRequired).onClick(this.onCancel)
        Button(this.view.busy ? '保存中…' : '确认保存').id('task-action-confirm').layoutWeight(1).height(this.largeSimpleMode ? 56 : 46)
          .fontSize(AppTheme.font(14, this.largeSimpleMode)).labelStyle({ maxLines: 2 }).backgroundColor(AppTheme.primary).fontColor(AppTheme.onPrimary)
          .enabled(!this.view.busy && !this.view.recoveryRequired).onClick(this.onConfirm)
      }.width('100%')
    }.id('task-change-dialog').padding(24).width('92%').constraintSize({ maxWidth: 480, maxHeight: '85%' })
      .alignItems(HorizontalAlign.Start).backgroundColor(AppTheme.surface).borderRadius(24)
  }
}
