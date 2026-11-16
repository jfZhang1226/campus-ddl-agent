const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ts=require(process.env.TYPESCRIPT_PATH||'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript');
const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,lib:['lib.es2020.d.ts','lib.dom.d.ts'],types:[],skipLibCheck:true};
const source=path.join(root,'client/entry/src/main/ets/planning/WeekPlanner.ts');
const errors=ts.getPreEmitDiagnostics(ts.createProgram([source],options));
if(errors.length){console.error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));process.exit(1);}
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:options}).outputText,f);
console.log('Week plan strict TypeScript passed; pure deterministic candidates, no persistence/model/device.');
require('../tests/planning/week-plan.test.cjs');
