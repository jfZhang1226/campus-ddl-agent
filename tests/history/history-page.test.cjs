const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HistoryController, historyMessage, historyError } = require('../../client/entry/src/main/ets/chat/HistoryController.ts');
const { harness, ready, pending, complete, until, primary, ok, wire, structured, legacy } = require('./history.test.cjs');

function page(h, t, source = h.repo) {
  const view = new HistoryController(source, h.controller);
  t.after(() => view.dispose()); return view;
}
test('formal history empty state reads without creating a session or clearing unsent text', async t => {
  const h = await harness(t); await ready(h); h.controller.setDraft('尚未发送的输入'); const p = page(h, t);
  assert.equal(await p.showList(), true);
  assert.equal(p.snapshot().page, 'list'); assert.equal(p.snapshot().listLoaded, true);
  assert.deepEqual(p.snapshot().sessions, []); assert.deepEqual(p.snapshot().issues, []);
  assert.equal(h.controller.snapshot().draft, '尚未发送的输入'); assert.equal(h.transport.calls.length, 0);
  assert.equal(await h.port.exists(primary('history-1')), false);
});
test('formal list shows newest healthy session and individual corrupt/tmp-only issues without rewriting files', async t => {
  const h = await harness(t); await ready(h); const first = await complete(h);
  h.controller.newConversation(); h.runtime.time = '2026-11-04T11:00:00Z'; const second = await complete(h);
  await h.port.writeText('sessions/broken.json', '{bad'); await h.port.writeText('sessions/unfinished.tmp.json', '{}');
  const bytes = await h.port.readText(primary(first.sessionId)); const calls = h.transport.calls.length, p = page(h, t);
  assert.equal(await p.showList(), true);
  assert.deepEqual(p.snapshot().sessions.map(x => x.id), [second.sessionId, first.sessionId]);
  assert.deepEqual(p.snapshot().issues.map(x => x.errorCode).sort(), ['CORRUPT_DATA', 'RECOVERY_REQUIRED']);
  assert.equal(await h.port.readText(primary(first.sessionId)), bytes); assert.equal(await h.port.readText('sessions/broken.json'), '{bad');
  assert.equal(h.transport.calls.length, calls);
});
test('formal details retain all structured calls/results and remain read-only and detached from the active chat', async t => {
  const h = await harness(t); await ready(h); const active = await complete(h); const p = page(h, t);
  const doc = structuredClone(structured); doc.messages.find(x => x.calls.length).calls[0].extra = { keep: '扩展字段' };
  const raw = JSON.stringify(doc); await h.port.writeText(primary(doc.session.id), raw);
  const calls = h.transport.calls.length, trace = h.port.trace.length;
  assert.equal(await p.openDetail(doc.session.id), true);
  const view = p.snapshot(); assert.equal(view.messages.length, doc.messages.length);
  doc.messages.forEach((message, i) => {
    assert.deepEqual(view.detail.messages[i], message);
    assert.equal(view.messages[i].calls, message.calls.length ? JSON.stringify(message.calls, null, 2) : '');
    assert.equal(view.messages[i].results, message.results.length ? JSON.stringify(message.results, null, 2) : '');
  });
  assert.ok(view.messages.some(x => x.calls.includes('扩展字段')));
  view.detail.messages[0].text = '页面副本突变'; view.messages[0].text = '另一个突变';
  assert.notEqual(p.snapshot().messages[0].text, '另一个突变');
  assert.equal(await h.port.readText(primary(doc.session.id)), raw);
  assert.ok(h.port.trace.slice(trace).every(x => !x.startsWith('write:') && !x.startsWith('replace:')));
  assert.equal(h.controller.snapshot().sessionId, active.sessionId); assert.equal(h.transport.calls.length, calls);
});
test('formal legacy details display old tool hints without rewriting v1 or inventing calls/results', async t => {
  const h = await harness(t); await ready(h); await h.port.ensureDirectory('sessions');
  const raw = JSON.stringify(legacy); await h.port.writeText(primary(legacy.session.id), raw); const p = page(h, t);
  assert.equal(await p.openDetail(legacy.session.id), true);
  const old = p.snapshot().messages.filter(x => x.kind === '旧版工具摘要'); assert.ok(old.length > 0);
  old.forEach(x => { assert.equal(x.calls, ''); assert.equal(x.results, ''); assert.ok(x.text.length || x.legacy.length); });
  assert.equal(await h.port.readText(primary(legacy.session.id)), raw); assert.equal(h.transport.calls.length, 0);
});
test('new-chat confirmation can be cancelled and explicit discard preserves every old session', async t => {
  const h = await harness(t); await ready(h); const active = await complete(h), p = page(h, t);
  const raw = await h.port.readText(primary(active.sessionId)); h.controller.setDraft('尚未发送');
  assert.equal(await p.requestNew(), false); assert.equal(p.snapshot().confirmation, 'new');
  p.cancelConfirmation(); assert.equal(h.controller.snapshot().draft, '尚未发送');
  assert.equal(h.controller.snapshot().sessionId, active.sessionId);
  await p.requestNew(); assert.equal(await p.confirmDiscard(), true);
  assert.equal(h.controller.snapshot().sessionId, ''); assert.equal(h.controller.snapshot().draft, '');
  assert.equal(p.snapshot().page, 'chat'); assert.equal(ok(await h.repo.list()).sessions.length, 1);
  assert.equal(await h.port.readText(primary(active.sessionId)), raw); assert.equal(h.transport.calls.length, 1);
});
test('continue-selected-session confirmation changes only the active view and never requests a reply', async t => {
  const h = await harness(t); await ready(h); const first = await complete(h); h.controller.newConversation();
  const second = await complete(h, 'clarification'), p = page(h, t); h.controller.setDraft('当前输入');
  const originals = await Promise.all([first, second].map(x => h.port.readText(primary(x.sessionId))));
  await p.openDetail(first.sessionId); assert.equal(await p.requestOpen(first.sessionId), false);
  assert.equal(p.snapshot().confirmation, 'open'); p.cancelConfirmation();
  assert.equal(h.controller.snapshot().sessionId, second.sessionId); assert.equal(h.controller.snapshot().draft, '当前输入');
  await p.requestOpen(first.sessionId); assert.equal(await p.confirmDiscard(), true);
  assert.equal(h.controller.snapshot().sessionId, first.sessionId); assert.equal(h.controller.snapshot().draft, '');
  assert.deepEqual(await Promise.all([first, second].map(x => h.port.readText(primary(x.sessionId)))), originals);
  assert.equal(h.transport.calls.length, 2);
});
test('returning to the current session keeps its draft and does not ask to discard it', async t => {
  const h = await harness(t); await ready(h); const active = await complete(h), p = page(h, t);
  h.controller.setDraft('仍然保留'); await p.openDetail(active.sessionId);
  assert.equal(await p.requestOpen(active.sessionId), true); assert.equal(p.snapshot().confirmation, '');
  assert.equal(h.controller.snapshot().draft, '仍然保留'); assert.equal(h.transport.calls.length, 1);
});
test('a stale discard confirmation cannot erase text changed after the prompt', async t => {
  const h = await harness(t); await ready(h); const p = page(h, t); h.controller.setDraft('原输入');
  await p.requestNew(); h.controller.setDraft('弹出确认后新输入');
  assert.equal(await p.confirmDiscard(), false); assert.equal(h.controller.snapshot().draft, '弹出确认后新输入');
  assert.ok(p.snapshot().notice.includes('已变化')); assert.equal(p.snapshot().confirmation, '');
  assert.equal(h.transport.calls.length, 0);
});
test('requests and failed local saves block history navigation and new sessions', async t => {
  const h = await harness(t); await ready(h); const p = page(h, t), call = await pending(h);
  assert.equal(await p.showList(), false); assert.equal(await p.requestNew(), false);
  h.port.fail = 'replace:sessions/history-1.json'; call.resolve(wire()); await until(() => !h.controller.snapshot().busy);
  assert.equal(h.controller.snapshot().savePending, true); assert.equal(await p.openDetail('history-1'), false);
  assert.equal(await p.requestNew(), false); assert.equal(h.controller.snapshot().messages.length, 2);
  assert.equal(await h.controller.retryHistorySave(), true); assert.equal(await p.showList(), true);
  assert.equal(h.transport.calls.length, 1);
});
test('failed list refresh retains last successful data and a subsequent explicit retry clears the error', async t => {
  const h = await harness(t); await ready(h); await complete(h); const p = page(h, t);
  await p.showList(); const prior = p.snapshot().sessions; h.port.fail = 'list:sessions';
  assert.equal(await p.showList(), false); assert.deepEqual(p.snapshot().sessions, prior);
  assert.ok(p.snapshot().error.length > 0); assert.ok(p.snapshot().notice.includes('上次'));
  assert.equal(await p.showList(), true); assert.equal(p.snapshot().error, ''); assert.equal(p.snapshot().notice, '');
});
test('unreadable detail and continuation failure preserve active messages, files and unsent input', async t => {
  const h = await harness(t); await ready(h); const active = await complete(h), p = page(h, t);
  h.controller.setDraft('保留输入'); const raw = await h.port.readText(primary(active.sessionId));
  assert.equal(await p.openDetail('missing'), false); assert.equal(p.snapshot().detail, null);
  assert.ok(p.snapshot().error.includes('未找到')); assert.equal(p.snapshot().listLoaded, false);
  await p.requestOpen('missing'); assert.equal(await p.confirmDiscard(), false);
  assert.deepEqual(h.controller.snapshot().messages, active.messages); assert.equal(h.controller.snapshot().draft, '保留输入');
  assert.equal(await h.port.readText(primary(active.sessionId)), raw); assert.equal(h.transport.calls.length, 1);
});
test('returning to chat cancels a slow read view and ignores its late completion', async t => {
  const h = await harness(t); await ready(h); const gate = h.port.hold('list:sessions'), p = page(h, t);
  const load = p.showList(); await until(() => gate.entered); assert.equal(p.snapshot().loading, true);
  assert.equal(p.showChat(), true); gate.release(); assert.equal(await load, false);
  assert.equal(p.snapshot().page, 'chat'); assert.equal(p.snapshot().listLoaded, false); assert.equal(p.snapshot().loading, false);
});
test('disposed page ignores rejected reads and never steals the chat subscriber', async t => {
  const h = await harness(t); await ready(h); let reject;
  const p = page(h, t, { list: () => new Promise((_, r) => reject = r), get: id => h.repo.get(id) });
  let chatUpdates = 0, pageUpdates = 0; h.controller.subscribe(() => chatUpdates++); p.subscribe(() => pageUpdates++);
  const read = p.showList(); const before = pageUpdates; p.dispose(); reject(new Error('/private/device/path'));
  assert.equal(await read, false); assert.equal(pageUpdates, before);
  h.controller.setDraft('新的输入'); assert.equal(chatUpdates, 2);
});
test('pending status is only a display projection and unknown storage errors do not expose native details', () => {
  const message = structuredClone(structured.messages[0]); message.status = 'pending';
  const view = historyMessage(message); assert.equal(view.status, '请求未完成，未自动重发'); assert.equal(message.status, 'pending');
  assert.ok(!historyError('/private/path/token').includes('/private'));
});
