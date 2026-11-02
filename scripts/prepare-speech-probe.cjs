// Export a separate HarmonyOS-only capability probe. Never modify client/ or copy local signing material.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'probes/harmony-speech');
function prepare(output) {
  output = path.resolve(output);
  if (fs.existsSync(output)) throw new Error('Choose a new output directory; existing probes may contain private signing settings.');
  if (output === root || output.startsWith(path.join(root, 'client') + path.sep) || output === path.join(root, 'client')) {
    throw new Error('Probe output cannot replace client/.');
  }
  const files = cp.execFileSync('git', ['ls-files', '-z', 'client/'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  if (!files.length) throw new Error('Run inside a clone containing the shared client.');
  cp.execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'client/'], { cwd: root });
  // Only Git-tracked source files; no node_modules, HAPs, caches, recording or private signing paths.
  for (const file of files) {
    if (!file.startsWith('client/') || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid source path.');
    const input = path.join(root, file);
    if (!fs.lstatSync(input).isFile()) throw new Error('Only regular source files can be exported.');
    const target = path.join(output, file.slice('client/'.length));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(input, target);
  }
  const profilePath = path.join(output, 'build-profile.json5');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  profile.app.signingConfigs = [];
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');
  // Official platform-differentiation setting, limited to this HarmonyOS-only probe.
  // The native port rejects other OS families; production client keeps its normal check.
  const crossPath = path.join(output, '.arkui-x/arkui-x-config.json5');
  const cross = JSON.parse(fs.readFileSync(crossPath, 'utf8'));
  cross.buildOption = { ...(cross.buildOption || {}), ignoreCrossPlatform: true };
  fs.writeFileSync(crossPath, JSON.stringify(cross, null, 2) + '\n');
  const appPath = path.join(output, 'AppScope/app.json5');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.app.bundleName = 'com.campusddl.speechprobe';
  app.app.versionName = '0.1.0'; app.app.versionCode = 100;
  fs.writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
  const modulePath = path.join(output, 'entry/src/main/module.json5');
  const module = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
  module.module.requestPermissions = [{ name: 'ohos.permission.MICROPHONE', reason: '$string:speech_microphone_reason',
    usedScene: { abilities: ['EntryAbility'], when: 'inuse' } }];
  fs.writeFileSync(modulePath, JSON.stringify(module, null, 2) + '\n');
  const stringsPath = path.join(output, 'entry/src/main/resources/base/element/string.json');
  const strings = JSON.parse(fs.readFileSync(stringsPath, 'utf8'));
  strings.string.push({ name: 'speech_microphone_reason', value: '仅在你点击录音时进行本机语音转文字能力探测' });
  for (const text of strings.string) if (text.name === 'EntryAbility_label') text.value = '课事清语音探测';
  fs.writeFileSync(stringsPath, JSON.stringify(strings, null, 2) + '\n');
  const pages = path.join(output, 'entry/src/main/ets/pages');
  for (const name of ['SpeechProbe.ets', 'SpeechProbeOwner.ets', 'SpeechProbeController.ts', 'HarmonySpeechPort.ets']) {
    fs.copyFileSync(path.join(source, name), path.join(pages, name));
  }
  // The owner lives beside the probe page; EntryAbility uses that exported path.
  fs.copyFileSync(path.join(source, 'EntryAbility.ets'), path.join(output, 'entry/src/main/ets/entryability/EntryAbility.ets'));
  const abilityPath = path.join(output, 'entry/src/main/ets/entryability/EntryAbility.ets');
  fs.writeFileSync(abilityPath, fs.readFileSync(abilityPath, 'utf8').replace("'./pages/SpeechProbeOwner'", "'../pages/SpeechProbeOwner'"));
  fs.writeFileSync(path.join(output, 'entry/src/main/resources/base/profile/main_pages.json'),
    JSON.stringify({ src: ['pages/SpeechProbe'] }, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'T09-PROBE-ONLY.txt'),
    'HarmonyOS-only capability probe; no model/task/storage integration. Do not build Android from this export.\n' +
    'Personal signing settings belong only in this ignored export. Build/install/voice remain unverified until recorded.\n');
  return { output, baseRevision: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    copiedFiles: files.length, bundleName: app.app.bundleName, productionClientModified: false };
}
if (require.main === module) {
  const output = process.argv[2] || path.join(source, '.generated', String(Date.now()));
  console.log(JSON.stringify(prepare(output), null, 2));
}
module.exports = { prepare };
