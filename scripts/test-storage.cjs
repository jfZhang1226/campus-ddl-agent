/* Run with Node.js >= 18 and a local TypeScript installation. No package download. */
const fs = require('node:fs');
const path = require('node:path');

const studio = process.env.DEVECO_CLI_STUDIO_PATH;
const candidates = [
  process.env.T08_TYPESCRIPT_PATH,
  studio && path.join(studio, 'tools/hvigor/hvigor/node_modules/typescript'),
  studio && path.join(studio, 'tools/ohpm/node_modules/typescript'),
  'typescript'
].filter(Boolean);
let ts;
for (const candidate of candidates) {
  try { ts = require(candidate); break; } catch (_) { /* Try the next installed copy. */ }
}
if (!ts) {
  console.error('TypeScript not found. Activate the DevEco environment or set T08_TYPESCRIPT_PATH to an installed TypeScript package.');
  process.exit(1);
}

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
const program = ts.createProgram(sources, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  process.exit(1);
}
console.log(`Storage core strict typecheck passed (${sources.length} files). Platform .ets files require the actual ArkTS build.`);
require.extensions['.ts'] = function loadTypeScript(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: options });
  module._compile(output.outputText, filename);
};
require('../tests/storage/storage.test.cjs');
