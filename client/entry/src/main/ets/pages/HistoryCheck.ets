import common from '@ohos.app.ability.common';
import { ArkFilePort } from '../adapters/storage/ArkFilePort';
import { HistoryProbeLine, HistoryProbeReport, readHistoryProbe, writeHistoryProbe } from '../data/diagnostics/HistoryProbe';

@Entry
@Component
struct HistoryCheck {
  @State busy: boolean = false;
  @State lines: HistoryProbeLine[] = [];
  private files: ArkFilePort | null = null;

  aboutToAppear(): void {
    const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.files = new ArkFilePort(context.filesDir, 'campus-ddl-t11-check');
  }
  private async run(write: boolean): Promise<void> {
    if (this.busy || this.files === null) return;
    this.busy = true;
    try {
      const report: HistoryProbeReport = write ? await writeHistoryProbe(this.files) : await readHistoryProbe(this.files);
      this.lines = report.checks;
    } catch (_) {
      this.lines = [new HistoryProbeLine('历史检查未完成', false, '请保留人工目录文件排查；先写入样例，再读取。')];
    } finally { this.busy = false; }
  }
  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('T11 历史验证').fontSize(24).fontWeight(FontWeight.Bold)
        Text('仅操作独立人工目录，全部回复为合成数据，不调用模型。').fontSize(14)
        Button('1. 写入聊天与失败样例').id('t11-write').enabled(!this.busy).onClick(() => { this.run(true); })
        Button('2. 重开读取历史').id('t11-read').enabled(!this.busy).onClick(() => { this.run(false); })
        Text('写入后强制停止应用进程，再冷启动读取；断网应能回看。此页不是正式历史列表页。').fontSize(14)
        if (this.busy) { Text('正在检查…').fontSize(16) }
        ForEach(this.lines, (line: HistoryProbeLine) => {
          Column({ space: 4 }) {
            Text((line.passed ? '通过：' : '未通过：') + line.label)
              .fontWeight(FontWeight.Bold).fontColor(line.passed ? '#166534' : '#B91C1C')
            Text(line.detail).fontSize(14)
          }.alignItems(HorizontalAlign.Start).width('100%')
        })
      }.padding(20).width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%')
  }
}
