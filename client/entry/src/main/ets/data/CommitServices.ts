import { BusinessSnapshot, ChecklistItem, Notice, Task } from '../domain/StorageModels';
import { LocalTaskRuntime, TaskDraft, TaskRuntime } from '../domain/TaskContracts';
import { ChecklistCreateDraft, CommitProposal, CommitReceipt, ConfirmedCommitRequest, ProposalDraft, ProposedTaskChange, TaskChangeDraft } from '../domain/CommitModels';
import { LEGACY_OPERATION_RECORD, OPERATION_RECORD, PROPOSAL_RECORD, isOperationRecord, isProposalRecord, validatePreparedNotice, validateProposal } from '../domain/CommitValidation';
import { isOffsetTimestamp, timestampMillis } from '../domain/DateRules';
import { requireArgument, validateDraft, validateTask } from '../domain/TaskValidation';
import { LocalStore } from './LocalStore';
import { requireJsonValue } from './storage/JsonValues';
import { isStorageId, StorageFailure, StorageResult, storageError, storageSuccess } from './storage/StorageTypes';

function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) throw new StorageFailure(result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode, result.message);
  return result.data;
}
function copy<T extends Object>(input: T): T {
  try { requireJsonValue(input); return JSON.parse(JSON.stringify(input)) as T; }
  catch (error) { throw new StorageFailure('INVALID_ARGUMENT', '参数必须是完整、有限的 JSON。'); }
}
async function guard<T>(work: () => Promise<T>): Promise<StorageResult<T>> {
  try { return storageSuccess(await work()); } catch (error) { return storageError<T>(error as Error); }
}
function revision(input: number): void {
  requireArgument(Number.isSafeInteger(input) && input >= 0, 'expectedRevision 无效。');
}
function fields(input: TaskDraft): TaskDraft {
  return { title: input.title, course: input.course, kind: input.kind, deadlinePrecision: input.deadlinePrecision,
    deadlineDate: input.deadlineDate, dueAt: input.dueAt, timezone: input.timezone, priority: input.priority,
    status: input.status, remainingMinutes: input.remainingMinutes, submissionChannel: input.submissionChannel,
    noticeIds: input.noticeIds.slice() };
}

class ConfirmationRecord {
  request: ConfirmedCommitRequest;
  proposalText: string;
  confirmedAt: string;
  constructor(request: ConfirmedCommitRequest, proposal: CommitProposal, now: string) {
    this.request = request; this.proposalText = JSON.stringify(proposal); this.confirmedAt = now;
  }
}

class CommitEngine {
  private store: LocalStore;
  private runtime: TaskRuntime;
  private confirmations: ConfirmationRecord[] = [];
  constructor(store: LocalStore, runtime: TaskRuntime) { this.store = store; this.runtime = runtime; }

  private async read(): Promise<BusinessSnapshot> {
    const snapshot: BusinessSnapshot = value(await this.store.read());
    try {
      snapshot.tasks.forEach((task: Task) => validateTask(task));
      snapshot.operations.forEach((entry: Object) => {
        const operation: CommitReceipt = entry as CommitReceipt;
        if (isOperationRecord(operation.recordType) && operation.committedRevision > snapshot.revision) {
          throw new StorageFailure('CORRUPT_DATA', '操作回执版本超出正式快照。');
        }
      });
    } catch (error) { throw new StorageFailure('CORRUPT_DATA', '业务数据或操作版本无效，原文件已保留。'); }
    return snapshot;
  }
  private proposal(snapshot: BusinessSnapshot, id: string): CommitProposal {
    requireArgument(isStorageId(id), 'proposalId 无效。');
    const entry: Object | undefined = snapshot.proposals.find((item: Object) => (item as CommitProposal).id === id);
    if (entry === undefined) throw new StorageFailure('NOT_FOUND', '方案不存在。');
    const proposal: CommitProposal = entry as CommitProposal;
    if (!isProposalRecord(proposal.recordType)) throw new StorageFailure('UNSUPPORTED_SCHEMA', '该方案仅可保留回看，当前不能执行。');
    return proposal;
  }
  private operation(snapshot: BusinessSnapshot, id: string): CommitReceipt | null {
    const entry: Object | undefined = snapshot.operations.find((item: Object) => (item as CommitReceipt).operationId === id);
    if (entry === undefined) return null;
    const receipt: CommitReceipt = entry as CommitReceipt;
    if (!isOperationRecord(receipt.recordType)) throw new StorageFailure('INVALID_ARGUMENT', 'operationId 已由不支持的记录使用。');
    return receipt;
  }
  private replay(snapshot: BusinessSnapshot, request: ConfirmedCommitRequest): CommitReceipt | null {
    const receipt: CommitReceipt | null = this.operation(snapshot, request.operationId);
    if (receipt !== null) {
      requireArgument(receipt.proposalId === request.proposalId && receipt.expectedRevision === request.expectedRevision,
        'operationId 已绑定其他方案或版本，不能改作新操作。');
    }
    return receipt;
  }
  private now(after: string | null = null): string {
    const time: string = this.runtime.now();
    requireArgument(isOffsetTimestamp(time) && (after === null || timestampMillis(time) >= timestampMillis(after)),
      '客户端时钟无效或早于已有记录，请校正后重试。');
    return time;
  }
  private id(prefix: string, used: string[]): string {
    for (let attempt: number = 0; attempt < 8; attempt++) {
      // T14's shared runtime returns task-prefixed IDs. Keep its contract and old IDs intact.
      const token: string = this.runtime.nextId();
      const id: string = prefix + (token.startsWith('task-') ? token.slice(5) : token);
      if (isStorageId(id) && !used.includes(id)) return id;
    }
    throw new StorageFailure('INVALID_ARGUMENT', '本地标识生成失败，未覆盖已有记录。');
  }
  private checkRevision(snapshot: BusinessSnapshot, expected: number): void {
    revision(expected);
    if (snapshot.revision !== expected) throw new StorageFailure('VERSION_CONFLICT', '本地数据已变化，请重读差异并重新确认。');
  }
  private pending(snapshot: BusinessSnapshot, id: string, expected: number): CommitProposal {
    const proposal: CommitProposal = this.proposal(snapshot, id);
    if (proposal.state !== 'pending') throw new StorageFailure(proposal.state === 'cancelled' ? 'PROPOSAL_CANCELLED' : 'ALREADY_APPLIED',
      '方案已取消或提交，请读取实际结果。');
    this.checkRevision(snapshot, expected);
    if (proposal.expectedRevision !== expected) throw new StorageFailure('VERSION_CONFLICT', '该方案已过期，请按当前数据重新生成并确认。');
    return proposal;
  }

  stage(input: ProposalDraft): Promise<StorageResult<CommitProposal>> {
    return guard(async () => {
      const draft: ProposalDraft = copy(input);
      requireArgument(Object.keys(draft).every((key: string) => ['sessionId', 'expectedRevision', 'notices', 'changes'].includes(key)),
        '方案含未支持的字段，不能忽略后保存。');
      requireArgument(isStorageId(draft.sessionId) && Array.isArray(draft.notices) && Array.isArray(draft.changes) &&
        draft.changes.length > 0 && draft.changes.length <= 50, '方案会话或变更数量无效。');
      revision(draft.expectedRevision);
      draft.changes.forEach((change: TaskChangeDraft) => {
        requireArgument(change !== null && typeof change === 'object' && ['create', 'update'].includes(change.action), '当前仅支持创建和编辑任务。');
        requireArgument(Object.keys(change).every((key: string) => ['action', 'taskId', 'expectedVersion', 'draft', 'checklistCreates'].includes(key)),
          '任务变更含未支持的字段。');
        validateDraft(change.draft);
        requireArgument(Object.keys(change.draft).every((key: string) => Object.keys(new TaskDraft()).includes(key)), '任务草案含未支持的字段。');
        // Omission keeps the old parameter DTO compatible. null is not an empty collection.
        if (change.checklistCreates === undefined) change.checklistCreates = [];
        requireArgument(Array.isArray(change.checklistCreates) && (change.action === 'create' || change.checklistCreates.length === 0),
          '当前只支持随新建任务创建材料，编辑/删除/勾选材料请等待 T22。');
        change.checklistCreates.forEach((item: ChecklistCreateDraft) => requireArgument(item !== null && typeof item === 'object' &&
          !Array.isArray(item) && Object.keys(item).every((key: string) => ['label', 'sourceNoticeId'].includes(key)) &&
          typeof item.label === 'string' && item.label.trim().length > 0 && (item.sourceNoticeId === null ||
          (typeof item.sourceNoticeId === 'string' && item.sourceNoticeId.trim().length > 0)), '新材料只接受 label 与 sourceNoticeId。'));
      });
      requireArgument(draft.changes.reduce((count: number, change: TaskChangeDraft) => count + change.checklistCreates.length, 0) <= 200,
        '单个方案最多创建 200 项材料。');
      try { draft.notices.forEach((notice: Notice) => validatePreparedNotice(notice)); }
      catch (error) { throw new StorageFailure('INVALID_ARGUMENT', '待导入的通知字段无效。'); }
      const snapshot: BusinessSnapshot = await this.read();
      this.checkRevision(snapshot, draft.expectedRevision);
      requireArgument(Number.isSafeInteger(snapshot.revision + 2), '快照版本已超出支持范围。');
      requireArgument(new Set<string>(draft.notices.map((notice: Notice) => notice.id)).size === draft.notices.length &&
        draft.notices.every((notice: Notice) => !snapshot.notices.some((old: Notice) => old.id === notice.id)),
        '新通知 ID 重复或已存在。');
      const usedTasks: string[] = snapshot.tasks.map((task: Task) => task.id);
      const usedItems: string[] = snapshot.checklistItems.map((item: ChecklistItem) => item.id);
      // Pending creates also reserve IDs, including supported records from older snapshots.
      snapshot.proposals.forEach((entry: Object) => {
        const previous: CommitProposal = entry as CommitProposal;
        if (isProposalRecord(previous.recordType)) previous.changes.forEach((change: ProposedTaskChange) => usedTasks.push(change.taskId));
        if (previous.recordType === PROPOSAL_RECORD) (previous.checklistItems as ChecklistItem[]).forEach((item: ChecklistItem) => usedItems.push(item.id));
      });
      const changes: ProposedTaskChange[] = [];
      const items: ChecklistItem[] = [];
      draft.changes.forEach((change: TaskChangeDraft) => {
        let taskId: string;
        let before: Task | null = null;
        if (change.action === 'create') {
          requireArgument(change.taskId === null && change.expectedVersion === null, '创建不能指定正式任务 ID 或版本。');
          taskId = this.id('task-', usedTasks); usedTasks.push(taskId);
        } else {
          requireArgument(typeof change.taskId === 'string' && change.taskId.trim().length > 0 && Number.isSafeInteger(change.expectedVersion) &&
            (change.expectedVersion as number) > 0, '编辑缺少有效任务 ID 或版本。');
          taskId = change.taskId as string;
          const target: Task | undefined = snapshot.tasks.find((task: Task) => task.id === taskId);
          if (target === undefined) throw new StorageFailure('NOT_FOUND', '编辑目标不存在。');
          if (target.version !== change.expectedVersion) throw new StorageFailure('VERSION_CONFLICT', '编辑目标已变化，请重新读取。');
          before = copy(target);
        }
        requireArgument(!changes.some((prior: ProposedTaskChange) => prior.taskId === taskId), '同一方案不能重复修改同一任务。');
        const taskDraft: TaskDraft = fields(change.draft);
        requireArgument(taskDraft.noticeIds.every((id: string) => snapshot.notices.some((notice: Notice) => notice.id === id) ||
          draft.notices.some((notice: Notice) => notice.id === id)), '方案任务引用的通知不存在。');
        requireArgument(snapshot.checklistItems.filter((item: ChecklistItem) => item.taskId === taskId).every((item: ChecklistItem) =>
          item.sourceNoticeId === null || taskDraft.noticeIds.includes(item.sourceNoticeId)), '不能移除仍被清单引用的来源。');
        change.checklistCreates.forEach((item: ChecklistCreateDraft) => {
          requireArgument(item.sourceNoticeId === null || taskDraft.noticeIds.includes(item.sourceNoticeId), '材料来源必须属于所在任务的来源。');
          const itemId: string = this.id('item-', usedItems); usedItems.push(itemId);
          items.push({ id: itemId, taskId: taskId, label: item.label, sourceNoticeId: item.sourceNoticeId, state: 'pending', confirmedAt: null });
        });
        changes.push({ action: change.action, taskId: taskId, expectedVersion: change.expectedVersion, before: before, draft: taskDraft });
      });
      const sources: string[] = [];
      changes.forEach((change: ProposedTaskChange) => change.draft.noticeIds.forEach((id: string) => { if (!sources.includes(id)) sources.push(id); }));
      requireArgument(draft.notices.every((notice: Notice) => sources.includes(notice.id)), '新通知必须关联本次任务。');
      const id: string = this.id('proposal-', snapshot.proposals.map((entry: Object) => (entry as CommitProposal).id));
      const proposal: CommitProposal = { recordType: PROPOSAL_RECORD, id: id, sessionId: draft.sessionId, kind: 'task_changes',
        changes: changes, notices: draft.notices, sourceNoticeIds: sources, expectedRevision: snapshot.revision + 1,
        state: 'pending', createdAt: this.now(), operationId: null, checklistItems: items };
      validateProposal(proposal);
      snapshot.proposals.push(proposal);
      value(await this.store.save(snapshot, draft.expectedRevision));
      return copy(proposal);
    });
  }
  get(id: string): Promise<StorageResult<CommitProposal>> { return guard(async () => copy(this.proposal(await this.read(), id))); }
  list(): Promise<StorageResult<CommitProposal[]>> {
    return guard(async () => (await this.read()).proposals.filter((entry: Object) =>
      isProposalRecord((entry as CommitProposal).recordType)) as CommitProposal[]);
  }
  receipt(id: string): Promise<StorageResult<CommitReceipt>> {
    return guard(async () => {
      requireArgument(isStorageId(id), 'operationId 无效。');
      const receipt: CommitReceipt | null = this.operation(await this.read(), id);
      if (receipt === null) throw new StorageFailure('NOT_FOUND', '尚无该操作的正式提交回执。');
      return copy(receipt);
    });
  }

  confirm(id: string, expected: number): Promise<StorageResult<ConfirmedCommitRequest>> {
    return guard(async () => {
      revision(expected);
      const snapshot: BusinessSnapshot = await this.read();
      const proposal: CommitProposal = this.proposal(snapshot, id);
      if (proposal.state === 'applied') {
        requireArgument(expected === proposal.expectedRevision, '重试必须保持原确认版本。');
        const receipt: CommitReceipt = this.operation(snapshot, proposal.operationId as string) as CommitReceipt;
        return copy(new ConfirmedCommitRequest(id, receipt.operationId, expected));
      }
      this.pending(snapshot, id, expected);
      const text: string = JSON.stringify(proposal);
      const existing: ConfirmationRecord | undefined = this.confirmations.find((record: ConfirmationRecord) =>
        record.request.proposalId === id && record.proposalText === text);
      if (existing !== undefined) return copy(existing.request);
      const used: string[] = snapshot.operations.map((entry: Object) => (entry as CommitReceipt).operationId).concat(
        this.confirmations.map((record: ConfirmationRecord) => record.request.operationId));
      const request: ConfirmedCommitRequest = new ConfirmedCommitRequest(id, this.id('operation-', used), expected);
      this.confirmations.push(new ConfirmationRecord(request, proposal, this.now(proposal.createdAt)));
      return copy(request);
    });
  }

  apply(input: ConfirmedCommitRequest): Promise<StorageResult<CommitReceipt>> {
    return guard(async () => {
      const request: ConfirmedCommitRequest = copy(input);
      requireArgument(isStorageId(request.proposalId) && isStorageId(request.operationId), '方案或操作标识无效。');
      requireArgument(Object.keys(request).every((key: string) => ['proposalId', 'operationId', 'expectedRevision'].includes(key)),
        '提交只接受已确认方案标识，不能附带新的修改或确认标志。');
      revision(request.expectedRevision);
      const snapshot: BusinessSnapshot = await this.read();
      const replay: CommitReceipt | null = this.replay(snapshot, request);
      // Durable replay precedes revision/auth checks: a successful retry must survive restart and later writes.
      if (replay !== null) return copy(replay);
      const proposal: CommitProposal = this.pending(snapshot, request.proposalId, request.expectedRevision);
      const authorization: ConfirmationRecord | undefined = this.confirmations.find((record: ConfirmationRecord) =>
        record.request.operationId === request.operationId && record.request.proposalId === request.proposalId &&
        record.request.expectedRevision === request.expectedRevision && record.proposalText === JSON.stringify(proposal));
      if (authorization === undefined) throw new StorageFailure('CONFIRMATION_REQUIRED', '需要由客户端重新展示方案并明确确认。');
      const now: string = this.now(authorization.confirmedAt);
      const tasks: Task[] = [];
      const changed: string[] = [];
      snapshot.notices.push(...copy(proposal.notices));
      proposal.changes.forEach((change: ProposedTaskChange) => {
        const index: number = snapshot.tasks.findIndex((task: Task) => task.id === change.taskId);
        let task: Task;
        if (change.action === 'create') {
          requireArgument(index < 0, '预留任务 ID 已被使用。');
          task = { id: change.taskId, title: change.draft.title, course: change.draft.course, kind: change.draft.kind,
            deadlinePrecision: change.draft.deadlinePrecision, deadlineDate: change.draft.deadlineDate, dueAt: change.draft.dueAt,
            timezone: change.draft.timezone, priority: change.draft.priority, status: change.draft.status,
            remainingMinutes: change.draft.remainingMinutes, submissionChannel: change.draft.submissionChannel,
            noticeIds: change.draft.noticeIds.slice(), version: 1, createdAt: now, updatedAt: now };
          snapshot.tasks.push(task); changed.push(task.id);
        } else {
          if (index < 0 || snapshot.tasks[index].version !== change.expectedVersion) {
            throw new StorageFailure('VERSION_CONFLICT', '任务版本已变化，请重新读取差异并确认。');
          }
          task = snapshot.tasks[index];
          if (JSON.stringify(fields(task)) !== JSON.stringify(change.draft)) {
            requireArgument(Number.isSafeInteger(task.version + 1) && timestampMillis(now) >= timestampMillis(task.updatedAt),
              '任务版本或客户端时钟无效。');
            task = { id: task.id, title: change.draft.title, course: change.draft.course, kind: change.draft.kind,
              deadlinePrecision: change.draft.deadlinePrecision, deadlineDate: change.draft.deadlineDate, dueAt: change.draft.dueAt,
              timezone: change.draft.timezone, priority: change.draft.priority, status: change.draft.status,
              remainingMinutes: change.draft.remainingMinutes, submissionChannel: change.draft.submissionChannel,
              noticeIds: change.draft.noticeIds.slice(), version: task.version + 1, createdAt: task.createdAt, updatedAt: now };
            snapshot.tasks[index] = task; changed.push(task.id);
          }
        }
        tasks.push(copy(task));
      });
      const receipt: CommitReceipt = { recordType: proposal.recordType === PROPOSAL_RECORD ? OPERATION_RECORD : LEGACY_OPERATION_RECORD,
        operationId: request.operationId, proposalId: proposal.id,
        expectedRevision: request.expectedRevision, resultStatus: 'committed', affectedTaskIds: tasks.map((task: Task) => task.id),
        changedTaskIds: changed, tasks: tasks, committedRevision: snapshot.revision + 1,
        confirmedAt: authorization.confirmedAt, createdAt: now };
      if (proposal.recordType === PROPOSAL_RECORD) {
        const items: ChecklistItem[] = copy(proposal.checklistItems as ChecklistItem[]);
        requireArgument(items.every((item: ChecklistItem) => !snapshot.checklistItems.some((old: ChecklistItem) => old.id === item.id)),
          '预留材料 ID 已被使用。');
        snapshot.checklistItems.push(...items);
        receipt.notices = copy(proposal.notices);
        receipt.createdChecklistItemIds = items.map((item: ChecklistItem) => item.id);
        receipt.checklistItems = copy(items);
      }
      proposal.state = 'applied'; proposal.operationId = request.operationId;
      snapshot.operations.push(receipt);
      const saved: StorageResult<BusinessSnapshot> = await this.store.save(snapshot, request.expectedRevision);
      if (!saved.success) {
        // A concurrent identical apply or an uncertain replace may already have committed. Read only; never auto-resave.
        const reread: StorageResult<BusinessSnapshot> = await this.store.read();
        if (reread.success && reread.data !== null) {
          const actual: CommitReceipt | null = this.replay(reread.data, request);
          if (actual !== null && actual.committedRevision <= reread.data.revision) return copy(actual);
        }
        throw new StorageFailure(saved.errorCode === null ? 'STORAGE_FAILED' : saved.errorCode,
          saved.errorCode === 'VERSION_CONFLICT' ? '数据已变化，请重读差异并重新确认。' :
            '保存未获确认；请保留操作编号，读取回执或明确重试，不能视作已保存。');
      }
      this.confirmations = this.confirmations.filter((record: ConfirmationRecord) => record.request.proposalId !== proposal.id);
      return copy(receipt);
    });
  }

  cancel(id: string, expected: number): Promise<StorageResult<CommitProposal>> {
    return guard(async () => {
      const snapshot: BusinessSnapshot = await this.read();
      this.checkRevision(snapshot, expected);
      const proposal: CommitProposal = this.proposal(snapshot, id);
      if (proposal.state === 'applied') throw new StorageFailure('ALREADY_APPLIED', '方案已提交，请读取正式结果。');
      if (proposal.state === 'cancelled') return copy(proposal);
      proposal.state = 'cancelled';
      value(await this.store.save(snapshot, expected));
      this.confirmations = this.confirmations.filter((record: ConfirmationRecord) => record.request.proposalId !== id);
      return copy(proposal);
    });
  }
}

/** Draft/read capability only. A model adapter may whitelist these, never ClientConfirmation. */
export class ProposalRepository {
  private engine: CommitEngine;
  constructor(engine: CommitEngine) { this.engine = engine; }
  stage(input: ProposalDraft): Promise<StorageResult<CommitProposal>> { return this.engine.stage(input); }
  get(id: string): Promise<StorageResult<CommitProposal>> { return this.engine.get(id); }
  list(): Promise<StorageResult<CommitProposal[]>> { return this.engine.list(); }
}

/** Trusted screen-action capability. confirm() must be invoked only after the displayed user's explicit confirmation. */
export class ClientConfirmation {
  private engine: CommitEngine;
  constructor(engine: CommitEngine) { this.engine = engine; }
  confirm(id: string, expectedRevision: number): Promise<StorageResult<ConfirmedCommitRequest>> { return this.engine.confirm(id, expectedRevision); }
  apply(request: ConfirmedCommitRequest): Promise<StorageResult<CommitReceipt>> { return this.engine.apply(request); }
  cancel(id: string, expectedRevision: number): Promise<StorageResult<CommitProposal>> { return this.engine.cancel(id, expectedRevision); }
  receipt(id: string): Promise<StorageResult<CommitReceipt>> { return this.engine.receipt(id); }
}

export class CommitServices {
  proposals: ProposalRepository;
  confirmation: ClientConfirmation;
  constructor(store: LocalStore, runtime: TaskRuntime = new LocalTaskRuntime()) {
    const engine: CommitEngine = new CommitEngine(store, runtime);
    this.proposals = new ProposalRepository(engine); this.confirmation = new ClientConfirmation(engine);
  }
}
