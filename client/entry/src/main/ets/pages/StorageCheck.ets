import common from '@ohos.app.ability.common';
import { ProbeLine, StorageProbe } from '../data/diagnostics/StorageProbe';

@Entry
@Component
struct StorageCheck {
  @State busy: boolean = false;
  @State lines: ProbeLine[] = [];
  private probe: StorageProbe | null = null;

  aboutToAppear(): void {
    const context: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.probe = new StorageProbe(context.filesDir);
  }

  private async run(action: string): Promise<void> {
    if (this.busy || this.probe === null) {
      return;
    }
    this.busy = true;
    try {
      if (action === 'write') {
        this.lines = await this.probe.writeExample();
      } else if (action === 'read') {
        this.lines = await this.probe.readExample();
      } else if (action === 'failure') {
        this.lines = await this.probe.checkFailures();
      } else {
        this.lines = await this.probe.checkFiles();
      }
    } catch (error) {
      this.lines = [new ProbeLine('文件操作失败', false, '保留当前数据，稍后重试。')];
    } finally {
      this.busy = false;
    }
  }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('T08 本地存储验证').fontSize(24).fontWeight(FontWeight.Bold)
        Text('开发验证页 · 仅写独立目录中的人工样例').fontSize(14).fontColor('#666666')
        Button('1. 写入重启样例').id('t08-write').enabled(!this.busy).onClick(() => { this.run('write'); })
        Button('2. 读取重启结果').id('t08-read').enabled(!this.busy).onClick(() => { this.run('read'); })
        Button('3. 检查替换与恢复').id('t08-check').enabled(!this.busy).onClick(() => { this.run('check'); })
        Button('4. 检查失败保护').id('t08-failure').enabled(!this.busy).onClick(() => { this.run('failure'); })
        Text('失败保护用受控缺失路径触发真实文件 API 错误，只操作独立人工目录。').fontSize(14)
        Text('写入后关闭应用进程，再启动并点击“读取重启结果”。断网时也应可读。').fontSize(14)
        if (this.busy) {
          Text('正在检查…').fontSize(16)
        }
        ForEach(this.lines, (line: ProbeLine) => {
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
