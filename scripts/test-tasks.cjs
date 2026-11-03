/* Uses the already installed DevEco TypeScript compiler; never downloads packages. */
const fs = require('node:fs');
const path = require('node:path');
const studio = process.env.DEVECO_CLI_STUDIO_PATH;
const candidates = [process.env.T08_TYPESCRIPT_PATH,
  studio && path.join(studio, 'tools/hvigor/hvigor/node_modules/typescript'),
  studio && path.join(studio, 'tools/ohpm/node_modules/typescript'), 'typescript'].filter(Boolean);
let ts;
for (const candidate of candidates) { try { ts = require(candidate); break; } catch (_) {} }
if (!ts) throw new Error('Activate the DevEco environment or set T08_TYPESCRIPT_PATH.');
const root = path.resolve(__dirname, '..');
const sources = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(name);
    else if (entry.name.endsWith('.ts')) sources.push(name);
  }
}
collect(path.join(root, 'client/entry/src/main/ets/data'));
collect(path.join(root, 'client/entry/src/main/ets/domain'));
sources.push(path.join(root, 'client/entry/src/main/ets/adapters/storage/FilePort.ts'));
const options = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, strict: true, noEmit: true, skipLibCheck: true };
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(sources, options));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  process.exit(1);
}
console.log(`Task/storage strict typecheck passed (${sources.length} TS files). ArkTS requires the platform build.`);
require.extensions['.ts'] = function (module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: options }).outputText, filename);
};
require('../tests/tasks/tasks.test.cjs');
