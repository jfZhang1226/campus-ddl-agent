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
function controller(h,respond){const calls=[];const transport={start(config,body){const req=JSON.parse(body),call={req,cancelled:0,cancel(){this.cancelled++;}};call.result=new Promise((resolve,reject)=>{call.resolve=resolve;call.reject=reject;});calls.push(call);if(respond)Promise.resolve().then(()=>respond(req,calls.length,call)).then(reply=>{if(reply)call.resolve(new GatewayResponse(200,JSON.stringify(reply)));},call.reject);return call;}};const clock=new Clock();const c=new TaskAgentController(h.session,transport,h.tasks,h.store,clock);return {c,calls,clock};}
const send=async(c,text)=>{c.edit(text);await c.send();};

test('integrated B schema admits actual null and malformed executor calls touch no ports',async()=>{
 const schema=tools.AGENT_TOOL_SCHEMAS.find(s=>s.function.name==='propose_task_changes').function.parameters.properties.changes.items.properties.draft;
 for(const key of ['kind','priority']){assert.ok(schema.properties[key].enum.includes(null));assert.ok(!schema.properties[key].enum.includes('null'));}
 let touched=0;const ex=new AgentExecutor({list:async()=>{touched++;},get:async()=>{touched++;}},{read:async()=>{touched++;}},{stage:async()=>{touched++;}});
 for(const call of [null,undefined,{id:'x',action:'get_notice',params:{noticeId:''}},{id:'x',action:'get_tasks',params:{extra:true}}])assert.equal((await ex.execute(call)).errorCode,'INVALID_ARGUMENT');
 assert.equal(touched,0);
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
 assert.equal(s.calls[1].req.context.priorProposal.id,first.id);assert.equal(store.proposals.find(p=>p.id===first.id).state,'cancelled');
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
