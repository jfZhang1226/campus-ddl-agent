import { BusinessSnapshot } from '../domain/StorageModels';
import { CommitReceipt } from '../domain/CommitModels';
import { isCalendarDate, timestampMillis } from '../domain/DateRules';
import { StorageFailure } from '../data/storage/StorageTypes';
import { AvailabilityBlock, PlanBlock } from './WeekPlanner';
import { planningCollections } from './PlanningRules';

export function validAvailabilityDates(from: string, to: string): boolean {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return false;
  const days = (timestampMillis(to + 'T00:00:00+08:00') - timestampMillis(from + 'T00:00:00+08:00')) / 86400000;
  return days >= 0 && days <= 6;
}
export interface PlanningRange {
  revision: number;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  rangeSemantics: string;
  availability: AvailabilityBlock[];
  planBlocks: PlanBlock[];
}
/** Reads only the app's explicit availability/work blocks. No OS calendar, source text, tasks or writes. */
export function queryPlanningRange(snapshot: BusinessSnapshot, from: string, to: string): PlanningRange {
  if (!validAvailabilityDates(from, to)) throw new StorageFailure('INVALID_ARGUMENT', '安排查询须给出真实YYYY-MM-DD日期，含首尾最多七天。');
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || snapshot.operations.some(entry => {
    const receipt = entry as CommitReceipt;
    return typeof receipt.recordType === 'string' && receipt.recordType.startsWith('t16.operation.') && receipt.committedRevision > snapshot.revision;
  })) throw new StorageFailure('CORRUPT_DATA', '正式安排版本尚未核实，不能当作已保存结果。');
  planningCollections(snapshot);
  const start = timestampMillis(from + 'T00:00:00+08:00');
  const end = timestampMillis(to + 'T00:00:00+08:00') + 86400000;
  const overlaps = (row: AvailabilityBlock | PlanBlock): boolean => timestampMillis(row.startAt) < end && timestampMillis(row.endAt) > start;
  const result: PlanningRange = { revision: snapshot.revision, dateFrom: from, dateTo: to, timezone: 'Asia/Shanghai',
    rangeSemantics: 'overlap_original_bounds', availability: (snapshot.availabilityBlocks as AvailabilityBlock[]).filter(overlaps),
    planBlocks: (snapshot.planBlocks as PlanBlock[]).filter(overlaps) };
  if (result.availability.length > 100 || result.planBlocks.length > 200) throw new StorageFailure('QUERY_TOO_LARGE', '此范围的安排较多，请缩小查询日期；没有截断后假装完整返回。');
  return JSON.parse(JSON.stringify(result)) as PlanningRange;
}
