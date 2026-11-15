import common from '@ohos.app.ability.common';
import router from '@ohos.router';
import { ArkNoticeExtractionTransport } from '../adapters/ArkNoticeExtractionTransport';
import { chatOwner } from '../chat/ChatOwner';
import { getClientStorage } from '../data/ClientStorage';
import { NoticeImportState } from '../notice/NoticeImportController';
import { NoticeConfirmedWriter } from '../notice/NoticeConfirmedWriter';
import { NoticeSaveController, NoticeSaveView } from '../notice/NoticeSaveController';
import { noticeImportOwner } from '../notice/NoticeImportOwner';
import { ChecklistItem } from '../domain/StorageModels';
import { NoticeLeaveGuard, NoticeLeavePrompt } from '../notice/NoticeLeaveGuard';

@Entry
@Component
struct NoticeImportPage {
  @State view: NoticeImportState = new NoticeImportState();
  @State initializing: boolean = true;
  @State initializationError: string = '';
  @State save: NoticeSaveView = new NoticeSaveView();
  @State metadataOpen: boolean = false;
  @State leave: NoticeLeavePrompt = new NoticeLeavePrompt();
  private leaveGuard: NoticeLeaveGuard = new NoticeLeaveGuard();
  private controller: NoticeSaveController | null = null;
  private pageAlive: boolean = false;
  private initializationVersion: number = 0;

  aboutToAppear(): void {
    this.pageAlive = true;
    this.initialize();
  }

  onPageHide(): void {
    if (this.controller !== null) this.controller.pause();
  }

  aboutToDisappear(): void {
    this.pageAlive = false;
    this.initializationVersion++;
    if (this.controller !== null) {
      this.controller.pause();
      noticeImportOwner.release(this.controller);
      this.controller = null;
    }
  }

  onBackPress(): boolean {
    return this.interceptBack();
  }

  private speechNeedsAttention(): boolean {
    if (this.controller === null) return false;
    const speech = this.controller.speechSnapshot();
    return speech.busy || speech.partial.trim().length > 0;
  }

  private interceptBack(): boolean {
    const decision: string = this.leaveGuard.request(this.view, this.save.busy, this.save.locked, this.speechNeedsAttention());
    if (decision === 'prompt') {
      this.controller?.cancelVoice();
      this.leave = this.leaveGuard.snapshot();
    }
    return decision !== 'leave';
  }

  private goBack(): void {
    if (!this.interceptBack()) { this.controller?.pause(); router.back(); }
  }

  private confirmLeave(): void {
    const decision: string = this.leaveGuard.confirmLeave(this.view, this.save.busy, this.save.locked, this.speechNeedsAttention());
    this.leave = this.leaveGuard.snapshot();
    if (decision === 'leave') { this.controller?.pause(); router.back(); }
  }

  private async initialize(): Promise<void> {
    const version: number = ++this.initializationVersion;
    try {
      const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      if (this.controller !== null) {
        this.controller.configure(chatOwner.get().configuration());
        return;
      }
      const storage = getClientStorage(context.filesDir);
      const revision = await storage.local.read();
      if (!this.pageAlive || version !== this.initializationVersion) return;
      if (!revision.success || revision.data === null) {
        this.initializationError = '无法读取本地数据，尚未开始导入。请检查存储状态后重试。';
        return;
      }
      const controller = new NoticeSaveController(new ArkNoticeExtractionTransport(),
        new NoticeConfirmedWriter(storage.local, storage.commits));
      try { noticeImportOwner.claim(controller); }
      catch (error) { controller.dispose(); throw error as Error; }
      this.controller = controller;
      this.controller.configure(chatOwner.get().configuration());
      this.controller.setExpectedRevision(revision.data.revision);
      this.controller.subscribeSave((state: NoticeSaveView) => { this.save = state; });
      this.controller.subscribe((state: NoticeImportState) => {
        this.view = state;
      });
      await this.controller.restore();
    } catch (error) {
      if (this.pageAlive && version === this.initializationVersion) {
        this.initializationError = '通知导入页初始化失败，请返回后重试。';
      }
    } finally {
      if (this.pageAlive && version === this.initializationVersion) this.initializing = false;
    }
  }

  private busy(): boolean {
    return this.save.busy || ['extracting', 'saving', 'refreshing'].includes(this.view.phase);
  }

  private editable(): boolean {
    return !this.busy() && !this.save.locked && this.view.phase !== 'saved';
  }

  private edit(field: string, value: string): void {
    if (this.controller !== null) this.controller.edit(field, value);
  }

  @Builder
  header() {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        Button('返回')
          .id('notice-back')
          .fontSize(13).fontColor('#176766').backgroundColor('#E1F0EC')
          .enabled(!this.save.busy && this.view.phase !== 'saving')
          .onClick(() => this.goBack())
        Column({ space: 3 }) {
          Text('导入校园通知').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#142C43')
          Text('先整理为草案，确认后才写入任务').fontSize(12).fontColor('#617589')
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Text(this.view.phase === 'saved' ? '已保存' : (this.view.draft === null ? '未提取' : '草案'))
          .fontSize(11).fontColor(this.view.phase === 'saved' ? '#FFFFFF' : '#176766')
          .backgroundColor(this.view.phase === 'saved' ? '#176766' : '#E1F0EC')
          .padding({ left: 8, right: 8, top: 4, bottom: 4 }).borderRadius(6)
      }.width('100%')
      Text('通知原文会原样保留；模型提取出的标题、日期和材料均可修改。')
        .fontSize(12).fontColor('#617589').lineHeight(18)
    }.width('100%').padding({ left: 18, right: 18, top: 16, bottom: 12 })
  }

  @Builder
  leaveConfirmation() {
    Column({ space: 14 }) {
      Text(this.leave.title).id('notice-leave-title').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#142C43')
      Text(this.leave.detail).fontSize(14).fontColor('#617589').lineHeight(23)
      Button('继续编辑').id('notice-leave-keep').width('100%').height(44).backgroundColor('#176766')
        .onClick(() => { this.leaveGuard.keepEditing(); this.leave = this.leaveGuard.snapshot(); })
      Button(this.leave.action).id('notice-leave-confirm').width('100%').height(44)
        .fontColor('#617589').backgroundColor('#EDF1F2')
        .enabled(!this.save.busy && this.view.phase !== 'saving')
        .onClick(() => this.confirmLeave())
    }.width('100%').padding(22).alignItems(HorizontalAlign.Start).backgroundColor('#F8FBFA')
      .layoutWeight(1)
  }

  @Builder
  sourceEditor() {
    Column({ space: 10 }) {
      Text('通知原文').fontSize(14).fontWeight(FontWeight.Medium).fontColor('#142C43')
      TextArea({ text: this.view.rawText, placeholder: '粘贴需要整理的通知…' })
        .id('notice-raw-text').height(150).fontSize(15).fontColor('#142C43')
        .backgroundColor('#FFFFFF').borderRadius(12).maxLength(10000)
        .enabled(!this.busy() && this.view.phase !== 'saved')
        .onChange((value: string) => {
          if (this.controller !== null) this.controller.setRawText(value);
        })
      Row() {
        Text(String(this.view.rawText.length) + '/10000').fontSize(11).fontColor('#617589').layoutWeight(1)
        if (this.view.phase === 'saved') {
          Text('本次导入已完成').fontSize(11).fontColor('#176766')
        }
      }.width('100%')
      Button(this.metadataOpen ? '收起来源信息' : '补充来源信息（可选）')
        .fontSize(12).height(30).fontColor('#617589').backgroundColor('#EDF4F2')
        .onClick(() => { this.metadataOpen = !this.metadataOpen; })
      if (this.metadataOpen) {
      TextInput({ text: this.view.sourceLabel, placeholder: '来源标签（可选），如“数据库课程群”' })
        .id('notice-source').fontSize(14).fontColor('#142C43').backgroundColor('#FFFFFF')
        .maxLength(200).enabled(!this.busy() && this.view.phase !== 'saved')
        .onChange((value: string) => {
          if (this.controller !== null) this.controller.setSourceLabel(value);
        })
      TextInput({ text: this.view.publishedAt, placeholder: '发布时间（可选），如 2026-11-01T09:00:00+08:00' })
        .id('notice-published-at').fontSize(13).fontColor('#142C43').backgroundColor('#FFFFFF')
        .maxLength(40).enabled(!this.busy() && this.view.phase !== 'saved')
        .onChange((value: string) => {
          if (this.controller !== null) this.controller.setPublishedAt(value);
        })
      }
      Button(this.view.phase === 'extracting' ? '正在理解…' :
        (this.view.draft === null ? '发送通知原文' : '保留修改并继续整理'))
        .id('notice-extract').width('100%').height(45).backgroundColor('#176766')
        .enabled(!this.busy() && this.view.rawText.trim().length > 0 && this.view.phase !== 'saved')
        .onClick(() => {
          if (this.controller !== null) this.controller.extract();
        })
    }.alignItems(HorizontalAlign.Start).width('100%').padding(16).backgroundColor('#F8FBFA').borderRadius(14)
      .enabled(this.editable())
  }

  @Builder
  kindChoices() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
      Button('作业').fontSize(12).height(31)
        .backgroundColor(this.view.kind === 'assignment' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.kind === 'assignment' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('kind', 'assignment'))
      Button('报告').fontSize(12).height(31)
        .backgroundColor(this.view.kind === 'report' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.kind === 'report' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('kind', 'report'))
      Button('报名').fontSize(12).height(31)
        .backgroundColor(this.view.kind === 'registration' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.kind === 'registration' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('kind', 'registration'))
      Button('其他').fontSize(12).height(31)
        .backgroundColor(this.view.kind === 'other' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.kind === 'other' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('kind', 'other'))
      Button('未分类').fontSize(12).height(31)
        .backgroundColor(this.view.kind.length === 0 ? '#176766' : '#EDF4F2')
        .fontColor(this.view.kind.length === 0 ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('kind', ''))
    }.width('100%').margin({ top: 5, bottom: 8 })
  }

  @Builder
  precisionChoices() {
    Row({ space: 7 }) {
      Button('待补充').fontSize(12).height(32).layoutWeight(1)
        .backgroundColor(this.view.deadlinePrecision === 'unknown' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.deadlinePrecision === 'unknown' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('precision', 'unknown'))
      Button('仅日期').fontSize(12).height(32).layoutWeight(1)
        .backgroundColor(this.view.deadlinePrecision === 'date_only' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.deadlinePrecision === 'date_only' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('precision', 'date_only'))
      Button('精确时刻').fontSize(12).height(32).layoutWeight(1)
        .backgroundColor(this.view.deadlinePrecision === 'exact' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.deadlinePrecision === 'exact' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('precision', 'exact'))
    }.width('100%').margin({ top: 5, bottom: 8 })
  }

  @Builder
  priorityChoices() {
    Row({ space: 7 }) {
      Button('未设置').fontSize(12).height(31).layoutWeight(1)
        .backgroundColor(this.view.priority.length === 0 ? '#176766' : '#EDF4F2')
        .fontColor(this.view.priority.length === 0 ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('priority', ''))
      Button('低').fontSize(12).height(31).layoutWeight(1)
        .backgroundColor(this.view.priority === 'low' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.priority === 'low' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('priority', 'low'))
      Button('普通').fontSize(12).height(31).layoutWeight(1)
        .backgroundColor(this.view.priority === 'normal' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.priority === 'normal' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('priority', 'normal'))
      Button('高').fontSize(12).height(31).layoutWeight(1)
        .backgroundColor(this.view.priority === 'high' ? '#176766' : '#EDF4F2')
        .fontColor(this.view.priority === 'high' ? '#FFFFFF' : '#176766')
        .onClick(() => this.edit('priority', 'high'))
    }.width('100%').margin({ top: 5, bottom: 8 })
  }

  @Builder
  draftCard() {
    Column({ space: 10 }) {
      Row() {
        Column({ space: 2 }) {
          Text('待确认草案').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#142C43')
          Text('确认后任务、来源和材料一起保存；失败可重试').fontSize(11).fontColor('#617589')
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Text('尚未保存').fontSize(10).fontColor('#8A5A12').backgroundColor('#F7ECD7')
          .padding({ left: 7, right: 7, top: 3, bottom: 3 }).borderRadius(5)
      }.width('100%')

      if (this.view.questions.length > 0) {
        Column({ space: 5 }) {
          Text('需要你核对').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#8A5A12')
          ForEach(this.view.questions, (question: string) => {
            Text('• ' + question).fontSize(12).fontColor('#745A34').lineHeight(18)
          }, (question: string, index: number) => String(index) + question)
          Text('可以直接修改下方字段；未知截止日期可保留为待补充。')
            .fontSize(11).fontColor('#745A34')
        }.alignItems(HorizontalAlign.Start).width('100%').padding(11).backgroundColor('#FBF5E9').borderRadius(9)
      }

      Column({ space: 10 }) {
      Text('任务名称').fontSize(12).fontColor('#617589')
      TextInput({ text: this.view.title, placeholder: '必须填写任务名称' })
        .id('notice-title').fontSize(15).fontColor('#142C43').backgroundColor('#FFFFFF')
        .maxLength(300).onChange((value: string) => this.edit('title', value))

      Row({ space: 9 }) {
        Column({ space: 5 }) {
          Text('课程').fontSize(12).fontColor('#617589')
          TextInput({ text: this.view.course, placeholder: '未知可留空' })
            .fontSize(14).fontColor('#142C43').backgroundColor('#FFFFFF')
            .maxLength(100).onChange((value: string) => this.edit('course', value))
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Column({ space: 5 }) {
          Text('提交渠道').fontSize(12).fontColor('#617589')
          TextInput({ text: this.view.submissionChannel, placeholder: '未知可留空' })
            .fontSize(14).fontColor('#142C43').backgroundColor('#FFFFFF')
            .maxLength(100).onChange((value: string) => this.edit('channel', value))
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      }.width('100%')

      Text('任务分类').fontSize(12).fontColor('#617589')
      this.kindChoices()

      Text('截止日期').fontSize(12).fontColor('#617589')
      this.precisionChoices()
      if (this.view.deadlinePrecision !== 'unknown') {
        Row({ space: 9 }) {
          Column({ space: 5 }) {
            Text('日期').fontSize(11).fontColor('#617589')
            TextInput({ text: this.view.deadlineDate, placeholder: 'YYYY-MM-DD' })
              .fontSize(14).fontColor('#142C43').backgroundColor('#FFFFFF').maxLength(10)
              .onChange((value: string) => this.edit('date', value))
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          if (this.view.deadlinePrecision === 'exact') {
            Column({ space: 5 }) {
              Text('时刻（24 小时）').fontSize(11).fontColor('#617589')
              TextInput({ text: this.view.deadlineTime, placeholder: 'HH:mm' })
                .fontSize(14).fontColor('#142C43').backgroundColor('#FFFFFF').maxLength(5)
                .onChange((value: string) => this.edit('time', value))
            }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          }
        }.width('100%')
        Text('截止时区：' + this.view.timezone + ' · 修改日期或时刻会按此时区重新计算实际截止时刻')
          .fontSize(11).fontColor('#617589').lineHeight(17)
      }

      Text('优先级').fontSize(12).fontColor('#617589')
      this.priorityChoices()
      Text('剩余工时（分钟，未知可留空）').fontSize(12).fontColor('#617589')
      TextInput({ text: this.view.remainingMinutes, placeholder: '例如 120；未知不要填 0' })
        .fontSize(14).fontColor('#142C43').backgroundColor('#FFFFFF').type(InputType.Number).maxLength(8)
        .onChange((value: string) => this.edit('remaining', value))

      Row() {
        Text('材料清单').fontSize(12).fontColor('#617589').layoutWeight(1)
        Button('添加材料').fontSize(11).height(28).fontColor('#176766').backgroundColor('#E1F0EC')
          .onClick(() => {
            if (this.controller !== null) this.controller.addMaterial();
          })
      }.width('100%')
      if (this.view.materials.length === 0) {
        Text('原通知未列出材料，可在确认前自行补充。').fontSize(12).fontColor('#617589')
      }
      ForEach(this.view.materials, (material: string, index: number) => {
        Row({ space: 7 }) {
          TextInput({ text: material, placeholder: '材料名称' })
            .fontSize(14).fontColor('#142C43').backgroundColor('#FFFFFF').layoutWeight(1)
            .maxLength(200).onChange((value: string) => {
              if (this.controller !== null) this.controller.setMaterial(index, value);
            })
          Button('删除').fontSize(11).height(31).fontColor('#A43B32').backgroundColor('#FAECE9')
            .onClick(() => {
              if (this.controller !== null) this.controller.removeMaterial(index);
            })
        }.width('100%')
      }, (material: string, index: number) => String(index) + ':' + material)

      Column({ space: 7 }) {
        Text('原通知（不会被模型摘要覆盖）').fontSize(11).fontWeight(FontWeight.Medium).fontColor('#176766')
        Text(this.view.rawText).fontSize(12).fontColor('#617589').lineHeight(18).copyOption(CopyOptions.InApp)
        Text('来源：' + (this.view.sourceLabel.length > 0 ? this.view.sourceLabel : '未知') +
          ' · 发布时间：' + (this.view.publishedAt.length > 0 ? this.view.publishedAt : '未知'))
          .fontSize(11).fontColor('#617589').lineHeight(17)
      }.alignItems(HorizontalAlign.Start).width('100%').padding(10).backgroundColor('#F2F6F7').borderRadius(8)
      }.alignItems(HorizontalAlign.Start).width('100%').enabled(this.editable())

      Text('确认将新增 1 个任务和 ' + String(this.view.materials.filter((value: string) =>
        value.trim().length > 0).length) + ' 个材料项；不会把材料准备状态当成已提交。')
        .fontSize(11).fontColor('#617589').lineHeight(17)
      Row({ space: 9 }) {
        Button('取消').fontSize(14).height(43).layoutWeight(1).fontColor('#617589').backgroundColor('#EDF1F2')
          .enabled(!this.busy())
          .onClick(() => {
            if (this.controller !== null) this.controller.cancel();
          })
        Button(this.save.locked ? '核对后重试确认' : '确认并正式保存')
          .fontSize(14).height(43).layoutWeight(1).backgroundColor('#176766')
          .id('notice-confirm').enabled(!this.busy() && this.view.phase !== 'saved')
          .onClick(() => {
            if (this.controller !== null) this.controller.confirm();
          })
      }.width('100%')
    }.alignItems(HorizontalAlign.Start).width('100%').padding(15).backgroundColor('#FFFFFF')
    .border({ width: 1, color: '#DCE5DF' }).borderRadius(14)
  }

  @Builder
  commitFeedback() {
    Column({ space: 8 }) {
      if (this.save.message.length > 0) { Text(this.save.message).fontSize(12).fontColor('#8A5A12') }
      if (this.save.readbackError.length > 0) { Text(this.save.readbackError).fontSize(12).fontColor('#A43B32') }
      if (this.save.locked) {
        Button('取消暂存后重新修改').id('notice-discard-pending').enabled(!this.busy())
          .onClick(() => { this.controller?.cancelPending(); })
        Button('重新读取暂存结果').id('notice-recover-pending').enabled(!this.busy())
          .onClick(() => { this.controller?.restore(); })
      }
      if (this.save.saved !== null) {
        Text('最近已保存任务（本机回读）').fontSize(14).fontWeight(FontWeight.Bold).fontColor('#142C43')
        Text(this.save.saved.task.title).id('notice-readback-title').fontSize(14).fontColor('#142C43')
        Text('截止：' + (this.save.saved.task.dueAt === null ?
          (this.save.saved.task.deadlineDate === null ? '待补充' : this.save.saved.task.deadlineDate + '（具体时刻未知）') :
          this.save.saved.task.dueAt)).fontSize(12).fontColor('#617589')
        ForEach(this.save.saved.checklistItems, (item: ChecklistItem) => {
          Text(item.label + ' · ' + (item.sourceNoticeId === null ? '人工补充' : '原通知') +
            ' · ' + (item.state === 'pending' ? '待准备' : '已准备')).fontSize(12).fontColor('#617589')
        }, (item: ChecklistItem) => item.id)
      }
      Button('重新读取已保存结果').id('notice-readback').enabled(!this.busy())
        .onClick(() => { this.controller?.readSaved(); })
    }.alignItems(HorizontalAlign.Start).width('100%').padding(12).backgroundColor('#F2F6F7').borderRadius(10)
  }

  @Builder
  feedback() {
    if (this.view.notice.length > 0 || this.initializationError.length > 0) {
      Column({ space: 4 }) {
        Text(this.initializationError.length > 0 ? this.initializationError : this.view.notice)
          .fontSize(12).lineHeight(18)
          .fontColor(this.initializationError.length > 0 || this.view.errorCode.length > 0 ? '#A43B32' : '#176766')
        if (this.view.requestId.length > 0 && this.view.errorCode.length > 0) {
          Text('请求编号：' + this.view.requestId).fontSize(10).fontColor('#617589')
            .copyOption(CopyOptions.InApp)
        }
        if (this.view.errorCode === 'VERSION_CONFLICT') {
          Button('重新读取本地版本')
            .id('notice-refresh-revision').height(34).fontSize(12).backgroundColor('#176766')
            .enabled(!this.busy())
            .onClick(() => {
              if (this.controller !== null) this.controller.refreshRevision();
            })
        }
      }.alignItems(HorizontalAlign.Start).width('100%')
    }
  }

  @Builder
  successCard() {
    Column({ space: 8 }) {
      Text('已正式保存').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#176766')
      Text('通知来源、任务与材料清单已在同一次本地快照提交中写入。')
        .fontSize(13).fontColor('#355A52').lineHeight(20)
      Text('任务编号：' + this.view.savedTaskId).fontSize(11).fontColor('#617589').copyOption(CopyOptions.InApp)
      Text('保存后数据版本：' + String(this.view.savedRevision)).fontSize(11).fontColor('#617589')
      Text('材料目前均为“待准备”，没有标记为已提交。').fontSize(11).fontColor('#617589')
      Button('返回对话页').width('100%').height(42).backgroundColor('#176766')
        .onClick(() => this.goBack())
    }.alignItems(HorizontalAlign.Start).width('100%').padding(16).backgroundColor('#EAF4F0')
    .border({ width: 1, color: '#CDE4DB' }).borderRadius(14)
  }

  build() {
    Column() {
      this.header()
      if (this.leave.kind !== 'closed') {
        this.leaveConfirmation()
      } else if (this.initializing) {
        Column({ space: 10 }) {
          LoadingProgress().width(28).height(28).color('#176766')
          Text('正在读取本地数据…').fontSize(13).fontColor('#617589')
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else {
        Scroll() {
          Column({ space: 14 }) {
            this.commitFeedback()
            this.feedback()
            if (this.view.phase === 'saved') {
              this.successCard()
            } else {
              this.sourceEditor()
              if (this.view.draft !== null) this.draftCard()
            }
            if (this.busy()) {
              Row({ space: 9 }) {
                LoadingProgress().width(20).height(20).color('#176766')
                Text(this.view.phase === 'saving' ? '正在保存…' :
                  (this.view.phase === 'refreshing' ? '正在刷新本地版本…' : '正在整理通知…'))
                  .fontSize(12).fontColor('#617589')
              }.width('100%')
            }
          }.width('100%').padding({ left: 14, right: 14, top: 4, bottom: 24 })
        }.layoutWeight(1).width('100%').align(Alignment.Top)
      }
    }.width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
