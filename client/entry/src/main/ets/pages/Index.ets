/*
 * Copyright (c) 2023 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Explicit import keeps the Android router adapter in the ACE package.
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { ChatMessage, ChatState, GatewayConfig } from '../chat/ChatModels';
import { chatOwner } from '../chat/ChatOwner';
import { KeyboardAvoidMode } from '@ohos.arkui.UIContext';
import { HistoryController, HistoryViewState } from '../chat/HistoryController';
import { getClientStorage } from '../data/ClientStorage';
import { HistoryPanel } from './HistoryPanel';

@Entry
@Component
struct Index {
  @State view: ChatState = new ChatState();
  @State settingsOpen: boolean = false;
  @State storageNavigationError: string = '';
  @State gatewayUrl: string = '';
  @State projectToken: string = '';
  @State timeoutSeconds: string = '45';
  @State historyView: HistoryViewState = new HistoryViewState();
  private history: HistoryController | null = null;
  private scroller: Scroller = new Scroller();
  private scrollTimer: number = -1;
  private previousKeyboardMode: KeyboardAvoidMode = KeyboardAvoidMode.OFFSET;

  aboutToAppear(): void {
    this.previousKeyboardMode = this.getUIContext().getKeyboardAvoidMode();
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const controller = chatOwner.get(context.filesDir);
    if (this.history !== null) this.history.dispose();
    this.history = new HistoryController(getClientStorage(context.filesDir).history, controller);
    this.history.subscribe((state: HistoryViewState) => { this.historyView = state; });
    const config = controller.configuration();
    this.gatewayUrl = config.baseUrl;
    this.projectToken = config.token;
    this.timeoutSeconds = String(config.timeoutMs / 1000);
    this.settingsOpen = !controller.snapshot().configured && controller.snapshot().messages.length === 0;
    controller.subscribe((state: ChatState) => {
      const wasLoading: boolean = this.view.historyLoading;
      const shouldScroll = state.messages.length !== this.view.messages.length || state.busy !== this.view.busy;
      this.view = state;
      if (wasLoading && state.historyReady && state.messages.length > 0 &&
        this.gatewayUrl.length === 0 && this.projectToken.length === 0) this.settingsOpen = false;
      if (shouldScroll && !this.settingsOpen) {
        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout((): void => {
          this.scroller.scrollEdge(Edge.Bottom);
        }, 100);
      }
    });
  }

  onPageHide(): void {
    chatOwner.pause();
  }

  aboutToDisappear(): void {
    this.getUIContext().setKeyboardAvoidMode(this.previousKeyboardMode);
    chatOwner.pause();
    chatOwner.detach();
    if (this.history !== null) { this.history.dispose(); this.history = null; }
    clearTimeout(this.scrollTimer);
  }

  private applySettings(): void {
    const config = new GatewayConfig(this.gatewayUrl, this.projectToken, Number(this.timeoutSeconds) * 1000);
    if (chatOwner.get().configure(config)) {
      this.settingsOpen = false;
    }
  }

  private openStorageCheck(): void {
    this.storageNavigationError = '';
    router.pushUrl({ url: 'pages/StorageCheck' }).catch(() => {
      this.storageNavigationError = '无法打开存储验证页，请稍后重试。';
    });
  }

  private openTaskCheck(): void {
    this.storageNavigationError = '';
    router.pushUrl({ url: 'pages/TaskCheck' }).catch(() => {
      this.storageNavigationError = '无法打开任务验证页，请稍后重试。';
    });
  }

  private openNoticeImport(): void {
    this.storageNavigationError = '';
    chatOwner.pause();
    router.pushUrl({ url: 'pages/NoticeImport' }).catch(() => {
      this.storageNavigationError = '无法打开通知导入页，请稍后重试。';
    });
  }

  private openHistoryCheck(): void {
    this.storageNavigationError = '';
    router.pushUrl({ url: 'pages/HistoryCheck' }).catch(() => {
      this.storageNavigationError = '无法打开历史验证页，请稍后重试。';
    });
  }

  @Builder
  header() {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
      Column({ space: 3 }) {
        Text('校园 DDL').fontSize(23).fontWeight(FontWeight.Bold).fontColor('#142C43')
        Text('文本助手').fontSize(12).fontColor('#617589')
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Button('导入通知')
        .id('notice-import-entry').width(86).fontSize(12)
        .fontColor('#176766').backgroundColor('#E1F0EC')
        .enabled(!this.view.busy)
        .onClick(() => this.openNoticeImport())
      Button(this.settingsOpen ? '返回对话' : '网关设置')
        .width(76).fontSize(12).fontColor('#176766').backgroundColor('#E1F0EC')
        .enabled(!this.view.busy && this.historyView.confirmation.length === 0)
        .onClick(() => this.settingsOpen = !this.settingsOpen)
      }.width('100%')
      Row({ space: 10 }) {
        Button('历史会话').id('history-open-list').fontSize(12).fontColor('#176766').backgroundColor('#E1F0EC')
          .enabled(this.historyAvailable()).onClick(() => { if (this.history !== null) this.history.showList(); })
        Button('新对话').id('chat-new-conversation').fontSize(12).fontColor('#176766').backgroundColor('#E1F0EC')
          .enabled(this.historyAvailable()).onClick(() => {
            this.settingsOpen = false;
            if (this.history !== null) this.history.requestNew();
          })
        Text(this.view.sessionTitle.length > 0 ? this.view.sessionTitle : '新对话').fontSize(12).fontColor('#617589')
          .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')
    }.width('100%').padding({ left: 20, right: 20, top: 18, bottom: 14 })
  }

  private historyAvailable(): boolean {
    return !this.view.busy && !this.view.historyLoading && (!this.view.savePending || this.view.canAbandonSave) &&
      !this.historyView.loading && !this.historyView.switching && this.historyView.confirmation.length === 0;
  }

  @Builder
  discardConfirmation() {
    Column({ space: 9 }) {
      Text(this.historyView.confirmUnsaved ?
        (this.historyView.confirmation === 'new' ? '放弃未保存内容并开始新对话？' : '放弃未保存内容并切换会话？') :
        (this.historyView.confirmation === 'new' ? '清空当前输入并开始新对话？' : '清空当前输入并切换会话？'))
        .fontSize(17).fontWeight(FontWeight.Bold).fontColor('#142C43')
      Text(this.historyView.confirmUnsaved ?
        '当前输入和未保存的消息或回复会丢失，请先复制需要的内容。已保存的文件会保留，待恢复内容不会自动处理。' :
        '这段文字尚未发送。继续后会清空输入，已保存的对话会保留。').fontSize(13).fontColor('#617589').lineHeight(20)
      if (this.historyView.confirmDraft.length > 0) {
        Text(this.historyView.confirmDraft).fontSize(14).fontColor('#334155').maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).copyOption(CopyOptions.InApp)
      }
      Row({ space: 12 }) {
        Button(this.historyView.confirmUnsaved ? '保留内容' : '保留输入').id('history-cancel-discard').fontSize(13)
          .onClick(() => { if (this.history !== null) this.history.cancelConfirmation(); })
        Button(this.historyView.confirmUnsaved ? '放弃未保存并继续' : '清空输入并继续')
          .id('history-confirm-discard').fontSize(13).backgroundColor('#176766')
          .onClick(() => { if (this.history !== null) this.history.confirmDiscard(); })
      }.width('100%')
    }.padding(18).width('100%').alignItems(HorizontalAlign.Start).backgroundColor('#FFF4DD')
  }

  @Builder
  settings() {
    Scroll() {
      Column({ space: 16 }) {
        Text('连接你的网关').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#142C43')
        Text('填入组内提供的服务地址和项目凭证后，就可以发送文字问题。')
          .fontSize(14).fontColor('#617589').lineHeight(22)
        Column({ space: 8 }) {
          Text('网关根地址').fontSize(14).fontColor('#142C43')
          TextInput({ text: this.gatewayUrl, placeholder: 'https://gateway.example.com' })
            .fontColor('#142C43').backgroundColor('#FFFFFF')
            .id('gateway-url').maxLength(300).onChange((value: string) => this.gatewayUrl = value)
          Text('填写根地址，不含 /api/model/turn。真机不能用电脑的 localhost。')
            .fontSize(12).fontColor('#617589').lineHeight(18)
        }.alignItems(HorizontalAlign.Start).width('100%')
        Column({ space: 8 }) {
          Text('项目凭证').fontSize(14).fontColor('#142C43')
          TextInput({ text: this.projectToken, placeholder: '由网关维护者提供' })
            .fontColor('#142C43').backgroundColor('#FFFFFF')
            .id('gateway-token').type(InputType.Password).maxLength(512)
            .onChange((value: string) => this.projectToken = value)
          Text('这是网关的访问凭证。模型服务商的 API Key 留在服务端。')
            .fontSize(12).fontColor('#617589').lineHeight(18)
        }.alignItems(HorizontalAlign.Start).width('100%')
        Column({ space: 8 }) {
          Text('最长等待（秒）').fontSize(14).fontColor('#142C43')
          TextInput({ text: this.timeoutSeconds, placeholder: '45' })
            .fontColor('#142C43').backgroundColor('#FFFFFF')
            .type(InputType.Number).maxLength(3)
            .onChange((value: string) => this.timeoutSeconds = value)
          Text('范围 5～120 秒；超时后由你决定是否重试。').fontSize(12).fontColor('#617589')
        }.alignItems(HorizontalAlign.Start).width('100%')
        if (this.view.notice.length > 0) {
          Text(this.view.notice).fontSize(14).fontColor(this.view.errorCode.length > 0 ? '#A43B32' : '#176766')
        }
        Button('应用设置').width('100%').height(46).backgroundColor('#176766')
          .onClick(() => this.applySettings())
        Button('T08 存储验证（开发用）').id('t08-storage-entry')
          .enabled(!this.view.busy)
          .onClick(() => this.openStorageCheck())
        Button('T14 任务验证（开发用）').id('t14-task-entry')
          .enabled(!this.view.busy)
          .onClick(() => this.openTaskCheck())
        Button('T11 历史验证（开发用）').id('t11-history-entry')
          .enabled(!this.view.busy)
          .onClick(() => this.openHistoryCheck())
        if (this.storageNavigationError.length > 0) {
          Text(this.storageNavigationError).fontSize(12).fontColor('#A43B32')
        }
        Text('设置只在本次运行中有效，关闭应用后需要重新填写。请在可信网络中使用 HTTP 调试地址。')
          .fontSize(12).fontColor('#617589').lineHeight(19)
      }.alignItems(HorizontalAlign.Start).width('100%').padding(22)
    }.layoutWeight(1).width('100%').align(Alignment.Top)
  }

  @Builder
  emptyConversation() {
    Column({ space: 14 }) {
      Text('从一个问题开始').fontSize(23).fontWeight(FontWeight.Bold).fontColor('#142C43')
      Text('可以询问通知整理方法，或让助手解释一段文字。')
        .fontSize(14).fontColor('#617589').lineHeight(23).textAlign(TextAlign.Center)
        Button('试试：阅读通知要关注什么？')
        .fontSize(13).fontColor('#176766').backgroundColor('#E1F0EC')
        .onClick(() => chatOwner.get().setDraft('帮我列出阅读校园通知时要关注的信息'))
    }.width('100%').padding({ top: 48, bottom: 32, left: 24, right: 24 })
  }

  @Builder
  bubble(message: ChatMessage) {
    Row() {
      if (message.role === 'user') {
        Blank().width('10%')
      }
      Column({ space: 7 }) {
        Text(message.role === 'user' ? '你' : (message.role === 'tool' ? '工具记录（仅回看）' :
          (message.role === 'system' ? '系统记录' : '校园助手')))
          .fontSize(12).fontWeight(FontWeight.Medium)
          .fontColor(message.role === 'user' ? '#D3E8E2' : '#617589')
        Text(message.text).fontSize(16).lineHeight(25).copyOption(CopyOptions.InApp)
          .fontColor(message.role === 'user' ? '#FFFFFF' : '#142C43')
        if (['pending', 'failed', 'stopped', 'interrupted'].includes(message.phase)) {
          Text(message.phase === 'pending' ? '等待回复' : (message.phase === 'failed' ? '未获得回复' :
            (message.phase === 'interrupted' ? '上次请求未完成，未自动重发' : '已停止等待')))
            .fontSize(11).fontColor('#D3E8E2')
        }
      }.alignItems(HorizontalAlign.Start).padding(15).width('90%').borderRadius(16)
      .backgroundColor(message.role === 'user' ? '#176766' : '#FFFFFF')
      if (message.role !== 'user') {
        Blank().width('10%')
      }
    }.width('100%')
  }

  @Builder
  conversation() {
    Column({ space: 0 }) {
      Row({ space: 7 }) {
        Text(this.view.configured ? '● 已配置' : '○ 待配置').fontColor('#176766').fontSize(11)
        Text('对话独立处理 · 任务通过“导入通知”确认').fontColor('#617589').fontSize(11)
      }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 10 })
      List({ space: 14, scroller: this.scroller }) {
        if (this.view.messages.length === 0) {
          ListItem() { this.emptyConversation() }
        }
        ForEach(this.view.messages, (message: ChatMessage) => {
          ListItem() { this.bubble(message) }
        }, (message: ChatMessage) => message.id + ':' + message.phase)
        if (this.view.busy) {
          ListItem() {
            Row({ space: 10 }) {
              LoadingProgress().width(22).height(22).color('#176766')
              Text(this.view.savePending ? '正在保存对话…' : '正在获取回复…').fontSize(13).fontColor('#617589')
            }.padding(10)
          }
        }
      }.layoutWeight(1).width('100%').padding({ left: 16, right: 16 })
      if (this.view.historyLoading) {
        Text('正在读取本机历史…').fontSize(13).fontColor('#617589').padding(10)
      }
      if (this.view.storageNotice.length > 0) {
        Column({ space: 5 }) {
          Text(this.view.storageNotice).fontSize(12).lineHeight(18)
            .fontColor(this.view.storageErrorCode.length > 0 ? '#A43B32' : '#617589')
          if (this.view.storageErrorCode.length > 0 && this.view.savePending) {
            Button('重试保存对话')
              .enabled(!this.view.busy && !this.view.historyLoading && this.historyView.confirmation.length === 0).fontSize(12)
              .onClick(() => { chatOwner.get().retryHistorySave(); })
            Button('放弃未保存并新建').id('history-abandon-save').enabled(this.view.canAbandonSave && this.historyAvailable())
              .fontSize(12).onClick(() => { if (this.history !== null) this.history.requestNew(); })
          } else if (this.view.storageErrorCode.length > 0 && !this.view.historyReady) {
            Button('重试读取历史').enabled(!this.view.historyLoading).fontSize(12)
              .onClick(() => { chatOwner.get().initializeHistory(); })
          }
        }.alignItems(HorizontalAlign.Start).width('100%').padding({ left: 20, right: 20, top: 5 })
      }
      if (this.view.notice.length > 0) {
        Column({ space: 5 }) {
          Text(this.view.notice).fontSize(13).lineHeight(19)
            .fontColor(this.view.errorCode.length > 0 ? '#A43B32' : '#176766')
          if (this.view.requestId.length > 0 && this.view.errorCode.length > 0) {
            Text('请求编号：' + this.view.requestId).fontSize(10).fontColor('#617589').copyOption(CopyOptions.InApp)
          }
          if (this.view.canRetry) {
            Button('重试这条问题').fontSize(12).height(30).backgroundColor('#176766')
              .onClick(() => chatOwner.get().send())
          }
        }.alignItems(HorizontalAlign.Start).width('100%').padding({ left: 20, right: 20, top: 10, bottom: 6 })
      }
      Column({ space: 8 }) {
        TextArea({ text: this.view.draft, placeholder: '写下你的问题…' })
          .fontColor('#142C43')
          .enabled(this.historyView.confirmation.length === 0)
          .id('chat-input').height(88).fontSize(16).maxLength(4000).backgroundColor('#FFFFFF').borderRadius(14)
          .onChange((value: string) => chatOwner.get().setDraft(value))
        Row() {
          Text(String(this.view.draft.length) + '/4000').fontSize(11).fontColor('#617589').layoutWeight(1)
          Button(this.view.busy ? '停止等待' : '发送')
            .height(39).width(110).fontSize(14).backgroundColor(this.view.busy ? '#647789' : '#176766')
            .enabled(this.historyView.confirmation.length === 0 && !this.view.savePending && !this.view.historyLoading && this.view.historyReady &&
              (this.view.busy || this.view.draft.trim().length > 0))
            .onClick(() => {
              if (this.view.busy) {
                chatOwner.get().stop();
              } else {
                chatOwner.get().send();
                if (!this.view.configured) {
                  this.settingsOpen = true;
                }
              }
            })
        }.width('100%')
        Text('已保存的对话可离线回看；网关设置和未发送输入仅保留本次运行。').fontSize(10).fontColor('#617589')
      }.width('100%').padding({ left: 16, right: 16, top: 10, bottom: 12 })
    }.layoutWeight(1).width('100%')
  }

  build() {
    Column() {
      if (this.historyView.confirmation.length > 0) { this.discardConfirmation() }
      if (this.historyView.page !== 'chat') {
        HistoryPanel({ view: this.historyView, activeSessionId: this.view.sessionId,
          chatAvailable: !this.view.busy && !this.view.historyLoading && (!this.view.savePending || this.view.canAbandonSave),
          unsavedSave: this.view.savePending,
          onChat: () => { if (this.history !== null) this.history.showChat(); },
          onList: () => { if (this.history !== null) this.history.showList(); },
          onDetail: (id: string) => { if (this.history !== null) this.history.openDetail(id); },
          onContinue: (id: string) => {
            this.settingsOpen = false;
            if (this.history !== null) this.history.requestOpen(id);
          },
          onNew: () => {
            this.settingsOpen = false;
            if (this.history !== null) this.history.requestNew();
          }
        })
      } else {
        this.header()
        if (this.historyView.error.length > 0 || this.historyView.notice.length > 0) {
          Text(this.historyView.error.length > 0 ? this.historyView.error : this.historyView.notice)
            .fontSize(13).fontColor('#A43B32').padding(12)
        }
        if (this.settingsOpen) { this.settings() } else { this.conversation() }
      }
    }.width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
