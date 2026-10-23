const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StorageCoordinator } = require('../../client/entry/src/main/ets/data/storage/StorageCoordinator.ts');
const { LocalStore } = require('../../client/entry/src/main/ets/data/LocalStore.ts');
const { SessionStore } = require('../../client/entry/src/main/ets/data/SessionStore.ts');
const { BusinessSnapshot, SessionDocument } = require('../../client/entry/src/main/ets/domain/StorageModels.ts');
const fixture = require('../../fixtures/task-samples.json');

const runtimeRoot = path.resolve(__dirname, '../../runtime/t08-host-tests');
class HostFiles {
  constructor(root) { this.root = root; this.failNext = ''; this.shortNext = ''; this.trace = []; }
  target(name) {
    const target = path.resolve(this.root, name);
    assert.ok(target === this.root || target.startsWith(this.root + path.sep));
    return target;
  }
  checkpoint(operation, name) {
    const key = operation + ':' + name;
    this.trace.push(key);
    if (this.failNext === key) {
      this.failNext = '';
      throw new Error('Injected platform error: private path must not escape');
    }
  }
  async ensureDirectory(name) {
    this.checkpoint('mkdir', name);
    await fs.mkdir(this.target(name), { recursive: true });
  }
  async exists(name) {
    this.checkpoint('exists', name);
    try { await fs.stat(this.target(name)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async readText(name) { this.checkpoint('read', name); return fs.readFile(this.target(name), 'utf8'); }
  async writeText(name, text) {
    this.checkpoint('write', name);
    const file = await fs.open(this.target(name), 'w');
    try {
      if (this.shortNext === name) { this.shortNext = ''; await file.writeFile(text.slice(0, 8), 'utf8'); }
      else await file.writeFile(text, 'utf8');
      this.checkpoint('flush', name);
      await file.sync();
    } finally { await file.close(); }
  }
  async replace(source, destination) {
    assert.equal(path.dirname(source), path.dirname(destination));
    this.checkpoint('replace', destination);
    await fs.rename(this.target(source), this.target(destination));
  }
  async listNames(directory) { this.checkpoint('list', directory); return fs.readdir(this.target(directory)); }
}

async function harness(t) {
  await fs.mkdir(runtimeRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(runtimeRoot, 'case-'));
  const files = new HostFiles(directory);
  t.after(async () => {
    // Recursive cleanup is restricted to this test's verified workspace child.
    assert.ok(path.resolve(directory).startsWith(runtimeRoot + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { files, coordinator: new StorageCoordinator(files), directory };
}
function sampleSnapshot() {
  const value = new BusinessSnapshot();
  for (const sample of fixture.samples) {
    value.notices.push(structuredClone(sample.notice));
    value.tasks.push(structuredClone(sample.task));
    value.checklistItems.push(...structuredClone(sample.checklistItems));
  }
  return value;
}
function sessionDocument(id = 'session-one') {
  const session = { id, title: '中文会话 🗓️', createdAt: '2026-10-23T10:00:00+08:00',
    updatedAt: '2026-10-23T10:01:00+08:00', pendingProposalId: null };
  const value = new SessionDocument(session);
  value.messages.push({ id: 'message-one', sessionId: id, role: 'user', text: '周五交，但没有确切时刻。',
    toolName: null, toolResultSummary: null, status: 'completed', createdAt: session.createdAt });
  return value;
}
async function seed(coordinator) {
  const store = new LocalStore(coordinator);
  const result = await store.save(sampleSnapshot(), 0);
  assert.equal(result.success, true, result.message);
  return { store, saved: result.data };
}

test('fresh directory returns a valid empty snapshot without fabricated records', async t => {
  const h = await harness(t);
  const result = await new LocalStore(h.coordinator).read();
  assert.equal(result.success, true);
  assert.equal(result.data.revision, 0);
  assert.deepEqual(result.data.tasks, []);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('real host files round-trip T03 Chinese, null, references and both date precisions', async t => {
  const h = await harness(t);
  const { saved } = await seed(h.coordinator);
  const reopened = await new LocalStore(new StorageCoordinator(new HostFiles(h.directory))).read();
  assert.deepEqual(reopened.data, saved);
  assert.equal(reopened.data.tasks[0].deadlineDate, null);
  assert.equal(reopened.data.tasks[1].dueAt, null);
  assert.equal(reopened.data.tasks[1].deadlineDate, '2026-11-08');
});

test('second commit keeps exactly the previous valid snapshot in backup', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  const next = structuredClone(saved);
  next.tasks[0].title = '第二次修改';
  const result = await store.save(next, 1);
  assert.equal(result.data.revision, 2);
  assert.deepEqual(JSON.parse(await h.files.readText('task-store.backup.json')), saved);
});

for (const checkpoint of ['write:task-store.tmp.json', 'flush:task-store.tmp.json',
  'write:task-store.backup.tmp.json', 'flush:task-store.backup.tmp.json',
  'replace:task-store.backup.json', 'replace:task-store.json']) {
  test('pre-commit fault preserves primary and queue remains usable: ' + checkpoint, async t => {
    const h = await harness(t);
    const { store, saved } = await seed(h.coordinator);
    const primary = await h.files.readText('task-store.json');
    h.files.failNext = checkpoint;
    const result = await store.save(saved, 1);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'STORAGE_FAILED');
    assert.equal(result.data, null);
    assert.equal(await h.files.readText('task-store.json'), primary);
    assert.equal((await store.save(saved, 1)).success, true);
  });
}

test('short write is rejected by exact readback before primary replacement', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  h.files.shortNext = 'task-store.tmp.json';
  const result = await store.save(saved, 1);
  assert.equal(result.errorCode, 'STORAGE_FAILED');
  assert.deepEqual((await store.read()).data, saved);
});

test('concurrent confirmations with the same revision yield one commit and one conflict', async t => {
  const h = await harness(t);
  const store = new LocalStore(h.coordinator);
  const result = await Promise.all([store.save(sampleSnapshot(), 0), store.save(sampleSnapshot(), 0)]);
  assert.equal(result.filter(value => value.success).length, 1);
  assert.equal(result.filter(value => value.errorCode === 'VERSION_CONFLICT').length, 1);
  assert.equal((await store.read()).data.revision, 1);
});

test('save captures the input before queue wait and read results do not alias storage', async t => {
  const h = await harness(t);
  const store = new LocalStore(h.coordinator);
  const candidate = sampleSnapshot();
  const pending = store.save(candidate, 0);
  candidate.tasks[0].title = 'must not be saved';
  const saved = (await pending).data;
  assert.notEqual(saved.tasks[0].title, candidate.tasks[0].title);
  saved.tasks[0].title = 'must not mutate disk';
  assert.notEqual((await store.read()).data.tasks[0].title, saved.tasks[0].title);
});

test('invalid candidate and mismatched expectedRevision do not create files', async t => {
  const h = await harness(t);
  const store = new LocalStore(h.coordinator);
  const candidate = sampleSnapshot();
  candidate.tasks[0].noticeIds = ['absent-notice'];
  assert.equal((await store.save(candidate, 0)).errorCode, 'INVALID_ARGUMENT');
  assert.equal((await store.save(sampleSnapshot(), 1)).errorCode, 'INVALID_ARGUMENT');
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('platform read error is not reported as an empty installation and is sanitized', async t => {
  const h = await harness(t);
  const { store } = await seed(h.coordinator);
  h.files.failNext = 'read:task-store.json';
  const result = await store.read();
  assert.equal(result.success, false);
  assert.equal(result.data, null);
  assert.equal(result.errorCode, 'STORAGE_FAILED');
  assert.ok(!result.message.includes('private path'));
});

test('existence-check I/O error never initializes a fresh store', async t => {
  const h = await harness(t);
  h.files.failNext = 'exists:task-store.json';
  const result = await new LocalStore(h.coordinator).read();
  assert.equal(result.errorCode, 'STORAGE_FAILED');
  assert.equal(result.data, null);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('corrupt primary requires explicit recovery, preserves original bytes and restores previous revision', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  assert.equal((await store.save(saved, 1)).success, true);
  const damaged = '{ damaged 中文';
  await h.files.writeText('task-store.json', damaged);
  assert.equal((await store.read()).errorCode, 'CORRUPT_DATA');
  assert.equal(await h.files.readText('task-store.json'), damaged);
  const result = await store.recoverBackup();
  assert.deepEqual(result.data, saved);
  assert.equal(await h.files.readText('task-store.corrupt-0.json'), damaged);
  assert.deepEqual((await store.read()).data, saved);
});

test('unknown schema is preserved and recovery cannot silently downgrade it', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  await store.save(saved, 1);
  const future = JSON.stringify({ ...saved, schemaVersion: 2 });
  await h.files.writeText('task-store.json', future);
  assert.equal((await store.read()).errorCode, 'UNSUPPORTED_SCHEMA');
  assert.equal((await store.recoverBackup()).errorCode, 'UNSUPPORTED_SCHEMA');
  assert.equal(await h.files.readText('task-store.json'), future);
});

test('missing primary with a backup is not fresh, and explicit recovery works', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  await store.save(saved, 1);
  await fs.unlink(h.files.target('task-store.json'));
  assert.equal((await store.read()).errorCode, 'RECOVERY_REQUIRED');
  assert.deepEqual((await store.recoverBackup()).data, saved);
});

test('tmp-only data is never promoted or overwritten, including after first-save failure', async t => {
  const h = await harness(t);
  h.files.failNext = 'replace:task-store.json';
  assert.equal((await new LocalStore(h.coordinator).save(sampleSnapshot(), 0)).success, false);
  const residual = await h.files.readText('task-store.tmp.json');
  const reopened = new LocalStore(new StorageCoordinator(new HostFiles(h.directory)));
  assert.equal((await reopened.read()).errorCode, 'RECOVERY_REQUIRED');
  assert.equal((await reopened.save(sampleSnapshot(), 0)).errorCode, 'RECOVERY_REQUIRED');
  assert.equal(await h.files.readText('task-store.tmp.json'), residual);
  assert.equal(await h.files.exists('task-store.json'), false);
});

test('corrupt backup or failed archive does not destroy damaged primary', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  await store.save(saved, 1);
  await h.files.writeText('task-store.json', '{bad-main');
  h.files.failNext = 'write:task-store.corrupt-0.json';
  assert.equal((await store.recoverBackup()).success, false);
  assert.equal(await h.files.readText('task-store.json'), '{bad-main');
  await h.files.writeText('task-store.backup.json', '{bad-backup');
  assert.equal((await store.recoverBackup()).errorCode, 'CORRUPT_DATA');
  assert.equal(await h.files.readText('task-store.json'), '{bad-main');
});

test('healthy primary cannot be rolled back with the recovery API', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  await store.save(saved, 1);
  assert.equal((await store.recoverBackup()).errorCode, 'INVALID_ARGUMENT');
  assert.equal((await store.read()).data.revision, 2);
});

test('failed recovery replacement preserves primary, backup and previous corruption archives', async t => {
  const h = await harness(t);
  const { store, saved } = await seed(h.coordinator);
  await store.save(saved, 1);
  await h.files.writeText('task-store.json', '{damaged');
  h.files.failNext = 'replace:task-store.json';
  assert.equal((await store.recoverBackup()).errorCode, 'STORAGE_FAILED');
  assert.equal(await h.files.readText('task-store.json'), '{damaged');
  assert.deepEqual(JSON.parse(await h.files.readText('task-store.backup.json')), saved);
  assert.equal((await store.recoverBackup()).success, true);
  assert.equal(await h.files.readText('task-store.corrupt-0.json'), '{damaged');
  assert.equal(await h.files.readText('task-store.corrupt-1.json'), '{damaged');
});

test('future JSON fields survive snapshot read/write instead of being projected away', async t => {
  const h = await harness(t);
  const store = new LocalStore(h.coordinator);
  const value = sampleSnapshot();
  value.futureField = { marker: '保留' };
  value.tasks[0].futureTaskField = null;
  value.availabilityBlocks.push({ id: 'available-one', startAt: 'future contract' });
  assert.equal((await store.save(value, 0)).success, true);
  const read = (await store.read()).data;
  assert.deepEqual(read.futureField, value.futureField);
  assert.equal(read.tasks[0].futureTaskField, null);
  assert.deepEqual(read.availabilityBlocks, value.availabilityBlocks);
});

test('session foundation persists Chinese and null, lists healthy records and reports corruption separately', async t => {
  const h = await harness(t);
  const sessions = new SessionStore(h.coordinator);
  assert.equal((await sessions.read('absent')).errorCode, 'NOT_FOUND');
  assert.equal((await sessions.save(sessionDocument(), 0)).success, true);
  const reopened = new SessionStore(new StorageCoordinator(new HostFiles(h.directory)));
  assert.equal((await reopened.read('session-one')).data.messages[0].toolName, null);
  await h.files.writeText('sessions/damaged.json', '{bad');
  await h.files.writeText('sessions/missing.tmp.json', '{}');
  const listed = await reopened.list();
  assert.equal(listed.success, true);
  assert.equal(listed.data.sessions.length, 1);
  assert.equal(listed.data.sessions[0].title, '中文会话 🗓️');
  assert.deepEqual(listed.data.issues.map(value => value.errorCode).sort(), ['CORRUPT_DATA', 'RECOVERY_REQUIRED']);
});

test('session paths, identity mismatch, duplicate messages and stale saves are rejected', async t => {
  const h = await harness(t);
  const sessions = new SessionStore(h.coordinator);
  assert.equal((await sessions.read('../escape')).errorCode, 'INVALID_ARGUMENT');
  const invalid = sessionDocument();
  invalid.messages[0].sessionId = 'other-session';
  assert.equal((await sessions.save(invalid, 0)).errorCode, 'INVALID_ARGUMENT');
  const duplicate = sessionDocument();
  duplicate.messages.push(structuredClone(duplicate.messages[0]));
  assert.equal((await sessions.save(duplicate, 0)).errorCode, 'INVALID_ARGUMENT');
  assert.equal((await sessions.save(sessionDocument(), 0)).success, true);
  assert.equal((await sessions.save(sessionDocument(), 0)).errorCode, 'VERSION_CONFLICT');
});

test('existing revision-zero session is not hidden as NOT_FOUND', async t => {
  const h = await harness(t);
  await h.files.ensureDirectory('sessions');
  await h.files.writeText('sessions/session-one.json', JSON.stringify(sessionDocument()));
  const result = await new SessionStore(h.coordinator).read('session-one');
  assert.equal(result.success, true);
  assert.equal(result.data.messages.length, 1);
});
