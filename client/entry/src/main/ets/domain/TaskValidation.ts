import { Task } from './StorageModels';
import { TaskDraft, TaskQuery } from './TaskContracts';
import { deadlineIsValid, isCalendarDate, isOffsetTimestamp, isTaskTimezone, timestampMillis } from './DateRules';
import { StorageFailure } from '../data/storage/StorageTypes';

export function requireArgument(valid: boolean, message: string): void {
  if (!valid) throw new StorageFailure('INVALID_ARGUMENT', message);
}

function nonempty(value: string): boolean { return typeof value === 'string' && value.trim().length > 0; }
function nullable(value: string | null): boolean { return value === null || nonempty(value as string); }

export function validTaskStatus(value: string): boolean {
  return ['todo', 'in_progress', 'ready', 'submitted', 'done', 'cancelled'].includes(value);
}

export function validateDraft(draft: TaskDraft): void {
  requireArgument(draft !== null && typeof draft === 'object' && !Array.isArray(draft), '任务参数必须为对象。');
  requireArgument(nonempty(draft.title) && nullable(draft.course) && nullable(draft.submissionChannel), '任务标题或可选文本无效。');
  requireArgument(draft.kind === null || ['assignment', 'report', 'registration', 'other'].includes(draft.kind), '任务分类无效。');
  requireArgument(draft.priority === null || ['low', 'normal', 'high'].includes(draft.priority), '优先级无效。');
  requireArgument(validTaskStatus(draft.status), '任务状态无效。');
  requireArgument(draft.remainingMinutes === null ||
    (Number.isSafeInteger(draft.remainingMinutes) && draft.remainingMinutes >= 0), '剩余工时必须是 null 或非负安全整数。');
  requireArgument(isTaskTimezone(draft.timezone), '当前仅支持 Asia/Shanghai、UTC 和 Etc/UTC。');
  requireArgument(deadlineIsValid(draft.deadlinePrecision, draft.deadlineDate, draft.dueAt), '截止日期不存在或精度与字段组合不符。');
  requireArgument(Array.isArray(draft.noticeIds) && draft.noticeIds.every((id: string) => nonempty(id)) &&
    new Set<string>(draft.noticeIds).size === draft.noticeIds.length, '通知来源 ID 必须非空且不重复。');
}

export function validateTask(task: Task): void {
  validateDraft(task);
  requireArgument(nonempty(task.id) && Number.isSafeInteger(task.version) && task.version > 0 &&
    isOffsetTimestamp(task.createdAt) && isOffsetTimestamp(task.updatedAt) &&
    timestampMillis(task.createdAt) <= timestampMillis(task.updatedAt), '任务 ID、版本或创建/更新时间无效。');
}

export function validateQuery(query: TaskQuery): void {
  requireArgument(query !== null && typeof query === 'object' && !Array.isArray(query), '查询参数必须为对象。');
  requireArgument(nullable(query.keyword) && nullable(query.course) && Array.isArray(query.statuses) &&
    query.statuses.every((status: string) => validTaskStatus(status)) && typeof query.includeUndated === 'boolean' &&
    isTaskTimezone(query.timezone), '查询条件无效。');
  requireArgument((query.dateFrom === null || isCalendarDate(query.dateFrom)) &&
    (query.dateTo === null || isCalendarDate(query.dateTo)) &&
    (query.dateFrom === null || query.dateTo === null || query.dateFrom <= query.dateTo), '查询日期范围无效。');
}
