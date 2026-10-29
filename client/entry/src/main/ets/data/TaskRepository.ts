import { BusinessSnapshot, ChecklistItem, Notice, Task } from '../domain/StorageModels';
import { LocalTaskRuntime, TaskDetail, TaskDraft, TaskList, TaskQuery, TaskRuntime, TaskWrite } from '../domain/TaskContracts';
import { deadlineDay, isOffsetTimestamp, timestampMillis } from '../domain/DateRules';
import { requireArgument, validateDraft, validateQuery, validateTask } from '../domain/TaskValidation';
import { LocalStore } from './LocalStore';
import { requireJsonValue } from './storage/JsonValues';
import { StorageFailure, StorageResult, storageError, storageSuccess } from './storage/StorageTypes';

function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) {
    throw new StorageFailure(result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode, result.message);
  }
  return result.data;
}

function capture<T extends Object>(request: T): T {
  try {
    requireJsonValue(request);
    return JSON.parse(JSON.stringify(request)) as T;
  } catch (error) { throw new StorageFailure('INVALID_ARGUMENT', '参数必须是完整、有限、无循环的 JSON 对象。'); }
}

function checkRevision(revision: number): void {
  requireArgument(Number.isSafeInteger(revision) && revision >= 0, 'expectedRevision 无效。');
}

function editable(task: TaskDraft): TaskDraft {
  // Explicit field selection prevents callers from setting ID/version/audit metadata.
  return { title: task.title, course: task.course, kind: task.kind, deadlinePrecision: task.deadlinePrecision,
    deadlineDate: task.deadlineDate, dueAt: task.dueAt, timezone: task.timezone, priority: task.priority,
    status: task.status, remainingMinutes: task.remainingMinutes, submissionChannel: task.submissionChannel,
    noticeIds: task.noticeIds.slice() };
}

/** Internal domain API for confirmed client actions. Never register directly as a model write tool. */
export class TaskRepository {
  private store: LocalStore;
  private runtime: TaskRuntime;

  constructor(store: LocalStore, runtime: TaskRuntime = new LocalTaskRuntime()) {
    this.store = store; this.runtime = runtime;
  }

  private async read(): Promise<BusinessSnapshot> {
    const snapshot: BusinessSnapshot = value(await this.store.read());
    try { snapshot.tasks.forEach((task: Task) => validateTask(task)); }
    catch (error) { throw new StorageFailure('CORRUPT_DATA', '已有任务不符合日期或领域规则，原文件已保留。'); }
    return snapshot;
  }

  private find(snapshot: BusinessSnapshot, taskId: string): Task {
    const task: Task | undefined = snapshot.tasks.find((entry: Task) => entry.id === taskId);
    if (task === undefined) throw new StorageFailure('NOT_FOUND', '任务不存在，请刷新列表。');
    return task;
  }

  private checkId(taskId: string): void {
    requireArgument(typeof taskId === 'string' && taskId.trim().length > 0, 'taskId 无效。');
  }

  private checkVersion(snapshot: BusinessSnapshot, expectedRevision: number, task: Task, expectedVersion: number): void {
    checkRevision(expectedRevision);
    requireArgument(Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 'expectedVersion 无效。');
    if (snapshot.revision !== expectedRevision || task.version !== expectedVersion) {
      throw new StorageFailure('VERSION_CONFLICT', '任务或本地数据已变化，请重新读取差异并确认。');
    }
  }

  private checkSources(snapshot: BusinessSnapshot, draft: TaskDraft, taskId: string = ''): void {
    requireArgument(draft.noticeIds.every((id: string) => snapshot.notices.some((notice: Notice) => notice.id === id)),
      '任务引用的通知不存在，请先由来源导入流程保存通知。');
    requireArgument(snapshot.checklistItems.filter((item: ChecklistItem) => item.taskId === taskId).every((item: ChecklistItem) =>
      item.sourceNoticeId === null || draft.noticeIds.includes(item.sourceNoticeId)), '不能移除仍被材料清单引用的来源。');
  }

  private now(previous: string | null = null): string {
    const now: string = this.runtime.now();
    requireArgument(isOffsetTimestamp(now), '客户端时钟未返回有效的带偏移时刻。');
    requireArgument(previous === null || timestampMillis(now) >= timestampMillis(previous), '客户端时钟早于任务最后更新时间，请校正后重试。');
    return now;
  }

  async list(query: TaskQuery = new TaskQuery()): Promise<StorageResult<TaskList>> {
    try {
      const filter: TaskQuery = capture(query);
      validateQuery(filter);
      const snapshot: BusinessSnapshot = await this.read();
      const keyword: string = filter.keyword === null ? '' : filter.keyword.toLowerCase();
      const bounded: boolean = filter.dateFrom !== null || filter.dateTo !== null;
      const tasks: Task[] = snapshot.tasks.filter((task: Task) => {
        if (keyword !== '' && !(task.title + '\n' + (task.course === null ? '' : task.course)).toLowerCase().includes(keyword)) return false;
        if (filter.course !== null && task.course !== filter.course) return false;
        if (filter.statuses.length > 0 && !filter.statuses.includes(task.status)) return false;
        if (!bounded) return true;
        const day: string | null = deadlineDay(task.deadlinePrecision, task.deadlineDate, task.dueAt, filter.timezone);
        if (day === null) return task.deadlinePrecision === 'unknown' && filter.includeUndated;
        return (filter.dateFrom === null || day >= filter.dateFrom) && (filter.dateTo === null || day <= filter.dateTo);
      });
      tasks.sort((a: Task, b: Task) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt) ||
        (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
      return storageSuccess(new TaskList(tasks, snapshot.revision));
    } catch (error) { return storageError<TaskList>(error as Error); }
  }

  async get(taskId: string): Promise<StorageResult<TaskDetail>> {
    try {
      this.checkId(taskId);
      const snapshot: BusinessSnapshot = await this.read();
      const task: Task = this.find(snapshot, taskId);
      return storageSuccess(new TaskDetail(task, snapshot.notices.filter((notice: Notice) => task.noticeIds.includes(notice.id)),
        snapshot.checklistItems.filter((item: ChecklistItem) => item.taskId === task.id), snapshot.revision));
    } catch (error) { return storageError<TaskDetail>(error as Error); }
  }

  async create(draft: TaskDraft, expectedRevision: number): Promise<StorageResult<TaskWrite>> {
    try {
      const input: TaskDraft = capture(draft);
      validateDraft(input);
      checkRevision(expectedRevision);
      const snapshot: BusinessSnapshot = await this.read();
      if (snapshot.revision !== expectedRevision) throw new StorageFailure('VERSION_CONFLICT', '本地数据已变化，请重新读取后确认。');
      this.checkSources(snapshot, input);
      let id: string = '';
      for (let attempt: number = 0; attempt < 8; attempt++) {
        const candidate: string = this.runtime.nextId();
        this.checkId(candidate);
        if (!snapshot.tasks.some((task: Task) => task.id === candidate)) { id = candidate; break; }
      }
      requireArgument(id !== '', '任务 ID 连续冲突，未覆盖已有任务。');
      const now: string = this.now();
      const task: Task = { id: id, title: input.title, course: input.course, kind: input.kind,
        deadlinePrecision: input.deadlinePrecision, deadlineDate: input.deadlineDate, dueAt: input.dueAt,
        timezone: input.timezone, priority: input.priority, status: input.status, remainingMinutes: input.remainingMinutes,
        submissionChannel: input.submissionChannel, noticeIds: input.noticeIds, version: 1, createdAt: now, updatedAt: now };
      snapshot.tasks.push(task);
      const saved: BusinessSnapshot = value(await this.store.save(snapshot, expectedRevision));
      return storageSuccess(new TaskWrite(this.find(saved, id), saved.revision, true));
    } catch (error) { return storageError<TaskWrite>(error as Error); }
  }

  async update(taskId: string, draft: TaskDraft, expectedRevision: number, expectedVersion: number): Promise<StorageResult<TaskWrite>> {
    try {
      this.checkId(taskId);
      const input: TaskDraft = capture(draft);
      validateDraft(input);
      checkRevision(expectedRevision);
      requireArgument(Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 'expectedVersion 无效。');
      const snapshot: BusinessSnapshot = await this.read();
      const task: Task = this.find(snapshot, taskId);
      this.checkVersion(snapshot, expectedRevision, task, expectedVersion);
      this.checkSources(snapshot, input, taskId);
      const before: TaskDraft = editable(task);
      const after: TaskDraft = editable(input);
      if (JSON.stringify(before) === JSON.stringify(after)) return storageSuccess(new TaskWrite(task, snapshot.revision, false));
      requireArgument(Number.isSafeInteger(task.version + 1), '任务版本已超出支持范围。');
      const updated: Task = { id: task.id, title: after.title, course: after.course, kind: after.kind,
        deadlinePrecision: after.deadlinePrecision, deadlineDate: after.deadlineDate, dueAt: after.dueAt,
        timezone: after.timezone, priority: after.priority, status: after.status, remainingMinutes: after.remainingMinutes,
        submissionChannel: after.submissionChannel, noticeIds: after.noticeIds, version: task.version + 1,
        createdAt: task.createdAt, updatedAt: this.now(task.updatedAt) };
      snapshot.tasks[snapshot.tasks.findIndex((entry: Task) => entry.id === taskId)] = updated;
      const saved: BusinessSnapshot = value(await this.store.save(snapshot, expectedRevision));
      return storageSuccess(new TaskWrite(this.find(saved, taskId), saved.revision, true));
    } catch (error) { return storageError<TaskWrite>(error as Error); }
  }

  async delete(taskId: string, expectedRevision: number, expectedVersion: number): Promise<StorageResult<TaskWrite>> {
    try {
      this.checkId(taskId);
      checkRevision(expectedRevision);
      requireArgument(Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 'expectedVersion 无效。');
      const snapshot: BusinessSnapshot = await this.read();
      const task: Task = this.find(snapshot, taskId);
      this.checkVersion(snapshot, expectedRevision, task, expectedVersion);
      // Reserved schemas have no complete reference rules yet. Refuse instead of corrupting a future graph.
      requireArgument(snapshot.planBlocks.length === 0 && snapshot.proposals.length === 0 && snapshot.operations.length === 0,
        '存在计划、方案或操作记录，需后续完整关联删除流程处理。');
      snapshot.tasks = snapshot.tasks.filter((entry: Task) => entry.id !== taskId);
      snapshot.checklistItems = snapshot.checklistItems.filter((item: ChecklistItem) => item.taskId !== taskId);
      const saved: BusinessSnapshot = value(await this.store.save(snapshot, expectedRevision));
      return storageSuccess(new TaskWrite(task, saved.revision, true, true));
    } catch (error) { return storageError<TaskWrite>(error as Error); }
  }
}
