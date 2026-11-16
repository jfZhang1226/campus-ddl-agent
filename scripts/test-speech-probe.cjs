// Deterministic host tests. Native modules below are explicitly simulated; no phone/mic/model calls.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const tsPath = process.env.TYPESCRIPT_PATH || (process.env.DEVECO_CLI_STUDIO_PATH &&
  path.join(process.env.DEVECO_CLI_STUDIO_PATH, 'tools/hvigor/hvigor/node_modules/typescript'));
if (!tsPath) throw Error('Set TYPESCRIPT_PATH or activate the installed Studio toolchain.');
const ts = require(tsPath);
const dir = path.join(root, 'probes/harmony-speech');
const input = path.join(dir, 'SpeechProbeController.ts');
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, types: [] };
const errors = ts.getPreEmitDiagnostics(ts.createProgram([input], options));
if (errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors, {
  getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => '\n'
}));
console.log('PASS strict TS control-logic check; not an ArkTS/SDK build');
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText, filename);
require.extensions['.ts'] = compile; require.extensions['.ets'] = compile;
const { SpeechProbeController } = require(input);
const tests = [];
const test = (name, run) => tests.push({ name, run });
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
class FakeClock {
  next = 0; tasks = new Map();
  schedule(fn, ms) { const id=++this.next; this.tasks.set(id,{fn,ms}); return id; }
  cancel(id) { this.tasks.delete(id); }
  fire() { for(const [id,t] of [...this.tasks]) { this.tasks.delete(id); t.fn(); } }
}
class FakePort {
  allowed = true; listens=[]; plays=[]; finishes=[]; cancellations=[]; stops=0; releases=0;
  async microphone() { return this.allowed; }
  async listen(id, events) { this.listens.push({id,events}); }
  finish(id) { this.finishes.push(id); }
  cancel(id) { this.cancellations.push(id); }
  async speak(id,text,events) { this.plays.push({id,text,events}); }
  stop() { this.stops++; }
  release() { this.releases++; }
}
function setup() { const p=new FakePort(), clock=new FakeClock(); return {p,clock,c:new SpeechProbeController(p,clock)}; }

test('permission denial preserves existing text and never starts microphone capture', async()=>{
  const {p,c}=setup(); p.allowed=false; c.edit('保留'); await c.record();
  assert.equal(c.snapshot().errorCode,'MICROPHONE_DENIED'); assert.equal(c.snapshot().text,'保留'); assert.equal(p.listens.length,0);
});
test('cancelling while permission is pending rejects its later success',async()=>{
  const {p,c}=setup(), gate=deferred(); p.microphone=()=>gate.promise;
  const run=c.record(); c.cancel(); gate.resolve(true); await run;
  assert.equal(p.listens.length,0); assert.equal(c.snapshot().busy,false);
});
test('double start and simultaneous speech are rejected while busy',async()=>{
  const {p,c}=setup(); await c.record(); await c.record(); await c.speak('测试');
  assert.equal(p.listens.length,1); assert.equal(p.plays.length,0);
});
test('actual recognition completion exposes final text but never submits it',async()=>{
  const {p,c}=setup(); await c.record(); const x=p.listens[0]; x.events.started(x.id);
  x.events.result(x.id,'合成口述',true); assert.equal(c.snapshot().text,'');
  x.events.completed(x.id); assert.equal(c.snapshot().text,'合成口述'); assert.equal(c.snapshot().phase,'ready');
});
test('partial-only or empty results cannot pretend recognition succeeded',async()=>{
  const {p,c}=setup(); c.edit('原输入'); await c.record(); const x=p.listens[0];
  x.events.result(x.id,'中间文字',false); x.events.completed(x.id);
  assert.equal(c.snapshot().errorCode,'EMPTY_RECOGNITION'); assert.equal(c.snapshot().text,'原输入');
});
test('editing during recognition prevents late transcription overwriting input',async()=>{
  const {p,c}=setup(); await c.record(); const x=p.listens[0]; c.edit('本人修改');
  x.events.result(x.id,'识别文字',true); x.events.completed(x.id); assert.equal(c.snapshot().text,'本人修改');
});
test('finish requests native end and waits for result; timeout retains text',async()=>{
  const {p,c,clock}=setup(); c.edit('旧文'); await c.record(); const x=p.listens[0]; x.events.started(x.id);
  c.finishRecording(); assert.deepEqual(p.finishes,[x.id]); assert.equal(c.snapshot().phase,'recognizing');
  clock.fire(); assert.equal(c.snapshot().errorCode,'TIMEOUT'); assert.equal(c.snapshot().text,'旧文');
  x.events.result(x.id,'迟到',true); x.events.completed(x.id); assert.equal(c.snapshot().text,'旧文');
});
test('cancel/restart isolates old session result, error and completion',async()=>{
  const {p,c}=setup(); await c.record(); const old=p.listens[0]; c.cancel(); await c.record(); const current=p.listens[1];
  old.events.result(old.id,'旧值',true); old.events.failed(old.id,'OLD_ERROR'); old.events.completed(old.id);
  assert.equal(c.snapshot().busy,true); current.events.result(current.id,'新值',true); current.events.completed(current.id);
  assert.equal(c.snapshot().text,'新值');
});
test('startup rejection is recoverable and raw native errors are never displayed',async()=>{
  const {p,c}=setup(); p.listen=async()=>{throw Error('private content');}; await c.record();
  assert.equal(c.snapshot().errorCode,'ASR_START_FAILED'); assert.equal(JSON.stringify(c.snapshot()).includes('private'),false);
});
test('empty and oversized playback never reach native speech',async()=>{
  const {p,c}=setup(); await c.speak(' '); await c.speak('a'.repeat(501)); assert.equal(p.plays.length,0);
});
test('stopping calls the real port, preserves text and ignores late playback',async()=>{
  const {p,c}=setup(); c.edit('保留'); await c.speak('测试'); const x=p.plays[0];
  assert.match(x.id,/^[a-zA-Z0-9]+$/,'TTS SDK requestId must not contain separators');
  x.events.started(x.id); c.cancel();
  assert.equal(p.stops,1); x.events.completed(x.id); assert.equal(c.snapshot().text,'保留'); assert.equal(c.snapshot().busy,false);
});
test('native stop failure still invalidates results and reports a failure',async()=>{
  const {p,c}=setup(); await c.record(); const x=p.listens[0]; p.cancel=()=>{throw Error('failure');}; c.cancel();
  assert.equal(p.stops,1); assert.equal(c.snapshot().errorCode,'STOP_FAILED'); x.events.completed(x.id); assert.equal(c.snapshot().phase,'error');
});

test('cancel discards unconfirmed microphone results and preserves the edited input',async()=>{
  const {p,c}=setup(); await c.record(); const capture=p.listens[0];
  capture.events.result(capture.id,'临时环境文字',false); c.edit('用户核对后的文字');
  c.cancel(); assert.equal(c.snapshot().partial,''); assert.equal(c.snapshot().text,'用户核对后的文字');
  capture.events.result(capture.id,'迟到的临时文字',true); capture.events.completed(capture.id);
  assert.equal(c.snapshot().partial,''); assert.equal(c.snapshot().text,'用户核对后的文字');
  assert.equal(c.snapshot().busy,false);
});
test('dispose releases resources and prevents future microphone requests',async()=>{
  const {p,c,clock}=setup(); await c.record(); c.dispose(); await c.record();
  assert.equal(p.releases,1); assert.equal(p.listens.length,1); assert.equal(clock.tasks.size,0);
});

let asrFactory,ttsFactory;
const deviceState={osFullName:'OpenHarmony 7.0.0.105'};
const original=Module._load;
Module._load=function(name,...args){
  if(name==='@ohos.deviceInfo') return {default:deviceState};
  if(name==='@kit.AbilityKit') return {abilityAccessCtrl:{createAtManager:()=>({requestPermissionsFromUser:async()=>({authResults:[0]})})}};
  if(name==='@kit.CoreSpeechKit') return {speechRecognizer:{createEngine:p=>asrFactory(p)},textToSpeech:{createEngine:p=>ttsFactory(p)}};
  return original.call(this,name,...args);
};
const {HarmonySpeechPort}=require(path.join(dir,'HarmonySpeechPort.ets')); Module._load=original;
function engine(){return {shutdowns:0,stops:0,cancels:[],setListener(x){this.listener=x;},startListening(x){this.start=x;},
  finish(){},cancel(id){this.cancels.push(id);},shutdown(){this.shutdowns++;},stop(){this.stops++;},speak(text,p){this.text=text;this.params=p;}};}
const recognition=()=>({started(){},result(){},completed(){},failed(){}});
const playback=()=>({started(){},completed(){},stopped(){},failed(){}});

test('Harmony-only native port refuses other OS families before starting a voice operation',()=>{
  for(const osName of ['Android 16','iOS 17','']) {
    deviceState.osFullName=osName;
    assert.throws(()=>new HarmonySpeechPort({}),/HARMONY_ONLY/);
  }
  deviceState.osFullName='OpenHarmony 7.0.0.105';
  assert.doesNotThrow(()=>new HarmonySpeechPort({}));
});
test('native-boundary ASR uses explicit offline microphone mode and PCM 16k/16bit/mono',async()=>{
  const e=engine();let init; asrFactory=async p=>{init=p;return e;}; const port=new HarmonySpeechPort({}); await port.listen('a',recognition());
  assert.equal(init.online,1); assert.equal(e.start.extraParams.recognitionMode,0); assert.equal(e.start.extraParams.maxAudioDuration,30000);
  assert.deepEqual(e.start.audioInfo,{audioType:'pcm',sampleRate:16000,soundChannel:1,sampleBit:16}); port.cancel('a');
  assert.deepEqual(e.cancels,['a']); assert.equal(e.shutdowns,1);
});
test('cancel during ASR engine creation shuts it down without starting capture',async()=>{
  const gate=deferred(),e=engine();asrFactory=()=>gate.promise;const p=new HarmonySpeechPort({});const pending=p.listen('a',recognition());
  p.cancel('a');gate.resolve(e);await pending;assert.equal(e.start,undefined);assert.equal(e.shutdowns,1);
});
test('TTS synthesis completion is not playback completion',async()=>{
  const e=engine();ttsFactory=async()=>e;const p=new HarmonySpeechPort({});let completed=0;const events=playback();events.completed=()=>completed++;
  await p.speak('b','测试',events); e.listener.onComplete('b',{type:0});assert.equal(completed,0);assert.equal(e.shutdowns,0);
  e.listener.onComplete('b',{type:1});assert.equal(completed,1);assert.equal(e.shutdowns,1);assert.equal(e.params.extraParams.playType,1);
});
test('stop during TTS engine creation prevents later playback',async()=>{
  const gate=deferred(),e=engine();ttsFactory=()=>gate.promise;const p=new HarmonySpeechPort({});const pending=p.speak('b','测试',playback());
  p.stop();gate.resolve(e);await pending;assert.equal(e.text,undefined);assert.equal(e.shutdowns,1);
});
test('native engine initialization failures retain numeric diagnostics without raw messages',async()=>{
  asrFactory=async()=>{throw {code:1002200001,message:'private details'};};
  const p=new HarmonySpeechPort({});let code='';const events=recognition();events.failed=(id,value)=>code=value;
  await p.listen('c',events);assert.equal(code,'ASR_CREATE_1002200001');
});
test('probe export uses a distinct bundle and microphone-only permission, never overwrites an existing export',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'campus-t09-')),output=path.join(temp,'probe');
  const {prepare}=require('./prepare-speech-probe.cjs'); const result=prepare(output);
  assert.equal(result.bundleName,'com.campusddl.speechprobe');
  const module=JSON.parse(fs.readFileSync(path.join(output,'entry/src/main/module.json5'),'utf8'));
  assert.deepEqual(module.module.requestPermissions.map(x=>x.name),['ohos.permission.MICROPHONE']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'build-profile.json5'),'utf8')).app.signingConfigs,[]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'.arkui-x/arkui-x-config.json5'),'utf8')).buildOption.ignoreCrossPlatform,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'client/.arkui-x/arkui-x-config.json5'),'utf8')).buildOption,undefined);
  assert.throws(()=>prepare(output),/new output directory/);
  assert.equal(fs.readFileSync(path.join(root,'client/entry/src/main/ets/pages/Index.ets'),'utf8').includes('SpeechProbe'),false);
  // Preserve this small export for inspection instead of recursively removing a computed path.
});
(async()=>{for(const {name,run} of tests){await run(); console.log('PASS '+name);} console.log(`${tests.length} speech probe checks passed (host + simulated native boundary only).`);})()
  .catch(e=>{console.error(e);process.exitCode=1;});
