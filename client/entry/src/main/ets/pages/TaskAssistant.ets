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
  @State view: TaskAgentView = new TaskAgentView();
  @State prompt: string = '';
  @State sourcesOpen: boolean = false;
  private controller: TaskAgentController | null = null;
  private previousKeyboardMode: KeyboardAvoidMode = KeyboardAvoidMode.OFFSET;
  private scroller: Scroller = new Scroller();
  private scrollTimer: number = -1;
  aboutToAppear(): void {
    this.previousKeyboardMode = this.getUIContext().getKeyboardAvoidMode();
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.controller = taskAgentOwner.get(context);
    this.controller.configure(chatOwner.get(context.filesDir).configuration());
    this.controller.subscribe((state: TaskAgentView) => {
      const shouldScroll: boolean = state.messages.length !== this.view.messages.length ||
        (state.proposal !== null && state.proposal.id !== this.view.proposal?.id);
      this.view = state;
      if (shouldScroll) { clearTimeout(this.scrollTimer); this.scrollTimer = setTimeout(() => { this.scroller.scrollEdge(Edge.Bottom); }, 100); }
    });
  }
  onPageHide(): void { taskAgentOwner.pause(); }
  aboutToDisappear(): void {
    this.getUIContext().setKeyboardAvoidMode(this.previousKeyboardMode);
    taskAgentOwner.pause(); this.controller?.unsubscribe();
    clearTimeout(this.scrollTimer);
  }
  private idle(): boolean { return this.view.phase === 'idle' && !this.view.speech.busy; }
  onBackPress(): boolean {
    if (this.view.speech.busy) this.controller?.cancelVoice();
    if (!this.idle()) return true;
    if (this.view.input.length > 0 || this.view.proposal !== null) { this.prompt = 'leave'; return true; }
    return false;
  }
  private back(): void { if (!this.onBackPress()) router.back(); }
  private deadline(task: TaskDraft): string {
    return task.deadlinePrecision === 'exact' && task.dueAt !== null ? task.dueAt + ' · ' + task.timezone :
      task.deadlinePrecision === 'date_only' && task.deadlineDate !== null ? task.deadlineDate + '（具体时刻未知）' : '截止待补充';
  }
  private actionLabel(action: string): string {
    return action === 'get_tasks' ? '查询任务' : action === 'get_task_detail' ? '读取任务详情' :
      action === 'get_notice' ? '读取通知来源' : action === 'propose_task_changes' ? '整理待确认方案' : '检查可用时间';
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
    Column({ space: 10 }) {
      Row({ space: 10 }) {
        Button('返回').id('task-agent-back').fontSize(12).enabled(this.view.phase === 'idle').onClick(() => this.back())
        Column({ space: 3 }) {
          Text('任务助手').fontSize(23).fontWeight(FontWeight.Bold).fontColor('#142C43')
          Text('贴通知、继续补充，核对后保存').fontSize(12).fontColor('#617589')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button('新对话').id('task-agent-new').fontSize(12).enabled(this.idle() && !this.view.historyPending)
          .onClick(() => { this.prompt = 'fresh'; })
      }.width('100%')
      if (this.view.phase !== 'idle') {
        Row({ space: 9 }) {
          LoadingProgress().width(20).height(20).color('#176766')
          Text(this.view.phase === 'saving' ? '正在保存…' : this.view.phase === 'staging' ? '正在准备确认方案…' : '正在处理…')
            .fontSize(12).fontColor('#617589').layoutWeight(1)
          Button('停止').id('task-agent-stop').fontSize(12).enabled(this.view.phase === 'running')
            .onClick(() => { this.controller?.stop(); })
        }.width('100%')
      }
    }.width('100%').padding(16).backgroundColor('#FFFFFF')
  }
  @Builder
  proposalCard() {
    if (this.view.proposal !== null) {
      Column({ space: 11 }) {
        Text('待确认方案 · 尚未保存任务').id('task-agent-proposal').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#176766')
        Text('新增 ' + String(this.view.proposal.changes.filter((change: ProposedTaskChange) => change.action === 'create').length) +
          ' 项，更新 ' + String(this.view.proposal.changes.filter((change: ProposedTaskChange) => change.action === 'update').length) + ' 项。')
          .fontSize(12).fontColor('#617589')
        ForEach(this.view.proposal.changes, (change: ProposedTaskChange) => {
          Column({ space: 6 }) {
            Text((change.action === 'create' ? '新增 · ' : '更新 · ') + change.draft.title)
              .fontSize(16).fontWeight(FontWeight.Medium).fontColor('#142C43')
            Text('课程：' + (change.draft.course === null ? '待补充' : change.draft.course)).fontSize(12).fontColor('#617589')
            if (change.before !== null) {
              Text('原任务：' + change.before.title + '；课程：' + (change.before.course === null ? '未知' : change.before.course))
                .fontSize(12).fontColor('#8A5A12')
              Text('原截止：' + this.deadline(change.before)).fontSize(12).fontColor('#8A5A12')
              Text('原渠道：' + (change.before.submissionChannel === null ? '未知' : change.before.submissionChannel) +
                '；原状态：' + this.statusLabel(change.before.status)).fontSize(12).fontColor('#8A5A12')
              Text('原' + this.details(change.before)).fontSize(11).fontColor('#8A5A12')
            }
            Text('截止：' + this.deadline(change.draft)).fontSize(13).fontColor('#142C43')
            Text('提交渠道：' + (change.draft.submissionChannel === null ? '未知' : change.draft.submissionChannel))
              .fontSize(12).fontColor('#617589')
            Text('任务状态：' + this.statusLabel(change.draft.status) + '（用户声明，不代表平台已收到）').fontSize(11).fontColor('#617589')
            Text(this.details(change.draft)).fontSize(11).fontColor('#617589')
            if (change.action === 'update') { Text('已有材料要求保留；下列仅列本次新增材料。').fontSize(11).fontColor('#617589') }
            if (this.view.proposal !== null && this.view.proposal.checklistItems !== undefined) {
              ForEach(this.view.proposal.checklistItems.filter((item: ChecklistItem) => item.taskId === change.taskId), (item: ChecklistItem) => {
                Text('• ' + item.label + ' · ' + (item.sourceNoticeId === null ? '未绑定通知来源' : '通知提取待核对') + ' · 待准备')
                  .fontSize(12).fontColor('#617589')
              }, (item: ChecklistItem) => item.id)
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(10).backgroundColor('#F3F7F5').borderRadius(9)
        }, (change: ProposedTaskChange) => change.taskId + ':' + (this.view.proposal === null ? '' : this.view.proposal.id))
        Button(this.sourcesOpen ? '收起原文' : '查看本次来源原文（' + String(this.view.sources.length) + '段）')
          .id('task-agent-sources').fontSize(12).onClick(() => { this.sourcesOpen = !this.sourcesOpen; })
        if (this.sourcesOpen) {
          ForEach(this.view.sources, (source: Notice) => {
            Column({ space: 5 }) {
              Text(source.sourceLabel === null ? '来源未知' : source.sourceLabel).fontSize(12).fontColor('#176766')
              Text(source.rawText).fontSize(13).fontColor('#142C43').copyOption(CopyOptions.InApp)
              Text('发布时间：' + (source.publishedAt === null ? '未知' : source.publishedAt) + '；导入时间：' + source.importedAt)
                .fontSize(10).fontColor('#617589')
            }.width('100%').alignItems(HorizontalAlign.Start).padding(9).backgroundColor('#F2F6F7').borderRadius(8)
          }, (source: Notice) => source.id)
        }
        Text('核对任务、截止、材料及原文后确认。若要修改，可直接在下方继续说。').fontSize(12).fontColor('#617589')
        Row({ space: 10 }) {
          Button('取消方案').id('task-agent-cancel-proposal').fontSize(13).layoutWeight(1)
            .enabled(this.idle() && !this.view.recoveryRequired).onClick(() => { this.controller?.cancelProposal(); })
          Button('确认并保存').id('task-agent-confirm').fontSize(13).layoutWeight(1).backgroundColor('#176766')
            .enabled(this.idle() && !this.view.recoveryRequired).onClick(() => { this.controller?.confirm(); })
        }.width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor('#FFFFFF').borderRadius(12)
    }
  }
  @Builder
  receiptCard() {
    if (this.view.receipt !== null) {
      Column({ space: 7 }) {
        Text('最近本机保存结果').fontSize(15).fontWeight(FontWeight.Bold).fontColor('#176766')
        ForEach(this.view.receipt.tasks, (task: Task) => {
          Text(task.title + ' · ' + this.deadline(task)).id('task-agent-saved-' + task.id).fontSize(13).fontColor('#142C43')
        }, (task: Task) => task.id + ':' + String(task.version))
        ForEach(this.view.savedDetails, (detail: TaskDetail) => {
          Column({ space: 4 }) {
            Text('当前材料 · ' + detail.task.title).fontSize(12).fontColor('#176766')
            ForEach(detail.checklistItems, (item: ChecklistItem) => {
              Text(item.label + ' · ' + (item.state === 'pending' ? '待准备' : item.state)).fontSize(12).fontColor('#617589')
            }, (item: ChecklistItem) => item.id + ':' + item.state)
            if (detail.checklistItems.length === 0) { Text('尚未记录材料要求。').fontSize(11).fontColor('#617589') }
          }.width('100%').alignItems(HorizontalAlign.Start)
        }, (detail: TaskDetail) => detail.task.id + ':' + String(detail.revision))
        if (this.view.detailsPending) {
          Text('任务已保存，当前材料详情暂未读全，请重新读取；不要重复保存。').fontSize(12).fontColor('#8A5A12')
        }
        Text('回执版本：' + String(this.view.receipt.committedRevision) + '；不代表学校平台已收到作业。').fontSize(11).fontColor('#617589')
        Text('任务保存在本机；此页尚未接入系统到期提醒。').fontSize(11).fontColor('#617589')
      }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#EAF4F0').borderRadius(11)
    }
  }
  @Builder
  voiceControls() {
    if (this.view.speechEnabled) {
      Column({ space: 5 }) {
        Row({ space: 6 }) {
          Button('开始录音').id('task-agent-record').fontSize(11)
            .enabled(this.idle() && !this.view.historyPending && !this.view.recoveryRequired)
            .onClick(() => { this.controller?.record(); })
          Button('结束录音').id('task-agent-finish').fontSize(11)
            .enabled(this.view.speech.phase === 'recording').onClick(() => { this.controller?.finishRecording(); })
          Button('停止语音').id('task-agent-stop-voice').fontSize(11)
            .enabled(this.view.speech.busy).onClick(() => { this.controller?.cancelVoice(); })
        }
        Row({ space: 7 }) {
          Button('播报待确认方案').id('task-agent-speak').fontSize(11)
            .enabled(this.idle() && this.view.proposal !== null && !this.view.recoveryRequired)
            .onClick(() => { this.controller?.speakProposal(); })
          Text(this.view.speech.errorCode.length > 0 ? this.view.speech.errorCode :
            this.view.speech.busy ? this.view.speech.message : '停顿后可能自动结束，核对后再发送').fontSize(11).fontColor('#617589').layoutWeight(1)
        }
        if (this.view.speech.partial.length > 0 && this.view.speech.busy) {
          Text(this.view.speech.partial).fontSize(11).fontColor('#617589').maxLines(2)
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
  build() {
    Column() {
      this.header()
      if (this.prompt.length > 0) {
        Column({ space: 14 }) {
          Text(this.prompt === 'fresh' ? '开始新的任务对话？' : '离开当前页面？').fontSize(20).fontColor('#142C43')
          Text(this.prompt === 'fresh' ? '旧对话保留；未确认方案会取消，当前未发送输入会清空。' :
            '已写入的对话和待确认方案保留，当前未发送输入离页后可能丢失。').fontSize(13).fontColor('#617589')
          Button('继续编辑').id('task-agent-keep').onClick(() => { this.prompt = ''; })
          Button(this.prompt === 'fresh' ? '确认新建' : '确认离开').id('task-agent-leave').enabled(this.idle())
            .onClick(() => {
              const action: string = this.prompt; this.prompt = '';
              if (action === 'fresh') this.controller?.fresh(); else { taskAgentOwner.pause(); router.back(); }
            })
        }.layoutWeight(1).width('100%').padding(20)
      } else {
        Scroll(this.scroller) {
          Column({ space: 12 }) {
            if (this.view.notice.length > 0) { Text(this.view.notice).id('task-agent-notice').fontSize(13).fontColor('#617589') }
            if (!this.view.configured) { Text('请先返回主页填写团队网关设置，再进入任务助手。').fontSize(13).fontColor('#8A5A12') }
            if (this.view.messages.length === 0) { Text('把一段通知直接发进来；缺信息时我会追问，也可以查询已保存任务。').fontSize(15).fontColor('#617589') }
            ForEach(this.view.messages.slice(-30), (row: ChatMessage) => {
              Column({ space: 4 }) {
                Text(row.role === 'user' ? '我' : '助手').fontSize(11).fontColor('#176766')
                Text(row.text).fontSize(14).fontColor('#142C43').lineHeight(21).copyOption(CopyOptions.InApp)
                if (row.phase !== 'done') { Text(row.phase === 'pending' ? '处理中' : '本轮未完成，可手动重试').fontSize(10).fontColor('#8A5A12') }
              }.width('100%').alignItems(HorizontalAlign.Start).padding(12)
                .backgroundColor(row.role === 'user' ? '#E6F1EC' : '#FFFFFF').borderRadius(11)
            }, (row: ChatMessage) => row.id + ':' + row.phase)
            if (this.view.toolActions.length > 0) { Text(this.view.toolActions.map((action: string) => this.actionLabel(action)).join(' → ')).fontSize(11).fontColor('#617589') }
            this.proposalCard()
            this.receiptCard()
            if (this.view.historyPending) {
              Button('重试保存对话记录').id('task-agent-retry-history').enabled(this.idle()).onClick(() => { this.controller?.retryHistory(); })
            }
            Button('重新读取方案和保存结果').id('task-agent-recover').fontSize(12).enabled(this.idle()).onClick(() => { this.controller?.recover(); })
          }.width('100%').padding(14)
        }.layoutWeight(1).width('100%')
        Column({ space: 7 }) {
          this.voiceControls()
          if (this.view.proposal !== null) { Text('发送补充会取消当前未保存方案并重新整理，仍需再次确认保存。').fontSize(11).fontColor('#8A5A12') }
          TextArea({ text: this.view.input, placeholder: '贴通知，或继续说“截止改为12月5日”…' })
            .id('task-agent-input').height(88).maxLength(4000).enabled(this.view.phase === 'idle' && !this.view.historyPending && !this.view.recoveryRequired)
            .onChange((text: string) => { this.controller?.edit(text); })
          Button('发送').id('task-agent-send').width('100%').height(42).backgroundColor('#176766')
            .enabled(this.idle() && this.view.configured && !this.view.historyPending && !this.view.recoveryRequired && this.view.input.trim().length > 0)
            .onClick(() => { this.controller?.send(); })
        }.width('100%').padding(12).backgroundColor('#FFFFFF')
      }
    }.width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
