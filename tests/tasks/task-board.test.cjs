const {test}=require('node:test'),assert=require('node:assert/strict');
const {TaskBoardController}=require('../../client/entry/src/main/ets/tasks/TaskBoardController.ts');
const clone=x=>structuredClone(x),ok=data=>({success:true,data,message:'',errorCode:null}),fail=()=>({success:false,data:null,message:'合成读失败',errorCode:'STORAGE_FAILED'});
const task=(id,date,status='todo')=>({id,title:'合成任务'+id,course:'软件工程',kind:'report',deadlinePrecision:date===null?'unknown':'date_only',deadlineDate:date,dueAt:null,timezone:'Asia/Shanghai',priority:null,status,remainingMinutes:null,submissionChannel:null,noticeIds:[],version:1,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'});
function setup(tasks,now='2026-11-17T04:00:00Z'){
 const port={reads:0,gets:0,fail:false,async list(){this.reads++;return this.fail?fail():ok({tasks:clone(tasks),revision:7});},async get(id){this.gets++;return this.fail?fail():ok({task:clone(tasks.find(t=>t.id===id)),notices:[{id:'source',rawText:'合成原通知',publishedAt:null}],checklistItems:[{id:'item',taskId:id,label:'PDF',state:'pending'}],revision:8});}};
 return {port,c:new TaskBoardController(port,()=>now)};
}
test('date-only today never invents midnight overdue; exact due time is compared as an instant',async()=>{
 const exact=task('exact',null);Object.assign(exact,{deadlinePrecision:'exact',dueAt:'2026-11-17T11:00:00+08:00'});
 const s=setup([task('day','2026-11-17'),exact,task('old','2026-11-16')]);await s.c.reload();
 assert.equal(s.c.snapshot().rows.find(x=>x.task.id==='day').section,'今天到期');
 assert.match(s.c.snapshot().rows.find(x=>x.task.id==='day').deadlineText,/具体时刻未知/);
 assert.equal(s.c.snapshot().rows.find(x=>x.task.id==='exact').section,'已逾期');assert.equal(s.c.snapshot().rows[0].section,'已逾期');
});
test('seven-day range crosses years, keeps last day and excludes the eighth without changing deadlines',async()=>{
 const tasks=[task('first','2026-12-29'),task('last','2027-01-04'),task('eighth','2027-01-05'),task('unknown',null)];const before=clone(tasks);
 const s=setup(tasks,'2026-12-29T00:00:00Z');await s.c.reload();s.c.setFilter('week');assert.deepEqual(s.c.snapshot().rows.map(x=>x.task.id),['first','last']);assert.deepEqual(tasks,before);
});
test('search and filters use actual task rows without model calls or extra repository reads',async()=>{
 const s=setup([task('active',null),task('done','2026-11-16','done'),task('submitted','2026-11-18','submitted'),task('cancelled',null,'cancelled')]);await s.c.reload();
 assert.equal(s.c.snapshot().rows.length,1);s.c.setFilter('all');assert.equal(s.c.snapshot().rows.length,4);
 s.c.editKeyword('软件工程');assert.equal(s.c.snapshot().rows.length,4);s.c.editKeyword('submitted');assert.deepEqual(s.c.snapshot().rows.map(x=>x.task.id),['submitted']);
 s.c.setFilter('invalid');assert.equal(s.c.snapshot().filter,'all');assert.equal(s.port.reads,1);assert.equal(s.port.gets,0);
});
test('read failure retains explicitly stale rows and prevents acting on stale selection until refreshed',async()=>{
 const s=setup([task('a',null)]);await s.c.reload();s.port.fail=true;await s.c.reload();assert.equal(s.c.snapshot().stale,true);assert.equal(s.c.snapshot().rows.length,1);
 await s.c.select('a');assert.equal(s.port.gets,0);s.port.fail=false;await s.c.reload();assert.equal(s.c.snapshot().stale,false);await s.c.select('a');assert.equal(s.port.gets,1);
});
test('details come from fresh repository data including original notices and materials; failure clears old details',async()=>{
 const s=setup([task('a','2026-11-17')]);await s.c.reload();await s.c.select('a');const view=s.c.snapshot();
 assert.equal(view.detail.revision,8);assert.equal(view.detail.notices[0].rawText,'合成原通知');assert.equal(view.detail.checklistItems[0].label,'PDF');assert.match(view.detailDeadline,/2026-11-17/);
 s.c.closeDetail();s.port.fail=true;await s.c.select('a');assert.equal(s.c.snapshot().detail,null);assert.equal(s.c.snapshot().error,'合成读失败');
});
test('out-of-order reload cannot replace newer rows; disposal suppresses late publications',async()=>{
 const pending=[];const port={list:()=>new Promise(resolve=>pending.push(resolve)),get:()=>{throw Error('unused');}};const c=new TaskBoardController(port,()=> '2026-11-17T04:00:00Z');let emissions=0;c.subscribe(()=>emissions++);
 const first=c.reload(),second=c.reload();pending[1](ok({tasks:[task('new',null)],revision:2}));await second;pending[0](ok({tasks:[task('old',null)],revision:1}));await first;assert.equal(c.snapshot().rows[0].task.id,'new');
 const third=c.reload();c.dispose();const before=emissions;pending[2](ok({tasks:[],revision:3}));await third;assert.equal(emissions,before);
});
test('closing a pending detail prevents late detail reopening and preserves the task list',async()=>{
 const s=setup([task('a',null)]);await s.c.reload();let finish;s.port.get=()=>new Promise(resolve=>{finish=resolve;});const pending=s.c.select('a');s.c.closeDetail();finish(ok({task:task('a',null),notices:[],checklistItems:[],revision:8}));await pending;
 assert.equal(s.c.snapshot().detail,null);assert.equal(s.c.snapshot().loading,false);assert.equal(s.c.snapshot().rows.length,1);
});
test('UTC offset crosses local midnight correctly and invalid clock is explicit',async()=>{
 const t=task('x',null);Object.assign(t,{deadlinePrecision:'exact',dueAt:'2026-11-16T18:00:00Z'});const s=setup([t],'2026-11-16T17:00:00Z');await s.c.reload();assert.match(s.c.snapshot().rows[0].deadlineText,/2026-11-17 02:00/);assert.equal(s.c.snapshot().rows[0].section,'今天到期');
 const invalid=setup([t],'bad-clock');await invalid.c.reload();assert.match(invalid.c.snapshot().error,/时间无效/);
});
