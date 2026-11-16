import common from '@ohos.app.ability.common';
import { ArkFilePort } from '../adapters/storage/ArkFilePort';
import { CommitProbeReport, stageCommitProbe, confirmCommitProbe, cancelCommitProbe, readCommitProbe } from '../data/diagnostics/CommitProbe';
import { NoticeRecoveryReport, beginNoticeRecoveryProbe, inspectNoticeRecoveryProbe,
  confirmNoticeRecoveryProbe, cancelNoticeRecoveryProbe } from '../data/diagnostics/NoticeRecoveryProbe';

@Entry
@Component
struct CommitCheck {
  @State busy: boolean = false;
  @State detail: string = '仅使用独立目录的人工数据，不调用模型。';
  @State recoveryDetail: string = 'T19 恢复验证尚未开始；每个新场景使用单独合成目录。';

  private async recovery(action: string, scenario: string = 'apply-failure'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const index: ArkFilePort = new ArkFilePort(context.filesDir, 'campus-ddl-t19-recovery-index');
      await index.ensureDirectory('');
      const namespace: string = action === 'begin' ? 'campus-ddl-t19-recovery-' + Date.now().toString() : await index.readText('last.txt');
      if (!/^campus-ddl-t19-recovery-\d+$/.test(namespace)) throw new Error('Invalid recovery namespace');
      const files: ArkFilePort = new ArkFilePort(context.filesDir, namespace);
      let report: NoticeRecoveryReport;
      if (action === 'begin') {
        report = await beginNoticeRecoveryProbe(files, scenario);
        await index.writeText('last.txt', namespace);
      } else if (action === 'confirm') report = await confirmNoticeRecoveryProbe(files);
      else if (action === 'cancel') report = await cancelNoticeRecoveryProbe(files);
      else report = await inspectNoticeRecoveryProbe(files);
      this.recoveryDetail = '通过：' + report.scenario + ' / ' + report.phase + ' / revision=' + report.revision +
        '\n' + report.checks.join('\n');
    } catch (error) {
      this.recoveryDetail = '未通过：' + (error as Error).message + '\n原有文件保留，未自动清空或改用正式目录。';
    } finally { this.busy = false; }
  }

  private async run(action: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const index: ArkFilePort = new ArkFilePort(context.filesDir, 'campus-ddl-t16-index');
      await index.ensureDirectory('');
      const namespace: string = action === 'stage' ? 'campus-ddl-t16-' + Date.now().toString() : await index.readText('last.txt');
      if (!/^campus-ddl-t16-\d+$/.test(namespace)) throw new Error('Invalid probe namespace');
      const files: ArkFilePort = new ArkFilePort(context.filesDir, namespace);
      let report: CommitProbeReport;
      if (action === 'stage') { report = await stageCommitProbe(files); await index.writeText('last.txt', namespace); }
      else if (action === 'confirm') report = await confirmCommitProbe(files);
      else if (action === 'cancel') report = await cancelCommitProbe(files);
      else report = await readCommitProbe(files);
      this.detail = '通过：' + report.phase + '，revision=' + report.revision + '\n' + report.checks.join('\n');
    } catch (error) {
      this.detail = '未通过：请保留现有数据；先创建人工方案，确认/取消后不可重复切换状态。';
    } finally { this.busy = false; }
  }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('T16 幂等提交验证').fontSize(24).fontWeight(FontWeight.Bold)
        Text('开发验证页 · 独立人工目录').fontSize(14)
        Text('创建方案后可先停止应用再读取；任务、来源与2项材料尚未正式保存。确认按钮只提交本页人工数据，含一次受控写失败和明确重试验证。').fontSize(14)
        Button('1. 创建人工待确认方案').id('t16-stage').enabled(!this.busy).onClick(() => { this.run('stage'); })
        Button('2. 确认并提交人工方案').id('t16-confirm').enabled(!this.busy).onClick(() => { this.run('confirm'); })
        Button('取消人工方案').id('t16-cancel').enabled(!this.busy).onClick(() => { this.run('cancel'); })
        Button('3. 重启读取与旧操作重试').id('t16-read').enabled(!this.busy).onClick(() => { this.run('read'); })
        Text(this.busy ? '正在验证…' : this.detail).id('t16-result').fontSize(16).copyOption(CopyOptions.InApp)
        Divider().margin({ top: 18, bottom: 8 })
        Text('T19 通知保存与恢复验证').fontSize(22).fontWeight(FontWeight.Bold)
        Text('仅用于开发：复用正式通知确认核心，不调用模型或语音。每次创建使用全新合成目录，现有任务不受影响。').fontSize(14)
        Text('先选场景，再可重启应用并只读恢复。只有“明确确认合成方案”才重试待确认保存。缺失路径是真实文件API错误；应答丢失为替换成功后的受控抛错，不等于物理断电。').fontSize(14)
        Button('创建合成方案并模拟保存失败').id('t19-recovery-begin').enabled(!this.busy)
          .onClick(() => { this.recovery('begin'); })
        Button('验证同一实例失败后原请求重试').id('t19-recovery-retry').enabled(!this.busy)
          .onClick(() => { this.recovery('begin', 'same-instance-retry'); })
        Button('模拟暂存成功但应答丢失').id('t19-recovery-stage-ack').enabled(!this.busy)
          .onClick(() => { this.recovery('begin', 'stage-ack-loss'); })
        Button('模拟提交成功但替换应答丢失').id('t19-recovery-apply-ack').enabled(!this.busy)
          .onClick(() => { this.recovery('begin', 'apply-ack-loss'); })
        Button('模拟失败后发生独立版本变化').id('t19-recovery-conflict').enabled(!this.busy)
          .onClick(() => { this.recovery('begin', 'conflict'); })
        Button('只读恢复/重启回读合成结果').id('t19-recovery-read').enabled(!this.busy)
          .onClick(() => { this.recovery('read'); })
        Button('明确确认合成方案').id('t19-recovery-confirm').enabled(!this.busy)
          .onClick(() => { this.recovery('confirm'); })
        Button('取消合成暂存方案').id('t19-recovery-cancel').enabled(!this.busy)
          .onClick(() => { this.recovery('cancel'); })
        Text(this.busy ? '正在验证合成恢复…' : this.recoveryDetail).id('t19-recovery-result')
          .fontSize(15).copyOption(CopyOptions.InApp)
      }.padding(20).width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%')
  }
}
