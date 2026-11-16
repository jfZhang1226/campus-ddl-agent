import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { getClientStorage } from '../data/ClientStorage';
import { TaskBoardController, TaskBoardRow, TaskBoardView } from '../tasks/TaskBoardController';
import { Notice } from '../domain/StorageModels';
import { MaterialChoice, TaskActionsController, TaskActionsView } from '../tasks/TaskActionsController';
import { ProposedTaskChange, ProposedChecklistState, UserSubmissionSnapshot } from '../domain/CommitModels';
import { TaskReminderController, TaskReminderView } from '../reminders/TaskReminderController';
import { reminderOwner } from '../reminders/ReminderOwner';
import { zonedDateTimeParts } from '../domain/DateRules';

@Entry
@Component
struct TasksPage {
  @State view: TaskBoardView = new TaskBoardView();
  @State reminder: TaskReminderView = new TaskReminderView();
  @State leadMinutes: string = '60';
  @State actions: TaskActionsView = new TaskActionsView();
  @State materialLabel: string = '';
  @State effortMinutes: string = '';
  @State localHint: string = '';
  private controller: TaskBoardController | null = null;
  private reminderController: TaskReminderController | null = null;
  private actionsController: TaskActionsController | null = null;
  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.reminderController = new TaskReminderController(reminderOwner.get(context));
    this.reminderController.subscribe((view: TaskReminderView) => { this.reminder = view; });
    const storage = getClientStorage(context.filesDir);
    this.actionsController = new TaskActionsController(storage.local, storage.tasks, storage.commits);
    this.actionsController.subscribe((view: TaskActionsView) => { this.actions = view; });
    this.actionsController.initialize();
    this.controller = new TaskBoardController(storage.tasks);
    this.controller.subscribe((view: TaskBoardView) => {
      const changed: boolean = view.detail?.task.id !== this.view.detail?.task.id || view.detail?.task.version !== this.view.detail?.task.version;
      this.view = view;
      if (changed) {
        this.reminderController?.select(view.detail === null ? null : view.detail.task);
        this.actionsController?.select(view.detail);
        this.materialLabel = ''; this.effortMinutes = view.detail?.task.remainingMinutes === null || view.detail === null ? '' : String(view.detail.task.remainingMinutes); this.localHint = '';
      }
    });
    this.controller.reload();
  }
  aboutToDisappear(): void { this.controller?.dispose(); this.controller = null; this.reminderController?.dispose(); this.reminderController = null; this.actionsController?.dispose(); this.actionsController = null; }
  onBackPress(): boolean {
    if (this.reminder.busy || this.actions.busy) return true;
    if (this.hasLocalChanges()) { this.localHint = '还有未保存的勾选、材料名称或工时，请先核对保存或放弃本页修改。'; return true; }
    if (this.view.detail !== null) { this.controller?.closeDetail(); return true; }
    return false;
  }
  private originalEffort(): string { return this.view.detail === null || this.view.detail.task.remainingMinutes === null ? '' : String(this.view.detail.task.remainingMinutes); }
  private hasLocalChanges(): boolean { return (this.actionsController?.hasLocalChanges() || false) || this.materialLabel.trim().length > 0 || this.effortMinutes !== this.originalEffort(); }
  private readyForAction(mode: string): boolean {
    if ((mode !== 'add' && this.materialLabel.trim().length > 0) || (mode !== 'effort' && this.effortMinutes !== this.originalEffort())) {
      this.localHint = '材料名称或剩余工时尚未整理进方案，请先用对应的核对按钮处理，或放弃未保存内容。'; return false;
    }
    this.localHint = ''; return true;
  }
  private async refreshTask(id: string | null, confirmed: boolean = false): Promise<void> {
    if (!confirmed && this.hasLocalChanges() && this.actions.pending === null) { this.localHint = '刷新前请先保存或放弃未保存内容。'; return; }
    await this.controller?.reload();
    if (id !== null) await this.controller?.select(id);
  }
  private async saveAction(): Promise<void> {
    const id: string | null = this.actions.pending?.changes[0]?.taskId || null;
    if (await this.actionsController?.confirm()) {
      this.materialLabel = '';
      await this.refreshTask(id, true);
    }
  }
  @Builder
  pendingAction() {
    if (this.actions.pending !== null) {
      Scroll() {
        Column({ space: 7 }) {
          Text('修改尚未保存，请核对').fontSize(17).fontWeight(FontWeight.Medium)
          ForEach(this.actions.pending.changes, (change: ProposedTaskChange) => {
            Text(change.draft.title + '：' + this.status(change.before?.status || 'todo') + ' → ' + this.status(change.draft.status)).fontSize(13)
            Text('截止：' + (change.draft.deadlineDate || change.draft.dueAt || '未知') + '；渠道：' + (change.draft.submissionChannel || '未提供')).fontSize(11)
            Text('剩余工时：' + (change.before?.remainingMinutes === null || change.before === null ? '未知' : String(change.before.remainingMinutes) + '分钟') + ' → ' + (change.draft.remainingMinutes === null ? '未知' : String(change.draft.remainingMinutes) + '分钟')).fontSize(12)
            if (change.confirmSubmission) { Text('本次仅记录你的提交声明，不代表学校平台已收到。').fontSize(12).fontColor('#9A541B') }
          }, (change: ProposedTaskChange) => change.taskId)
          Text('核对前的材料：' + (this.actions.pending.checklistBefore || []).map(item => item.label + (item.state === 'prepared' ? '（已准备）' : '（待准备）')).join('、')).fontSize(12)
          ForEach(this.actions.pending.checklistUpdates || [], (item: ProposedChecklistState) => {
            Text(item.before.label + '：' + (item.before.state === 'prepared' ? '已准备' : '待准备') + ' → ' + (item.state === 'prepared' ? '已准备' : '待准备')).fontSize(12)
          }, (item: ProposedChecklistState) => item.itemId)
          Text('新增材料：' + (this.actions.pending.checklistItems || []).map(item => item.label).join('、')).fontSize(12)
          Row({ space: 8 }) {
            Button('放弃本次修改').id('task-action-cancel').fontSize(12).enabled(!this.actions.busy && !this.actions.recoveryRequired)
              .onClick(() => { this.actionsController?.cancel(); })
            Button('确认保存修改').id('task-action-confirm').fontSize(12).enabled(!this.actions.busy && !this.actions.recoveryRequired)
              .onClick(() => { this.saveAction(); })
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#FFF5DE')
      }.height(230).width('100%')
    }
  }
  @Builder
  materialPanel() {
    Column({ space: 8 }) {
      Text('材料与准备状态').fontSize(17).fontWeight(FontWeight.Medium)
      Text('勾选只修改本页草稿，核对并确认保存后才改变正式记录。').fontSize(12).fontColor('#617589')
      ForEach(this.actions.materials, (item: MaterialChoice) => {
        Row({ space: 8 }) {
          Checkbox({ name: item.itemId }).id('task-material-' + item.itemId).select(item.state === 'prepared')
            .enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired && this.view.detail?.task.status !== 'done' && this.view.detail?.task.status !== 'cancelled')
            .onChange((checked: boolean) => { if (checked !== (item.state === 'prepared')) this.actionsController?.toggle(item.itemId); })
          Text(item.label + (item.state !== item.originalState ? '（未保存）' : '')).fontSize(14).layoutWeight(1)
        }.width('100%')
      }, (item: MaterialChoice) => item.itemId)
      if (this.actions.materials.length === 0) { Text('没有记录材料要求。').fontSize(13).fontColor('#617589') }
      Button('核对准备情况').id('task-material-prepare').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
        .onClick(() => { if (this.readyForAction('materials')) this.actionsController?.prepareMaterials(); })
      if (this.view.detail?.task.status !== 'done' && this.view.detail?.task.status !== 'cancelled') {
        TextInput({ text: this.materialLabel, placeholder: '手动补充材料名称' }).id('task-material-name').maxLength(200)
          .enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired).onChange((text: string) => { this.materialLabel = text; })
        Button('核对新增材料').id('task-material-add').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
          .onClick(() => { if (this.readyForAction('add')) this.actionsController?.prepareAddMaterial(this.materialLabel); })
      }
      Text('剩余工时（分钟）').fontSize(15)
      Text('由你估计尚需完成的工作；留空表示未知，不根据材料数量猜测。').fontSize(12).fontColor('#617589')
      TextInput({ text: this.effortMinutes, placeholder: '未知可留空，例如60' }).id('task-effort-minutes').type(InputType.Number).maxLength(8)
        .enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired).onChange((text: string) => { this.effortMinutes = text; })
      Button('核对剩余工时').id('task-effort-prepare').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
        .onClick(() => { if (this.readyForAction('effort')) this.actionsController?.prepareEffort(this.effortMinutes.trim().length === 0 ? null : /^\d+$/.test(this.effortMinutes) ? Number(this.effortMinutes) : NaN); })
      Button('放弃本页未保存内容').id('task-material-discard').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
        .onClick(() => { this.actionsController?.discardLocalChanges(); this.materialLabel = ''; this.effortMinutes = this.originalEffort(); this.localHint = ''; })
      if (this.view.detail !== null && !['submitted', 'done', 'cancelled'].includes(this.view.detail.task.status)) {
        Row({ space: 5 }) {
          Button('进行中').id('task-status-progress').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
            .onClick(() => { if (this.readyForAction('progress')) this.actionsController?.prepareStatus('progress'); })
          Button('准备完成').id('task-status-ready').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
            .onClick(() => { if (this.readyForAction('ready')) this.actionsController?.prepareStatus('ready'); })
          Button('取消任务').id('task-status-cancel').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
            .onClick(() => { if (this.readyForAction('cancel')) this.actionsController?.prepareStatus('cancel'); })
        }
        if (this.view.detail.task.submissionChannel === null && this.actions.materials.length === 0) {
          Button('核对完成任务').id('task-status-done').fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
            .onClick(() => { if (this.readyForAction('done')) this.actionsController?.prepareStatus('done'); })
        }
      }
      if (this.view.detail?.task.status === 'ready' || this.view.detail?.task.status === 'submitted') {
        Text('只有你在实际提交后才能声明已提交；本应用不会代交。').fontSize(12).fontColor('#617589')
        Button(this.view.detail?.task.status === 'submitted' ? '核对并重新声明已提交' : '核对用户已提交声明').id('task-status-submit')
          .fontSize(12).enabled(!this.actions.busy && this.actions.pending === null && !this.actions.recoveryRequired)
          .onClick(() => { if (this.readyForAction('submit')) this.actionsController?.prepareStatus('submit'); })
      }
      if (this.actions.needsSubmissionReview) { Text('任务或要求在上次声明后已变化，请重新核对；原提交声明仍保留。').fontSize(12).fontColor('#9A541B') }
      Text('提交声明历史（' + String(this.actions.submissions.length) + '）').fontSize(15)
      ForEach(this.actions.submissions, (entry: UserSubmissionSnapshot) => {
        Text(this.reminderTime(entry.confirmedSubmittedAt) + ' · 任务版本' + String(entry.taskVersion) + '\n渠道：' + (entry.submissionChannel || '未提供') + '\n材料：' + entry.materials.map(item => item.label).join('、')).fontSize(12)
      }, (entry: UserSubmissionSnapshot) => entry.id)
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#FFFFFF').borderRadius(10)
  }
  private reminderTime(instant: string): string {
    const parts = zonedDateTimeParts(instant, 'Asia/Shanghai');
    return parts === null ? '时间待核对' : parts.date + ' ' + parts.time + '（北京时间）';
  }
  private reminderStatus(): string {
    if (this.reminder.errorCode.length > 0) return '提醒状态尚未核实';
    if (this.reminder.setting === null || this.reminder.setting.phase === 'disabled') return '尚未启用提醒';
    return this.reminder.setting.phase === 'registered' ? '已登记到系统，尚不代表实际送达' :
      this.reminder.setting.phase === 'needs_attention' ? '提醒需重新核对时间或权限' : '提醒登记或取消待核实，请重新读取';
  }
  @Builder
  reminderPanel() {
    Column({ space: 8 }) {
      Text('截止前提醒').fontSize(17).fontWeight(FontWeight.Medium)
      if (!this.reminder.supported) {
        Text('当前入口暂不支持系统提醒，任务查看与保存仍可用。').fontSize(12).fontColor('#617589')
      } else {
        Text(this.reminderStatus()).id('task-reminder-status').fontSize(12).fontColor('#176766')
        Text('通知提示音由系统设置控制；本页不会播放测试声音。').fontSize(11).fontColor('#617589')
        if (!this.reminder.permission) {
          Button('允许本应用通知').id('task-reminder-permission').fontSize(12).enabled(!this.reminder.busy)
            .onClick(() => { this.reminderController?.requestPermission(); })
        }
        if (this.view.detail !== null && this.view.detail.task.deadlinePrecision !== 'exact') {
          Text('缺少确切截止时刻，暂不生成精确提醒；不会擅自补成23:59。').fontSize(12).fontColor('#8A5A12')
        }
        TextInput({ text: this.leadMinutes, placeholder: '提前分钟数（1至10080）' }).id('task-reminder-lead')
          .type(InputType.Number).enabled(!this.reminder.busy).maxLength(5)
          .onChange((text: string) => { this.leadMinutes = text; this.reminderController?.cancelPreview(); })
        Row({ space: 6 }) {
          Button('核对提醒计划').id('task-reminder-prepare').fontSize(12).enabled(!this.reminder.busy && this.reminder.permission)
            .onClick(() => { this.reminderController?.prepare(/^\d+$/.test(this.leadMinutes) ? Number(this.leadMinutes) : NaN); })
          Button('重新读取').id('task-reminder-refresh').fontSize(12).enabled(!this.reminder.busy)
            .onClick(() => { this.reminderController?.refresh(); })
        }
        if (this.reminder.preview !== null) {
          Text('将于 ' + this.reminderTime(this.reminder.preview.fireAt) + ' 提醒').id('task-reminder-preview').fontSize(14)
          Text('正式截止仍为 ' + this.reminderTime(this.reminder.preview.deadlineAt) + '，不会被提醒时间改写。').fontSize(12).fontColor('#617589')
          Row({ space: 8 }) {
            Button('取消').id('task-reminder-cancel-preview').fontSize(12).enabled(!this.reminder.busy)
              .onClick(() => { this.reminderController?.cancelPreview(); })
            Button('确认启用提醒').id('task-reminder-confirm').fontSize(12).enabled(!this.reminder.busy)
              .onClick(() => { this.reminderController?.confirm(); })
          }
        }
        Button('取消本任务提醒').id('task-reminder-disable').fontSize(12)
          .enabled(!this.reminder.busy && ((this.reminder.setting !== null && this.reminder.setting.phase !== 'disabled') || this.reminder.errorCode.length > 0))
          .onClick(() => { this.reminderController?.disable(); })
        if (this.reminder.busy) { Text('正在核对系统提醒…').fontSize(12).fontColor('#617589') }
        if (this.reminder.notice.length > 0) { Text(this.reminder.notice).id('task-reminder-notice').fontSize(12).fontColor('#8A5A12') }
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#FFFFFF').borderRadius(10)
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
        this.reminderPanel()
        this.materialPanel()
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
        Button('返回').id('task-board-back').fontSize(12).enabled(!this.reminder.busy && !this.actions.busy).onClick(() => {
          if (!this.onBackPress()) router.back();
        })
        Text(this.view.detail === null ? '我的任务' : '任务详情').fontSize(23).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('刷新').id('task-board-refresh').fontSize(12).enabled(!this.view.loading && !this.reminder.busy && !this.actions.busy).onClick(() => { this.refreshTask(this.view.detail?.task.id || null); })
      }.width('100%').padding(14)
      if (this.actions.notice.length > 0) { Text(this.actions.notice).id('task-action-notice').fontSize(12).fontColor('#176766').padding(8) }
      if (this.localHint.length > 0) { Text(this.localHint).fontSize(12).fontColor('#9A541B') }
      if (this.actions.recoveryRequired || this.actions.errorCode.length > 0) {
        Button('重新读取修改结果').id('task-action-recover').fontSize(12).enabled(!this.actions.busy).onClick(() => { this.actionsController?.recover(); })
      }
      this.pendingAction()
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
        Text('按截止日期查看任务；详情可核对材料、提交声明与系统提醒。').fontSize(11).fontColor('#617589')
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
                  .enabled(!this.view.loading && !this.view.stale && !this.actions.busy).onClick(() => { this.controller?.select(row.task.id); })
              }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor('#FFFFFF').borderRadius(12)
            }, (row: TaskBoardRow) => row.task.id + ':' + String(row.task.version) + ':' + row.section)
          }.width('100%').padding(14)
        }.layoutWeight(1).width('100%')
      }
    }.width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
