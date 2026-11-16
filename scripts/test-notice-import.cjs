/* Host checks for T13 extraction, editable confirmation and atomic local import. */
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
for (const directory of [
  'client/entry/src/main/ets/data',
  'client/entry/src/main/ets/domain',
  'client/entry/src/main/ets/chat',
  'client/entry/src/main/ets/notice'
]) {
  const collect = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(name);
      else if (entry.name.endsWith('.ts')) sources.push(name);
    }
  };
  collect(path.join(root, directory));
}
sources.push(path.join(root, 'client/entry/src/main/ets/adapters/storage/FilePort.ts'));
const options = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, strict: true, noEmit: true,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, types: [] };
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(sources, options));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  process.exit(1);
}
console.log(`T13 strict typecheck passed (${sources.length} shared TS sources).`);
require.extensions['.ts'] = function loadTypeScript(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText, filename);
};
require('../tests/notice/notice-import.test.cjs');
