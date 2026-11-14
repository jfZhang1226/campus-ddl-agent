const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(process.env.T08_TYPESCRIPT_PATH || path.join(process.env.DEVECO_CLI_STUDIO_PATH,
  'tools/hvigor/hvigor/node_modules/typescript'));
const options = {strict:true, noEmit:true, target:ts.ScriptTarget.ES2020,
  module:ts.ModuleKind.CommonJS, lib:['lib.es2020.d.ts','lib.dom.d.ts'], types:[], skipLibCheck:true};
const files = ['probes/harmony-noticechat/NoticeVoiceController.ts', 'probes/harmony-noticechat/NoticeCommitGate.ts',
  'probes/harmony-noticechat/NoticeConfirmedWriter.ts', 'probes/harmony-noticechat/NoticeSaveController.ts',
  'probes/harmony-speech/SpeechProbeController.ts'].map(file => path.join(root, file));
const errors = ts.getPreEmitDiagnostics(ts.createProgram(files, options));
if (errors.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName:x=>x, getCurrentDirectory:()=>root, getNewLine:()=> '\n'
  }));
  process.exit(1);
}
console.log('T19 interaction strict TypeScript passed; native ArkTS still requires an SDK build.');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'),
  {compilerOptions:options}).outputText, f);
require('../tests/notice/notice-interaction.test.cjs');
