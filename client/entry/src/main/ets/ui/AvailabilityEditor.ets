import { AppTheme } from './AppTheme';
import { zonedTimestamp, timestampMillis } from '../domain/DateRules';

@Component
export struct AvailabilityEditor {
  onAdd: (line: string) => void = (_line: string): void => {};
  onCancel: () => void = (): void => {};
  @State day: string = '';
  @State start: string = '';
  @State end: string = '';
  @State error: string = '';
  private pickDay(): void {
    DatePickerDialog.show({ selected: new Date(), start: new Date('2020-01-01'), end: new Date('2100-12-31'),
      onAccept: (value: DatePickerResult): void => {
        if (value.year !== undefined && value.month !== undefined && value.day !== undefined)
          this.day = String(value.year) + '-' + String(value.month + 1).padStart(2, '0') + '-' + String(value.day).padStart(2, '0');
      }
    });
  }
  private pickTime(start: boolean): void {
    TimePickerDialog.show({ useMilitaryTime: true, selected: new Date('2026-01-01T18:00:00+08:00'),
      onAccept: (value: TimePickerResult): void => {
        if (value.hour !== undefined && value.minute !== undefined) {
          const text = String(value.hour).padStart(2, '0') + ':' + String(value.minute).padStart(2, '0');
          if (start) this.start = text; else this.end = text;
        }
      }
    });
  }
  private add(): void {
    const from = zonedTimestamp(this.day, this.start, 'Asia/Shanghai');
    const to = zonedTimestamp(this.day, this.end, 'Asia/Shanghai');
    if (from === null || to === null || timestampMillis(from) >= timestampMillis(to)) { this.error = '请选择日期、开始和结束时刻，结束须晚于开始。'; return; }
    this.onAdd(this.day + ' ' + this.start + ' ~ ' + this.day + ' ' + this.end);
  }
  build() {
    Column({ space: 12 }) {
      Text('哪段时间有空？').fontSize(18).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink)
      Button(this.day || '选择日期').id('availability-pick-date').height(44).width('100%').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.pickDay(); })
      Row({ space: 10 }) {
        Button(this.start || '开始时刻').id('availability-pick-start').layoutWeight(1).height(44).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.pickTime(true); })
        Text('至').fontSize(13).fontColor(AppTheme.muted)
        Button(this.end || '结束时刻').id('availability-pick-end').layoutWeight(1).height(44).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.pickTime(false); })
      }
      if (this.error.length > 0) { Text(this.error).id('availability-error').fontSize(12).fontColor(AppTheme.amber) }
      Text('添加后先核对保存，再生成安排。').fontSize(12).fontColor(AppTheme.muted)
      Row({ space: 10 }) {
        Button('取消').id('availability-cancel').layoutWeight(1).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.onCancel(); })
        Button('添加时段').id('availability-add').layoutWeight(1).backgroundColor(AppTheme.primary).onClick(() => { this.add(); })
      }
    }.width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(18)
  }
}
