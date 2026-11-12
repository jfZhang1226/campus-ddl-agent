import { BusinessSnapshot, ChecklistItem, Notice, Task } from '../domain/StorageModels';
import { isOffsetTimestamp, isTaskTimezone } from '../domain/DateRules';
import { requireArgument, validateDraft } from '../domain/TaskValidation';
import { NoticeDraft } from '../notice/NoticeDraftModels';
import { LocalStore } from './LocalStore';
import { requireJsonValue } from './storage/JsonValues';
import { sha256Hex } from './storage/Sha256';
import { StorageFailure, StorageResult, storageError, storageSuccess } from './storage/StorageTypes';

export class NoticeImportInput {
  draft: NoticeDraft = new NoticeDraft();
  expectedRevision: number = 0;
}

export class NoticeImportWrite {
  notice: Notice;
  task: Task;
  checklistItems: ChecklistItem[];
  revision: number;

  constructor(notice: Notice, task: Task, checklistItems: ChecklistItem[], revision: number) {
    this.notice = notice;
    this.task = task;
    this.checklistItems = checklistItems;
    this.revision = revision;
  }
}

export interface NoticeImportRuntime {
  now(): string;
  nextId(prefix: string): string;
}

export class LocalNoticeImportRuntime implements NoticeImportRuntime {
  now(): string {
    return new Date().toISOString();
  }

  nextId(prefix: string): string {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
}

function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) {
    throw new StorageFailure(result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode, result.message);
  }
  return result.data;
}

function capture<T extends Object>(input: T): T {
  try {
    requireJsonValue(input);
    return JSON.parse(JSON.stringify(input)) as T;
  } catch (error) {
    throw new StorageFailure('INVALID_ARGUMENT', '通知导入参数必须是完整、有限的 JSON 对象。');
  }
}

function nullableText(value: string | null): boolean {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

/** One confirmed import writes its Notice, Task and checklist entries in the same snapshot commit. */
export class NoticeImportRepository {
  private store: LocalStore;
  private runtime: NoticeImportRuntime;

  constructor(store: LocalStore, runtime: NoticeImportRuntime = new LocalNoticeImportRuntime()) {
    this.store = store;
    this.runtime = runtime;
  }

  async revision(): Promise<StorageResult<number>> {
    try {
      const snapshot: BusinessSnapshot = value(await this.store.read());
      return storageSuccess(snapshot.revision);
    } catch (error) {
      return storageError<number>(error as Error);
    }
  }

  async create(input: NoticeImportInput, expectedRevision: number): Promise<StorageResult<NoticeImportWrite>> {
    try {
      const request: NoticeImportInput = capture(input);
      const draft: NoticeDraft = request.draft;
      requireArgument(draft !== null && typeof draft === 'object' && draft.notice !== null &&
        typeof draft.notice === 'object' && draft.task !== null && typeof draft.task === 'object',
      '通知草案结构无效。');
      requireArgument(typeof draft.notice.rawText === 'string' && draft.notice.rawText.trim().length > 0 &&
        draft.notice.rawText.length <= 10000, '通知原文为空或过长。');
      requireArgument(nullableText(draft.notice.sourceLabel) && nullableText(draft.task.course) &&
        nullableText(draft.task.submissionChannel), '来源、课程或提交渠道文本无效。');
      requireArgument(draft.notice.publishedAt === null || isOffsetTimestamp(draft.notice.publishedAt),
        '通知发布时间必须是带偏移的时间。');
      requireArgument(isTaskTimezone(draft.notice.timezone) && draft.task.timezone === draft.notice.timezone,
        '通知与任务时区无效或不一致。');
      requireArgument(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0,
        'expectedRevision 无效。');
      requireArgument(Array.isArray(draft.checklistItems) &&
        draft.checklistItems.every((item) => item !== null && typeof item.label === 'string' &&
          item.state === 'pending' && item.label.trim().length > 0),
      '材料清单无效。');

      const snapshot: BusinessSnapshot = value(await this.store.read());
      if (snapshot.revision !== expectedRevision) {
        throw new StorageFailure('VERSION_CONFLICT', '本地数据已变化，请重新读取后确认。');
      }
      const now: string = this.runtime.now();
      requireArgument(isOffsetTimestamp(now), '客户端时钟未返回有效的带偏移时刻。');
      const noticeId: string = this.nextUnique('notice',
        (id: string) => snapshot.notices.some((notice: Notice) => notice.id === id));
      const taskId: string = this.nextUnique('task',
        (id: string) => snapshot.tasks.some((task: Task) => task.id === id));

      const notice: Notice = {
        id: noticeId,
        rawText: draft.notice.rawText,
        sourceLabel: draft.notice.sourceLabel,
        publishedAt: draft.notice.publishedAt,
        importedAt: now,
        timezone: draft.notice.timezone,
        contentHash: sha256Hex(draft.notice.rawText)
      };
      const editable = {
        title: draft.task.title,
        course: draft.task.course,
        kind: draft.task.kind,
        deadlinePrecision: draft.task.deadlinePrecision,
        deadlineDate: draft.task.deadlineDate,
        dueAt: draft.task.dueAt,
        timezone: draft.task.timezone,
        priority: draft.task.priority,
        status: 'todo',
        remainingMinutes: draft.task.remainingMinutes,
        submissionChannel: draft.task.submissionChannel,
        noticeIds: [noticeId]
      };
      validateDraft(editable);
      const task: Task = {
        id: taskId,
        title: editable.title,
        course: editable.course,
        kind: editable.kind,
        deadlinePrecision: editable.deadlinePrecision,
        deadlineDate: editable.deadlineDate,
        dueAt: editable.dueAt,
        timezone: editable.timezone,
        priority: editable.priority,
        status: 'todo',
        remainingMinutes: editable.remainingMinutes,
        submissionChannel: editable.submissionChannel,
        noticeIds: [noticeId],
        version: 1,
        createdAt: now,
        updatedAt: now
      };
      const checklistItems: ChecklistItem[] = draft.checklistItems.map((item) => {
        return {
          id: this.nextUnique('check',
            (id: string) => snapshot.checklistItems.some((entry: ChecklistItem) => entry.id === id)),
          taskId: taskId,
          label: item.label,
          state: 'pending',
          sourceNoticeId: noticeId,
          confirmedAt: null
        };
      });

      snapshot.notices.push(notice);
      snapshot.tasks.push(task);
      snapshot.checklistItems.push(...checklistItems);
      const saved: BusinessSnapshot = value(await this.store.save(snapshot, expectedRevision));
      return storageSuccess(new NoticeImportWrite(notice, task, checklistItems, saved.revision));
    } catch (error) {
      return storageError<NoticeImportWrite>(error as Error);
    }
  }

  private nextUnique(prefix: string, exists: (id: string) => boolean): string {
    for (let attempt: number = 0; attempt < 8; attempt++) {
      const id: string = this.runtime.nextId(prefix);
      if (typeof id === 'string' && id.trim().length > 0 && !exists(id)) return id;
    }
    throw new StorageFailure('INVALID_ARGUMENT', '记录 ID 连续冲突，未覆盖已有数据。');
  }
}
