const {test}=require('node:test'),assert=require('node:assert/strict');
const root='../../client/entry/src/main/ets/';
const {BusinessSnapshot}=require(root+'domain/StorageModels.ts');
const {TaskDraft}=require(root+'domain/TaskContracts.ts');
const {queryPlanningRange,validAvailabilityDates}=require(root+'planning/PlanningQuery.ts');
const {AgentExecutor}=require(root+'agent/AgentExecutor.ts');
const {StorageFailure}=require(root+'data/storage/StorageTypes.ts');
const ok=data=>({success:true,data,errorCode:null,message:''});
function source(){const s=new BusinessSnapshot();s.revision=5;const task={...new TaskDraft(),id:'task-q',version:1,createdAt:'2026-11-17T09:00:00+08:00',updatedAt:'2026-11-17T09:00:00+08:00',title:'private task title not needed for range query'};s.tasks=[task];
 s.availabilityBlocks=[{id:'cross',startAt:'2026-11-17T23:00:00+08:00',endAt:'2026-11-18T01:00:00+08:00'},{id:'end-boundary',startAt:'2026-11-19T00:00:00+08:00',endAt:'2026-11-19T01:00:00+08:00'}];
 s.planBlocks=[{id:'pending-q',taskId:task.id,startAt:'2026-11-18T18:00:00+08:00',endAt:'2026-11-18T18:30:00+08:00',state:'pending',locked:true,planRevision:4},{id:'done-q',taskId:task.id,startAt:'2026-11-18T18:30:00+08:00',endAt:'2026-11-18T19:00:00+08:00',state:'done',locked:false,planRevision:5}];
 s.notices=[{rawText:'private notification not needed for range query'}];return s;}
test('availability range is strict full dates, inclusive and at most seven Beijing days',()=>{
 assert.equal(validAvailabilityDates('2026-11-18','2026-11-18'),true);assert.equal(validAvailabilityDates('2026-11-18','2026-11-24'),true);
 for(const [a,b] of [['2026-11-18','2026-11-25'],['2026-11-18','2026-11-17'],['2026-02-30','2026-03-01'],['明天','2026-11-18'],[null,'2026-11-18'],['2026-11-18T00:00:00Z','2026-11-19']])assert.equal(validAvailabilityDates(a,b),false);
});
test('query returns actual intersecting original bounds, state and revision without leaking sources or changing data',()=>{
 const s=source(),before=structuredClone(s),r=queryPlanningRange(s,'2026-11-18','2026-11-18');assert.equal(r.revision,5);assert.equal(r.timezone,'Asia/Shanghai');assert.equal(r.rangeSemantics,'overlap_original_bounds');assert.deepEqual(r.availability,[s.availabilityBlocks[0]]);assert.deepEqual(r.planBlocks,s.planBlocks);assert.equal(r.planBlocks[1].state,'done');assert.doesNotMatch(JSON.stringify(r),/private task title|private notification/);r.availability[0].startAt='forged';assert.deepEqual(structuredClone(s),before);
});
test('UTC timestamps are selected by Beijing day and exact end boundaries stay outside',()=>{
 const s=source();s.availabilityBlocks=[{id:'utc',startAt:'2026-11-17T16:00:00Z',endAt:'2026-11-17T17:00:00Z'},{id:'before',startAt:'2026-11-17T15:00:00Z',endAt:'2026-11-17T16:00:00Z'}];assert.deepEqual(queryPlanningRange(s,'2026-11-18','2026-11-18').availability.map(r=>r.id),['utc']);
});
test('opaque existing objects, corrupt references and future receipt fail read without modifying source',()=>{
 for(const change of [s=>s.availabilityBlocks=[{legacy:'keep'}],s=>s.planBlocks[0].taskId='missing',s=>s.operations=[{recordType:'t16.operation.v4',committedRevision:6}]]){const s=source();change(s);const before=structuredClone(s);assert.throws(()=>queryPlanningRange(s,'2026-11-18','2026-11-18'),e=>['CORRUPT_DATA','UNSUPPORTED_SCHEMA'].includes(e.code));assert.deepEqual(structuredClone(s),before);}
});
test('executor injects only read capability; invalid ranges do not access it and fallback stays explicit',async()=>{
 let reads=0;const tasks={list:async()=>ok({}),get:async()=>ok({})},notices={read:async()=>ok({})},proposals={stage:async()=>{throw Error('must not stage');}},reader={read:async(a,b)=>{reads++;return ok(queryPlanningRange(source(),a,b));}};
 const ex=new AgentExecutor(tasks,notices,proposals,reader),call={id:'q',action:'get_availability',params:{dateFrom:'2026-11-18',dateTo:'2026-11-18'}};assert.equal((await ex.execute(call)).data.planBlocks.length,2);assert.equal(reads,1);
 assert.equal((await ex.execute({...call,params:{dateFrom:'2026-02-30',dateTo:'2026-03-01'}})).errorCode,'INVALID_ARGUMENT');assert.equal(reads,1);
 assert.equal((await new AgentExecutor(tasks,notices,proposals).execute(call)).errorCode,'NOT_IMPLEMENTED');
 const bad=new AgentExecutor(tasks,notices,proposals,{read:async()=>{throw new StorageFailure('CORRUPT_DATA','kept original');}});assert.equal((await bad.execute(call)).errorCode,'CORRUPT_DATA');
});
test('large query fails with explicit range reduction rather than silent truncation or source inclusion',()=>{
 const s=source();s.planBlocks=Array.from({length:201},(_,i)=>({...s.planBlocks[0],id:'block-'+i}));const before=structuredClone(s);assert.throws(()=>queryPlanningRange(s,'2026-11-18','2026-11-18'),e=>e.code==='QUERY_TOO_LARGE');assert.deepEqual(structuredClone(s),before);
});
