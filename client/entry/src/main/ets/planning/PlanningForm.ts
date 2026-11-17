import { isOffsetTimestamp } from '../domain/DateRules';
import { StorageFailure } from '../data/storage/StorageTypes';
import { AvailabilityDraft } from './PlanningContracts';

/** Explicit Beijing wall time only. No date/clock inference from incomplete input. */
export function planningTimestamp(text: string): string {
  const value = text.trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) throw new StorageFailure('INVALID_ARGUMENT', '时间请完整填写为 YYYY-MM-DD HH:mm（北京时间）。');
  const timestamp = value.replace(' ', 'T') + ':00+08:00';
  if (!isOffsetTimestamp(timestamp)) throw new StorageFailure('INVALID_ARGUMENT', '日期或时刻无效，请核对实际日历。');
  return timestamp;
}
export function planningTimeLabel(timestamp: string): string {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? new Date(value + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '时刻无效';
}
export function parseAvailability(text: string): AvailabilityDraft[] {
  if (text.length > 20000) throw new StorageFailure('INVALID_ARGUMENT', '可用时间文本过长。');
  if (text.trim().length === 0) return []; // The confirmation card explicitly shows clearing all ranges.
  const lines = text.trim().split(/\r?\n/);
  if (lines.length > 200) throw new StorageFailure('INVALID_ARGUMENT', '最多支持200个可用区间。');
  return lines.map((line: string): AvailabilityDraft => {
    const parts = line.split('~');
    if (parts.length !== 2) throw new StorageFailure('INVALID_ARGUMENT', '每行一个完整区间，起止时间用 ~ 分隔。');
    return { startAt: planningTimestamp(parts[0]), endAt: planningTimestamp(parts[1]) };
  });
}
