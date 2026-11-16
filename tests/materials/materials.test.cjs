const {test}=require('node:test'),assert=require('node:assert/strict');
const root='../../client/entry/src/main/ets/';
const {LocalStore}=require(root+'data/LocalStore.ts'),{CommitServices}=require(root+'data/CommitServices.ts'),{TaskRepository}=require(root+'data/TaskRepository.ts');
const {StorageCoordinator}=require(root+'data/storage/StorageCoordinator.ts'),{TaskDraft}=require(root+'domain/TaskContracts.ts');
const {BusinessSnapshot}=require(root+'domain/StorageModels.ts');
const {MATERIAL_PROPOSAL_RECORD,MATERIAL_OPERATION_RECORD}=require(root+'domain/MaterialCommitValidation.ts');
const clone=x=>structuredClone(x),ok=r=>{assert.equal(r.success,true,r.message);return r.data;};
class Files {
 files=new Map();writes=0;failNext=false;loseAck=false;
 async ensureDirectory(){}async exists(n){return this.files.has(n);}async readText(n){if(!this.files.has(n))throw Error('missing');return this.files.get(n);}
 async writeText(n,s){this.writes++;this.files.set(n,s);}
 async replace(a,b){if(b==='task-store.json'&&this.failNext){this.failNext=false;throw Error('synthetic before commit');}this.files.set(b,this.files.get(a));this.files.delete(a);if(b==='task-store.json'&&this.loseAck){this.loseAck=false;throw Error('synthetic after commit acknowledgement loss');}}
 async listNames(d){const prefix=d?d+'/':'';return [...this.files.keys()].filter(n=>n.startsWith(prefix)&&!n.slice(prefix.length).includes('/')).map(n=>n.slice(prefix.length));}
}
class Runtime {n=0;time='2026-11-17T10:00:00+08:00';nextId(){return 'task-synthetic-'+(++this.n);}now(){return this.time;}}
function setup(files=new Files(),runtime=new Runtime()) {const store=new LocalStore(new StorageCoordinator(files));return {files,runtime,store,commits:new CommitServices(store,runtime),tasks:new TaskRepository(store,runtime)};}
async function apply(s,proposal){const request=ok(await s.commits.confirmation.confirm(proposal.id,proposal.expectedRevision));return ok(await s.commits.confirmation.apply(request));}
async function seed(s,count=2,channel='合成课程平台'){
 const draft=new TaskDraft();draft.title='合成报告';draft.submissionChannel=channel;
 const revision=ok(await s.store.read()).revision;
 const p=ok(await s.commits.proposals.stage({sessionId:'manual-task-board',expectedRevision:revision,notices:[],changes:[{action:'create',taskId:null,expectedVersion:null,draft,checklistCreates:Array.from({length:count},(_,i)=>({label:'合成材料'+i,sourceNoticeId:null}))}]}));
 const r=await apply(s,p);return {task:r.tasks[0],items:r.checklistItems,receipt:r};
}
function editable(task){const d=new TaskDraft();for(const key of Object.keys(d))d[key]=clone(task[key]);return d;}
async function stage(s,id,mutate=()=>{}) {
 const detail=ok(await s.tasks.get(id));const change={action:'update',taskId:id,expectedVersion:detail.task.version,draft:editable(detail.task),checklistCreates:[]};mutate(change,detail);
 return s.commits.proposals.stage({sessionId:'manual-task-board',expectedRevision:detail.revision,notices:[],changes:[change]});
}
async function ready(s,id){const p=ok(await stage(s,id,(c,d)=>{c.draft.status='ready';c.checklistUpdates=d.checklistItems.map(i=>({itemId:i.id,state:'prepared'}));}));return apply(s,p);}
async function submitted(s,id){await ready(s,id);return apply(s,ok(await stage(s,id,c=>{c.draft.status='submitted';c.confirmSubmission=true;})));}

test('v3 material stage holds immutable before images and does not change formal material/task',async()=>{
 const s=setup(),initial=await seed(s),before=ok(await s.tasks.get(initial.task.id));const p=ok(await stage(s,initial.task.id,c=>{c.checklistUpdates=[{itemId:initial.items[0].id,state:'prepared'}];}));
 assert.equal(p.recordType,MATERIAL_PROPOSAL_RECORD);assert.equal(p.checklistBefore.length,2);assert.equal(p.checklistUpdates[0].before.state,'pending');
 const actual=ok(await s.tasks.get(initial.task.id));assert.deepEqual(actual.task,before.task);assert.deepEqual(actual.checklistItems,before.checklistItems);
});
test('explicit apply atomically prepares material, increments task version and preserves original creation receipt',async()=>{
 const s=setup(),initial=await seed(s),old=clone(initial.receipt);const p=ok(await stage(s,initial.task.id,c=>{c.checklistUpdates=[{itemId:initial.items[0].id,state:'prepared'}];}));
 const r=await apply(s,p),detail=ok(await s.tasks.get(initial.task.id));assert.equal(r.recordType,MATERIAL_OPERATION_RECORD);assert.equal(detail.task.version,2);
 assert.equal(detail.checklistItems[0].state,'prepared');assert.equal(detail.checklistItems[0].confirmedAt,r.confirmedAt);assert.equal(detail.checklistItems[1].state,'pending');
 assert.deepEqual(ok(await s.commits.confirmation.receipt(initial.receipt.operationId)),old);assert.equal(r.updatedChecklistItems.length,1);
});
test('cold replay returns original material confirmation time and one receipt after later writes',async()=>{
 const s=setup(),initial=await seed(s);const p=ok(await stage(s,initial.task.id,c=>{c.checklistUpdates=[{itemId:initial.items[0].id,state:'prepared'}];}));const request=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));const r=ok(await s.commits.confirmation.apply(request));
 s.runtime.time='2026-11-17T10:30:00+08:00';const other=new TaskDraft();other.title='合成独立任务';ok(await s.tasks.create(other,ok(await s.store.read()).revision));
 const cold=setup(s.files,s.runtime);assert.deepEqual(ok(await cold.commits.confirmation.apply(request)),r);assert.equal(ok(await cold.tasks.get(initial.task.id)).task.version,2);
});
test('cold pending cannot acquire authorization automatically; explicit re-confirmation applies same proposal',async()=>{
 const s=setup(),initial=await seed(s),p=ok(await stage(s,initial.task.id,c=>{c.checklistUpdates=[{itemId:initial.items[0].id,state:'prepared'}];}));const request=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));const cold=setup(s.files,s.runtime);
 assert.equal((await cold.commits.confirmation.apply(request)).errorCode,'CONFIRMATION_REQUIRED');assert.equal(ok(await cold.tasks.get(initial.task.id)).checklistItems[0].state,'pending');
 await apply(cold,ok(await cold.commits.proposals.get(p.id)));assert.equal(ok(await cold.tasks.get(initial.task.id)).checklistItems[0].state,'prepared');
});
test('cancel material proposal preserves formal task and material history',async()=>{
 const s=setup(),initial=await seed(s),before=ok(await s.tasks.get(initial.task.id));const p=ok(await stage(s,initial.task.id,c=>{c.checklistUpdates=[{itemId:initial.items[0].id,state:'prepared'}];}));ok(await s.commits.confirmation.cancel(p.id,p.expectedRevision));
 const actual=ok(await s.tasks.get(initial.task.id));assert.deepEqual(actual.task,before.task);assert.deepEqual(actual.checklistItems,before.checklistItems);assert.equal(ok(await s.commits.proposals.get(p.id)).state,'cancelled');
});
test('wrong task item, duplicate IDs, malformed update and injected confirmation fields fail before new writes',async()=>{
 const s=setup(),a=await seed(s),b=await seed(s);const writes=s.files.writes;
 for(const updates of [[{itemId:b.items[0].id,state:'prepared'}],[{itemId:a.items[0].id,state:'prepared'},{itemId:a.items[0].id,state:'pending'}],[null],[{itemId:a.items[0].id,state:'submitted'}],[{itemId:a.items[0].id,state:'prepared',confirmed:true}]]){
  const r=await stage(s,a.task.id,c=>{c.checklistUpdates=updates;});assert.equal(r.success,false);
 }
 assert.equal(s.files.writes,writes);assert.equal(ok(await s.tasks.get(a.task.id)).task.version,1);
});
test('pre-commit failure can retry same authorized request; acknowledgement loss reads committed result once',async()=>{
 for(const lose of [false,true]){
  const s=setup(),a=await seed(s),p=ok(await stage(s,a.task.id,c=>{c.checklistUpdates=[{itemId:a.items[0].id,state:'prepared'}];}));const request=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));
  if(lose)s.files.loseAck=true;else s.files.failNext=true;const first=await s.commits.confirmation.apply(request);
  if(lose)assert.equal(first.success,true);else assert.equal(first.success,false);
  const r=ok(await s.commits.confirmation.apply(request));assert.equal(r.updatedChecklistItems[0].state,'prepared');assert.equal(ok(await s.tasks.get(a.task.id)).task.version,2);assert.equal(ok(await s.store.read()).operations.length,2);
 }
});
test('global version change prevents material apply from overwriting unrelated newer business state',async()=>{
 const s=setup(),a=await seed(s),p=ok(await stage(s,a.task.id,c=>{c.checklistUpdates=[{itemId:a.items[0].id,state:'prepared'}];}));const request=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));
 const d=new TaskDraft();d.title='合成并发任务';ok(await s.tasks.create(d,ok(await s.store.read()).revision));assert.equal((await s.commits.confirmation.apply(request)).errorCode,'VERSION_CONFLICT');assert.equal(ok(await s.tasks.get(a.task.id)).checklistItems[0].state,'pending');
});
test('ready requires all materials; batch prepare plus ready is one confirmed transaction',async()=>{
 const s=setup(),a=await seed(s);assert.equal((await stage(s,a.task.id,c=>{c.draft.status='ready';})).success,false);
 const r=await ready(s,a.task.id);assert.equal(r.tasks[0].status,'ready');assert.equal(r.tasks[0].version,2);assert.ok(ok(await s.tasks.get(a.task.id)).checklistItems.every(i=>i.state==='prepared'));
});
test('submitted requires prior ready and creates immutable user-declaration material/channel/source snapshot',async()=>{
 const s=setup(),a=await seed(s);assert.equal((await stage(s,a.task.id,c=>{c.draft.status='submitted';})).success,false);
 const r=await submitted(s,a.task.id);assert.equal(r.tasks[0].status,'submitted');assert.equal(r.submissionSnapshots.length,1);const sub=r.submissionSnapshots[0];
 assert.equal(sub.confirmedSubmittedAt,r.confirmedAt);assert.equal(sub.taskVersion,r.tasks[0].version);assert.equal(sub.submissionChannel,'合成课程平台');assert.equal(sub.materials.length,2);assert.ok(sub.materials.every(i=>i.state==='prepared'));
});
test('submitted terminal is protected while metadata updates preserve original submission history',async()=>{
 const s=setup(),a=await seed(s),r=await submitted(s,a.task.id),old=clone(r.submissionSnapshots[0]);
 for(const status of ['todo','in_progress','ready','done','cancelled'])assert.equal((await stage(s,a.task.id,c=>{c.draft.status=status;})).success,false);
 const update=await apply(s,ok(await stage(s,a.task.id,c=>{c.draft.deadlinePrecision='date_only';c.draft.deadlineDate='2026-12-12';})));
 assert.equal(update.tasks[0].status,'submitted');assert.deepEqual(ok(await s.commits.confirmation.receipt(r.operationId)).submissionSnapshots[0],old);
});
test('new requirements after submission keep old declaration; preparing and explicit re-confirmation add new history',async()=>{
 const s=setup(),a=await seed(s),first=await submitted(s,a.task.id);
 const added=await apply(s,ok(await stage(s,a.task.id,c=>{c.checklistCreates=[{label:'新增合成自查表',sourceNoticeId:null}];})));
 assert.equal(added.tasks[0].status,'submitted');assert.equal(added.submissionSnapshots.length,0);assert.equal(ok(await s.tasks.get(a.task.id)).checklistItems.length,3);
 assert.equal((await stage(s,a.task.id,c=>{c.confirmSubmission=true;})).success,false);
 const prepared=await apply(s,ok(await stage(s,a.task.id, (c,d)=>{c.checklistUpdates=d.checklistItems.filter(i=>i.state==='pending').map(i=>({itemId:i.id,state:'prepared'}));})));
 s.runtime.time='2026-11-17T10:20:00+08:00';const reconfirmed=await apply(s,ok(await stage(s,a.task.id,c=>{c.confirmSubmission=true;})));
 assert.equal(reconfirmed.submissionSnapshots[0].materials.length,3);assert.equal(reconfirmed.submissionSnapshots[0].taskVersion,prepared.tasks[0].version);
 assert.equal(ok(await s.commits.confirmation.receipt(first.operationId)).submissionSnapshots[0].materials.length,2);
});
test('unchecking after ready must explicitly return to progress; submitted status is not silently erased',async()=>{
 const s=setup(),a=await seed(s);await ready(s,a.task.id);assert.equal((await stage(s,a.task.id,c=>{c.checklistUpdates=[{itemId:a.items[0].id,state:'pending'}];})).success,false);
 await apply(s,ok(await stage(s,a.task.id,c=>{c.checklistUpdates=[{itemId:a.items[0].id,state:'pending'}];c.draft.status='in_progress';})));
 await ready(s,a.task.id);await apply(s,ok(await stage(s,a.task.id,c=>{c.draft.status='submitted';c.confirmSubmission=true;})));
 await apply(s,ok(await stage(s,a.task.id,c=>{c.checklistUpdates=[{itemId:a.items[0].id,state:'pending'}];})));
 assert.equal(ok(await s.tasks.get(a.task.id)).task.status,'submitted');assert.equal(ok(await s.tasks.get(a.task.id)).checklistItems[0].confirmedAt,null);
});
test('ordinary no-requirement task can be done, while submission tasks cannot equate work done with submitted',async()=>{
 const s=setup(),a=await seed(s,0,null);await apply(s,ok(await stage(s,a.task.id,c=>{c.draft.status='done';})));assert.equal((await stage(s,a.task.id,c=>{c.draft.status='todo';})).success,false);
 const b=await seed(s);assert.equal((await stage(s,b.task.id,c=>{c.draft.status='done';})).success,false);
});
test('material/status receipt corruption is rejected without replacing valid primary bytes',async()=>{
 const s=setup(),a=await seed(s);await ready(s,a.task.id);const before=s.files.files.get('task-store.json'),candidate=ok(await s.store.read());
 candidate.operations.at(-1).updatedChecklistItems[0].confirmedAt='2026-11-18T00:00:00Z';assert.equal((await s.store.save(candidate,candidate.revision)).success,false);assert.equal(s.files.files.get('task-store.json'),before);
});
test('new v3 records are validated but unknown future protocol stays rejected and untouched',async()=>{
 const s=setup(),a=await seed(s);await ready(s,a.task.id);const snapshot=ok(await s.store.read());assert.equal(snapshot.proposals.at(-1).recordType,'t16.proposal.v3');snapshot.proposals.at(-1).recordType='t16.proposal.v99';
 const before=s.files.files.get('task-store.json');assert.equal((await s.store.save(snapshot,snapshot.revision)).success,false);assert.equal(s.files.files.get('task-store.json'),before);
});
test('legacy opaque material IDs remain addressable and are not rewritten to fit new identifiers',async()=>{
 const s=setup(),snapshot=new BusinessSnapshot();const d=new TaskDraft();d.title='旧版合成任务';snapshot.tasks=[{...d,id:'legacy-task',version:1,createdAt:s.runtime.now(),updatedAt:s.runtime.now()}];
 snapshot.checklistItems=[{id:'旧版材料一',taskId:'legacy-task',label:'旧版PDF',state:'pending',sourceNoticeId:null,confirmedAt:null}];ok(await s.store.save(snapshot,0));
 await apply(s,ok(await stage(s,'legacy-task',c=>{c.checklistUpdates=[{itemId:'旧版材料一',state:'prepared'}];})));
 assert.equal(ok(await s.tasks.get('legacy-task')).checklistItems[0].id,'旧版材料一');
});
test('repeated prepare declaration as a new no-op preserves first preparation time and task version',async()=>{
 const s=setup(),a=await seed(s);const r=await ready(s,a.task.id);const first=ok(await s.tasks.get(a.task.id));s.runtime.time='2026-11-17T10:40:00+08:00';
 const repeated=await apply(s,ok(await stage(s,a.task.id,c=>{c.checklistUpdates=[{itemId:a.items[0].id,state:'prepared'}];})));
 assert.equal(repeated.tasks[0].version,r.tasks[0].version);assert.deepEqual(repeated.changedTaskIds,[]);assert.equal(repeated.updatedChecklistItems[0].confirmedAt,first.checklistItems[0].confirmedAt);
});
test('submission snapshots retain real original notice binding and reject a mismatched historical material source',async()=>{
 const s=setup(),raw='合成原通知：提交PDF报告',hash=require(root+'data/storage/Sha256.ts').sha256Hex;
 const notice={id:'notice-original',rawText:raw,sourceLabel:'合成课程群',publishedAt:null,importedAt:s.runtime.now(),timezone:'Asia/Shanghai',contentHash:hash(raw)};
 const draft=new TaskDraft();draft.title='来源绑定合成报告';draft.noticeIds=[notice.id];draft.submissionChannel='合成平台';
 const p=ok(await s.commits.proposals.stage({sessionId:'manual-task-board',expectedRevision:0,notices:[notice],changes:[{action:'create',taskId:null,expectedVersion:null,draft,checklistCreates:[{label:'PDF报告',sourceNoticeId:notice.id}]}]}));
 const created=await apply(s,p),receipt=await submitted(s,created.tasks[0].id);assert.equal(receipt.submissionSnapshots[0].materials[0].sourceNoticeId,notice.id);
 const snapshot=ok(await s.store.read()),original=s.files.files.get('task-store.json');snapshot.operations.at(-1).submissionSnapshots[0].materials[0].sourceNoticeId='unknown-notice';
 assert.equal((await s.store.save(snapshot,snapshot.revision)).success,false);assert.equal(s.files.files.get('task-store.json'),original);
});
