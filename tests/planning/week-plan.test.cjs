const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildWeekPlan}=require('../../client/entry/src/main/ets/planning/WeekPlanner.ts');
const clone=x=>structuredClone(x),time=t=>'2026-11-17T'+t+':00+08:00';
function task(id='task-a',remaining=60,due='18:00',priority=null){return {id,title:'合成工作'+id,course:null,kind:null,deadlinePrecision:'exact',deadlineDate:null,dueAt:time(due),timezone:'Asia/Shanghai',priority,status:'todo',remainingMinutes:remaining,submissionChannel:null,noticeIds:[],version:1,createdAt:time('08:00'),updatedAt:time('08:00')};}
function block(id,start,end,extra={}){return {id,startAt:time(start),endAt:time(end),...extra};}
function plan(id,taskId,start,end,extra={}){return block(id,start,end,{taskId,state:'pending',locked:false,planRevision:2,...extra});}
function input(tasks=[task()]){return {revision:3,fromAt:time('09:00'),toAt:'2026-11-24T09:00:00+08:00',now:time('09:00'),tasks,availability:[block('free','09:00','12:00')],existing:[]};}
const duration=b=>(Date.parse(b.endAt)-Date.parse(b.startAt))/60000;
test('deterministic bounded work chunks do not mutate source, DDL or remaining effort',()=>{
 const a=input([task('task-a',65)]),before=clone(a),r=buildWeekPlan(a);assert.deepEqual(r.generated.map(duration),[30,30,5]);assert.equal(r.newlyAssignedMinutes,65);assert.equal(r.unscheduled.length,0);assert.deepEqual(a,before);assert.deepEqual(buildWeekPlan(a),r);
});
test('overlapping availability is a union, never double-counts free capacity or overlaps new work',()=>{
 const a=input([task('a',150)]);a.availability=[block('x','09:00','10:00'),block('y','09:30','11:00')];const r=buildWeekPlan(a);assert.equal(r.suppliedCapacityMinutes,120);assert.equal(r.newlyAssignedMinutes,120);assert.equal(r.unscheduled[0].minutes,30);for(let i=1;i<r.generated.length;i++)assert.ok(Date.parse(r.generated[i-1].endAt)<=Date.parse(r.generated[i].startAt));
});
test('earliest deadline first; equal deadlines follow explicit priority then stable ID',()=>{
 const a=input([task('late-high',30,'12:00','high'),task('early-low',30,'10:00','low'),task('same-normal',30,'10:00','normal')]);const r=buildWeekPlan(a);assert.deepEqual(r.generated.map(b=>b.taskId),['same-normal','early-low','late-high']);
 assert.deepEqual(buildWeekPlan({...a,tasks:a.tasks.slice().reverse(),availability:a.availability.slice().reverse()}),r);
});
test('unknown effort or date precision is not guessed and zero effort never auto-finishes task',()=>{
 const a=input([task('no-effort',null),task('date-only',30),task('unknown-date',30),task('zero',0)]);a.tasks[1].deadlinePrecision='date_only';a.tasks[1].deadlineDate='2026-11-17';a.tasks[1].dueAt=null;a.tasks[2].deadlinePrecision='unknown';a.tasks[2].dueAt=null;
 const r=buildWeekPlan(a);assert.equal(r.generated.length,0);assert.equal(r.knownDemandMinutes,60);assert.equal(r.unscheduled.find(x=>x.taskId==='no-effort').minutes,null);assert.equal(r.unscheduled.filter(x=>x.reason==='exact_deadline_required').length,2);assert.equal(a.tasks[3].status,'todo');
});
test('terminal tasks consume no new work; existing locked work for terminal task stays visible as conflict',()=>{
 const a=input([task('a',30),task('b',30),task('c',30)]);a.tasks.forEach((t,i)=>t.status=['submitted','done','cancelled'][i]);assert.equal(buildWeekPlan(a).generated.length,0);a.existing=[plan('lock','a','09:00','09:30',{locked:true})];const r=buildWeekPlan(a);assert.equal(r.retained.length,1);assert.ok(r.conflicts.some(c=>c.reason==='retained_work_for_finished_task'));
});
test('locked pending work occupies existing remaining work; done blocks do not subtract remaining twice',()=>{
 const a=input([task('a',60)]);a.existing=[plan('locked','a','10:00','10:30',{locked:true}),plan('finished','a','09:00','09:30',{state:'done'})];const r=buildWeekPlan(a);assert.deepEqual(r.retained,a.existing.slice().reverse());assert.equal(r.retainedPendingMinutes,30);assert.equal(r.newlyAssignedMinutes,30);assert.equal(r.freeCapacityMinutes,120);assert.equal(r.generated[0].startAt,'2026-11-17T01:30:00.000Z');
});
test('only wholly in-range unlocked pending blocks are replaced, including when input order changes',()=>{
 const a=input([task('a',120)]);a.existing=[plan('replace-z','a','10:00','10:30'),plan('replace-a','a','11:00','11:30'),plan('past','a','08:00','08:30'),{...plan('later','a','10:00','10:30'),startAt:'2026-11-25T09:00:00+08:00',endAt:'2026-11-25T09:30:00+08:00'}];a.tasks[0].dueAt='2026-11-26T18:00:00+08:00';const r=buildWeekPlan(a);assert.deepEqual(r.replacedBlockIds,['replace-a','replace-z']);assert.deepEqual(r.retained.map(b=>b.id),['past','later']);assert.equal(r.retainedPendingMinutes,30);assert.equal(r.newlyAssignedMinutes,90);assert.equal(r.conflicts.length,0);assert.deepEqual(buildWeekPlan({...a,existing:a.existing.slice().reverse()}),r);
});
test('immutable overlap or outside-availability conflicts are preserved and prevent hidden new allocation',()=>{
 const a=input([task('a',120)]);a.existing=[plan('one','a','09:00','10:00',{locked:true}),plan('two','a','09:30','10:30',{locked:true})];let r=buildWeekPlan(a);assert.equal(r.generated.length,0);assert.ok(r.conflicts.some(c=>c.reason==='retained_blocks_overlap'));assert.equal(r.retained.length,2);
 a.existing=[plan('outside','a','13:00','13:30',{locked:true})];r=buildWeekPlan(a);assert.ok(r.conflicts.some(c=>c.reason==='retained_work_outside_availability'));assert.equal(r.newlyAssignedMinutes,0);
});
test('retained work cannot exceed remaining effort or lie after changed DDL, old blocks remain unchanged',()=>{
 const a=input([task('a',10,'09:15')]);a.existing=[plan('old','a','09:00','09:30',{locked:true})];const r=buildWeekPlan(a);assert.ok(r.conflicts.some(c=>c.reason==='retained_work_exceeds_remaining_effort'));assert.ok(r.conflicts.some(c=>c.reason==='retained_work_deadline_unverified'));assert.deepEqual(r.retained,a.existing);assert.equal(r.generated.length,0);
});
test('exact second-level DDL and current clock round inward, never invent extra minutes',()=>{
 const a=input([task('a',20,'09:20')]);a.now='2026-11-17T09:00:31+08:00';a.tasks[0].dueAt='2026-11-17T09:20:31+08:00';const r=buildWeekPlan(a);assert.equal(r.generated[0].startAt,'2026-11-17T01:01:00.000Z');assert.equal(r.newlyAssignedMinutes,19);assert.equal(r.unscheduled[0].minutes,1);assert.ok(Date.parse(r.generated.at(-1).endAt)<Date.parse(a.tasks[0].dueAt));
});
test('capacity beyond DDL does not masquerade as feasible and overdue work reports a reason',()=>{
 const a=input([task('a',60,'09:30'),task('b',30,'08:30')]);const r=buildWeekPlan(a);assert.equal(r.suppliedCapacityMinutes,180);assert.ok(r.unscheduled.some(u=>u.taskId==='a'&&u.minutes===30&&u.reason==='insufficient_capacity_before_deadline'));assert.ok(r.unscheduled.some(u=>u.taskId==='b'&&u.reason==='deadline_passed'));
});
test('offsets compare instants and availability clips to a future seven-day window',()=>{
 const a=input([task('a',30)]);a.availability=[{id:'offset',startAt:'2026-11-17T00:30:00Z',endAt:'2026-11-17T01:30:00Z'}];const r=buildWeekPlan(a);assert.equal(r.suppliedCapacityMinutes,30);assert.equal(r.generated[0].startAt,'2026-11-17T01:00:00.000Z');
});
test('bad times, zero lengths, nonfinite values, duplicate IDs and dangling task references are rejected read-only',()=>{
 for(const mutate of [a=>a.toAt='2026-11-25T09:00:00+08:00',a=>a.availability=[null],a=>a.availability[0].endAt=a.availability[0].startAt,a=>a.availability[0].startAt='2026-02-30T10:00:00+08:00',a=>a.tasks[0].remainingMinutes=NaN,a=>a.tasks.push(clone(a.tasks[0])),a=>a.existing=[plan('bad','missing','10:00','10:30')],a=>a.existing=[plan('bad','a','10:00','10:30',{state:'forged'})]]){const a=input();mutate(a);const before=clone(a);assert.throws(()=>buildWeekPlan(a));assert.deepEqual(a,before);}
});
test('generated candidate invariants hold across 80 deterministic workloads without exceeding remaining work',()=>{
 for(let seed=1;seed<=80;seed++){
  const tasks=Array.from({length:5},(_,i)=>task('t'+i,(seed*13+i*7)%75+1,['10:00','10:30','11:00','11:30','12:00'][i],['normal','high','low'][i%3]));
  const a=input(tasks);a.availability=[block('s1','09:00','10:00'),block('s2','10:30','12:00')];const r=buildWeekPlan(a),sorted=r.generated.slice().sort((x,y)=>Date.parse(x.startAt)-Date.parse(y.startAt));
  assert.ok(r.newlyAssignedMinutes<=150);for(let i=0;i<sorted.length;i++){const b=sorted[i],t=tasks.find(t=>t.id===b.taskId);assert.ok(duration(b)>0&&duration(b)<=30);assert.ok(Date.parse(b.endAt)<=Date.parse(t.dueAt));assert.ok(a.availability.some(s=>Date.parse(s.startAt)<=Date.parse(b.startAt)&&Date.parse(s.endAt)>=Date.parse(b.endAt)));if(i)assert.ok(Date.parse(sorted[i-1].endAt)<=Date.parse(b.startAt));}
  for(const t of tasks){const assigned=r.generated.filter(b=>b.taskId===t.id).reduce((sum,b)=>sum+duration(b),0);const gap=r.unscheduled.find(u=>u.taskId===t.id)?.minutes||0;assert.equal(assigned+gap,t.remainingMinutes);}
 }
});
