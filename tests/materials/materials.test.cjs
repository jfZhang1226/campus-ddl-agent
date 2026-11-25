const {test}=require('node:test'),assert=require('node:assert/strict');
const root='../../client/entry/src/main/ets/';
const {LocalStore}=require(root+'data/LocalStore.ts'),{CommitServices}=require(root+'data/CommitServices.ts'),{TaskRepository}=require(root+'data/TaskRepository.ts');
const {StorageCoordinator}=require(root+'data/storage/StorageCoordinator.ts'),{TaskDraft}=require(root+'domain/TaskContracts.ts');
const {BusinessSnapshot}=require(root+'domain/StorageModels.ts');
const {MATERIAL_PROPOSAL_RECORD,MATERIAL_OPERATION_RECORD}=require(root+'domain/MaterialCommitValidation.ts');
const {TaskActionsController}=require(root+'tasks/TaskActionsController.ts');
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

async function actions(s,id){const c=new TaskActionsController(s.store,s.tasks,s.commits);await c.initialize();c.select(ok(await s.tasks.get(id)));return c;}
test('manual local checkboxes and discard never write; only confirmed staged action changes repository',async()=>{
 const s=setup(),a=await seed(s),c=await actions(s,a.task.id),writes=s.files.writes;
 c.toggle(a.items[0].id);assert.equal(c.hasLocalChanges(),true);assert.equal(s.files.writes,writes);
 c.discardLocalChanges();assert.equal(c.hasLocalChanges(),false);assert.equal(s.files.writes,writes);
 c.toggle(a.items[0].id);await c.prepareMaterials();assert.ok(c.snapshot().pending);assert.equal(ok(await s.tasks.get(a.task.id)).checklistItems[0].state,'pending');
 assert.equal(await c.confirm(),true);assert.equal(ok(await s.tasks.get(a.task.id)).checklistItems[0].state,'prepared');assert.equal(await c.confirm(),false);
});
test('remaining effort is explicit, confirmed and reversible to unknown; zero never implies completion',async()=>{
 const s=setup(),a=await seed(s),c=await actions(s,a.task.id);await c.prepareEffort(60);assert.equal(c.snapshot().pending.changes[0].draft.remainingMinutes,60);assert.equal(ok(await s.tasks.get(a.task.id)).task.remainingMinutes,null);await c.confirm();
 assert.equal(ok(await s.tasks.get(a.task.id)).task.remainingMinutes,60);c.select(ok(await s.tasks.get(a.task.id)));await c.prepareEffort(0);await c.confirm();let actual=ok(await s.tasks.get(a.task.id));assert.equal(actual.task.remainingMinutes,0);assert.equal(actual.task.status,'todo');assert.ok(actual.checklistItems.every(i=>i.state==='pending'));
 c.select(actual);await c.prepareEffort(null);await c.confirm();assert.equal(ok(await s.tasks.get(a.task.id)).task.remainingMinutes,null);
 c.select(ok(await s.tasks.get(a.task.id)));const writes=s.files.writes;for(const invalid of [-1,1.5,NaN,Infinity]){await c.prepareEffort(invalid);assert.equal(c.snapshot().pending,null);assert.equal(c.snapshot().errorCode,'INVALID_ARGUMENT');}assert.equal(s.files.writes,writes);
});
test('clock rollback cannot create an earlier submission declaration than current task preparation',async()=>{
 const s=setup(),a=await seed(s);s.runtime.time='2026-11-17T10:20:00+08:00';await submitted(s,a.task.id);
 const before=ok(await s.tasks.get(a.task.id));s.runtime.time='2026-11-17T10:10:00+08:00';const p=ok(await stage(s,a.task.id,c=>{c.confirmSubmission=true;}));const request=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));const writes=s.files.writes;
 assert.equal((await s.commits.confirmation.apply(request)).errorCode,'INVALID_ARGUMENT');assert.equal(s.files.writes,writes);const after=ok(await s.tasks.get(a.task.id));assert.deepEqual(after.task,before.task);assert.deepEqual(after.checklistItems,before.checklistItems);assert.equal(after.revision,p.expectedRevision);
});
test('manual cold recovery never auto-confirms pending proposal and supports explicit cancellation',async()=>{
 const s=setup(),a=await seed(s),c=await actions(s,a.task.id);c.toggle(a.items[0].id);await c.prepareMaterials();const id=c.snapshot().pending.id;c.dispose();
 const cold=setup(s.files,s.runtime),again=await actions(cold,a.task.id);assert.equal(again.snapshot().pending.id,id);assert.equal(ok(await cold.tasks.get(a.task.id)).task.version,1);
 await again.cancel();assert.equal(again.snapshot().pending,null);assert.equal(ok(await cold.tasks.get(a.task.id)).checklistItems[0].state,'pending');
});
test('manual stale selection and stale staged proposal cannot overwrite newer task; abandon remains possible',async()=>{
 const s=setup(),a=await seed(s),c=await actions(s,a.task.id);c.toggle(a.items[0].id);
 await apply(s,ok(await stage(s,a.task.id,ch=>{ch.draft.title='合成修改标题';})));await c.prepareMaterials();assert.equal(c.snapshot().errorCode,'VERSION_CONFLICT');assert.equal(c.snapshot().pending,null);
 c.select(ok(await s.tasks.get(a.task.id)));c.toggle(a.items[0].id);await c.prepareMaterials();const d=new TaskDraft();d.title='合成其他任务';ok(await s.tasks.create(d,ok(await s.store.read()).revision));
 assert.equal(await c.confirm(),false);assert.equal(c.snapshot().errorCode,'VERSION_CONFLICT');assert.match(c.snapshot().notice,/放弃/);await c.cancel();assert.equal(c.snapshot().pending,null);
});
test('manual add material and prepare-ready require screen confirmation; submission is a separate declaration',async()=>{
 const s=setup(),a=await seed(s,1),c=await actions(s,a.task.id);await c.prepareAddMaterial('合成补充材料');assert.equal(c.snapshot().pending.checklistItems[0].sourceNoticeId,null);assert.equal(ok(await s.tasks.get(a.task.id)).checklistItems.length,1);await c.confirm();
 c.select(ok(await s.tasks.get(a.task.id)));for(const item of c.snapshot().materials)c.toggle(item.itemId);await c.prepareStatus('ready');assert.equal(c.snapshot().pending.changes[0].draft.status,'ready');await c.confirm();
 c.select(ok(await s.tasks.get(a.task.id)));await c.prepareStatus('submit');assert.equal(c.snapshot().pending.changes[0].confirmSubmission,true);assert.equal(ok(await s.tasks.get(a.task.id)).task.status,'ready');await c.confirm();assert.equal(c.snapshot().receipt.submissionSnapshots.length,1);
});
test('manual submission history shows old immutable snapshot and changed requirements need reconfirmation',async()=>{
 const s=setup(),a=await seed(s);await submitted(s,a.task.id);await apply(s,ok(await stage(s,a.task.id,ch=>{ch.checklistCreates=[{label:'合成后续要求',sourceNoticeId:null}];})));
 const c=await actions(s,a.task.id);await new Promise(r=>setImmediate(r));assert.equal(c.snapshot().submissions.length,1);assert.equal(c.snapshot().submissions[0].materials.length,2);assert.equal(c.snapshot().needsSubmissionReview,true);
});
test('manual stage acknowledgement uncertainty is locked until actual proposal recovery',async()=>{
 const s=setup(),a=await seed(s),c=await actions(s,a.task.id);c.toggle(a.items[0].id);const original=s.commits.proposals.stage.bind(s.commits.proposals);
 s.commits.proposals.stage=async input=>{await original(input);throw Error('synthetic lost UI acknowledgement');};await c.prepareMaterials();assert.equal(c.snapshot().recoveryRequired,true);await c.prepareMaterials();
 await c.recover();assert.ok(c.snapshot().pending);assert.equal(c.snapshot().recoveryRequired,false);assert.equal(ok(await s.tasks.get(a.task.id)).task.version,1);await c.confirm();assert.equal(ok(await s.tasks.get(a.task.id)).task.version,2);
});
test('done and cancelled material history cannot be rewritten through low-level commit service',async()=>{
 const s=setup(),a=await seed(s);await apply(s,ok(await stage(s,a.task.id,c=>{c.draft.status='cancelled';})));
 assert.equal((await stage(s,a.task.id,c=>{c.checklistUpdates=[{itemId:a.items[0].id,state:'prepared'}];})).success,false);
 assert.equal((await stage(s,a.task.id,c=>{c.checklistCreates=[{label:'不能追加',sourceNoticeId:null}];})).success,false);
 const b=await seed(s,0,null);await apply(s,ok(await stage(s,b.task.id,c=>{c.draft.status='done';})));assert.equal((await stage(s,b.task.id,c=>{c.checklistCreates=[{label:'不能追加',sourceNoticeId:null}];})).success,false);
});

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
for(const mode of ['ordinary-task','material-state'])test('uncommitted '+mode+' confirmation keeps one operation ID across a fresh runtime while authority stays lost',async()=>{
 const s=setup(),initial=await seed(s);const p=ok(await stage(s,initial.task.id,c=>{if(mode==='ordinary-task')c.draft.title='合成标题更新';else c.checklistUpdates=[{itemId:initial.items[0].id,state:'prepared'}];}));
 const before=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));const snapshot=ok(await s.store.read());assert.equal(snapshot.proposals.at(-1).operationId,null);
 const freshRuntime=new Runtime();freshRuntime.time='2026-11-17T10:30:00+08:00';const cold=setup(s.files,freshRuntime);
 assert.equal((await cold.commits.confirmation.apply(before)).errorCode,'CONFIRMATION_REQUIRED');
 const after=ok(await cold.commits.confirmation.confirm(p.id,p.expectedRevision));assert.equal(after.operationId,before.operationId,'same persistent proposal must not mint a different idempotency ID after restart');
 const receipt=ok(await cold.commits.confirmation.apply(after));assert.equal(receipt.operationId,before.operationId);assert.equal(ok(await cold.store.read()).operations.filter(r=>r.proposalId===p.id).length,1);
});
test('cancelled task identity cannot be reallocated by a later explicit v4 reservation',async()=>{
 const {PlanningIntent}=require(root+'planning/PlanningContracts.ts');const s=setup(),initial=await seed(s),p=ok(await stage(s,initial.task.id,c=>{c.draft.title='合成待取消修改';})),request=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));ok(await s.commits.confirmation.cancel(p.id,p.expectedRevision));
 const before=s.files.files.get('task-store.json'),revision=ok(await s.store.read()).revision;let calls=0;s.runtime.nextId=()=>++calls===1?'new-plan-holder':request.operationId.slice('operation-'.length);
 const planning=new PlanningIntent();planning.availability=[];const result=await s.commits.proposals.stage({sessionId:'manual-week-plan',expectedRevision:revision,notices:[],changes:[],planning});assert.equal(result.success,false);assert.equal(result.errorCode,'INVALID_ARGUMENT');assert.equal(s.files.files.get('task-store.json'),before);
});
test('persistent task-operation identity keeps its independently computed frozen namespace vector',()=>{
 const {taskProposalOperationId}=require(root+'domain/OperationIdentity.ts');
 assert.equal(taskProposalOperationId('proposal-fixed-01'),'operation-b040c4ef85559bba5791e0261ac41998');
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


test('saved-task deadline edit stages actual old/new and human source offline; confirmation retains ID and materials',async()=>{
 const s=setup(),a=await seed(s),c=await actions(s,a.task.id);const before=ok(await s.tasks.get(a.task.id));
 await c.prepareDeadline('2026-12-28','18:15');assert.equal(c.snapshot().pending.changes[0].draft.dueAt,'2026-12-28T18:15:00+08:00');
 assert.deepEqual(ok(await s.tasks.get(a.task.id)).task,before.task);assert.deepEqual(ok(await s.tasks.get(a.task.id)).checklistItems,before.checklistItems);assert.equal(c.snapshot().pending.notices[0].sourceLabel,'人工补充 · 截止时间编辑');
 assert.equal(await c.confirm(),true);const after=ok(await s.tasks.get(a.task.id));assert.equal(after.task.id,a.task.id);assert.equal(after.task.version,before.task.version+1);
 assert.equal(after.task.dueAt,'2026-12-28T18:15:00+08:00');assert.deepEqual(after.checklistItems,before.checklistItems);assert.equal(after.notices.length,before.notices.length+1);
 const cold=setup(s.files);assert.deepEqual(ok(await cold.tasks.get(a.task.id)).task,after.task);
});
test('saved-task deadline supports date-only and unknown; invalid dates, stale versions and terminal changes stay blocked',async()=>{
 const s=setup(),a=await seed(s),c=await actions(s,a.task.id);const before=s.files.files.get('task-store.json');
 await c.prepareDeadline('2026-02-30','');assert.equal(c.snapshot().pending,null);assert.equal(s.files.files.get('task-store.json'),before);
 await c.prepareDeadline('2026-12-28','');assert.equal(c.snapshot().pending.changes[0].draft.deadlinePrecision,'date_only');assert.equal(await c.confirm(),true);
 c.select(ok(await s.tasks.get(a.task.id)));await c.prepareDeadline('','');assert.equal(c.snapshot().pending.changes[0].draft.deadlinePrecision,'unknown');await c.cancel();
 assert.equal(ok(await s.tasks.get(a.task.id)).task.deadlineDate,'2026-12-28');
 c.select(ok(await s.tasks.get(a.task.id)));await apply(s,ok(await stage(s,a.task.id,ch=>{ch.draft.title='合成新版本';})));await c.prepareDeadline('2026-12-29','18:00');assert.equal(c.snapshot().errorCode,'VERSION_CONFLICT');
});

test('repository completion projection follows only confirmed material writes and returns to active after append/uncheck',async()=>{
 const {taskIsComplete}=require(root+'tasks/TaskCompletion.ts');const s=setup(),a=await seed(s,1),c=await actions(s,a.task.id);
 const complete=async()=>{const list=ok(await s.tasks.list());return taskIsComplete(list.tasks.find(t=>t.id===a.task.id),list.progress.find(t=>t.taskId===a.task.id));};
 assert.equal(await complete(),false);c.toggle(a.items[0].id);await c.prepareMaterials();assert.equal(await complete(),false);await c.confirm();assert.equal(await complete(),true);
 c.select(ok(await s.tasks.get(a.task.id)));await c.prepareAddMaterial('合成新增事项');assert.equal(await complete(),true);await c.confirm();assert.equal(await complete(),false);
 c.select(ok(await s.tasks.get(a.task.id)));const added=c.snapshot().materials.find(i=>i.state==='pending');c.toggle(added.itemId);await c.prepareMaterials();await c.confirm();assert.equal(await complete(),true);
 c.select(ok(await s.tasks.get(a.task.id)));c.toggle(a.items[0].id);await c.prepareMaterials();await c.confirm();assert.equal(await complete(),false);
 const list=ok(await s.tasks.list());assert.equal(list.revision,ok(await s.tasks.get(a.task.id)).revision);assert.deepEqual({...list.progress.find(t=>t.taskId===a.task.id)},{taskId:a.task.id,total:2,prepared:1});
});
test('explicit append to a done task narrowly reopens work while preserving old receipts; cancelled stays protected',async()=>{
 const s=setup(),a=await seed(s,0,null);await apply(s,ok(await stage(s,a.task.id,c=>{c.draft.status='done';})));const before=ok(await s.store.read());
 const c=await actions(s,a.task.id);await c.prepareAddMaterial('合成新工作');assert.equal(c.snapshot().pending.changes[0].draft.status,'in_progress');assert.equal(ok(await s.tasks.get(a.task.id)).task.status,'done');
 assert.equal(await c.confirm(),true);const detail=ok(await s.tasks.get(a.task.id));assert.equal(detail.task.id,a.task.id);assert.equal(detail.task.status,'in_progress');assert.equal(detail.task.remainingMinutes,null);assert.equal(detail.checklistItems[0].state,'pending');
 const after=ok(await s.store.read());for(const receipt of before.operations)assert.deepEqual(after.operations.find(r=>r.operationId===receipt.operationId),receipt);
 const b=await seed(s,0,null);await apply(s,ok(await stage(s,b.task.id,c=>{c.draft.status='done';})));
 assert.equal((await stage(s,b.task.id,c=>{c.draft.status='in_progress';})).success,false);
 assert.equal((await stage(s,b.task.id,c=>{c.draft.status='in_progress';c.draft.remainingMinutes=10;c.checklistCreates=[{label:'合成追加',sourceNoticeId:null}];})).success,false);
 const cancelled=await seed(s,0,null);await apply(s,ok(await stage(s,cancelled.task.id,c=>{c.draft.status='cancelled';})));const cc=await actions(s,cancelled.task.id);await cc.prepareAddMaterial('合成禁止追加');assert.equal(cc.snapshot().pending,null);
});
test('submitted task with new pending material is active without erasing submission declaration',async()=>{
 const {taskIsComplete}=require(root+'tasks/TaskCompletion.ts');const s=setup(),a=await seed(s,1);const first=await submitted(s,a.task.id);const history=clone(first.submissionSnapshots);assert.equal(history.length,1);
 const c=await actions(s,a.task.id);await c.prepareAddMaterial('合成补交文件');await c.confirm();const list=ok(await s.tasks.list()),t=list.tasks.find(t=>t.id===a.task.id);assert.equal(t.status,'submitted');assert.equal(taskIsComplete(t,list.progress.find(p=>p.taskId===t.id)),false);assert.deepEqual(ok(await s.commits.confirmation.receipt(first.operationId)).submissionSnapshots,history);
});

test('cold repository derives completion from persisted current items after confirmed completion and append',async()=>{
 const {taskIsComplete}=require(root+'tasks/TaskCompletion.ts');const initial=setup(),a=await seed(initial,1),c=await actions(initial,a.task.id);
 c.toggle(a.items[0].id);await c.prepareMaterials();await c.confirm();c.dispose();
 const cold=setup(initial.files,initial.runtime);let list=ok(await cold.tasks.list());assert.equal(taskIsComplete(list.tasks[0],list.progress[0]),true);
 const again=await actions(cold,a.task.id);await again.prepareAddMaterial('合成冷恢复新增事项');await again.confirm();again.dispose();
 const restarted=setup(initial.files,initial.runtime);list=ok(await restarted.tasks.list());assert.equal(taskIsComplete(list.tasks[0],list.progress[0]),false);assert.equal(list.progress[0].total,2);assert.equal(list.progress[0].prepared,1);
 assert.equal(list.tasks[0].id,a.task.id);assert.equal(ok(await restarted.tasks.get(a.task.id)).checklistItems[0].state,'prepared');
});
