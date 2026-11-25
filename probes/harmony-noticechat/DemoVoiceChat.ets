import { common } from '@kit.AbilityKit';
import router from '@ohos.router';
import { KeyboardAvoidMode } from '@ohos.arkui.UIContext';
import { ChatMessage } from '../chat/ChatModels';
import { VoiceChatController, VoiceChatView } from '../speech/VoiceChatController';
import { voiceChatOwner } from './VoiceChatOwner';

@Entry
@Component
struct VoiceChat {
  @State view: VoiceChatView = new VoiceChatView();
  private controller: VoiceChatController | undefined;
  private previousKeyboardMode: KeyboardAvoidMode = KeyboardAvoidMode.OFFSET;

  aboutToAppear(): void {
    this.previousKeyboardMode = this.getUIContext().getKeyboardAvoidMode();
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    this.controller = voiceChatOwner.get(this.getUIContext().getHostContext() as common.UIAbilityContext);
    this.controller.subscribe((value: VoiceChatView): void => { this.view = value; });
  }
  onPageHide(): void { voiceChatOwner.pause(); }
  aboutToDisappear(): void {
    voiceChatOwner.pause(); this.controller?.detach();
    this.getUIContext().setKeyboardAvoidMode(this.previousKeyboardMode);
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Button('返回').id('voice-back').enabled(!this.view.chat.busy && !this.view.speech.busy).onClick(() => { router.back(); })
        Text('语音调试').fontSize(22).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('设置').id('voice-settings').enabled(!this.view.chat.busy && !this.view.speech.busy)
          .onClick(() => { router.pushUrl({ url: 'pages/GatewaySettings' }).catch(() => {}); })
      }.width('100%')
      Text(this.view.chat.configured ? '团队网关 · 调试回复不保存任务' : '发送前请到统一设置配置网关')
        .id('voice-mode').fontSize(12).fontColor('#617589')
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
            else if (!this.view.chat.configured) { router.pushUrl({ url: 'pages/GatewaySettings' }).catch(() => {}); }
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
