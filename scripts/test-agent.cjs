/* T17 工具协议与 Agent 循环主机检查（无真实模型/设备调用）。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tsPath = process.env.TYPESCRIPT_PATH ||
  'D:/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript';
const ts = require(tsPath);
const agentDir = path.join(root, 'client/entry/src/main/ets/agent');
const sources = ['AgentTools.ts', 'AgentLoop.ts'].map(name => path.join(agentDir, name));
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, types: [] };
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(sources, options));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  process.exit(1);
}
console.log('PASS strict TypeScript check (2 agent files)');
const compile = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText;
  module._compile(code, filename);
};
require.extensions['.ts'] = compile;
const tools = require(path.join(agentDir, 'AgentTools.ts'));
const { AgentLoop } = require(path.join(agentDir, 'AgentLoop.ts'));

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('白名单只含查询与草案，apply 被排除', () => {
  assert.equal(tools.isAllowedAction('get_tasks'), true);
  assert.equal(tools.isAllowedAction('propose_task_changes'), true);
  assert.equal(tools.isAllowedAction('apply_confirmed_proposal'), false);
  assert.equal(tools.isAllowedAction('confirm'), false);
});

test('schema 数组只含白名单动作', () => {
  assert.deepEqual(tools.AGENT_TOOL_SCHEMAS.map(s => s.function.name), tools.ALLOWED_ACTIONS);
});

test('validateCall 校验动作/参数/ID', () => {
  assert.equal(tools.validateCall({ id: 'c1', action: 'get_tasks', params: {} }), '');
  assert.equal(tools.validateCall({ id: 'c1', action: 'apply_confirmed_proposal', params: {} }),
    tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateCall({ id: 'c1', action: 'get_tasks', params: [] }),
    tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateCall({ id: '', action: 'get_tasks', params: {} }),
    tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

test('validateParams 逐动作校验：必填/未知字段/类型', () => {
  assert.equal(tools.validateParams('get_task_detail', { taskId: 't1' }), '');
  assert.equal(tools.validateParams('get_task_detail', { taskId: '' }), tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('get_task_detail', { taskId: 't1', extra: 1 }), tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('get_notice', { noticeId: 'n1' }), '');
  assert.equal(tools.validateParams('get_notice', {}), tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('get_tasks', {}), '');
  assert.equal(tools.validateParams('get_tasks', { statuses: 'x' }), tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('get_tasks', { includeUndated: 1 }), tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

const createChange = (checklistCreates) => ({ action: 'create', taskId: null, expectedVersion: null,
  draft: { title: '交作业', noticeIds: [] }, checklistCreates });

test('validateParams 拒绝编辑变化携带材料（T22 未支持）', () => {
  const p = { sessionId: 's1', expectedRevision: 0, notices: [],
    changes: [{ action: 'update', taskId: 't1', expectedVersion: 1,
      draft: { title: 'x', noticeIds: [] }, checklistCreates: [{ label: 'PDF', sourceNoticeId: null }] }] };
  assert.equal(tools.validateParams('propose_task_changes', p), tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

test('validateParams 允许创建型随附材料，拒绝未知字段', () => {
  assert.equal(tools.validateParams('propose_task_changes',
    { sessionId: 's1', expectedRevision: 0, notices: [], changes: [createChange([{ label: 'PDF', sourceNoticeId: null }])] }), '');
  assert.equal(tools.validateParams('propose_task_changes',
    { sessionId: 's1', expectedRevision: 0, notices: [], changes: [createChange([])], extra: 1 }),
    tools.TOOL_ERRORS.INVALID_ARGUMENT);
  assert.equal(tools.validateParams('propose_task_changes',
    { sessionId: 's1', expectedRevision: 0, notices: [], changes: [createChange([{ label: '', sourceNoticeId: null }])] }),
    tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

test('normalizeResult 归一化成功/失败', () => {
  const ok = tools.normalizeResult('c1', 'get_tasks', {}, true, { tasks: [], revision: 1 }, null, '');
  assert.equal(ok.success, true);
  assert.equal(ok.errorCode, null);
  const fail = tools.normalizeResult('c1', 'get_tasks', {}, false, null, 'STORAGE_FAILED', '坏盘');
  assert.equal(fail.success, false);
  assert.equal(fail.data, null);
  assert.equal(fail.errorCode, 'STORAGE_FAILED');
});

function scriptTurn(script) {
  let i = 0;
  return { turn: async () => { const step = script[i]; i = Math.min(i + 1, script.length - 1); return step; } };
}
const answer = text => ({ type: 'answer', text, calls: [], errorCode: '' });
const call = (id, action, params = {}) => ({ type: 'tool_calls', text: '', calls: [{ id, action, params }], errorCode: '' });
const okResult = (id, action, data) => ({ id, action, params: {}, success: true, data, errorCode: null, message: '' });
const proposeParams = () => ({ sessionId: 's1', expectedRevision: 0, notices: [],
  changes: [{ action: 'create', taskId: null, expectedVersion: null, draft: { title: 'x', noticeIds: [] } }] });

test('循环：直接回答不调用工具', async () => {
  const loop = new AgentLoop(scriptTurn([answer('你好')]), { execute: async () => okResult('c1', 'get_tasks', {}) });
  assert.equal((await loop.run('你好', {})).kind, 'answer');
});

test('循环：一次查询后回答，结果回传', async () => {
  let executed = 0;
  const exec = { execute: async () => { executed++; return okResult('c1', 'get_tasks', { tasks: [] }); } };
  const loop = new AgentLoop(scriptTurn([call('c1', 'get_tasks'), answer('没有相关任务')]), exec);
  const out = await loop.run('查任务', {});
  assert.equal(out.kind, 'answer');
  assert.equal(executed, 1);
});

test('P2-1 续轮保留原始用户消息', async () => {
  const sent = [];
  const turn = { turn: async (msg) => { sent.push(msg); return sent.length === 1 ? call('c1', 'get_tasks') : answer('done'); } };
  const loop = new AgentLoop(turn, { execute: async () => okResult('c1', 'get_tasks', { tasks: [] }) });
  const out = await loop.run('只查询数据库任务，不生成方案', {});
  assert.equal(out.kind, 'answer');
  assert.deepEqual(sent, ['只查询数据库任务，不生成方案', '只查询数据库任务，不生成方案']);
});

test('循环：propose 成功即返回待确认方案', async () => {
  const exec = { execute: async () => okResult('c1', 'propose_task_changes', { id: 'proposal-1' }) };
  const loop = new AgentLoop(scriptTurn([call('c1', 'propose_task_changes', proposeParams()), answer('不应到达')]), exec);
  const out = await loop.run('创建任务', {});
  assert.equal(out.kind, 'proposal');
  assert.equal(out.proposalId, 'proposal-1');
});

test('P2-3 首个成功 propose 停止本批次后续工具', async () => {
  const executed = [];
  const turn = { turn: async () => ({ type: 'tool_calls', text: '', errorCode: '', calls: [
    { id: 'c1', action: 'propose_task_changes', params: { sessionId: 's1', expectedRevision: 0, notices: [],
      changes: [{ action: 'create', taskId: null, expectedVersion: null, draft: { title: 'x', noticeIds: [] } }] } },
    { id: 'c2', action: 'get_tasks', params: {} } ] }) };
  const exec = { execute: async (a) => { executed.push(a); return okResult('c1', 'propose_task_changes', { id: 'p1' }); } };
  const loop = new AgentLoop(turn, exec);
  const out = await loop.run('创建任务', {});
  assert.equal(out.kind, 'proposal');
  assert.equal(out.proposalId, 'p1');
  assert.deepEqual(executed, ['propose_task_changes']);
});

test('循环：propose 失败不当作方案，继续下一轮', async () => {
  const exec = { execute: async () => tools.normalizeResult('c1', 'propose_task_changes', {}, false, null, 'VERSION_CONFLICT', '版本已变') };
  const loop = new AgentLoop(scriptTurn([call('c1', 'propose_task_changes', proposeParams()), answer('生成失败')]), exec);
  const out = await loop.run('创建任务', {});
  assert.equal(out.kind, 'answer');
  assert.equal(out.text, '生成失败');
});

test('循环：连续相同查询且无新增终止', async () => {
  const exec = { execute: async () => okResult('c1', 'get_tasks', { tasks: [], revision: 1 }) };
  const loop = new AgentLoop(scriptTurn([call('c1', 'get_tasks'), call('c2', 'get_tasks'), answer('不该到')]), exec);
  assert.equal((await loop.run('查任务', {})).kind, 'limit');
});

test('P2-2 同参数结果新增不当作重复', async () => {
  let e = 0;
  const exec = { execute: async () => e++ === 0 ? okResult('c1', 'get_tasks', { tasks: [], revision: 1 })
    : okResult('c2', 'get_tasks', { tasks: [{ id: 't1' }], revision: 2 }) };
  const loop = new AgentLoop(scriptTurn([call('c1', 'get_tasks'), call('c2', 'get_tasks'), answer('找到新任务')]), exec);
  assert.equal((await loop.run('查任务', {})).kind, 'answer');
});

test('P2-2 非连续 A→B→A 不终止', async () => {
  const exec = { execute: async (a, p) => a === 'get_tasks' ? okResult(p, a, { tasks: [], revision: 1 })
    : okResult(p, a, { notice: { id: 'n1' }, revision: 1 }) };
  const loop = new AgentLoop(scriptTurn([call('c1', 'get_tasks'), call('c2', 'get_notice', { noticeId: 'n1' }),
    call('c3', 'get_tasks'), answer('ok')]), exec);
  assert.equal((await loop.run('查', {})).kind, 'answer');
});

test('循环：模型返回非白名单动作 → 错误', async () => {
  const loop = new AgentLoop(scriptTurn([call('c1', 'apply_confirmed_proposal')]), { execute: async () => okResult('c1', 'x', {}) });
  const out = await loop.run('提交', {});
  assert.equal(out.kind, 'error');
  assert.equal(out.errorCode, tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

test('循环：网关错误直接返回', async () => {
  const loop = new AgentLoop(scriptTurn([{ type: 'error', text: '', calls: [], errorCode: 'MODEL_ERROR' }]),
    { execute: async () => okResult('c1', 'x', {}) });
  assert.equal((await loop.run('x', {})).kind, 'error');
});

test('循环：超过最大步数终止', async () => {
  const script = [];
  for (let i = 0; i < 20; i++) script.push(call('c' + i, 'get_tasks', { keyword: 'k' + i }));
  const exec = { execute: async (a, p) => okResult(p.keyword, 'get_tasks', { n: p.keyword }) };
  const loop = new AgentLoop(scriptTurn(script), exec);
  assert.equal((await loop.run('x', {})).kind, 'limit');
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
