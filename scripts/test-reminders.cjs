const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ts=require(process.env.TYPESCRIPT_PATH||'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript');
const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,lib:['lib.es2020.d.ts','lib.dom.d.ts'],types:[],skipLibCheck:true};
const sources=['ReminderPlan.ts','ReminderSettings.ts','ReminderService.ts','TaskReminderController.ts','CalendarReminderPort.ts'].map(f=>path.join(root,'client/entry/src/main/ets/reminders',f));
const errors=ts.getPreEmitDiagnostics(ts.createProgram(sources,options));
if(errors.length){console.error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=>'\n'}));process.exit(1);}
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:options}).outputText,f);
console.log('Reminder shared strict TypeScript passed; deterministic OS port, no real notification.');
require('../tests/reminders/reminders.test.cjs');
