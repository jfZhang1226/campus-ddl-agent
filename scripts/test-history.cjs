/* Installed compiler only. No dependency downloads, model calls or device access. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(process.env.T08_TYPESCRIPT_PATH ||
  path.join(process.env.DEVECO_CLI_STUDIO_PATH, 'tools/hvigor/hvigor/node_modules/typescript'));
const sources = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.name.endsWith('.ts')) sources.push(file);
  }
}
for (const dir of ['data', 'domain', 'chat']) collect(path.join(root, 'client/entry/src/main/ets', dir));
sources.push(path.join(root, 'client/entry/src/main/ets/adapters/storage/FilePort.ts'));
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, skipLibCheck: true, types: [] };
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(sources, options));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  process.exit(1);
}
console.log(`History/chat/storage strict typecheck passed (${sources.length} TS files). Platform .ets requires SDK build.`);
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: options
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.ets'] = compile;
require('../tests/history/history.test.cjs');
require('../tests/history/history-page.test.cjs');
require('../tests/history/history-recovery.test.cjs');
