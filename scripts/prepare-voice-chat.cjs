// Harmony-only T15 development assembly. Production page/config remain unchanged.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { prepare: prepareProbe } = require('./prepare-speech-probe.cjs');
const root = path.resolve(__dirname, '..');
function prepare(output) {
  const result = prepareProbe(output);
  const pages = path.join(result.output, 'entry/src/main/ets/pages');
  for (const name of ['VoiceChat.ets', 'VoiceChatOwner.ets']) {
    fs.copyFileSync(path.join(root, 'probes/harmony-voicechat', name), path.join(pages, name));
  }
  fs.copyFileSync(path.join(root, 'probes/harmony-voicechat/EntryAbility.ets'),
    path.join(result.output, 'entry/src/main/ets/entryability/EntryAbility.ets'));
  const target = path.join(result.output, 'entry/src/main/ets/speech');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(root, 'client/entry/src/main/ets/speech/VoiceChatController.ts'),
    path.join(target, 'VoiceChatController.ts'));
  const modulePath = path.join(result.output, 'entry/src/main/module.json5');
  const module = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
  module.module.requestPermissions.push({ name: 'ohos.permission.INTERNET' });
  fs.writeFileSync(modulePath, JSON.stringify(module, null, 2) + '\n');
  const appPath = path.join(result.output, 'AppScope/app.json5');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.app.versionName = '0.2.0'; app.app.versionCode = 200;
  fs.writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
  const stringsPath = path.join(result.output, 'entry/src/main/resources/base/element/string.json');
  const strings = JSON.parse(fs.readFileSync(stringsPath, 'utf8'));
  for (const item of strings.string) if (item.name === 'EntryAbility_label') item.value = '课事清语音联调';
  fs.writeFileSync(stringsPath, JSON.stringify(strings, null, 2) + '\n');
  fs.writeFileSync(path.join(result.output, 'entry/src/main/resources/base/profile/main_pages.json'),
    JSON.stringify({ src: ['pages/VoiceChat', 'pages/SpeechProbe'] }, null, 2) + '\n');
  fs.unlinkSync(path.join(result.output, 'T09-PROBE-ONLY.txt'));
  fs.writeFileSync(path.join(result.output, 'T15-VOICE-CHAT-ONLY.txt'),
    'HarmonyOS-only voice chat validation; ASR fills an editable draft, manual send and manual playback.\n' +
    'This export uses the model gateway but never saves tasks. Production UI and other platforms are not integrated.\n' +
    'Configure the project token at runtime; provider keys and personal signing settings must stay outside Git.\n');
  const hashes = {};
  for (const file of ['client/entry/src/main/ets/speech/VoiceChatController.ts',
    'client/entry/src/main/ets/chat/ChatController.ts', 'probes/harmony-voicechat/VoiceChat.ets',
    'probes/harmony-voicechat/VoiceChatOwner.ets', 'probes/harmony-voicechat/EntryAbility.ets',
    'probes/harmony-speech/SpeechProbeController.ts', 'probes/harmony-speech/HarmonySpeechPort.ets']) {
    hashes[file] = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  }
  const manifest = { ...result, productionClientModified: true, productionPagesModified: false,
    sharedCoordinatorAdded: true, scope: 'T15-Harmony-development', versionCode: 200, hashes,
    workingTree: cp.execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean) };
  fs.writeFileSync(path.join(result.output, 'T15-source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (require.main === module) console.log(JSON.stringify(prepare(process.argv[2]), null, 2));
module.exports = { prepare };
