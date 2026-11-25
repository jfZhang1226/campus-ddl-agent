import { MessageBubble } from '../ui/MessageBubble';
import { BrandCover } from '../ui/BrandCover';
import { AssistantMascot } from '../ui/AssistantMascot';
import { assistantMode, shouldFinishWriting } from '../ui/AssistantMotion';
import { openAppTab, prepareTabBack, appTabArrived } from '../ui/TabNavigation';
import { displayPreferences } from '../ui/UiPreferencesOwner';
import { AppTheme } from '../ui/AppTheme';
import { AppTabBar } from '../ui/AppTabBar';
import { DeadlineEditor } from '../ui/DeadlineEditor';
import { deadlineInput, deadlineLabel } from '../ui/DeadlineInput';
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { chatOwner } from '../chat/ChatOwner';
import { ChatMessage } from '../chat/ChatModels';
import { TaskAgentController, TaskAgentView } from '../agent/TaskAgentController';
import { taskAgentOwner } from '../agent/TaskAgentOwner';
import { TaskDetail, TaskDraft } from '../domain/TaskContracts';
import { ProposedTaskChange } from '../domain/CommitModels';
import { ChecklistItem, Notice, Task } from '../domain/StorageModels';
import { KeyboardAvoidMode } from '@ohos.arkui.UIContext';

@Entry
@Component
struct TaskAssistantPage {
  @StorageLink('largeSimpleMode') largeSimpleMode: boolean = false;
  @StorageLink('tabTravelDirection') tabTravelDirection: number = 1;
  @State view: TaskAgentView = new TaskAgentView();
  @State prompt: string = '';
  @State sourcesOpen: boolean = false;
  @State expandedSavedTaskId: string = '';
  @State voiceOpen: boolean = false;
  @State inputFocused: boolean = false;
  @State composerExpanded: boolean = false;
  @State mascotMode: string = 'idle';
  @State mascotHint: string = '';
  @State mascotActive: boolean = true;
  private mascotFinishTimer: number = -1;
  private priorPhase: string = '';
  private savingReceiptBefore: string = '';
  private syncMascot(state: TaskAgentView): void {
    if (state.phase === 'saving' && this.priorPhase !== 'saving') this.savingReceiptBefore = this.view.receipt?.operationId || '';
    if (this.mascotActive && shouldFinishWriting(this.priorPhase, state.phase, state.errorCode, this.savingReceiptBefore, state.receipt?.operationId || '')) {
      this.mascotMode = 'write'; this.mascotHint = '记好了';
      clearTimeout(this.mascotFinishTimer);
      this.mascotFinishTimer = setTimeout(() => { this.mascotMode = 'idle'; this.mascotHint = ''; }, 1100);
    } else if (!(state.phase === 'idle' && this.mascotMode === 'write' && this.mascotHint === '记好了' && state.errorCode.length === 0)) {
      clearTimeout(this.mascotFinishTimer);
      this.mascotMode = assistantMode(state.phase, state.errorCode);
      this.mascotHint = this.mascotMode === 'write' ? '正在记下来…' : state.phase === 'staging' ? '正在整理任务…' : '正在分析通知，想一想怎么安排…';
    }
    this.priorPhase = state.phase;
  }
  @State deadlineTaskId: string = '';
  @State deadlineDate: string = '';
  @State deadlineTime: string = '';
  @State deadlineError: string = '';
  @State advancedOpen: boolean = false;
  private editDeadline(taskId: string): void {
    if (!this.idle() || this.view.proposal === null) return;
    const change = this.view.proposal.changes.find(item => item.taskId === taskId);
    if (change === undefined) return;
    const input = deadlineInput(change.draft);
    this.deadlineTaskId = taskId; this.deadlineDate = input.date; this.deadlineTime = input.time; this.deadlineError = '';
  }
  private async applyDeadline(date: string, time: string): Promise<void> {
    if (await this.controller?.editDeadline(this.deadlineTaskId, date, time)) this.deadlineTaskId = '';
    else this.deadlineError = this.view.notice;
  }
  private navigate(page: string): void {
    if (this.deadlineTaskId.length > 0) { this.deadlineError = '请先应用或取消本次时间编辑。'; return; }
    this.openPage(page);
  }
  private controller: TaskAgentController | null = null;
  private previousKeyboardMode: KeyboardAvoidMode = KeyboardAvoidMode.OFFSET;
  private scroller: Scroller = new Scroller();
  private scrollTimer: number = -1;
  private syncGateway(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.controller?.configure(chatOwner.get(context.filesDir).configuration());
  }
  onPageShow(): void { appTabArrived('pages/TaskAssistant'); this.mascotActive = true; this.syncGateway(); }
  private openPage(page: string): void {
    if (!this.idle()) return;
    taskAgentOwner.pause();
    openAppTab('pages/TaskAssistant', page).catch(() => { this.view.notice = '无法打开页面，请稍后重试。'; });
  }
  aboutToAppear(): void {
    const uiContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    displayPreferences(uiContext.filesDir).restore();
    this.previousKeyboardMode = this.getUIContext().getKeyboardAvoidMode();
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.controller = taskAgentOwner.get(context);
    this.syncGateway();
    this.controller.subscribe((state: TaskAgentView) => {
      const shouldScroll: boolean = state.messages.length !== this.view.messages.length ||
        (state.proposal !== null && state.proposal.id !== this.view.proposal?.id);
      this.syncMascot(state);
      this.view = state;
      if (shouldScroll) { clearTimeout(this.scrollTimer); this.scrollTimer = setTimeout(() => { this.scroller.scrollEdge(Edge.Bottom); }, 100); }
    });
  }
  onPageHide(): void { this.mascotActive = false; this.mascotMode = 'idle'; this.mascotHint = ''; clearTimeout(this.mascotFinishTimer); taskAgentOwner.pause(); }
  aboutToDisappear(): void {
    this.getUIContext().setKeyboardAvoidMode(this.previousKeyboardMode);
    taskAgentOwner.pause(); this.controller?.unsubscribe();
    this.mascotActive = false; clearTimeout(this.mascotFinishTimer);
    clearTimeout(this.scrollTimer);
  }
  private idle(): boolean { return this.view.phase === 'idle' && !this.view.speech.busy; }
  onBackPress(): boolean {
    if (this.deadlineTaskId.length > 0) { this.deadlineTaskId = ''; return true; }
    if (this.view.speech.busy) this.controller?.cancelVoice();
    if (!this.idle()) return true;
    if (this.view.input.length > 0 || this.view.proposal !== null) { this.prompt = 'leave'; return true; }
    prepareTabBack('pages/TaskAssistant'); return false;
  }
  private back(): void { if (!this.onBackPress()) router.back(); }
  private deadline(task: TaskDraft): string { return deadlineLabel(task); }
  private messageText(row: ChatMessage): string {
    if (row.role !== 'assistant') return row.text;
    if (row.text.startsWith('已正式保存，任务编号：')) return '任务已保存，可以在“任务”查看。';
    if (row.text === '已整理为待确认方案，尚未保存任务。请核对下方任务、材料及原文，再点确认。') return '整理好了，看看下面的任务。';
    return row.text;
  }
  private statusLabel(status: string): string {
    return status === 'todo' ? '待办' : status === 'in_progress' ? '进行中' : status === 'ready' ? '已准备' :
      status === 'submitted' ? '用户标记已提交' : status === 'done' ? '工作已完成' : status === 'cancelled' ? '已取消' : '待核对';
  }
  private details(task: TaskDraft): string {
    const kind: string = task.kind === 'assignment' ? '作业' : task.kind === 'report' ? '报告' : task.kind === 'registration' ? '报名' : task.kind === 'other' ? '其他' : '未分类';
    const priority: string = task.priority === 'high' ? '高' : task.priority === 'normal' ? '普通' : task.priority === 'low' ? '低' : '未设置';
    return '分类：' + kind + '；优先级：' + priority + '；剩余工时：' + (task.remainingMinutes === null ? '未知' : String(task.remainingMinutes) + '分钟');
  }
  @Builder
  header() {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        AssistantMascot({ mode: this.mascotMode, active: this.mascotActive, edge: this.largeSimpleMode ? 96 : 104, tag: 'brand' })
        Column({ space: 3 }) {
          Text('课事清').fontSize(AppTheme.font(22, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink)
          if (!this.largeSimpleMode) { Text('点我打个招呼').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted) }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button(this.largeSimpleMode ? '新建' : '新对话').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-new').height(this.largeSimpleMode ? 56 : 34).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
          .enabled(this.idle() && !this.view.historyPending && this.deadlineTaskId.length === 0).onClick(() => { this.prompt = 'fresh'; })
      }.width('100%')
      if (!this.view.configured) {
        Row({ space: 8 }) {
          Text('连接助手后，就能帮你整理通知。').id('task-agent-offline-hint').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber).layoutWeight(1)
          Button('去连接').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('open-gateway-settings').height(this.largeSimpleMode ? 56 : 30).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
            .enabled(this.idle()).onClick(() => this.openPage('pages/GatewaySettings'))
        }.padding(10).width('100%').backgroundColor('#F4EEDC').borderRadius(12)
      }
      if (this.mascotMode !== 'idle') {
        Row({ space: 12 }) {
          Column({ space: 5 }) {
            Text(this.mascotHint).id('mascot-activity-hint').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.primary)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          if (this.view.phase === 'running') {
            Button('停止').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-stop').height(this.largeSimpleMode ? 56 : 30).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
              .onClick(() => { this.controller?.stop(); })
          }
        }.width('100%').padding({ left: 4, right: 8 }).backgroundColor(AppTheme.soft).borderRadius(18)
      }
    }.width('100%').padding({ left: 22, right: 22, top: 18, bottom: 16 }).backgroundColor(AppTheme.canvas)
  }
  @Builder
  proposalCard() {
    if (this.view.proposal !== null) {
      Column({ space: 11 }) {
        Text('待确认的任务').id('task-agent-proposal').fontSize(AppTheme.font(17, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.primary)
        Text('新增 ' + String(this.view.proposal.changes.filter((change: ProposedTaskChange) => change.action === 'create').length) +
          ' 项，更新 ' + String(this.view.proposal.changes.filter((change: ProposedTaskChange) => change.action === 'update').length) + ' 项。')
          .fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted)
        ForEach(this.view.proposal.changes, (change: ProposedTaskChange) => {
          Column({ space: 6 }) {
            Text((change.action === 'create' ? '新增 · ' : '更新 · ') + change.draft.title)
              .fontSize(AppTheme.font(16, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink)
            Text('课程：' + (change.draft.course === null ? '待补充' : change.draft.course)).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted)
            if (change.before !== null) {
              Text('原任务：' + change.before.title + '；课程：' + (change.before.course === null ? '未知' : change.before.course))
                .fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber)
              Text('原截止：' + this.deadline(change.before)).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber)
              Text('原渠道：' + (change.before.submissionChannel === null ? '未知' : change.before.submissionChannel) +
                '；原状态：' + this.statusLabel(change.before.status)).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber)
              Text('原' + this.details(change.before)).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.amber)
            }
            Row({ space: 8 }) {
              Column({ space: 3 }) {
                Text('截止时间').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted)
                Text(this.deadline(change.draft)).fontSize(AppTheme.font(15, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.primary)
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Button(change.draft.deadlinePrecision === 'exact' ? '编辑' : '补充').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('draft-edit-deadline-' + change.taskId)
                .height(this.largeSimpleMode ? 56 : 32).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).enabled(this.idle() && !this.view.recoveryRequired)
                .onClick(() => { this.editDeadline(change.taskId); })
            }.width('100%').padding(12).backgroundColor(AppTheme.soft).borderRadius(12)
            Text('提交渠道：' + (change.draft.submissionChannel === null ? '未知' : change.draft.submissionChannel))
              .fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted)
            if (this.advancedOpen) {
              Text('状态：' + this.statusLabel(change.draft.status)).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted)
              Text(this.details(change.draft)).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted)
            }
            if (change.action === 'update') { Text('本次新增材料').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted) }
            if (this.view.proposal !== null && this.view.proposal.checklistItems !== undefined) {
              ForEach(this.view.proposal.checklistItems.filter((item: ChecklistItem) => item.taskId === change.taskId), (item: ChecklistItem) => {
                Text('• ' + item.label + ' · ' + (item.sourceNoticeId === null ? '来源待补充' : '来自通知') + ' · 待准备')
                  .fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted)
              }, (item: ChecklistItem) => item.id)
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(10).backgroundColor(AppTheme.soft).borderRadius(9)
        }, (change: ProposedTaskChange) => change.taskId + ':' + (this.view.proposal === null ? '' : this.view.proposal.id))
        Button(this.advancedOpen ? '收起更多信息' : '查看分类与工时').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).height(this.largeSimpleMode ? 56 : 30).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted).backgroundColor(AppTheme.surface).onClick(() => { this.advancedOpen = !this.advancedOpen; })
        Button(this.sourcesOpen ? '收起原文' : '查看通知原文（' + String(this.view.sources.length) + '段）').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius)
          .id('task-agent-sources').fontSize(AppTheme.font(12, this.largeSimpleMode)).onClick(() => { this.sourcesOpen = !this.sourcesOpen; })
        if (this.sourcesOpen) {
          ForEach(this.view.sources, (source: Notice) => {
            Column({ space: 5 }) {
              Text(source.sourceLabel === null ? '来源未知' : source.sourceLabel).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.primary)
              Text(source.rawText).fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.ink).copyOption(CopyOptions.InApp)
              Text('发布时间：' + (source.publishedAt === null ? '未知' : source.publishedAt) + '；导入时间：' + source.importedAt)
                .fontSize(AppTheme.font(10, this.largeSimpleMode)).fontColor(AppTheme.muted)
            }.width('100%').alignItems(HorizontalAlign.Start).padding(9).backgroundColor(AppTheme.canvas).borderRadius(8)
          }, (source: Notice) => source.id)
        }
        if (!this.largeSimpleMode) { Text('想调整？在下方继续告诉我。').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted) }
        Row({ space: 10 }) {
          Button('暂不保存').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-cancel-proposal').fontSize(AppTheme.font(13, this.largeSimpleMode)).layoutWeight(1)
            .enabled(this.idle() && !this.view.recoveryRequired).onClick(() => { this.controller?.cancelProposal(); })
          Button('确认并保存').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-confirm').fontSize(AppTheme.font(13, this.largeSimpleMode)).layoutWeight(1).backgroundColor(AppTheme.primary).fontColor(AppTheme.onPrimary).fontColor('#FFFFFF')
            .enabled(this.idle() && !this.view.recoveryRequired).onClick(() => { this.controller?.confirm(); })
        }.width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start).padding(18).backgroundColor(AppTheme.surface).borderRadius(22).border({ width: 1, color: AppTheme.border })
    }
  }
  @Builder
  receiptCard() {
    if (this.view.receipt !== null && this.view.proposal === null) {
      Column({ space: 7 }) {
        Text('已保存的任务').fontSize(AppTheme.font(15, this.largeSimpleMode)).fontWeight(FontWeight.Bold).fontColor(AppTheme.primary)
        ForEach(this.view.receipt.tasks, (task: Task) => {
          Text(task.title + ' · ' + this.deadline(task)).id('task-agent-saved-' + task.id).fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.ink)
        }, (task: Task) => task.id + ':' + String(task.version))
        ForEach(this.view.savedDetails, (detail: TaskDetail) => {
          Column({ space: 4 }) {
            Text('需要准备 · ' + detail.task.title).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.primary)
            ForEach(detail.checklistItems, (item: ChecklistItem) => {
              Text(item.label + ' · ' + (item.state === 'prepared' ? '已准备' : '待准备')).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted)
            }, (item: ChecklistItem) => item.id + ':' + item.state)
            if (detail.checklistItems.length === 0) { Text('尚未记录材料要求。').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted) }
            Button(this.expandedSavedTaskId === detail.task.id ? '收起原文' :
              '查看原通知（' + String(detail.notices.length) + '段）').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-saved-sources-' + detail.task.id).fontSize(AppTheme.font(11, this.largeSimpleMode))
              .onClick(() => { this.expandedSavedTaskId = this.expandedSavedTaskId === detail.task.id ? '' : detail.task.id; })
            if (this.expandedSavedTaskId === detail.task.id) {
              if (detail.notices.length === 0) { Text('当前任务没有关联通知来源。').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted) }
              ForEach(detail.notices, (source: Notice) => {
                Column({ space: 4 }) {
                  Text(source.sourceLabel === null ? '来源未知' : source.sourceLabel).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.primary)
                  Text(source.rawText).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.ink).copyOption(CopyOptions.InApp)
                  Text('发布时间：' + (source.publishedAt === null ? '未知' : source.publishedAt) + '；导入时间：' + source.importedAt)
                    .fontSize(AppTheme.font(10, this.largeSimpleMode)).fontColor(AppTheme.muted)
                }.width('100%').alignItems(HorizontalAlign.Start).padding(8).backgroundColor(AppTheme.surface).borderRadius(8)
              }, (source: Notice) => source.id)
            }
          }.width('100%').alignItems(HorizontalAlign.Start)
        }, (detail: TaskDetail) => detail.task.id + ':' + String(detail.revision))
        if (this.view.detailsPending) {
          Text('任务已保存，材料暂时加载失败，请点重新加载。').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber)
        }
        Button('查看任务').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-open-saved').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).enabled(this.idle()).onClick(() => { this.openPage('pages/Tasks'); })
      }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(AppTheme.card).borderRadius(20).border({ width: 1, color: AppTheme.border })
    }
  }
  @Builder
  candidatesCard() {
    if (this.view.candidates.length > 1 && this.view.proposal === null) {
      Column({ space: 8 }) {
        Text('你想修改哪一项？').fontSize(AppTheme.font(17, this.largeSimpleMode)).fontWeight(FontWeight.Medium)
        if (this.view.candidatesTruncated) { Text('候选较多，仅显示前30项，请补充课程或标题缩小范围。').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber) }
        ForEach(this.view.candidates, (task: Task) => {
          Column({ space: 5 }) {
            Text(task.title + ' · ' + (task.course || '课程未知')).fontSize(AppTheme.font(14, this.largeSimpleMode))
            Text(this.deadline(task) + ' · ' + this.statusLabel(task.status)).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.muted)
            if (this.view.candidates.filter((item: Task) => item.title === task.title && item.course === task.course).length > 1) { Text('任务编号 ' + task.id.slice(-6)).fontSize(AppTheme.font(10, this.largeSimpleMode)).fontColor(AppTheme.muted) }
            Button('选择此任务').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-choose-' + task.id).fontSize(AppTheme.font(12, this.largeSimpleMode)).enabled(this.idle() && !this.view.historyPending && !this.view.recoveryRequired)
              .onClick(() => { this.controller?.chooseTask(task.id); })
          }.width('100%').alignItems(HorizontalAlign.Start).padding(10).backgroundColor(AppTheme.surface).borderRadius(9)
        }, (task: Task) => task.id + ':' + String(task.version))
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
    if (this.view.selectedTask !== null) {
      Column({ space: 7 }) {
        Text('正在修改：' + this.view.selectedTask.task.title + ' · ' + (this.view.selectedTask.task.course || '课程未知')).fontSize(AppTheme.font(14, this.largeSimpleMode)).fontColor(AppTheme.primary)
        Text(this.deadline(this.view.selectedTask.task)).fontSize(AppTheme.font(12, this.largeSimpleMode))
        ForEach(this.view.selectedTask.notices, (notice: Notice) => {
          Text((notice.sourceLabel || '来源未知') + '\n' + notice.rawText).fontSize(AppTheme.font(12, this.largeSimpleMode)).copyOption(CopyOptions.InApp)
        }, (notice: Notice) => notice.id)
        Button('取消选择').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-clear-choice').fontSize(AppTheme.font(12, this.largeSimpleMode)).enabled(this.idle()).onClick(() => { this.controller?.clearTaskChoice(); })
      }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(AppTheme.soft).borderRadius(9)
    }
  }
  @Builder
  voiceControls() {
    if (this.view.speechEnabled && (this.voiceOpen || this.view.speech.busy)) {
      Column({ space: 5 }) {
        Flex({ wrap: FlexWrap.Wrap }) {
          Button('开始录音').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0, maxWidth: '100%' }).margin({ right: 6, bottom: 6 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-record').fontSize(AppTheme.font(11, this.largeSimpleMode))
            .enabled(this.idle() && !this.view.historyPending && !this.view.recoveryRequired)
            .onClick(() => { this.controller?.record(); })
          Button('结束录音').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0, maxWidth: '100%' }).margin({ right: 6, bottom: 6 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-finish').fontSize(AppTheme.font(11, this.largeSimpleMode))
            .enabled(this.view.speech.phase === 'recording').onClick(() => { this.controller?.finishRecording(); })
          Button('停止语音').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0, maxWidth: '100%' }).margin({ right: 6, bottom: 6 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-stop-voice').fontSize(AppTheme.font(11, this.largeSimpleMode))
            .enabled(this.view.speech.busy).onClick(() => { this.controller?.cancelVoice(); })
        }
        Row({ space: 7 }) {
          Button('读给我听').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-speak').fontSize(AppTheme.font(11, this.largeSimpleMode))
            .enabled(this.idle() && this.view.proposal !== null && !this.view.recoveryRequired)
            .onClick(() => { this.controller?.speakProposal(); })
          Text(this.view.speech.errorCode.length > 0 ? this.view.speech.errorCode :
            this.view.speech.busy ? this.view.speech.message : '说完点结束').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted).layoutWeight(1)
        }
        if (this.view.speech.partial.length > 0 && this.view.speech.busy) {
          Text(this.view.speech.partial).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted).maxLines(2)
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
  pageTransition() {
    PageTransitionEnter({ type: RouteType.Push, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Right : SlideEffect.Left)
    PageTransitionEnter({ type: RouteType.Pop, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Right : SlideEffect.Left)
    PageTransitionExit({ type: RouteType.Push, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Left : SlideEffect.Right)
    PageTransitionExit({ type: RouteType.Pop, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Left : SlideEffect.Right)
  }
  build() {
    Column() {
      if (this.view.phase === 'initializing') {
        BrandCover()
      } else {
      this.header()
      if (this.deadlineTaskId.length > 0) {
        Scroll() {
          DeadlineEditor({ initialDate: this.deadlineDate, initialTime: this.deadlineTime, saving: !this.idle(), error: this.deadlineError,
            onApply: (date: string, time: string): void => { this.applyDeadline(date, time); }, onCancel: (): void => { this.deadlineTaskId = ''; } })
        }.layoutWeight(1).width('100%').padding(16)
      } else if (this.prompt.length > 0) {
        Column({ space: 14 }) {
          Text(this.prompt === 'fresh' ? '开始新的任务对话？' : '离开当前页面？').fontSize(AppTheme.font(20, this.largeSimpleMode)).fontColor(AppTheme.ink)
          Text(this.prompt === 'fresh' ? '旧对话保留；未确认方案会取消，当前未发送输入会清空。' :
            '已写入的对话和待确认方案保留，当前未发送输入离页后可能丢失。').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted)
          Button('继续编辑').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-keep').onClick(() => { this.prompt = ''; })
          Button(this.prompt === 'fresh' ? '确认新建' : '确认离开').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-leave').enabled(this.idle())
            .onClick(() => {
              const action: string = this.prompt; this.prompt = '';
              if (action === 'fresh') this.controller?.fresh(); else { taskAgentOwner.pause(); router.back(); }
            })
        }.layoutWeight(1).width('100%').padding(20)
      } else {
        Scroll(this.scroller) {
          Column({ space: 12 }) {
            if (this.view.notice.length > 0 && !['CONFIG_URL', 'CONFIG_TOKEN', 'CONFIG_TIMEOUT'].includes(this.view.errorCode)) {
              Text(this.view.notice).id('task-agent-notice').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted)
            }
            if (this.view.messages.length === 0) {
              Column({ space: 12 }) {
                Text(this.largeSimpleMode ? '粘贴通知，我来整理' : '通知交给我\n事情有着落').fontSize(AppTheme.font(this.largeSimpleMode ? 22 : 30, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink).lineHeight(AppTheme.line(41, this.largeSimpleMode))
                if (!this.largeSimpleMode) { Text('粘贴一段通知，或用语音告诉我。\n任务、截止和材料，帮你一起整理。').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted).lineHeight(AppTheme.line(23, this.largeSimpleMode)) }
                if (!this.largeSimpleMode) { Text('由你决定怎么安排').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.primary).padding({ left: 12, right: 12, top: 8, bottom: 8 }).backgroundColor(AppTheme.soft).borderRadius(18) }
              }.width('100%').padding({ top: 14, bottom: 14 }).alignItems(HorizontalAlign.Start)
            }
            ForEach(this.view.messages.slice(-30), (row: ChatMessage) => {
              MessageBubble({ role: row.role, content: this.messageText(row), phase: row.phase })
            }, (row: ChatMessage) => row.id + ':' + row.phase)
            this.candidatesCard()
            this.proposalCard()
            this.receiptCard()
            if (this.view.historyPending) {
              Button('重试保存对话记录').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-retry-history').enabled(this.idle()).onClick(() => { this.controller?.retryHistory(); })
            }
            if (this.view.recoveryRequired || (this.view.errorCode.length > 0 && !['CONFIG_URL', 'CONFIG_TOKEN', 'CONFIG_TIMEOUT'].includes(this.view.errorCode))) {
              Button('重新加载').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-recover').fontSize(AppTheme.font(12, this.largeSimpleMode)).enabled(this.idle()).onClick(() => { this.controller?.recover(); })
            }
          }.width('100%').padding({ left: 22, right: 22, top: 12, bottom: 14 }).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%')
        Column({ space: 10 }) {
          this.voiceControls()
          if (this.view.proposal !== null) { Text('发送补充会取消当前未保存方案并重新整理，仍需再次确认保存。').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.amber) }
          TextArea({ text: this.view.input, placeholder: '输入通知，或继续补充…' }).fontSize(AppTheme.font(16, this.largeSimpleMode)).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14)
            .id('task-agent-input').height(this.largeSimpleMode ? 110 : this.composerExpanded ? 160 : 70).fontSize(AppTheme.font(15, this.largeSimpleMode)).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).caretColor(AppTheme.primary).backgroundColor(Color.Transparent).borderRadius(0).maxLength(4000).enabled(this.view.phase === 'idle' && !this.view.historyPending && !this.view.recoveryRequired)
            .onChange((text: string) => { this.controller?.edit(text); })
            .onFocus(() => { this.inputFocused = true; }).onBlur(() => { this.inputFocused = false; })
          Row({ space: 10 }) {
            Button(this.voiceOpen ? '收起语音' : '语音输入').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-voice-mode').fontSize(AppTheme.font(12, this.largeSimpleMode)).height(this.largeSimpleMode ? 56 : 38).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
              .enabled(this.view.speechEnabled && !this.view.speech.busy).onClick(() => { this.voiceOpen = !this.voiceOpen; })
            if (!this.largeSimpleMode) {
            Button(this.composerExpanded ? '收起输入' : '展开输入').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).id('task-agent-expand-input')
              .fontSize(AppTheme.font(12, this.largeSimpleMode)).height(this.largeSimpleMode ? 56 : 38).fontColor(AppTheme.primary).backgroundColor(Color.Transparent)
              .borderRadius(AppTheme.controlRadius).enabled(this.idle())
              .onClick(() => { this.composerExpanded = !this.composerExpanded; })
            }
            Blank().layoutWeight(1)
            Button('发送').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('task-agent-send').width(68).height(this.largeSimpleMode ? 56 : 38).backgroundColor(AppTheme.primary).fontColor(AppTheme.onPrimary).fontColor('#FFFFFF').fontSize(AppTheme.font(14, this.largeSimpleMode))
              .enabled(this.idle() && this.view.configured && !this.view.historyPending && !this.view.recoveryRequired && this.view.input.trim().length > 0)
              .onClick(() => { this.controller?.send(); })
          }.width('100%')
        }.width('92%').padding(14).backgroundColor(AppTheme.composer).borderRadius(24)
          .border({ width: this.inputFocused ? 1.5 : 1, color: this.inputFocused ? AppTheme.primary : AppTheme.composerBorder }).margin({ top: 7, bottom: 9 })
      }
      AppTabBar({ active: 'assistant', enabledTabs: this.idle(), onSelect: (page: string): void => { this.navigate(page); } })
      }
    }.width('100%').height('100%').backgroundColor(AppTheme.canvas)
  }
}
