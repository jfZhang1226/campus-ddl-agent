// Native voice validation reuses the production confirmation page and shared coordinators.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prepare:prepareVoice}=require('./prepare-voice-chat.cjs');
const root=path.resolve(__dirname,'..');
function replaceOnce(text,from,to) {
  if(!text.includes(from)||text.indexOf(from)!==text.lastIndexOf(from))
    throw Error('Shared notice source changed; review the T19 assembly anchor: '+from.slice(0,70));
  return text.replace(from,to);
}
function prepare(output) {
  const result=prepareVoice(output);
  const write=(f,s)=>fs.writeFileSync(path.join(result.output,f),s);
  const pages='entry/src/main/ets/pages/';
  write(pages+'NoticeSpeechOwner.ets',fs.readFileSync(path.join(root,'probes/harmony-noticechat/NoticeSpeechOwner.ets'),'utf8'));
  write(pages+'TaskAgentSpeechOwner.ets',fs.readFileSync(path.join(root,'probes/harmony-noticechat/TaskAgentSpeechOwner.ets'),'utf8'));
  let taskPage=fs.readFileSync(path.join(root,'client/entry/src/main/ets/pages/TaskAssistant.ets'),'utf8');
  taskPage=replaceOnce(taskPage,"import { taskAgentOwner } from '../agent/TaskAgentOwner';",
    "import { taskAgentSpeechOwner as taskAgentOwner } from './TaskAgentSpeechOwner';");
  taskPage=replaceOnce(taskPage,"import { chatOwner } from '../chat/ChatOwner';", "import { voiceChatOwner } from './VoiceChatOwner';");
  taskPage=replaceOnce(taskPage,'chatOwner.get(context.filesDir).configuration()', 'voiceChatOwner.get(context).configuration()');
  write(pages+'TaskAssistant.ets',taskPage);
  let page=fs.readFileSync(path.join(root,'client/entry/src/main/ets/pages/NoticeImport.ets'),'utf8').replaceAll('\r\n','\n');
  for(const line of [
    "import { ArkNoticeExtractionTransport } from '../adapters/ArkNoticeExtractionTransport';\n",
    "import { NoticeConfirmedWriter } from '../notice/NoticeConfirmedWriter';\n",
    "import { noticeImportOwner } from '../notice/NoticeImportOwner';\n",
    "import { chatOwner } from '../chat/ChatOwner';\n"
  ])page=replaceOnce(page,line,'');
  page="import { SpeechView } from '../speech/VoiceChatController';\nimport { noticeSpeechOwner } from './NoticeSpeechOwner';\nimport { voiceChatOwner } from './VoiceChatOwner';\n"+page;
  page=replaceOnce(page,'struct NoticeImportPage','struct NoticeChatPage');
  page=replaceOnce(page,'  @State save: NoticeSaveView = new NoticeSaveView();',
    '  @State save: NoticeSaveView = new NoticeSaveView();\n  @State speech: SpeechView = new SpeechView();');
  page=replaceOnce(page,'      noticeImportOwner.release(this.controller);','      noticeSpeechOwner.destroy();');
  const constructor="      const controller = new NoticeSaveController(new ArkNoticeExtractionTransport(),\n"+
    "        new NoticeConfirmedWriter(storage.local, storage.commits));\n"+
    "      try { noticeImportOwner.claim(controller); }\n"+
    "      catch (error) { controller.dispose(); throw error as Error; }";
  page=replaceOnce(page,constructor,'      const controller: NoticeSaveController = noticeSpeechOwner.get(context);');
  page=page.replaceAll('chatOwner.get().configuration()','voiceChatOwner.get(context).configuration()');
  page=replaceOnce(page,"return this.save.busy || ['extracting', 'saving', 'refreshing'].includes(this.view.phase);",
    "return this.save.busy || this.speech.busy || ['extracting', 'saving', 'refreshing'].includes(this.view.phase);");
  page=replaceOnce(page,'      this.controller.subscribeSave((state: NoticeSaveView) => { this.save = state; });',
    '      this.controller.subscribeSpeech((state: SpeechView) => { this.speech = state; });\n'+
    '      this.controller.subscribeSave((state: NoticeSaveView) => { this.save = state; });');
  page=page.replace('导入校园通知','通知草案联调').replace('先整理为草案，确认后才写入任务','直接贴原文或语音输入，让模型整理');
  page=replaceOnce(page,"Text('通知原文').fontSize(14)","Text('把通知放进来').fontSize(14)");
  page=replaceOnce(page,'              this.sourceEditor()','              this.voiceInput()\n              this.sourceEditor()');
  const voiceBuilder = `  @Builder
  voiceInput() {
    Column({ space: 8 }) {
      Text('读完立即结束录音，转写后先核对再发送。').fontSize(12).fontColor('#617589')
      Row({ space: 7 }) {
        Button('开始录音').id('notice-record').fontSize(12).enabled(!this.busy() && !this.save.locked)
          .onClick(() => { this.controller?.record(); })
        Button('结束录音').id('notice-finish').fontSize(12).enabled(this.speech.phase === 'recording')
          .onClick(() => { this.controller?.finishRecording(); })
        Button('取消语音').id('notice-cancel-voice').fontSize(12).enabled(this.speech.busy)
          .onClick(() => { this.controller?.cancelVoice(); })
      }
      Text('语音：' + this.speech.phase + (this.speech.errorCode.length > 0 ? ' · ' + this.speech.errorCode : ''))
        .id('notice-speech-state').fontSize(12).fontColor('#617589')
      if (this.speech.partial.length > 0) { Text(this.speech.partial).fontSize(13) }
      Row({ space: 8 }) {
        Button('播报当前草案').id('notice-speak').fontSize(12)
          .enabled(!this.busy() && this.view.draft !== null).onClick(() => { this.controller?.speakDraft(); })
        Button('停止播报').id('notice-stop-speech').fontSize(12)
          .enabled(this.speech.phase === 'speaking' || this.speech.phase === 'tts_initializing')
          .onClick(() => { this.controller?.cancelVoice(); })
      }
      Text('未确认的编辑仅在本页；已暂存的方案可在重启后恢复，核对后再确认。')
        .fontSize(11).fontColor('#8A5A12').lineHeight(17)
    }.alignItems(HorizontalAlign.Start).width('100%').padding(12).backgroundColor('#FFFFFF').borderRadius(12)
  }

`;
  page=replaceOnce(page,'  build() {',voiceBuilder+'  build() {');
  write(pages+'NoticeChat.ets',page);
  let voicePage=fs.readFileSync(path.join(root,'probes/harmony-voicechat/VoiceChat.ets'),'utf8');
  voicePage=replaceOnce(voicePage,"      if (this.settingsOpen) { this.settings() }",`      Button('通知草案联调').id('open-notice-chat')
        .enabled(!this.view.chat.busy && !this.view.speech.busy)
        .onClick(() => {
          this.controller?.pause();
          router.pushUrl({ url: 'pages/NoticeChat' }).catch(() => { this.view.notice = '无法打开通知草案页。'; });
        })
      Button('任务对话联调').id('open-task-agent')
        .enabled(!this.view.chat.busy && !this.view.speech.busy)
        .onClick(() => {
          this.controller?.pause();
          router.pushUrl({ url: 'pages/TaskAssistant' }).catch(() => { this.view.notice = '无法打开任务对话页。'; });
        })
      if (this.settingsOpen) { this.settings() }`);
  write(pages+'VoiceChat.ets',voicePage);
  let ability=fs.readFileSync(path.join(root,'probes/harmony-voicechat/EntryAbility.ets'),'utf8');
  ability="import { taskAgentSpeechOwner } from '../pages/TaskAgentSpeechOwner';\nimport { noticeSpeechOwner } from '../pages/NoticeSpeechOwner';\n"+ability;
  ability=ability.replaceAll('voiceChatOwner.pause();','taskAgentSpeechOwner.pause(); noticeSpeechOwner.pause(); voiceChatOwner.pause();');
  ability=ability.replaceAll('voiceChatOwner.destroy();','taskAgentSpeechOwner.destroy(); noticeSpeechOwner.destroy(); voiceChatOwner.destroy();');
  write('entry/src/main/ets/entryability/EntryAbility.ets',ability);
  const appFile=path.join(result.output,'AppScope/app.json5');
  const app=JSON.parse(fs.readFileSync(appFile,'utf8'));
  app.app.bundleName='com.campusddl.noticeprobe';app.app.versionName='0.4.0';app.app.versionCode=400;
  fs.writeFileSync(appFile,JSON.stringify(app,null,2)+'\n');
  const stringsFile=path.join(result.output,'entry/src/main/resources/base/element/string.json');
  const strings=JSON.parse(fs.readFileSync(stringsFile,'utf8'));
  for(const row of strings.string)if(row.name==='EntryAbility_label')row.value='课事清通知联调';
  fs.writeFileSync(stringsFile,JSON.stringify(strings,null,2)+'\n');
  write('entry/src/main/resources/base/profile/main_pages.json',JSON.stringify({src:[
    'pages/VoiceChat','pages/NoticeChat','pages/TaskAssistant','pages/SpeechProbe'
  ]},null,2)+'\n');
  for(const file of ['T15-VOICE-CHAT-ONLY.txt','T15-source-manifest.json'])fs.unlinkSync(path.join(result.output,file));
  write('T19-NOTICE-INTERACTION-ONLY.txt',
    'Shared production confirmation flow with a native speech port. Explicit client confirmation uses T16 v2.\n'+
    'New independent version. Unsigned/uninstalled until explicit device evidence is recorded.\n');
  const hashes={};
  for(const file of [pages+'NoticeChat.ets',pages+'NoticeSpeechOwner.ets',
    'entry/src/main/ets/notice/NoticeImportController.ts','entry/src/main/ets/notice/NoticeVoiceController.ts',
    'entry/src/main/ets/notice/NoticeConfirmedWriter.ts','entry/src/main/ets/notice/NoticeSaveController.ts',
    'entry/src/main/ets/notice/NoticeImportOwner.ts','entry/src/main/ets/speech/UnavailableSpeechSession.ts',
    'entry/src/main/ets/notice/NoticeLeaveGuard.ts', pages+'TaskAssistant.ets',pages+'TaskAgentSpeechOwner.ets',
    'entry/src/main/ets/agent/TaskAgentController.ts','entry/src/main/ets/agent/TaskAgentSession.ts',
    pages+'VoiceChat.ets','entry/src/main/ets/entryability/EntryAbility.ets',pages+'HarmonySpeechPort.ets',pages+'SpeechProbeController.ts'])
    hashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(result.output,file))).digest('hex');
  const manifest={...result,scope:'T19-local-integration',bundleName:app.app.bundleName,versionCode:400,formalSaveEnabled:true,hashes};
  write('T19-source-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
if(require.main===module)console.log(JSON.stringify(prepare(process.argv[2]),null,2));
module.exports={prepare};
