/* Host checks for shared chat logic; no model or device calls are made. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const studio = process.env.DEVECO_CLI_STUDIO_PATH;
const tsPath = process.env.TYPESCRIPT_PATH || (studio && path.join(studio, 'tools/hvigor/hvigor/node_modules/typescript'));
if (!tsPath) throw new Error('Activate the toolchain or set TYPESCRIPT_PATH to the installed TypeScript package.');
const ts = require(tsPath);
const chatDir = path.join(root, 'client/entry/src/main/ets/chat');
const sources = ['ChatModels.ts', 'GatewayProtocol.ts', 'ChatController.ts'].map(name => path.join(chatDir, name));
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, types: [] };
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(sources, options));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  process.exit(1);
}
console.log('PASS strict TypeScript check (3 shared core files)');
const compile = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText;
  module._compile(code, filename);
};
require.extensions['.ts'] = compile;
const { GatewayConfig, GatewayResponse } = require(path.join(chatDir, 'ChatModels.ts'));
const { validateConfig, turnUrl, encodeTurn, decodeTurn, errorText } = require(path.join(chatDir, 'GatewayProtocol.ts'));
const { ChatController } = require(path.join(chatDir, 'ChatController.ts'));
const tests = [];
function test(name, run) { tests.push({ name, run }); }
const config = () => new GatewayConfig('https://example.test/gateway/', 'test-project-token', 45000);
const wire = (body, status = 200) => new GatewayResponse(status, JSON.stringify(body));
const answer = text => wire({ type: 'answer', text, requestId: 'test-id' });
const flush = () => new Promise(resolve => setImmediate(resolve));
class FakeClock {
  next = 0;
  tasks = new Map();
  schedule(callback, ms) { const id = ++this.next; this.tasks.set(id, { callback, ms }); return id; }
  cancel(id) { this.tasks.delete(id); }
  fire() { for (const [id, task] of [...this.tasks]) { this.tasks.delete(id); task.callback(); } }
}
class FakeTransport {
  calls = [];
  start(settings, message) {
    const call = { settings, message, cancellations: 0 };
    call.result = new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
    call.cancel = () => { call.cancellations++; };
    this.calls.push(call);
    return call;
  }
}
function setup() {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const controller = new ChatController(transport, clock);
  controller.configure(config());
  controller.setDraft('问题一');
  return { controller, transport, clock };
}
test('gateway URL normalization preserves a reverse proxy prefix', () => {
  assert.equal(validateConfig(config()), '');
  assert.equal(turnUrl(config()), 'https://example.test/gateway/api/model/turn');
  assert.equal(validateConfig(new GatewayConfig('http://192.168.1.20:8000', 'token')), '');
});
test('reject unsupported schemes, credentials and URL query/fragment', () => {
  for (const url of ['file:///a', 'https://u:p@host', 'https://host?q=x', 'https://host/#x', 'https://host name', '']) {
    assert.equal(validateConfig(new GatewayConfig(url, 'token')), 'CONFIG_URL');
  }
});
test('reject empty, non-ASCII and whitespace tokens locally', () => {
  for (const token of ['', '中文', 'a b', 'a\nb', 'a\tb']) assert.equal(validateConfig(new GatewayConfig('https://host', token)), 'CONFIG_TOKEN');
});
test('deadline must be whole seconds within 5..120', () => {
  for (const ms of [NaN, Infinity, 0, 4999, 45001, 45500, 120001]) {
    const settings = config(); settings.timeoutMs = ms; assert.equal(validateConfig(settings), 'CONFIG_TIMEOUT');
  }
});
test('encode exactly T07 single-turn input with no history or credentials', () => {
  assert.deepEqual(JSON.parse(encodeTurn('中文 😀')), { message: '中文 😀', context: { timezone: 'Asia/Shanghai' }, tools: [], results: [] });
});
test('render answer and clarification only after successful protocol validation', () => {
  assert.equal(decodeTurn(answer('中文 😀')).text, '中文 😀');
  assert.equal(decodeTurn(wire({ type: 'clarification', question: '什么日期？' })).text, '什么日期？');
});
test('reject malformed, scalar, array, missing, empty and non-string answers', () => {
  const bodies = ['<html>proxy</html>', 'null', '[]', '1', '"text"', '{}',
    '{"type":"answer","text":{}}', '{"type":"answer","text":" "}', '{"type":"other","text":"x"}'];
  for (const body of bodies) assert.equal(decodeTurn(new GatewayResponse(200, body)).errorCode, 'INVALID_RESPONSE');
});
test('HTTP errors cannot masquerade as answers', () => {
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [429, 'RATE_LIMITED'], [400, 'INVALID_REQUEST'],
    [500, 'CONFIG_ERROR'], [502, 'MODEL_ERROR'], [503, 'HTTP_ERROR']]) {
    assert.equal(decodeTurn(wire({ type: 'answer', text: 'fake success' }, status)).errorCode, code);
  }
});
test('HTTP 200 error and tool responses do not become assistant success', () => {
  assert.equal(decodeTurn(wire({ type: 'error', errorCode: 'MODEL_ERROR' })).errorCode, 'MODEL_ERROR');
  assert.equal(decodeTurn(wire({ type: 'error', errorCode: 'secret vendor error' })).errorCode, 'GATEWAY_ERROR');
  assert.equal(decodeTurn(wire({ type: 'tool_calls', calls: [] })).errorCode, 'TOOLS_UNAVAILABLE');
});
test('local validation never displays an older request diagnostic ID', async () => {
  const { controller: c, transport: t } = setup(); c.send();
  t.calls[0].resolve(wire({ type: 'error', errorCode: 'MODEL_ERROR', requestId: 'old-id' })); await flush();
  assert.equal(c.snapshot().requestId, 'old-id'); c.setDraft(' '); c.send(); assert.equal(c.snapshot().requestId, '');
});
test('display only bounded diagnostic IDs and controlled error messages', () => {
  assert.equal(decodeTurn(wire({ type: 'error', requestId: '<script>secret</script>', message: 'secret' })).requestId, '');
  assert.equal(errorText('secret'), '这次请求未成功，输入已保留，请稍后重试。');
});
test('empty, oversized and unconfigured sends do not start a request', () => {
  const { controller: c, transport: t } = setup();
  c.setDraft(' '); c.send(); assert.equal(c.snapshot().errorCode, 'EMPTY_MESSAGE');
  c.setDraft('a'.repeat(4001)); c.send(); assert.equal(c.snapshot().errorCode, 'MESSAGE_TOO_LONG');
  const empty = new ChatController(t); empty.setDraft('hello'); empty.send();
  assert.equal(empty.snapshot().errorCode, 'CONFIG_URL'); assert.equal(t.calls.length, 0);
});
test('block duplicate submits and configuration changes while loading', () => {
  const { controller: c, transport: t } = setup(); c.send(); c.send();
  assert.equal(t.calls.length, 1); assert.equal(c.configure(config()), false);
  assert.equal(c.snapshot().busy, true); assert.equal(c.snapshot().messages.length, 1);
});
test('success adds one assistant answer, clears unchanged input and releases resources', async () => {
  const { controller: c, transport: t, clock } = setup(); c.send(); t.calls[0].resolve(answer('回复')); await flush();
  assert.equal(c.snapshot().draft, ''); assert.equal(c.snapshot().messages[1].text, '回复');
  assert.equal(c.snapshot().busy, false); assert.equal(t.calls[0].cancellations, 1); assert.equal(clock.tasks.size, 0);
});
test('a successful response never erases text edited during the request', async () => {
  const { controller: c, transport: t } = setup(); c.send(); c.setDraft('正在写第二个问题');
  t.calls[0].resolve(answer('回复')); await flush(); assert.equal(c.snapshot().draft, '正在写第二个问题');
});
test('network failure retains input and retry reuses the original user row', async () => {
  const { controller: c, transport: t } = setup(); c.send(); t.calls[0].reject(new Error('sensitive text')); await flush();
  assert.equal(c.snapshot().errorCode, 'NETWORK'); assert.equal(c.snapshot().draft, '问题一'); assert.equal(c.snapshot().canRetry, true);
  c.send(); assert.equal(c.snapshot().messages.length, 1); assert.equal(t.calls.length, 2);
  t.calls[1].resolve(answer('成功')); await flush(); assert.equal(c.snapshot().messages.length, 2);
});
test('editing a failed question makes the next send a distinct row', async () => {
  const { controller: c, transport: t } = setup(); c.send(); t.calls[0].resolve(wire({ type: 'error' }, 502)); await flush();
  c.setDraft('问题二'); assert.equal(c.snapshot().canRetry, false); c.send();
  assert.equal(c.snapshot().messages.length, 2); assert.equal(t.calls[1].message, '问题二');
});
test('total deadline releases request and ignores late success', async () => {
  const { controller: c, transport: t, clock } = setup(); c.send();
  assert.equal([...clock.tasks.values()][0].ms, 45000); clock.fire();
  assert.equal(c.snapshot().errorCode, 'TIMEOUT'); assert.equal(t.calls[0].cancellations, 1);
  t.calls[0].resolve(answer('late')); await flush(); assert.equal(c.snapshot().messages.length, 1);
  assert.equal(c.snapshot().draft, '问题一');
});
test('native timeout rejection is presented as a timeout', async () => {
  const { controller: c, transport: t } = setup(); c.send(); t.calls[0].reject(new Error('TIMEOUT')); await flush();
  assert.equal(c.snapshot().errorCode, 'TIMEOUT');
});
test('stop and retry ignore a prior request completing during the new request', async () => {
  const { controller: c, transport: t } = setup(); c.send(); c.stop(); c.send();
  t.calls[0].resolve(answer('stale')); await flush(); assert.equal(c.snapshot().busy, true);
  t.calls[1].resolve(answer('current')); await flush(); assert.deepEqual(c.snapshot().messages.map(row => row.text), ['问题一', 'current']);
});
test('background cancellation retains edited input and prevents stale failure updates', async () => {
  const { controller: c, transport: t } = setup(); c.send(); c.setDraft('未发送草稿'); c.stop('BACKGROUND');
  t.calls[0].reject(new Error('late error')); await flush();
  assert.equal(c.snapshot().errorCode, 'BACKGROUND'); assert.equal(c.snapshot().draft, '未发送草稿');
});
test('dispose clears private runtime data and ignores all later work', async () => {
  const { controller: c, transport: t } = setup(); c.send(); c.dispose(); t.calls[0].resolve(answer('late')); await flush();
  c.send(); c.setDraft('ignored'); assert.equal(c.snapshot().draft, ''); assert.equal(c.snapshot().messages.length, 0);
  assert.equal(c.configuration().token, ''); assert.equal(t.calls.length, 1);
});
test('transport synchronous startup failure recovers from loading', () => {
  const c = new ChatController({ start() { throw new Error('start failed'); } }, new FakeClock());
  c.configure(config()); c.setDraft('问题'); c.send(); assert.equal(c.snapshot().busy, false); assert.equal(c.snapshot().errorCode, 'NETWORK');
});
test('unsubscribed pages stop receiving state and snapshots cannot mutate owner', () => {
  const { controller: c } = setup(); let notifications = 0; c.subscribe(() => notifications++);
  c.unsubscribe(); c.setDraft('new'); assert.equal(notifications, 1);
  c.send(); const snapshot = c.snapshot(); snapshot.messages[0].text = 'mutated';
  assert.equal(c.snapshot().messages[0].text, 'new');
});

// Exercise the actual platform adapter at its native HTTP boundary, without loading an SDK or making a network call.
let nativeRequests = [];
let nativeThrow = false;
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === '@ohos.net.http') return { default: { createHttp: () => {
    const request = { destroys: 0 };
    request.request = (url, options) => {
      if (nativeThrow) throw { code: 401, message: 'invalid argument' };
      request.url = url; request.options = options;
      return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    };
    request.destroy = () => request.destroys++;
    nativeRequests.push(request); return request;
  }, RequestMethod: { POST: 'POST' }, HttpDataType: { STRING: 0 } } };
  return originalLoad.call(this, name, ...args);
};
require.extensions['.ets'] = compile;
const { ArkGatewayTransport } = require(path.join(root, 'client/entry/src/main/ets/adapters/ArkGatewayTransport.ets'));
Module._load = originalLoad;
test('native adapter sends project bearer, JSON body, no cache and bounded timeouts', async () => {
  const call = new ArkGatewayTransport().start(config(), '中文'); const request = nativeRequests.at(-1);
  assert.equal(request.url, 'https://example.test/gateway/api/model/turn');
  assert.equal(request.options.header.Authorization, 'Bearer test-project-token');
  assert.equal(JSON.parse(request.options.extraData).message, '中文'); assert.equal(request.options.usingCache, false);
  assert.equal(request.options.connectTimeout, 10000); assert.equal(request.options.readTimeout, 45000);
  request.resolve({ responseCode: 200, result: '{"type":"answer","text":"ok"}' }); await call.result;
  call.cancel(); assert.equal(request.destroys, 1);
});
test('native adapter destroys once on cancellation and later completion', async () => {
  const call = new ArkGatewayTransport().start(config(), 'hi'); const request = nativeRequests.at(-1);
  call.cancel(); call.cancel(); request.resolve({ responseCode: 401, result: '{}' }); await call.result;
  assert.equal(request.destroys, 1);
});
test('unexpected native response data is rejected by the shared decoder', async () => {
  const call = new ArkGatewayTransport().start(config(), 'hi'); const request = nativeRequests.at(-1);
  request.resolve({ responseCode: 200, result: { text: 'object instead of JSON string' } });
  assert.equal(decodeTurn(await call.result).errorCode, 'INVALID_RESPONSE'); assert.equal(request.destroys, 1);
});
test('native errors are sanitized and release HTTP handles', async () => {
  for (const [nativeCode, code] of [[2300028, 'TIMEOUT'], [2300006, 'NETWORK']]) {
    const call = new ArkGatewayTransport().start(config(), 'hi'); const request = nativeRequests.at(-1);
    request.reject({ code: nativeCode, message: 'secret bearer' }); await assert.rejects(call.result, { message: code });
    assert.equal(request.destroys, 1);
  }
});
test('a synchronous native request exception also releases its handle', async () => {
  nativeThrow = true;
  const call = new ArkGatewayTransport().start(config(), 'hi'); const request = nativeRequests.at(-1);
  nativeThrow = false; await assert.rejects(call.result, { message: 'NETWORK' }); assert.equal(request.destroys, 1);
});
(async () => {
  for (const { name, run } of tests) { await run(); console.log('PASS ' + name); }
  console.log(`${tests.length} chat checks passed (host / simulated native boundary; not device or cloud evidence).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
