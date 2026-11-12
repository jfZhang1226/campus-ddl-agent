const {test} = require('node:test');
const assert = require('node:assert/strict');
const {NoticeVoiceController} = require('../../probes/harmony-noticechat/NoticeVoiceController.ts');
const {NoticeCommitGate} = require('../../probes/harmony-noticechat/NoticeCommitGate.ts');
const {SpeechProbeController} = require('../../probes/harmony-speech/SpeechProbeController.ts');
const {GatewayConfig, GatewayResponse} = require('../../client/entry/src/main/ets/chat/ChatModels.ts');
const {storageSuccess} = require('../../client/entry/src/main/ets/data/storage/StorageTypes.ts');
const fixtures = require('../../fixtures/extraction/notice-draft-samples.json');
const clone = x => JSON.parse(JSON.stringify(x));
const flush = () => new Promise(resolve => setImmediate(resolve));
class Clock {
  next=0; tasks=new Map();
  schedule(fn, ms) {const id=++this.next; this.tasks.set(id, {fn,ms}); return id;}
  cancel(id) {this.tasks.delete(id);}
}
class SpeechPort {
  allowed=true; asr=[]; tts=[]; microphones=0; stops=0; releases=0;
  async microphone() {this.microphones++; return this.allowed;}
  async listen(id,e) {this.asr.push({id,e}); e.started(id);}
  finish() {}
  cancel() {}
  async speak(id,text,e) {this.tts.push({id,text,e}); e.started(id);}
  stop() {this.stops++;}
  release() {this.releases++;}
}
function setup() {
  const port = new SpeechPort(); const clock = new Clock(); const calls=[];
  const store = {reads:0, writes:0, async read() {this.reads++;return storageSuccess({revision:0});},
    async save() {this.writes++; throw Error('T19 must not bypass confirmation');}};
  const gate = new NoticeCommitGate(store);
  const speech = new SpeechProbeController(port, clock);
  const c = new NoticeVoiceController({start(config,request) {
    const call={request:clone(request),cancelled:0,cancel(){this.cancelled++;}};
    call.result=new Promise((resolve,reject)=>{call.resolve=resolve;call.reject=reject;});
    calls.push(call);return call;
  }}, gate, speech);
  c.configure(new GatewayConfig('https://synthetic.example', 'synthetic-token', 5000));
  return {c,port,clock,calls,store,gate};
}
function recognized(s,text,index=s.port.asr.length-1) {
  const {id,e}=s.port.asr[index];e.result(id,text,true);e.completed(id);
}
async function extracted(s,draft=fixtures.samples[0].draft) {
  s.calls.at(-1).resolve(new GatewayResponse(200, JSON.stringify({type:'draft',draft:clone(draft),degraded:false})));
  await flush();
}
async function draftReady(s) {s.c.setRawText(fixtures.samples[0].draft.notice.rawText);s.c.extract();await extracted(s);}

test('raw notice alone enters T12; first request does not need prefilled task fields', () => {
  const s=setup();s.c.setRawText('合成：2026年11月20日交报告和源码。');s.c.extract();
  assert.equal(s.calls.length,1);
  assert.deepEqual(s.calls[0].request,{rawText:'合成：2026年11月20日交报告和源码。',publishedAt:null,
    sourceLabel:null,timezone:'Asia/Shanghai',draft:null,answers:[]});
  assert.equal(s.store.writes,0);s.c.dispose();
});
test('cumulative explicit answers and original draft survive repeated extraction', async () => {
  const s=setup();await draftReady(s);const original=clone(s.c.snapshot().draft);
  s.c.edit('title','我改的标题');s.c.edit('course','数据库');s.c.edit('kind','report');
  s.c.edit('channel','课程平台');s.c.setSourceLabel('合成课程群');s.c.setPublishedAt('2026-11-12T09:00:00+08:00');
  s.c.extract();
  assert.deepEqual(s.calls[1].request.draft,original);
  assert.deepEqual(s.calls[1].request.answers.map(x=>x.field),['title','course','kind','submissionChannel','sourceLabel','publishedAt']);
  const contradictory=clone(fixtures.samples[0].draft);contradictory.task.title='模型又换了标题';
  await extracted(s,contradictory);
  assert.equal(s.c.snapshot().title,'我改的标题');
  s.c.edit('channel','新平台');s.c.extract();
  assert.equal(s.calls[2].request.answers.find(x=>x.field==='title').value,'我改的标题');
  assert.equal(s.calls[2].request.answers.find(x=>x.field==='submissionChannel').value,'新平台');
  assert.equal(s.calls[2].request.rawText,original.notice.rawText);s.c.dispose();
});
test('explicit clears are sent as null/empty, not silently replaced by model guesses', async () => {
  const s=setup();await draftReady(s);
  s.c.edit('title','');s.c.edit('course','');s.c.edit('kind','');s.c.edit('precision','unknown');
  s.c.setSourceLabel('');s.c.setPublishedAt('');s.c.extract();
  const answers=s.calls.at(-1).request.answers;
  assert.equal(answers.find(x=>x.field==='title').value,'');
  for(const key of ['course','kind','deadline','sourceLabel','publishedAt'])
    assert.equal(answers.find(x=>x.field===key).value,null);
  await extracted(s);
  assert.equal(s.c.snapshot().title,'');assert.equal(s.c.snapshot().publishedAt,'');
  assert.equal(s.c.snapshot().deadlinePrecision,'unknown');
  assert.deepEqual(s.c.snapshot().missingFields,['title','deadline']);s.c.dispose();
});
test('materials including deleting every item, priority and effort remain explicit client edits', async () => {
  const s=setup();await draftReady(s);
  s.c.setMaterial(0,'用户核对的PDF');s.c.edit('priority','high');s.c.edit('remaining','120');
  s.c.extract();await extracted(s);
  assert.equal(s.c.snapshot().materials[0],'用户核对的PDF');
  assert.equal(s.c.snapshot().priority,'high');assert.equal(s.c.snapshot().remainingMinutes,'120');
  while(s.c.snapshot().materials.length)s.c.removeMaterial(0);
  s.c.extract();await extracted(s);
  assert.deepEqual(s.c.snapshot().materials,[]);s.c.dispose();
});
test('date-only user choice remains date-only without a fabricated clock', async () => {
  const s=setup();await draftReady(s);s.c.edit('precision','date_only');s.c.edit('date','2026-11-25');s.c.extract();
  assert.equal(s.calls.at(-1).request.answers.find(x=>x.field==='deadline').value,'2026-11-25');
  await extracted(s);const view=s.c.snapshot();
  assert.equal(view.deadlinePrecision,'date_only');assert.equal(view.deadlineDate,'2026-11-25');
  await s.c.speakDraft();assert.match(s.port.tts[0].text,/具体时刻未提供/);s.c.dispose();
});
test('failed extraction retains original, edits, materials and cumulative answers for a manual retry', async () => {
  const s=setup();await draftReady(s);s.c.edit('title','保留标题');s.c.setMaterial(0,'保留材料');
  s.c.extract();s.calls.at(-1).reject(Error('network private detail'));await flush();
  assert.equal(s.c.snapshot().errorCode,'NETWORK');assert.equal(s.c.snapshot().title,'保留标题');
  s.c.extract();assert.equal(s.calls.at(-1).request.answers.find(x=>x.field==='title').value,'保留标题');
  assert.equal(s.c.snapshot().materials[0],'保留材料');s.c.dispose();
});
test('cancelled extraction never resurrects its card or starts speech/saving on late success', async () => {
  const s=setup();s.c.setRawText('合成原文');s.c.extract();s.c.cancel();await extracted(s);
  assert.equal(s.c.snapshot().draft,null);assert.equal(s.c.snapshot().rawText,'合成原文');
  assert.equal(s.c.snapshot().phase,'cancelled');assert.equal(s.port.tts.length,0);assert.equal(s.store.writes,0);s.c.dispose();
});
test('a new original notice clears old answer overrides', async () => {
  const s=setup();await draftReady(s);s.c.edit('title','旧改动');s.c.setMaterial(0,'旧材料');
  s.c.setRawText('另一条合成通知');s.c.extract();
  assert.equal(s.calls.at(-1).request.draft,null);assert.deepEqual(s.calls.at(-1).request.answers,[]);
  await extracted(s);assert.equal(s.c.snapshot().title,fixtures.samples[0].draft.task.title);s.c.dispose();
});
test('ASR fills the original editor and never extracts, plays or saves automatically', async () => {
  const s=setup();await s.c.record();recognized(s,'合成通知：明天交报告。');
  assert.equal(s.c.snapshot().rawText,'合成通知：明天交报告。');
  assert.equal(s.calls.length,0);assert.equal(s.port.tts.length,0);assert.equal(s.store.writes,0);s.c.dispose();
});
test('editing back to the old text defeats late ASR, including a manual notice longer than 4000 characters', async () => {
  const s=setup();const long='合成'.repeat(3000);s.c.setRawText(long);await s.c.record();
  s.c.setRawText('修改');s.c.setRawText(long);recognized(s,'迟到转写');
  assert.equal(s.c.snapshot().rawText,long);s.c.dispose();
});
test('speech, extraction and confirmation are mutually exclusive', async () => {
  const s=setup();await s.c.record();s.c.extract();await s.c.confirm();assert.equal(s.calls.length,0);
  s.c.cancelVoice();s.c.setRawText('合成原文');s.c.extract();await s.c.record();
  assert.equal(s.port.microphones,1);await extracted(s);
  await s.c.speakDraft();s.c.extract();await s.c.confirm();assert.equal(s.calls.length,1);
  assert.equal(s.store.writes,0);s.c.dispose();
});
test('draft playback says unconfirmed, is bounded and has an immediate stop action', async () => {
  const s=setup();await draftReady(s);s.c.edit('title','合成😀'.repeat(300));await s.c.speakDraft();
  const text=s.port.tts[0].text;assert.match(text,/待确认草案，尚未保存任务/);assert.ok(text.length<=500);
  const last=text.charCodeAt(text.length-1);assert.ok(last<0xD800||last>0xDBFF);
  s.c.cancelVoice();assert.equal(s.c.speechSnapshot().busy,false);assert.ok(s.port.stops>0);s.c.dispose();
});
test('background/disposal invalidates native and model callbacks without auto-resume', async () => {
  const s=setup();await s.c.record();s.c.pause();recognized(s,'后台迟到');
  assert.equal(s.c.snapshot().rawText,'');s.c.setRawText('保留原文');s.c.extract();s.c.pause();await extracted(s);
  assert.equal(s.c.snapshot().draft,null);assert.equal(s.c.snapshot().rawText,'保留原文');
  s.c.dispose();await s.c.record();assert.equal(s.port.microphones,1);assert.equal(s.clock.tasks.size,0);
});
test('denied microphone still allows text extraction and does not leak native errors', async () => {
  const s=setup();s.port.allowed=false;await s.c.record();
  assert.equal(s.c.speechSnapshot().errorCode,'MICROPHONE_DENIED');
  s.c.setRawText('可以继续粘贴合成通知');s.c.extract();assert.equal(s.calls.length,1);s.c.dispose();
});
test('unconnected T16 material/confirmation path fails closed even if save is called programmatically', async () => {
  const s=setup();await draftReady(s);await s.c.confirm();
  assert.equal(s.c.snapshot().phase,'idle');assert.equal(s.c.snapshot().errorCode,'COMMIT_UNAVAILABLE');
  assert.ok(s.c.snapshot().materials.length>0);assert.equal(s.c.snapshot().savedTaskId,'');
  assert.equal(s.store.writes,0);assert.equal((await s.gate.revision()).data,0);s.c.dispose();
});
