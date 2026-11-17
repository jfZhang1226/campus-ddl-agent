const {test}=require('node:test'),assert=require('node:assert/strict');
const root='../../client/entry/src/main/ets/';
const {LocalStore}=require(root+'data/LocalStore.ts'),{CommitServices}=require(root+'data/CommitServices.ts');
const {StorageCoordinator}=require(root+'data/storage/StorageCoordinator.ts'),{TaskRepository}=require(root+'data/TaskRepository.ts');
const {TaskDraft}=require(root+'domain/TaskContracts.ts'),{BusinessSnapshot}=require(root+'domain/StorageModels.ts');
const {PlanningIntent}=require(root+'planning/PlanningContracts.ts');
const {PlanningController}=require(root+'planning/PlanningController.ts');
const {parseAvailability,planningTimestamp,planningTimeLabel}=require(root+'planning/PlanningForm.ts');
const clone=x=>structuredClone(x),ok=r=>{assert.equal(r.success,true,r.errorCode+': '+r.message);return r.data;};
const at=t=>'2026-11-17T'+t+':00+08:00';
class Files {
 files=new Map();writes=0;commits=0;fail=false;lose=false;
 async ensureDirectory(){}async exists(n){return this.files.has(n);}async readText(n){if(!this.files.has(n))throw Error('missing');return this.files.get(n);}
 async writeText(n,s){this.writes++;this.files.set(n,s);}
 async replace(a,b){if(b==='task-store.json'&&this.fail){this.fail=false;throw Error('before commit');}this.files.set(b,this.files.get(a));this.files.delete(a);if(b==='task-store.json'){this.commits++;if(this.lose){this.lose=false;throw Error('lost acknowledgement');}}}
 async listNames(d){const p=d?d+'/':'';return [...this.files.keys()].filter(n=>n.startsWith(p)&&!n.slice(p.length).includes('/')).map(n=>n.slice(p.length));}
}
class Runtime {n=0;time=at('09:00');now(){return this.time;}nextId(){return 'synthetic-'+(++this.n);}}
function setup(files=new Files(),runtime=new Runtime()){const store=new LocalStore(new StorageCoordinator(files));return {files,runtime,store,commits:new CommitServices(store,runtime),tasks:new TaskRepository(store,runtime)};}
async function seed(s){const d=new TaskDraft();d.title='合成计划任务';d.remainingMinutes=90;d.deadlinePrecision='exact';d.dueAt=at('18:00');return ok(await s.tasks.create(d,ok(await s.store.read()).revision));}
function intent(action,fields={}){return Object.assign(new PlanningIntent(),{action},fields);}
async function stage(s,i){return s.commits.proposals.stage({sessionId:'manual-week-plan',expectedRevision:ok(await s.store.read()).revision,notices:[],changes:[],planning:i});}
async function apply(s,p){return ok(await s.commits.confirmation.apply(ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision))));}
async function availability(s,end='10:00'){return apply(s,ok(await stage(s,intent('availability',{availability:[{startAt:at('09:10'),endAt:at(end)}]}))));}
async function plan(s){return stage(s,intent('replan',{fromAt:at('09:05'),toAt:at('19:00')}));}
async function planned(){const s=setup();await seed(s);await availability(s);await apply(s,ok(await plan(s)));return s;}

test('zero-task availability stages a stable reserved ID, writes no formal ranges before confirmation, then one atomic v4 result',async()=>{
 const s=setup(),p=ok(await stage(s,intent('availability',{availability:[{startAt:at('10:00'),endAt:at('12:00')}]})));
 assert.equal(p.recordType,'t16.proposal.v4');assert.ok(p.operationId);assert.deepEqual(p.changes,[]);assert.deepEqual(ok(await s.store.read()).availabilityBlocks,[]);
 const n=s.files.commits,r=await apply(s,p),snapshot=ok(await s.store.read());assert.equal(s.files.commits,n+1);assert.equal(r.operationId,p.operationId);assert.deepEqual(r.affectedTaskIds,[]);
 assert.equal(snapshot.availabilityBlocks.length,1);assert.equal(snapshot.proposals[0].state,'applied');assert.deepEqual(snapshot.operations[0],r);
});
test('replan commits partial capacity and honest gaps without mutating task DDL, effort, status or materials',async()=>{
 const s=setup();await seed(s);await availability(s);const before=ok(await s.store.read()),p=ok(await plan(s));assert.deepEqual(ok(await s.store.read()).planBlocks,[]);
 const r=await apply(s,p),after=ok(await s.store.read());assert.equal(r.planning.blocks.length,2);assert.equal(r.planning.unscheduled[0].minutes,40);assert.equal(r.planning.unscheduled[0].reason,'insufficient_capacity_before_deadline');
 assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.checklistItems,before.checklistItems);assert.deepEqual(after.planBlocks,r.planning.blocks);assert.ok(after.planBlocks.every(b=>b.planRevision===r.committedRevision));
});
test('cold pending has no authority; explicit re-confirmation keeps original operationId',async()=>{
 const s=setup(),p=ok(await stage(s,intent('availability',{availability:[]}))),req=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision)),cold=setup(s.files,s.runtime);
 assert.equal((await cold.commits.confirmation.apply(req)).errorCode,'CONFIRMATION_REQUIRED');const again=ok(await cold.commits.confirmation.confirm(p.id,p.expectedRevision));assert.deepEqual(again,req);ok(await cold.commits.confirmation.apply(again));
});
test('successful cold replay after later arrangements returns original result and never regenerates blocks',async()=>{
 const s=await planned(),p=ok(await stage(s,intent('lock',{blockId:ok(await s.store.read()).planBlocks[0].id,locked:true}))),req=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision)),r=ok(await s.commits.confirmation.apply(req));
 await availability(s,'11:00');const before=ok(await s.store.read());s.runtime.time=at('20:00');const cold=setup(s.files,s.runtime);assert.deepEqual(ok(await cold.commits.confirmation.apply(req)),r);assert.deepEqual(ok(await cold.store.read()),before);
});
test('cancellation preserves formal ranges and blocks; cancelled operation ID remains reserved',async()=>{
 const s=await planned(),before=ok(await s.store.read()),p=ok(await stage(s,intent('availability',{availability:[]})));ok(await s.commits.confirmation.cancel(p.id,p.expectedRevision));
 const after=ok(await s.store.read());assert.deepEqual(after.planBlocks,before.planBlocks);assert.deepEqual(after.availabilityBlocks,before.availabilityBlocks);assert.equal(ok(await s.commits.proposals.get(p.id)).operationId,p.operationId);
 const p2=ok(await stage(s,intent('availability',{availability:[]})));assert.notEqual(p2.operationId,p.operationId);
});
test('known pending task and plan proposals exclude each other without new writes',async()=>{
 const s=setup(),p=ok(await stage(s,intent('availability',{availability:[]}))),d=new TaskDraft();d.title='合成任务';const input={sessionId:'manual-task-board',expectedRevision:p.expectedRevision,notices:[],changes:[{action:'create',taskId:null,expectedVersion:null,draft:d}]};
 const writes=s.files.writes;assert.equal((await s.commits.proposals.stage(input)).errorCode,'CONFIRMATION_REQUIRED');assert.equal(s.files.writes,writes);ok(await s.commits.confirmation.cancel(p.id,p.expectedRevision));input.expectedRevision=ok(await s.store.read()).revision;ok(await s.commits.proposals.stage(input));assert.equal((await stage(s,intent('availability',{availability:[]}))).errorCode,'CONFIRMATION_REQUIRED');
});
test('a newer repository write blocks stale plan apply and preserves all newer data',async()=>{
 const s=setup();await seed(s);await availability(s);const p=ok(await plan(s)),req=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));const d=new TaskDraft();d.title='合成并发任务';ok(await s.tasks.create(d,p.expectedRevision));const before=ok(await s.store.read());
 assert.equal((await s.commits.confirmation.apply(req)).errorCode,'VERSION_CONFLICT');assert.deepEqual(ok(await s.store.read()),before);
});
test('elapsed candidate is rejected and not silently moved, even when screen confirmation was earlier',async()=>{
 const s=setup();await seed(s);await availability(s);const p=ok(await plan(s)),req=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision)),before=ok(await s.store.read());s.runtime.time=at('09:12');
 assert.equal((await s.commits.confirmation.apply(req)).errorCode,'PLAN_EXPIRED');assert.deepEqual(ok(await s.store.read()),before);
});
test('pre-replace failure retries same plan; lost replace acknowledgement recovers once with same ID',async()=>{
 for(const flag of ['fail','lose']){const s=setup(),p=ok(await stage(s,intent('availability',{availability:[]}))),req=ok(await s.commits.confirmation.confirm(p.id,p.expectedRevision));s.files[flag]=true;const first=await s.commits.confirmation.apply(req);if(flag==='fail')assert.equal(first.success,false);else assert.equal(first.success,true);
 const r=ok(await s.commits.confirmation.apply(req)),actual=ok(await s.store.read());assert.equal(r.operationId,p.operationId);assert.equal(actual.operations.length,1);assert.equal(actual.revision,p.expectedRevision+1);}
});
test('lock/no-op/release preserve unrelated blocks and no-op block revision',async()=>{
 const s=await planned(),original=ok(await s.store.read()).planBlocks;await apply(s,ok(await stage(s,intent('lock',{blockId:original[0].id,locked:true}))));let a=ok(await s.store.read()).planBlocks;assert.equal(a[0].locked,true);assert.deepEqual(a[1],original[1]);const v=a[0].planRevision;
 await apply(s,ok(await stage(s,intent('lock',{blockId:original[0].id,locked:true}))));assert.equal(ok(await s.store.read()).planBlocks[0].planRevision,v);await apply(s,ok(await stage(s,intent('lock',{blockId:original[0].id,locked:false}))));assert.equal(ok(await s.store.read()).planBlocks[0].locked,false);
});
test('done block and explicitly declared zero remaining are one atomic write, without auto-completing task',async()=>{
 const s=await planned(),before=ok(await s.store.read()),id=before.planBlocks[0].id,p=ok(await stage(s,intent('done',{blockId:id,remainingMinutes:0})));assert.equal(ok(await s.store.read()).planBlocks[0].state,'pending');assert.equal(p.changes[0].draft.remainingMinutes,0);
 const n=s.files.commits,r=await apply(s,p),after=ok(await s.store.read());assert.equal(s.files.commits,n+1);assert.equal(after.planBlocks[0].state,'done');assert.equal(after.tasks[0].remainingMinutes,0);assert.equal(after.tasks[0].status,'todo');assert.equal(after.tasks[0].dueAt,before.tasks[0].dueAt);assert.equal(after.tasks[0].version,before.tasks[0].version+1);assert.equal(r.tasks[0].remainingMinutes,0);
 assert.equal((await stage(s,intent('done',{blockId:id,remainingMinutes:0}))).success,false);
});
test('opaque legacy objects are preserved by task reads, planning refuses to reinterpret them',async()=>{
 const s=setup(),snap=new BusinessSnapshot();snap.availabilityBlocks=[{legacy:'keep this'}];ok(await s.store.save(snap,0));const bytes=s.files.files.get('task-store.json');
 assert.equal((await stage(s,intent('availability',{availability:[]}))).errorCode,'UNSUPPORTED_SCHEMA');assert.equal(s.files.files.get('task-store.json'),bytes);assert.deepEqual(ok(await s.tasks.list()).tasks,[]);
});
for(const mutate of [s=>{s.operations.at(-1).planning.blocks[0].startAt=at('17:00');},s=>{s.proposals.at(-1).planning.afterBlocks[0].locked=true;},s=>{s.planBlocks[0].taskId='missing';},s=>{s.proposals.at(-1).operationId='operation-forged';}])test('corrupt plan result/recipe/reference/pair refuses save without changing original primary bytes',async()=>{
 const s=await planned(),snap=ok(await s.store.read()),bytes=s.files.files.get('task-store.json');mutate(snap);assert.equal((await s.store.save(snap,snap.revision)).success,false);assert.equal(s.files.files.get('task-store.json'),bytes);
});
test('arbitrary candidate blocks, mixed task changes and model confirmation cannot enter planning intent',async()=>{
 const s=setup(),base=intent('availability',{availability:[]});for(const i of [{...base,blocks:[]},{...base,confirmed:true},intent('done',{blockId:'unknown'})]){assert.equal((await stage(s,i)).success,false);}assert.equal(s.files.writes,0);
 const input={sessionId:'manual-week-plan',expectedRevision:0,notices:[],changes:[{}],planning:base};assert.equal((await s.commits.proposals.stage(input)).success,false);assert.equal(s.files.writes,0);
});
test('planning screen stages only, cold restores without applying and explicitly confirms same ID',async()=>{
 const s=setup(),c=new PlanningController(s.store,s.commits);await c.recover();await c.stage(intent('availability',{availability:[]}));const p=c.snapshot().pending;assert.ok(p);assert.equal(ok(await s.store.read()).operations.length,0);c.dispose();
 const cold=setup(s.files,s.runtime),again=new PlanningController(cold.store,cold.commits);await again.recover();assert.equal(again.snapshot().pending.id,p.id);assert.match(again.snapshot().notice,/没有自动保存/);assert.equal(await again.confirm(),true);assert.equal(again.snapshot().receipt.operationId,p.operationId);assert.equal(again.snapshot().pending,null);assert.equal(await again.confirm(),false);
});
test('planning screen stale displayed revision cannot overwrite a newer availability view',async()=>{
 const s=setup(),c=new PlanningController(s.store,s.commits);await c.recover();await availability(s);const bytes=s.files.files.get('task-store.json');await c.stage(intent('availability',{availability:[]}));assert.equal(c.snapshot().errorCode,'VERSION_CONFLICT');assert.equal(c.snapshot().pending,null);assert.equal(s.files.files.get('task-store.json'),bytes);
});
test('planning screen uncertain stage locks further generation until actual pending recovery',async()=>{
 const s=setup(),c=new PlanningController(s.store,s.commits);await c.recover();const original=s.commits.proposals.stage.bind(s.commits.proposals);s.commits.proposals.stage=async i=>{await original(i);throw Error('lost screen acknowledgement');};await c.stage(intent('availability',{availability:[]}));assert.equal(c.snapshot().recoveryRequired,true);await c.stage(intent('availability',{availability:[]}));assert.equal(ok(await s.store.read()).proposals.length,1);await c.recover();assert.ok(c.snapshot().pending);assert.equal(c.snapshot().recoveryRequired,false);await c.cancel();assert.equal(c.snapshot().pending,null);assert.equal(ok(await s.store.read()).operations.length,0);
});
test('planning screen retains successful receipt when subsequent page read fails',async()=>{
 const s=setup(),c=new PlanningController(s.store,s.commits);await c.recover();await c.stage(intent('availability',{availability:[]}));const original=s.commits.confirmation.apply.bind(s.commits.confirmation);s.commits.confirmation.apply=async r=>{const result=await original(r);if(result.success)s.store.read=async()=>({success:false,data:null,errorCode:'STORAGE_FAILED',message:'synthetic read failure'});return result;};
 assert.equal(await c.confirm(),true);assert.ok(c.snapshot().receipt);assert.equal(c.snapshot().pending,null);assert.equal(c.snapshot().recoveryRequired,true);assert.match(c.snapshot().notice,/已取得正式保存回执/);
});
test('planning screen disposal suppresses delayed UI publication and further writes',async()=>{
 const s=setup(),c=new PlanningController(s.store,s.commits);let calls=0;c.subscribe(()=>calls++);const loading=c.recover();c.dispose();const n=calls;await loading;await c.stage(intent('availability',{availability:[]}));assert.equal(calls,n);assert.equal(s.files.writes,0);
});
test('planning form requires complete valid Beijing dates, preserves zero ranges and handles multiple explicit rows',()=>{
 const rows=parseAvailability('2026-11-18 19:00 ~ 2026-11-18 21:00\n2026-11-19 18:30 ~ 2026-11-19 19:00');assert.equal(rows.length,2);assert.equal(rows[0].startAt,'2026-11-18T19:00:00+08:00');assert.equal(planningTimeLabel('2026-11-18T11:00:00Z'),'2026-11-18 19:00');assert.deepEqual(parseAvailability(''),[]);
 for(const text of ['明天晚上','2026-02-30 19:00','2026-11-18 24:00','2026-11-18'])assert.throws(()=>planningTimestamp(text),e=>e.code==='INVALID_ARGUMENT');assert.throws(()=>parseAvailability('2026-11-18 19:00'),e=>e.code==='INVALID_ARGUMENT');
});
