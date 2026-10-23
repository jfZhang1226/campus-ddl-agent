import { BusinessSnapshot, ChecklistItem, Message, Notice, Session, SessionDocument, Task } from '../../domain/StorageModels';
import { SnapshotCodec, StorageFailure, checkHeader, isStorageId, requireStorage } from './StorageTypes';

function text(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableText(value: string | null): boolean {
  return value === null || text(value);
}

function timestamp(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: string | null): boolean {
  return value === null || timestamp(value);
}

function uniqueIds(ids: string[]): void {
  requireStorage(ids.every((id: string) => text(id)), '记录 ID 不能为空。');
  requireStorage(new Set<string>(ids).size === ids.length, '记录 ID 重复。');
}

function objectArray(values: Object[]): void {
  requireStorage(Array.isArray(values), '快照集合缺失或类型错误。');
  requireStorage(values.every((value: Object) => value !== null && typeof value === 'object' && !Array.isArray(value)),
    '快照集合中存在非对象。');
}

function checkNotice(notice: Notice): void {
  requireStorage(text(notice.id) && text(notice.rawText) && nullableText(notice.sourceLabel) &&
    nullableTimestamp(notice.publishedAt) && timestamp(notice.importedAt) && text(notice.timezone) &&
    typeof notice.contentHash === 'string' && /^[0-9a-f]{64}$/.test(notice.contentHash), '通知字段无效。');
}

function checkTask(task: Task, noticeIds: string[]): void {
  requireStorage(text(task.id) && text(task.title) && nullableText(task.course) &&
    (task.kind === null || ['assignment', 'report', 'registration', 'other'].includes(task.kind)) &&
    text(task.timezone) && (task.priority === null || ['low', 'normal', 'high'].includes(task.priority)) &&
    ['todo', 'in_progress', 'ready', 'submitted', 'done', 'cancelled'].includes(task.status) &&
    (task.remainingMinutes === null || (Number.isSafeInteger(task.remainingMinutes) && task.remainingMinutes >= 0)) &&
    nullableText(task.submissionChannel) && Number.isSafeInteger(task.version) && task.version > 0 &&
    timestamp(task.createdAt) && timestamp(task.updatedAt) && Date.parse(task.createdAt) <= Date.parse(task.updatedAt),
    '任务字段无效。');
  requireStorage(Array.isArray(task.noticeIds), '任务来源集合无效。');
  uniqueIds(task.noticeIds);
  requireStorage(task.noticeIds.every((id: string) => noticeIds.includes(id)), '任务引用的通知不存在。');
  const exact: boolean = task.deadlinePrecision === 'exact' && task.deadlineDate === null && timestamp(task.dueAt as string);
  const dateOnly: boolean = task.deadlinePrecision === 'date_only' && task.dueAt === null &&
    typeof task.deadlineDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.deadlineDate);
  const unknown: boolean = task.deadlinePrecision === 'unknown' && task.deadlineDate === null && task.dueAt === null;
  requireStorage(exact || dateOnly || unknown, '截止日期精度与字段组合不一致。');
}

function checkChecklist(item: ChecklistItem, tasks: Task[]): void {
  const task: Task | undefined = tasks.find((value: Task) => value.id === item.taskId);
  requireStorage(text(item.id) && text(item.label) && task !== undefined, '材料项或所属任务无效。');
  requireStorage(item.sourceNoticeId === null || (text(item.sourceNoticeId) &&
    task !== undefined && task.noticeIds.includes(item.sourceNoticeId)), '材料来源不属于任务来源。');
  requireStorage((item.state === 'pending' && item.confirmedAt === null) ||
    (item.state === 'prepared' && timestamp(item.confirmedAt as string)), '材料状态与确认时间不一致。');
}

export class BusinessSnapshotCodec implements SnapshotCodec<BusinessSnapshot> {
  empty(): BusinessSnapshot {
    return new BusinessSnapshot();
  }

  decode(source: string): BusinessSnapshot {
    let value: BusinessSnapshot;
    try {
      value = JSON.parse(source) as BusinessSnapshot;
    } catch (error) {
      throw new StorageFailure('CORRUPT_DATA', '业务快照不是有效 JSON，原文件已保留。');
    }
    checkHeader(value);
    objectArray(value.notices);
    objectArray(value.tasks);
    objectArray(value.checklistItems);
    objectArray(value.availabilityBlocks);
    objectArray(value.planBlocks);
    objectArray(value.proposals);
    objectArray(value.operations);
    const noticeIds: string[] = value.notices.map((notice: Notice) => notice.id);
    uniqueIds(noticeIds);
    uniqueIds(value.tasks.map((task: Task) => task.id));
    uniqueIds(value.checklistItems.map((item: ChecklistItem) => item.id));
    value.notices.forEach((notice: Notice) => checkNotice(notice));
    value.tasks.forEach((task: Task) => checkTask(task, noticeIds));
    value.checklistItems.forEach((item: ChecklistItem) => checkChecklist(item, value.tasks));
    return value;
  }
}

export class SessionDocumentCodec implements SnapshotCodec<SessionDocument> {
  private initial: Session;

  constructor(initial: Session) {
    this.initial = initial;
  }

  empty(): SessionDocument {
    return new SessionDocument(this.initial);
  }

  decode(source: string): SessionDocument {
    let value: SessionDocument;
    try {
      value = JSON.parse(source) as SessionDocument;
    } catch (error) {
      throw new StorageFailure('CORRUPT_DATA', '会话文件不是有效 JSON，原文件已保留。');
    }
    checkHeader(value);
    const session: Session = value.session;
    requireStorage(session !== null && typeof session === 'object' && isStorageId(session.id) &&
      session.id === this.initial.id && typeof session.title === 'string' &&
      timestamp(session.createdAt) && timestamp(session.updatedAt) &&
      Date.parse(session.createdAt) <= Date.parse(session.updatedAt) && nullableText(session.pendingProposalId), '会话元数据无效。');
    objectArray(value.messages);
    uniqueIds(value.messages.map((message: Message) => message.id));
    value.messages.forEach((message: Message) => {
      requireStorage(message.sessionId === session.id && ['user', 'assistant', 'system', 'tool'].includes(message.role) &&
        typeof message.text === 'string' && nullableText(message.toolName) &&
        (message.toolResultSummary === null || typeof message.toolResultSummary === 'string') &&
        text(message.status) && timestamp(message.createdAt), '会话消息字段或关联无效。');
    });
    return value;
  }
}
