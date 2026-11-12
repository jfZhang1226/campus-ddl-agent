const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {prepare} = require('./prepare-notice-chat.cjs');
const root = path.resolve(__dirname,'..');
const runtime = path.join(root,'runtime');fs.mkdirSync(runtime,{recursive:true});
const testRoot = fs.mkdtempSync(path.join(runtime,'t19-export-'));
const output = path.join(testRoot,'export');
const read = file => fs.readFileSync(path.join(output,file),'utf8');
const json = file => JSON.parse(read(file));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = cp.execFileSync('git',['status','--porcelain','--','client/'],{cwd:root,encoding:'utf8'});
const manifest = prepare(output);
let count=0;
function check(name,run) {run();count++;console.log('PASS '+name);}
check('independent bundle, empty signing, and only microphone/internet permissions',()=>{
  assert.equal(json('AppScope/app.json5').app.bundleName,'com.campusddl.noticeprobe');
  assert.deepEqual(json('build-profile.json5').app.signingConfigs,[]);
  assert.deepEqual(json('entry/src/main/module.json5').module.requestPermissions.map(x=>x.name).sort(),
    ['ohos.permission.INTERNET','ohos.permission.MICROPHONE']);
});
check('actual page assembly keeps raw input, optional collapsed metadata, editing and cancelled-save notice',()=>{
  const page=read('entry/src/main/ets/pages/NoticeChat.ets');
  assert.match(page,/metadataOpen: boolean = false/);
  assert.match(page,/发送通知原文/);assert.match(page,/保留修改并继续整理/);
  assert.match(page,/notice-confirm'\)\.enabled\(false\)/);
  assert.match(page,/new NoticeCommitGate/);assert.doesNotMatch(page,/new NoticeImportRepository/);
  assert.match(page,/noticeSpeechOwner\.get/);assert.match(page,/voiceChatOwner\.get\(context\)\.configuration/);
  assert.match(page,/尚未接通/);
});
check('record, end, cancel, manual draft playback and immediate stop are reachable',()=>{
  const page=read('entry/src/main/ets/pages/NoticeChat.ets');
  for(const id of ['notice-record','notice-finish','notice-cancel-voice','notice-speak','notice-stop-speech'])
    assert.ok(page.includes(".id('"+id+"')"));
  assert.match(read('entry/src/main/ets/pages/VoiceChat.ets'),/pages\/NoticeChat/);
  assert.deepEqual(json('entry/src/main/resources/base/profile/main_pages.json').src,
    ['pages/VoiceChat','pages/NoticeChat','pages/SpeechProbe']);
});
check('native owner and lifecycle release are confined to the exported assembly',()=>{
  const ability=read('entry/src/main/ets/entryability/EntryAbility.ets');
  assert.match(ability,/onBackground.*noticeSpeechOwner\.pause/);
  assert.match(ability,/onDestroy.*noticeSpeechOwner\.destroy/);
  const port=read('entry/src/main/ets/pages/NoticeVoiceController.ts');
  assert.doesNotMatch(port,/\.\.\/\.\.\/client\//);
  assert.equal(json('.arkui-x/arkui-x-config.json5').buildOption.ignoreCrossPlatform,true);
});
check('production pages and client files are preserved except explicit export configuration',()=>{
  const changed=new Set(['build-profile.json5','.arkui-x/arkui-x-config.json5','AppScope/app.json5',
    'entry/src/main/module.json5','entry/src/main/resources/base/element/string.json',
    'entry/src/main/ets/entryability/EntryAbility.ets','entry/src/main/resources/base/profile/main_pages.json']);
  const files=cp.execFileSync('git',['ls-files','-z','client/'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const file of files)if(!changed.has(file.slice(7)))
    assert.equal(hash(path.join(root,file)),hash(path.join(output,file.slice(7))),file);
  assert.equal(cp.execFileSync('git',['status','--porcelain','--','client/'],{cwd:root,encoding:'utf8'}),before);
});
check('manifest matches five actual source outputs and existing export is refused without overwrite',()=>{
  assert.equal(manifest.formalSaveEnabled,false);assert.equal(Object.keys(manifest.hashes).length,5);
  for(const [file,expected]of Object.entries(manifest.hashes))assert.equal(hash(path.join(output,file)),expected);
  const prior=hash(path.join(output,'T19-source-manifest.json'));
  assert.throws(()=>prepare(output),/new output directory/);
  assert.equal(hash(path.join(output,'T19-source-manifest.json')),prior);
  assert.equal(fs.existsSync(path.join(output,'T15-source-manifest.json')),false);
  assert.match(read('T19-NOTICE-INTERACTION-ONLY.txt'),/No formal task save/);
});
console.log(`${count} T19 source-export checks passed. No signing, network, microphone or device calls.`);
