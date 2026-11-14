const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ts=require(process.env.T08_TYPESCRIPT_PATH||path.join(process.env.DEVECO_CLI_STUDIO_PATH,'tools/hvigor/hvigor/node_modules/typescript'));
const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,types:[],skipLibCheck:true};
const errors=ts.getPreEmitDiagnostics(ts.createProgram(['NoticeConfirmedWriter.ts','NoticeSaveController.ts'].map(f=>path.join(root,'probes/harmony-noticechat',f)),options));
if(errors.length){console.error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=>'\n'}));process.exit(1);}
console.log('T19 confirmed-save strict TypeScript passed; native UI requires SDK build.');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:options}).outputText,f);
require('../tests/notice/notice-save.test.cjs');
