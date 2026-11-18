import { common } from '@kit.AbilityKit';
import { ProbeView, SpeechProbeController } from './SpeechProbeController';
import { speechProbeOwner } from './SpeechProbeOwner';

@Entry
@Component
struct SpeechProbe {
  @State view: ProbeView = new ProbeView();
  @State spoken: string = '这是课事清的语音能力探测。已整理为草案，请先核对。';
  private controller: SpeechProbeController | undefined;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.controller = speechProbeOwner.get(context);
    this.controller.subscribe((value: ProbeView): void => { this.view = value; });
  }
  onPageHide(): void { speechProbeOwner.pause(); }
  aboutToDisappear(): void { speechProbeOwner.pause(); this.controller?.detach(); }
  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('T09 鸿蒙语音探测').fontSize(25).fontWeight(FontWeight.Bold)
        Text('独立开发验证页 · 不调用模型、不保存任务、不保存或上传录音。')
          .fontSize(14).fontColor('#617589')
        Text('请口述合成示例：请记录2026年11月6日18点交数据库实验报告。').fontSize(15)
        Text('状态：' + this.view.phase).id('speech-phase').fontSize(17)
        Text(this.view.message).id('speech-message').fontSize(15)
        if (this.view.errorCode.length > 0) {
          Text('错误码：' + this.view.errorCode).id('speech-error').fontColor('#A43B32')
        }
        Button('开始录音识别').id('speech-record').enabled(!this.view.busy)
          .onClick(() => { this.controller?.record(); })
        Text('点击开始后会收音；说完请点“结束录音并等待转写”。单次最多 30 秒。')
          .fontSize(13).fontColor('#617589')
        Button('结束录音并等待转写').id('speech-finish').enabled(this.view.phase === 'recording')
          .onClick(() => { this.controller?.finishRecording(); })
        Button('取消录音 / 停止播报').id('speech-stop').enabled(this.view.busy)
          .onClick(() => { this.controller?.cancel(); })
        if (this.view.partial.length > 0) {
          Text('本次识别结果：' + this.view.partial).id('speech-partial').fontSize(15)
        }
        Text('可编辑转写（不会自动发送）').fontSize(16)
        TextArea({ text: this.view.text, placeholder: '识别完成后在这里核对，也可直接输入文字' })
          .id('speech-transcript').height(120).maxLength(4000)
          .onChange((value: string) => this.controller?.edit(value))
        Text('播报探测').fontSize(18).fontWeight(FontWeight.Bold)
        TextArea({ text: this.spoken }).id('speech-say-text').height(100).maxLength(500)
          .onChange((value: string) => this.spoken = value)
        Button('播报上方文字').id('speech-speak').enabled(!this.view.busy)
          .onClick(() => { this.controller?.speak(this.spoken); })
        Button('停止播报').id('speech-stop-playback')
          .enabled(this.view.phase === 'tts_initializing' || this.view.phase === 'speaking')
          .onClick(() => { this.controller?.cancel(); })
        Text('是否真的听到声音、点击停止后是否中断，需在本机核对；回调不代替听觉验证。')
          .fontSize(13).fontColor('#617589')
      }.width('100%').alignItems(HorizontalAlign.Start).padding(22)
    }.width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
