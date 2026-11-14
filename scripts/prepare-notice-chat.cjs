// T19 local integration export. Reuse T13's editable page; keep production entry and signing untouched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepare: prepareVoice } = require('./prepare-voice-chat.cjs');
const root = path.resolve(__dirname, '..');
function replaceOnce(text, from, to) {
  if (!text.includes(from) || text.indexOf(from) !== text.lastIndexOf(from)) {
    throw Error('T13/T15 source changed; review the T19 assembly anchor: ' + from.slice(0, 70));
  }
  return text.replace(from, to);
}
function prepare(output) {
  const result = prepareVoice(output);
  const write = (file, text) => fs.writeFileSync(path.join(result.output, file), text);
  const pages = 'entry/src/main/ets/pages/';
  for (const file of ['NoticeVoiceController.ts', 'NoticeConfirmedWriter.ts', 'NoticeSaveController.ts', 'NoticeSpeechOwner.ets']) {
    const source = fs.readFileSync(path.join(root, 'probes/harmony-noticechat', file), 'utf8');
    write(pages + file, source.replaceAll('../../client/entry/src/main/ets/', '../'));
  }
  let page = fs.readFileSync(path.join(root, 'client/entry/src/main/ets/pages/NoticeImport.ets'), 'utf8').replaceAll('\r\n', '\n');
  page = replaceOnce(page, "import { ArkNoticeExtractionTransport } from '../adapters/ArkNoticeExtractionTransport';",
    "import { SpeechView } from '../speech/VoiceChatController';\nimport { NoticeSaveController, NoticeSaveView } from './NoticeSaveController';\nimport { noticeSpeechOwner } from './NoticeSpeechOwner';\nimport { voiceChatOwner } from './VoiceChatOwner';");
  page = page.replace("import { chatOwner } from '../chat/ChatOwner';\n", '');
  page = page.replace("import { NoticeImportRepository } from '../data/NoticeImportRepository';\n", '');
  page = page.replace('NoticeImportController, NoticeImportState', 'NoticeImportState');
  page = page.replace('struct NoticeImportPage', 'struct NoticeChatPage');
  page = page.replace('private controller: NoticeImportController | null = null;',
    "@State speech: SpeechView = new SpeechView();\n  @State save: NoticeSaveView = new NoticeSaveView();\n  @State metadataOpen: boolean = false;\n  private controller: NoticeSaveController | null = null;\n  private pageAlive: boolean = false;");
  page = replaceOnce(page, '    this.initialize();', '    this.pageAlive = true;\n    this.initialize();');
  page = replaceOnce(page, '  aboutToDisappear(): void {', '  aboutToDisappear(): void {\n    this.pageAlive = false;');
  page = replaceOnce(page, '      this.controller.dispose();', '      noticeSpeechOwner.destroy();');
  page = replaceOnce(page, "return this.view.phase === 'saving';", "return this.save.busy || this.view.phase === 'saving';");
  page = replaceOnce(page, 'new NoticeImportRepository(getClientStorage(context.filesDir).local)',
    'getClientStorage(context.filesDir).local');
  page = replaceOnce(page, '      const revision = await repository.revision();',
    '      const local = await repository.read();\n      const revision = { success: local.success, data: local.data === null ? null : local.data.revision };\n      if (!this.pageAlive) return;');
  page = replaceOnce(page, 'new NoticeImportController(new ArkNoticeExtractionTransport(), repository)',
    'noticeSpeechOwner.get(context)');
  page = replaceOnce(page, 'chatOwner.get().configuration()', 'voiceChatOwner.get(context).configuration()');
  page = replaceOnce(page, '      this.controller.subscribe((state: NoticeImportState) => {',
    '      this.controller.subscribeSpeech((value: SpeechView) => { this.speech = value; });\n      this.controller.subscribeSave((value: NoticeSaveView) => { this.save = value; });\n      this.controller.subscribe((state: NoticeImportState) => {');
  page = replaceOnce(page, '        this.view = state;\n      });', '        this.view = state;\n      });\n      await this.controller.restore();');
  page = replaceOnce(page, "return this.view.phase === 'extracting' || this.view.phase === 'saving';",
    "return this.save.busy || this.speech.busy || ['extracting', 'saving', 'refreshing'].includes(this.view.phase);");
  page = page.replace('导入校园通知', '通知草案联调').replace('先整理为草案，确认后才写入任务', '直接贴原文或语音输入，让模型整理');
  page = page.replace('修改仅保留在当前页面，点击确认后才写入', '确认后任务、来源和材料一起保存；失败可重试');
  page = replaceOnce(page, "Button('确认并正式保存')", "Button(this.save.locked ? '核对后重试确认' : '确认并正式保存')");
  page = page.replaceAll(".enabled(!this.busy() && this.view.phase !== 'saved')", ".enabled(!this.busy() && !this.save.locked && this.view.phase !== 'saved')");
  // The confirmation button stays available for a retained request; editing remains locked.
  page = page.replace(".id('notice-confirm').enabled(!this.busy() && !this.save.locked && this.view.phase !== 'saved')",
    ".id('notice-confirm').enabled(!this.busy() && this.view.phase !== 'saved')");
  page = page.replace(/(TextInput\(\{[^}]*\}\))/g, '$1.enabled(!this.save.locked && !this.busy())');
  page = replaceOnce(page, "Text('通知原文').fontSize(14)", "Text('把通知放进来').fontSize(14)");
  const metadataStart = page.indexOf('      TextInput({ text: this.view.sourceLabel,');
  const metadataEnd = page.indexOf("      Button(this.view.phase === 'extracting'", metadataStart);
  if (metadataStart < 0 || metadataEnd < metadataStart) throw Error('Review T13 source metadata anchors.');
  const metadata = page.slice(metadataStart, metadataEnd);
  page = page.slice(0, metadataStart) + `      Button(this.metadataOpen ? '收起来源信息' : '补充来源信息（可选）')
        .fontSize(12).height(30).fontColor('#617589').backgroundColor('#EDF4F2')
        .enabled(!this.busy()).onClick(() => { this.metadataOpen = !this.metadataOpen; })
      if (this.metadataOpen) {
` + metadata + '      }\n' + page.slice(metadataEnd);
  page = replaceOnce(page, "Button(this.view.phase === 'extracting' ? '正在提取…' : '提取为可编辑草案')",
    "Button(this.view.phase === 'extracting' ? '正在理解…' : (this.view.draft === null ? '发送通知原文' : '保留修改并继续整理'))");
  page = replaceOnce(page, '              this.sourceEditor()', '              this.voiceInput()\n              this.sourceEditor()');
  const voiceBuilder = `  @Builder
  voiceInput() {
    Column({ space: 8 }) {
      Text('读完立即结束录音，转写后先核对再发送。').fontSize(12).fontColor('#617589')
      Row({ space: 7 }) {
        Button('开始录音').id('notice-record').fontSize(12).enabled(!this.busy() && !this.save.locked)
          .onClick(() => { this.controller?.record(); })
        Button('结束录音').id('notice-finish').fontSize(12).enabled(this.speech.phase === 'recording')
          .onClick(() => { this.controller?.finishRecording(); })
        Button('取消语音').id('notice-cancel-voice').fontSize(12).enabled(this.speech.busy)
          .onClick(() => { this.controller?.cancelVoice(); })
      }
      Text('语音：' + this.speech.phase + (this.speech.errorCode.length > 0 ? ' · ' + this.speech.errorCode : ''))
        .id('notice-speech-state').fontSize(12).fontColor('#617589')
      if (this.speech.partial.length > 0) { Text(this.speech.partial).fontSize(13) }
      Row({ space: 8 }) {
        Button('播报当前草案').id('notice-speak').fontSize(12)
          .enabled(!this.busy() && this.view.draft !== null).onClick(() => { this.controller?.speakDraft(); })
        Button('停止播报').id('notice-stop-speech').fontSize(12)
          .enabled(this.speech.phase === 'speaking' || this.speech.phase === 'tts_initializing')
          .onClick(() => { this.controller?.cancelVoice(); })
      }
      Text('未确认的编辑仅在本页；已暂存的方案可在重启后恢复，核对后再确认。')
        .fontSize(11).fontColor('#8A5A12').lineHeight(17)
    }.alignItems(HorizontalAlign.Start).width('100%').padding(12).backgroundColor('#FFFFFF').borderRadius(12)
  }

`;
  page = replaceOnce(page, '  build() {', voiceBuilder + '  build() {');
  const commitBuilder = `  @Builder
  commitFeedback() {
    Column({ space: 8 }) {
      if (this.save.message.length > 0) { Text(this.save.message).fontSize(12).fontColor('#8A5A12') }
      if (this.save.readbackError.length > 0) { Text(this.save.readbackError).fontSize(12).fontColor('#A43B32') }
      if (this.save.locked) {
        Button('取消暂存后重新修改').id('notice-discard-pending').enabled(!this.busy())
          .onClick(() => { this.controller?.cancelPending(); })
        Button('重新读取暂存结果').id('notice-recover-pending').enabled(!this.busy())
          .onClick(() => { this.controller?.restore(); })
      }
      if (this.save.saved !== null) {
        Text('最近已保存任务（本机回读）').fontSize(14).fontWeight(FontWeight.Bold)
        Text(this.save.saved.task.title).id('notice-readback-title').fontSize(14)
        Text('截止：' + (this.save.saved.task.dueAt === null ?
          (this.save.saved.task.deadlineDate === null ? '待补充' : this.save.saved.task.deadlineDate + '（具体时刻未知）') :
          this.save.saved.task.dueAt)).fontSize(12)
        ForEach(this.save.saved.checklistItems, (item) => {
          Text(item.label + ' · ' + (item.sourceNoticeId === null ? '人工补充' : '原通知') +
            ' · ' + (item.state === 'pending' ? '待准备' : '用户标记已准备')).fontSize(12)
        }, (item) => item.id)
      }
      Button('重新读取已保存结果').id('notice-readback').enabled(!this.busy())
        .onClick(() => { this.controller?.readSaved(); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#EAF4F0').borderRadius(12)
  }

`;
  page = replaceOnce(page, '  build() {', commitBuilder + '  build() {');
  page = replaceOnce(page, '            this.feedback()', '            this.commitFeedback()\n            this.feedback()');
  page = "import { ChecklistItem } from '../domain/StorageModels';\n" + page;
  page = page.replaceAll('(item) =>', '(item: ChecklistItem) =>');
  write(pages + 'NoticeChat.ets', page);
  let voicePage = fs.readFileSync(path.join(root, 'probes/harmony-voicechat/VoiceChat.ets'), 'utf8');
  voicePage = replaceOnce(voicePage, "      if (this.settingsOpen) { this.settings() }", `      Button('通知草案联调').id('open-notice-chat')
        .enabled(!this.view.chat.busy && !this.view.speech.busy)
        .onClick(() => {
          this.controller?.pause();
          router.pushUrl({ url: 'pages/NoticeChat' }).catch(() => { this.view.notice = '无法打开通知草案页。'; });
        })
      if (this.settingsOpen) { this.settings() }`);
  write(pages + 'VoiceChat.ets', voicePage);
  let ability = fs.readFileSync(path.join(root, 'probes/harmony-voicechat/EntryAbility.ets'), 'utf8');
  ability = "import { noticeSpeechOwner } from '../pages/NoticeSpeechOwner';\n" + ability;
  ability = ability.replaceAll('voiceChatOwner.pause();', 'noticeSpeechOwner.pause(); voiceChatOwner.pause();');
  ability = ability.replaceAll('voiceChatOwner.destroy();', 'noticeSpeechOwner.destroy(); voiceChatOwner.destroy();');
  write('entry/src/main/ets/entryability/EntryAbility.ets', ability);
  const appFile = path.join(result.output, 'AppScope/app.json5');
  const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
  app.app.bundleName = 'com.campusddl.noticeprobe'; app.app.versionName = '0.2.0'; app.app.versionCode = 200;
  fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n');
  const stringsFile = path.join(result.output, 'entry/src/main/resources/base/element/string.json');
  const strings = JSON.parse(fs.readFileSync(stringsFile, 'utf8'));
  for (const row of strings.string) if (row.name === 'EntryAbility_label') row.value = '课事清通知联调';
  fs.writeFileSync(stringsFile, JSON.stringify(strings, null, 2) + '\n');
  write('entry/src/main/resources/base/profile/main_pages.json', JSON.stringify({src:[
    'pages/VoiceChat', 'pages/NoticeChat', 'pages/SpeechProbe'
  ]}, null, 2) + '\n');
  for (const file of ['T15-VOICE-CHAT-ONLY.txt', 'T15-source-manifest.json']) fs.unlinkSync(path.join(result.output, file));
  write('T19-NOTICE-INTERACTION-ONLY.txt',
    'Local T13/T16/D integration candidate. Manual raw-text/ASR extraction, editable draft and manual TTS.\n' +
    'Explicit client confirmation uses T16 v2; pending recovery, same-request retry and local result readback.\n' +
    'New independent bundle. Unsigned/uninstalled until explicit device evidence is recorded.\n');
  const hashes = {};
  for (const file of [pages + 'NoticeChat.ets', pages + 'NoticeVoiceController.ts', pages + 'NoticeConfirmedWriter.ts', pages + 'NoticeSaveController.ts',
    pages + 'NoticeSpeechOwner.ets', 'entry/src/main/ets/notice/NoticeImportController.ts']) {
    hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(result.output, file))).digest('hex');
  }
  const manifest = {...result, scope:'T19-local-integration', bundleName:app.app.bundleName,
    versionCode:200, formalSaveEnabled:true, hashes};
  write('T19-source-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (require.main === module) console.log(JSON.stringify(prepare(process.argv[2]), null, 2));
module.exports = {prepare};
