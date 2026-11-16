const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ts=require(process.env.TYPESCRIPT_PATH||'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript');
const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,lib:['lib.es2020.d.ts','lib.dom.d.ts'],types:[],skipLibCheck:true};
const sources=['data/CommitServices.ts','domain/MaterialCommitValidation.ts','domain/TaskStateRules.ts'].map(f=>path.join(root,'client/entry/src/main/ets',f));
const errors=ts.getPreEmitDiagnostics(ts.createProgram(sources,options));
if(errors.length){console.error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=>'\n'}));process.exit(1);}
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:options}).outputText,f);
console.log('Material/status commit strict TypeScript passed; actual shared services with synthetic memory files.');
require('../tests/materials/materials.test.cjs');
