const {test}=require('node:test'),assert=require('node:assert/strict');
const {deadlineReminderPlan,UnavailableReminderPort}=require('../../client/entry/src/main/ets/reminders/ReminderPlan.ts');
const {ReminderSettingsRepository}=require('../../client/entry/src/main/ets/reminders/ReminderSettings.ts');
const {ReminderService}=require('../../client/entry/src/main/ets/reminders/ReminderService.ts');
const {StorageCoordinator}=require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const {CalendarReminderPort}=require('../../client/entry/src/main/ets/reminders/CalendarReminderPort.ts');
const clone=x=>structuredClone(x),now=()=> '2026-11-17T10:00:00+08:00';
class Files {
 files=new Map();commits=0;failCommit=0;loseAck=0;
 async ensureDirectory(){}async exists(n){return this.files.has(n);}async readText(n){if(!this.files.has(n))throw Error('missing');return this.files.get(n);}
 async writeText(n,s){this.files.set(n,s);}
 async replace(a,b){if(b==='reminder-settings.json'&&++this.commits===this.failCommit)throw Error('synthetic before commit');this.files.set(b,this.files.get(a));this.files.delete(a);if(b==='reminder-settings.json'&&this.commits===this.loseAck)throw Error('synthetic lost file ack');}
 async listNames(dir){const prefix=dir?dir+'/':'';return [...this.files.keys()].filter(n=>n.startsWith(prefix)&&!n.slice(prefix.length).includes('/')).map(n=>n.slice(prefix.length));}
}
class Port {
 records=[];next=0;allowed=true;published=0;cancelled=[];losePublish=false;failCancel=false;afterPublish;
 supported(){return true;}async permission(){return this.allowed;}async requestPermission(){return this.allowed;}
 async list(){return clone(this.records);}
 async publish(plan){this.published++;const id=this.next++;this.records.push({id,key:plan.key});if(this.afterPublish)this.afterPublish();if(this.losePublish){this.losePublish=false;throw Error('synthetic lost OS acknowledgement');}return id;}
 async cancel(id){if(this.failCancel)throw Error('synthetic cancel failure');this.cancelled.push(id);this.records=this.records.filter(r=>r.id!==id);}
}
function task(){return {id:'task-synthetic',title:'合成软件工程报告',course:'软件工程',kind:'report',deadlinePrecision:'exact',deadlineDate:null,dueAt:'2026-12-10T18:00:00+08:00',timezone:'Asia/Shanghai',priority:null,status:'todo',remainingMinutes:null,submissionChannel:'课程平台',noticeIds:[],version:1,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};}
function setup(files=new Files(),port=new Port()){
 const state={task:task()};const tasks={async get(id){return state.task&&state.task.id===id?{success:true,data:{task:clone(state.task),notices:[],checklistItems:[],revision:4},message:''}:{success:false,data:null,errorCode:'NOT_FOUND',message:'合成任务已删除'};},async list(){throw Error('unused');}};
 const settings=new ReminderSettingsRepository(new StorageCoordinator(files));const service=new ReminderService(tasks,settings,port,now);
 return {state,tasks,settings,service,files,port};
}
class CalendarAccess {
 id=null;allowed=true;enabled=true;legacy=false;records=[];creates=0;inserts=0;removed=[];next=0;loseInsert=false;loseCreate=false;
 supported(){return true;}async permission(){return this.allowed;}async requestPermission(){return this.allowed;}
 async ensureLegacyClear(){if(this.legacy)throw Error('synthetic outstanding old reminder');}
 async find(){return this.id;}async create(){this.creates++;this.id=0;if(this.loseCreate){this.loseCreate=false;throw Error('synthetic calendar create acknowledgement loss');}return this.id;}
 async reminderEnabled(id){assert.equal(id,this.id);return this.enabled;}
 async events(id){assert.equal(id,this.id);return clone(this.records);}
 async insert(id,event){assert.equal(id,this.id);this.inserts++;const eventId=this.next++;this.records.push({id:eventId,key:event.key,startTime:event.startTime,endTime:event.endTime,reminderMinutes:[event.leadMinutes],allDay:false});if(this.loseInsert){this.loseInsert=false;throw Error('synthetic event insert acknowledgement loss');}return eventId;}
 async remove(id,eventId){assert.equal(id,this.id);this.removed.push(eventId);this.records=this.records.filter(e=>e.id!==eventId);}
}
function calendarSetup(){const access=new CalendarAccess(),port=new CalendarReminderPort(access,()=>Date.parse(now())),s=setup(new Files(),port);return {...s,access};}
test('calendar read/preview and denied access never create a calendar or event',async()=>{
 const s=calendarSetup();assert.deepEqual(await s.port.list(),[]);assert.equal(s.access.creates,0);s.access.allowed=false;await assert.rejects(s.port.publish(deadlineReminderPlan(s.state.task,60,now())),e=>e.code==='CALENDAR_PERMISSION_REQUIRED');assert.equal(s.access.inserts,0);assert.equal(s.access.creates,0);
});
test('calendar explicit enable uses original deadline and lead, reads exact point and accepts calendar/event ID zero',async()=>{
 const s=calendarSetup(),entry=await s.service.enable(s.state.task.id,1,60);assert.equal(entry.phase,'registered');assert.equal(s.access.creates,1);assert.equal(s.access.records[0].startTime,Date.parse(s.state.task.dueAt));assert.deepEqual(s.access.records[0].reminderMinutes,[60]);assert.equal(s.access.records[0].endTime-s.access.records[0].startTime,60000);
 const actual=(await s.port.list())[0];assert.equal(actual.id,0);assert.equal(actual.fireAt,entry.plan.fireAt);assert.equal(actual.enabled,true);await s.service.enable(s.state.task.id,1,60);assert.equal(s.access.inserts,1);
});
test('lost calendar creation or event acknowledgement recovers existing own account/key without duplication',async()=>{
 for(const kind of ['loseCreate','loseInsert']){const s=calendarSetup();s.access[kind]=true;await assert.rejects(s.service.enable(s.state.task.id,1,60));await setup(s.files,s.port).service.reconcile();assert.equal(s.access.creates,1);assert.equal(s.access.inserts,1);assert.equal(s.access.records.length,1);assert.equal((await s.settings.read()).data.entries[0].phase,'registered');}
});
test('calendar foreign events are neither returned as reminders nor deleted on task cancellation',async()=>{
 const s=calendarSetup();await s.service.enable(s.state.task.id,1,60);s.access.records.push({id:99,key:'user-created-event',startTime:0,endTime:100,reminderMinutes:[],allDay:false});await s.port.cancel(99);assert.deepEqual(s.access.removed,[]);await s.service.disable(s.state.task.id);assert.deepEqual(s.access.removed,[0]);assert.deepEqual(s.access.records.map(e=>e.id),[99]);
});
test('external calendar time edit or disabled reminder account is reported, never silently repaired',async()=>{
 for(const edit of [s=>s.access.records[0].startTime+=60000,s=>s.access.enabled=false,s=>s.access.records[0].reminderMinutes=[],s=>s.access.records[0].allDay=true]){const s=calendarSetup();await s.service.enable(s.state.task.id,1,60);edit(s);const enabled=s.access.enabled;await s.service.reconcile();assert.equal((await s.settings.read()).data.entries[0].phase,'needs_attention');assert.equal(s.access.inserts,1);await assert.rejects(s.service.enable(s.state.task.id,1,60),e=>e.code==='REMINDER_EXTERNALLY_CHANGED');assert.equal(s.access.enabled,enabled);await s.service.disable(s.state.task.id);assert.equal(s.access.records.length,0);}
});
test('system-side calendar deletion does not recreate account/event on cold reconcile',async()=>{
 const s=calendarSetup();await s.service.enable(s.state.task.id,1,60);s.access.id=null;s.access.records=[];await setup(s.files,s.port).service.reconcile();const entry=(await s.settings.read()).data.entries[0];assert.equal(entry.phase,'disabled');assert.equal(entry.enabled,false);assert.equal(s.access.creates,1);assert.equal(s.access.inserts,1);
});
test('legacy native registrations block backend switch before reading or creating calendar data',async()=>{
 const s=calendarSetup();s.access.legacy=true;await assert.rejects(s.port.list());await assert.rejects(s.service.enable(s.state.task.id,1,60));assert.equal(s.access.creates,0);assert.equal(s.access.inserts,0);assert.equal(s.access.records.length,0);
});
test('disabled existing dedicated calendar is not re-enabled and invalid/elapsed event intent makes no writes',async()=>{
 const s=calendarSetup();s.access.id=5;s.access.enabled=false;await assert.rejects(s.service.enable(s.state.task.id,1,60),e=>e.code==='CALENDAR_REMINDERS_DISABLED');assert.equal(s.access.inserts,0);assert.equal(s.access.creates,0);assert.equal(s.access.enabled,false);
 const p=deadlineReminderPlan(s.state.task,60,now());p.fireAt='2026-11-17T00:00:00Z';await assert.rejects(s.port.publish(p),e=>e.code==='INVALID_ARGUMENT');assert.equal(s.access.inserts,0);
});
test('calendar refuses events outside its discoverable range before creating an account or event',async()=>{
 const s=calendarSetup(),t=clone(s.state.task);t.dueAt='2100-01-01T00:00:00Z';
 const plan=deadlineReminderPlan(t,60,now());await assert.rejects(s.port.publish(plan),e=>e.code==='CALENDAR_TIME_OUT_OF_RANGE');
 assert.equal(s.access.creates,0);assert.equal(s.access.inserts,0);assert.deepEqual(s.access.records,[]);
});

test('exact deadline reminder is deterministic across restarts and never edits the task',()=>{
 const t=task(),before=clone(t);const a=deadlineReminderPlan(t,60,now()),b=deadlineReminderPlan(clone(t),60,now());
 assert.equal(a.key,b.key);assert.equal(a.fireAt,'2026-12-10T09:00:00.000Z');assert.equal(a.deadlineAt,t.dueAt);assert.deepEqual(t,before);
 t.version++;assert.notEqual(deadlineReminderPlan(t,60,now()).key,a.key);
});
test('unknown/date-only, terminal status, invalid lead, invalid clock and elapsed reminders fail closed',()=>{
 for(const precision of ['unknown','date_only']){const t=task();t.deadlinePrecision=precision;t.dueAt=null;t.deadlineDate=precision==='date_only'?'2026-12-10':null;assert.throws(()=>deadlineReminderPlan(t,60,now()),e=>e.code==='EXACT_DEADLINE_REQUIRED');}
 for(const status of ['submitted','done','cancelled']){const t=task();t.status=status;assert.throws(()=>deadlineReminderPlan(t,60,now()),e=>e.code==='TASK_FINISHED');}
 for(const n of [0,-1,1.5,10081,NaN])assert.throws(()=>deadlineReminderPlan(task(),n,now()));
 assert.throws(()=>deadlineReminderPlan(task(),60,'bad-clock'));
 assert.throws(()=>deadlineReminderPlan(task(),60,'2026-12-10T17:00:00+08:00'),e=>e.code==='REMINDER_TIME_PASSED');
});
test('enable durably journals intent, reads OS registration including id zero and is idempotent on re-enable',async()=>{
 const s=setup();const before=clone(s.state.task);const entry=await s.service.enable(s.state.task.id,1,60);assert.equal(entry.phase,'registered');assert.equal(s.port.records[0].id,0);
 assert.equal((await s.settings.read()).data.entries[0].phase,'registered');await s.service.enable(s.state.task.id,1,60);assert.equal(s.port.published,1);assert.equal(s.port.records.length,1);assert.deepEqual(s.state.task,before);
});
test('denied permission, unavailable platform and stale task version produce no OS or preference writes',async()=>{
 const s=setup();s.port.allowed=false;await assert.rejects(s.service.enable(s.state.task.id,1,60),e=>e.code==='NOTIFICATION_PERMISSION_REQUIRED');
 s.port.allowed=true;await assert.rejects(s.service.enable(s.state.task.id,2,60),e=>e.code==='VERSION_CONFLICT');
 const unsupported=new ReminderService(s.tasks,s.settings,new UnavailableReminderPort(),now);await assert.rejects(unsupported.enable(s.state.task.id,1,60));
 assert.equal(s.files.commits,0);assert.equal(s.port.published,0);
});
test('failed intent persistence prevents OS publication',async()=>{
 const s=setup();s.files.failCommit=1;await assert.rejects(s.service.enable(s.state.task.id,1,60));assert.equal(s.port.published,0);
});
test('lost OS acknowledgement recovers same durable key after restart without duplicate publication',async()=>{
 const s=setup();s.port.losePublish=true;await assert.rejects(s.service.enable(s.state.task.id,1,60));assert.equal(s.port.records.length,1);assert.equal((await s.settings.read()).data.entries[0].phase,'pending');
 const restarted=setup(s.files,s.port);await restarted.service.reconcile();assert.equal(s.port.published,1);assert.equal((await restarted.settings.read()).data.entries[0].phase,'registered');
});
test('OS success followed by settings failure is recovered by actual OS key without publishing again',async()=>{
 const s=setup();s.files.failCommit=2;await assert.rejects(s.service.enable(s.state.task.id,1,60));assert.equal(s.port.published,1);
 await setup(s.files,s.port).service.reconcile();assert.equal(s.port.published,1);assert.equal((await s.settings.read()).data.entries[0].phase,'registered');
});
test('task date change cancels only owned old reminders and registers updated actual task',async()=>{
 const s=setup();await s.service.enable(s.state.task.id,1,60);const oldKey=s.port.records[0].key;s.port.records.push({id:900,key:'some-other-feature'});
 s.state.task.version=2;s.state.task.dueAt='2026-12-12T18:00:00+08:00';await s.service.reconcile();
 assert.equal(s.port.records.some(r=>r.key===oldKey),false);assert.equal(s.port.records.some(r=>r.id===900),true);assert.equal(s.port.published,2);
 const setting=(await s.settings.read()).data.entries[0];assert.equal(setting.plan.taskVersion,2);assert.equal(setting.plan.deadlineAt,s.state.task.dueAt);
});
test('cancel failure keeps durable intent; later reconciliation completes cancellation without re-enabling',async()=>{
 const s=setup();await s.service.enable(s.state.task.id,1,60);s.port.failCancel=true;await assert.rejects(s.service.disable(s.state.task.id));
 assert.equal((await s.settings.read()).data.entries[0].phase,'cancel_pending');assert.equal((await s.settings.read()).data.entries[0].enabled,false);
 s.port.failCancel=false;await setup(s.files,s.port).service.reconcile();assert.equal(s.port.records.length,0);assert.equal((await s.settings.read()).data.entries[0].phase,'disabled');
});
test('submitted task, removed exact time and deleted task revoke their OS reminders',async()=>{
 for(const change of [s=>s.state.task.status='submitted',s=>{s.state.task.deadlinePrecision='date_only';s.state.task.deadlineDate='2026-12-10';s.state.task.dueAt=null;},s=>s.state.task=null]){
  const s=setup();await s.service.enable(s.state.task.id,1,60);change(s);await s.service.reconcile();assert.equal(s.port.records.length,0);
 }
});
test('task changed or deleted during OS publish revokes new reminder rather than claiming registered',async()=>{
 for(const change of [s=>{s.state.task.version=2;s.state.task.dueAt='2026-12-12T18:00:00+08:00';},s=>s.state.task=null]){
  const s=setup();s.port.afterPublish=()=>change(s);await assert.rejects(s.service.enable(s.state.task.id,1,60),e=>e.code==='VERSION_CONFLICT');assert.equal(s.port.records.length,0);
 }
});
test('OS-side user deletion is not resurrected, and unchanged registered reminder incurs no file writes',async()=>{
 const s=setup();await s.service.enable(s.state.task.id,1,60);const commits=s.files.commits;await s.service.reconcile();assert.equal(s.files.commits,commits);
 s.port.records=[];await s.service.reconcile();assert.equal(s.port.published,1);assert.equal((await s.settings.read()).data.entries[0].enabled,false);
});
test('corrupt or unsupported settings preserve original bytes and never touch OS',async()=>{
 for(const text of ['{bad json',JSON.stringify({schemaVersion:99,revision:0,entries:[]})]){
  const s=setup();s.files.files.set('reminder-settings.json',text);await assert.rejects(s.service.enable(s.state.task.id,1,60));assert.equal(s.port.published,0);assert.equal(s.files.files.get('reminder-settings.json'),text);
 }
});
test('invalid persisted key or fireAt is rejected before replacing settings',async()=>{
 const s=setup();await s.service.enable(s.state.task.id,1,60);const original=s.files.files.get('reminder-settings.json');const doc=(await s.settings.read()).data;doc.entries[0].plan.fireAt='2026-12-11T09:00:00.000Z';
 assert.equal((await s.settings.save(doc,doc.revision)).success,false);assert.equal(s.files.files.get('reminder-settings.json'),original);
});

const {TaskReminderController}=require('../../client/entry/src/main/ets/reminders/TaskReminderController.ts');
const {LocalStore}=require('../../client/entry/src/main/ets/data/LocalStore.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('screen preview never registers; explicit confirmation does, and canceling preview changes nothing',async()=>{
 const s=setup(),c=new TaskReminderController(s.service,now);c.select(s.state.task);await tick();
 c.prepare(60);assert.notEqual(c.snapshot().preview,null);assert.equal(s.port.published,0);assert.equal(s.files.commits,0);
 c.cancelPreview();assert.equal(c.snapshot().preview,null);await c.confirm();assert.equal(s.port.published,0);
 c.prepare(60);await c.confirm();assert.equal(s.port.published,1);assert.equal(c.snapshot().setting.phase,'registered');c.dispose();
});
test('task version changed after screen preview is rejected without OS side effects',async()=>{
 const s=setup(),c=new TaskReminderController(s.service,now);c.select(s.state.task);await tick();c.prepare(60);s.state.task.version++;
 await c.confirm();assert.equal(c.snapshot().errorCode,'VERSION_CONFLICT');assert.equal(c.snapshot().setting,null);assert.equal(s.port.published,0);c.dispose();
});
test('permission denial keeps task flow independent and cannot prepare a hidden reminder',async()=>{
 const s=setup();s.port.allowed=false;const c=new TaskReminderController(s.service,now);c.select(s.state.task);await tick();c.prepare(60);
 assert.equal(c.snapshot().preview,null);assert.equal(c.snapshot().errorCode,'NOTIFICATION_PERMISSION_REQUIRED');await c.requestPermission();assert.equal(c.snapshot().permission,false);
 assert.equal(s.port.published,0);s.port.allowed=true;await c.requestPermission();c.prepare(60);assert.notEqual(c.snapshot().preview,null);assert.equal(s.port.published,0);c.dispose();
});
test('failed OS reconciliation does not misreport already granted notification permission as denied',async()=>{
 const s=setup();await s.service.enable(s.state.task.id,1,60);s.port.list=async()=>{throw Error('synthetic OS query failure');};
 const c=new TaskReminderController(s.service,now);c.select(s.state.task);await tick();assert.equal(c.snapshot().permission,true);assert.equal(c.snapshot().errorCode,'REMINDER_UNCERTAIN');assert.equal(c.snapshot().setting,null);c.dispose();
});
test('leaving after explicit reminder confirmation suppresses late UI while durable authorized work completes',async()=>{
 const s=setup(),c=new TaskReminderController(s.service,now);c.select(s.state.task);await tick();c.prepare(60);let release;
 s.port.publish=plan=>new Promise(resolve=>{release=()=>{s.port.published++;s.port.records.push({id:0,key:plan.key});resolve(0);};});
 let emissions=0;c.subscribe(()=>emissions++);const confirm=c.confirm();await tick();assert.equal(typeof release,'function');c.dispose();const count=emissions;release();await confirm;
 assert.equal(emissions,count);assert.equal((await s.settings.read()).data.entries[0].phase,'registered');
});
test('post-commit observer cannot change success, fires only on successful business commit and can unsubscribe',async()=>{
 const files=new Files(),store=new LocalStore(new StorageCoordinator(files));let called=0,lastRead;
 const detach=store.subscribeChanges(()=>{called++;lastRead=store.read();});
 store.subscribeChanges(()=>{throw Error('synthetic observer failure');});store.subscribeChanges(async()=>{throw Error('synthetic async observer failure');});
 const snapshot=(await store.read()).data;let result=await store.save(snapshot,0);assert.equal(result.success,true);assert.equal(called,1);assert.equal((await lastRead).data.revision,1);
 result=await store.save(snapshot,0);assert.equal(result.success,false);assert.equal(called,1);detach();result=await store.save((await store.read()).data,1);
 assert.equal(result.success,true);assert.equal(called,1);await tick();
});
test('non-finite or executable reminder preference payload is refused before disk writes',async()=>{
 const s=setup();const doc=(await s.settings.read()).data;doc.extra=()=>{};assert.equal((await s.settings.save(doc,0)).success,false);assert.equal(s.files.commits,0);
});
