import { AvailabilityEditor } from '../ui/AvailabilityEditor';
import { openAppTab, prepareTabBack, appTabArrived } from '../ui/TabNavigation';
import { displayPreferences } from '../ui/UiPreferencesOwner';
import { AppTheme } from '../ui/AppTheme';
import { AppTabBar } from '../ui/AppTabBar';
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { getClientStorage } from '../data/ClientStorage';
import { PlanningController, PlanningView } from '../planning/PlanningController';
import { PlanningIntent } from '../planning/PlanningContracts';
import { AvailabilityBlock, PlanBlock, UnscheduledWork } from '../planning/WeekPlanner';
import { parseAvailability, planningTimestamp, planningTimeLabel } from '../planning/PlanningForm';
import { StorageFailure } from '../data/storage/StorageTypes';

@Entry
@Component
struct Schedule {
  @StorageLink('largeSimpleMode') largeSimpleMode: boolean = false;
  @StorageLink('tabTravelDirection') tabTravelDirection: number = 1;
  @State view: PlanningView = new PlanningView();
  @State availabilityText: string = '';
  @State fromText: string = '';
  @State toText: string = '';
  @State localNotice: string = '';
  @State doneBlock: string = '';
  @State remainingText: string = '';
  @State formOpen: boolean = false;
  @State addingAvailability: boolean = false;
  private navigate(page: string): void {
    if (this.onBackPress() || this.view.pending !== null || this.view.recoveryRequired) { this.localNotice = '请先处理当前安排草案或未保存输入。'; return; }
    openAppTab('pages/Schedule', page).catch(() => { this.localNotice = '暂时无法打开页面。'; });
  }
  private originalAvailability: string = '';
  private controller: PlanningController | null = null;
  onPageShow(): void { appTabArrived('pages/Schedule'); }
  aboutToAppear(): void {
    const uiContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    displayPreferences(uiContext.filesDir).restore();
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const storage = getClientStorage(context.filesDir);
    this.controller = new PlanningController(storage.local, storage.commits);
    const start = Math.ceil((Date.now() + 300000) / 60000) * 60000;
    this.fromText = planningTimeLabel(new Date(start).toISOString());
    this.toText = planningTimeLabel(new Date(start + 7 * 86400000).toISOString());
    this.controller.subscribe((view: PlanningView) => { this.view = view; });
    this.reload();
  }
  aboutToDisappear(): void { this.controller?.dispose(); this.controller = null; }
  private dirty(): boolean { return this.view.pending === null && (this.availabilityText !== this.originalAvailability || this.doneBlock.length > 0); }
  onBackPress(): boolean {
    if (this.view.busy) return true;
    if (this.addingAvailability) { this.addingAvailability = false; return true; }
    if (this.dirty()) { this.localNotice = '还有未核对的可用时间或完成声明，请先核对或放弃本页输入。'; return true; }
    prepareTabBack('pages/Schedule'); return false;
  }
  private editable(): boolean { return this.view.loaded && !this.view.busy && !this.view.recoveryRequired && this.view.pending === null; }
  private syncForm(): void {
    this.originalAvailability = this.view.availability.map(row => planningTimeLabel(row.startAt) + ' ~ ' + planningTimeLabel(row.endAt)).join('\n');
    this.availabilityText = this.originalAvailability; this.doneBlock = ''; this.remainingText = '';
  }
  private async reload(): Promise<void> {
    if (this.dirty()) { this.localNotice = '刷新前请先核对或放弃本页输入。'; return; }
    await this.controller?.recover();
    if (this.view.loaded) this.syncForm();
  }
  private title(id: string): string {
    const task = this.view.tasks.find(item => item.id === id);
    if (task === undefined) return '来源任务需重新核对';
    const duplicate = this.view.tasks.filter(item => item.title === task.title && item.course === task.course).length > 1;
    return task.title + ' · ' + (task.course || '课程未提供') + (duplicate ? ' · 记录' + id.slice(-6) : '');
  }
  private availableLines(rows: AvailabilityBlock[]): string {
    return rows.length === 0 ? '没有可用区间' : rows.map(row => planningTimeLabel(row.startAt) + ' ~ ' + planningTimeLabel(row.endAt)).join('\n');
  }
  private blockLines(rows: PlanBlock[]): string {
    return rows.length === 0 ? '没有工作块' : rows.map(row => this.title(row.taskId) + '\n' + planningTimeLabel(row.startAt) + ' ~ ' + planningTimeLabel(row.endAt) +
      (row.state === 'done' ? ' · 已完成' : row.locked ? ' · 已锁定' : ' · 待完成')).join('\n\n');
  }
  private gapText(row: UnscheduledWork): string {
    const reason = row.reason === 'remaining_effort_unknown' ? '需填写剩余工时' : row.reason === 'exact_deadline_required' ? '需补充确切截止时刻' :
      row.reason === 'deadline_passed' ? '截止已过' : row.reason === 'resolve_retained_conflicts_first' ? '请先处理保留块冲突' : '截止前可用时间不足';
    return this.title(row.taskId) + '：' + reason + (row.minutes === null ? '' : '，未安排' + String(row.minutes) + '分钟');
  }
  private error(error: Error): void { this.localNotice = error instanceof StorageFailure ? error.message : '输入未处理，请核对后重试。'; }
  private async stageAvailability(): Promise<void> {
    if (this.doneBlock.length > 0) { this.localNotice = '请先处理当前完成声明，或放弃本页输入。'; return; }
    try {
      const intent = new PlanningIntent(); intent.availability = parseAvailability(this.availabilityText);
      this.localNotice = ''; await this.controller?.stage(intent);
    } catch (error) { this.error(error as Error); }
  }
  private readyForBlock(): boolean {
    if (this.availabilityText !== this.originalAvailability || this.doneBlock.length > 0) { this.localNotice = '先核对保存可用时间或完成声明，再生成或修改工作块。'; return false; }
    this.localNotice = ''; return true;
  }
  private async replan(): Promise<void> {
    if (!this.readyForBlock()) return;
    try {
      const intent = new PlanningIntent(); intent.action = 'replan'; intent.fromAt = planningTimestamp(this.fromText); intent.toAt = planningTimestamp(this.toText);
      await this.controller?.stage(intent);
    } catch (error) { this.error(error as Error); }
  }
  private lock(block: PlanBlock): void {
    if (!this.readyForBlock()) return;
    const intent = new PlanningIntent(); intent.action = 'lock'; intent.blockId = block.id; intent.locked = !block.locked; this.controller?.stage(intent);
  }
  private async finishBlock(): Promise<void> {
    if (!/^\d+$/.test(this.remainingText.trim()) || !Number.isSafeInteger(Number(this.remainingText))) { this.localNotice = '请明确填写该任务目前还需多少分钟，0表示没有剩余工作；不会按块时长自动扣减。'; return; }
    const intent = new PlanningIntent(); intent.action = 'done'; intent.blockId = this.doneBlock; intent.remainingMinutes = Number(this.remainingText);
    this.localNotice = ''; await this.controller?.stage(intent);
  }
  private async confirm(): Promise<void> { if (await this.controller?.confirm()) { this.syncForm(); this.localNotice = ''; } }
  private async cancel(): Promise<void> { await this.controller?.cancel(); if (this.view.pending === null && this.view.loaded) { this.syncForm(); this.localNotice = ''; } }
  @Builder
  preview() {
    if (this.view.pending?.planning !== undefined) {
      Column({ space: 8 }) {
        Text('本次安排尚未保存').fontSize(AppTheme.font(18, this.largeSimpleMode)).fontWeight(FontWeight.Bold)
        if (this.view.pending.planning.intent.action === 'done') {
          Text('该任务剩余工时明确设为 ' + String(this.view.pending.planning.intent.remainingMinutes) + ' 分钟；不会自动标记任务提交或完成。').id('plan-preview-effort').fontSize(AppTheme.font(12, this.largeSimpleMode))
        }
        Scroll() {
          Column({ space: 8 }) {
            Text(this.view.pending.planning.intent.action === 'availability' ? '修改可用时间' : this.view.pending.planning.intent.action === 'replan' ? '生成工作安排' : this.view.pending.planning.intent.action === 'lock' ? '修改工作块锁定' : '记录工作块完成').fontSize(AppTheme.font(12, this.largeSimpleMode))
            Text('原可用时间\n' + this.availableLines(this.view.pending.planning.beforeAvailability)).fontSize(AppTheme.font(12, this.largeSimpleMode))
            Text('新可用时间\n' + this.availableLines(this.view.pending.planning.afterAvailability)).fontSize(AppTheme.font(12, this.largeSimpleMode))
            Text('原安排\n' + this.blockLines(this.view.pending.planning.beforeBlocks)).fontSize(AppTheme.font(12, this.largeSimpleMode))
            Text('新安排\n' + this.blockLines(this.view.pending.planning.afterBlocks)).id('plan-preview-blocks').fontSize(AppTheme.font(12, this.largeSimpleMode))
            ForEach(this.view.pending.planning.candidate?.unscheduled || [], (row: UnscheduledWork) => { Text(this.gapText(row)).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber) }, (row: UnscheduledWork) => row.taskId)
            Text('只保存此处列出的安排，缺口不会自动消失；任务截止不变。').fontSize(AppTheme.font(12, this.largeSimpleMode))
          }.alignItems(HorizontalAlign.Start).width('100%')
        }.height(230).width('100%')
        Flex({ wrap: FlexWrap.Wrap }) {
          Button('放弃本方案').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0, maxWidth: '100%' }).margin({ right: 6, bottom: 6 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-cancel').enabled(!this.view.busy && !this.view.recoveryRequired).onClick(() => { this.cancel(); })
          Button('确认保存安排').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0, maxWidth: '100%' }).margin({ right: 6, bottom: 6 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-confirm').backgroundColor(AppTheme.primary).fontColor(AppTheme.onPrimary).fontColor('#FFFFFF').enabled(!this.view.busy && !this.view.recoveryRequired).onClick(() => { this.confirm(); })
        }
      }.padding(12).backgroundColor('#E8F3F0').borderRadius(12).width('100%')
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
    Column({ space: 8 }) {
      Row({ space: 10 }) {
        Button('返回').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-back').fontSize(AppTheme.font(12, this.largeSimpleMode)).enabled(!this.view.busy).onClick(() => { if (!this.onBackPress()) router.back(); })
        Text('工作安排').fontSize(AppTheme.font(22, this.largeSimpleMode)).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('重新读取').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-refresh').fontSize(AppTheme.font(12, this.largeSimpleMode)).enabled(!this.view.busy).onClick(() => { this.reload(); })
      }.padding(12).width('100%')
      if (this.view.pending !== null || this.view.errorCode.length > 0 || this.view.receipt !== null) { Text(this.view.notice).id('plan-notice').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.primary) }
      if (this.view.errorCode.length > 0) { Text('问题编号：' + this.view.errorCode).fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.amber) }
      if (this.localNotice.length > 0) { Text(this.localNotice).id('plan-local-notice').fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber) }
      this.preview()
      Scroll() {
        Column({ space: 12 }) {
          if (!this.largeSimpleMode) { Text('按已知工时、确切截止和你提供的可用时间生成最多七天安排。所有时间均为北京时间。').fontSize(AppTheme.font(13, this.largeSimpleMode)) }
          Text('我的可用时间').fontSize(AppTheme.font(18, this.largeSimpleMode)).fontWeight(FontWeight.Medium)
          Text(this.availabilityText.length > 0 ? this.availabilityText : '先告诉我你什么时候有空。').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted).width('100%').padding(16).backgroundColor(AppTheme.surface).borderRadius(16)
          if (this.addingAvailability) {
            AvailabilityEditor({ onAdd: (line: string): void => {
              this.availabilityText = this.availabilityText.length > 0 ? this.availabilityText + '\n' + line : line; this.addingAvailability = false;
            }, onCancel: (): void => { this.addingAvailability = false; } })
          } else {
            Button('添加可用时间').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-add-availability').height(this.largeSimpleMode ? 56 : 42).width('100%').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).enabled(this.editable()).onClick(() => { this.addingAvailability = true; })
          }
          if (this.availabilityText !== this.originalAvailability) {
            Button('核对保存可用时间').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-availability-stage').height(this.largeSimpleMode ? 56 : 44).width('100%').backgroundColor(AppTheme.primary).fontColor(AppTheme.onPrimary).enabled(this.editable()).onClick(() => { this.stageAvailability(); })
          }
          Button('生成七日安排').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-quick-replan').height(this.largeSimpleMode ? 56 : 46).width('100%').backgroundColor(AppTheme.primary).fontColor(AppTheme.onPrimary).enabled(this.editable()).onClick(() => { this.replan(); })
          Button(this.formOpen ? '收起安排设置' : '设置可用时间与安排范围').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-edit-settings').width('100%').height(this.largeSimpleMode ? 56 : 46).fontSize(AppTheme.font(14, this.largeSimpleMode)).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.formOpen = !this.formOpen; })
          if (this.formOpen) {
          Text('我的可用时间').fontSize(AppTheme.font(18, this.largeSimpleMode)).fontWeight(FontWeight.Medium)
          Text('每行：2026-12-01 19:00 ~ 2026-12-01 21:00\n留空表示清空，仍需核对并确认。').fontSize(AppTheme.font(12, this.largeSimpleMode))
          TextArea({ text: this.availabilityText, placeholder: '填写完整起止时间，每行一个区间' }).fontSize(AppTheme.font(16, this.largeSimpleMode)).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14).id('plan-availability-input').height(110).maxLength(20000)
            .enabled(this.editable()).onChange((text: string) => { this.availabilityText = text; })
          if (this.dirty()) { Button('放弃本页输入').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-discard-input').enabled(!this.view.busy).onClick(() => { this.syncForm(); this.localNotice = ''; }) }
          Text('安排范围（不超过七天）').fontSize(AppTheme.font(16, this.largeSimpleMode))
          TextInput({ text: this.fromText, placeholder: '起点 YYYY-MM-DD HH:mm' }).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14).id('plan-from').enabled(this.editable()).onChange((text: string) => { this.fromText = text; }).fontSize(AppTheme.font(16, this.largeSimpleMode))
          TextInput({ text: this.toText, placeholder: '终点 YYYY-MM-DD HH:mm' }).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14).id('plan-to').enabled(this.editable()).onChange((text: string) => { this.toText = text; }).fontSize(AppTheme.font(16, this.largeSimpleMode))
          Button('生成安排候选').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-replan').enabled(this.editable()).onClick(() => { this.replan(); })
          }
          Text('已保存工作块（' + String(this.view.blocks.length) + '）').id('plan-saved-count').fontSize(AppTheme.font(18, this.largeSimpleMode))
          if (this.view.blocks.length === 0) { Text('还没有安排\n先设置可用时间，再为任务生成工作块。').fontSize(AppTheme.font(15, this.largeSimpleMode)).fontColor(AppTheme.muted).padding(24) }
          ForEach(this.view.blocks, (block: PlanBlock) => {
            Column({ space: 6 }) {
              Text(this.title(block.taskId)).fontSize(AppTheme.font(14, this.largeSimpleMode))
              Text(planningTimeLabel(block.startAt) + ' ~ ' + planningTimeLabel(block.endAt)).fontSize(AppTheme.font(12, this.largeSimpleMode))
              Text(block.state === 'done' ? '已完成' : block.locked ? '待完成 · 已锁定' : '待完成').fontSize(AppTheme.font(12, this.largeSimpleMode))
              if (block.state === 'pending') {
                Flex({ wrap: FlexWrap.Wrap }) {
                  Button(block.locked ? '核对解除锁定' : '核对锁定').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0, maxWidth: '100%' }).margin({ right: 6, bottom: 6 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-lock-' + block.id).fontSize(AppTheme.font(11, this.largeSimpleMode)).enabled(this.editable()).onClick(() => { this.lock(block); })
                  Button('记录完成').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0, maxWidth: '100%' }).margin({ right: 6, bottom: 6 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-done-' + block.id).fontSize(AppTheme.font(11, this.largeSimpleMode)).enabled(this.editable()).onClick(() => {
                    if (this.readyForBlock()) { this.doneBlock = block.id; this.remainingText = ''; }
                  })
                }
              }
            }.padding(10).width('100%').alignItems(HorizontalAlign.Start).backgroundColor(AppTheme.surface).borderRadius(10)
          }, (block: PlanBlock) => block.id + ':' + String(block.planRevision))
          if (this.doneBlock.length > 0 && this.view.pending === null) {
            Text('完成此块后，该任务目前还需多少分钟？0也须明确填写。不会自动扣工时或声明提交。').fontSize(AppTheme.font(13, this.largeSimpleMode))
            TextInput({ text: this.remainingText, placeholder: '当前剩余分钟' }).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14).id('plan-remaining').type(InputType.Number).maxLength(9).enabled(this.editable()).onChange((text: string) => { this.remainingText = text; }).fontSize(AppTheme.font(16, this.largeSimpleMode))
            Button('核对完成与剩余工时').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('plan-done-stage').enabled(this.editable()).onClick(() => { this.finishBlock(); })
          }
          if (this.view.receipt?.planning !== undefined) {
            Text('上次确认时的未安排项（后续任务变化后须重新生成核对）').fontSize(AppTheme.font(14, this.largeSimpleMode))
            ForEach(this.view.receipt.planning.unscheduled, (row: UnscheduledWork) => { Text(this.gapText(row)).fontSize(AppTheme.font(12, this.largeSimpleMode)).fontColor(AppTheme.amber) }, (row: UnscheduledWork) => row.taskId)
          }
        }.padding(16).width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%')
      AppTabBar({ active: 'schedule', enabledTabs: !this.view.busy, onSelect: (page: string): void => { this.navigate(page); } })
    }.width('100%').height('100%').backgroundColor(AppTheme.canvas)
  }
}
