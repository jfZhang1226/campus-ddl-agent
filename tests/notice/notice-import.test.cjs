const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const Module = require('node:module');
const { sha256Hex } = require('../../client/entry/src/main/ets/data/storage/Sha256.ts');
const { NoticeDraft, cloneNoticeDraft, parseNoticeDraft } =
  require('../../client/entry/src/main/ets/notice/NoticeDraftModels.ts');
const { NoticeExtractionRequest, decodeNoticeExtraction, encodeNoticeExtraction } =
  require('../../client/entry/src/main/ets/notice/NoticeImportProtocol.ts');
const { NoticeImportController } = require('../../client/entry/src/main/ets/notice/NoticeImportController.ts');
const { NoticeImportRepository, NoticeImportInput } =
  require('../../client/entry/src/main/ets/data/NoticeImportRepository.ts');
const { LocalStore } = require('../../client/entry/src/main/ets/data/LocalStore.ts');
const { StorageCoordinator } = require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const { GatewayConfig, GatewayResponse } = require('../../client/entry/src/main/ets/chat/ChatModels.ts');
const { timestampMillis, zonedDateTimeParts, zonedTimestamp } =
  require('../../client/entry/src/main/ets/domain/DateRules.ts');
const fixtures = require('../../fixtures/extraction/notice-draft-samples.json');

const runtimeRoot = path.resolve(__dirname, '../../runtime/t13-host-tests');
class HostPort {
  constructor(root) { this.root = root; this.fail = ''; }
  target(name) {
    const target = path.resolve(this.root, name);
    assert.ok(target === this.root || target.startsWith(this.root + path.sep));
    return target;
  }
  check(op, name) {
    if (this.fail === op + ':' + name) { this.fail = ''; throw new Error('private host failure'); }
  }
  async ensureDirectory(name) { this.check('mkdir', name); await fs.mkdir(this.target(name), { recursive: true }); }
  async exists(name) {
    this.check('exists', name);
    try { await fs.stat(this.target(name)); return true; } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async readText(name) { this.check('read', name); return fs.readFile(this.target(name), 'utf8'); }
  async writeText(name, text) {
    this.check('write', name);
    const file = await fs.open(this.target(name), 'w');
    try { await file.writeFile(text, 'utf8'); this.check('flush', name); await file.sync(); }
    finally { await file.close(); }
  }
  async replace(source, destination) {
    this.check('replace', destination);
    assert.equal(path.dirname(source), path.dirname(destination));
    await fs.rename(this.target(source), this.target(destination));
  }
  async listNames(name) { this.check('list', name); return fs.readdir(this.target(name)); }
}
class Clock {
  constructor() { this.time = '2026-11-04T10:00:00+08:00'; this.counter = 0; }
  now() { return this.time; }
  nextId(prefix) { return prefix + '-host-' + (++this.counter); }
}
class FakeTransport {
  constructor() { this.calls = []; }
  start(config, request) {
    const call = { config, request, cancels: 0 };
    call.result = new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
    call.cancel = () => { call.cancels++; };
    this.calls.push(call);
    return call;
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const wireDraft = (draft, degraded = false) => new GatewayResponse(200, JSON.stringify({
  type: 'draft', draft, degraded, requestId: 't13-request'
}));
async function harness(t) {
  await fs.mkdir(runtimeRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(runtimeRoot, 'case-'));
  const port = new HostPort(root);
  const store = new LocalStore(new StorageCoordinator(port));
  const clock = new Clock();
  const repository = new NoticeImportRepository(store, clock);
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(runtimeRoot + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, port, store, clock, repository };
}
function exactDraft(zone, dueAt) {
  const value = JSON.parse(JSON.stringify(fixtures.samples[0].draft));
  value.notice.timezone = zone;
  value.task.timezone = zone;
  value.task.deadlinePrecision = 'exact';
  value.task.deadlineDate = null;
  value.task.dueAt = dueAt;
  return value;
}

test('SHA-256 matches Node for ASCII, Chinese, emoji and long exact text', () => {
  for (const text of ['', 'abc', '数据库通知', '中文 😀', 'x'.repeat(10000), 'a\nb\r\n']) {
    assert.equal(sha256Hex(text), nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex'));
  }
});
test('strict T12 draft parser accepts the A-facing exact and unknown fixtures', () => {
  for (const sample of fixtures.samples) {
    const draft = parseNoticeDraft(sample.draft);
    assert.equal(draft.notice.rawText, sample.draft.notice.rawText);
    assert.equal(draft.task.deadlinePrecision, sample.draft.task.deadlinePrecision);
  }
});
test('draft parser rejects malformed deadline, priority and material state', () => {
  const exact = cloneNoticeDraft(parseNoticeDraft(fixtures.samples[0].draft));
  exact.task.dueAt = '2026-11-06T23:59:00';
  assert.throws(() => parseNoticeDraft(JSON.parse(JSON.stringify(exact))), /精确截止|字段无效/);
  const priority = JSON.parse(JSON.stringify(fixtures.samples[0].draft));
  priority.task.priority = 'urgent';
  assert.throws(() => parseNoticeDraft(priority), /优先级/);
  const material = JSON.parse(JSON.stringify(fixtures.samples[0].draft));
  material.checklistItems[0].state = 'prepared';
  assert.throws(() => parseNoticeDraft(material), /材料项/);
});
test('protocol encodes only the extract endpoint request and maps malformed success safely', () => {
  const request = new NoticeExtractionRequest();
  request.rawText = '原文';
  request.sourceLabel = '课程群';
  request.publishedAt = '2026-11-01T09:00:00+08:00';
  assert.deepEqual(JSON.parse(encodeNoticeExtraction(request)), {
    rawText: '原文', publishedAt: '2026-11-01T09:00:00+08:00', sourceLabel: '课程群',
    timezone: 'Asia/Shanghai', answers: [], draft: null
  });
  assert.equal(decodeNoticeExtraction(new GatewayResponse(200, '<html>')).errorCode, 'INVALID_RESPONSE');
  assert.equal(decodeNoticeExtraction(new GatewayResponse(502, '{}')).errorCode, 'MODEL_ERROR');
  assert.equal(decodeNoticeExtraction(new GatewayResponse(200, JSON.stringify({ type: 'draft', draft: {} })))
    .errorCode, 'INVALID_RESPONSE');
});
test('controller extracts, preserves edits and atomically saves Notice/Task/Checklist', async t => {
  const h = await harness(t);
  const transport = new FakeTransport();
  const controller = new NoticeImportController(transport, h.repository);
  controller.configure(new GatewayConfig('https://example.test/gateway/', 'token', 45000));
  controller.setExpectedRevision(0);
  controller.setRawText(fixtures.samples[0].draft.notice.rawText);
  controller.setSourceLabel('数据库课程群');
  controller.setPublishedAt('2026-11-01T09:00:00+08:00');
  controller.extract();
  assert.equal(transport.calls.length, 1);
  assert.equal(controller.snapshot().phase, 'extracting');
  transport.calls[0].resolve(wireDraft(fixtures.samples[0].draft));
  await flush();
  let state = controller.snapshot();
  assert.equal(state.phase, 'idle');
  assert.equal(state.title, '提交数据库实验报告');
  assert.equal(state.deadlineTime, '23:59');
  controller.edit('title', '提交数据库实验报告（已核对）');
  controller.edit('priority', 'high');
  controller.edit('remaining', '0');
  controller.setMaterial(1, '源代码压缩包');
  await controller.confirm();
  state = controller.snapshot();
  assert.equal(state.phase, 'saved');
  assert.equal(state.savedRevision, 1);
  assert.ok(state.savedTaskId.startsWith('task-host-'));
  const saved = (await h.store.read()).data;
  assert.equal(saved.notices.length, 1);
  assert.equal(saved.tasks.length, 1);
  assert.equal(saved.checklistItems.length, 2);
  assert.equal(saved.tasks[0].priority, 'high');
  assert.equal(saved.tasks[0].remainingMinutes, 0);
  assert.deepEqual(saved.tasks[0].noticeIds, [saved.notices[0].id]);
  assert.equal(saved.notices[0].rawText, fixtures.samples[0].draft.notice.rawText);
  assert.equal(saved.notices[0].contentHash,
    nodeCrypto.createHash('sha256').update(saved.notices[0].rawText, 'utf8').digest('hex'));
  assert.ok(saved.checklistItems.every(item => item.taskId === saved.tasks[0].id &&
    item.sourceNoticeId === saved.notices[0].id && item.state === 'pending' && item.confirmedAt === null));
  await controller.confirm();
  assert.equal((await h.store.read()).data.tasks.length, 1);
});
test('unknown deadline can be saved only after explicit confirmation and stays unknown', async t => {
  const h = await harness(t);
  const draft = cloneNoticeDraft(parseNoticeDraft(fixtures.samples[2].draft));
  const input = new NoticeImportInput();
  input.draft = draft;
  input.expectedRevision = 0;
  const result = await h.repository.create(input, 0);
  assert.equal(result.success, true, result.message);
  const saved = (await h.store.read()).data;
  assert.equal(saved.tasks[0].deadlinePrecision, 'unknown');
  assert.equal(saved.tasks[0].deadlineDate, null);
  assert.equal(saved.tasks[0].dueAt, null);
  assert.equal(saved.tasks[0].status, 'todo');
});
test('cancel and network failure preserve raw text and create no task', async t => {
  const h = await harness(t);
  const transport = new FakeTransport();
  const controller = new NoticeImportController(transport, h.repository);
  controller.configure(new GatewayConfig('https://example.test', 'token', 45000));
  controller.setRawText('下周五交报告');
  controller.extract();
  transport.calls[0].reject(new Error('NETWORK detail'));
  await flush();
  assert.equal(controller.snapshot().errorCode, 'NETWORK');
  assert.equal(controller.snapshot().rawText, '下周五交报告');
  controller.extract();
  transport.calls[1].resolve(wireDraft(fixtures.samples[2].draft));
  await flush();
  controller.cancel();
  assert.equal(controller.snapshot().rawText, '下周五交报告');
  assert.equal(controller.snapshot().draft, null);
  assert.equal((await h.store.read()).data.tasks.length, 0);
});
test('stale confirmation is refused and draft remains recoverable', async t => {
  const h = await harness(t);
  const transport = new FakeTransport();
  const controller = new NoticeImportController(transport, h.repository);
  controller.configure(new GatewayConfig('https://example.test', 'token', 45000));
  controller.setExpectedRevision(0);
  controller.setRawText(fixtures.samples[0].draft.notice.rawText);
  controller.extract();
  transport.calls[0].resolve(wireDraft(fixtures.samples[0].draft));
  await flush();
  controller.edit('title', '保留编辑后的实验报告');
  const other = new NoticeImportRepository(h.store, h.clock);
  const competing = new NoticeImportInput();
  competing.draft = cloneNoticeDraft(parseNoticeDraft(fixtures.samples[1].draft));
  assert.equal((await other.create(competing, 0)).success, true);
  await controller.confirm();
  assert.equal(controller.snapshot().errorCode, 'VERSION_CONFLICT');
  assert.notEqual(controller.snapshot().draft, null);
  assert.equal(controller.snapshot().title, '保留编辑后的实验报告');
  assert.equal(controller.snapshot().expectedRevision, 0);
  assert.equal((await h.store.read()).data.tasks.length, 1);
  await controller.refreshRevision();
  assert.equal(controller.snapshot().errorCode, '');
  assert.equal(controller.snapshot().expectedRevision, 1);
  assert.equal(controller.snapshot().title, '保留编辑后的实验报告');
  assert.notEqual(controller.snapshot().draft, null);
  await controller.confirm();
  assert.equal(controller.snapshot().phase, 'saved');
  assert.equal(controller.snapshot().savedRevision, 2);
  const saved = (await h.store.read()).data;
  assert.equal(saved.tasks.length, 2);
  assert.ok(saved.tasks.some(task => task.title === '保留编辑后的实验报告'));
});
test('invalid editable fields fail locally without writing and preserve the draft', async t => {
  const h = await harness(t);
  const portBefore = new HostPort(h.root);
  const transport = new FakeTransport();
  const controller = new NoticeImportController(transport, h.repository);
  controller.configure(new GatewayConfig('https://example.test', 'token', 45000));
  controller.setRawText(fixtures.samples[0].draft.notice.rawText);
  controller.extract();
  transport.calls[0].resolve(wireDraft(fixtures.samples[0].draft));
  await flush();
  controller.edit('date', '2026-02-30');
  controller.edit('time', '25:00');
  await controller.confirm();
  assert.equal(controller.snapshot().errorCode, 'INVALID_DEADLINE');
  assert.notEqual(controller.snapshot().draft, null);
  assert.equal(await portBefore.exists('task-store.json'), false);
});

let nativeRequests = [];
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === '@ohos.net.http') return { default: { createHttp: () => {
    const request = { destroys: 0 };
    request.request = (url, options) => {
      request.url = url;
      request.options = options;
      return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    };
    request.destroy = () => { request.destroys++; };
    nativeRequests.push(request);
    return request;
  }, RequestMethod: { POST: 'POST' }, HttpDataType: { STRING: 0 } } };
  return originalLoad.call(this, name, ...args);
};
require.extensions['.ets'] = function loadEts(module, filename) {
  const ts = require(process.env.T08_TYPESCRIPT_PATH);
  module._compile(ts.transpileModule(nodeFs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText, filename);
};
const { ArkNoticeExtractionTransport } =
  require('../../client/entry/src/main/ets/adapters/ArkNoticeExtractionTransport.ets');
Module._load = originalLoad;
test('native extraction adapter sends only endpoint, bearer, draft input and releases handle', async () => {
  const request = new NoticeExtractionRequest();
  request.rawText = '数据库通知';
  const call = new ArkNoticeExtractionTransport().start(
    new GatewayConfig('https://example.test/gateway/', 'project-token', 45000), request);
  const nativeRequest = nativeRequests.at(-1);
  assert.equal(nativeRequest.url, 'https://example.test/gateway/api/agent/extract-notice');
  assert.equal(nativeRequest.options.header.Authorization, 'Bearer project-token');
  assert.equal(nativeRequest.options.usingCache, false);
  assert.equal(nativeRequest.options.connectTimeout, 10000);
  assert.equal(nativeRequest.options.readTimeout, 45000);
  assert.equal(JSON.parse(nativeRequest.options.extraData).rawText, '数据库通知');
  nativeRequest.resolve({ responseCode: 200, result: JSON.stringify({
    type: 'draft', draft: fixtures.samples[0].draft, degraded: false, requestId: 'native-id'
  }) });
  const response = await call.result;
  assert.equal(decodeNoticeExtraction(response).draft.task.title, '提交数据库实验报告');
  assert.equal(nativeRequest.destroys, 1);
});

test('zoned deadline helpers project offsets and compute edited instants correctly', () => {
  assert.deepEqual(zonedDateTimeParts('2026-11-06T18:30:00Z', 'Asia/Shanghai'),
    { date: '2026-11-07', time: '02:30' });
  assert.equal(zonedTimestamp('2026-11-07', '02:31', 'Asia/Shanghai'), '2026-11-07T02:31:00+08:00');
  assert.equal(timestampMillis('2026-11-07T02:31:00+08:00') -
    timestampMillis('2026-11-06T18:30:00Z'), 60000);
  assert.equal(zonedTimestamp('2026-11-07', '18:31', 'UTC'), '2026-11-07T18:31:00+00:00');
});

for (const [zone, dueAt, date, time] of [
  ['Asia/Shanghai', '2026-11-06T18:30:00Z', '2026-11-07', '02:30'],
  ['Asia/Shanghai', '2026-11-06T18:30:00+00:00', '2026-11-07', '02:30'],
  ['Asia/Shanghai', '2026-11-06T23:30:00-05:00', '2026-11-07', '12:30'],
  ['Asia/Shanghai', '2026-11-06T23:30:00+14:00', '2026-11-06', '17:30'],
  ['UTC', '2026-11-06T18:30:00Z', '2026-11-06', '18:30']
]) {
  test(`un-edited ${zone} ${dueAt} preserves the original instant string`, async t => {
    const h = await harness(t);
    const transport = new FakeTransport();
    const controller = new NoticeImportController(transport, h.repository);
    controller.configure(new GatewayConfig('https://example.test', 'token', 45000));
    controller.setExpectedRevision(0);
    controller.setRawText('offset deadline test');
    controller.extract();
    transport.calls[0].resolve(wireDraft(exactDraft(zone, dueAt)));
    await flush();
    assert.equal(controller.snapshot().deadlineDate, date);
    assert.equal(controller.snapshot().deadlineTime, time);
    await controller.confirm();
    assert.equal(controller.snapshot().phase, 'saved');
    assert.equal((await h.store.read()).data.tasks[0].dueAt, dueAt);
  });
}

for (const [zone, dueAt, editedDate, editedTime] of [
  ['Asia/Shanghai', '2026-11-06T18:30:00Z', '2026-11-07', '02:31'],
  ['Asia/Shanghai', '2026-11-06T23:30:00-05:00', '2026-11-07', '12:31'],
  ['UTC', '2026-11-06T18:30:00Z', '2026-11-06', '18:31']
]) {
  test(`edited ${zone} ${dueAt} preserves the intended one-minute change`, async t => {
    const h = await harness(t);
    const transport = new FakeTransport();
    const controller = new NoticeImportController(transport, h.repository);
    controller.configure(new GatewayConfig('https://example.test', 'token', 45000));
    controller.setExpectedRevision(0);
    controller.setRawText('edited offset deadline test');
    controller.extract();
    transport.calls[0].resolve(wireDraft(exactDraft(zone, dueAt)));
    await flush();
    controller.edit('precision', 'exact');
    controller.edit('date', editedDate);
    controller.edit('time', editedTime);
    await controller.confirm();
    assert.equal(controller.snapshot().phase, 'saved');
    const saved = (await h.store.read()).data.tasks[0];
    assert.equal(saved.dueAt, zonedTimestamp(editedDate, editedTime, zone));
    assert.equal(timestampMillis(saved.dueAt) - timestampMillis(dueAt), 60000);
  });
}
