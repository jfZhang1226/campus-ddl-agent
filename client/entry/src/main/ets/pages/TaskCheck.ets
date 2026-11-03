import common from '@ohos.app.ability.common';
import { ArkFilePort } from '../adapters/storage/ArkFilePort';
import { readTaskProbe, writeTaskProbe, TaskProbeReport } from '../data/diagnostics/TaskProbe';

@Entry
@Component
struct TaskCheck {
  @State busy: boolean = false;
  @State detail: string = '仅使用独立目录中的人工任务，不调用模型。';

  private async run(write: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const index: ArkFilePort = new ArkFilePort(context.filesDir, 'campus-ddl-t14-index');
      await index.ensureDirectory('');
      const namespace: string = write ? 'campus-ddl-t14-' + Date.now().toString() : await index.readText('last.txt');
      if (!/^campus-ddl-t14-\d+$/.test(namespace)) throw new Error('Invalid probe namespace');
      const files: ArkFilePort = new ArkFilePort(context.filesDir, namespace);
      const report: TaskProbeReport = write ? await writeTaskProbe(files) : await readTaskProbe(files);
      if (write) await index.writeText('last.txt', namespace);
      this.detail = '通过：revision=' + report.revision + '\n' + report.checks.join('\n');
    } catch (error) {
      this.detail = '未通过：请保留现有数据和输入，记录结果后复核；首次读取前需先写入人工样例。';
    } finally { this.busy = false; }
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('T14 任务接口验证').fontSize(24).fontWeight(FontWeight.Bold)
        Text('开发验证页 · 独立人工目录').fontSize(14)
        Button('1. 验证并保存任务').id('t14-write').enabled(!this.busy).onClick(() => { this.run(true); })
        Button('2. 读取重启结果').id('t14-read').enabled(!this.busy).onClick(() => { this.run(false); })
        Text('写入完成后停止应用进程，再启动并读取。离线读取也应一致。').fontSize(14)
        Text(this.busy ? '正在验证…' : this.detail).id('t14-result').fontSize(16).copyOption(CopyOptions.InApp)
      }.padding(20).width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%')
  }
}
