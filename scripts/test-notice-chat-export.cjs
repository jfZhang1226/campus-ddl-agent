const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {prepare} = require('./prepare-notice-chat.cjs');
const root = path.resolve(__dirname,'..');
const runtime = path.join(root,'runtime');fs.mkdirSync(runtime,{recursive:true});
const testRoot = fs.mkdtempSync(path.join(runtime,'t19-export-'));
const output = path.join(testRoot,'export');
const read = file => fs.readFileSync(path.join(output,file),'utf8');
const json = file => JSON.parse(read(file));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = cp.execFileSync('git',['status','--porcelain','--','client/'],{cwd:root,encoding:'utf8'});
const manifest = prepare(output);
let count=0;
function check(name,run) {run();count++;console.log('PASS '+name);}
check('independent bundle, empty signing and explicit mic/internet/reminder permissions',()=>{
  assert.equal(json('AppScope/app.json5').app.bundleName,'com.campusddl.noticeprobe');
  assert.deepEqual(json('build-profile.json5').app.signingConfigs,[]);
  assert.deepEqual(json('entry/src/main/module.json5').module.requestPermissions.map(x=>x.name).sort(),
    ['ohos.permission.INTERNET','ohos.permission.MICROPHONE','ohos.permission.PUBLISH_AGENT_REMINDER','ohos.permission.READ_CALENDAR','ohos.permission.WRITE_CALENDAR']);
});
check('actual page assembly wires trusted confirmation, recovery and readback without base CRUD',()=>{
  const page=read('entry/src/main/ets/pages/NoticeChat.ets');
  assert.match(page,/metadataOpen: boolean = false/);
  assert.match(page,/发送通知原文/);assert.match(page,/保留修改并继续整理/);
  assert.match(page,/notice-confirm'\)\.enabled\(!this.busy\(\) && this.view.phase !== 'saved'\)/);
  assert.match(page,/NoticeSaveController/);assert.doesNotMatch(page,/new NoticeImportRepository|NoticeCommitGate/);
  assert.match(page,/noticeSpeechOwner\.get/);assert.match(page,/voiceChatOwner\.get\(context\)\.configuration/);
  assert.match(page,/controller.restore\(\)/);assert.match(page,/notice-readback/);assert.match(page,/notice-discard-pending/);
  assert.match(page,/setExpectedRevision\(revision.data.revision\)/);
  assert.doesNotMatch(page,/const revision = \{/);
  const writer=read('entry/src/main/ets/notice/NoticeConfirmedWriter.ts');
  assert.match(writer,/commits.confirmation.apply/);assert.doesNotMatch(writer,/\.store.save\(/);
});
check('record, end, cancel, manual draft playback and immediate stop are reachable',()=>{
  const page=read('entry/src/main/ets/pages/NoticeChat.ets');
  for(const id of ['notice-record','notice-finish','notice-cancel-voice','notice-speak','notice-stop-speech'])
    assert.ok(page.includes(".id('"+id+"')"));
  assert.match(read('entry/src/main/ets/pages/DebugTools.ets'),/pages\/NoticeChat/);
  assert.deepEqual(json('entry/src/main/resources/base/profile/main_pages.json').src,
    ['pages/TaskAssistant','pages/Tasks','pages/Schedule','pages/GatewaySettings','pages/DebugTools','pages/MascotPreview','pages/VoiceChat','pages/NoticeChat','pages/SpeechProbe']);
});
check('native owner and lifecycle release are confined to the exported assembly',()=>{
  const ability=read('entry/src/main/ets/entryability/EntryAbility.ets');
  assert.match(ability,/onBackground.*noticeSpeechOwner\.pause/);
  assert.match(ability,/onDestroy.*noticeSpeechOwner\.destroy/);
  const port=read('entry/src/main/ets/notice/NoticeVoiceController.ts');
  assert.doesNotMatch(port,/\.\.\/\.\.\/client\//);
  assert.equal(json('.arkui-x/arkui-x-config.json5').buildOption.ignoreCrossPlatform,true);
});
check('native assembly keeps the same leave guard and does not bypass explicit keep/discard',()=>{
  const page=read('entry/src/main/ets/pages/NoticeChat.ets');
  assert.match(page,/NoticeLeaveGuard/);assert.match(page,/onBackPress\(\): boolean \{\s*return this.interceptBack\(\)/);
  for(const id of ['notice-back','notice-leave-title','notice-leave-keep','notice-leave-confirm'])assert.ok(page.includes(".id('"+id+"')"));
  assert.equal(read('entry/src/main/ets/notice/NoticeLeaveGuard.ts'),fs.readFileSync(path.join(root,'client/entry/src/main/ets/notice/NoticeLeaveGuard.ts'),'utf8'));
});
check('production pages and client files are preserved except explicit export configuration',()=>{
  const changed=new Set(['build-profile.json5','.arkui-x/arkui-x-config.json5','AppScope/app.json5',
    'entry/src/main/module.json5','entry/src/main/resources/base/element/string.json',
    'entry/src/main/ets/entryability/EntryAbility.ets','entry/src/main/resources/base/profile/main_pages.json',
    'entry/src/main/ets/pages/TaskAssistant.ets','entry/src/main/ets/pages/Tasks.ets',
    'entry/src/main/ets/pages/GatewaySettings.ets','entry/src/main/ets/pages/DebugTools.ets']);
  const files=cp.execFileSync('git',['ls-files','-z','client/'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const file of files)if(!changed.has(file.slice(7)))
    assert.equal(hash(path.join(root,file)),hash(path.join(output,file.slice(7))),file);
  assert.equal(cp.execFileSync('git',['status','--porcelain','--','client/'],{cwd:root,encoding:'utf8'}),before);
});
check('manifest matches actual source outputs and existing export is refused without overwrite',()=>{
  assert.equal(manifest.formalSaveEnabled,true);assert.equal(manifest.versionCode,700);assert.equal(Object.keys(manifest.hashes).length,77);
  for(const [file,expected]of Object.entries(manifest.hashes))assert.equal(hash(path.join(output,file)),expected);
  const prior=hash(path.join(output,'T19-source-manifest.json'));
  assert.throws(()=>prepare(output),/new output directory/);
  assert.equal(hash(path.join(output,'T19-source-manifest.json')),prior);
  assert.equal(fs.existsSync(path.join(output,'T15-source-manifest.json')),false);
  assert.match(read('T19-NOTICE-INTERACTION-ONLY.txt'),/Explicit client confirmation uses T16 v2/);
});
check('reminder capability stays native while default shared page and journal use existing storage',()=>{
  assert.match(read('entry/src/main/ets/pages/Tasks.ets'),/nativeReminderOwner as reminderOwner/);
  const port=read('entry/src/main/ets/pages/HarmonyReminderPort.ets');
  assert.match(port,/getAllValidReminders/);assert.match(port,/TimeZoneType.FIXED_TIME_ZONE/);
  assert.doesNotMatch(port,/cancelAllReminders/);
  assert.match(read('entry/src/main/ets/entryability/EntryAbility.ets'),/onForeground.*nativeReminderOwner.refresh/);
});
check('task dialogue native owner supplies speech while shared business, validation and explicit confirmation stay identical',()=>{
  const page=read('entry/src/main/ets/pages/TaskAssistant.ets'),owner=read('entry/src/main/ets/pages/TaskAgentSpeechOwner.ets');
  assert.match(owner,/new SpeechProbeController\(new HarmonySpeechPort\(context\), clock\)/);
  assert.match(owner,/storage.local, clock, speech/);assert.match(page,/taskAgentSpeechOwner as taskAgentOwner/);
  assert.match(page,/voiceChatOwner.get\(context\).configuration/);
  for(const file of ['agent/TaskAgentController.ts','agent/TaskAgentSession.ts'])assert.equal(read('entry/src/main/ets/'+file),fs.readFileSync(path.join(root,'client/entry/src/main/ets',file),'utf8'));
  const ability=read('entry/src/main/ets/entryability/EntryAbility.ets');
  assert.match(ability,/onBackground.*taskAgentSpeechOwner.pause/);assert.match(ability,/onDestroy.*taskAgentSpeechOwner.destroy/);
});
check('task detail and candidate choices call actual controllers without bypassing confirmation',()=>{
  const page=read('entry/src/main/ets/pages/Tasks.ets'),dialogue=read('entry/src/main/ets/pages/TaskAssistant.ets');
  assert.match(page,/new TaskActionsController\(storage.local, storage.tasks, storage.commits\)/);
  assert.match(page,/task-action-confirm/);assert.match(page,/this.actionsController\?\.confirm\(\)/);
  assert.match(page,/hasLocalChanges/);assert.match(page,/submissionChannel/);assert.match(page,/entry.materials/);
  assert.match(dialogue,/task-agent-choose-/);assert.match(dialogue,/this.controller\?\.chooseTask\(task.id\)/);
  assert.match(dialogue,/selectedTask.notices/);
  assert.match(page,/item.itemId \+ ':' \+ item.state \+ ':' \+ item.originalState/);
});
check('calendar access uses explicit app account and narrow permissions; shared owner remains unavailable by default',()=>{
  const access=read('entry/src/main/ets/pages/HarmonyCalendarAccess.ets');
  assert.match(access,/getCalendar\(this.account\)/);assert.match(access,/EventFilter.filterById/);assert.match(access,/ensureLegacyClear/);
  assert.doesNotMatch(access,/getAllCalendars|getCalendar\(\)|getCalendar\(undefined/);
  assert.doesNotMatch(access,/getEvents\(undefined/);
  assert.match(access,/EventFilter.filterByTime\(0, 4102444800000\)/);
  assert.match(read('entry/src/main/ets/pages/NativeReminderOwner.ets'),/new CalendarReminderPort\(new HarmonyCalendarAccess\(context\)\)/);
  assert.doesNotMatch(JSON.stringify(json('entry/src/main/module.json5')),/WHOLE_CALENDAR/);
  const permissions=json('entry/src/main/module.json5').module.requestPermissions;
  assert.ok(permissions.filter(p=>/READ_CALENDAR|WRITE_CALENDAR/.test(p.name)).every(p=>p.reason==='$string:calendar_reminder_permission_reason'&&p.usedScene.when==='inuse'));
});
check('work schedule route shares original storage and screen confirmation without model or direct writes',()=>{
  assert.ok(json('entry/src/main/resources/base/profile/main_pages.json').src.includes('pages/Schedule'));
  const page=read('entry/src/main/ets/pages/Schedule.ets');
  assert.match(page,/new PlanningController\(storage.local, storage.commits\)/);
  assert.match(page,/id\('plan-confirm'\)/);assert.match(page,/this.controller\?\.confirm\(\)/);
  assert.match(read('entry/src/main/ets/pages/Tasks.ets'),/url: 'pages\/Schedule'/);
  assert.doesNotMatch(page,/\.local.save\(|\.tasks.update\(|fetch\(/);
});
check('all launcher locales survive consecutive fresh exports and root uses the task assistant',()=>{
  for(const scope of ['AppScope/resources','entry/src/main/resources'])for(const locale of ['base','zh_CN','en_US']) {
    const file=scope+'/'+locale+'/element/string.json';
    for(const name of ['app_name','EntryAbility_label']) {
      assert.equal(json(file).string.find(x=>x.name===name).value,'课事清');
      assert.equal(JSON.parse(fs.readFileSync(path.join(root,'client',file),'utf8')).string.find(x=>x.name===name).value,'课事清');
    }
  }
  assert.match(read('entry/src/main/ets/entryability/EntryAbility.ets'),/loadContent\('pages\/TaskAssistant'\)/);
  const second=path.join(testRoot,'second-export'); prepare(second);
  for(const file of Object.keys(manifest.hashes))assert.equal(hash(path.join(second,file)),hash(path.join(output,file)));
});
check('one native gateway owner serves settings and task page without duplicate credential forms',()=>{
  const settings=read('entry/src/main/ets/pages/GatewaySettings.ets');
  assert.match(settings,/voiceChatOwner.get\(this.context\(\)\).configuration\(\)/);
  assert.match(settings,/voiceChatOwner.get\(this.context\(\)\).configure\(config\)/);
  assert.match(settings,/current.token/);assert.match(settings,/validateConfig/);
  assert.doesNotMatch(read('entry/src/main/ets/pages/VoiceChat.ets'),/voice-gateway-token|voice-configure/);
  assert.match(read('entry/src/main/ets/pages/TaskAssistant.ets'),/onPageShow\(\): void \{ this.mascotActive = true; this.syncGateway\(\); \}/);
  assert.match(read('entry/src/main/ets/pages/TaskAssistant.ets'),/AppTabBar/);
  assert.match(read('entry/src/main/ets/ui/AppTabBar.ets'),/pages\/Tasks/);
  assert.match(read('entry/src/main/ets/ui/AppTabBar.ets'),/pages\/Schedule/);
});
console.log(`${count} T19 source-export checks passed. No signing, network, microphone or device calls.`);
