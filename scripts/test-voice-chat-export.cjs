// Inspect an actual fresh export. No SDK build, signing, network, microphone or device calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { prepare } = require('./prepare-voice-chat.cjs');
const root = path.resolve(__dirname, '..');
const temporaryRoot = path.resolve(os.tmpdir());
const testRoot = fs.mkdtempSync(path.join(temporaryRoot, 'campusddl-t15-export-'));
const output = path.join(testRoot, 'export');
const read = file => fs.readFileSync(path.join(output, file), 'utf8');
const json = file => JSON.parse(read(file));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const status = () => cp.execFileSync('git', ['status', '--porcelain', '--', 'client/'],
  { cwd: root, encoding: 'utf8' });
const clientBefore = status();
let passed = 0;
function check(name, run) { run(); passed++; console.log('PASS ' + name); }
try {
  const manifest = prepare(output);
  check('fresh export keeps an independent bundle and only the two required permissions', () => {
    const app = json('AppScope/app.json5').app;
    assert.equal(app.bundleName, 'com.campusddl.speechprobe');
    assert.equal(app.versionCode, 200);
    assert.deepEqual(json('entry/src/main/module.json5').module.requestPermissions.map(p => p.name).sort(),
      ['ohos.permission.INTERNET', 'ohos.permission.MICROPHONE']);
  });
  check('voice chat entry and original probe page are both present', () => {
    assert.deepEqual(json('entry/src/main/resources/base/profile/main_pages.json').src,
      ['pages/VoiceChat', 'pages/SpeechProbe']);
    assert.match(read('entry/src/main/ets/entryability/EntryAbility.ets'), /pages\/VoiceChat/);
    assert.ok(fs.existsSync(path.join(output, 'entry/src/main/ets/pages/SpeechProbe.ets')));
  });
  check('export strips signing settings and limits platform override to the export', () => {
    assert.deepEqual(json('build-profile.json5').app.signingConfigs, []);
    assert.equal(json('.arkui-x/arkui-x-config.json5').buildOption.ignoreCrossPlatform, true);
    assert.equal(status(), clientBefore);
  });
  check('export notice describes T15 and does not retain the obsolete no-model T09 notice', () => {
    assert.equal(fs.existsSync(path.join(output, 'T09-PROBE-ONLY.txt')), false);
    assert.match(read('T15-VOICE-CHAT-ONLY.txt'), /never saves tasks/);
    assert.match(read('T15-VOICE-CHAT-ONLY.txt'), /model gateway/);
    assert.ok(json('entry/src/main/resources/base/element/string.json').string
      .some(row => row.name === 'EntryAbility_label' && row.value === '课事清语音联调'));
  });
  check('seven source fingerprints match both source and exported code', () => {
    assert.equal(Object.keys(manifest.hashes).length, 7);
    for (const [file, expected] of Object.entries(manifest.hashes)) {
      const destination = file.startsWith('client/') ? file.slice('client/'.length)
        : 'entry/src/main/ets/' + (file.endsWith('/EntryAbility.ets') ? 'entryability/' : 'pages/') + path.basename(file);
      assert.equal(sha(path.join(root, file)), expected);
      assert.equal(sha(path.join(output, destination)), expected);
    }
  });
  check('export preserves unrelated tracked client files from the current checkout', () => {
    const changed = new Set(['build-profile.json5', '.arkui-x/arkui-x-config.json5', 'AppScope/app.json5',
      'entry/src/main/module.json5', 'entry/src/main/resources/base/element/string.json',
      'entry/src/main/ets/entryability/EntryAbility.ets', 'entry/src/main/resources/base/profile/main_pages.json']);
    const files = cp.execFileSync('git', ['ls-files', '-z', 'client/'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const file of files) if (!changed.has(file.slice('client/'.length))) {
      assert.equal(sha(path.join(root, file)), sha(path.join(output, file.slice('client/'.length))), file);
    }
  });
  check('export contains only allowlisted source and generated files; existing output is never overwritten', () => {
    const allowed = new Set(cp.execFileSync('git', ['ls-files', '-z', 'client/'],
      { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).map(file => file.slice('client/'.length)));
    for (const file of ['T15-source-manifest.json', 'T15-VOICE-CHAT-ONLY.txt',
      'entry/src/main/ets/pages/VoiceChat.ets', 'entry/src/main/ets/pages/VoiceChatOwner.ets',
      'entry/src/main/ets/speech/VoiceChatController.ts', 'entry/src/main/ets/pages/SpeechProbe.ets',
      'entry/src/main/ets/pages/SpeechProbeOwner.ets', 'entry/src/main/ets/pages/SpeechProbeController.ts',
      'entry/src/main/ets/pages/HarmonySpeechPort.ets']) allowed.add(file);
    function inspect(directory, prefix = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = prefix + entry.name;
        if (entry.isDirectory()) inspect(path.join(directory, entry.name), file + '/');
        else { assert.ok(entry.isFile()); assert.ok(allowed.has(file), file); }
      }
    }
    inspect(output);
    const before = sha(path.join(output, 'T15-source-manifest.json'));
    assert.throws(() => prepare(output), /new output directory/);
    assert.equal(sha(path.join(output, 'T15-source-manifest.json')), before);
    assert.equal(status(), clientBefore);
  });
  console.log(`${passed} T15 export checks passed (source-only artifact inspection).`);
} finally {
  // Remove only this invocation's freshly created temporary child, never a caller-provided path.
  if (path.dirname(testRoot) !== temporaryRoot || !path.basename(testRoot).startsWith('campusddl-t15-export-')) {
    throw new Error('Unexpected temporary cleanup path.');
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
}
