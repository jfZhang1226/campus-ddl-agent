import { isCalendarDate, zonedDateTimeParts, zonedTimestamp } from '../domain/DateRules';
import { StorageFailure } from '../data/storage/StorageTypes';
import { TaskDraft } from '../domain/TaskContracts';

export class DeadlineInput {
  constructor(public date: string = '', public time: string = '') {}
}
export function deadlineInput(task: TaskDraft): DeadlineInput {
  const wall = task.dueAt === null ? null : zonedDateTimeParts(task.dueAt, task.timezone);
  return wall === null ? new DeadlineInput(task.deadlineDate || '', '') : new DeadlineInput(wall.date, wall.time);
}
/** Empty means unknown; no implicit date, current time, or end-of-day default. */
export function applyDeadline(draft: TaskDraft, input: DeadlineInput): void {
  const date = input.date.trim(), time = input.time.trim();
  if (date.length === 0 && time.length === 0) {
    draft.deadlinePrecision = 'unknown'; draft.deadlineDate = null; draft.dueAt = null; return;
  }
  if (!isCalendarDate(date)) throw new StorageFailure('INVALID_ARGUMENT', '请选择有效的截止日期。');
  if (time.length === 0) {
    draft.deadlinePrecision = 'date_only'; draft.deadlineDate = date; draft.dueAt = null; return;
  }
  const instant = zonedTimestamp(date, time, draft.timezone);
  if (instant === null) throw new StorageFailure('INVALID_ARGUMENT', '请填写有效时刻，例如18:30；不确定可留空。');
  draft.deadlinePrecision = 'exact'; draft.deadlineDate = null; draft.dueAt = instant;
}
export function deadlineLabel(draft: TaskDraft): string {
  const input = deadlineInput(draft);
  return input.date.length === 0 ? '截止待补充' : input.date + (input.time.length === 0 ? ' · 时刻待补充' : ' ' + input.time);
}
export function deadlineNote(draft: TaskDraft): string { return '人工补充截止时间：《' + draft.title + '》设为' + deadlineLabel(draft) + '（' + draft.timezone + '）。'; }
