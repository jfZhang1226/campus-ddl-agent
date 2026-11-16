// Production UI/logic in a separate unsigned identity. Never install over the team's business app.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {copyTrackedClient}=require('./export-tracked-client.cjs');
function prepare(output) {
  const result=copyTrackedClient(output);
  const read=f=>JSON.parse(fs.readFileSync(path.join(result.output,f),'utf8'));
  const write=(f,value)=>fs.writeFileSync(path.join(result.output,f),JSON.stringify(value,null,2)+'\n');
  const profile=read('build-profile.json5');profile.app.signingConfigs=[];
  for(const product of profile.app.products)delete product.signingConfig;
  write('build-profile.json5',profile);
  const app=read('AppScope/app.json5');app.app.bundleName='com.campusddl.noticeentry';app.app.versionName='0.3.0';app.app.versionCode=300;
  write('AppScope/app.json5',app);
  const strings=read('entry/src/main/resources/base/element/string.json');
  for(const row of strings.string)if(row.name==='EntryAbility_label')row.value='课事清通知入口验证';
  write('entry/src/main/resources/base/element/string.json',strings);
  const hashes={};
  for(const f of ['pages/NoticeImport.ets','notice/NoticeImportController.ts','notice/NoticeConfirmedWriter.ts',
    'notice/NoticeSaveController.ts','notice/NoticeVoiceController.ts','notice/NoticeImportOwner.ts','speech/UnavailableSpeechSession.ts',
    'entryability/EntryAbility.ets','pages/CommitCheck.ets','data/diagnostics/NoticeRecoveryProbe.ts','notice/NoticeLeaveGuard.ts',
    'pages/Index.ets','pages/TaskAssistant.ets','agent/TaskAgentController.ts','agent/TaskAgentSession.ts',
    'agent/TaskAgentOwner.ets','agent/AgentGatewayProtocol.ts','agent/AgentTools.ts','agent/AgentLoop.ts',
    'agent/AgentExecutor.ts','adapters/ArkAgentGatewayTransport.ets','pages/Tasks.ets','tasks/TaskBoardController.ts']) {
    const file='entry/src/main/ets/'+f;hashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(result.output,file))).digest('hex');
  }
  const manifest={...result,scope:'T19-shared-notice-entry',bundleName:app.app.bundleName,versionCode:300,hashes,
    formalSaveEnabled:true,signed:false,deviceValidated:false};
  write('T19-shared-entry-manifest.json',manifest);
  return manifest;
}
if(require.main===module)console.log(JSON.stringify(prepare(process.argv[2]),null,2));
module.exports={prepare};
