import { AppTheme } from './AppTheme';

@Component
export struct DeadlineEditor {
  initialDate: string = '';
  initialTime: string = '';
  saving: boolean = false;
  error: string = '';
  onApply: (date: string, time: string) => void = (_date: string, _time: string): void => {};
  onCancel: () => void = (): void => {};
  @State dateText: string = '';
  @State timeText: string = '';
  aboutToAppear(): void { this.dateText = this.initialDate; this.timeText = this.initialTime; }
  private chooseDate(): void {
    DatePickerDialog.show({
      selected: this.dateText.length > 0 ? new Date(this.dateText + 'T12:00:00+08:00') : new Date(),
      start: new Date('2020-01-01T12:00:00+08:00'), end: new Date('2100-12-31T12:00:00+08:00'),
      onAccept: (value: DatePickerResult): void => {
        if (value.year !== undefined && value.month !== undefined && value.day !== undefined) {
          this.dateText = String(value.year) + '-' + String(value.month + 1).padStart(2, '0') + '-' + String(value.day).padStart(2, '0');
        }
      }
    });
  }
  private chooseTime(): void {
    TimePickerDialog.show({ useMilitaryTime: true,
      selected: new Date('2026-01-01T' + (this.timeText.length > 0 ? this.timeText : '12:00') + ':00+08:00'),
      onAccept: (value: TimePickerResult): void => {
        if (value.hour !== undefined && value.minute !== undefined) this.timeText = String(value.hour).padStart(2, '0') + ':' + String(value.minute).padStart(2, '0');
      }
    });
  }
  build() {
    Column({ space: 14 }) {
      Text('编辑截止时间').fontSize(21).fontWeight(FontWeight.Bold).fontColor(AppTheme.ink)
      Text('日期和时刻可以分别补充。不确定的内容可留空。').fontSize(13).fontColor(AppTheme.muted)
      Row({ space: 10 }) {
        TextInput({ text: this.dateText, placeholder: 'YYYY-MM-DD' }).id('deadline-date').layoutWeight(1).enabled(!this.saving)
          .onChange((value: string) => { this.dateText = value; })
        Button('选日期').id('deadline-pick-date').height(42).fontSize(12).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
          .enabled(!this.saving).onClick(() => { this.chooseDate(); })
      }
      Row({ space: 10 }) {
        TextInput({ text: this.timeText, placeholder: '具体时刻，可留空' }).id('deadline-time').layoutWeight(1).enabled(!this.saving)
          .onChange((value: string) => { this.timeText = value; })
        Button('选时刻').id('deadline-pick-time').height(42).fontSize(12).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft)
          .enabled(!this.saving).onClick(() => { this.chooseTime(); })
      }
      Row({ space: 12 }) {
        Button('时刻暂不确定').id('deadline-date-only').fontSize(12).fontColor(AppTheme.muted).backgroundColor('#F3F4EF').enabled(!this.saving)
          .onClick(() => { this.timeText = ''; })
        Button('日期也待定').id('deadline-unknown').fontSize(12).fontColor(AppTheme.muted).backgroundColor('#F3F4EF').enabled(!this.saving)
          .onClick(() => { this.dateText = ''; this.timeText = ''; })
      }
      if (this.error.length > 0) { Text(this.error).id('deadline-error').fontSize(13).fontColor(AppTheme.amber) }
      Text('保存前还会显示修改方案；本次编辑不会立即改动任务或启用提醒。').fontSize(12).fontColor(AppTheme.muted)
      Row({ space: 10 }) {
        Button('取消').id('deadline-cancel').layoutWeight(1).height(44).fontColor(AppTheme.ink).backgroundColor('#EEF0EB')
          .enabled(!this.saving).onClick(() => { this.onCancel(); })
        Button(this.saving ? '正在核对…' : '应用到草案').id('deadline-apply').layoutWeight(1).height(44).backgroundColor(AppTheme.primary)
          .enabled(!this.saving).onClick(() => { this.onApply(this.dateText, this.timeText); })
      }
    }.padding(22).width('100%').alignItems(HorizontalAlign.Start).backgroundColor('#FFFFFF').borderRadius(24)
  }
}
