// Native voice validation reuses the production confirmation page and shared coordinators.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prepare:prepareVoice}=require('./prepare-voice-chat.cjs');
const root=path.resolve(__dirname,'..');
const {brand}=require('./app-branding.cjs');
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
  for(const name of ['NativeReminderOwner.ets','HarmonyReminderPort.ets','HarmonyCalendarAccess.ets'])
    write(pages+name,fs.readFileSync(path.join(root,'probes/harmony-noticechat',name),'utf8'));
  let taskBoardPage=fs.readFileSync(path.join(root,'client/entry/src/main/ets/pages/Tasks.ets'),'utf8');
  taskBoardPage=replaceOnce(taskBoardPage,"import { reminderOwner } from '../reminders/ReminderOwner';",
    "import { nativeReminderOwner as reminderOwner } from './NativeReminderOwner';");
  write(pages+'Tasks.ets',taskBoardPage);
  let taskPage=fs.readFileSync(path.join(root,'client/entry/src/main/ets/pages/TaskAssistant.ets'),'utf8');
  taskPage=replaceOnce(taskPage,"import { taskAgentOwner } from '../agent/TaskAgentOwner';",
    "import { taskAgentSpeechOwner as taskAgentOwner } from './TaskAgentSpeechOwner';");
  taskPage=replaceOnce(taskPage,"import { chatOwner } from '../chat/ChatOwner';", "import { voiceChatOwner } from './VoiceChatOwner';");
  taskPage=replaceOnce(taskPage,'chatOwner.get(context.filesDir).configuration()', 'voiceChatOwner.get(context).configuration()');
  write(pages+'TaskAssistant.ets',taskPage);
  let settingsPage=fs.readFileSync(path.join(root,'client/entry/src/main/ets/pages/GatewaySettings.ets'),'utf8');
  settingsPage=replaceOnce(settingsPage,"import { chatOwner } from '../chat/ChatOwner';", "import { voiceChatOwner } from './VoiceChatOwner';");
  settingsPage=settingsPage.replaceAll('chatOwner.get(this.context().filesDir)', 'voiceChatOwner.get(this.context())');
  write(pages+'GatewaySettings.ets',settingsPage);
  write(pages+'DebugTools.ets',fs.readFileSync(path.join(root,'probes/harmony-noticechat/DebugTools.ets'),'utf8'));
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
  write(pages+'VoiceChat.ets',fs.readFileSync(path.join(root,'probes/harmony-noticechat/DemoVoiceChat.ets'),'utf8'));
  let ability=fs.readFileSync(path.join(root,'probes/harmony-voicechat/EntryAbility.ets'),'utf8');
  ability="import { AppTheme } from '../ui/AppTheme';\nimport { nativeReminderOwner } from '../pages/NativeReminderOwner';\nimport { taskAgentSpeechOwner } from '../pages/TaskAgentSpeechOwner';\nimport { noticeSpeechOwner } from '../pages/NoticeSpeechOwner';\n"+ability;
  ability=replaceOnce(ability,"onWindowStageCreate(stage: window.WindowStage): void { stage.loadContent('pages/VoiceChat'); }",
    "onWindowStageCreate(stage: window.WindowStage): void { try { stage.getMainWindowSync().setWindowSystemBarProperties({ statusBarColor: AppTheme.canvas, statusBarContentColor: AppTheme.ink, navigationBarColor: AppTheme.canvas, navigationBarContentColor: AppTheme.ink }).catch(() => {}); } catch (_) {} nativeReminderOwner.get(this.context); stage.loadContent('pages/TaskAssistant'); }");
  ability=replaceOnce(ability,'  onDestroy(): void {','  onForeground(): void { nativeReminderOwner.refresh(); }\n  onDestroy(): void { nativeReminderOwner.destroy();');
  ability=ability.replaceAll('voiceChatOwner.pause();','taskAgentSpeechOwner.pause(); noticeSpeechOwner.pause(); voiceChatOwner.pause();');
  ability=ability.replaceAll('voiceChatOwner.destroy();','taskAgentSpeechOwner.destroy(); noticeSpeechOwner.destroy(); voiceChatOwner.destroy();');
  write('entry/src/main/ets/entryability/EntryAbility.ets',ability);
  const nativeModulePath=path.join(result.output,'entry/src/main/module.json5');
  const nativeModule=JSON.parse(fs.readFileSync(nativeModulePath,'utf8'));
  nativeModule.module.requestPermissions.push({name:'ohos.permission.PUBLISH_AGENT_REMINDER'});
  for(const permission of ['ohos.permission.READ_CALENDAR','ohos.permission.WRITE_CALENDAR'])
    nativeModule.module.requestPermissions.push({name:permission,reason:'$string:calendar_reminder_permission_reason',usedScene:{abilities:['EntryAbility'],when:'inuse'}});
  fs.writeFileSync(nativeModulePath,JSON.stringify(nativeModule,null,2)+'\n');
  const appFile=path.join(result.output,'AppScope/app.json5');
  const app=JSON.parse(fs.readFileSync(appFile,'utf8'));
  app.app.bundleName='com.campusddl.noticeprobe';app.app.versionName='0.8.2';app.app.versionCode=802;
  fs.writeFileSync(appFile,JSON.stringify(app,null,2)+'\n');
  const stringsFile=path.join(result.output,'entry/src/main/resources/base/element/string.json');
  const strings=JSON.parse(fs.readFileSync(stringsFile,'utf8'));
  for(const row of strings.string)if(row.name==='EntryAbility_label')row.value='课事清';
  strings.string.push({name:'calendar_reminder_permission_reason',value:'用于管理课事清专用任务日历及到期提醒'});
  fs.writeFileSync(stringsFile,JSON.stringify(strings,null,2)+'\n');
  write('entry/src/main/resources/base/profile/main_pages.json',JSON.stringify({src:[
    'pages/TaskAssistant','pages/Tasks','pages/Schedule','pages/GatewaySettings','pages/DebugTools','pages/MascotPreview','pages/CoverPreview','pages/StylePreview','pages/VoiceChat','pages/NoticeChat','pages/SpeechProbe'
  ]},null,2)+'\n');
  for(const file of ['T15-VOICE-CHAT-ONLY.txt','T15-source-manifest.json'])fs.unlinkSync(path.join(result.output,file));
  write('T19-NOTICE-INTERACTION-ONLY.txt',
    'Shared production confirmation flow with a native speech port. Explicit client confirmation uses T16 v2/v3.\n'+
    'New independent version. Unsigned/uninstalled until explicit device evidence is recorded.\n');
  brand(result.output);
  const hashes={};
  for(const file of [pages+'NoticeChat.ets',pages+'NoticeSpeechOwner.ets',
    'entry/src/main/ets/notice/NoticeImportController.ts','entry/src/main/ets/notice/NoticeVoiceController.ts',
    'entry/src/main/ets/notice/NoticeConfirmedWriter.ts','entry/src/main/ets/notice/NoticeSaveController.ts',
    'entry/src/main/ets/notice/NoticeImportOwner.ts','entry/src/main/ets/speech/UnavailableSpeechSession.ts',
    'entry/src/main/ets/notice/NoticeLeaveGuard.ts', pages+'TaskAssistant.ets',pages+'TaskAgentSpeechOwner.ets',
    'entry/src/main/ets/agent/TaskAgentController.ts','entry/src/main/ets/agent/TaskAgentSession.ts',
    pages+'VoiceChat.ets','entry/src/main/ets/entryability/EntryAbility.ets',pages+'HarmonySpeechPort.ets',pages+'SpeechProbeController.ts',
    pages+'Tasks.ets','entry/src/main/ets/tasks/TaskBoardController.ts',pages+'NativeReminderOwner.ets',pages+'HarmonyReminderPort.ets',
    'entry/src/main/ets/reminders/ReminderPlan.ts','entry/src/main/ets/reminders/ReminderService.ts',
    'entry/src/main/ets/reminders/ReminderSettings.ts','entry/src/main/ets/reminders/TaskReminderController.ts',
    'entry/src/main/ets/reminders/ReminderOwner.ets','entry/src/main/ets/data/ClientStorage.ets','entry/src/main/ets/data/LocalStore.ts',
    'entry/src/main/ets/domain/CommitModels.ts','entry/src/main/ets/domain/CommitValidation.ts','entry/src/main/ets/domain/MaterialCommitValidation.ts',
    'entry/src/main/ets/domain/TaskStateRules.ts','entry/src/main/ets/data/CommitServices.ts','entry/src/main/ets/tasks/TaskActionsController.ts',
    'entry/src/main/ets/agent/AgentTools.ts','entry/src/main/ets/planning/WeekPlanner.ts',
    'entry/src/main/ets/planning/PlanningContracts.ts','entry/src/main/ets/planning/PlanningRules.ts','entry/src/main/ets/planning/PlanningValidation.ts',
    'entry/src/main/ets/planning/PlanningController.ts','entry/src/main/ets/planning/PlanningForm.ts',pages+'Schedule.ets',
    'entry/src/main/ets/planning/PlanningQuery.ts','entry/src/main/ets/agent/AgentExecutor.ts',
    'entry/src/main/ets/domain/OperationIdentity.ts',
    'entry/src/main/ets/reminders/CalendarReminderPort.ts',pages+'HarmonyCalendarAccess.ets',
    pages+'GatewaySettings.ets',pages+'DebugTools.ets',
    ...['ui/AppTheme.ets','ui/AppTabBar.ets','ui/DeadlineEditor.ets','ui/DeadlineInput.ts','ui/AvailabilityEditor.ets','ui/AssistantMotion.ts','ui/AssistantMascot.ets','pages/MascotPreview.ets','ui/BrandCover.ets','pages/CoverPreview.ets','ui/MessageBubble.ets','pages/StylePreview.ets'].map(f=>'entry/src/main/ets/'+f),
    ...['brand_mark','nav_assistant','nav_tasks','nav_schedule','nav_settings'].map(f=>'entry/src/main/resources/base/media/'+f+'.svg'),'AppScope/app.json5',
    ...['assistant_idle','assistant_blink_sheet','assistant_wave_sheet','assistant_think_sheet','assistant_write_sheet','assistant_cover_v1'].map(f=>'entry/src/main/resources/base/media/'+f+'.png'),
    'AppScope/resources/base/media/assistant_idle.png','AppScope/resources/base/media/brand_mark.svg','AppScope/resources/base/element/string.json','AppScope/resources/zh_CN/element/string.json','AppScope/resources/en_US/element/string.json',
    'entry/src/main/resources/base/element/color.json','entry/src/main/module.json5','entry/src/main/resources/base/element/string.json','entry/src/main/resources/zh_CN/element/string.json','entry/src/main/resources/en_US/element/string.json'])
    hashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(result.output,file))).digest('hex');
  const manifest={...result,scope:'T19-local-integration',bundleName:app.app.bundleName,versionCode:802,formalSaveEnabled:true,hashes};
  write('T19-source-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
if(require.main===module)console.log(JSON.stringify(prepare(process.argv[2]),null,2));
module.exports={prepare};
