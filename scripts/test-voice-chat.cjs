// Actual shared chat + speech controllers, simulated ports. No network/audio/device calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(process.env.TYPESCRIPT_PATH || path.join(process.env.DEVECO_CLI_STUDIO_PATH,
  'tools/hvigor/hvigor/node_modules/typescript'));
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], types: [], skipLibCheck: true };
const core = path.join(root, 'client/entry/src/main/ets');
const sources = [path.join(core, 'speech/VoiceChatController.ts'), path.join(root, 'probes/harmony-speech/SpeechProbeController.ts')];
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(sources, options));
if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,
  { getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'),
  { compilerOptions: options }).outputText, f);
const { ChatController } = require(path.join(core, 'chat/ChatController.ts'));
const { GatewayConfig, GatewayResponse } = require(path.join(core, 'chat/ChatModels.ts'));
const { VoiceChatController } = require(path.join(core, 'speech/VoiceChatController.ts'));
const { SpeechProbeController } = require(path.join(root, 'probes/harmony-speech/SpeechProbeController.ts'));
const flush = async () => { for (let i=0; i<5; i++) await Promise.resolve(); };
class Clock {
  tasks = new Map(); next = 0;
  schedule(fn, ms) { const id=++this.next; this.tasks.set(id,{fn,ms}); return id; }
  cancel(id) { this.tasks.delete(id); }
}
class Port {
  allowed = true; microphones = 0; asr = []; tts = []; stops = 0; released = 0;
  async microphone() { this.microphones++; return this.allowed; }
  async listen(id,e) { this.asr.push({id,e}); e.started(id); }
  finish() {}
  cancel() {}
  async speak(id,text,e) { this.tts.push({id,text,e}); e.started(id); }
  stop() { this.stops++; }
  release() { this.released++; }
}
function setup(configured=true) {
  const calls=[]; const clock=new Clock(); const port=new Port();
  const chat=new ChatController({ start(config,message) {
    const call={config,message,cancelled:0,cancel(){this.cancelled++;}};
    call.result=new Promise((resolve,reject)=>{call.resolve=resolve;call.reject=reject;}); calls.push(call); return call;
  }},clock);
  const speech=new SpeechProbeController(port,clock); const c=new VoiceChatController(chat,speech);
  if(configured)c.configure(new GatewayConfig('https://synthetic.example','synthetic-token',5000));
  return {c,chat,speech,port,calls,clock};
}
function recognized(port,text,index=port.asr.length-1) {
  const {id,e}=port.asr[index]; e.result(id,text,true); e.completed(id);
}
async function answered(s,text='synthetic reply') {
  s.calls.at(-1).resolve(new GatewayResponse(200,JSON.stringify({type:'answer',text,requestId:'synthetic-id'}))); await flush();
}
const tests=[]; const test=(name,run)=>tests.push({name,run});
test('ASR only fills composer; final recognition never calls model',async()=>{
  const s=setup(); await s.c.record(); recognized(s.port,'synthetic transcript');
  assert.equal(s.c.snapshot().chat.draft,'synthetic transcript');assert.equal(s.calls.length,0);assert.equal(s.port.tts.length,0);
});
test('edits including editing back to original survive late recognition',async()=>{
  const s=setup(); s.c.edit('original'); await s.c.record(); s.c.edit('changed');s.c.edit('original');
  recognized(s.port,'late transcript');assert.equal(s.c.snapshot().chat.draft,'original');
});
test('explicit send makes one existing gateway call; response never autoplays',async()=>{
  const s=setup();await s.c.record();recognized(s.port,'question');s.c.send();s.c.send();await answered(s);
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].message,'question');assert.equal(s.port.tts.length,0);
  assert.equal(s.c.snapshot().chat.messages.length,2);assert.equal(s.c.snapshot().chat.draft,'');
});
test('send and configure blocked during speech; recording blocked during model request',async()=>{
  const s=setup();s.c.edit('q');await s.c.record();s.c.send();assert.equal(s.calls.length,0);
  assert.equal(s.c.configure(new GatewayConfig('https://other.example','token')),false);
  s.c.cancelVoice();s.c.send();await s.c.record();assert.equal(s.port.microphones,1);s.c.pause();
});
test('cancel invalidates ASR and keeps edits; stale completion cannot send or restore',async()=>{
  const s=setup();s.c.edit('keep');await s.c.record();s.c.cancelVoice();recognized(s.port,'late');
  assert.equal(s.c.snapshot().chat.draft,'keep');assert.equal(s.calls.length,0);
});
test('new ASR ignores completion from cancelled ASR',async()=>{
  const s=setup();await s.c.record();s.c.cancelVoice();await s.c.record();recognized(s.port,'old',0);
  assert.equal(s.c.snapshot().speech.busy,true);recognized(s.port,'new',1);assert.equal(s.c.snapshot().chat.draft,'new');
});
test('network failure keeps edited input; explicit retry uses shared chat behavior',async()=>{
  const s=setup();s.c.edit('q');s.c.send();s.calls[0].reject(Error('private upstream'));await flush();
  assert.equal(s.c.snapshot().chat.draft,'q');assert.equal(s.c.snapshot().chat.errorCode,'NETWORK');
  assert.equal(s.port.tts.length,0);s.c.send();await answered(s);assert.equal(s.c.snapshot().chat.messages.length,2);
});
test('background cancels model and ignores late answer, without speech',async()=>{
  const s=setup();s.c.edit('q');s.c.send();s.c.pause();await answered(s,'stale');
  assert.equal(s.c.snapshot().chat.messages.length,1);assert.equal(s.c.snapshot().chat.draft,'q');assert.equal(s.port.tts.length,0);
});
test('manual reply playback has explicit no-save prefix; stop keeps messages/input',async()=>{
  const s=setup();s.c.edit('q');s.c.send();await answered(s);s.c.edit('next');await s.c.speakLastReply();
  assert.match(s.port.tts[0].text,/本页没有保存任务/);s.c.cancelVoice();
  assert.equal(s.c.snapshot().chat.messages.length,2);assert.equal(s.c.snapshot().chat.draft,'next');
});
test('TTS native failure never rolls back the answer or erases draft',async()=>{
  const s=setup();s.c.edit('q');s.c.send();await answered(s);s.c.edit('next');await s.c.speakLastReply();
  const t=s.port.tts[0];t.e.failed(t.id,'TTS_FAILED');assert.equal(s.c.snapshot().chat.messages.length,2);
  assert.equal(s.c.snapshot().chat.draft,'next');
});
test('long replies remain fully visible; playback bounded without trailing high surrogate',async()=>{
  const s=setup();s.c.edit('q');s.c.send();const text='😀'.repeat(600);await answered(s,text);await s.c.speakLastReply();
  const spoken=s.port.tts[0].text;assert.ok(spoken.length<=500);assert.ok(!/[\uD800-\uDBFF]$/.test(spoken));
  assert.equal(s.c.snapshot().chat.messages[1].text,text);assert.match(s.c.snapshot().notice,/开头/);
});
test('permission refusal leaves typing/sending available',async()=>{
  const s=setup();s.port.allowed=false;s.c.edit('typed');await s.c.record();
  assert.equal(s.c.snapshot().speech.errorCode,'MICROPHONE_DENIED');s.c.send();assert.equal(s.calls.length,1);s.c.pause();
});
test('empty recognition and unconfigured sends do not request model',async()=>{
  const s=setup(false);await s.c.record();recognized(s.port,'');assert.equal(s.c.snapshot().speech.errorCode,'EMPTY_RECOGNITION');
  s.c.edit('q');s.c.send();assert.equal(s.calls.length,0);assert.equal(s.c.snapshot().chat.draft,'q');
});
test('detaching/resubscribing never replays replies; snapshots cannot mutate messages',async()=>{
  const s=setup();s.c.edit('q');s.c.send();await answered(s);s.c.subscribe(()=>{});s.c.detach();s.c.subscribe(()=>{});
  s.c.snapshot().chat.messages[1].text='mutated';assert.equal(s.c.snapshot().chat.messages[1].text,'synthetic reply');
  assert.equal(s.port.tts.length,0);
});
test('dispose cancels resources and all later UI actions are inert',async()=>{
  const s=setup();await s.c.record();s.c.dispose();recognized(s.port,'late');s.c.edit('ignored');s.c.send();
  await s.c.record();await s.c.speakLastReply();assert.equal(s.calls.length,0);assert.equal(s.port.released,1);
});
test('background stops playback and never resumes automatically',async()=>{
  const s=setup();s.c.edit('q');s.c.send();await answered(s);await s.c.speakLastReply();s.c.pause();
  const t=s.port.tts[0];t.e.completed(t.id);assert.equal(s.c.snapshot().speech.busy,false);
  s.c.subscribe(()=>{});assert.equal(s.port.tts.length,1);assert.equal(s.c.snapshot().chat.messages.length,2);
});
(async()=>{for(const {name,run} of tests){await run();console.log('PASS '+name);}
  console.log(`${tests.length} T15 integration checks passed (actual controllers, simulated ports).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
