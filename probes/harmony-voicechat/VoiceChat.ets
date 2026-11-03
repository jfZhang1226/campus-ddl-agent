import { common } from '@kit.AbilityKit';
import router from '@ohos.router';
import { KeyboardAvoidMode } from '@ohos.arkui.UIContext';
import { ChatMessage, GatewayConfig } from '../chat/ChatModels';
import { VoiceChatController, VoiceChatView } from '../speech/VoiceChatController';
import { voiceChatOwner } from './VoiceChatOwner';

@Entry
@Component
struct VoiceChat {
  @State view: VoiceChatView = new VoiceChatView();
  @State settingsOpen: boolean = false;
  @State gatewayUrl: string = '';
  @State projectToken: string = '';
  @State fixture: boolean = false;
  private controller: VoiceChatController | undefined;
  private previousKeyboardMode: KeyboardAvoidMode = KeyboardAvoidMode.OFFSET;

  aboutToAppear(): void {
    this.previousKeyboardMode = this.getUIContext().getKeyboardAvoidMode();
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    this.controller = voiceChatOwner.get(this.getUIContext().getHostContext() as common.UIAbilityContext);
    const config = this.controller.configuration();
    this.gatewayUrl = config.baseUrl;
    this.projectToken = config.token;
    this.fixture = config.baseUrl === 'http://127.0.0.1:18765';
    this.controller.subscribe((value: VoiceChatView): void => { this.view = value; });
  }
  onPageHide(): void { voiceChatOwner.pause(); }
  aboutToDisappear(): void {
    voiceChatOwner.pause(); this.controller?.detach();
    this.getUIContext().setKeyboardAvoidMode(this.previousKeyboardMode);
  }

  @Builder
  settings() {
    Column({ space: 10 }) {
      Text('填写团队网关根地址和项目凭证，不能填写服务商 API Key。设置仅存本次内存。').fontSize(13)
      TextInput({ text: this.gatewayUrl, placeholder: 'https://gateway.example.com' })
        .id('voice-gateway-url').onChange((value: string) => this.gatewayUrl = value)
      TextInput({ text: this.projectToken, placeholder: '项目访问凭证' }).type(InputType.Password)
        .id('voice-gateway-token').onChange((value: string) => this.projectToken = value)
      Button('应用团队网关').id('voice-configure').onClick(() => {
        if (this.controller?.configure(new GatewayConfig(this.gatewayUrl, this.projectToken, 45000))) {
          this.fixture = false; this.settingsOpen = false; this.projectToken = '';
        }
      })
      Button('使用本机合成测试服务').id('voice-use-fixture').onClick(() => {
        if (this.controller?.configure(new GatewayConfig('http://127.0.0.1:18765', 't10-device-check', 5000))) {
          this.fixture = true; this.settingsOpen = false; this.projectToken = '';
        }
      })
      Text('合成服务需要电脑连接；只返回标明的人工测试回复，不代表真实模型。').fontSize(12).fontColor('#617589')
    }.padding(12).backgroundColor('#FFFFFF').borderRadius(12)
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Text('课事清 · 语音联调').fontSize(22).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('设置').id('voice-settings').enabled(!this.view.chat.busy && !this.view.speech.busy)
          .onClick(() => { this.settingsOpen = !this.settingsOpen; })
      }.width('100%')
      Text(this.fixture ? '合成测试服务 · 非真实模型 · 不保存任务'
        : (this.view.chat.configured ? '自填团队网关 · 本页不保存任务' : '先测试语音；发送前需设置网关'))
        .id('voice-mode').fontSize(12).fontColor('#617589')
      if (this.settingsOpen) { this.settings() }
      Scroll() {
        Column({ space: 10 }) {
          if (this.view.chat.messages.length === 0) {
            Text('点录音后再说话，读完立即结束；转写只填输入框。核对后点发送，回复后可手动播报。').fontSize(14)
          }
          ForEach(this.view.chat.messages, (row: ChatMessage) => {
            Column({ space: 4 }) {
              Text(row.role === 'user' ? '你 · ' + row.phase : '文字回复 · 未保存任务').fontSize(12).fontColor('#617589')
              Text(row.text).fontSize(16).copyOption(CopyOptions.InApp)
            }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#FFFFFF').borderRadius(10)
          }, (row: ChatMessage) => row.id + '_' + row.phase)
          if (this.view.speech.partial.length > 0) {
            Text('本次识别：' + this.view.speech.partial).id('voice-partial').fontSize(14)
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%')
      Text('语音：' + this.view.speech.phase + (this.view.chat.busy ? ' · 正在等待网关' : ''))
        .id('voice-phase').fontSize(13).fontColor('#176766')
      if (this.view.speech.errorCode.length > 0) {
        Text('语音未完成：' + this.view.speech.errorCode + '，可继续文字输入。').id('voice-error').fontSize(13)
      }
      if (this.view.chat.notice.length > 0) { Text(this.view.chat.notice).id('voice-chat-notice').fontSize(13) }
      if (this.view.notice.length > 0) { Text(this.view.notice).fontSize(13) }
      Row({ space: 8 }) {
        Button('开始录音').id('voice-record').enabled(!this.view.chat.busy && !this.view.speech.busy)
          .onClick(() => { this.controller?.record(); })
        Button('结束录音').id('voice-finish').enabled(this.view.speech.phase === 'recording')
          .onClick(() => { this.controller?.finishRecording(); })
        Button('取消语音').id('voice-cancel').enabled(this.view.speech.busy)
          .onClick(() => { this.controller?.cancelVoice(); })
      }
      TextArea({ text: this.view.chat.draft, placeholder: '在这里核对、修改转写，也可直接打字' })
        .id('voice-composer').height(85).maxLength(4000).onChange((value: string) => this.controller?.edit(value))
      Row({ space: 10 }) {
        Button(this.view.chat.busy ? '停止等待' : '发送').id('voice-send').layoutWeight(1)
          .enabled(!this.view.speech.busy && (this.view.chat.busy || this.view.chat.draft.trim().length > 0))
          .onClick(() => {
            if (this.view.chat.busy) { this.controller?.stopWaiting(); }
            else if (!this.view.chat.configured) { this.settingsOpen = true; }
            else { this.controller?.send(); }
          })
        Button('播报回复').id('voice-play').enabled(this.view.canSpeak)
          .onClick(() => { this.controller?.speakLastReply(); })
        Button('停止播报').id('voice-stop-playback')
          .enabled(this.view.speech.phase === 'speaking' || this.view.speech.phase === 'tts_initializing')
          .onClick(() => { this.controller?.cancelVoice(); })
      }
      Text('回复较长时仅播报开头。关闭应用不保留对话/设置；正式保存另需屏幕确认。').fontSize(10).fontColor('#617589')
      Button('T09 探测页').id('voice-open-probe').fontSize(11)
        .enabled(!this.view.chat.busy && !this.view.speech.busy)
        .onClick(() => { router.pushUrl({ url: 'pages/SpeechProbe' }).catch(() => {}); })
    }.padding(16).width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
