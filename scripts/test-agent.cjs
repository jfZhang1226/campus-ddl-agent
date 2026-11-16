/* T17 工具协议、Agent 循环与执行器主机检查（无真实模型/设备调用）。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tsPath = process.env.TYPESCRIPT_PATH ||
  'D:/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript';
const ts = require(tsPath);
const agentDir = path.join(root, 'client/entry/src/main/ets/agent');
const storageTypes = path.join(root, 'client/entry/src/main/ets/data/storage/StorageTypes.ts');
const sources = ['AgentTools.ts', 'AgentLoop.ts', 'AgentExecutor.ts'].map(name => path.join(agentDir, name))
  .concat([storageTypes]);
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, types: [] };
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(sources, options));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  process.exit(1);
}
console.log('PASS strict TypeScript check (3 agent files + storage types)');
const compile = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText;
  module._compile(code, filename);
};
require.extensions['.ts'] = compile;
const tools = require(path.join(agentDir, 'AgentTools.ts'));
const { AgentLoop } = require(path.join(agentDir, 'AgentLoop.ts'));
const { AgentExecutor } = require(path.join(agentDir, 'AgentExecutor.ts'));
const { StorageResult, StorageFailure } = require(storageTypes);

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('白名单只含查询与草案，apply 被排除', () => {
  assert.equal(tools.isAllowedAction('get_tasks'), true);
  assert.equal(tools.isAllowedAction('propose_task_changes'), true);
  assert.equal(tools.isAllowedAction('apply_confirmed_proposal'), false);
});

test('schema 数组只含白名单动作', () => {
  assert.deepEqual(tools.AGENT_TOOL_SCHEMAS.map(s => s.function.name), tools.ALLOWED_ACTIONS);
});

test('validateCall / validateParams 逐动作校验', () => {
  assert.equal(tools.validateCall({ id: 'c1', action: 'get_tasks', params: {} }), '');
  assert.equal(tools.validateCall({ id: 'c1', action: 'apply_confirmed_proposal', params: {} }),
    tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('get_task_detail', { taskId: '' }), tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('get_task_detail', { taskId: 't1', extra: 1 }), tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('get_tasks', {}), '');
  assert.equal(tools.validateParams('get_tasks', { includeUndated: 1 }), tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

const createChange = (checklistCreates) => ({ action: 'create', taskId: null, expectedVersion: null,
  draft: { title: '交作业', noticeIds: [] }, checklistCreates });

test('validateParams 拒绝编辑变化携带材料，允许创建型材料', () => {
  const update = { sessionId: 's1', expectedRevision: 0, notices: [],
    changes: [{ action: 'update', taskId: 't1', expectedVersion: 1, draft: { title: 'x', noticeIds: [] },
      checklistCreates: [{ label: 'PDF', sourceNoticeId: null }] }] };
  assert.equal(tools.validateParams('propose_task_changes', update), tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('propose_task_changes',
    { sessionId: 's1', expectedRevision: 0, notices: [], changes: [createChange([{ label: 'PDF', sourceNoticeId: null }])] }), '');
  assert.equal(tools.validateParams('propose_task_changes',
    { sessionId: 's1', expectedRevision: 0, notices: [], changes: [createChange([])], extra: 1 }),
    tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

test('normalizeResult 归一化成功/失败', () => {
  assert.equal(tools.normalizeResult('c1', 'get_tasks', {}, true, { tasks: [] }, null, '').success, true);
  assert.equal(tools.normalizeResult('c1', 'get_tasks', {}, false, null, 'STORAGE_FAILED', '坏盘').errorCode, 'STORAGE_FAILED');
});

function scriptTurn(script) {
  let i = 0;
  return { turn: async () => { const step = script[i]; i = Math.min(i + 1, script.length - 1); return step; } };
}
const answer = text => ({ type: 'answer', text, calls: [], errorCode: '' });
const call = (id, action, params = {}) => ({ type: 'tool_calls', text: '', calls: [{ id, action, params }], errorCode: '' });
const okResult = (call, data) => ({ id: call.id, action: call.action, params: call.params, success: true, data, errorCode: null, message: '' });
const proposeParams = () => ({ sessionId: 's1', expectedRevision: 0, notices: [],
  changes: [{ action: 'create', taskId: null, expectedVersion: null, draft: { title: 'x', noticeIds: [] } }] });

test('循环：直接回答 + 一次查询后回答', async () => {
  let executed = 0;
  const exec = { execute: async (c) => { executed++; return okResult(c, { tasks: [] }); } };
  assert.equal((await new AgentLoop(scriptTurn([answer('你好')]), exec).run('你好', {})).kind, 'answer');
  const loop2 = new AgentLoop(scriptTurn([call('c1', 'get_tasks'), answer('没有任务')]), exec);
  assert.equal((await loop2.run('查任务', {})).kind, 'answer');
});

test('P2-1 续轮保留原始用户消息', async () => {
  const sent = [];
  const turn = { turn: async (msg) => { sent.push(msg); return sent.length === 1 ? call('c1', 'get_tasks') : answer('done'); } };
  const loop = new AgentLoop(turn, { execute: async (c) => okResult(c, { tasks: [] }) });
  await loop.run('只查询数据库任务，不生成方案', {});
  assert.deepEqual(sent, ['只查询数据库任务，不生成方案', '只查询数据库任务，不生成方案']);
});

test('循环：propose 成功即返回方案并停止批次', async () => {
  const executed = [];
  const turn = { turn: async () => ({ type: 'tool_calls', text: '', errorCode: '', calls: [
    { id: 'c1', action: 'propose_task_changes', params: proposeParams() },
    { id: 'c2', action: 'get_tasks', params: {} } ] }) };
  const exec = { execute: async (c) => { executed.push(c.action); return okResult(c, { id: 'p1' }); } };
  const out = await new AgentLoop(turn, exec).run('创建任务', {});
  assert.equal(out.kind, 'proposal');
  assert.equal(out.proposalId, 'p1');
  assert.deepEqual(executed, ['propose_task_changes']);
});

test('循环：propose 失败继续下一轮', async () => {
  const exec = { execute: async (c) => tools.normalizeResult(c.id, c.action, c.params, false, null, 'VERSION_CONFLICT', '版本已变') };
  const loop = new AgentLoop(scriptTurn([call('c1', 'propose_task_changes', proposeParams()), answer('生成失败')]), exec);
  assert.equal((await loop.run('创建任务', {})).kind, 'answer');
});

test('循环：连续相同且无新增终止；同参数新数据不终止；非连续不终止', async () => {
  const same = { execute: async (c) => okResult(c, { tasks: [], revision: 1 }) };
  assert.equal((await new AgentLoop(scriptTurn([call('c1', 'get_tasks'), call('c2', 'get_tasks')]), same)
    .run('查任务', {})).kind, 'limit');
  let e = 0;
  const newData = { execute: async (c) => e++ === 0 ? okResult(c, { tasks: [], revision: 1 }) : okResult(c, { tasks: [{ id: 't1' }], revision: 2 }) };
  assert.equal((await new AgentLoop(scriptTurn([call('c1', 'get_tasks'), call('c2', 'get_tasks'), answer('ok')]), newData)
    .run('查任务', {})).kind, 'answer');
  const ab = { execute: async (c) => c.action === 'get_tasks' ? okResult(c, { tasks: [], revision: 1 }) : okResult(c, { notice: { id: 'n1' }, revision: 1 }) };
  assert.equal((await new AgentLoop(scriptTurn([call('c1', 'get_tasks'), call('c2', 'get_notice', { noticeId: 'n1' }),
    call('c3', 'get_tasks'), answer('ok')]), ab).run('查', {})).kind, 'answer');
});

test('循环：非白名单动作报错、超步数终止', async () => {
  const loop = new AgentLoop(scriptTurn([call('c1', 'apply_confirmed_proposal')]), { execute: async (c) => okResult(c, {}) });
  assert.equal((await loop.run('提交', {})).errorCode, tools.TOOL_ERRORS.INVALID_ARGUMENT);
  const script = [];
  for (let i = 0; i < 20; i++) script.push(call('c' + i, 'get_tasks', { keyword: 'k' + i }));
  const exec = { execute: async (c) => okResult(c, { n: c.params.keyword }) };
  assert.equal((await new AgentLoop(scriptTurn(script), exec).run('x', {})).kind, 'limit');
});

// ---------------- 执行器（AgentExecutor） ----------------
function ok(data) { return new StorageResult(true, data, null, ''); }
function fail(code, message) { return new StorageResult(false, null, code, message); }

test('执行器 get_notice：成功/缺失/读取错误', async () => {
  const readOk = { read: async () => ok({ notices: [{ id: 'n1', rawText: '原文' }], revision: 3 }) };
  const ex = new AgentExecutor({ list: async () => ok({}), get: async () => ok({}) }, readOk, { stage: async () => ok({}) });
  const r1 = await ex.execute({ id: 'c1', action: 'get_notice', params: { noticeId: 'n1' } });
  assert.equal(r1.success, true);
  assert.deepEqual(r1.data, { notice: { id: 'n1', rawText: '原文' }, revision: 3 });
  const readEmpty = { read: async () => ok({ notices: [], revision: 3 }) };
  const ex2 = new AgentExecutor({ list: async () => ok({}), get: async () => ok({}) }, readEmpty, { stage: async () => ok({}) });
  const r2 = await ex2.execute({ id: 'c2', action: 'get_notice', params: { noticeId: 'missing' } });
  assert.equal(r2.success, false);
  assert.equal(r2.errorCode, tools.TOOL_ERRORS.NOT_FOUND);
  const readErr = { read: async () => fail('STORAGE_FAILED', '坏盘') };
  const ex3 = new AgentExecutor({ list: async () => ok({}), get: async () => ok({}) }, readErr, { stage: async () => ok({}) });
  const r3 = await ex3.execute({ id: 'c3', action: 'get_notice', params: { noticeId: 'n1' } });
  assert.equal(r3.errorCode, 'STORAGE_FAILED');
});

test('执行器 分发与错误映射', async () => {
  const tasks = { list: async () => ok({ tasks: [], revision: 1 }), get: async () => ok({ task: { id: 't1' } }) };
  const ex = new AgentExecutor(tasks, { read: async () => ok({ notices: [], revision: 1 }) },
    { stage: async () => fail('VERSION_CONFLICT', '版本已变') });
  assert.equal((await ex.execute({ id: 'c1', action: 'get_tasks', params: {} })).success, true);
  assert.equal((await ex.execute({ id: 'c1', action: 'get_task_detail', params: { taskId: 't1' } })).success, true);
  assert.equal((await ex.execute({ id: 'c1', action: 'get_availability', params: { dateFrom: '2026-11-01', dateTo: '2026-11-07' } })).errorCode, tools.TOOL_ERRORS.NOT_IMPLEMENTED);
  const p = await ex.execute({ id: 'c1', action: 'propose_task_changes', params: proposeParams() });
  assert.equal(p.success, false);
  assert.equal(p.errorCode, 'VERSION_CONFLICT');
});

test('执行器 端口抛 StorageFailure 如实传递', async () => {
  const ex = new AgentExecutor({ list: async () => { throw new StorageFailure('CORRUPT_DATA', '损坏'); }, get: async () => ok({}) },
    { read: async () => ok({ notices: [], revision: 1 }) }, { stage: async () => ok({}) });
  const r = await ex.execute({ id: 'c1', action: 'get_tasks', params: {} });
  assert.equal(r.success, false);
  assert.equal(r.errorCode, 'CORRUPT_DATA');
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    await t.run();
    passed++;
    console.log('[PASS]', t.name);
  }
  console.log(`\n共 ${tests.length} 项，通过 ${passed}，失败 ${tests.length - passed}`);
  if (passed !== tests.length) process.exit(1);
})();
