const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isCalendarDate, timestampMillis, isOffsetTimestamp, deadlineIsValid, deadlineDay } =
  require('../../client/entry/src/main/ets/domain/DateRules.ts');
const { BusinessSnapshot } = require('../../client/entry/src/main/ets/domain/StorageModels.ts');
const { TaskDraft, TaskQuery } = require('../../client/entry/src/main/ets/domain/TaskContracts.ts');
const { TaskRepository } = require('../../client/entry/src/main/ets/data/TaskRepository.ts');
const { LocalStore } = require('../../client/entry/src/main/ets/data/LocalStore.ts');
const { StorageCoordinator } = require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const { readTaskProbe, writeTaskProbe } = require('../../client/entry/src/main/ets/data/diagnostics/TaskProbe.ts');
const fixtures = require('../../fixtures/task-samples.json');

const runtimeRoot = path.resolve(__dirname, '../../runtime/t14-host-tests');
class HostPort {
  constructor(root) { this.root = root; this.fail = ''; this.trace = []; }
  target(name) {
    const target = path.resolve(this.root, name);
    assert.ok(target === this.root || target.startsWith(this.root + path.sep));
    return target;
  }
  check(op, name) {
    const key = op + ':' + name;
    this.trace.push(key);
    if (this.fail === key) { this.fail = ''; throw new Error('Private host I/O error'); }
  }
  async ensureDirectory(name) { this.check('mkdir', name); await fs.mkdir(this.target(name), { recursive: true }); }
  async exists(name) {
    this.check('exists', name);
    try { await fs.stat(this.target(name)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
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
  constructor() { this.counter = 0; this.time = '2026-10-30T10:00:00+08:00'; this.fixedId = null; }
  now() { return this.time; }
  nextId() { return this.fixedId === null ? 'task-host-' + (++this.counter) : this.fixedId; }
}
function ok(response) { assert.equal(response.success, true, response.message); assert.notEqual(response.data, null); return response.data; }
function draft(changes = {}) { return Object.assign(new TaskDraft(), { title: '人工任务 🗓️' }, changes); }
function edit(task, changes = {}) {
  const value = draft();
  for (const key of Object.keys(value)) value[key] = structuredClone(task[key]);
  return Object.assign(value, changes);
}
async function harness(t) {
  await fs.mkdir(runtimeRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(runtimeRoot, 'case-'));
  const port = new HostPort(root), clock = new Clock();
  const store = new LocalStore(new StorageCoordinator(port));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(runtimeRoot + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, port, clock, store, repo: new TaskRepository(store, clock) };
}

for (const date of ['0001-01-01', '0099-12-31', '1900-02-28', '2000-02-29', '2028-02-29', '2026-04-30', '9999-12-31']) {
  test('valid Gregorian date: ' + date, () => assert.equal(isCalendarDate(date), true));
}
for (const date of ['0000-01-01', '1900-02-29', '2100-02-29', '2026-02-29', '2028-02-30', '2026-04-31',
  '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01', '2026-01-1', '2026-01-01 ',
  '2026-01-01T00:00:00Z', null, 0, {}, undefined]) {
  test('reject impossible or malformed date: ' + String(date), () => assert.equal(isCalendarDate(date), false));
}
for (const value of ['0001-01-01T00:00:00Z', '0099-12-31T23:59:59Z', '2028-02-29T23:59:59.123+08:00',
  '2026-10-30T00:00:00.1Z', '2026-10-30T00:00:00.12Z', '2026-10-30T00:00:00+14:00', '2026-10-30T00:00:00-14:00']) {
  test('exact timestamp agrees with independent ISO parser: ' + value, () => assert.equal(timestampMillis(value), Date.parse(value)));
}
for (const value of ['2026-02-30T12:00:00Z', '2026-04-31T00:00:00+08:00', '2026-10-30T24:00:00Z',
  '2026-10-30T10:60:00Z', '2026-10-30T10:00:60Z', '2026-10-30T00:00:00+14:01', '2026-10-30T00:00:00+15:00',
  '2026-10-30T00:00:00+08:60', '2026-10-30T00:00:00-00:00', '2026-10-30T00:00:00',
  '2026-10-30T00:00Z', '2026-10-30T00:00:00.1234Z', '2026-10-30 00:00:00Z', null, undefined, 0]) {
  test('reject ambiguous/impossible timestamp: ' + String(value), () => assert.equal(isOffsetTimestamp(value), false));
}
test('precision fields are exclusive and date-only never becomes an instant', () => {
  assert.equal(deadlineIsValid('unknown', null, null), true);
  assert.equal(deadlineIsValid('unknown', '2026-10-30', null), false);
  assert.equal(deadlineIsValid('date_only', '2026-10-30', null), true);
  assert.equal(deadlineIsValid('date_only', '2026-10-30', '2026-10-30T23:59:00Z'), false);
  assert.equal(deadlineIsValid('exact', null, '2026-10-30T00:00:00Z'), true);
  assert.equal(deadlineIsValid('exact', null, null), false);
  assert.equal(deadlineDay('date_only', '2026-10-30', null, 'UTC'), '2026-10-30');
  assert.equal(deadlineDay('exact', null, '2026-10-30T23:30:00-05:00', 'Asia/Shanghai'), '2026-10-31');
  assert.equal(deadlineDay('exact', null, '2026-10-30T23:30:00Z', 'UTC'), '2026-10-30');
  assert.equal(deadlineDay('exact', null, '2026-10-30T23:30:00Z', 'Europe/London'), null);
});

test('CRUD round-trips real files with null/0, stable ID, audit times and deterministic no-op', async t => {
  const h = await harness(t);
  const created = ok(await h.repo.create(draft(), 0));
  assert.equal(created.revision, 1); assert.equal(created.task.version, 1);
  assert.equal(created.task.remainingMinutes, null); assert.equal(created.task.dueAt, null);
  h.clock.time = '2026-10-30T11:00:00+08:00';
  const request = edit(created.task, { remainingMinutes: 0, deadlinePrecision: 'date_only', deadlineDate: '2028-02-29' });
  const saved = ok(await h.repo.update(created.task.id, request, 1, 1));
  assert.equal(saved.task.id, created.task.id); assert.equal(saved.task.createdAt, created.task.createdAt);
  assert.equal(saved.task.updatedAt, h.clock.time); assert.equal(saved.task.version, 2);
  assert.equal(saved.task.remainingMinutes, 0); assert.equal(saved.task.dueAt, null);
  const primary = await h.port.readText('task-store.json'); h.port.trace = [];
  const same = ok(await h.repo.update(saved.task.id, request, 2, 2));
  assert.equal(same.changed, false); assert.equal(same.revision, 2);
  assert.equal(h.port.trace.filter(x => x.startsWith('write:')).length, 0);
  const reopened = new TaskRepository(new LocalStore(new StorageCoordinator(new HostPort(h.root))), h.clock);
  assert.deepEqual(ok(await reopened.get(saved.task.id)).task, saved.task);
  const removed = ok(await reopened.delete(saved.task.id, 2, 2));
  assert.equal(removed.deleted, true); assert.equal(removed.revision, 3);
  assert.equal((await reopened.get(saved.task.id)).errorCode, 'NOT_FOUND');
  assert.equal((await reopened.delete(saved.task.id, 3, 2)).errorCode, 'NOT_FOUND');
  assert.equal(await h.port.readText('task-store.backup.json'), primary);
});

for (const change of [{ title: ' ' }, { course: '' }, { remainingMinutes: -1 }, { remainingMinutes: 0.1 },
  { remainingMinutes: Number.MAX_SAFE_INTEGER + 1 }, { kind: 'unknown' }, { priority: 'automatic' }, { status: 'overdue' },
  { timezone: 'Mars/Olympus' }, { deadlinePrecision: 'date_only', deadlineDate: '2026-02-29' },
  { deadlinePrecision: 'exact', dueAt: '2026-10-30T10:00:00' }, { noticeIds: ['missing', 'missing'] },
  { course: undefined }, { remainingMinutes: NaN }, { remainingMinutes: Infinity }]) {
  test('invalid draft rejected before I/O: ' + Object.keys(change).join(',' ) + JSON.stringify(change), async t => {
    const h = await harness(t);
    assert.equal((await h.repo.create(draft(change), 0)).errorCode, 'INVALID_ARGUMENT');
    assert.deepEqual(h.port.trace, []);
  });
}
test('caller input is captured before awaiting and returned records cannot mutate disk', async t => {
  const h = await harness(t); const input = draft();
  const pending = h.repo.create(input, 0); input.title = 'changed after submit'; input.noticeIds.push('missing');
  const created = ok(await pending); assert.equal(created.task.title, '人工任务 🗓️');
  created.task.title = 'mutated return';
  assert.equal(ok(await h.repo.get(created.task.id)).task.title, '人工任务 🗓️');
});
test('snapshot and task version conflicts do not silently retry or accept a no-op', async t => {
  const h = await harness(t); const created = ok(await h.repo.create(draft(), 0));
  const bytes = await h.port.readText('task-store.json');
  for (const [revision, version] of [[0, 1], [1, 2]]) {
    assert.equal((await h.repo.update(created.task.id, draft(), revision, version)).errorCode, 'VERSION_CONFLICT');
    assert.equal((await h.repo.delete(created.task.id, revision, version)).errorCode, 'VERSION_CONFLICT');
  }
  assert.equal((await h.repo.create(draft(), 0)).errorCode, 'VERSION_CONFLICT');
  assert.equal(await h.port.readText('task-store.json'), bytes);
});
test('two repositories with the same coordinator cannot lose concurrent writes', async t => {
  const h = await harness(t);
  const other = new TaskRepository(h.store, h.clock);
  const responses = await Promise.all([h.repo.create(draft({title:'甲'}), 0), other.create(draft({title:'乙'}), 0)]);
  assert.equal(responses.filter(x => x.success).length, 1);
  assert.equal(responses.filter(x => x.errorCode === 'VERSION_CONFLICT').length, 1);
  assert.equal(ok(await h.repo.list()).tasks.length, 1);
});
test('same titles remain distinct; generated ID collision cannot overwrite data', async t => {
  const h = await harness(t);
  const first = ok(await h.repo.create(draft(), 0));
  ok(await h.repo.create(draft(), 1));
  const query = Object.assign(new TaskQuery(), { keyword: '人工' });
  assert.equal(ok(await h.repo.list(query)).tasks.length, 2);
  h.clock.fixedId = first.task.id;
  assert.equal((await h.repo.create(draft(), 2)).errorCode, 'INVALID_ARGUMENT');
  assert.equal(ok(await h.repo.list()).revision, 2);
});
test('clock rollback and task version overflow cannot rewrite audit metadata', async t => {
  const h = await harness(t); const first = ok(await h.repo.create(draft(), 0));
  h.clock.time = '2026-10-29T23:00:00Z';
  assert.equal((await h.repo.update(first.task.id, draft({title:'更新'}), 1, 1)).errorCode, 'INVALID_ARGUMENT');
  const state = ok(await h.store.read()); state.tasks[0].version = Number.MAX_SAFE_INTEGER;
  ok(await h.store.save(state, 1));
  assert.equal((await h.repo.update(first.task.id, draft({title:'更新'}), 2, Number.MAX_SAFE_INTEGER)).errorCode, 'INVALID_ARGUMENT');
});
test('references and material ownership survive update; basic delete removes owned checklist but retains notices', async t => {
  const h = await harness(t); const snapshot = new BusinessSnapshot();
  for (const sample of fixtures.samples) {
    snapshot.notices.push(structuredClone(sample.notice)); snapshot.tasks.push(structuredClone(sample.task));
    snapshot.checklistItems.push(...structuredClone(sample.checklistItems));
  }
  snapshot.availabilityBlocks = [{ id: 'available-one', marker: null }];
  ok(await h.store.save(snapshot, 0));
  const task = snapshot.tasks[0], second = snapshot.tasks[1];
  const detail = ok(await h.repo.get(task.id));
  assert.equal(detail.notices.length, 1); assert.equal(detail.checklistItems.length, 2);
  assert.equal((await h.repo.update(task.id, edit(task, { noticeIds: [] }), 1, task.version)).errorCode, 'INVALID_ARGUMENT');
  assert.equal((await h.repo.create(draft({noticeIds:['missing']}), 1)).errorCode, 'INVALID_ARGUMENT');
  const sourceTask = ok(await h.repo.create(draft({noticeIds:task.noticeIds}), 1));
  assert.equal(ok(await h.repo.get(sourceTask.task.id)).notices.length, 1);
  ok(await h.repo.delete(task.id, 2, task.version));
  const saved = ok(await h.store.read());
  assert.equal(saved.notices.length, 2);
  assert.equal(saved.checklistItems.length, 2);
  assert.ok(saved.checklistItems.every(x => x.taskId === second.id));
  assert.deepEqual(saved.availabilityBlocks, snapshot.availabilityBlocks);
});
for (const collection of ['planBlocks', 'proposals', 'operations']) {
  test('delete refuses unresolved reserved relationships: ' + collection, async t => {
    const h = await harness(t); const created = ok(await h.repo.create(draft(), 0));
    const state = ok(await h.store.read()); state[collection] = [{ taskId: created.task.id }];
    ok(await h.store.save(state, 1)); const bytes = await h.port.readText('task-store.json');
    assert.equal((await h.repo.delete(created.task.id, 2, 1)).errorCode, 'INVALID_ARGUMENT');
    assert.equal(await h.port.readText('task-store.json'), bytes);
  });
}
test('queries combine keyword/course/status with inclusive date bounds and explicit unknown handling', async t => {
  const h = await harness(t);
  ok(await h.repo.create(draft({title:'数学 A', course:'数学', deadlinePrecision:'exact', dueAt:'2026-10-30T16:30:00Z'}), 0));
  ok(await h.repo.create(draft({title:'数学 B', course:'数学', status:'in_progress', deadlinePrecision:'date_only', deadlineDate:'2026-10-31'}), 1));
  ok(await h.repo.create(draft({title:'数学 C', course:'数学'}), 2));
  const query = Object.assign(new TaskQuery(), { keyword:'数学', course:'数学', dateFrom:'2026-10-31', dateTo:'2026-10-31' });
  assert.equal(ok(await h.repo.list(query)).tasks.length, 2);
  query.timezone = 'UTC'; assert.equal(ok(await h.repo.list(query)).tasks.length, 1);
  query.includeUndated = true; assert.equal(ok(await h.repo.list(query)).tasks.length, 2);
  query.statuses = ['in_progress']; assert.equal(ok(await h.repo.list(query)).tasks.length, 1);
  query.dateFrom = '2026-11-01'; assert.equal((await h.repo.list(query)).errorCode, 'INVALID_ARGUMENT');
});
for (const point of ['write:task-store.tmp.json', 'flush:task-store.tmp.json', 'write:task-store.backup.tmp.json',
  'flush:task-store.backup.tmp.json', 'replace:task-store.backup.json', 'replace:task-store.json']) {
  test('repository returns actual failure and supports explicit retry after ' + point, async t => {
    const h = await harness(t); const created = ok(await h.repo.create(draft(), 0));
    const bytes = await h.port.readText('task-store.json'); h.port.fail = point;
    const input = draft({title:'更新候选'});
    const failed = await h.repo.update(created.task.id, input, 1, 1);
    assert.equal(failed.errorCode, 'STORAGE_FAILED'); assert.equal(failed.data, null);
    assert.equal(failed.message.includes(h.root), false);
    assert.equal(await h.port.readText('task-store.json'), bytes);
    assert.equal(ok(await h.repo.get(created.task.id)).task.version, 1);
    const retried = ok(await h.repo.update(created.task.id, input, 1, 1));
    assert.equal(retried.revision, 2); assert.equal(retried.task.version, 2);
  });
}
test('failed delete leaves task and related state present', async t => {
  const h = await harness(t); const created = ok(await h.repo.create(draft(), 0));
  h.port.fail = 'replace:task-store.json';
  assert.equal((await h.repo.delete(created.task.id, 1, 1)).errorCode, 'STORAGE_FAILED');
  assert.equal(ok(await h.repo.get(created.task.id)).task.id, created.task.id);
});
test('impossible legacy date is preserved and reported as CORRUPT_DATA rather than normalized', async t => {
  const h = await harness(t); ok(await h.repo.create(draft({deadlinePrecision:'date_only', deadlineDate:'2026-10-30'}), 0));
  const saved = JSON.parse(await h.port.readText('task-store.json')); saved.tasks[0].deadlineDate = '2026-02-30';
  const bytes = JSON.stringify(saved); await fs.writeFile(h.port.target('task-store.json'), bytes);
  assert.equal((await h.repo.list()).errorCode, 'CORRUPT_DATA');
  assert.equal((await h.repo.create(draft(), 1)).errorCode, 'CORRUPT_DATA');
  assert.equal(await h.port.readText('task-store.json'), bytes);
});
test('unknown schema remains unsupported, with no recovery or initialization hidden in CRUD', async t => {
  const h = await harness(t); await h.port.ensureDirectory('');
  const state = new BusinessSnapshot(); state.schemaVersion = 99;
  const bytes = JSON.stringify(state); await h.port.writeText('task-store.json', bytes);
  assert.equal((await h.repo.create(draft(), 0)).errorCode, 'UNSUPPORTED_SCHEMA');
  assert.equal(await h.port.readText('task-store.json'), bytes);
});
test('synthetic device probe exercises real host file operations and can be reopened', async t => {
  const h = await harness(t); const report = await writeTaskProbe(h.port);
  assert.equal(report.revision, 7); assert.equal(report.tasks.length, 2);
  const reopened = await readTaskProbe(new HostPort(h.root));
  assert.equal(reopened.checks.length, report.checks.length + 1);
  assert.deepEqual(reopened.tasks, report.tasks);
});
