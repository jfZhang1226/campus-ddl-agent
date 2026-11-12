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
  assert.equal(tools.isAllowedAction('get_task_detail'), true);
  assert.equal(tools.isAllowedAction('get_notice'), true);
  assert.equal(tools.isAllowedAction('get_availability'), true);
  assert.equal(tools.isAllowedAction('propose_task_changes'), true);
  assert.equal(tools.isAllowedAction('apply_confirmed_proposal'), false);
  assert.equal(tools.isAllowedAction('confirm'), false);
});

test('schema 数组只含白名单动作', () => {
  const names = tools.AGENT_TOOL_SCHEMAS.map(s => s.function.name);
  assert.deepEqual(names, tools.ALLOWED_ACTIONS);
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

test('normalizeResult 归一化成功/失败', () => {
  const ok = tools.normalizeResult('c1', 'get_tasks', {}, true, { tasks: [] }, null, '');
  assert.equal(ok.success, true);
  assert.equal(ok.errorCode, null);
  assert.deepEqual(ok.data, { tasks: [] });
  const fail = tools.normalizeResult('c1', 'get_tasks', {}, false, { tasks: [] }, 'STORAGE_FAILED', '坏盘');
  assert.equal(fail.success, false);
  assert.equal(fail.data, null);
  assert.equal(fail.errorCode, 'STORAGE_FAILED');
  const empty = tools.normalizeResult('c1', 'get_tasks', {}, false, null, '', '');
  assert.equal(empty.errorCode, tools.TOOL_ERRORS.STORAGE_FAILED);
});

function fakeTurn(script) {
  let i = 0;
  return { turn: async () => { const step = script[i]; i = Math.min(i + 1, script.length - 1); return step; } };
}
function fakeExec(results) {
  let i = 0;
  return { execute: async (action, params) => results[i++] };
}
const answer = text => ({ type: 'answer', text, calls: [], errorCode: '' });
const clarify = text => ({ type: 'clarification', text, calls: [], errorCode: '' });
const call = (id, action, params = {}) => ({ type: 'tool_calls', text: '', calls: [{ id, action, params }], errorCode: '' });
const okResult = (id, action, data) => ({ id, action, params: {}, success: true, data, errorCode: null, message: '' });

test('循环：直接回答不调用工具', async () => {
  const loop = new AgentLoop(fakeTurn([answer('你好')]), fakeExec([]));
  const out = await loop.run('你好', {});
  assert.equal(out.kind, 'answer');
  assert.equal(out.text, '你好');
});

test('循环：一次查询后回答，结果回传', async () => {
  let executed = 0;
  const exec = { execute: async () => { executed++; return okResult('c1', 'get_tasks', { tasks: [] }); } };
  const loop = new AgentLoop(fakeTurn([call('c1', 'get_tasks'), answer('没有相关任务')]), exec);
  const out = await loop.run('查任务', {});
  assert.equal(out.kind, 'answer');
  assert.equal(executed, 1);
});

test('循环：propose 成功即返回待确认方案', async () => {
  const exec = { execute: async () => okResult('c1', 'propose_task_changes', { id: 'proposal-1' }) };
  const loop = new AgentLoop(fakeTurn([call('c1', 'propose_task_changes'), answer('不应到达')]), exec);
  const out = await loop.run('创建任务', {});
  assert.equal(out.kind, 'proposal');
  assert.equal(out.proposalId, 'proposal-1');
});

test('循环：propose 失败不当作方案，继续下一轮', async () => {
  const exec = { execute: async () => tools.normalizeResult('c1', 'propose_task_changes', {}, false, null, 'VERSION_CONFLICT', '版本已变') };
  const loop = new AgentLoop(fakeTurn([call('c1', 'propose_task_changes'), answer('生成失败')]), exec);
  const out = await loop.run('创建任务', {});
  assert.equal(out.kind, 'answer');
  assert.equal(out.text, '生成失败');
});

test('循环：连续重复查询终止', async () => {
  const exec = { execute: async () => okResult('c1', 'get_tasks', { tasks: [] }) };
  const loop = new AgentLoop(fakeTurn([call('c1', 'get_tasks'), call('c1', 'get_tasks')]), exec);
  const out = await loop.run('查任务', {});
  assert.equal(out.kind, 'limit');
});

test('循环：模型返回非白名单动作 → 错误', async () => {
  const loop = new AgentLoop(fakeTurn([call('c1', 'apply_confirmed_proposal')]), fakeExec([]));
  const out = await loop.run('提交', {});
  assert.equal(out.kind, 'error');
  assert.equal(out.errorCode, tools.TOOL_ERRORS.INVALID_ARGUMENT);
});

test('循环：网关错误直接返回', async () => {
  const loop = new AgentLoop(fakeTurn([{ type: 'error', text: '', calls: [], errorCode: 'MODEL_ERROR' }]), fakeExec([]));
  const out = await loop.run('x', {});
  assert.equal(out.kind, 'error');
  assert.equal(out.errorCode, 'MODEL_ERROR');
});

test('循环：超过最大步数终止', async () => {
  const script = [];
  for (let i = 0; i < 20; i++) script.push(call('c' + i, 'get_tasks', { q: i }));
  const exec = { execute: async (a, p) => okResult(p.q + '', 'get_tasks', { n: p.q }) };
  const loop = new AgentLoop(fakeTurn(script), exec);
  const out = await loop.run('x', {});
  assert.equal(out.kind, 'limit');
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
