const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {prepare}=require('./prepare-shared-notice.cjs');
const {prepare:prepareNative}=require('./prepare-notice-chat.cjs');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'runtime');fs.mkdirSync(runtime,{recursive:true});
const dir=fs.mkdtempSync(path.join(runtime,'t19-shared-export-')),output=path.join(dir,'shared'),nativeOutput=path.join(dir,'native');
const manifest=prepare(output),native=prepareNative(nativeOutput);
const read=f=>fs.readFileSync(path.join(output,f),'utf8'),json=f=>JSON.parse(read(f));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let count=0;function check(name,f){f();count++;console.log('PASS '+name);}
check('separate shared-entry identity, original routes, internet only and no signing',()=>{
 assert.equal(json('AppScope/app.json5').app.bundleName,'com.campusddl.noticeentry');
 assert.equal(json('AppScope/app.json5').app.versionCode,300);
 assert.deepEqual(json('build-profile.json5').app.signingConfigs,[]);
 assert.deepEqual(json('entry/src/main/module.json5').module.requestPermissions.map(p=>p.name),['ohos.permission.INTERNET']);
 assert.equal(read('entry/src/main/resources/base/profile/main_pages.json'),fs.readFileSync(path.join(root,'client/entry/src/main/resources/base/profile/main_pages.json'),'utf8'));
});
check('actual production page uses the unique application storage and trusted confirmation',()=>{
 const page=read('entry/src/main/ets/pages/NoticeImport.ets');
 assert.match(page,/new NoticeSaveController/);assert.match(page,/new NoticeConfirmedWriter\(storage.local, storage.commits\)/);
 assert.doesNotMatch(page,/new NoticeImportRepository|new LocalStore|new StorageCoordinator|@kit.CoreSpeechKit|noticeSpeechOwner/);
 assert.match(page,/await this.controller.restore\(\)/);assert.match(page,/setExpectedRevision\(revision.data.revision\)/);
});
check('page lifetime and background use the shared import owner without mutating the chat owner',()=>{
 const page=read('entry/src/main/ets/pages/NoticeImport.ets'),ability=read('entry/src/main/ets/entryability/EntryAbility.ets');
 assert.match(page,/noticeImportOwner.claim\(controller\)/);assert.match(page,/noticeImportOwner.release\(this.controller\)/);
 assert.match(page,/version !== this.initializationVersion/);assert.match(page,/this.pageAlive = false/);
 assert.equal((ability.match(/noticeImportOwner.pause\(\)/g)||[]).length,2);assert.match(ability,/noticeImportOwner.destroy\(\)/);
 assert.match(ability,/chatOwner.pause\(\)/);assert.match(ability,/chatOwner.destroy\(\)/);
});
check('pending editing is disabled while confirm, explicit discard and real readback remain reachable',()=>{
 const page=read('entry/src/main/ets/pages/NoticeImport.ets');
 assert.ok((page.match(/\.enabled\(this.editable\(\)\)/g)||[]).length>=2);
 for(const id of ['notice-confirm','notice-discard-pending','notice-recover-pending','notice-readback'])assert.ok(page.includes(".id('"+id+"')"));
 assert.match(page,/this.leaveGuard.request\(this.view, this.save.busy, this.save.locked/);
 assert.match(read('entry/src/main/ets/notice/NoticeLeaveGuard.ts'),/commitBusy \|\| view.phase === 'saving'/);
 assert.match(page,/save.saved.task.title/);assert.match(page,/save.saved.checklistItems/);
});
check('all tracked production sources and cross-platform settings remain byte identical in this export',()=>{
 const changed=new Set(['AppScope/app.json5','build-profile.json5','entry/src/main/resources/base/element/string.json']);
 const files=cp.execFileSync('git',['ls-files','-z','client/'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 for(const f of files)if(!changed.has(f.slice(7)))assert.equal(hash(path.join(root,f)),hash(path.join(output,f.slice(7))),f);
});
check('shared and native entry exports contain the exact same confirmation implementations',()=>{
 for(const file of ['notice/NoticeImportController.ts','notice/NoticeVoiceController.ts','notice/NoticeConfirmedWriter.ts',
   'notice/NoticeSaveController.ts','notice/NoticeImportOwner.ts','speech/UnavailableSpeechSession.ts']) {
  const f='entry/src/main/ets/'+file;assert.equal(hash(path.join(output,f)),hash(path.join(nativeOutput,f)),file);
 }
 assert.equal(fs.existsSync(path.join(nativeOutput,'entry/src/main/ets/pages/NoticeConfirmedWriter.ts')),false);
 assert.equal(native.versionCode,1000);
});
check('recovery diagnostics remain isolated and do not import production application storage',()=>{
 const page=read('entry/src/main/ets/pages/CommitCheck.ets'),probe=read('entry/src/main/ets/data/diagnostics/NoticeRecoveryProbe.ts');
 assert.match(page,/new ArkFilePort\(context.filesDir, namespace\)/);assert.match(page,/campus-ddl-t19-recovery-/);
 assert.doesNotMatch(probe,/getClientStorage|ArkNoticeExtractionTransport|@kit.CoreSpeechKit/);
 for(const name of ['beginNoticeRecoveryProbe','inspectNoticeRecoveryProbe','confirmNoticeRecoveryProbe','cancelNoticeRecoveryProbe'])assert.ok(page.includes(name));
});
check('header and system back share a content-preserving guard with explicit keep/leave controls',()=>{
 const page=read('entry/src/main/ets/pages/NoticeImport.ets'),guard=read('entry/src/main/ets/notice/NoticeLeaveGuard.ts');
 assert.match(page,/onBackPress\(\): boolean \{\s*return this.interceptBack\(\)/);
 for(const id of ['notice-back','notice-leave-title','notice-leave-keep','notice-leave-confirm'])assert.ok(page.includes(".id('"+id+"')"));
 assert.match(page,/this.leaveGuard.confirmLeave/);assert.match(page,/this.controller\?\.cancelVoice\(\)/);
 assert.doesNotMatch(guard,/from .*CommitServices|from .*LocalStore|from .*router|\.cancelPending\(/);
});
check('shared and native confirmation cards show material origin before saving without claiming proof',()=>{
 for(const outputDir of [output,nativeOutput]) {
  const file=path.join(outputDir,'entry/src/main/ets/pages',outputDir===output?'NoticeImport.ets':'NoticeChat.ets');
  const page=fs.readFileSync(file,'utf8');
  assert.match(page,/this.view.materialFromNotice\[index\] \? '通知提取 · 待核对' : '人工补充或修改'/);
  assert.ok(page.includes(".id('notice-material-origin-' + String(index))"));
  assert.match(page,/sourceNoticeId === null \? '人工补充或修改' : '通知提取'/);
 }
});
check('both entry headers expose stop only during extraction, outside disabled editing fields',()=>{
 for(const [dir,name] of [[output,'NoticeImport.ets'],[nativeOutput,'NoticeChat.ets']]) {
  const page=fs.readFileSync(path.join(dir,'entry/src/main/ets/pages',name),'utf8');
  const header=page.slice(page.indexOf('  header()'),page.indexOf('  leaveConfirmation()'));
  assert.match(header,/if \(this.view.phase === 'extracting'\)/);
  assert.ok(header.includes(".id('notice-stop-extraction')"));
  assert.match(header,/this.controller\?\.stopExtraction\(\)/);
  assert.doesNotMatch(header,/\.enabled\(this.editable\(\)\)/);
 }
});
check('task dialogue uses one application storage, actual history/stage and screen-only confirmation',()=>{
 const page=read('entry/src/main/ets/pages/TaskAssistant.ets'),owner=read('entry/src/main/ets/agent/TaskAgentOwner.ets');
 assert.match(read('entry/src/main/ets/pages/Index.ets'),/task-agent-entry/);
 assert.ok(json('entry/src/main/resources/base/profile/main_pages.json').src.includes('pages/TaskAssistant'));
 assert.match(owner,/getClientStorage\(context.filesDir\)/);assert.match(owner,/storage.local, storage.commits, storage.sessions/);
 for(const id of ['task-agent-input','task-agent-send','task-agent-confirm','task-agent-sources','task-agent-recover'])assert.ok(page.includes(id));
 assert.match(page,/task-agent-saved-sources-/);assert.match(page,/ForEach\(detail.notices/);
 assert.match(page,/source.rawText/);assert.match(page,/source.publishedAt === null \? '未知'/);
 const session=read('entry/src/main/ets/agent/TaskAgentSession.ts');
 assert.match(session,/draft.notices.length !== 0/);assert.match(session,/sha256Hex/);assert.match(session,/publishedAt: null/);
 assert.match(read('entry/src/main/ets/entryability/EntryAbility.ets'),/taskAgentOwner.pause\(\)/);
});
check('manifest matches sources and existing output cannot be overwritten',()=>{
 assert.equal(manifest.signed,false);assert.equal(manifest.deviceValidated,false);assert.equal(Object.keys(manifest.hashes).length,46);
 for(const [f,value]of Object.entries(manifest.hashes))assert.equal(hash(path.join(output,f)),value);
 assert.throws(()=>prepare(output),/new output directory/);
});
console.log(`${count} shared notice-entry export checks passed. No device or model calls.`);
