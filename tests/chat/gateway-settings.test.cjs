const {test}=require('node:test'),assert=require('node:assert/strict');
const {GatewaySettings,UnavailableGatewaySecretStore,encodeGatewaySetting,decodeGatewaySetting}=require('../../client/entry/src/main/ets/chat/GatewaySettings.ts');
const {GatewayConfig}=require('../../client/entry/src/main/ets/chat/ChatModels.ts');
const {ChatController}=require('../../client/entry/src/main/ets/chat/ChatController.ts');
class Store {
 supported=true;raw=null;writes=0;removes=0;fail='';
 read(){if(this.fail==='read')throw Error('synthetic-secret-must-not-leak');return this.raw;}
 write(value){if(this.fail==='write')throw Error('synthetic-secret-must-not-leak');this.raw=value;this.writes++;}
 remove(){if(this.fail==='remove')throw Error('synthetic-secret-must-not-leak');this.raw=null;this.removes++;}
}
class Runtime {
 config=new GatewayConfig();busy=false;applies=0;
 canConfigure(){return !this.busy;}configuration(){return {...this.config};}
 configure(config){if(this.busy)return false;this.config={...config};this.applies++;return true;}
 clearConfiguration(){if(this.busy)return false;this.config=new GatewayConfig();return true;}
}
const config=(token='synthetic-project-token')=>new GatewayConfig('https://synthetic.example/gateway',token,45000);
test('one validated record restores address, token and timeout after a new runtime',()=>{
 const store=new Store(),first=new Runtime(),s=new GatewaySettings(store,first);
 assert.equal(s.save(config()),true);assert.equal(s.snapshot().saved,true);
 const fresh=new Runtime(),restored=new GatewaySettings(store,fresh);
 assert.equal(restored.snapshot().saved,true);assert.deepEqual(fresh.configuration(),first.configuration());
 assert.ok(!JSON.stringify(restored.snapshot()).includes('synthetic-project-token'));
});
test('replacement updates the complete pair; clear and a fresh runtime never restore the old token',()=>{
 const store=new Store(),runtime=new Runtime(),s=new GatewaySettings(store,runtime);s.save(config());
 const changed=new GatewayConfig('http://127.0.0.1:8000','synthetic-new-token',30000);assert.equal(s.save(changed),true);
 const second=new Runtime();new GatewaySettings(store,second);assert.deepEqual(second.configuration(),{...changed});
 assert.equal(s.clear(),true);assert.equal(store.raw,null);assert.equal(runtime.configuration().token,'');
 const fresh=new Runtime(),after=new GatewaySettings(store,fresh);assert.equal(after.snapshot().saved,false);assert.equal(fresh.applies,0);
});
test('save failure preserves both the previous durable record and active runtime and never leaks error details',()=>{
 const store=new Store(),runtime=new Runtime(),s=new GatewaySettings(store,runtime);s.save(config());const old=store.raw;store.fail='write';
 assert.equal(s.save(config('other')),false);assert.equal(store.raw,old);assert.equal(runtime.configuration().token,config().token);
 assert.equal(s.snapshot().saved,true);assert.ok(!JSON.stringify(s.snapshot()).includes('must-not-leak'));
});
test('delete failure preserves the saved connection and runtime until actual deletion succeeds',()=>{
 const store=new Store(),runtime=new Runtime(),s=new GatewaySettings(store,runtime);s.save(config());store.fail='remove';
 assert.equal(s.clear(),false);assert.equal(s.snapshot().saved,true);assert.equal(runtime.configuration().token,config().token);assert.ok(store.raw);
 store.fail='';assert.equal(s.clear(),true);assert.equal(runtime.configuration().token,'');
});
test('locked/unavailable read is retryable without writing or deleting the existing record',()=>{
 const store=new Store();store.raw=encodeGatewaySetting(config());store.fail='read';const runtime=new Runtime(),s=new GatewaySettings(store,runtime);
 assert.equal(s.snapshot().errorCode,'READ_FAILED');assert.equal(runtime.applies,0);assert.equal(store.removes,0);
 store.fail='';assert.equal(s.restore(),true);assert.equal(s.snapshot().errorCode,'');assert.equal(runtime.configuration().token,config().token);
});
test('busy operations block save, restore and clear before touching secure storage',()=>{
 const store=new Store(),runtime=new Runtime(),s=new GatewaySettings(store,runtime);s.save(config());runtime.busy=true;
 const before=[store.raw,store.writes,store.removes];assert.equal(s.save(config('other')),false);assert.equal(s.clear(),false);assert.equal(s.restore(),false);
 assert.deepEqual([store.raw,store.writes,store.removes],before);
});
test('unsupported shared platform explicitly remains memory-only',()=>{
 const runtime=new Runtime(),s=new GatewaySettings(new UnavailableGatewaySecretStore(),runtime);
 assert.equal(s.save(config()),true);assert.equal(s.snapshot().supported,false);assert.equal(s.snapshot().saved,false);assert.ok(s.snapshot().notice);
 assert.equal(s.clear(),true);assert.equal(runtime.configuration().token,'');
});
test('malformed, unknown-version and extra-field records never configure or erase storage',()=>{
 for(const raw of ['broken','null','[]',JSON.stringify({version:99,baseUrl:'x',token:'private',timeoutMs:45000}),JSON.stringify({...JSON.parse(encodeGatewaySetting(config())),extra:true})]){
  const store=new Store();store.raw=raw;const runtime=new Runtime(),s=new GatewaySettings(store,runtime);
  assert.equal(runtime.applies,0);assert.equal(s.snapshot().saved,false);assert.equal(s.snapshot().errorCode,'READ_FAILED');assert.equal(store.raw,raw);assert.equal(store.removes,0);
 }
});
test('invalid credentials, URL userinfo and oversized escaped records are rejected before any write',()=>{
 const store=new Store(),runtime=new Runtime(),s=new GatewaySettings(store,runtime);
 for(const bad of [new GatewayConfig('https://user:password@example.com','token',45000),config('bad token'),config('"'.repeat(1000)),config('x'.repeat(1001))])assert.equal(s.save(bad),false);
 assert.equal(store.writes,0);assert.equal(runtime.applies,0);
 const raw=encodeGatewaySetting(config());assert.equal(decodeGatewaySetting(raw).token,config().token);
});
test('actual chat runtime clearing keeps messages/input and prevents any request with old credentials',()=>{
 let calls=0;const runtime=new ChatController({start(){calls++;throw Error('must not send');}}),store=new Store(),s=new GatewaySettings(store,runtime);
 s.save(config());runtime.setDraft('合成未发送输入');assert.equal(s.clear(),true);
 assert.equal(runtime.configuration().token,'');assert.equal(runtime.snapshot().draft,'合成未发送输入');assert.equal(runtime.snapshot().configured,false);
 runtime.send();assert.equal(calls,0);assert.equal(runtime.snapshot().errorCode,'CONFIG_URL');runtime.dispose();
});
