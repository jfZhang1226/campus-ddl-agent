const {test}=require('node:test'),assert=require('node:assert/strict');
const base='../../client/entry/src/main/ets/';
const {TaskAgentSession}=require(base+'agent/TaskAgentSession.ts'),{TaskAgentController}=require(base+'agent/TaskAgentController.ts');
const {AgentExecutor}=require(base+'agent/AgentExecutor.ts'),tools=require(base+'agent/AgentTools.ts');
const {decodeAgentTurn,encodeAgentTurn}=require(base+'agent/AgentGatewayProtocol.ts');
const {LocalStore}=require(base+'data/LocalStore.ts'),{SessionStore}=require(base+'data/SessionStore.ts');
const {StorageCoordinator}=require(base+'data/storage/StorageCoordinator.ts'),{CommitServices}=require(base+'data/CommitServices.ts');
const {TaskRepository}=require(base+'data/TaskRepository.ts'),{TaskDraft}=require(base+'domain/TaskContracts.ts');
const {GatewayConfig,GatewayResponse}=require(base+'chat/ChatModels.ts');
const {sha256Hex}=require(base+'data/storage/Sha256.ts');
const clone=x=>structuredClone(x),tick=()=>new Promise(r=>setImmediate(r));
class Files {
 constructor(){this.files=new Map();this.writes=0;this.fail='';this.lose=false;}
 async ensureDirectory(){} async exists(n){return this.files.has(n);}
 async readText(n){if(!this.files.has(n))throw Error('missing synthetic file');return this.files.get(n);}
 async writeText(n,s){this.writes++;if(this.failNextSession&&n.startsWith('sessions/')){this.failNextSession=false;throw Error('synthetic history failure');}if(this.fail==='write:'+n){this.fail='';throw Error('synthetic write failure');}this.files.set(n,s);}
 async replace(a,b){if(this.fail==='replace:'+b){this.fail='';throw Error('synthetic replace failure');}assert.ok(this.files.has(a));this.files.set(b,this.files.get(a));this.files.delete(a);if(b==='task-store.json'&&this.lose){this.lose=false;throw Error('synthetic lost acknowledgement');}}
 async listNames(directory){const prefix=directory?directory+'/':'';return [...this.files.keys()].filter(n=>n.startsWith(prefix)&&!n.slice(prefix.length).includes('/')).map(n=>n.slice(prefix.length));}
}
class Runtime {n=0;now(){return '2026-11-16T16:00:00+08:00';}nextId(prefix){return `${prefix}-synthetic-${++this.n}`;}}
class Clock {n=0;tasks=new Map();schedule(fn){this.tasks.set(++this.n,fn);return this.n;}cancel(id){this.tasks.delete(id);}}
function setup(files=new Files()){
 const coordinator=new StorageCoordinator(files),store=new LocalStore(coordinator),sessions=new SessionStore(coordinator),runtime=new Runtime(),commits=new CommitServices(store,runtime),tasks=new TaskRepository(store,runtime);
 const session=new TaskAgentSession(store,commits,sessions,runtime);
 return {files,coordinator,store,sessions,runtime,commits,tasks,session};
}
const ok=r=>{assert.equal(r.success,true,r.message);return r.data;};
async function prepared(h,text='合成通知：数据库实验报告，材料为PDF和源码，截止待补充') {await h.session.open();await h.session.append('user',text);return h.session.context();}
function proposal(ctx,date='2026-12-04'){
 const draft=new TaskDraft();draft.title='合成数据库报告';draft.deadlinePrecision='date_only';draft.deadlineDate=date;draft.noticeIds=ctx.preparedSources.map(n=>n.id);
 return {sessionId:ctx.sessionId,expectedRevision:ctx.expectedRevision,notices:[],changes:[{action:'create',taskId:null,expectedVersion:null,draft,checklistCreates:[{label:'PDF报告',sourceNoticeId:draft.noticeIds[0]},{label:'人工自查',sourceNoticeId:null}]}]};
}
function controller(h,respond,speech){const calls=[];const transport={start(config,body){const req=JSON.parse(body),call={req,cancelled:0,cancel(){this.cancelled++;}};call.result=new Promise((resolve,reject)=>{call.resolve=resolve;call.reject=reject;});calls.push(call);if(respond)Promise.resolve().then(()=>respond(req,calls.length,call)).then(reply=>{if(reply)call.resolve(new GatewayResponse(200,JSON.stringify(reply)));},call.reject);return call;}};const clock=new Clock();const c=new TaskAgentController(h.session,transport,h.tasks,h.store,clock,speech);return {c,calls,clock};}
const send=async(c,text)=>{c.edit(text);await c.send();};
test('valid configuration clears stale local settings errors without model or storage writes',async()=>{
 const h=setup(),s=controller(h);await s.c.initialize();const before=h.files.writes;
 const valid=new GatewayConfig('https://synthetic.example','synthetic-token',30000);
 for(const [bad,code] of [
  [new GatewayConfig('','synthetic-token',30000),'CONFIG_URL'],
  [new GatewayConfig('https://synthetic.example','',30000),'CONFIG_TOKEN'],
  [new GatewayConfig('https://synthetic.example','synthetic-token',1),'CONFIG_TIMEOUT']]){
  assert.equal(s.c.configure(bad),false);assert.equal(s.c.snapshot().errorCode,code);
  assert.equal(s.c.configure(valid),true);assert.equal(s.c.snapshot().configured,true);
  assert.equal(s.c.snapshot().errorCode,'');assert.equal(s.c.snapshot().notice,'');
 }
 assert.equal(h.files.writes,before);assert.equal(s.calls.length,0);s.c.dispose();
});
test('applying valid settings does not erase an actual request failure or resend it',async()=>{
 const h=setup(),s=controller(h);await s.c.initialize();
 const valid=new GatewayConfig('https://synthetic.example','synthetic-token',30000);s.c.configure(valid);
 s.c.edit('查询合成任务');const pending=s.c.send();while(s.calls.length===0)await tick();
 s.calls[0].resolve(new GatewayResponse(401,'{}'));await pending;
 const before=s.c.snapshot(),writes=h.files.writes;assert.equal(before.errorCode,'UNAUTHORIZED');
 assert.equal(s.c.configure(new GatewayConfig()),false);assert.equal(s.c.snapshot().configured,false);
 assert.equal(s.c.snapshot().errorCode,before.errorCode);assert.equal(s.c.snapshot().notice,before.notice);
 assert.equal(s.c.configure(valid),true);assert.equal(s.c.snapshot().errorCode,before.errorCode);
 assert.equal(s.c.snapshot().notice,before.notice);assert.equal(s.calls.length,1);assert.equal(h.files.writes,writes);s.c.dispose();
});
function updateFor(ctx,task,date='2026-12-10') {
 const p=proposal(ctx,date),draft=p.changes[0].draft;
 for(const key of Object.keys(new TaskDraft()))draft[key]=clone(task[key]);
 draft.deadlinePrecision='date_only';draft.deadlineDate=date;draft.dueAt=null;
 draft.noticeIds=[...task.noticeIds,...ctx.preparedSources.map(n=>n.id)].filter((id,i,a)=>a.indexOf(id)===i);
 p.changes[0]={action:'update',taskId:task.id,expectedVersion:task.version,draft,checklistCreates:[]};return p;
}
async function matching(h){const result=[];for(const course of ['合成A班','合成B班']){const d=new TaskDraft();d.title='合成数据库报告';d.course=course;d.deadlinePrecision='date_only';d.deadlineDate='2026-12-04';result.push(ok(await h.tasks.create(d,ok(await h.store.read()).revision)).task);}return result;}

test('one notification can stage two different tasks and materials atomically; no early formal writes',async()=>{
 const h=setup(),s=controller(h,req=>{const p=proposal(req.context);const second=clone(p.changes[0]);second.draft.title='合成预约演示';second.draft.deadlineDate='2026-12-02';second.checklistCreates=[{label:'合成预约登记',sourceNoticeId:second.draft.noticeIds[0]}];p.changes.push(second);return {type:'tool_calls',calls:[{id:'batch',action:'propose_task_changes',params:p}]};});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成通知：报告12月4日交PDF，演示12月2日预约');
 const pending=s.c.snapshot().proposal;assert.equal(pending.changes.length,2);assert.equal(ok(await h.store.read()).tasks.length,0);assert.equal(new Set(pending.checklistItems.map(i=>i.taskId)).size,2);
 await s.c.confirm();const actual=ok(await h.store.read());assert.equal(actual.tasks.length,2);assert.equal(actual.operations.length,1);assert.equal(actual.checklistItems.length,3);assert.equal(actual.notices.length,1);s.c.dispose();
});
test('ambiguous same-name query exposes real candidates and refuses guessed update until screen choice',async()=>{
 const h=setup(),items=await matching(h);const s=controller(h,(req,n)=>n===1?{type:'tool_calls',calls:[{id:'query',action:'get_tasks',params:{keyword:'合成数据库报告'}}]}:n===2?{type:'tool_calls',calls:[{id:'wrong',action:'propose_task_changes',params:updateFor(req.context,items[0])}]}:{type:'clarification',question:'请选择具体班级的任务。'});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成：报告延期到2026年12月10日');
 assert.deepEqual(s.c.snapshot().candidates.map(t=>t.id),items.map(t=>t.id));assert.equal(s.calls[2].req.results.at(-1).success,false);assert.match(s.calls[2].req.results.at(-1).message,/多个候选/);
 assert.equal(s.c.snapshot().proposal,null);assert.equal(ok(await h.store.read()).proposals.length,0);assert.equal(ok(await h.tasks.get(items[0].id)).task.version,1);s.c.dispose();
});
test('screen candidate choice reads detail without network or writes and binds only selected ID/version',async()=>{
 const h=setup(),items=await matching(h);let selected=false;
 const s=controller(h,(req,n)=>{
  if(n===1)return {type:'tool_calls',calls:[{id:'query',action:'get_tasks',params:{keyword:'合成数据库报告'}}]};
  if(n===2)return {type:'clarification',question:'请选择实际任务。'};
  if(n===3){assert.equal(req.context.userSelectedTask.taskId,items[1].id);return {type:'tool_calls',calls:[{id:'wrong',action:'propose_task_changes',params:updateFor(req.context,items[0])}]};}
  if(!selected){assert.equal(req.results.at(-1).success,false);selected=true;return {type:'tool_calls',calls:[{id:'right',action:'propose_task_changes',params:updateFor(req.context,items[1])}]};}
 });
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成：报告延期到2026年12月10日');
 const writes=h.files.writes;await s.c.chooseTask(items[1].id);assert.equal(s.calls.length,2);assert.equal(h.files.writes,writes);assert.equal(s.c.snapshot().selectedTask.task.id,items[1].id);assert.match(s.c.snapshot().input,/合成B班/);
 await s.c.send();assert.equal(s.c.snapshot().proposal.changes[0].taskId,items[1].id);assert.equal(ok(await h.tasks.get(items[1].id)).task.deadlineDate,'2026-12-04');
 await s.c.confirm();assert.equal(ok(await h.tasks.get(items[1].id)).task.deadlineDate,'2026-12-10');assert.equal(ok(await h.tasks.get(items[0].id)).task.deadlineDate,'2026-12-04');assert.equal(s.c.snapshot().selectedTask,null);s.c.dispose();
});
test('candidate tampering, stale selected task and fresh conversation cannot silently retarget a write',async()=>{
 const h=setup(),items=await matching(h);const s=controller(h,(req,n)=>n===1?{type:'tool_calls',calls:[{id:'q',action:'get_tasks',params:{keyword:'合成数据库报告'}}]}:n===2?{type:'clarification',question:'请选择任务。'}:n===3?{type:'tool_calls',calls:[{id:'stale',action:'propose_task_changes',params:updateFor(req.context,items[0])}]}:{type:'clarification',question:'任务已变化，请刷新后重新选择。'});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成改期');await s.c.chooseTask('forged-id');assert.equal(s.c.snapshot().selectedTask,null);
 await s.c.chooseTask(items[0].id);const detail=ok(await h.tasks.get(items[0].id));const d=new TaskDraft();for(const key of Object.keys(d))d[key]=clone(detail.task[key]);d.title='合成并发新标题';ok(await h.tasks.update(items[0].id,d,detail.revision,1));
 await s.c.send();assert.equal(s.c.snapshot().proposal,null);assert.equal(ok(await h.tasks.get(items[0].id)).task.title,'合成并发新标题');assert.equal(ok(await h.store.read()).proposals.length,0);
 await s.c.fresh();assert.deepEqual(s.c.snapshot().candidates,[]);assert.equal(s.c.snapshot().selectedTask,null);s.c.dispose();
});

test('integrated B schema admits actual null and malformed executor calls touch no ports',async()=>{
 const schema=tools.AGENT_TOOL_SCHEMAS.find(s=>s.function.name==='propose_task_changes').function.parameters.properties.changes.items.properties.draft;
 for(const key of ['kind','priority']){assert.ok(schema.properties[key].enum.includes(null));assert.ok(!schema.properties[key].enum.includes('null'));}
 let touched=0;const ex=new AgentExecutor({list:async()=>{touched++;},get:async()=>{touched++;}},{read:async()=>{touched++;}},{stage:async()=>{touched++;}});
 for(const call of [null,undefined,{id:'x',action:'get_notice',params:{noticeId:''}},{id:'x',action:'get_tasks',params:{extra:true}}])assert.equal((await ex.execute(call)).errorCode,'INVALID_ARGUMENT');
 assert.equal(touched,0);
});
test('observed redundant exact date is rejected first, one structural repair may stage a valid exact proposal',async()=>{
 const h=setup(),s=controller(h,(req,n)=>{const p=proposal(req.context,'2026-12-20');p.changes[0].draft.deadlinePrecision='exact';p.changes[0].draft.dueAt='2026-12-20T18:00:00+08:00';
  if(n===1)p.changes[0].draft.deadlineDate='2026-12-20';else {assert.equal(req.context.protocolRepair.attempt,1);p.changes[0].draft.deadlineDate=null;}
  return {type:'tool_calls',calls:[{id:'shape'+n,action:'propose_task_changes',params:p}]};});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成：2026年12月20日18点交报告');
 assert.equal(s.calls.length,2);assert.equal(s.c.snapshot().proposal.changes[0].draft.deadlineDate,null);const actual=ok(await h.store.read());assert.equal(actual.proposals.length,1);assert.equal(actual.tasks.length,0);assert.deepEqual(s.c.snapshot().toolActions,['propose_task_changes']);s.c.dispose();
});
test('repeated invalid structure stops after one repair, keeps input and performs no staged or formal write',async()=>{
 const h=setup(),s=controller(h,()=>({type:'tool_calls',calls:[{id:'forged',action:'apply_confirmed_proposal',params:{}}]}));await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));
 await send(s.c,'合成非法回包恢复测试');assert.equal(s.calls.length,2);assert.equal(s.c.snapshot().errorCode,'INVALID_RESPONSE');assert.equal(s.c.snapshot().input,'合成非法回包恢复测试');assert.equal(ok(await h.store.read()).proposals.length,0);s.c.dispose();
});
test('HTTP authorization failure is not retried as model structure and cancellation invalidates late repair',async()=>{
 const h=setup(),s=controller(h);await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));s.c.edit('合成授权失败');let sending=s.c.send();await tick();s.calls[0].resolve(new GatewayResponse(401,'{}'));await sending;assert.equal(s.calls.length,1);
 s.c.edit('合成取消结构修复');sending=s.c.send();await tick();s.calls[1].resolve(new GatewayResponse(200,'{}'));await tick();assert.equal(s.calls.length,3);await s.c.stop();assert.equal(s.calls[2].cancelled,1);
 s.calls[2].resolve(new GatewayResponse(200,JSON.stringify({type:'tool_calls',calls:[{id:'late',action:'propose_task_changes',params:proposal(s.calls[2].req.context)}]})));await sending;assert.equal(ok(await h.store.read()).proposals.length,0);assert.equal(s.c.snapshot().input,'合成取消结构修复');s.c.dispose();
});
test('follow-up requirement appends only new material with its source; prior draft corrections retain addition and old prepared state',async()=>{
 const h=setup(),ctx=await prepared(h,'合成原通知：报告需要PDF'),created=await h.session.stage(proposal(ctx));ok(created);await h.session.confirm();
 const task=ok(await h.store.read()).tasks[0],oldItems=clone(ok(await h.tasks.get(task.id)).checklistItems);
 await h.session.append('user','合成补充：新增运行截图，截止保持不变');const next=await h.session.context();const p=updateFor(next,task,'2026-12-04');p.changes[0].checklistCreates=[{label:'运行截图',sourceNoticeId:next.preparedSources.at(-1).id}];
 const staged=ok(await h.session.stage(p));assert.equal(staged.recordType,'t16.proposal.v3');assert.deepEqual(ok(await h.tasks.get(task.id)).checklistItems,oldItems);
 const prior=(await h.session.context(staged)).priorProposal;assert.deepEqual(prior.changes[0].checklistCreates,p.changes[0].checklistCreates);assert.equal(tools.validateCall({id:'retry-add',action:'propose_task_changes',params:prior}),'');
 const receipt=await h.session.confirm(),actual=ok(await h.tasks.get(task.id));assert.equal(receipt.checklistItems.length,1);assert.equal(actual.checklistItems.length,3);assert.deepEqual(actual.checklistItems.slice(0,2),oldItems);assert.equal(actual.checklistItems[2].sourceNoticeId,next.preparedSources.at(-1).id);
 await h.session.append('user','合成重复要求：运行截图');const repeat=updateFor(await h.session.context(),actual.task);repeat.changes[0].checklistCreates=p.changes[0].checklistCreates;assert.equal((await h.session.stage(repeat)).errorCode,'INVALID_ARGUMENT');assert.equal(ok(await h.tasks.get(task.id)).checklistItems.length,3);
});
test('actual task controller reads application availability through executor without changing business snapshot',async()=>{
 const h=setup(),{BusinessSnapshot}=require(base+'domain/StorageModels.ts');const snapshot=new BusinessSnapshot();snapshot.availabilityBlocks=[{id:'app-availability',startAt:'2026-11-18T19:00:00+08:00',endAt:'2026-11-18T21:00:00+08:00'}];ok(await h.store.save(snapshot,0));const before=h.files.files.get('task-store.json');
 const s=controller(h,(req,n)=>{if(n===1)return {type:'tool_calls',calls:[{id:'range',action:'get_availability',params:{dateFrom:'2026-11-18',dateTo:'2026-11-18'}}]};const result=req.results[0];assert.equal(result.success,true);assert.equal(result.data.availability[0].id,'app-availability');assert.equal(result.data.revision,1);assert.deepEqual(result.data.planBlocks,[]);return {type:'answer',text:'合成查询：已保存可用时间为19点至21点，当前没有工作块。'};});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.invalid','synthetic-token',30000));await send(s.c,'查询2026年11月18日的可用时间');assert.equal(s.calls.length,2);assert.deepEqual(s.c.snapshot().toolActions,['get_availability']);assert.equal(h.files.files.get('task-store.json'),before);assert.equal(s.c.snapshot().proposal,null);s.c.dispose();
});

test('gateway decodes only bounded normalized replies and cannot expose confirm as a tool',()=>{
 assert.equal(decodeAgentTurn(new GatewayResponse(200,'<html>')).errorCode,'INVALID_RESPONSE');
 assert.equal(decodeAgentTurn(new GatewayResponse(401,'private vendor message')).errorCode,'UNAUTHORIZED');
 assert.equal(decodeAgentTurn(new GatewayResponse(200,JSON.stringify({type:'tool_calls',calls:[{id:'x',action:'apply_confirmed_proposal',params:{}}]}))).errorCode,'INVALID_RESPONSE');
 const body=JSON.parse(encodeAgentTurn('原文',{timezone:'Asia/Shanghai'},tools.AGENT_TOOL_SCHEMAS,[]));assert.equal(body.message,'原文');assert.equal(body.tools.length,5);
});
test('real stage uses durable client source metadata and only explicit confirmation saves tasks',async()=>{
 const h=setup(),raw='合成通知原文，不能由模型改写',ctx=await prepared(h,raw),p=proposal(ctx);
 assert.equal(ok(await h.store.read()).tasks.length,0);const staged=ok(await h.session.stage(p));
 let s=ok(await h.store.read());assert.equal(s.tasks.length,0);assert.equal(s.notices.length,0);assert.equal(s.proposals.length,1);
 assert.equal(staged.notices[0].rawText,raw);assert.equal(staged.notices[0].publishedAt,null);assert.equal(staged.notices[0].contentHash,sha256Hex(raw));
 assert.equal(staged.notices[0].importedAt,h.runtime.now());assert.equal(staged.checklistItems[1].sourceNoticeId,null);
 const receipt=await h.session.confirm();s=ok(await h.store.read());assert.equal(s.tasks.length,1);assert.equal(s.checklistItems.length,2);assert.equal(s.operations.length,1);
 assert.deepEqual(receipt.checklistItems,s.checklistItems);assert.equal(s.tasks[0].deadlineDate,'2026-12-04');assert.equal(s.tasks[0].dueAt,null);
});
test('spoofed session, model notice metadata, unknown source and submitted creation are rejected before stage',async()=>{
 const h=setup(),ctx=await prepared(h);for(const mutate of [p=>p.sessionId='other',p=>p.notices=[ctx.preparedSources[0]],p=>p.changes[0].draft.noticeIds=['fake'],p=>p.changes[0].draft.status='submitted']){
 const p=proposal(ctx);mutate(p);const result=await h.session.stage(p);assert.equal(result.success,false);assert.equal(result.errorCode,'INVALID_ARGUMENT');}
 const s=ok(await h.store.read());assert.equal(s.proposals.length,0);assert.equal(s.tasks.length,0);
});
test('cold workspace restores the same pending proposal without granting confirmation or replaying model',async()=>{
 const h=setup(),ctx=await prepared(h),staged=ok(await h.session.stage(proposal(ctx)));const before=h.files.files.get('task-store.json');
 const cold=setup(h.files);await cold.session.open();assert.equal(cold.session.proposal().id,staged.id);assert.equal(cold.files.files.get('task-store.json'),before);
 assert.equal(ok(await cold.store.read()).tasks.length,0);await cold.session.confirm();assert.equal(ok(await cold.store.read()).tasks.length,1);
});
test('query loop uses actual repository data, returns answer and persists real conversation',async()=>{
 const h=setup(),s=controller(h,(req,n)=>n===1?{type:'tool_calls',calls:[{id:'q1',action:'get_tasks',params:{}}]}:{type:'answer',text:'实际查询：当前没有任务。'});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'查询我的任务');
 assert.equal(s.calls.length,2);assert.equal(s.calls[1].req.message,'查询我的任务');assert.deepEqual(s.calls[1].req.results[0].data.tasks,[]);
 assert.equal(s.c.snapshot().messages[0].phase,'done');
 assert.equal(s.c.snapshot().messages.at(-1).text,'实际查询：当前没有任务。');assert.equal(ok(await h.store.read()).proposals.length,0);
 const cold=setup(h.files);await cold.session.open();assert.equal(cold.session.snapshot().messages.length,2);s.c.dispose();
});
test('raw notification then natural date reply keeps original and material provenance through actual save',async()=>{
 const h=setup(),s=controller(h,(req,n)=>n===1?{type:'clarification',question:'请补充截止日期。'}:{type:'tool_calls',calls:[{id:'p',action:'propose_task_changes',params:proposal(req.context,'2026-12-04')}]});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));const raw='合成数据库实验报告：交PDF和源码';
 await send(s.c,raw);assert.equal(s.c.snapshot().messages.at(-1).type,'clarification');await send(s.c,'截止是2026年12月4日');
 assert.equal(s.c.snapshot().proposal.changes[0].draft.deadlineDate,'2026-12-04');assert.equal(ok(await h.store.read()).tasks.length,0);
 assert.equal(s.calls[1].req.context.preparedSources[0].rawText,raw);assert.ok(s.calls[1].req.context.conversation.some(r=>r.text==='请补充截止日期。'));
 await s.c.confirm();const saved=ok(await h.store.read());assert.equal(saved.tasks.length,1);assert.equal(saved.notices.length,2);assert.equal(saved.notices[0].rawText,raw);assert.equal(saved.notices[1].rawText,'截止是2026年12月4日');
 assert.equal(saved.tasks[0].dueAt,null);assert.equal(saved.checklistItems[1].sourceNoticeId,null);assert.equal(s.c.snapshot().receipt.tasks[0].id,saved.tasks[0].id);s.c.dispose();
});

test('natural revision explicitly cancels only old pending and stages one new valid proposal with prior context',async()=>{
 const h=setup(),s=controller(h,(req,n)=>({type:'tool_calls',calls:[{id:'p'+n,action:'propose_task_changes',params:proposal(req.context,n===1?'2026-12-04':'2026-12-05')}]}));
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成通知：数据库实验报告12月4日交PDF');
 const first=s.c.snapshot().proposal;await send(s.c,'截止改为2026年12月5日，其他不变');
 const second=s.c.snapshot().proposal,store=ok(await h.store.read());assert.notEqual(first.id,second.id);
 const prior=s.calls[1].req.context.priorProposal;
 assert.equal(prior.changes[0].taskId,null);assert.equal(prior.changes[0].expectedVersion,null);
 assert.equal(tools.validateCall({id:'prior',action:'propose_task_changes',params:prior}),'');
 assert.equal(store.proposals.find(p=>p.id===first.id).state,'cancelled');
 assert.equal(store.tasks.length,0);assert.equal(store.proposals.filter(p=>p.state==='pending').length,1);
 assert.equal(second.changes[0].draft.deadlineDate,'2026-12-05');await s.c.confirm();assert.equal(ok(await h.store.read()).tasks.length,1);s.c.dispose();
});
test('stop retains retry input, never executes a late proposal and allows a new explicit send',async()=>{
 const h=setup(),s=controller(h);await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));
 s.c.edit('合成停止测试');const pending=s.c.send();await tick();assert.equal(s.calls.length,1);
 await s.c.stop();assert.equal(s.c.snapshot().input,'合成停止测试');assert.equal(s.calls[0].cancelled,1);
 s.calls[0].resolve(new GatewayResponse(200,JSON.stringify({type:'tool_calls',calls:[{id:'late',action:'propose_task_changes',params:proposal(s.calls[0].req.context)}]})));await pending;
 assert.equal(ok(await h.store.read()).proposals.length,0);assert.equal(s.c.snapshot().phase,'idle');assert.equal(s.c.snapshot().messages.at(-1).text.includes('停止'),true);s.c.dispose();
});
test('stage acknowledgement loss latches recovery and restores the original pending without duplicate stage',async()=>{
 const h=setup(),ctx=await prepared(h);h.files.lose=true;const failed=await h.session.stage(proposal(ctx));assert.equal(failed.success,false);assert.equal(h.session.locked(),true);
 const snapshot=ok(await h.store.read());assert.equal(snapshot.proposals.length,1);assert.equal(snapshot.tasks.length,0);
 await h.session.recover();assert.equal(h.session.proposal().id,snapshot.proposals[0].id);assert.equal(h.session.locked(),false);
 assert.equal((await h.session.stage(proposal({...ctx,expectedRevision:1}))).errorCode,'CONFIRMATION_REQUIRED');assert.equal(ok(await h.store.read()).proposals.length,1);
 await h.session.confirm();assert.equal(ok(await h.store.read()).tasks.length,1);
});
test('apply acknowledgement loss retries the same confirmed request and returns one actual receipt',async()=>{
 const h=setup(),ctx=await prepared(h);ok(await h.session.stage(proposal(ctx)));const apply=h.commits.confirmation.apply.bind(h.commits.confirmation);let lose=true;
 h.commits.confirmation.apply=async request=>{const result=await apply(request);if(lose&&result.success){lose=false;return {success:false,data:null,errorCode:'STORAGE_FAILED',message:'synthetic apply response loss'};}return result;};
 await assert.rejects(h.session.confirm());const snapshot=ok(await h.store.read());assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.operations.length,1);
 const receipt=await h.session.confirm();const again=ok(await h.store.read());assert.equal(again.tasks.length,1);assert.equal(again.operations.length,1);assert.equal(receipt.operationId,snapshot.operations[0].operationId);
});
test('history failure after stage keeps real pending visible and confirmation never claims history success',async()=>{
 const h=setup(),s=controller(h,req=>{h.files.failNextSession=true;return {type:'tool_calls',calls:[{id:'p',action:'propose_task_changes',params:proposal(req.context)}]};});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成：交实验报告和PDF');
 assert.equal(s.c.snapshot().historyPending,true);assert.notEqual(s.c.snapshot().proposal,null);assert.equal(ok(await h.store.read()).tasks.length,0);
 await s.c.confirm();assert.equal(ok(await h.store.read()).tasks.length,1);assert.notEqual(s.c.snapshot().receipt,null);assert.equal(s.c.snapshot().historyPending,true);
 await s.c.retryHistory();assert.equal(s.c.snapshot().historyPending,false);assert.equal(ok(await h.store.read()).tasks.length,1);s.c.dispose();
});
test('query payload is bounded and explicitly reports omitted task count instead of claiming completeness',async()=>{
 const h=setup();for(let i=0;i<35;i++){const d=new TaskDraft();d.title='合成已有任务'+i;ok(await h.tasks.create(d,i));}
 const s=controller(h,(_req,n)=>n===1?{type:'tool_calls',calls:[{id:'q',action:'get_tasks',params:{}}]}:{type:'answer',text:'合成：请缩小查询条件。'});
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'查询我的任务');
 const data=s.calls[1].req.results[0].data;assert.equal(data.tasks.length,30);assert.equal(data.total,35);assert.equal(data.truncated,true);s.c.dispose();
});
test('whole-turn timeout stops pending transport, keeps retry input and ignores late answer',async()=>{
 const h=setup(),s=controller(h);await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));
 s.c.edit('合成超时请求');const pending=s.c.send();await tick();s.clock.tasks.values().next().value();await tick();
 assert.equal(s.c.snapshot().errorCode,'TIMEOUT');assert.equal(s.c.snapshot().input,'合成超时请求');assert.equal(s.calls[0].cancelled,1);
 s.calls[0].resolve(new GatewayResponse(200,JSON.stringify({type:'answer',text:'不得覆盖超时状态'})));await pending;
 assert.ok(!s.c.snapshot().messages.some(m=>m.text==='不得覆盖超时状态'));s.c.dispose();
});
test('a business revision change blocks confirmation and explicit cancellation preserves the independent task',async()=>{
 const h=setup(),s=controller(h,req=>({type:'tool_calls',calls:[{id:'p',action:'propose_task_changes',params:proposal(req.context)}]}));
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成通知：交报告');
 const d=new TaskDraft();d.title='合成独立控制任务';ok(await h.tasks.create(d,1));await s.c.confirm();
 assert.equal(s.c.snapshot().errorCode,'VERSION_CONFLICT');assert.equal(s.c.snapshot().receipt,null);assert.equal(ok(await h.store.read()).tasks.length,1);
 await s.c.cancelProposal();const snapshot=ok(await h.store.read());assert.equal(snapshot.tasks[0].title,'合成独立控制任务');assert.equal(snapshot.proposals[0].state,'cancelled');s.c.dispose();
});
test('follow-up projects real reserved proposal into valid input without leaking reserved create IDs or dropping materials',async()=>{
 const h=setup(),ctx=await prepared(h),original=proposal(ctx);const staged=ok(await h.session.stage(original));
 assert.ok(staged.changes[0].taskId);const before=clone(staged);
 const next=await h.session.context(staged),prior=next.priorProposal;
 assert.equal(prior.changes[0].taskId,null);assert.equal(prior.changes[0].expectedVersion,null);assert.equal(prior.notices.length,0);
 assert.equal(prior.changes[0].checklistCreates.length,2);assert.equal(prior.changes[0].checklistCreates[1].sourceNoticeId,null);
 assert.equal(tools.validateCall({id:'valid-prior',action:'propose_task_changes',params:prior}),'');
 assert.deepEqual(h.session.proposal(),before);assert.equal(prior.expectedRevision,staged.expectedRevision);
 const observedWrong=clone(prior);observedWrong.changes[0].taskId=staged.changes[0].taskId;
 assert.equal(tools.validateCall({id:'observed-model-shape',action:'propose_task_changes',params:observedWrong}),'INVALID_ARGUMENT');
});
test('older required source survives bounded recent context and source removal on update is refused',async()=>{
 const h=setup(),ctx=await prepared(h,'合成最初原文：交报告'),staged=ok(await h.session.stage(proposal(ctx)));
 for(let i=0;i<14;i++){await h.session.append('user','合成补充'+i);await h.session.append('assistant','已记录合成补充');}
 const next=await h.session.context(staged);assert.ok(next.preparedSources.some(n=>n.id===ctx.preparedSources[0].id));
 await h.session.confirm();await h.session.append('user','合成：将截止改为12月6日');const current=await h.session.context();
 const task=ok(await h.store.read()).tasks[0],update=proposal(current,'2026-12-06');update.changes[0].action='update';
 update.changes[0].taskId=task.id;update.changes[0].expectedVersion=task.version;update.changes[0].checklistCreates=[];
 update.changes[0].draft.noticeIds=[current.preparedSources.at(-1).id];
 assert.equal((await h.session.stage(update)).errorCode,'INVALID_ARGUMENT');assert.equal(ok(await h.store.read()).tasks.length,1);
});
test('post-save date change looks up actual task and updates it once instead of copying old create proposal',async()=>{
 const h=setup();let round=0;
 const s=controller(h,req=>{
  round++;
  if(round===1)return {type:'tool_calls',calls:[{id:'create',action:'propose_task_changes',params:proposal(req.context)}]};
  if(round===2){assert.equal(req.context.priorProposal,null);const saved=req.context.lastCommittedTasksForLookupOnly[0];return {type:'tool_calls',calls:[{id:'detail',action:'get_task_detail',params:{taskId:saved.id}}]};}
  const detail=req.results[0].data,p=proposal(req.context,'2026-12-06'),task=detail.task;
  p.changes[0].action='update';p.changes[0].taskId=task.id;p.changes[0].expectedVersion=task.version;p.changes[0].checklistCreates=[];
  p.changes[0].draft.noticeIds=[...new Set(task.noticeIds.concat(req.context.preparedSources.map(n=>n.id)))];
  return {type:'tool_calls',calls:[{id:'update',action:'propose_task_changes',params:p}]};
 });
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成：交数据库报告');await s.c.confirm();
 const original=ok(await h.store.read()).tasks[0];await send(s.c,'刚才的报告改为2026年12月6日');assert.equal(s.c.snapshot().proposal.changes[0].action,'update');
 assert.equal(ok(await h.store.read()).tasks.length,1);await s.c.confirm();const result=ok(await h.store.read());
 assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].id,original.id);assert.equal(result.tasks[0].deadlineDate,'2026-12-06');assert.equal(result.tasks[0].version,2);
 assert.equal(result.checklistItems.length,2);assert.equal(result.operations.length,2);
 assert.equal(s.c.snapshot().receipt.checklistItems.length,0);assert.equal(s.c.snapshot().savedDetails[0].checklistItems.length,2);
 assert.equal(s.c.snapshot().savedDetails[0].notices.length,2);
 assert.ok(s.c.snapshot().savedDetails[0].notices.some(n=>n.rawText==='合成：交数据库报告'));
 assert.ok(s.c.snapshot().savedDetails[0].notices.some(n=>n.rawText==='刚才的报告改为2026年12月6日'));
 await s.c.recover();assert.equal(s.c.snapshot().savedDetails[0].checklistItems.length,2);s.c.dispose();
});

const {SpeechProbeController}=require('../../probes/harmony-speech/SpeechProbeController.ts');
class SpeechPort {
 asr=[];tts=[];microphones=0;stops=0;releases=0;finishes=0;cancels=0;
 async microphone(){this.microphones++;return true;}
 async listen(id,e){this.asr.push({id,e});e.started(id);}
 finish(){this.finishes++;}cancel(){this.cancels++;}
 async speak(id,text,e){this.tts.push({id,text,e});e.started(id);}
 stop(){this.stops++;}release(){this.releases++;}
}
function voiceSetup(respond){const h=setup(),port=new SpeechPort(),speech=new SpeechProbeController(port,new Clock()),s=controller(h,respond,speech);return {...s,h,port};}
function recognize(s,text){const {id,e}=s.port.asr.at(-1);e.result(id,text,true);e.completed(id);}
test('task voice fills only current editable message; model, staging, confirm and playback remain manual',async()=>{
 const s=voiceSetup(req=>({type:'tool_calls',calls:[{id:'p',action:'propose_task_changes',params:proposal(req.context)}]}));
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));
 await s.c.record();assert.equal(s.port.microphones,1);await s.c.send();assert.equal(s.calls.length,0);
 s.c.finishRecording();recognize(s,'合成通知：交报告和PDF');
 assert.equal(s.c.snapshot().input,'合成通知：交报告和PDF');assert.equal(s.calls.length,0);assert.equal(s.port.tts.length,0);
 assert.equal(ok(await s.h.store.read()).proposals.length,0);
 await s.c.send();assert.equal(s.calls.length,1);assert.notEqual(s.c.snapshot().proposal,null);assert.equal(ok(await s.h.store.read()).tasks.length,0);
 await s.c.speakProposal();assert.match(s.port.tts[0].text,/^本次改动尚未保存/);assert.match(s.port.tts[0].text,/具体时刻未知/);
 await s.c.confirm();assert.equal(ok(await s.h.store.read()).tasks.length,0);
 s.c.cancelVoice();await s.c.confirm();assert.equal(ok(await s.h.store.read()).tasks.length,1);s.c.dispose();
});
test('task voice manual edit-back suppresses recognition and background invalidates late callbacks',async()=>{
 const s=voiceSetup();await s.c.initialize();s.c.edit('保留文字');await s.c.record();
 s.c.edit('改过文字');s.c.edit('保留文字');recognize(s,'不应覆盖的迟到转写');assert.equal(s.c.snapshot().input,'保留文字');
 await s.c.record();const old=s.port.asr.at(-1);s.c.pause();old.e.result(old.id,'后台迟到转写',true);old.e.completed(old.id);
 assert.equal(s.c.snapshot().input,'保留文字');assert.equal(s.c.snapshot().speech.busy,false);assert.equal(s.calls.length,0);
 assert.ok(s.port.cancels>0);s.c.dispose();assert.equal(s.port.releases,1);
});
test('task voice playback is bounded, explicitly truncated, and background stops without saving',async()=>{
 const s=voiceSetup();await s.c.initialize();const ctx=await prepared(s.h);const p=proposal(ctx);p.changes[0].draft.title='😀'.repeat(65);
 p.changes[0].checklistCreates=Array.from({length:8},(_,i)=>({label:'合成材料'+i+'甲'.repeat(35),sourceNoticeId:p.changes[0].draft.noticeIds[0]}));
 ok(await s.h.session.stage(p));await s.c.recover();await s.c.speakProposal();const text=s.port.tts[0].text;
 assert.ok(text.length<=500);assert.match(text,/其余内容请看屏幕/);assert.equal(text.includes('\uFFFD'),false);
 s.c.pause();assert.equal(s.c.snapshot().speech.busy,false);assert.ok(s.port.stops>0);
 assert.equal(ok(await s.h.store.read()).tasks.length,0);assert.notEqual(s.c.snapshot().proposal,null);s.c.dispose();
});
test('native task dialogue fresh conversation keeps speech port and empty composer without automatic capture',async()=>{
 const s=voiceSetup();await s.c.initialize();s.c.edit('合成未发送文字');await s.c.fresh();
 assert.equal(s.c.snapshot().speechEnabled,true);assert.equal(s.c.snapshot().input,'');assert.equal(s.port.microphones,0);
 await s.c.record();recognize(s,'新对话合成通知');assert.equal(s.c.snapshot().input,'新对话合成通知');s.c.dispose();
});
test('silence-driven native completion preserves Arabic date text and never sends or finishes a new capture',async()=>{
 const s=voiceSetup();await s.c.initialize();await s.c.record();
 const text='合成通知：软件工程报告在2026年12月10日前提交，没有具体截止时刻';
 recognize(s,text);assert.equal(s.port.finishes,0);assert.equal(s.c.snapshot().input,text);
 assert.equal(s.c.snapshot().speech.busy,false);s.c.finishRecording();
 assert.equal(s.port.finishes,0);assert.equal(s.calls.length,0);assert.equal(s.port.tts.length,0);
 assert.equal(ok(await s.h.store.read()).tasks.length,0);s.c.dispose();
});
test('material detail read failure cannot turn a successful actual commit into failure or replay it',async()=>{
 const h=setup(),s=controller(h,req=>({type:'tool_calls',calls:[{id:'p',action:'propose_task_changes',params:proposal(req.context)}]}));
 await s.c.initialize();s.c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));await send(s.c,'合成通知：报告');
 const get=h.tasks.get.bind(h.tasks);h.tasks.get=async()=>{throw Error('synthetic read failure');};await s.c.confirm();
 assert.equal(s.c.snapshot().detailsPending,true);assert.notEqual(s.c.snapshot().receipt,null);assert.equal(s.c.snapshot().errorCode,'');
 assert.equal(ok(await h.store.read()).tasks.length,1);await s.c.confirm();assert.equal(ok(await h.store.read()).operations.length,1);
 h.tasks.get=get;await s.c.recover();assert.equal(s.c.snapshot().detailsPending,false);assert.equal(s.c.snapshot().savedDetails[0].checklistItems.length,2);s.c.dispose();
});


test('screen deadline editing atomically replaces batch proposal, preserves other task and evidence, requires fresh confirmation',async()=>{
 const h=setup(),ctx=await prepared(h),input=proposal(ctx);const second=clone(input.changes[0]);second.draft.title='合成第二报告';second.draft.deadlineDate='2026-12-05';input.changes.push(second);
 const old=ok(await h.session.stage(input));const target=old.changes[0].taskId;const authorization=ok(await h.commits.confirmation.confirm(old.id,old.expectedRevision));
 await h.session.editDeadline(target,'2026-12-04','18:30');const next=h.session.proposal();assert.notEqual(next.id,old.id);
 assert.equal(next.changes[0].draft.dueAt,'2026-12-04T18:30:00+08:00');assert.equal(next.changes[0].draft.deadlineDate,null);
 assert.equal(next.changes[1].draft.deadlineDate,'2026-12-05');assert.equal(next.checklistItems.length,old.checklistItems.length);
 assert.equal(next.notices.filter(n=>n.sourceLabel==='人工补充 · 截止时间编辑').length,1);
 assert.equal(ok(await h.store.read()).tasks.length,0);assert.equal(ok(await h.commits.proposals.get(old.id)).state,'cancelled');
 assert.equal((await h.commits.confirmation.apply(authorization)).success,false);
 const cold=setup(h.files);await cold.session.open();assert.equal(cold.session.proposal().id,next.id);assert.equal(ok(await cold.store.read()).tasks.length,0);
 const receipt=await cold.session.confirm();assert.equal(receipt.tasks.length,2);assert.equal(receipt.tasks[0].dueAt,'2026-12-04T18:30:00+08:00');
});
test('invalid, unchanged or wrong-target screen deadline edits preserve original pending bytes',async()=>{
 const h=setup(),ctx=await prepared(h);const old=ok(await h.session.stage(proposal(ctx)));const bytes=h.files.files.get('task-store.json');
 for(const args of [[old.changes[0].taskId,'2026-02-30','18:00'],[old.changes[0].taskId,'2026-12-04','25:00'],[old.changes[0].taskId,'','18:00'],[old.changes[0].taskId,'2026-12-04',''],['not-the-task','2026-12-04','18:00']]){
  await assert.rejects(()=>h.session.editDeadline(...args));assert.equal(h.files.files.get('task-store.json'),bytes);assert.equal(h.session.proposal().id,old.id);
 }
});
test('atomic screen deadline replacement handles pre-commit failure and lost acknowledgement without losing or duplicating pending',async()=>{
 const h=setup(),ctx=await prepared(h);const old=ok(await h.session.stage(proposal(ctx)));const original=h.files.replace.bind(h.files);let fail=true;
 h.files.replace=async(a,b)=>{if(b==='task-store.json'&&fail){fail=false;throw Error('synthetic precommit');}return original(a,b);};
 await assert.rejects(()=>h.session.editDeadline(old.changes[0].taskId,'2026-12-04','18:00'));await h.session.recover();assert.equal(h.session.proposal().id,old.id);
 h.files.lose=true;await assert.rejects(()=>h.session.editDeadline(old.changes[0].taskId,'2026-12-04','19:00'));
 const cold=setup(h.files);await cold.session.open();assert.notEqual(cold.session.proposal().id,old.id);assert.equal(cold.session.proposal().changes[0].draft.dueAt,'2026-12-04T19:00:00+08:00');
 assert.equal(ok(await cold.commits.proposals.list()).filter(p=>p.state==='pending').length,1);assert.equal(ok(await cold.store.read()).tasks.length,0);
});
test('manual deadline evidence remains available in a subsequent model refinement and fresh session cannot borrow it',async()=>{
 const h=setup(),ctx=await prepared(h);const old=ok(await h.session.stage(proposal(ctx)));await h.session.editDeadline(old.changes[0].taskId,'2026-12-04','18:00');
 const revised=h.session.proposal(),context=await h.session.context(revised);const manual=context.preparedSources.find(n=>n.sourceLabel==='人工补充 · 截止时间编辑');assert.ok(manual);
 await h.session.cancelPending();await h.session.append('user','合成补充：另外需要运行截图');const follow=await h.session.context(revised);
 assert.ok(follow.preparedSources.some(n=>n.id===manual.id));const next=follow.priorProposal;next.expectedRevision=ok(await h.store.read()).revision;next.notices=[];
 assert.equal((await h.session.stage(next)).success,true);await h.session.fresh();const fresh=await h.session.context();assert.ok(!fresh.preparedSources.some(n=>n.id===manual.id));
});
