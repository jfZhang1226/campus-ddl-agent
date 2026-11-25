const {test}=require('node:test'),assert=require('node:assert/strict');
const {BusinessSnapshot}=require('../../client/entry/src/main/ets/domain/StorageModels.ts');
const {PlanningIntent}=require('../../client/entry/src/main/ets/planning/PlanningContracts.ts');
const {validatePlanningIntent,preparePlanningChange,planningCollections,planningTaskChanges,planningResult}=require('../../client/entry/src/main/ets/planning/PlanningRules.ts');
const clone=x=>structuredClone(x),time=t=>'2026-11-17T'+t+':00+08:00',now=time('09:00');
function snapshot(){const s=new BusinessSnapshot();s.revision=10;s.tasks=[{id:'task-a',title:'合成工作',course:null,kind:null,deadlinePrecision:'exact',deadlineDate:null,dueAt:time('18:00'),timezone:'Asia/Shanghai',priority:null,status:'todo',remainingMinutes:60,submissionChannel:null,noticeIds:[],version:1,createdAt:time('08:00'),updatedAt:time('08:00')}];s.availabilityBlocks=[{id:'free-original',startAt:time('09:00'),endAt:time('10:00')}];return s;}
function intent(action,fields={}){return Object.assign(new PlanningIntent(),{action},fields);}
function oldBlock(extra={}){return {id:'block-a',taskId:'task-a',startAt:time('09:00'),endAt:time('09:30'),state:'pending',locked:false,planRevision:9,...extra};}
test('availability intent accepts only explicit ranges and client derives stable IDs without writes or source mutation',()=>{
 const s=snapshot(),before=clone(s),i=intent('availability',{availability:[{startAt:time('10:00'),endAt:time('11:00')}]});const c=preparePlanningChange(s,i,now);assert.equal(c.beforeAvailability[0].id,'free-original');assert.match(c.afterAvailability[0].id,/^availability-[a-f0-9]{32}$/);assert.deepEqual(clone(s),before);assert.deepEqual(preparePlanningChange(s,i,now),c);assert.deepEqual(planningTaskChanges(c),[]);
});
test('unchanged availability instants retain original opaque ID and timestamp spelling',()=>{
 const s=snapshot(),c=preparePlanningChange(s,intent('availability',{availability:[{startAt:'2026-11-17T01:00:00Z',endAt:'2026-11-17T02:00:00Z'}]}),now);assert.deepEqual(c.afterAvailability,s.availabilityBlocks);
});
test('availability replacement does not implicitly delete or move any previous work block',()=>{
 const s=snapshot();s.planBlocks=[oldBlock({locked:true})];const c=preparePlanningChange(s,intent('availability',{availability:[]}),now);assert.deepEqual(c.afterBlocks,s.planBlocks);assert.deepEqual(c.afterAvailability,[]);assert.equal(c.candidate,null);
});
test('replan computes proposed saved revision, original DDL/effort stay unchanged and return value cannot alter intent',()=>{
 const s=snapshot(),before=clone(s),c=preparePlanningChange(s,intent('replan',{fromAt:now,toAt:'2026-11-24T09:00:00+08:00'}),now);assert.equal(c.afterBlocks.length,2);assert.ok(c.afterBlocks.every(b=>b.planRevision===12));assert.deepEqual(clone(s),before);assert.deepEqual(planningTaskChanges(c),[]);const r=planningResult(c);r.blocks[0].startAt='forged';assert.notEqual(c.afterBlocks[0].startAt,'forged');
});
test('partial plan reports unmet work and missing exact time rather than claiming complete feasibility',()=>{
 const s=snapshot();s.availabilityBlocks[0].endAt=time('09:30');s.tasks.push({...clone(s.tasks[0]),id:'task-b',remainingMinutes:30,deadlinePrecision:'date_only',deadlineDate:'2026-11-17',dueAt:null});const c=preparePlanningChange(s,intent('replan',{fromAt:now,toAt:'2026-11-24T09:00:00+08:00'}),now);assert.equal(c.candidate.newlyAssignedMinutes,30);assert.equal(planningResult(c).unscheduled.length,2);assert.ok(planningResult(c).unscheduled.some(x=>x.reason==='exact_deadline_required'));
});
test('retained conflicts reject staging candidate computation and preserve original arrays',()=>{
 const s=snapshot();s.planBlocks=[oldBlock({locked:true,startAt:time('11:00'),endAt:time('11:30')})];const before=clone(s);assert.throws(()=>preparePlanningChange(s,intent('replan',{fromAt:now,toAt:'2026-11-24T09:00:00+08:00'}),now),e=>e.code==='INVALID_ARGUMENT');assert.deepEqual(clone(s),before);
});
test('lock intent changes only selected pending block; no-op preserves original plan revision',()=>{
 const s=snapshot();s.planBlocks=[oldBlock(),oldBlock({id:'block-b',startAt:time('09:30'),endAt:time('10:00')})];const c=preparePlanningChange(s,intent('lock',{blockId:'block-a',locked:true}),now);assert.equal(c.afterBlocks[0].locked,true);assert.equal(c.afterBlocks[0].planRevision,12);assert.deepEqual(c.afterBlocks[1],s.planBlocks[1]);const no=preparePlanningChange(s,intent('lock',{blockId:'block-a',locked:false}),now);assert.deepEqual(no.afterBlocks,s.planBlocks);assert.deepEqual(planningTaskChanges(c),[]);
});
test('done requires explicit remaining effort including zero, returns only same-task effort update and preserves status/DDL/sources',()=>{
 const s=snapshot();s.planBlocks=[oldBlock()];s.tasks[0].noticeIds=['notice-synthetic'];const c=preparePlanningChange(s,intent('done',{blockId:'block-a',remainingMinutes:0}),now);assert.equal(c.afterBlocks[0].state,'done');const changes=planningTaskChanges(c);assert.equal(changes.length,1);assert.equal(changes[0].taskId,'task-a');assert.equal(changes[0].expectedVersion,1);assert.equal(changes[0].draft.remainingMinutes,0);assert.equal(changes[0].draft.status,'todo');assert.equal(changes[0].draft.dueAt,s.tasks[0].dueAt);assert.deepEqual(changes[0].draft.noticeIds,['notice-synthetic']);assert.deepEqual(changes[0].checklistCreates,[]);assert.equal(s.tasks[0].remainingMinutes,60);
});
test('completed block history is terminal and a finished task cannot be reopened through work completion',()=>{
 const s=snapshot();s.planBlocks=[oldBlock({state:'done'})];for(const i of [intent('lock',{blockId:'block-a',locked:true}),intent('done',{blockId:'block-a',remainingMinutes:0})])assert.throws(()=>preparePlanningChange(s,i,now));s.planBlocks[0].state='pending';s.tasks[0].status='submitted';assert.throws(()=>preparePlanningChange(s,intent('done',{blockId:'block-a',remainingMinutes:0}),now));
});
test('opaque legacy planning objects fail unsupported without dropping them; recognizable corruption stays corrupt',()=>{
 const s=snapshot();s.planBlocks=[{oldData:'preserve'}];const before=clone(s);assert.throws(()=>planningCollections(s),e=>e.code==='UNSUPPORTED_SCHEMA');assert.deepEqual(clone(s),before);s.planBlocks=[oldBlock({taskId:'missing'})];assert.throws(()=>planningCollections(s),e=>e.code==='CORRUPT_DATA');
});
test('injected IDs/confirmation/blocks, missing fields, unknown actions and invalid minute/null/range values are rejected',()=>{
 const bad=[intent('availability',{availability:[{id:'forced',startAt:now,endAt:time('10:00')}]}),intent('done',{blockId:'x',remainingMinutes:null}),intent('done',{blockId:'x',remainingMinutes:-1}),intent('lock',{blockId:'x',locked:null}),intent('replan',{fromAt:now,toAt:'2026-11-25T09:00:00+08:00'}),intent('apply',{blockId:'x'}),{action:'availability',availability:[]},Object.assign(intent('availability',{availability:[]}),{confirmed:true})];for(const i of bad)assert.throws(()=>validatePlanningIntent(i));
});
test('clock rollback, unsafe revision and stale missing block IDs fail without modifying business data',()=>{
 const s=snapshot();s.tasks[0].updatedAt=time('09:10');assert.throws(()=>preparePlanningChange(s,intent('availability',{availability:[]}),now));s.tasks[0].updatedAt=time('08:00');s.revision=Number.MAX_SAFE_INTEGER;assert.throws(()=>preparePlanningChange(s,intent('availability',{availability:[]}),now));s.revision=10;assert.throws(()=>preparePlanningChange(s,intent('lock',{blockId:'missing',locked:false}),now),e=>e.code==='NOT_FOUND');
});
