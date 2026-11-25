const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {StorageCoordinator}=require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const {UiPreferencesRepository,UiPreferencesController,readableFont,readableLineHeight}=require('../../client/entry/src/main/ets/ui/UiPreferences.ts');
const {APP_TABS,tabDirection,TabNavigator}=require('../../client/entry/src/main/ets/ui/TabRoutePolicy.ts');

class MemoryFiles {
  constructor(){this.files=new Map();this.writes=[];this.failReplace=false;}
  async ensureDirectory(){}
  async exists(name){return this.files.has(name);}
  async readText(name){if(!this.files.has(name))throw Error('private path');return this.files.get(name);}
  async writeText(name,text){this.writes.push(name);this.files.set(name,text);}
  async replace(from,to){if(this.failReplace&&to==='display-settings.json'){this.failReplace=false;throw Error('private credentials');}this.files.set(to,this.files.get(from));this.files.delete(from);}
  async listNames(){return [...this.files.keys()];}
}
function make(files=new MemoryFiles(),published=[]){const repo=new UiPreferencesRepository(new StorageCoordinator(files));return {files,repo,published,controller:new UiPreferencesController(repo,value=>published.push(value))};}

test('all twelve tab pairs follow physical order regardless of push/pop visit history',()=>{
  for(let from=0;from<4;from++)for(let to=0;to<4;to++)assert.equal(tabDirection(APP_TABS[from],APP_TABS[to]),Math.sign(to-from));
  assert.equal(tabDirection('pages/DebugTools',APP_TABS[0]),0);
  assert.equal(tabDirection(APP_TABS[0],'pages/Unknown'),0);
});
test('tab navigation publishes direction before routing and suppresses concurrent and same-tab calls',async()=>{
  const nav=new TabNavigator(),trace=[];let release;
  const port={direction:d=>trace.push(d),open:page=>{trace.push(page);return new Promise(r=>release=r);}};
  const pending=nav.go(APP_TABS[3],APP_TABS[1],port);
  await nav.go(APP_TABS[3],APP_TABS[0],port);await nav.go(APP_TABS[1],APP_TABS[1],port);
  assert.deepEqual(trace,[-1,APP_TABS[1]]);release();await pending;
});
test('failed routing releases navigation lock and a retry computes its own direction',async()=>{
  const nav=new TabNavigator(),trace=[];
  await assert.rejects(nav.go(APP_TABS[1],APP_TABS[3],{direction:d=>trace.push(d),open:async()=>{throw Error('route');}}));
  await nav.go(APP_TABS[3],APP_TABS[0],{direction:d=>trace.push(d),open:async()=>{}});
  assert.deepEqual(trace,[1,-1]);
});
test('visible single-mode page releases a pending route promise without letting a stale completion unlock a newer route',async()=>{
  const nav=new TabNavigator(),trace=[];let finishOld,finishNew;
  const old=nav.go(APP_TABS[0],APP_TABS[1],{direction:d=>trace.push(d),open:()=>new Promise(r=>finishOld=r)});
  nav.arrived(APP_TABS[1]);
  const newer=nav.go(APP_TABS[1],APP_TABS[3],{direction:d=>trace.push(d),open:()=>new Promise(r=>finishNew=r)});
  finishOld();await old;
  await nav.go(APP_TABS[3],APP_TABS[0],{direction:d=>trace.push(d),open:async()=>{throw Error('Must stay locked until new destination arrives');}});
  assert.deepEqual(trace,[1,1]);nav.arrived(APP_TABS[3]);finishNew();await newer;
  await nav.go(APP_TABS[3],APP_TABS[0],{direction:d=>trace.push(d),open:async()=>{}});assert.deepEqual(trace,[1,1,-1]);
});
test('unrelated page lifecycle notifications do not release a pending tab navigation',async()=>{
  const nav=new TabNavigator(),trace=[];let finish;
  const request=nav.go(APP_TABS[0],APP_TABS[1],{direction:d=>trace.push(d),open:()=>new Promise(r=>finish=r)});
  nav.arrived(APP_TABS[0]);await nav.go(APP_TABS[0],APP_TABS[3],{direction:d=>trace.push(d),open:async()=>{}});
  assert.deepEqual(trace,[1]);nav.arrived(APP_TABS[1]);finish();await request;
});
test('fresh display preferences default to normal without writing a file',async()=>{
  const {controller,files,published}=make();await controller.restore();
  assert.equal(controller.enabled,false);assert.equal(controller.loaded,true);assert.deepEqual(published,[false]);assert.deepEqual(files.writes,[]);
});
test('enable, cold restore and disable persist only a display flag, never business or credential fields',async()=>{
  const first=make();await first.controller.restore();assert.equal(await first.controller.setEnabled(true),true);
  const record=JSON.parse(first.files.files.get('display-settings.json'));
  assert.deepEqual(Object.keys(record).sort(),['largeSimpleMode','revision','schemaVersion']);assert.equal(record.largeSimpleMode,true);
  const second=make(first.files);await second.controller.restore();assert.equal(second.controller.enabled,true);
  assert.equal(await second.controller.setEnabled(false),true);
  const third=make(first.files);await third.controller.restore();assert.equal(third.controller.enabled,false);
  assert.ok(first.files.writes.every(name=>name.startsWith('display-settings.')));
});
test('write failure preserves prior durable choice and active appearance, and a retry succeeds',async()=>{
  const {controller,files,published}=make();await controller.restore();await controller.setEnabled(true);
  const before=files.files.get('display-settings.json');files.failReplace=true;
  assert.equal(await controller.setEnabled(false),false);assert.equal(controller.enabled,true);
  assert.equal(files.files.get('display-settings.json'),before);assert.deepEqual(published,[false,true]);
  assert.doesNotMatch(controller.notice,/private|credentials/);assert.equal(await controller.setEnabled(false),true);
});
test('malformed, future-version or extra-field preferences remain untouched and do not change appearance',async()=>{
  for(const text of ['{','{"schemaVersion":2,"revision":1,"largeSimpleMode":true}',JSON.stringify({schemaVersion:1,revision:1,largeSimpleMode:true,token:'synthetic-secret'})]){
    const files=new MemoryFiles();files.files.set('display-settings.json',text);const {controller,published}=make(files);
    await controller.restore();assert.equal(await controller.setEnabled(true),false);
    assert.equal(files.files.get('display-settings.json'),text);assert.deepEqual(files.writes,[]);assert.deepEqual(published,[]);
    assert.doesNotMatch(controller.notice,/synthetic-secret/);
  }
});
test('stale display revision never overwrites another writer and can explicitly retry after reload',async()=>{
  const files=new MemoryFiles(),a=make(files),b=make(files);await a.controller.restore();await b.controller.restore();
  await a.controller.setEnabled(true);assert.equal(await b.controller.setEnabled(true),false);
  assert.equal(JSON.parse(files.files.get('display-settings.json')).revision,1);
  assert.equal(await b.controller.setEnabled(false),true);assert.equal(JSON.parse(files.files.get('display-settings.json')).revision,2);
});
test('rapid toggles during a pending write cannot publish an unpersisted mode',async()=>{
  const setup=make();await setup.controller.restore();let release;
  const port={read:()=>setup.repo.read(),save:(value,revision)=>new Promise(r=>release=()=>setup.repo.save(value,revision).then(r))};
  const published=[],controller=new UiPreferencesController(port,v=>published.push(v));await controller.restore();
  const pending=controller.setEnabled(true);assert.equal(await controller.setEnabled(false),false);assert.deepEqual(published,[false]);
  await release();await pending;assert.deepEqual(published,[false,true]);assert.equal(controller.enabled,true);
});
test('large mode enforces readable core text while normal typography remains unchanged',()=>{
  for(const size of [10,11,12,13,14,15,16,18,22,30]){assert.equal(readableFont(size,false),size);assert.ok(readableFont(size,true)>=18);assert.ok(readableFont(size,true)>size);}
  assert.ok(readableLineHeight(26,true)>readableFont(15,true));assert.equal(readableLineHeight(26,false),26);
});
test('actual pages wire both route directions, shared preference and unchanged business confirmations',()=>{
  const root=path.resolve(__dirname,'../../client/entry/src/main/ets');
  for(const name of ['TaskAssistant','Tasks','Schedule','GatewaySettings']){
    const s=fs.readFileSync(path.join(root,'pages',name+'.ets'),'utf8');
    assert.match(s,/@StorageLink\('largeSimpleMode'\)/);assert.match(s,/openAppTab\(/);
    assert.equal((s.match(/PageTransitionEnter\(/g)||[]).length,2);assert.equal((s.match(/PageTransitionExit\(/g)||[]).length,2);
    assert.match(s,/RouteType.Push/);assert.match(s,/RouteType.Pop/);
    assert.match(s,/displayPreferences\(uiContext.filesDir\).restore/);
    assert.match(s,new RegExp("appTabArrived\\('pages/"+name+"'\\)"));
  }
  const assistant=fs.readFileSync(path.join(root,'pages/TaskAssistant.ets'),'utf8');
  assert.equal((assistant.match(/AssistantMascot\(/g)||[]).length,1);assert.match(assistant,/edge: this.largeSimpleMode \? 96 : 104/);
  assert.match(assistant,/this.controller\?\.confirm\(\)/);assert.match(assistant,/this.view.input/);
  assert.match(assistant,/id\('task-agent-send'\)\.width\(this.largeSimpleMode \? 96 : 68\)/);
  const settings=fs.readFileSync(path.join(root,'pages/GatewaySettings.ets'),'utf8');
  assert.ok(settings.indexOf("id('gateway-apply')")<settings.indexOf("id('settings-large-simple')"),'connection controls precede the separate display option');
  assert.ok(settings.indexOf("id('gateway-clear')")<settings.indexOf("id('settings-large-simple')"),'display mode remains below connection maintenance');
  const owner=fs.readFileSync(path.join(root,'ui/UiPreferencesOwner.ets'),'utf8');assert.match(owner,/ArkFilePort\(filesDir, 'campus-ui'\)/);
  assert.doesNotMatch(owner,/getClientStorage|GatewaySecret|token|task-store/);
});
