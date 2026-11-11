const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CommitServices } = require('../../client/entry/src/main/ets/data/CommitServices.ts');
const { ProposalDraft, TaskChangeDraft, ConfirmedCommitRequest } = require('../../client/entry/src/main/ets/domain/CommitModels.ts');
const { TaskDraft } = require('../../client/entry/src/main/ets/domain/TaskContracts.ts');
const { LocalStore } = require('../../client/entry/src/main/ets/data/LocalStore.ts');
const { TaskRepository } = require('../../client/entry/src/main/ets/data/TaskRepository.ts');
const { StorageCoordinator } = require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const { BusinessSnapshotCodec } = require('../../client/entry/src/main/ets/data/storage/SnapshotCodecs.ts');
const { BusinessSnapshot } = require('../../client/entry/src/main/ets/domain/StorageModels.ts');
const { createHash } = require('node:crypto');
const runtimeRoot = path.resolve(__dirname, '../../runtime/t16-host-tests');

class Files {
  constructor(root) { this.root = root; this.fail = ''; this.afterReplace = false; this.trace = []; }
  target(name) {
    const target = path.resolve(this.root, name);
    assert.ok(target === this.root || target.startsWith(this.root + path.sep));
    return target;
  }
  check(operation, name) {
    const key = operation + ':' + name; this.trace.push(key);
    if (key === this.fail) { this.fail = ''; throw new Error('Private artificial file failure'); }
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
    if (destination === 'task-store.json' && this.afterReplace) { this.afterReplace = false; throw new Error('Lost replacement acknowledgement'); }
  }
  async listNames(name) { this.check('list', name); return fs.readdir(this.target(name)); }
}
class Clock {
  constructor() { this.id = 0; this.time = '2026-11-11T10:00:00+08:00'; }
  nextId() { return 'host-' + ++this.id; }
  now() { return this.time; }
}
const ok = response => { assert.equal(response.success, true, response.message); assert.notEqual(response.data, null); return response.data; };
const bad = (response, code) => { assert.equal(response.success, false); assert.equal(response.errorCode, code); assert.equal(response.data, null); };
function draft(revision = 0, overrides = {}) {
  const proposal = new ProposalDraft(); proposal.sessionId = 'session-artificial'; proposal.expectedRevision = revision;
  const change = new TaskChangeDraft(); change.draft.title = 'T16 人工任务 🗓️';
  proposal.changes = [change]; return Object.assign(proposal, overrides);
}
function edit(task, changes) {
  const change = new TaskChangeDraft(); change.action = 'update'; change.taskId = task.id; change.expectedVersion = task.version;
  const fields = new TaskDraft(); for (const key of Object.keys(fields)) fields[key] = structuredClone(task[key]);
  change.draft = Object.assign(fields, changes); return change;
}
async function harness(t) {
  await fs.mkdir(runtimeRoot, { recursive: true }); const root = await fs.mkdtemp(path.join(runtimeRoot, 'case-'));
  const files = new Files(root), clock = new Clock(), coordinator = new StorageCoordinator(files), store = new LocalStore(coordinator);
  const services = new CommitServices(store, clock), tasks = new TaskRepository(store, clock);
  t.after(async () => { assert.ok(root.startsWith(runtimeRoot + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return { root, files, clock, store, services, tasks, reopen: () => new CommitServices(new LocalStore(new StorageCoordinator(files)), clock) };
}
async function staged(h, input = draft()) { return ok(await h.services.proposals.stage(input)); }
async function confirmed(h, proposal) { return ok(await h.services.confirmation.confirm(proposal.id, proposal.expectedRevision)); }
async function applied(h, input = draft()) { const proposal = await staged(h, input), request = await confirmed(h, proposal); return { proposal, request, receipt: ok(await h.services.confirmation.apply(request)) }; }
async function bytes(h) { return fs.readFile(path.join(h.root, 'task-store.json'), 'utf8'); }

test('staging writes only a pending proposal and reserves IDs; task/source not yet formal', async t => {
  const h = await harness(t), p = await staged(h); const s = ok(await h.store.read());
  assert.equal(s.revision, 1); assert.equal(p.expectedRevision, 1); assert.equal(s.tasks.length, 0);
  assert.equal(s.operations.length, 0); assert.equal(p.state, 'pending'); assert.equal(p.operationId, null);
  assert.equal(p.changes[0].before, null); assert.ok(p.changes[0].taskId.startsWith('task-'));
});
test('fake confirmation flags or operation IDs do not grant authority', async t => {
  const h = await harness(t), p = await staged(h), before = await bytes(h);
  bad(await h.services.confirmation.apply({ proposalId: p.id, operationId: 'operation-fake', expectedRevision: 1, confirmed: true }), 'INVALID_ARGUMENT');
  bad(await h.services.confirmation.apply({ proposalId: p.id, operationId: 'operation-fake', expectedRevision: 1 }), 'CONFIRMATION_REQUIRED');
  assert.equal(await bytes(h), before); assert.equal(typeof h.services.proposals.confirm, 'undefined');
  assert.equal(typeof h.services.proposals.apply, 'undefined');
});
test('client confirmation performs no file write and captures an immutable request', async t => {
  const h = await harness(t), p = await staged(h), before = await bytes(h);
  const request = await confirmed(h, p); request.operationId = 'operation-edited';
  bad(await h.services.confirmation.apply(request), 'CONFIRMATION_REQUIRED');
  assert.equal(await bytes(h), before); assert.notEqual((await confirmed(h, p)).operationId, request.operationId);
});
test('concurrent confirm and repeated apply commit once with one durable operation', async t => {
  const h = await harness(t), p = await staged(h);
  const requests = await Promise.all(Array.from({ length: 5 }, () => confirmed(h, p)));
  assert.ok(requests.every(r => r.operationId === requests[0].operationId));
  const results = await Promise.all(requests.map(r => h.services.confirmation.apply(r)));
  const receipt = ok(results[0]); for (const response of results) assert.deepEqual(ok(response), receipt);
  const s = ok(await h.store.read()); assert.equal(s.revision, 2); assert.equal(s.tasks.length, 1); assert.equal(s.operations.length, 1);
  assert.equal(s.proposals[0].state, 'applied'); assert.equal(receipt.committedRevision, 2);
  assert.deepEqual(receipt.affectedTaskIds, [s.tasks[0].id]);
});
test('restart and later unrelated changes return original receipt without writing', async t => {
  const h = await harness(t), { proposal, request, receipt } = await applied(h);
  ok(await h.tasks.create(Object.assign(new TaskDraft(), { title: 'other' }), 2));
  const before = await bytes(h), names = await fs.readdir(h.root), reopened = h.reopen();
  assert.deepEqual(ok(await reopened.confirmation.apply(request)), receipt);
  assert.deepEqual(ok(await reopened.confirmation.receipt(request.operationId)), receipt);
  assert.deepEqual(ok(await reopened.confirmation.confirm(proposal.id, proposal.expectedRevision)), request);
  assert.equal(await bytes(h), before); assert.deepEqual(await fs.readdir(h.root), names);
});
test('return values cannot mutate durable history or authority', async t => {
  const h = await harness(t), { request, receipt } = await applied(h); receipt.tasks[0].title = 'tampered';
  assert.notEqual(ok(await h.services.confirmation.apply(request)).tasks[0].title, 'tampered');
});
test('operation ID cannot be rebound to a different proposal or revision', async t => {
  const h = await harness(t), { request } = await applied(h), before = await bytes(h);
  bad(await h.services.confirmation.apply({ ...request, proposalId: 'proposal-another' }), 'INVALID_ARGUMENT');
  bad(await h.services.confirmation.apply({ ...request, expectedRevision: 2 }), 'INVALID_ARGUMENT');
  assert.equal(await bytes(h), before);
});
test('uncommitted authorization is lost on restart and never auto-executes', async t => {
  const h = await harness(t), p = await staged(h), request = await confirmed(h, p), reopened = h.reopen(), before = await bytes(h);
  bad(await reopened.confirmation.apply(request), 'CONFIRMATION_REQUIRED');
  assert.equal(ok(await reopened.proposals.get(p.id)).state, 'pending'); assert.equal(await bytes(h), before);
  const newlyConfirmed = ok(await reopened.confirmation.confirm(p.id, 1));
  assert.notEqual(newlyConfirmed.operationId, request.operationId); ok(await reopened.confirmation.apply(newlyConfirmed));
});
test('cancelled proposal never creates tasks; cancel is idempotent and revokes old grant', async t => {
  const h = await harness(t), p = await staged(h), request = await confirmed(h, p);
  assert.equal(ok(await h.services.confirmation.cancel(p.id, 1)).state, 'cancelled');
  const before = await bytes(h); ok(await h.services.confirmation.cancel(p.id, 2)); assert.equal(await bytes(h), before);
  bad(await h.services.confirmation.apply(request), 'PROPOSAL_CANCELLED');
  bad(await h.services.confirmation.confirm(p.id, 1), 'PROPOSAL_CANCELLED');
  assert.equal(ok(await h.store.read()).tasks.length, 0);
});
test('apply/cancel race has one successful state transition and no partial writes', async t => {
  const h = await harness(t), p = await staged(h), request = await confirmed(h, p);
  const results = await Promise.all([h.services.confirmation.apply(request), h.services.confirmation.cancel(p.id, 1)]);
  assert.equal(results.filter(x => x.success).length, 1);
  const s = ok(await h.store.read()); assert.equal(s.revision, 2);
  assert.equal(s.operations.length, s.tasks.length); assert.ok([0, 1].includes(s.tasks.length));
});
test('manual edits stale a confirmed proposal without silent rebase', async t => {
  const h = await harness(t), first = await applied(h), task = first.receipt.tasks[0];
  const p = await staged(h, draft(2, { changes: [edit(task, { title: 'candidate' })] }));
  const request = await confirmed(h, p); ok(await h.tasks.update(task.id, Object.assign(new TaskDraft(), { title: 'manual' }), 3, 1));
  const before = await bytes(h); bad(await h.services.confirmation.apply(request), 'VERSION_CONFLICT');
  bad(await h.services.confirmation.confirm(p.id, 4), 'VERSION_CONFLICT'); assert.equal(await bytes(h), before);
  const current = ok(await h.tasks.get(task.id));
  const replacement = await applied(h, draft(4, { changes: [edit(current.task, { title: 'reviewed again' })] }));
  assert.equal(replacement.receipt.tasks[0].version, 3); assert.equal(replacement.receipt.tasks[0].title, 'reviewed again');
});
test('staging another proposal conservatively stales the previous one', async t => {
  const h = await harness(t), p = await staged(h); await staged(h, draft(1)); const before = await bytes(h);
  bad(await h.services.confirmation.confirm(p.id, 1), 'VERSION_CONFLICT');
  bad(await h.services.confirmation.confirm(p.id, 2), 'VERSION_CONFLICT');
  ok(await h.services.confirmation.cancel(p.id, 2)); assert.notEqual(await bytes(h), before);
});
test('batch update and create atomically commit notices, tasks, proposal and receipt', async t => {
  const h = await harness(t), old = (await applied(h)).receipt.tasks[0], input = draft(2);
  const raw = '人工通知：请提交材料';
  input.notices = [{ id: '通知 来源', rawText: raw, sourceLabel: null, publishedAt: null,
    importedAt: h.clock.time, timezone: 'Asia/Shanghai', contentHash: createHash('sha256').update(raw).digest('hex') }];
  input.changes[0].draft.noticeIds = ['通知 来源']; input.changes.unshift(edit(old, { remainingMinutes: 0, title: 'updated' }));
  const p = await staged(h, input), before = ok(await h.store.read());
  assert.equal(before.notices.length, 0); assert.equal(before.tasks.length, 1);
  const receipt = ok(await h.services.confirmation.apply(await confirmed(h, p))), s = ok(await h.store.read());
  assert.equal(s.revision, 4); assert.equal(s.notices.length, 1); assert.equal(s.tasks.length, 2); assert.equal(s.operations.length, 2);
  assert.equal(receipt.tasks[0].version, 2); assert.equal(receipt.tasks[0].remainingMinutes, 0);
  assert.equal(receipt.tasks[0].createdAt, old.createdAt); assert.equal(receipt.tasks[1].noticeIds[0], input.notices[0].id);
  assert.deepEqual(receipt.changedTaskIds, receipt.affectedTaskIds);
  const backup = JSON.parse(await fs.readFile(path.join(h.root, 'task-store.backup.json'), 'utf8'));
  assert.equal(backup.revision, 3); assert.equal(backup.notices.length, 0); assert.equal(backup.proposals[1].state, 'pending');
});
test('no-op edit records the operation once without bumping Task.version', async t => {
  const h = await harness(t), task = (await applied(h)).receipt.tasks[0];
  const result = await applied(h, draft(2, { changes: [edit(task, {})] }));
  assert.equal(result.receipt.committedRevision, 4); assert.deepEqual(result.receipt.changedTaskIds, []);
  assert.deepEqual(result.receipt.tasks, [task]);
});
for (const operation of ['write:task-store.tmp.json', 'flush:task-store.tmp.json', 'read:task-store.tmp.json',
  'write:task-store.backup.tmp.json', 'flush:task-store.backup.tmp.json', 'replace:task-store.backup.json', 'replace:task-store.json']) {
  test('real file failure is atomic and same operation explicitly retries: ' + operation, async t => {
    const h = await harness(t), p = await staged(h), request = await confirmed(h, p), before = await bytes(h);
    h.files.fail = operation; bad(await h.services.confirmation.apply(request), 'STORAGE_FAILED');
    assert.equal(await bytes(h), before); const snapshot = ok(await h.store.read());
    assert.equal(snapshot.tasks.length, 0); assert.equal(snapshot.operations.length, 0); assert.equal(snapshot.proposals[0].state, 'pending');
    const receipt = ok(await h.services.confirmation.apply(request)); assert.equal(receipt.operationId, request.operationId);
    assert.equal(receipt.committedRevision, 2); assert.equal(ok(await h.store.read()).tasks.length, 1);
  });
}
test('lost replace acknowledgement reads the durable receipt rather than committing again', async t => {
  const h = await harness(t), p = await staged(h), request = await confirmed(h, p);
  h.files.afterReplace = true; const receipt = ok(await h.services.confirmation.apply(request));
  assert.equal(receipt.committedRevision, 2); const before = await bytes(h);
  assert.deepEqual(ok(await h.reopen().confirmation.apply(request)), receipt); assert.equal(await bytes(h), before);
});
test('uncertain replace plus failed readback preserves operation for later read-only recovery', async t => {
  const h = await harness(t), p = await staged(h), request = await confirmed(h, p);
  const replace = h.files.replace.bind(h.files);
  h.files.replace = async (source, destination) => {
    await replace(source, destination);
    if (destination === 'task-store.json') { h.files.fail = 'read:task-store.json'; throw new Error('Uncertain native response'); }
  };
  const uncertain = await h.services.confirmation.apply(request); bad(uncertain, 'STORAGE_FAILED');
  assert.match(uncertain.message, /未获确认/); const before = await bytes(h);
  const receipt = ok(await h.reopen().confirmation.apply(request)); assert.equal(receipt.committedRevision, 2);
  assert.equal(ok(await h.store.read()).tasks.length, 1); assert.equal(await bytes(h), before);
});
test('failed first staging leaves tmp-only recovery required instead of promoting it', async t => {
  const h = await harness(t); h.files.fail = 'replace:task-store.json'; bad(await h.services.proposals.stage(draft()), 'STORAGE_FAILED');
  bad(await h.reopen().proposals.stage(draft()), 'RECOVERY_REQUIRED');
  await assert.rejects(fs.stat(path.join(h.root, 'task-store.json')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(path.join(h.root, 'task-store.tmp.json'), 'utf8')).tasks.length, 0);
});
test('legacy reserved JSON and unrelated business fields survive', async t => {
  const h = await harness(t), snapshot = new BusinessSnapshot();
  snapshot.operations.push({ legacy: true }); snapshot.proposals.push({ id: 'old', other: '保留' });
  snapshot.planBlocks.push({ future: [0, false, null] }); snapshot.availabilityBlocks.push({ untouched: true }); snapshot.extra = { future: true };
  ok(await h.store.save(snapshot, 0)); const { receipt } = await applied(h, draft(1)); const saved = ok(await h.store.read());
  assert.equal(receipt.committedRevision, 3); assert.deepEqual(saved.operations[0], snapshot.operations[0]);
  assert.deepEqual(saved.proposals[0], snapshot.proposals[0]); assert.deepEqual(saved.planBlocks, snapshot.planBlocks);
  assert.deepEqual(saved.extra, snapshot.extra); bad(await h.services.proposals.get('old'), 'UNSUPPORTED_SCHEMA');
});
test('existing T14 delete guard remains explicit after operation records exist', async t => {
  const h = await harness(t), { receipt } = await applied(h), before = await bytes(h);
  bad(await h.tasks.delete(receipt.tasks[0].id, 2, 1), 'INVALID_ARGUMENT'); assert.equal(await bytes(h), before);
});
const invalidDrafts = [
  ['empty changes', p => p.changes = []], ['invalid date', p => { p.changes[0].draft.deadlinePrecision = 'date_only'; p.changes[0].draft.deadlineDate = '2027-02-29'; }],
  ['delete deferred', p => p.changes[0].action = 'delete'], ['missing sources', p => p.changes[0].draft.noticeIds = ['missing']],
  ['forced create ID', p => p.changes[0].taskId = 'task-forced'], ['forced version', p => p.changes[0].expectedVersion = 1],
  ['invalid revision', p => p.expectedRevision = -1], ['unbounded number', p => p.changes[0].draft.remainingMinutes = Infinity],
  ['undefined', p => p.changes[0].draft.title = undefined], ['invalid session', p => p.sessionId = '../escape'],
  ['missing task', p => { p.changes[0].action = 'update'; p.changes[0].taskId = 'missing'; p.changes[0].expectedVersion = 1; }],
];
for (const [name, mutate] of invalidDrafts) test('invalid staging does not create formal files: ' + name, async t => {
  const h = await harness(t), input = draft(); mutate(input); const result = await h.services.proposals.stage(input);
  assert.equal(result.success, false); assert.equal(result.errorCode, name === 'missing task' ? 'NOT_FOUND' : 'INVALID_ARGUMENT');
  assert.deepEqual(await fs.readdir(h.root), []);
});
test('caller mutations after stage/apply entry cannot alter the saved candidate', async t => {
  const h = await harness(t), input = draft(), staging = h.services.proposals.stage(input); input.changes[0].draft.title = 'late';
  const p = ok(await staging); assert.notEqual(p.changes[0].draft.title, 'late'); const request = await confirmed(h, p);
  const applying = h.services.confirmation.apply(request); request.expectedRevision = 999;
  assert.equal(ok(await applying).committedRevision, 2);
});
for (const [name, mutate] of [
  ['proposal state', s => s.proposals[0].state = 'fake'], ['operation link', s => s.operations[0].proposalId = 'another'],
  ['duplicate receipt', s => s.operations.push(structuredClone(s.operations[0]))], ['receipt version', s => s.operations[0].committedRevision = 99],
  ['malformed change', s => s.proposals[0].changes = [null]], ['applied without receipt', s => s.operations = []],
]) test('corrupt tagged business record is preserved: ' + name, async t => {
  const h = await harness(t); await applied(h); const data = JSON.parse(await bytes(h)); mutate(data);
  const raw = JSON.stringify(data); await fs.writeFile(path.join(h.root, 'task-store.json'), raw);
  bad(await h.reopen().proposals.list(), 'CORRUPT_DATA'); assert.equal(await bytes(h), raw);
});
test('unknown tagged schema is refused without erasing records', async t => {
  const h = await harness(t), p = await staged(h), data = JSON.parse(await bytes(h)); data.proposals[0].recordType = 't16.proposal.v2';
  const raw = JSON.stringify(data); await fs.writeFile(path.join(h.root, 'task-store.json'), raw);
  bad(await h.reopen().proposals.get(p.id), 'UNSUPPORTED_SCHEMA'); assert.equal(await bytes(h), raw);
});
test('clock rollback, conflicting expected task version and duplicate targets do not commit', async t => {
  const h = await harness(t), task = (await applied(h)).receipt.tasks[0], before = await bytes(h);
  const wrong = edit(task, { title: 'new' }); wrong.expectedVersion = 99;
  bad(await h.services.proposals.stage(draft(2, { changes: [wrong] })), 'VERSION_CONFLICT');
  bad(await h.services.proposals.stage(draft(2, { changes: [edit(task, {}), edit(task, {})] })), 'INVALID_ARGUMENT');
  assert.equal(await bytes(h), before); const p = await staged(h, draft(2)); h.clock.time = '2026-11-10T00:00:00Z';
  bad(await h.services.confirmation.confirm(p.id, 3), 'INVALID_ARGUMENT');
});

test('device probe stages, explicitly confirms, retries real failure and reads with a new owner', async t => {
  const { stageCommitProbe, confirmCommitProbe, readCommitProbe } = require('../../client/entry/src/main/ets/data/diagnostics/CommitProbe.ts');
  const h = await harness(t); const staged = await stageCommitProbe(h.files);
  assert.equal(staged.revision, 1); assert.equal(staged.phase, 'pending');
  const initial = await bytes(h); const pending = await readCommitProbe(h.files);
  assert.equal(pending.phase, 'pending'); assert.equal(await bytes(h), initial);
  const applied = await confirmCommitProbe(h.files); assert.equal(applied.revision, 3);
  assert.equal(applied.receipt.committedRevision, 2); const before = await bytes(h);
  const read = await readCommitProbe(h.files); assert.equal(read.phase, 'applied'); assert.equal(await bytes(h), before);
});
test('device probe cancellation survives reopening without creating tasks', async t => {
  const { stageCommitProbe, cancelCommitProbe, readCommitProbe } = require('../../client/entry/src/main/ets/data/diagnostics/CommitProbe.ts');
  const h = await harness(t); await stageCommitProbe(h.files); const cancelled = await cancelCommitProbe(h.files);
  assert.equal(cancelled.phase, 'cancelled'); const before = await bytes(h);
  assert.equal((await readCommitProbe(h.files)).phase, 'cancelled'); assert.equal(await bytes(h), before);
});
test('old task IDs containing Unicode remain editable through T16', async t => {
  const h = await harness(t), task = (await applied(h)).receipt.tasks[0];
  const snapshot = ok(await h.store.read()); snapshot.tasks[0].id = '旧任务 ID';
  ok(await h.store.save(snapshot, 2)); const current = ok(await h.tasks.get('旧任务 ID')).task;
  const { receipt } = await applied(h, draft(3, { changes: [edit(current, { title: '兼容编辑' })] }));
  assert.equal(receipt.tasks[0].id, '旧任务 ID'); assert.equal(receipt.tasks[0].version, 2);
});
test('existing checklist source cannot be removed by a proposal', async t => {
  const h = await harness(t), input = draft(); const raw = 'source';
  input.notices.push({ id: 'source', rawText: raw, sourceLabel: null, publishedAt: null, importedAt: h.clock.time,
    timezone: 'Asia/Shanghai', contentHash: createHash('sha256').update(raw).digest('hex') });
  input.changes[0].draft.noticeIds = ['source']; const task = (await applied(h, input)).receipt.tasks[0];
  const snapshot = ok(await h.store.read()); snapshot.checklistItems.push({ id: 'item', taskId: task.id, label: '材料',
    state: 'pending', sourceNoticeId: 'source', confirmedAt: null }); ok(await h.store.save(snapshot, 2));
  const before = await bytes(h); bad(await h.services.proposals.stage(draft(3, { changes: [edit(task, { noticeIds: [] })] })), 'INVALID_ARGUMENT');
  assert.equal(await bytes(h), before);
});
for (const [name, mutate] of [
  ['receipt text', s => s.operations[0].tasks[0].title = '伪造'],
  ['false change marker', s => s.operations[0].changedTaskIds = []],
  ['creation version', s => s.operations[0].tasks[0].version = 2],
  ['confirmation time', s => s.operations[0].confirmedAt = '2026-11-10T00:00:00Z'],
]) test('receipt must match confirmed content and audit: ' + name, async t => {
  const h = await harness(t); await applied(h); const data = JSON.parse(await bytes(h)); mutate(data);
  const raw = JSON.stringify(data); await fs.writeFile(path.join(h.root, 'task-store.json'), raw);
  bad(await h.reopen().proposals.list(), 'CORRUPT_DATA'); assert.equal(await bytes(h), raw);
});
test('same operation with appended new changes is rejected rather than silently treated as new work', async t => {
  const h = await harness(t), { request } = await applied(h), before = await bytes(h);
  bad(await h.services.confirmation.apply({ ...request, changes: [{ title: 'different' }] }), 'INVALID_ARGUMENT');
  assert.equal(await bytes(h), before);
});
test('ID generation collisions cannot replace a saved operation or proposal', async t => {
  const h = await harness(t), { receipt } = await applied(h); h.clock.nextId = () => receipt.operationId.slice('operation-'.length);
  const p = await staged(h, draft(2)); const before = await bytes(h);
  bad(await h.services.confirmation.confirm(p.id, 3), 'INVALID_ARGUMENT'); assert.equal(await bytes(h), before);
});
