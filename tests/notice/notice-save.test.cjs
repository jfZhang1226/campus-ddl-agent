const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {NoticeConfirmedWriter,NOTICE_IMPORT_SESSION}=require('../../probes/harmony-noticechat/NoticeConfirmedWriter.ts');
const {NoticeSaveController}=require('../../probes/harmony-noticechat/NoticeSaveController.ts');
const {NoticeImportOwner}=require('../../client/entry/src/main/ets/notice/NoticeImportOwner.ts');
const {CommitServices}=require('../../client/entry/src/main/ets/data/CommitServices.ts');
const {LocalStore}=require('../../client/entry/src/main/ets/data/LocalStore.ts');
const {StorageCoordinator}=require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const {TaskRepository}=require('../../client/entry/src/main/ets/data/TaskRepository.ts');
const {TaskDraft}=require('../../client/entry/src/main/ets/domain/TaskContracts.ts');
const {GatewayConfig,GatewayResponse}=require('../../client/entry/src/main/ets/chat/ChatModels.ts');
const {NoticeImportInput}=require('../../client/entry/src/main/ets/data/NoticeImportRepository.ts');
const {NoticeImportRepository}=require('../../client/entry/src/main/ets/data/NoticeImportRepository.ts');
const {ProposalDraft,TaskChangeDraft}=require('../../client/entry/src/main/ets/domain/CommitModels.ts');
const fixture=require('../../fixtures/extraction/notice-draft-samples.json').samples[0].draft;
const runtimeRoot=path.resolve(__dirname,'../../runtime/t19-save-tests');
const clone=x=>structuredClone(x),tick=()=>new Promise(r=>setImmediate(r));
const recovery=require('../../client/entry/src/main/ets/data/diagnostics/NoticeRecoveryProbe.ts');
const {NoticeLeaveGuard}=require('../../client/entry/src/main/ets/notice/NoticeLeaveGuard.ts');
const {NoticeImportState}=require('../../client/entry/src/main/ets/notice/NoticeImportController.ts');
const ok=r=>{assert.equal(r.success,true,r.message);return r.data;};
class Files {
 constructor(root){this.root=root;this.fail='';this.lose=false;this.badRead=false;}
 file(n){const p=path.resolve(this.root,n);assert.ok(p===this.root||p.startsWith(this.root+path.sep));return p;}
 check(op,n){if(this.fail===op+':'+n){this.fail='';throw Error('synthetic file failure');}}
 async ensureDirectory(n){await fs.mkdir(this.file(n),{recursive:true});}
 async exists(n){try{await fs.stat(this.file(n));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 async readText(n){this.check('read',n);if(this.badRead)throw Error('synthetic unreadable');return fs.readFile(this.file(n),'utf8');}
 async writeText(n,s){this.check('write',n);const f=await fs.open(this.file(n),'w');try{await f.writeFile(s);await f.sync();}finally{await f.close();}}
 async replace(a,b){this.check('replace',b);await fs.rename(this.file(a),this.file(b));if(b==='task-store.json'&&this.lose){this.lose=false;throw Error('synthetic lost acknowledgement');}}
 async listNames(n){return fs.readdir(this.file(n));}
}
class Runtime {n=0;now(){return '2026-11-14T14:00:00+08:00';}nextId(prefix='task'){return prefix+'-synthetic-'+ ++this.n;}}
class Speech {view={phase:'idle',busy:false,text:'',partial:'',errorCode:''};subscribe(f){this.f=f;f(this.view);}edit(){}async record(){}finishRecording(){}cancel(){}async speak(){}dispose(){}}
async function setup(t,existing,withSpeech=true){
 await fs.mkdir(runtimeRoot,{recursive:true});const root=existing||await fs.mkdtemp(path.join(runtimeRoot,'case-'));
 if(!existing)t.after(async()=>{assert.ok(root.startsWith(runtimeRoot+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const files=new Files(root),runtime=new Runtime(),store=new LocalStore(new StorageCoordinator(files));
 const commits=new CommitServices(store,runtime),writer=new NoticeConfirmedWriter(store,commits,runtime),calls=[];
 const controller=new NoticeSaveController({start(_config,request){const c={request,cancel(){this.cancelled=true;}};c.result=new Promise(resolve=>c.resolve=resolve);calls.push(c);return c;}},writer,withSpeech?new Speech():undefined);
 controller.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));
 return {root,files,runtime,store,commits,writer,controller,calls};
}
async function ready(h,draft=fixture){h.controller.setRawText(draft.notice.rawText);h.controller.extract();h.calls.at(-1).resolve(new GatewayResponse(200,JSON.stringify({type:'draft',draft:clone(draft)})));await tick();}
const bytes=h=>fs.readFile(path.join(h.root,'task-store.json'),'utf8');
function input(){const x=new NoticeImportInput();x.draft=clone(fixture);x.materialFromNotice=x.draft.checklistItems.map(()=>true);return x;}

test('empty and already saved notice pages can leave without inventing an unsaved draft',()=>{
 const g=new NoticeLeaveGuard(),v=new NoticeImportState();assert.equal(g.request(v,false,false,false),'leave');
 v.phase='saved';v.rawText=fixture.notice.rawText;v.draft=clone(fixture);assert.equal(g.request(v,false,false,false),'leave');
 assert.equal(g.snapshot().kind,'closed');assert.equal(g.confirmLeave(v,false,false,false),'blocked');
});
test('repeated back never bypasses the existing prompt, including a stopped empty capture',()=>{
 const g=new NoticeLeaveGuard(),v=new NoticeImportState();assert.equal(g.request(v,false,false,true),'prompt');
 assert.equal(g.request(v,false,false,false),'prompt');assert.equal(g.snapshot().kind,'discard');
 g.keepEditing();v.sourceLabel='合成来源';assert.equal(g.request(v,false,false,false),'prompt');
 g.keepEditing();v.sourceLabel='';v.publishedAt='2026-11-16T08:00:00+08:00';assert.equal(g.request(v,false,false,false),'prompt');
});
test('keeping an edited model draft preserves raw text, edits, provenance and business bytes without another model call',async t=>{
 const h=await setup(t,undefined,false);await h.controller.restore();await ready(h);h.controller.edit('title','合成：保留修改');
 h.controller.addMaterial();h.controller.setMaterial(2,'合成手工附件');const before=h.controller.snapshot(),saved=await bytes(h).catch(()=>null),calls=h.calls.length,g=new NoticeLeaveGuard();
 assert.equal(g.request(before,false,false,false),'prompt');g.keepEditing();assert.deepEqual(h.controller.snapshot(),before);
 assert.equal(h.calls.length,calls);assert.equal(await bytes(h).catch(()=>null),saved);assert.equal(ok(await h.store.read()).tasks.length,0);
});
test('a response arriving during the navigation prompt can still be kept without resending',async t=>{
 const h=await setup(t,undefined,false),g=new NoticeLeaveGuard();h.controller.setRawText(fixture.notice.rawText);h.controller.extract();
 assert.equal(g.request(h.controller.snapshot(),false,false,false),'prompt');
 h.calls[0].resolve(new GatewayResponse(200,JSON.stringify({type:'draft',draft:clone(fixture)})));await tick();
 g.keepEditing();assert.equal(h.controller.snapshot().title,fixture.task.title);assert.equal(h.calls.length,1);
 assert.equal(ok(await h.store.read()).tasks.length,0);
});
test('explicitly leaving invalidates a pending extraction and never commits the late response',async t=>{
 const h=await setup(t,undefined,false),g=new NoticeLeaveGuard();h.controller.setRawText(fixture.notice.rawText);h.controller.extract();
 assert.equal(g.request(h.controller.snapshot(),false,false,false),'prompt');assert.equal(g.confirmLeave(h.controller.snapshot(),false,false,false),'leave');
 h.controller.pause();h.controller.dispose();h.calls[0].resolve(new GatewayResponse(200,JSON.stringify({type:'draft',draft:clone(fixture)})));await tick();
 assert.equal(h.calls[0].cancelled,true);assert.equal(h.controller.snapshot().draft,null);assert.equal(ok(await h.store.read()).tasks.length,0);
});
test('leaving a locked pending proposal never cancels it and a cold owner still requires confirmation',async t=>{
 const h=await setup(t,undefined,false);await recovery.beginNoticeRecoveryProbe(h.files,'apply-failure');await h.controller.restore();
 const before=await bytes(h),g=new NoticeLeaveGuard();assert.equal(g.request(h.controller.snapshot(),false,true,false),'prompt');
 assert.equal(g.snapshot().kind,'records');assert.equal(g.confirmLeave(h.controller.snapshot(),false,true,false),'leave');
 h.controller.pause();h.controller.dispose();const cold=await setup(t,h.root,false);await cold.controller.restore();
 assert.equal(cold.controller.saveSnapshot().locked,true);assert.equal(await bytes(cold),before);assert.equal(ok(await cold.store.read()).tasks.length,0);
});
test('a late recovered lock needs fresh navigation consent and committing blocks every leave path',()=>{
 const g=new NoticeLeaveGuard(),v=new NoticeImportState();v.rawText='合成原文';assert.equal(g.request(v,false,false,false),'prompt');
 assert.equal(g.confirmLeave(v,false,true,false),'prompt');assert.equal(g.snapshot().kind,'records');
 assert.equal(g.confirmLeave(v,true,true,false),'blocked');v.phase='saving';assert.equal(g.request(v,false,true,false),'blocked');
 assert.equal(g.confirmLeave(v,false,true,false),'blocked');v.phase='idle';assert.equal(g.confirmLeave(v,false,true,false),'leave');
});
test('uncertain pending recovery uses a records warning and leaving does not erase recovery traces',async t=>{
 const h=await setup(t,undefined,false);await ready(h);h.files.fail='replace:task-store.json';await h.controller.confirm();
 const temp=await fs.readFile(h.files.file('task-store.tmp.json'),'utf8'),g=new NoticeLeaveGuard();assert.equal(h.controller.saveSnapshot().locked,true);
 assert.equal(g.request(h.controller.snapshot(),false,true,false),'prompt');assert.equal(g.snapshot().kind,'records');
 assert.equal(g.confirmLeave(h.controller.snapshot(),false,true,false),'leave');h.controller.dispose();
 assert.equal(await fs.readFile(h.files.file('task-store.tmp.json'),'utf8'),temp);assert.equal((await h.store.read()).errorCode,'RECOVERY_REQUIRED');
});

for(const scenario of ['apply-failure','stage-ack-loss'])test('isolated recovery probe preserves pending IDs through a cold explicit confirm: '+scenario,async t=>{
 const h=await setup(t,undefined,false),report=await recovery.beginNoticeRecoveryProbe(h.files,scenario);
 assert.equal(report.phase,'pending');let snapshot=ok(await h.store.read());assert.equal(snapshot.tasks.length,0);
 const before=await bytes(h),reportBytes=await fs.readFile(h.files.file('t19-recovery-report.json'),'utf8');
 const coldFiles=new Files(h.root);assert.equal((await recovery.inspectNoticeRecoveryProbe(coldFiles)).phase,'pending');
 assert.equal(await bytes(h),before);assert.equal(await fs.readFile(h.files.file('t19-recovery-report.json'),'utf8'),reportBytes);
 const saved=await recovery.confirmNoticeRecoveryProbe(coldFiles);assert.equal(saved.phase,'applied');snapshot=ok(await h.store.read());
 assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.operations.length,1);assert.equal(snapshot.tasks[0].id,report.reservedTaskId);
 assert.deepEqual(snapshot.checklistItems.map(i=>i.id),report.materialIds);assert.equal(snapshot.checklistItems[1].sourceNoticeId,null);
 const after=await bytes(h);assert.equal((await recovery.inspectNoticeRecoveryProbe(new Files(h.root))).phase,'applied');assert.equal(await bytes(h),after);
});
test('isolated recovery probe recognizes committed replace acknowledgement loss without a second task',async t=>{
 const h=await setup(t,undefined,false),report=await recovery.beginNoticeRecoveryProbe(h.files,'apply-ack-loss');
 assert.equal(report.phase,'applied');const before=await bytes(h);assert.equal(ok(await h.store.read()).tasks.length,1);
 await recovery.inspectNoticeRecoveryProbe(new Files(h.root));await recovery.inspectNoticeRecoveryProbe(new Files(h.root));
 await assert.rejects(()=>recovery.confirmNoticeRecoveryProbe(h.files));await assert.rejects(()=>recovery.cancelNoticeRecoveryProbe(h.files));
 assert.equal(await bytes(h),before);assert.equal(ok(await h.store.read()).operations.length,1);
});
test('isolated same-instance retry retains the operation ID present in the failed candidate file',async t=>{
 const h=await setup(t,undefined,false),report=await recovery.beginNoticeRecoveryProbe(h.files,'same-instance-retry');
 assert.equal(report.phase,'applied');const snapshot=ok(await h.store.read());assert.equal(snapshot.operations.length,1);
 assert.equal(snapshot.operations[0].operationId,report.retriedOperationId);assert.equal(snapshot.proposals.length,1);
 assert.deepEqual(snapshot.checklistItems.map(i=>i.id),report.materialIds);const before=await bytes(h);
 await recovery.inspectNoticeRecoveryProbe(new Files(h.root));assert.equal(await bytes(h),before);
});
test('isolated conflict probe refuses stale confirmation and cancellation preserves the independent task',async t=>{
 const h=await setup(t,undefined,false),report=await recovery.beginNoticeRecoveryProbe(h.files,'conflict');
 assert.equal(report.phase,'conflict');const snapshot=ok(await h.store.read()),before=await bytes(h);
 await recovery.inspectNoticeRecoveryProbe(new Files(h.root));assert.equal((await recovery.confirmNoticeRecoveryProbe(new Files(h.root))).phase,'conflict');
 assert.equal(await bytes(h),before);const cancelled=await recovery.cancelNoticeRecoveryProbe(new Files(h.root));assert.equal(cancelled.phase,'cancelled');
 const after=ok(await h.store.read());assert.deepEqual(after.tasks,snapshot.tasks);assert.equal(after.tasks[0].id,report.independentTaskId);
 assert.equal(after.operations.length,0);assert.equal(after.checklistItems.length,0);assert.equal(after.proposals[0].state,'cancelled');
 const final=await bytes(h);await recovery.inspectNoticeRecoveryProbe(new Files(h.root));assert.equal(await bytes(h),final);
});
test('isolated recovery probe explicitly cancels pending without creating business entities or reviving a terminal',async t=>{
 const h=await setup(t,undefined,false);await recovery.beginNoticeRecoveryProbe(h.files,'apply-failure');
 await recovery.cancelNoticeRecoveryProbe(new Files(h.root));const before=await bytes(h),snapshot=ok(await h.store.read());
 assert.equal(snapshot.tasks.length,0);assert.equal(snapshot.notices.length,0);assert.equal(snapshot.operations.length,0);
 await recovery.inspectNoticeRecoveryProbe(new Files(h.root));await assert.rejects(()=>recovery.confirmNoticeRecoveryProbe(h.files));
 await assert.rejects(()=>recovery.cancelNoticeRecoveryProbe(h.files));assert.equal(await bytes(h),before);
});
test('recovery probe refuses existing data and invalid scenarios before creating a report',async t=>{
 const h=await setup(t,undefined,false);await assert.rejects(()=>recovery.beginNoticeRecoveryProbe(h.files,'unknown'));
 assert.deepEqual(await fs.readdir(h.root),[]);const draft=new TaskDraft();draft.title='已有合成控制任务';ok(await new TaskRepository(h.store,h.runtime).create(draft,0));
 const before=await bytes(h);await assert.rejects(()=>recovery.beginNoticeRecoveryProbe(h.files,'apply-failure'));
 assert.equal(await bytes(h),before);assert.equal(await h.files.exists('t19-recovery-report.json'),false);
});
test('starting a new recovery case cannot overwrite an existing synthetic case',async t=>{
 const h=await setup(t,undefined,false);await recovery.beginNoticeRecoveryProbe(h.files,'stage-ack-loss');const before=await bytes(h);
 const report=await fs.readFile(h.files.file('t19-recovery-report.json'),'utf8');await assert.rejects(()=>recovery.beginNoticeRecoveryProbe(h.files,'apply-failure'));
 assert.equal(await bytes(h),before);assert.equal(await fs.readFile(h.files.file('t19-recovery-report.json'),'utf8'),report);
});
test('recovery report mismatches block actions without rewriting the business snapshot',async t=>{
 const h=await setup(t,undefined,false);await recovery.beginNoticeRecoveryProbe(h.files,'apply-failure');const before=await bytes(h);
 const name=h.files.file('t19-recovery-report.json'),report=JSON.parse(await fs.readFile(name,'utf8'));report.primary+='synthetic corruption';await fs.writeFile(name,JSON.stringify(report));
 for(const action of [recovery.inspectNoticeRecoveryProbe,recovery.confirmNoticeRecoveryProbe,recovery.cancelNoticeRecoveryProbe])await assert.rejects(()=>action(h.files));
 assert.equal(await bytes(h),before);
});

test('actual controller keeps raw/model draft non-formal until explicit confirm',async t=>{
 const h=await setup(t);await h.controller.restore();await ready(h);
 const s=ok(await h.store.read());assert.equal(s.proposals.length,0);assert.equal(s.tasks.length,0);assert.equal(h.controller.saveSnapshot().saved,null);
});
test('actual confirmation saves card edits, original and manual materials, receipt and readback',async t=>{
 const h=await setup(t);await ready(h);h.controller.edit('title','合成：人工核对后的标题');h.controller.addMaterial();h.controller.setMaterial(2,'人工补充附件');
 await h.controller.confirm();assert.equal(h.controller.snapshot().phase,'saved');
 const s=ok(await h.store.read());assert.equal(s.revision,2);assert.equal(s.tasks.length,1);assert.equal(s.operations.length,1);
 assert.equal(s.tasks[0].title,'合成：人工核对后的标题');assert.equal(s.checklistItems.length,3);
 assert.equal(s.checklistItems[2].sourceNoticeId,null);assert.equal(s.checklistItems[0].sourceNoticeId,s.notices[0].id);
 assert.ok(s.checklistItems.every(i=>i.state==='pending'&&i.confirmedAt===null));
 assert.deepEqual(s.operations[0].checklistItems,s.checklistItems);assert.equal(h.controller.saveSnapshot().saved.checklistItems.length,3);
 assert.equal(h.controller.saveSnapshot().locked,false);
});
test('manual material provenance survives deletion, blank filtering and another model round',async t=>{
 const h=await setup(t);await ready(h);h.controller.removeMaterial(0);h.controller.addMaterial();h.controller.setMaterial(1,'人工附件');h.controller.addMaterial();
 h.controller.extract();h.calls.at(-1).resolve(new GatewayResponse(200,JSON.stringify({type:'draft',draft:clone(fixture)})));await tick();
 assert.deepEqual(h.controller.snapshot().materialFromNotice,[true,false,false]);
 await h.controller.confirm();const s=ok(await h.store.read());assert.equal(s.checklistItems.length,2);assert.equal(s.checklistItems[1].sourceNoticeId,null);
});
test('rewriting an extracted material cannot attribute the replacement to the original notice',async t=>{
 const h=await setup(t);await ready(h);const raw=h.controller.snapshot().rawText;
 h.controller.setMaterial(0,'人工新增：合成缴费凭证');
 assert.deepEqual(h.controller.snapshot().materialFromNotice,[false,true]);
 assert.equal(h.controller.snapshot().rawText,raw);assert.equal(ok(await h.store.read()).tasks.length,0);
 await h.controller.confirm();const s=ok(await h.store.read());
 assert.equal(s.checklistItems[0].sourceNoticeId,null);assert.equal(s.checklistItems[1].sourceNoticeId,s.notices[0].id);
 assert.equal(s.notices[0].rawText,raw);assert.deepEqual(s.operations[0].checklistItems,s.checklistItems);
 assert.equal(h.controller.saveSnapshot().saved.checklistItems[0].sourceNoticeId,null);
});

test('identical text or surrounding whitespace preserves an untouched extraction origin',async t=>{
 const h=await setup(t);await ready(h);const label=h.controller.snapshot().materials[0];
 h.controller.setMaterial(0,label);h.controller.setMaterial(0,'  '+label+'  ');
 assert.deepEqual(h.controller.snapshot().materialFromNotice,[true,true]);
 await h.controller.confirm();const s=ok(await h.store.read());
 assert.equal(s.checklistItems[0].label,label);assert.equal(s.checklistItems[0].sourceNoticeId,s.notices[0].id);
});

test('manual origin stays conservative across edit-back, delete, empty filtering and model retry',async t=>{
 const h=await setup(t);await ready(h);const label=h.controller.snapshot().materials[0];
 h.controller.setMaterial(0,'人工合成替换');h.controller.setMaterial(0,label);
 h.controller.removeMaterial(1);h.controller.addMaterial();h.controller.setMaterial(1,'   ');
 h.controller.extract();h.calls.at(-1).resolve(new GatewayResponse(200,JSON.stringify({type:'draft',draft:clone(fixture)})));await tick();
 assert.deepEqual(h.controller.snapshot().materialFromNotice,[false,false]);
 await h.controller.confirm();const s=ok(await h.store.read());assert.equal(s.checklistItems.length,1);
 assert.equal(s.checklistItems[0].label,label);assert.equal(s.checklistItems[0].sourceNoticeId,null);
});

test('edited material origin survives failed save, cold recovery, explicit confirm and cold readback',async t=>{
 const h=await setup(t);await ready(h);h.controller.setMaterial(0,'合成：人工核对附件');
 const apply=h.commits.confirmation.apply.bind(h.commits.confirmation);
 h.commits.confirmation.apply=async req=>{h.files.fail='replace:task-store.json';return apply(req);};
 await h.controller.confirm();const before=await bytes(h);assert.equal(ok(await h.store.read()).tasks.length,0);h.controller.dispose();
 const cold=await setup(t,h.root);await cold.controller.restore();assert.equal(await bytes(cold),before);
 assert.deepEqual(cold.controller.snapshot().materialFromNotice,[false,true]);
 cold.controller.setMaterial(0,'不得修改锁定结果');assert.equal(cold.controller.snapshot().materials[0],'合成：人工核对附件');
 await cold.controller.confirm();const s=ok(await cold.store.read());assert.equal(s.checklistItems[0].sourceNoticeId,null);
 cold.controller.dispose();const read=await setup(t,h.root);await read.controller.restore();
 assert.equal(read.controller.saveSnapshot().saved.checklistItems[0].sourceNoticeId,null);
 assert.equal(read.controller.saveSnapshot().saved.checklistItems[1].sourceNoticeId,s.notices[0].id);
});

test('clearing every material commits an empty collection without resurrecting model items',async t=>{
 const h=await setup(t);await ready(h);while(h.controller.snapshot().materials.length)h.controller.removeMaterial(0);
 await h.controller.confirm();const s=ok(await h.store.read());assert.deepEqual(s.checklistItems,[]);assert.deepEqual(s.operations[0].createdChecklistItemIds,[]);
});
test('cancelling before confirmation never stages or writes business data',async t=>{
 const h=await setup(t);await ready(h);h.controller.cancel();const s=ok(await h.store.read());assert.equal(s.revision,0);assert.equal(s.tasks.length,0);assert.equal(s.proposals.length,0);
});
test('failed apply retains one proposal/request and explicitly retries the reserved material IDs',async t=>{
 const h=await setup(t);await ready(h);const original=h.commits.confirmation.apply.bind(h.commits.confirmation);let fail=true,seen=[];
 h.commits.confirmation.apply=async req=>{seen.push(clone(req));if(fail){h.files.fail='replace:task-store.json';fail=false;}return original(req);};
 await h.controller.confirm();assert.notEqual(h.controller.snapshot().phase,'saved');let s=ok(await h.store.read());
 assert.equal(s.revision,1);assert.equal(s.tasks.length,0);const ids=s.proposals[0].checklistItems.map(i=>i.id);const pendingBytes=await bytes(h);
 h.controller.edit('title','must stay locked');assert.notEqual(h.controller.snapshot().title,'must stay locked');assert.equal(await bytes(h),pendingBytes);
 await h.controller.confirm();s=ok(await h.store.read());assert.equal(s.proposals.length,1);assert.equal(s.tasks.length,1);
 assert.deepEqual(seen[0],seen[1]);assert.deepEqual(s.checklistItems.map(i=>i.id),ids);
});
test('a cold owner restores pending edits and IDs without automatically granting or applying',async t=>{
 const h=await setup(t);await ready(h);h.controller.addMaterial();h.controller.setMaterial(2,'人工新增');
 const original=h.commits.confirmation.apply.bind(h.commits.confirmation);h.commits.confirmation.apply=async req=>{h.files.fail='replace:task-store.json';return original(req);};
 await h.controller.confirm();const before=await bytes(h),s=ok(await h.store.read());h.controller.dispose();
 const cold=await setup(t,h.root);await cold.controller.restore();assert.equal(await bytes(cold),before);assert.equal(ok(await cold.store.read()).tasks.length,0);
 assert.equal(cold.controller.snapshot().materials[2],'人工新增');assert.equal(cold.controller.snapshot().materialFromNotice[2],false);
 await cold.controller.confirm();assert.equal(cold.controller.snapshot().phase,'saved');
 assert.deepEqual(ok(await cold.store.read()).checklistItems.map(i=>i.id),s.proposals[0].checklistItems.map(i=>i.id));
});
test('cold readback shows actual committed result without any new snapshot write',async t=>{
 const h=await setup(t);await ready(h);await h.controller.confirm();const before=await bytes(h);h.controller.dispose();
 const cold=await setup(t,h.root);await cold.controller.restore();assert.equal(cold.controller.snapshot().draft,null);
 assert.equal(cold.controller.saveSnapshot().saved.task.id,ok(await cold.store.read()).tasks[0].id);assert.equal(await bytes(cold),before);
});
test('duplicate concurrent and later confirms never create duplicate tasks/materials',async t=>{
 const h=await setup(t);await ready(h);await Promise.all([h.controller.confirm(),h.controller.confirm(),h.controller.confirm()]);
 const before=await bytes(h);await h.controller.confirm();const s=ok(await h.store.read());assert.equal(s.tasks.length,1);assert.equal(s.proposals.length,1);assert.equal(s.operations.length,1);assert.equal(await bytes(h),before);
});
test('cancel a retained proposal revokes it without formal tasks, then allows a new draft',async t=>{
 const h=await setup(t);await ready(h);const original=h.commits.confirmation.apply.bind(h.commits.confirmation);h.commits.confirmation.apply=async req=>{h.files.fail='replace:task-store.json';return original(req);};
 await h.controller.confirm();await h.controller.cancelPending();let s=ok(await h.store.read());assert.equal(s.proposals[0].state,'cancelled');assert.equal(s.tasks.length,0);
 assert.equal(h.controller.saveSnapshot().locked,false);assert.equal(h.controller.snapshot().draft,null);assert.equal(h.controller.snapshot().expectedRevision,s.revision);
});
test('a stale retained proposal cannot silently rebase, and explicit cancellation uses current revision',async t=>{
 const h=await setup(t);await ready(h);const original=h.commits.confirmation.apply.bind(h.commits.confirmation);let fail=true;
 h.commits.confirmation.apply=async req=>{if(fail){h.files.fail='replace:task-store.json';fail=false;}return original(req);};
 await h.controller.confirm();const other=new TaskDraft();other.title='独立合成控制任务';ok(await new TaskRepository(h.store,h.runtime).create(other,1));
 const before=await bytes(h);await h.controller.confirm();assert.equal(h.controller.snapshot().errorCode,'VERSION_CONFLICT');assert.equal(await bytes(h),before);
 await h.controller.cancelPending();assert.equal(ok(await h.store.read()).proposals[0].state,'cancelled');
});
test('stage acknowledgement loss recovers original pending proposal instead of staging twice',async t=>{
 const h=await setup(t);await ready(h);h.files.lose=true;await h.controller.confirm();const s=ok(await h.store.read());
 assert.equal(s.proposals.length,1);assert.equal(s.tasks.length,0);assert.notEqual(h.controller.snapshot().phase,'saved');
 await h.controller.refreshRevision();await h.controller.confirm();const after=ok(await h.store.read());assert.equal(after.proposals.length,1);assert.equal(after.tasks.length,1);
 assert.deepEqual(after.checklistItems.map(i=>i.id),s.proposals[0].checklistItems.map(i=>i.id));
});
test('first-ever failed stage preserves recovery traces and never silently creates an empty store',async t=>{
 const h=await setup(t);await ready(h);h.files.fail='replace:task-store.json';await h.controller.confirm();assert.equal((await h.store.read()).success,false);
 await h.controller.refreshRevision();assert.equal(h.controller.saveSnapshot().locked,true);assert.notEqual(h.controller.snapshot().phase,'saved');
 assert.equal(await h.files.exists('task-store.tmp.json'),true);
});
test('failed stage on an existing store can be read and explicitly retried without a duplicate proposal',async t=>{
 const h=await setup(t);const d=new TaskDraft();d.title='既有合成任务';ok(await new TaskRepository(h.store,h.runtime).create(d,0));
 h.controller.setExpectedRevision(1);await ready(h);h.files.fail='replace:task-store.json';await h.controller.confirm();assert.equal(ok(await h.store.read()).proposals.length,0);
 await h.controller.refreshRevision();await h.controller.confirm();assert.equal(h.controller.snapshot().phase,'saved');assert.equal(ok(await h.store.read()).tasks.length,2);
});
test('direct mutation after staging is rejected rather than changing a trusted request',async t=>{
 const h=await setup(t),x=input();
 const original=h.commits.confirmation.apply.bind(h.commits.confirmation);h.commits.confirmation.apply=async req=>{h.files.fail='replace:task-store.json';return original(req);};
 assert.equal((await h.writer.create(x,0)).success,false);const before=await bytes(h);x.draft.task.title='tampered';
 assert.equal((await h.writer.create(x,1)).errorCode,'PROPOSAL_CHANGED');assert.equal(await bytes(h),before);
});
test('readback failure after successful commit never reports the confirmed save as failed',async t=>{
 const h=await setup(t);await ready(h);const read=h.writer.readSaved.bind(h.writer);h.writer.readSaved=async()=>({success:false,data:null,errorCode:'STORAGE_FAILED',message:'synthetic'});
 await h.controller.confirm();assert.equal(h.controller.snapshot().phase,'saved');assert.ok(h.controller.saveSnapshot().readbackError.length>0);
 const before=await bytes(h);h.writer.readSaved=read;await h.controller.readSaved();assert.ok(h.controller.saveSnapshot().saved);assert.equal(h.controller.saveSnapshot().readbackError,'');assert.equal(await bytes(h),before);
});
test('pending recovery cannot guess among multiple existing import proposals',async t=>{
 const h=await setup(t);
 for(let rev=0;rev<2;rev++){const p=new ProposalDraft();p.sessionId=NOTICE_IMPORT_SESSION;p.expectedRevision=rev;const c=new TaskChangeDraft();c.draft.title='合成多方案';p.changes=[c];ok(await h.commits.proposals.stage(p));}
 const before=await bytes(h);await h.controller.restore();assert.equal(h.controller.saveSnapshot().errorCode,'RECOVERY_REQUIRED');assert.equal(h.controller.saveSnapshot().locked,true);assert.equal(await bytes(h),before);
});
test('date-only confirmation and cold readback preserve unknown clock precision',async t=>{
 const h=await setup(t);await ready(h);h.controller.edit('precision','date_only');h.controller.edit('date','2026-11-20');await h.controller.confirm();
 const task=ok(await h.store.read()).tasks[0];assert.equal(task.dueAt,null);assert.equal(task.deadlineDate,'2026-11-20');assert.equal(h.controller.saveSnapshot().saved.task.dueAt,null);
});

test('an explicitly confirmed unknown deadline stays unknown through storage and cold readback',async t=>{
 const draft=clone(require('../../fixtures/extraction/notice-draft-samples.json').samples[2].draft);
 const h=await setup(t);await ready(h,draft);
 assert.deepEqual(h.controller.snapshot().missingFields,['deadline']);
 assert.equal(ok(await h.store.read()).tasks.length,0);
 await h.controller.confirm();assert.equal(h.controller.snapshot().phase,'saved');
 const saved=ok(await h.store.read());assert.equal(saved.tasks.length,1);
 assert.equal(saved.tasks[0].deadlinePrecision,'unknown');assert.equal(saved.tasks[0].deadlineDate,null);assert.equal(saved.tasks[0].dueAt,null);
 assert.equal(saved.notices[0].rawText,draft.notice.rawText);assert.equal(saved.notices[0].publishedAt,null);
 const before=await bytes(h);h.controller.dispose();const cold=await setup(t,h.root);await cold.controller.restore();
 assert.equal(cold.controller.saveSnapshot().saved.task.deadlinePrecision,'unknown');
 assert.equal(cold.controller.saveSnapshot().saved.task.dueAt,null);assert.equal(await bytes(cold),before);
});

test('a date-only model draft needs no manual task fields and never gains a clock on commit',async t=>{
 const draft=clone(require('../../fixtures/extraction/notice-draft-samples.json').samples[1].draft);
 const h=await setup(t);await ready(h,draft);
 assert.deepEqual(h.calls[0].request.answers,[]);assert.equal(h.calls[0].request.draft,null);
 assert.equal(h.controller.snapshot().deadlineTime,'');await h.controller.confirm();
 const saved=ok(await h.store.read());assert.equal(saved.tasks.length,1);
 assert.equal(saved.tasks[0].deadlinePrecision,'date_only');assert.equal(saved.tasks[0].deadlineDate,draft.task.deadlineDate);
 assert.equal(saved.tasks[0].dueAt,null);assert.equal(saved.notices[0].rawText,draft.notice.rawText);
 assert.deepEqual(saved.checklistItems.map(item=>item.label),draft.checklistItems.map(item=>item.label));
});

test('a date clarification preserves the original notice and explicit answer through another round and cold commit',async t=>{
 const draft=clone(require('../../fixtures/extraction/notice-draft-samples.json').samples[2].draft);
 const h=await setup(t);await ready(h,draft);
 h.controller.edit('precision','date_only');h.controller.edit('date','2026-11-24');h.controller.extract();
 const call=h.calls.at(-1);assert.equal(call.request.rawText,draft.notice.rawText);
 assert.equal(call.request.draft.task.deadlinePrecision,'unknown');
 assert.deepEqual(call.request.answers.find(answer=>answer.field==='deadline'),{field:'deadline',value:'2026-11-24'});
 // Even if a subsequent response omits the explicit answer, the confirmed screen must retain it.
 call.resolve(new GatewayResponse(200,JSON.stringify({type:'draft',draft:clone(draft)})));await tick();
 assert.deepEqual(h.controller.snapshot().missingFields,[]);assert.deepEqual(h.controller.snapshot().questions,[]);
 assert.equal(ok(await h.store.read()).tasks.length,0);await h.controller.confirm();
 const saved=ok(await h.store.read());assert.equal(saved.tasks[0].deadlineDate,'2026-11-24');assert.equal(saved.tasks[0].dueAt,null);
 assert.equal(saved.notices[0].rawText,draft.notice.rawText);assert.equal(saved.notices[0].publishedAt,null);
 const before=await bytes(h);h.controller.dispose();const cold=await setup(t,h.root);await cold.controller.restore();
 assert.equal(cold.controller.saveSnapshot().saved.task.deadlineDate,'2026-11-24');
 assert.equal(cold.controller.saveSnapshot().saved.task.dueAt,null);assert.equal(await bytes(cold),before);
});

test('probe compatibility imports use exactly the shared production confirmation classes',()=>{
 assert.equal(NoticeSaveController,require('../../client/entry/src/main/ets/notice/NoticeSaveController.ts').NoticeSaveController);
 assert.equal(NoticeConfirmedWriter,require('../../client/entry/src/main/ets/notice/NoticeConfirmedWriter.ts').NoticeConfirmedWriter);
 assert.equal(require('../../probes/harmony-noticechat/NoticeVoiceController.ts').NoticeVoiceController,
  require('../../client/entry/src/main/ets/notice/NoticeVoiceController.ts').NoticeVoiceController);
});

test('text-only production controller uses trusted confirmation and reads it after reopening',async t=>{
 const h=await setup(t,undefined,false);await h.controller.restore();await ready(h);
 assert.equal(ok(await h.store.read()).tasks.length,0);await h.controller.confirm();
 assert.equal(h.controller.snapshot().phase,'saved');const saved=ok(await h.store.read());
 assert.equal(saved.tasks.length,1);assert.equal(saved.proposals[0].state,'applied');assert.equal(saved.operations.length,1);
 const before=await bytes(h);h.controller.dispose();const cold=await setup(t,h.root,false);await cold.controller.restore();
 assert.equal(cold.controller.saveSnapshot().saved.task.id,saved.tasks[0].id);assert.equal(await bytes(cold),before);
});

test('upgrading the entry preserves legacy T13 tasks and materials while new imports use T16',async t=>{
 const h=await setup(t,undefined,false),legacy=new NoticeImportRepository(h.store,h.runtime),prior=input();
 prior.draft.task.title='合成：旧入口保存的任务';const old=ok(await legacy.create(prior,0)),before=ok(await h.store.read());
 await h.controller.restore();await ready(h);await h.controller.confirm();const saved=ok(await h.store.read());
 assert.equal(saved.tasks.length,2);assert.equal(saved.proposals.length,1);assert.equal(saved.operations.length,1);
 assert.deepEqual(saved.tasks.find(task=>task.id===old.task.id),before.tasks[0]);
 assert.deepEqual(saved.notices.find(notice=>notice.id===old.notice.id),before.notices[0]);
 assert.deepEqual(saved.checklistItems.filter(item=>item.taskId===old.task.id),before.checklistItems);
 assert.equal(h.controller.saveSnapshot().saved.task.id,saved.operations[0].affectedTaskIds[0]);
});

test('unavailable speech cannot fabricate a transcription or block the production text path',async t=>{
 const h=await setup(t,undefined,false);h.controller.setRawText(fixture.notice.rawText);await h.controller.record();
 assert.equal(h.controller.speechSnapshot().errorCode,'UNSUPPORTED_PLATFORM');
 assert.equal(h.controller.snapshot().rawText,fixture.notice.rawText);assert.equal(h.calls.length,0);
 await ready(h);await h.controller.confirm();assert.equal(h.controller.snapshot().phase,'saved');
});

test('application background invalidates a production extraction without committing or resuming it',async t=>{
 const h=await setup(t,undefined,false),owner=new NoticeImportOwner();owner.claim(h.controller);
 h.controller.setRawText(fixture.notice.rawText);h.controller.extract();owner.pause();
 const call=h.calls[0];assert.equal(call.cancelled,true);call.resolve(new GatewayResponse(200,JSON.stringify({type:'draft',draft:clone(fixture)})));await tick();
 assert.equal(h.controller.snapshot().draft,null);assert.equal(ok(await h.store.read()).tasks.length,0);assert.equal(h.calls.length,1);
 owner.destroy();
});

test('a stale page release cannot clear or pause the newer import owner',async t=>{
 const first=await setup(t,undefined,false),second=await setup(t,undefined,false),owner=new NoticeImportOwner();
 owner.claim(first.controller);assert.throws(()=>owner.claim(second.controller),error=>error.code==='BUSY');
 owner.release(first.controller);owner.claim(second.controller);owner.release(first.controller);
 second.controller.setRawText(fixture.notice.rawText);second.controller.extract();owner.pause();
 assert.equal(second.calls[0].cancelled,true);assert.equal(first.calls.length,0);owner.destroy();
});

test('disposing a page during restore suppresses late publications and permits a fresh owner',async t=>{
 const h=await setup(t,undefined,false),owner=new NoticeImportOwner();owner.claim(h.controller);
 let release;const original=h.writer.recover.bind(h.writer);h.writer.recover=()=>new Promise(resolve=>{release=()=>original().then(resolve);});
 let published=0;h.controller.subscribeSave(()=>published++);const restoring=h.controller.restore();owner.release(h.controller);const count=published;
 await release();await restoring;assert.equal(published,count);assert.equal(ok(await h.store.read()).tasks.length,0);
 const next=await setup(t,undefined,false);owner.claim(next.controller);await next.controller.restore();owner.destroy();
});
