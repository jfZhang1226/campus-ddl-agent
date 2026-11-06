const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HistoryController } = require('../../client/entry/src/main/ets/chat/HistoryController.ts');
const { harness, ready, pending, complete, until, primary, ok, wire, structured } = require('./history.test.cjs');

function page(h, t) { const p = new HistoryController(h.repo, h.controller); t.after(() => p.dispose()); return p; }
function failPersistently(h, key) {
  const original = h.port.check.bind(h.port);
  h.port.check = async (op, name) => { await original(op, name); if (op + ':' + name === key) throw new Error('controlled persistent failure'); };
  return () => { h.port.check = original; };
}
async function answerSaveFailure(h) {
  const call = await pending(h);
  h.port.fail = 'replace:' + primary(h.controller.snapshot().sessionId);
  call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  assert.equal(h.controller.snapshot().canAbandonSave, true);
}
const mutating = trace => trace.filter(x => x.startsWith('write:') || x.startsWith('replace:'));

test('persistent pre-request write failure can be browsed, cancelled and explicitly abandoned without sending', async t => {
  const h = await harness(t); await ready(h); const p = page(h, t);
  const restore = failPersistently(h, 'write:sessions/history-1.tmp.json');
  h.controller.setDraft('不能自动丢失的输入'); h.controller.send(); await until(() => !h.controller.snapshot().busy);
  for (let i = 0; i < 3; i++) assert.equal(await h.controller.retryHistorySave(), false);
  const before = h.controller.snapshot(), start = h.port.trace.length;
  assert.equal(await p.showList(), true); assert.deepEqual(h.controller.snapshot(), before);
  assert.equal(p.showChat(), true); assert.equal(await p.requestNew(), false);
  assert.equal(p.snapshot().confirmUnsaved, true); p.cancelConfirmation();
  assert.deepEqual(h.controller.snapshot(), before); assert.equal(h.controller.newConversation(true), false);
  assert.equal(await h.controller.openHistory('other', true), false); h.controller.send();
  assert.equal(h.transport.calls.length, 0); assert.deepEqual(mutating(h.port.trace.slice(start)), []);
  await p.requestNew(); assert.equal(await p.confirmDiscard(), true);
  assert.equal(h.controller.snapshot().savePending, false); assert.equal(h.controller.snapshot().draft, '');
  assert.equal(h.controller.snapshot().messages.length, 0); assert.equal(await h.port.exists(primary('history-1')), false);
  assert.deepEqual(mutating(h.port.trace.slice(start)), []); restore();
  const next = await complete(h); assert.equal(next.sessionId, 'history-2'); assert.equal(h.transport.calls.length, 1);
});

test('persistent answer-save failure preserves the reply while viewing disk history and canceling an empty-input discard', async t => {
  const h = await harness(t); await ready(h); const p = page(h, t), call = await pending(h);
  const raw = await h.port.readText(primary('history-1'));
  failPersistently(h, 'replace:sessions/history-1.json'); call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  h.controller.setDraft(''); const before = h.controller.snapshot();
  for (let i = 0; i < 3; i++) assert.equal(await h.controller.retryHistorySave(), false);
  const start = h.port.trace.length;
  assert.equal(await p.showList(), true); assert.equal(await p.openDetail('history-1'), true);
  assert.equal(p.snapshot().messages.length, 1); assert.equal(h.controller.snapshot().messages.length, 2);
  assert.equal(await p.requestOpen('history-1'), true); assert.equal(p.snapshot().confirmation, '');
  assert.equal(await p.requestNew(), false); assert.equal(p.snapshot().confirmUnsaved, true);
  assert.equal(p.snapshot().confirmDraft, ''); p.cancelConfirmation();
  assert.deepEqual(h.controller.snapshot().messages, before.messages); assert.equal(h.controller.snapshot().savePending, true);
  await p.requestNew(); assert.equal(await p.confirmDiscard(), true);
  assert.equal(await h.port.readText(primary('history-1')), raw); assert.deepEqual(mutating(h.port.trace.slice(start)), []);
  assert.equal(h.transport.calls.length, 1); assert.equal(h.controller.snapshot().canRetry, false);
});

test('confirmed switch after an answer save failure appends only to the chosen conversation', async t => {
  const h = await harness(t); await ready(h); const first = await complete(h); h.controller.newConversation();
  await answerSaveFailure(h); const p = page(h, t);
  const firstRaw = await h.port.readText(primary(first.sessionId)), failedRaw = await h.port.readText(primary('history-2'));
  await p.requestOpen(first.sessionId); assert.equal(p.snapshot().confirmUnsaved, true); p.cancelConfirmation();
  assert.equal(h.controller.snapshot().sessionId, 'history-2');
  await p.requestOpen(first.sessionId); assert.equal(await p.confirmDiscard(), true);
  assert.equal(h.controller.snapshot().sessionId, first.sessionId); assert.equal(h.controller.snapshot().savePending, false);
  assert.equal(h.controller.snapshot().storageErrorCode, ''); assert.equal(h.controller.snapshot().canRetry, false);
  assert.equal(await h.port.readText(primary(first.sessionId)), firstRaw); assert.equal(h.transport.calls.length, 2);
  await complete(h); assert.equal(ok(await h.repo.get(first.sessionId)).messages.length, 4);
  assert.equal(await h.port.readText(primary('history-2')), failedRaw); assert.equal(h.transport.calls.length, 3);
});

test('tmp-only recovery can be left after confirmation without promoting or deleting the candidate', async t => {
  const h = await harness(t); await ready(h); const p = page(h, t); h.port.fail = 'replace:sessions/history-1.json';
  h.controller.setDraft('第一次替换失败'); h.controller.send(); await until(() => !h.controller.snapshot().busy);
  const tmp = await h.port.readText('sessions/history-1.tmp.json');
  for (let i = 0; i < 3; i++) assert.equal(await h.controller.retryHistorySave(), false);
  assert.equal(h.controller.snapshot().storageErrorCode, 'RECOVERY_REQUIRED'); assert.equal(await p.showList(), true);
  assert.equal(p.snapshot().issues[0].errorCode, 'RECOVERY_REQUIRED'); const start = h.port.trace.length;
  await p.requestNew(); assert.equal(await p.confirmDiscard(), true);
  assert.deepEqual(mutating(h.port.trace.slice(start)), []); assert.equal(await h.port.readText('sessions/history-1.tmp.json'), tmp);
  assert.equal(await h.port.exists(primary('history-1')), false); assert.equal(h.transport.calls.length, 0);
  assert.equal((await complete(h)).sessionId, 'history-2');
  assert.equal(await h.port.readText('sessions/history-1.tmp.json'), tmp);
});

test('version conflict can be left explicitly without rebasing, overwriting or retrying the gateway', async t => {
  const h = await harness(t); await ready(h); const call = await pending(h), p = page(h, t);
  const external = ok(await h.repo.get('history-1')); external.session.title = '外部已更新'; ok(await h.makeRepo().save(external, 1));
  const raw = await h.port.readText(primary('history-1')); call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  for (let i = 0; i < 3; i++) assert.equal(await h.controller.retryHistorySave(), false);
  assert.equal(h.controller.snapshot().storageErrorCode, 'VERSION_CONFLICT');
  await p.requestNew(); p.cancelConfirmation(); assert.equal(h.controller.snapshot().messages.length, 2);
  await p.requestNew(); assert.equal(await p.confirmDiscard(), true);
  assert.equal(await h.port.readText(primary('history-1')), raw); assert.equal(h.transport.calls.length, 1);
});

test('a failed target read keeps the original unsaved reply and permits its explicit local save retry', async t => {
  const h = await harness(t); await ready(h); await answerSaveFailure(h); const p = page(h, t);
  const before = h.controller.snapshot(), raw = await h.port.readText(primary('history-1'));
  await p.requestOpen('missing'); assert.equal(await p.confirmDiscard(), false);
  assert.equal(h.controller.snapshot().savePending, true); assert.equal(h.controller.snapshot().historyReady, true);
  assert.equal(h.controller.snapshot().canAbandonSave, true); assert.deepEqual(h.controller.snapshot().messages, before.messages);
  assert.equal(h.controller.snapshot().draft, before.draft); assert.equal(await h.port.readText(primary('history-1')), raw);
  assert.equal(await h.controller.retryHistorySave(), true); assert.equal(h.controller.snapshot().draft, '');
  assert.equal(ok(await h.repo.get('history-1')).messages.length, 2); assert.equal(h.transport.calls.length, 1);
});

for (const outcome of ['success', 'failure']) test('a save retry invalidates a previous discard confirmation: ' + outcome, async t => {
  const h = await harness(t); await ready(h); await answerSaveFailure(h); const p = page(h, t);
  await p.requestNew(); const token = p.snapshot().confirmToken;
  if (outcome === 'failure') h.port.fail = 'replace:sessions/history-1.json';
  assert.equal(await h.controller.retryHistorySave(), outcome === 'success');
  assert.notEqual(h.controller.snapshot().navigationToken, token); assert.equal(await p.confirmDiscard(), false);
  assert.equal(h.controller.snapshot().sessionId, 'history-1'); assert.ok(p.snapshot().notice.includes('已变化'));
  assert.equal(h.controller.snapshot().savePending, outcome === 'failure'); assert.equal(h.transport.calls.length, 1);
});

test('editing input and restoring the original text still invalidates an unsaved-content confirmation', async t => {
  const h = await harness(t); await ready(h); await answerSaveFailure(h); const p = page(h, t);
  const draft = h.controller.snapshot().draft; await p.requestNew();
  h.controller.setDraft(draft + '改变'); h.controller.setDraft(draft);
  assert.equal(await p.confirmDiscard(), false); assert.equal(h.controller.snapshot().savePending, true);
  assert.equal(h.controller.snapshot().messages.length, 2); assert.equal(h.transport.calls.length, 1);
});

test('a held save retry cannot be bypassed by a valid old token or a second retry and invalidates confirmation when finished', async t => {
  const h = await harness(t); await ready(h); await answerSaveFailure(h); const p = page(h, t);
  await p.requestNew(); const token = p.snapshot().confirmToken, gate = h.port.hold('replace:sessions/history-1.json');
  const retry = h.controller.retryHistorySave(); await until(() => gate.entered);
  assert.equal(h.controller.snapshot().canAbandonSave, false); assert.equal(h.controller.newConversation(true, token), false);
  assert.equal(await h.controller.openHistory('history-1', true, token), false);
  assert.equal(await h.controller.retryHistorySave(), false); assert.equal(await p.confirmDiscard(), false);
  assert.equal(await p.showList(), false); gate.release(); assert.equal(await retry, true);
  assert.equal(h.controller.snapshot().sessionId, 'history-1'); assert.equal(h.controller.snapshot().messages.length, 2);
  assert.equal(h.transport.calls.length, 1);
});

test('a held target read prevents local saving and a second abandonment; new input typed during it is retained', async t => {
  const h = await harness(t); await ready(h); const first = await complete(h); h.controller.newConversation(); await answerSaveFailure(h);
  const p = page(h, t); await p.requestOpen(first.sessionId);
  const gate = h.port.hold('read:' + primary(first.sessionId)), read = p.confirmDiscard(); await until(() => gate.entered);
  assert.equal(h.controller.snapshot().canAbandonSave, false); assert.equal(await h.controller.retryHistorySave(), false);
  assert.equal(h.controller.newConversation(true, h.controller.snapshot().navigationToken), false);
  h.controller.setDraft('读取期间新增输入'); gate.release(); assert.equal(await read, true);
  assert.equal(h.controller.snapshot().draft, '读取期间新增输入'); assert.equal(h.controller.snapshot().sessionId, first.sessionId);
  assert.equal(h.controller.snapshot().savePending, false); assert.equal(h.transport.calls.length, 2);
});

test('late cancelled network callbacks cannot resurrect abandoned messages in the new conversation', async t => {
  const h = await harness(t); await ready(h); const call = await pending(h), p = page(h, t);
  h.port.fail = 'replace:sessions/history-1.json'; h.controller.stop(); await until(() => !h.controller.snapshot().busy);
  const raw = await h.port.readText(primary('history-1')); await p.requestNew(); assert.equal(await p.confirmDiscard(), true);
  h.controller.setDraft('新对话输入'); const state = h.controller.snapshot();
  call.resolve(wire('answer', '迟到的旧回复')); h.clock.fire(); await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(h.controller.snapshot(), state); assert.equal(await h.port.readText(primary('history-1')), raw);
  assert.equal(h.transport.calls.length, 1); assert.equal(h.controller.snapshot().messages.length, 0);
});

test('an old navigation token cannot abandon a later conversation or a later failure', async t => {
  const h = await harness(t); await ready(h); await answerSaveFailure(h); const p = page(h, t);
  await p.requestNew(); const token = p.snapshot().confirmToken; assert.equal(await p.confirmDiscard(), true);
  await answerSaveFailure(h); const state = h.controller.snapshot();
  assert.equal(h.controller.newConversation(true, token), false);
  assert.equal(await h.controller.openHistory('history-1', true, token), false);
  assert.deepEqual(h.controller.snapshot(), state); assert.equal(h.transport.calls.length, 2);
});

test('failed read-only browsing and a disposed page retain the unsaved transcript', async t => {
  const h = await harness(t); await ready(h); await answerSaveFailure(h); const p = page(h, t), before = h.controller.snapshot();
  h.port.fail = 'list:sessions'; assert.equal(await p.showList(), false);
  assert.deepEqual(h.controller.snapshot(), before); p.dispose();
  assert.equal(await p.requestNew(), false); assert.equal(await p.confirmDiscard(), false);
  assert.deepEqual(h.controller.snapshot(), before); assert.equal(await h.controller.retryHistorySave(), true);
  assert.equal(h.transport.calls.length, 1);
});

for (const status of ['done', 'future-compatible-state']) test('status documentation keeps nonempty historical states readable: ' + status, async t => {
  const h = await harness(t); await ready(h); const p = page(h, t), doc = structuredClone(structured);
  doc.messages[0].status = status; const raw = JSON.stringify(doc); await h.port.writeText(primary(doc.session.id), raw);
  assert.equal(await p.openDetail(doc.session.id), true);
  assert.equal(p.snapshot().messages[0].status, status === 'done' ? '已完成' : status);
  assert.equal(await h.controller.openHistory(doc.session.id), true);
  assert.equal(await h.port.readText(primary(doc.session.id)), raw); assert.equal(h.transport.calls.length, 0);
  if (status !== 'done') {
    await complete(h); assert.equal(ok(await h.repo.get(doc.session.id)).messages[0].status, status);
    assert.deepEqual(ok(await h.repo.get(doc.session.id)).messages.filter(x => x.type === 'tool_result'),
      doc.messages.filter(x => x.type === 'tool_result'));
  }
});
