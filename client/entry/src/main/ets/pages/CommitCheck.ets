import common from '@ohos.app.ability.common';
import { ArkFilePort } from '../adapters/storage/ArkFilePort';
import { CommitProbeReport, stageCommitProbe, confirmCommitProbe, cancelCommitProbe, readCommitProbe } from '../data/diagnostics/CommitProbe';

@Entry
@Component
struct CommitCheck {
  @State busy: boolean = false;
  @State detail: string = '仅使用独立目录的人工数据，不调用模型。';

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
        Text('创建方案后可先停止应用再读取；任务尚未正式保存。确认按钮只提交本页人工任务，含一次受控写失败和明确重试验证。').fontSize(14)
        Button('1. 创建人工待确认方案').id('t16-stage').enabled(!this.busy).onClick(() => { this.run('stage'); })
        Button('2. 确认并提交人工方案').id('t16-confirm').enabled(!this.busy).onClick(() => { this.run('confirm'); })
        Button('取消人工方案').id('t16-cancel').enabled(!this.busy).onClick(() => { this.run('cancel'); })
        Button('3. 重启读取与旧操作重试').id('t16-read').enabled(!this.busy).onClick(() => { this.run('read'); })
        Text(this.busy ? '正在验证…' : this.detail).id('t16-result').fontSize(16).copyOption(CopyOptions.InApp)
      }.padding(20).width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%')
  }
}
