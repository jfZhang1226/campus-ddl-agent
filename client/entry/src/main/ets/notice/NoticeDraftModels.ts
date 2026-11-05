import { isCalendarDate, isOffsetTimestamp, isTaskTimezone } from '../domain/DateRules';
import { StorageFailure } from '../data/storage/StorageTypes';

export class NoticeDraftNotice {
  rawText: string = '';
  sourceLabel: string | null = null;
  publishedAt: string | null = null;
  timezone: string = 'Asia/Shanghai';
}

export class NoticeDraftTask {
  title: string = '';
  course: string | null = null;
  kind: string | null = null;
  deadlinePrecision: string = 'unknown';
  deadlineDate: string | null = null;
  dueAt: string | null = null;
  timezone: string = 'Asia/Shanghai';
  priority: string | null = null;
  submissionChannel: string | null = null;
  remainingMinutes: number | null = null;
}

export class NoticeDraftChecklistItem {
  label: string = '';
  state: string = 'pending';
}

export class NoticeClarification {
  field: string = '';
  question: string = '';
}

/** Editable T12 response. It intentionally contains no persisted IDs or audit fields. */
export class NoticeDraft {
  schemaVersion: number = 1;
  kind: string = 'notice_draft';
  notice: NoticeDraftNotice = new NoticeDraftNotice();
  task: NoticeDraftTask = new NoticeDraftTask();
  checklistItems: NoticeDraftChecklistItem[] = [];
  missingFields: string[] = [];
  clarification: NoticeClarification[] = [];
}

function text(value: Object | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: Object | null): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value: Object | null): string | null {
  if (value === null) return null;
  const result = text(value);
  if (result === null) throw new StorageFailure('INVALID_RESPONSE', '草案文本字段无效。');
  return result;
}

function optionalTimestamp(value: Object | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !isOffsetTimestamp(value)) {
    throw new StorageFailure('INVALID_RESPONSE', '草案时间字段无效。');
  }
  return value;
}

function optionalInteger(value: Object | null): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new StorageFailure('INVALID_RESPONSE', '草案工时字段无效。');
  }
  return value;
}

function checkDeadline(task: NoticeDraftTask): void {
  if (task.deadlinePrecision === 'unknown') {
    if (task.deadlineDate !== null || task.dueAt !== null) {
      throw new StorageFailure('INVALID_RESPONSE', '草案的未知截止字段组合无效。');
    }
    return;
  }
  if (task.deadlinePrecision === 'date_only') {
    if (!isCalendarDate(task.deadlineDate as string) || task.dueAt !== null) {
      throw new StorageFailure('INVALID_RESPONSE', '草案的仅日期截止字段无效。');
    }
    return;
  }
  if (task.deadlinePrecision === 'exact') {
    if (task.deadlineDate !== null || task.dueAt === null || !isOffsetTimestamp(task.dueAt)) {
      throw new StorageFailure('INVALID_RESPONSE', '草案的精确截止字段无效。');
    }
    return;
  }
  throw new StorageFailure('INVALID_RESPONSE', '草案截止精度无效。');
}

/** Strict boundary parser for `/api/agent/extract-notice`; model output is never trusted directly. */
export function parseNoticeDraft(value: Object | null): NoticeDraft {
  if (!isRecord(value)) throw new StorageFailure('INVALID_RESPONSE', '草案不是对象。');
  const source = value as Record<string, Object | null>;
  if (source.schemaVersion !== 1 || source.kind !== 'notice_draft' ||
    !isRecord(source.notice) || !isRecord(source.task) || !Array.isArray(source.checklistItems) ||
    !Array.isArray(source.missingFields) || !Array.isArray(source.clarification)) {
    throw new StorageFailure('INVALID_RESPONSE', '草案结构不符合约定。');
  }

  const noticeSource = source.notice as Record<string, Object | null>;
  const taskSource = source.task as Record<string, Object | null>;
  const rawText = text(noticeSource.rawText);
  if (rawText === null) throw new StorageFailure('INVALID_RESPONSE', '草案通知原文为空。');
  const timezone = text(noticeSource.timezone) === null ? null : noticeSource.timezone as string;
  if (timezone === null || !isTaskTimezone(timezone)) {
    throw new StorageFailure('INVALID_RESPONSE', '草案时区无效。');
  }

  const draft = new NoticeDraft();
  draft.notice.rawText = rawText;
  draft.notice.sourceLabel = optionalText(noticeSource.sourceLabel);
  draft.notice.publishedAt = optionalTimestamp(noticeSource.publishedAt);
  draft.notice.timezone = timezone;

  const taskTimezone = text(taskSource.timezone) === null ? null : taskSource.timezone as string;
  if (taskTimezone === null || !isTaskTimezone(taskTimezone)) {
    throw new StorageFailure('INVALID_RESPONSE', '任务草案时区无效。');
  }
  const title = typeof taskSource.title === 'string' ? taskSource.title : '';
  draft.task.title = title.trim().length > 0 ? title : '';
  draft.task.course = optionalText(taskSource.course);
  const kind = taskSource.kind;
  if (kind !== null && (typeof kind !== 'string' ||
    !['assignment', 'report', 'registration', 'other'].includes(kind))) {
    throw new StorageFailure('INVALID_RESPONSE', '任务草案分类无效。');
  }
  draft.task.kind = kind as string | null;
  if (typeof taskSource.deadlinePrecision !== 'string') {
    throw new StorageFailure('INVALID_RESPONSE', '任务草案截止精度无效。');
  }
  draft.task.deadlinePrecision = taskSource.deadlinePrecision;
  draft.task.deadlineDate = optionalText(taskSource.deadlineDate);
  draft.task.dueAt = optionalTimestamp(taskSource.dueAt);
  draft.task.timezone = taskTimezone;
  const priority = taskSource.priority;
  if (priority !== null && (typeof priority !== 'string' ||
    !['low', 'normal', 'high'].includes(priority))) {
    throw new StorageFailure('INVALID_RESPONSE', '任务草案优先级无效。');
  }
  draft.task.priority = priority as string | null;
  draft.task.submissionChannel = optionalText(taskSource.submissionChannel);
  draft.task.remainingMinutes = optionalInteger(taskSource.remainingMinutes);
  checkDeadline(draft.task);

  (source.checklistItems as Object[]).forEach((item: Object) => {
    if (!isRecord(item)) throw new StorageFailure('INVALID_RESPONSE', '草案材料项无效。');
    const record = item as Record<string, Object | null>;
    const label = text(record.label);
    if (label === null || record.state !== 'pending') {
      throw new StorageFailure('INVALID_RESPONSE', '草案材料项内容或状态无效。');
    }
    const parsed = new NoticeDraftChecklistItem();
    parsed.label = label;
    draft.checklistItems.push(parsed);
  });

  (source.missingFields as Object[]).forEach((field: Object) => {
    if (typeof field !== 'string' || field.trim().length === 0) {
      throw new StorageFailure('INVALID_RESPONSE', '草案缺项字段无效。');
    }
    draft.missingFields.push(field);
  });
  (source.clarification as Object[]).forEach((item: Object) => {
    if (!isRecord(item)) throw new StorageFailure('INVALID_RESPONSE', '草案追问项无效。');
    const record = item as Record<string, Object | null>;
    const field = text(record.field);
    const question = text(record.question);
    if (field === null || question === null) {
      throw new StorageFailure('INVALID_RESPONSE', '草案追问项内容无效。');
    }
    const parsed = new NoticeClarification();
    parsed.field = field;
    parsed.question = question;
    draft.clarification.push(parsed);
  });
  return draft;
}

export function cloneNoticeDraft(draft: NoticeDraft): NoticeDraft {
  const copy = new NoticeDraft();
  copy.notice.rawText = draft.notice.rawText;
  copy.notice.sourceLabel = draft.notice.sourceLabel;
  copy.notice.publishedAt = draft.notice.publishedAt;
  copy.notice.timezone = draft.notice.timezone;
  copy.task.title = draft.task.title;
  copy.task.course = draft.task.course;
  copy.task.kind = draft.task.kind;
  copy.task.deadlinePrecision = draft.task.deadlinePrecision;
  copy.task.deadlineDate = draft.task.deadlineDate;
  copy.task.dueAt = draft.task.dueAt;
  copy.task.timezone = draft.task.timezone;
  copy.task.priority = draft.task.priority;
  copy.task.submissionChannel = draft.task.submissionChannel;
  copy.task.remainingMinutes = draft.task.remainingMinutes;
  copy.checklistItems = draft.checklistItems.map((item: NoticeDraftChecklistItem) => {
    const next = new NoticeDraftChecklistItem();
    next.label = item.label;
    next.state = item.state;
    return next;
  });
  copy.missingFields = draft.missingFields.slice();
  copy.clarification = draft.clarification.map((item: NoticeClarification) => {
    const next = new NoticeClarification();
    next.field = item.field;
    next.question = item.question;
    return next;
  });
  return copy;
}
