const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const M = require('../../docs/prototypes/d-experience/model.js');
const fixture = require('../../fixtures/development/d-notice-samples.json');
const samples = fixture.samples;

test('all five development examples are explicitly synthetic, with evidence in unchanged source', () => {
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.usage, 'development-only');
  assert.equal(fixture.modelExecuted, false);
  assert.equal(fixture.interviewsConducted, 0);
  assert.equal(samples.length, 5);
  assert.equal(new Set(samples.map(s=>s.id)).size, 5);
  for (const s of samples) for (const d of s.drafts) {
    assert.ok(s.notice.rawText.includes(d.evidenceQuote));
    assert.equal(M.validateDraft(d), null);
    assert.equal(d.priority, null);
    assert.equal(d.remainingMinutes, null);
  }
});
test('browser data equals the canonical fixture, preventing stale demo expectations', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/prototypes/d-experience/sample-data.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.DExperienceSamples)), fixture);
});
test('making and cancelling a draft does not mutate tasks or original notice', () => {
  const before = JSON.stringify(samples[0]);
  const s = M.makeSession(samples[0], 1);
  const cancelled = M.cancel(s);
  const result = M.confirm(cancelled, []);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.changed, false);
  assert.equal(JSON.stringify(samples[0]), before);
});
test('only explicit confirmation adds all drafts in a multi-task preview', () => {
  const session = M.makeSession(samples[3], 2);
  const result = M.confirm(session, []);
  assert.equal(result.changed, true);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].dueAt, null);
  assert.equal(result.tasks[1].dueAt, '2026-11-09T20:00:00+08:00');
  assert.ok(result.tasks.every(t=>t.status==='todo'));
});
test('repeated confirmation of a completed preview session does not add another task', () => {
  const once = M.confirm(M.makeSession(samples[0], 3), []);
  const twice = M.confirm(once.session, once.tasks);
  assert.equal(twice.tasks.length, 1);
  assert.equal(twice.changed, false);
});
test('failed save preserves draft and leaves list unchanged; same session can be retried', () => {
  const session = M.makeSession(samples[0], 4);
  const failed = M.confirm(session, [], { failSave: true });
  assert.equal(failed.changed, false);
  assert.equal(failed.tasks.length, 0);
  assert.equal(failed.session.state, 'draft');
  assert.deepEqual(failed.session.drafts, session.drafts);
  assert.ok(failed.session.error);
  const retry = M.confirm(failed.session, failed.tasks);
  assert.equal(retry.tasks.length, 1);
});
test('date-only stays date-only and unknown publication cannot anchor a relative date', () => {
  const dateOnly = M.confirm(M.makeSession(samples[1], 5), []).tasks[0];
  assert.equal(dateOnly.dueAt, null);
  assert.equal(dateOnly.deadlineDate, '2026-11-08');
  assert.ok(!M.deadlineLabel(dateOnly).includes('23:59'));
  const unknown = M.confirm(M.makeSession(samples[2], 6), []).tasks[0];
  assert.equal(unknown.deadlinePrecision, 'unknown');
  assert.equal(unknown.deadlineDate, null);
  assert.equal(unknown.dueAt, null);
  assert.equal(unknown.notice.publishedAt, null);
});
test('an unresolved class/target cannot be confirmed as a new task or update', () => {
  const s = M.makeSession(samples[4], 7);
  assert.equal(s.state, 'clarifying');
  assert.equal(M.confirm(s, []).tasks.length, 0);
});
test('invalid calendar dates or empty titles block confirmation', () => {
  const s = M.makeSession(samples[1], 8);
  s.drafts[0].deadlineDate = '2026-02-30';
  assert.equal(M.confirm(s, []).changed, false);
  s.drafts[0].deadlineDate = '2028-02-29';
  assert.equal(M.confirm(s, []).changed, true);
  s.drafts[0].title = '   ';
  assert.equal(M.confirm(s, []).changed, false);
});
test('user edits and material preparation are distinct from source and submission', () => {
  const s = M.makeSession(samples[0], 9);
  s.drafts[0].title = '我修改的标题';
  const result = M.confirm(s, []);
  assert.equal(result.tasks[0].title, '我修改的标题');
  assert.equal(result.tasks[0].notice.rawText, samples[0].notice.rawText);
  assert.ok(result.tasks[0].materials.every(m=>m.state==='pending'));
  assert.equal(result.tasks[0].status, 'todo');
  result.tasks[0].title = 'later mutation';
  assert.notEqual(s.drafts[0].title, result.tasks[0].title);
});
