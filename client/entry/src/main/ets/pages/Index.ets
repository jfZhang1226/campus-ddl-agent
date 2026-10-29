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
import { ChatMessage, ChatState, GatewayConfig } from '../chat/ChatModels';
import { chatOwner } from '../chat/ChatOwner';
import { KeyboardAvoidMode } from '@ohos.arkui.UIContext';

@Entry
@Component
struct Index {
  @State view: ChatState = new ChatState();
  @State settingsOpen: boolean = false;
  @State storageNavigationError: string = '';
  @State gatewayUrl: string = '';
  @State projectToken: string = '';
  @State timeoutSeconds: string = '45';
  private scroller: Scroller = new Scroller();
  private scrollTimer: number = -1;
  private previousKeyboardMode: KeyboardAvoidMode = KeyboardAvoidMode.OFFSET;

  aboutToAppear(): void {
    this.previousKeyboardMode = this.getUIContext().getKeyboardAvoidMode();
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    const controller = chatOwner.get();
    const config = controller.configuration();
    this.gatewayUrl = config.baseUrl;
    this.projectToken = config.token;
    this.timeoutSeconds = String(config.timeoutMs / 1000);
    this.settingsOpen = !controller.snapshot().configured;
    controller.subscribe((state: ChatState) => {
      const shouldScroll = state.messages.length !== this.view.messages.length || state.busy !== this.view.busy;
      this.view = state;
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

  @Builder
  header() {
    Row({ space: 12 }) {
      Column({ space: 3 }) {
        Text('校园 DDL').fontSize(23).fontWeight(FontWeight.Bold).fontColor('#142C43')
        Text('文本助手').fontSize(12).fontColor('#617589')
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Button(this.settingsOpen ? '返回对话' : '网关设置')
        .fontSize(13).fontColor('#176766').backgroundColor('#E1F0EC')
        .enabled(!this.view.busy)
        .onClick(() => this.settingsOpen = !this.settingsOpen)
    }.width('100%').padding({ left: 20, right: 20, top: 18, bottom: 14 })
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
        Text(message.role === 'user' ? '你' : '校园助手')
          .fontSize(12).fontWeight(FontWeight.Medium)
          .fontColor(message.role === 'user' ? '#D3E8E2' : '#617589')
        Text(message.text).fontSize(16).lineHeight(25).copyOption(CopyOptions.InApp)
          .fontColor(message.role === 'user' ? '#FFFFFF' : '#142C43')
        if (message.phase === 'pending' || message.phase === 'failed' || message.phase === 'stopped') {
          Text(message.phase === 'pending' ? '等待回复' : (message.phase === 'failed' ? '未获得回复' : '已停止等待'))
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
        Text('每次提问独立处理 · 暂不执行任务操作').fontColor('#617589').fontSize(11)
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
              Text('正在获取回复…').fontSize(13).fontColor('#617589')
            }.padding(10)
          }
        }
      }.layoutWeight(1).width('100%').padding({ left: 16, right: 16 })
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
          .id('chat-input').height(88).fontSize(16).maxLength(4000).backgroundColor('#FFFFFF').borderRadius(14)
          .onChange((value: string) => chatOwner.get().setDraft(value))
        Row() {
          Text(String(this.view.draft.length) + '/4000').fontSize(11).fontColor('#617589').layoutWeight(1)
          Button(this.view.busy ? '停止等待' : '发送')
            .height(39).width(110).fontSize(14).backgroundColor(this.view.busy ? '#647789' : '#176766')
            .enabled(this.view.busy || this.view.draft.trim().length > 0)
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
        Text('关闭应用后，本次对话和设置不会保留。').fontSize(10).fontColor('#617589')
      }.width('100%').padding({ left: 16, right: 16, top: 10, bottom: 12 })
    }.layoutWeight(1).width('100%')
  }

  build() {
    Column() {
      this.header()
      if (this.settingsOpen) {
        this.settings()
      } else {
        this.conversation()
      }
    }.width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
