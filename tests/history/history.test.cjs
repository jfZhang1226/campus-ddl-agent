const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StorageCoordinator } = require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const { SessionStore } = require('../../client/entry/src/main/ets/data/SessionStore.ts');
const { SessionRepository } = require('../../client/entry/src/main/ets/data/SessionRepository.ts');
const { StoredChatHistory } = require('../../client/entry/src/main/ets/chat/StoredChatHistory.ts');
const { ChatController } = require('../../client/entry/src/main/ets/chat/ChatController.ts');
const { ChatMessage, GatewayConfig, GatewayResponse } = require('../../client/entry/src/main/ets/chat/ChatModels.ts');
const legacy = require('../../fixtures/sessions/message-v1.json');
const structured = require('../../fixtures/sessions/message-v2.json');
const { writeHistoryProbe, readHistoryProbe } = require('../../client/entry/src/main/ets/data/diagnostics/HistoryProbe.ts');
const runtimeRoot = path.resolve(__dirname, '../../runtime/t11-host-tests');

class HostPort {
  constructor(root) { this.root = root; this.fail = ''; this.trace = []; this.gate = null; }
  target(name) { const p = path.resolve(this.root, name); assert.ok(p === this.root || p.startsWith(this.root + path.sep)); return p; }
  async check(op, name) {
    const key = op + ':' + name; this.trace.push(key);
    if (this.gate && this.gate.key === key) { const gate = this.gate; this.gate = null; gate.entered = true; await gate.promise; }
    if (this.fail === key) { this.fail = ''; throw new Error('private native path /not-for-ui'); }
  }
  hold(key) { let release; const gate = { key, entered: false, promise: new Promise(r => release = r), release: () => release() }; this.gate = gate; return gate; }
  async ensureDirectory(name) { await this.check('mkdir', name); await fs.mkdir(this.target(name), { recursive: true }); }
  async exists(name) { await this.check('exists', name); try { await fs.stat(this.target(name)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
  async readText(name) { await this.check('read', name); return fs.readFile(this.target(name), 'utf8'); }
  async writeText(name, value) {
    await this.check('write', name); const file = await fs.open(this.target(name), 'w');
    try { await file.writeFile(value, 'utf8'); await this.check('flush', name); await file.sync(); } finally { await file.close(); }
  }
  async replace(source, dest) { await this.check('replace', dest); await fs.rename(this.target(source), this.target(dest)); }
  async listNames(name) { await this.check('list', name); return fs.readdir(this.target(name)); }
}
class Runtime {
  constructor() { this.n = 0; this.time = '2026-11-04T10:00:00Z'; this.fixed = ''; }
  now() { return this.time; }
  nextId() { return this.fixed || 'history-' + (++this.n); }
}
class Clock {
  constructor() { this.n = 0; this.jobs = new Map(); }
  schedule(cb) { const id = ++this.n; this.jobs.set(id, cb); return id; }
  cancel(id) { this.jobs.delete(id); }
  fire() { const jobs = [...this.jobs.values()]; this.jobs.clear(); jobs.forEach(cb => cb()); }
}
class Transport {
  constructor() { this.calls = []; }
  start(config, message) {
    const call = { message, cancelled: 0 };
    call.result = new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
    call.cancel = () => call.cancelled++;
    this.calls.push(call); return call;
  }
}
const ok = r => { assert.equal(r.success, true, r.message); assert.notEqual(r.data, null); return r.data; };
const wire = (type = 'answer', text = '合成回复 😀') => new GatewayResponse(200,
  JSON.stringify(type === 'clarification' ? { type, question: text } : { type, text }));
async function until(check) {
  const end = Date.now() + 4000;
  while (!check()) { if (Date.now() > end) throw new Error('condition timeout'); await new Promise(r => setTimeout(r, 2)); }
}
async function harness(t) {
  await fs.mkdir(runtimeRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(runtimeRoot, 'case-'));
  const port = new HostPort(root), runtime = new Runtime();
  const makeRepo = () => new SessionRepository(new SessionStore(new StorageCoordinator(port)), runtime);
  const repo = makeRepo(), history = new StoredChatHistory(repo), transport = new Transport(), clock = new Clock();
  const controller = new ChatController(transport, clock, history);
  t.after(async () => { controller.dispose(); await new Promise(r => setTimeout(r, 20)); assert.ok(root.startsWith(runtimeRoot + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return { root, port, runtime, repo, makeRepo, history, transport, clock, controller };
}
async function ready(h) {
  assert.equal(await h.controller.initializeHistory(), true);
  assert.equal(h.controller.configure(new GatewayConfig('https://example.test', 'private-config-token')), true);
}
async function pending(h, text = '人工问题 中文 😀') {
  const before = h.transport.calls.length;
  h.controller.setDraft(text); h.controller.send(); await until(() => h.transport.calls.length > before); return h.transport.calls.at(-1);
}
async function complete(h, type = 'answer') {
  const call = await pending(h); call.resolve(wire(type)); await until(() => !h.controller.snapshot().busy); return h.controller.snapshot();
}
const primary = id => 'sessions/' + id + '.json';

test('fresh startup lists no fabricated conversations and performs no gateway call', async t => {
  const h = await harness(t); await ready(h);
  assert.deepEqual(ok(await h.repo.list()).sessions, []);
  assert.equal(h.controller.snapshot().sessionId, ''); assert.equal(h.transport.calls.length, 0);
  assert.deepEqual(await fs.readdir(path.join(h.root, 'sessions')), []);
});
test('history loading blocks sends and preserves input edited during the read', async t => {
  const h = await harness(t), gate = h.port.hold('list:sessions');
  const init = h.controller.initializeHistory(); await until(() => gate.entered);
  h.controller.configure(new GatewayConfig('https://example.test', 'token')); h.controller.setDraft('尚未发送'); h.controller.send();
  assert.equal(h.transport.calls.length, 0); gate.release(); assert.equal(await init, true);
  assert.equal(h.controller.snapshot().draft, '尚未发送');
});
test('user message is durable before a gateway request can start', async t => {
  const h = await harness(t); await ready(h);
  const gate = h.port.hold('replace:sessions/history-1.json'); h.controller.setDraft('中文 😀'); h.controller.send();
  await until(() => gate.entered); assert.equal(h.transport.calls.length, 0); assert.equal(h.controller.snapshot().savePending, true);
  gate.release(); await until(() => h.transport.calls.length === 1);
  const doc = ok(await h.repo.get('history-1')); assert.equal(doc.messages[0].text, '中文 😀'); assert.equal(doc.messages[0].status, 'pending');
  h.transport.calls[0].resolve(wire()); await until(() => !h.controller.snapshot().busy);
});
for (const type of ['answer', 'clarification']) test('durable transcript preserves gateway round type: ' + type, async t => {
  const h = await harness(t); await ready(h); const state = await complete(h, type);
  const doc = ok(await h.repo.get(state.sessionId));
  assert.equal(state.draft, ''); assert.equal(state.savePending, false); assert.equal(doc.revision, 2);
  assert.equal(doc.messages[0].status, 'completed'); assert.equal(doc.messages[1].type, type); assert.equal(doc.messages[1].text, '合成回复 😀');
});
test('cold owner restores byte-identical history offline without credentials or replay', async t => {
  const h = await harness(t); await ready(h); const state = await complete(h);
  const before = await h.port.readText(primary(state.sessionId));
  const transport = new Transport(), cold = new ChatController(transport, new Clock(), new StoredChatHistory(h.makeRepo()));
  assert.equal(await cold.initializeHistory(), true); assert.equal(cold.snapshot().messages.length, 2);
  assert.equal(cold.configuration().token, ''); assert.equal(cold.snapshot().configured, false); assert.equal(transport.calls.length, 0);
  assert.equal(await h.port.readText(primary(state.sessionId)), before);
  assert.ok(!before.includes('private-config-token')); assert.ok(!before.includes('https://example.test'));
});
test('successful saving retains edits made while the response was pending; unsent input stays off disk', async t => {
  const h = await harness(t); await ready(h); const call = await pending(h);
  h.controller.setDraft('未发送草稿不得落盘'); call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  assert.equal(h.controller.snapshot().draft, '未发送草稿不得落盘');
  assert.ok(!(await h.port.readText(primary(h.controller.snapshot().sessionId))).includes('未发送草稿不得落盘'));
});
test('pre-request write failure retains input; local retry never sends and later explicit send reuses row', async t => {
  const h = await harness(t); await ready(h); h.port.fail = 'write:sessions/history-1.tmp.json';
  h.controller.setDraft('保存失败前的输入'); h.controller.send(); await until(() => !h.controller.snapshot().busy);
  let state = h.controller.snapshot(); assert.equal(state.storageErrorCode, 'STORAGE_FAILED'); assert.equal(state.savePending, true);
  assert.equal(state.draft, '保存失败前的输入'); assert.equal(h.transport.calls.length, 0); assert.ok(!state.storageNotice.includes('/not-for-ui'));
  assert.equal(await h.controller.retryHistorySave(), true); assert.equal(h.transport.calls.length, 0);
  assert.equal(h.controller.snapshot().canRetry, true);
  h.controller.send(); await until(() => h.transport.calls.length === 1); h.transport.calls[0].resolve(wire()); await until(() => !h.controller.snapshot().busy);
  state = h.controller.snapshot(); assert.equal(ok(await h.repo.get(state.sessionId)).messages.length, 2);
});
test('answer replace failure retains old primary, runtime answer and input; retry saves without resending', async t => {
  const h = await harness(t); await ready(h); const call = await pending(h);
  const before = await h.port.readText(primary('history-1')); h.port.fail = 'replace:sessions/history-1.json';
  call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  const failed = h.controller.snapshot(); assert.equal(failed.savePending, true); assert.equal(failed.messages.length, 2);
  assert.equal(failed.draft, '人工问题 中文 😀'); assert.equal(await h.port.readText(primary('history-1')), before);
  h.controller.send(); assert.equal(h.transport.calls.length, 1); assert.equal(h.controller.newConversation(true), false);
  assert.equal(await h.controller.openHistory('other', true), false);
  assert.equal(await h.controller.retryHistorySave(), true); assert.equal(h.transport.calls.length, 1);
  assert.equal(h.controller.snapshot().draft, ''); assert.equal(ok(await h.repo.get('history-1')).messages.length, 2);
});
test('stop during pre-request saving prevents any gateway request and stores stopped history once', async t => {
  const h = await harness(t); await ready(h); const gate = h.port.hold('replace:sessions/history-1.json');
  h.controller.setDraft('暂停前的问题'); h.controller.send(); await until(() => gate.entered);
  h.controller.stop('BACKGROUND'); h.controller.stop('BACKGROUND'); gate.release(); await until(() => !h.controller.snapshot().busy);
  assert.equal(h.transport.calls.length, 0); const doc = ok(await h.repo.get('history-1'));
  assert.equal(doc.messages[0].status, 'stopped'); assert.equal(doc.revision, 2);
});
test('timeout stores failure and a late gateway answer cannot change history', async t => {
  const h = await harness(t); await ready(h); const call = await pending(h); h.clock.fire();
  await until(() => !h.controller.snapshot().busy); const before = await h.port.readText(primary('history-1'));
  call.resolve(wire('answer', '迟到回复')); await new Promise(r => setTimeout(r, 20));
  assert.equal(await h.port.readText(primary('history-1')), before); assert.equal(ok(await h.repo.get('history-1')).messages[0].status, 'failed');
});
test('background during completed-answer saving does not turn the finished response into cancellation', async t => {
  const h = await harness(t); await ready(h); const call = await pending(h), gate = h.port.hold('replace:sessions/history-1.json');
  call.resolve(wire()); await until(() => gate.entered); h.controller.stop('BACKGROUND'); gate.release();
  await until(() => !h.controller.snapshot().busy); assert.equal(h.controller.snapshot().errorCode, '');
  assert.equal(ok(await h.repo.get('history-1')).messages[0].status, 'completed');
});
test('first-write tmp-only failure remains an explicit recovery issue, never promoted or silently replaced', async t => {
  const h = await harness(t); await ready(h); h.port.fail = 'replace:sessions/history-1.json';
  h.controller.setDraft('第一次写入失败'); h.controller.send(); await until(() => !h.controller.snapshot().busy);
  const tmp = await h.port.readText('sessions/history-1.tmp.json');
  assert.equal(await h.controller.retryHistorySave(), false); assert.equal(h.controller.snapshot().storageErrorCode, 'RECOVERY_REQUIRED');
  assert.equal(await h.port.readText('sessions/history-1.tmp.json'), tmp); assert.equal(h.transport.calls.length, 0);
  assert.equal(await h.port.exists(primary('history-1')), false); assert.equal(h.controller.snapshot().draft, '第一次写入失败');
});
test('concurrent external writer causes a visible conflict, with no automatic rebase or overwrite', async t => {
  const h = await harness(t); await ready(h); const call = await pending(h);
  const external = ok(await h.repo.get('history-1')); external.session.title = '其他页面的修改'; ok(await h.makeRepo().save(external, 1));
  const before = await h.port.readText(primary('history-1')); call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  assert.equal(h.controller.snapshot().storageErrorCode, 'VERSION_CONFLICT'); assert.equal(await h.controller.retryHistorySave(), false);
  assert.equal(await h.port.readText(primary('history-1')), before); assert.equal(h.controller.snapshot().messages.length, 2);
});
test('pending history is displayed interrupted on cold read without a disk mutation or network replay', async t => {
  const h = await harness(t); await ready(h); await pending(h); const before = await h.port.readText(primary('history-1'));
  const transport = new Transport(), cold = new ChatController(transport, new Clock(), new StoredChatHistory(h.makeRepo()));
  assert.equal(await cold.initializeHistory(), true); assert.equal(cold.snapshot().messages[0].phase, 'interrupted');
  assert.equal(cold.snapshot().draft, '人工问题 中文 😀'); assert.equal(transport.calls.length, 0);
  assert.equal(await h.port.readText(primary('history-1')), before);
});
test('all-corrupt history blocks automatic creation; explicit read retry can recover after external repair', async t => {
  const h = await harness(t); await h.port.ensureDirectory('sessions'); await h.port.writeText('sessions/bad.json', '{broken');
  assert.equal(await h.controller.initializeHistory(), false); assert.equal(h.controller.snapshot().historyReady, false);
  assert.equal(await h.port.readText('sessions/bad.json'), '{broken');
  const fixed = h.repo.newDocument(); fixed.session.id = 'bad'; await h.port.writeText('sessions/bad.json', JSON.stringify(fixed));
  assert.equal(await h.controller.initializeHistory(), true); assert.equal(h.transport.calls.length, 0);
});
test('list retains damaged/temp-only issues while healthy sessions remain readable', async t => {
  const h = await harness(t); ok(await h.repo.save(h.repo.newDocument('健康会话'), 0));
  await h.port.writeText('sessions/bad.json', '{broken'); await h.port.writeText('sessions/missing.tmp.json', '{}');
  const list = ok(await h.repo.list()); assert.equal(list.sessions.length, 1); assert.equal(list.issues.length, 2);
  const read = ok(await h.history.read()); assert.ok(read.warning.includes('2')); assert.equal(read.title, '健康会话');
});
test('session ordering uses instant then stable ID; returned metadata is isolated', async t => {
  const h = await harness(t); const a = h.repo.newDocument('A'), b = h.repo.newDocument('B');
  ok(await h.repo.save(b, 0)); ok(await h.repo.save(a, 0)); const list = ok(await h.repo.list());
  assert.deepEqual(list.sessions.map(x => x.id), ['history-1', 'history-2']); list.sessions[0].title = 'mutation';
  assert.equal(ok(await h.repo.get(a.session.id)).session.title, 'A');
});
test('new conversation requires input resolution and keeps the previous persisted record', async t => {
  const h = await harness(t); await ready(h); const first = await complete(h); h.controller.setDraft('未发送');
  assert.equal(h.controller.newConversation(), false); assert.equal(h.controller.newConversation(true), true);
  assert.equal(h.controller.snapshot().messages.length, 0); await complete(h);
  assert.notEqual(h.controller.snapshot().sessionId, first.sessionId); assert.equal(ok(await h.repo.list()).sessions.length, 2);
});
for (const fixture of [legacy, structured]) test('read/append preserves prior structured or legacy data: v' + fixture.schemaVersion, async t => {
  const h = await harness(t); await h.port.ensureDirectory('sessions');
  const raw = JSON.stringify(fixture), id = fixture.session.id; await h.port.writeText(primary(id), raw);
  await ready(h); assert.equal(await h.port.readText(primary(id)), raw); assert.equal(h.transport.calls.length, 0);
  const prior = structuredClone(ok(await h.repo.get(id)).messages);
  const call = await pending(h);
  const intermediate = await h.port.readText(primary(id));
  assert.equal(await h.port.readText('sessions/' + id + '.backup.json'), raw);
  call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  const saved = ok(await h.repo.get(id)); assert.deepEqual(saved.messages.slice(0, prior.length), prior); assert.equal(saved.schemaVersion, 2);
  assert.equal(await h.port.readText('sessions/' + id + '.backup.json'), intermediate);
});
test('no-op history save does not bump revision or rewrite bytes', async t => {
  const h = await harness(t); await ready(h); await complete(h);
  const before = await h.port.readText(primary('history-1')), rev = h.controller.snapshot().sessionRevision;
  const result = ok(await h.history.save(h.controller.snapshot().messages)); assert.equal(result.revision, rev);
  assert.equal(await h.port.readText(primary('history-1')), before);
});
test('queued history save captures rows before caller mutation', async t => {
  const h = await harness(t); await h.history.read(); const rows = [new ChatMessage('x', 'user', '原文')];
  const pending = h.history.save(rows); rows[0].text = '突变'; ok(await pending);
  assert.equal(ok(await h.repo.get('history-1')).messages[0].text, '原文');
});
test('existing history cannot be accidentally truncated or reordered by a transcript save', async t => {
  const h = await harness(t); await ready(h); await complete(h); const before = await h.port.readText(primary('history-1'));
  assert.equal((await h.history.save([])).errorCode, 'INVALID_ARGUMENT');
  assert.equal(await h.port.readText(primary('history-1')), before);
});
test('colliding session IDs cannot overwrite a committed conversation', async t => {
  const h = await harness(t); h.runtime.fixed = 'same'; const original = ok(await h.repo.save(h.repo.newDocument('first'), 0));
  assert.equal((await h.repo.save(h.repo.newDocument('collision'), 0)).errorCode, 'VERSION_CONFLICT');
  assert.equal(ok(await h.repo.get('same')).session.title, original.session.title);
});
test('clock rollback and metadata rewrites retain the previous file', async t => {
  const h = await harness(t); let doc = ok(await h.repo.save(h.repo.newDocument('clock'), 0)); const before = await h.port.readText(primary(doc.session.id));
  h.runtime.time = '2026-11-03T10:00:00Z'; doc.session.title = 'backward'; assert.equal((await h.repo.save(doc, 1)).errorCode, 'INVALID_ARGUMENT');
  h.runtime.time = '2026-11-04T10:00:00Z'; doc = ok(await h.repo.get(doc.session.id)); doc.session.createdAt = '2026-11-03T10:00:00Z';
  assert.equal((await h.repo.save(doc, 1)).errorCode, 'INVALID_ARGUMENT'); assert.equal(await h.port.readText(primary(doc.session.id)), before);
});
test('non-JSON session candidates are rejected before I/O', async t => {
  const h = await harness(t); const doc = h.repo.newDocument(); doc.extra = { value: NaN }; const n = h.port.trace.length;
  assert.equal((await h.repo.save(doc, 0)).errorCode, 'INVALID_ARGUMENT'); assert.equal(h.port.trace.length, n);
});
for (const invalid of ['revision', 'date', 'message']) test('invalid in-memory history is INVALID_ARGUMENT, not a corrupt disk: ' + invalid, async t => {
  const h = await harness(t), doc = h.repo.newDocument();
  if (invalid === 'revision') doc.revision = -1;
  if (invalid === 'date') doc.session.createdAt = '2026-02-30T00:00:00Z';
  if (invalid === 'message') doc.messages = [{ id: 'bad', role: 'tool' }];
  const n = h.port.trace.length; assert.equal((await h.repo.save(doc, 0)).errorCode, 'INVALID_ARGUMENT'); assert.equal(h.port.trace.length, n);
});
test('disposed controller cannot be revived by a late history read rejection', async () => {
  let reject; const c = new ChatController(new Transport(), new Clock(), {
    read: () => new Promise((_, r) => reject = r), save: () => { throw new Error('unused'); }, fresh() {}
  });
  const init = c.initializeHistory(); c.dispose(); reject(new Error('private path')); assert.equal(await init, false);
  assert.equal(c.snapshot().storageNotice, ''); assert.equal(c.snapshot().messages.length, 0);
});
test('synchronous history read failure can be retried explicitly', async () => {
  let n = 0;
  const c = new ChatController(new Transport(), new Clock(), { read() { n++; throw new Error('private'); }, save() {}, fresh() {} });
  assert.equal(await c.initializeHistory(), false); assert.equal(await c.initializeHistory(), false); assert.equal(n, 2);
});

test('same isolated device probe verifies real files, explicit retry, cold read and no request replay', async t => {
  const h = await harness(t);
  const written = await writeHistoryProbe(h.port);
  assert.ok(written.checks.every(x => x.passed), JSON.stringify(written.checks));
  const names = [primary(written.completed.session.id), primary(written.interrupted.session.id), 'history-probe-report.json'];
  const bytes = await Promise.all(names.map(name => h.port.readText(name)));
  const read = await readHistoryProbe(h.port); assert.ok(read.checks.every(x => x.passed), JSON.stringify(read.checks));
  assert.deepEqual(await Promise.all(names.map(name => h.port.readText(name))), bytes);
  assert.equal(await h.port.exists('task-store.json'), false);
});

test('actual application owner reuses one context and restores storage after destroy; platform adapters are stubbed', async t => {
  const h = await harness(t), Module = require('node:module'), originalLoad = Module._load;
  let transport;
  class NativeFiles extends HostPort { constructor(filesDir) { super(h.root); } }
  class NativeGateway extends Transport { constructor() { super(); transport = this; } }
  Module._load = function(name, ...args) {
    if (name.endsWith('/adapters/storage/ArkFilePort')) return { ArkFilePort: NativeFiles };
    if (name.endsWith('/adapters/ArkGatewayTransport')) return { ArkGatewayTransport: NativeGateway };
    return originalLoad.call(this, name, ...args);
  };
  let owner;
  try { owner = require('../../client/entry/src/main/ets/chat/ChatOwner.ets').chatOwner; }
  finally { Module._load = originalLoad; }
  const c = owner.get('/application-files'); assert.equal(await c.initializeHistory(), true);
  assert.equal(owner.get(), c); assert.throws(() => owner.get('/other'), /切换/);
  c.configure(new GatewayConfig('https://example.test', 'owner-private-token')); c.setDraft('所有者持久化'); c.send();
  await until(() => transport.calls.length === 1); transport.calls[0].resolve(wire()); await until(() => !c.snapshot().busy);
  owner.destroy(); const fresh = owner.get('/application-files'); assert.equal(await fresh.initializeHistory(), true);
  assert.equal(fresh.snapshot().messages.length, 2); assert.equal(fresh.configuration().token, ''); assert.equal(transport.calls.length, 0);
  owner.destroy();
});
