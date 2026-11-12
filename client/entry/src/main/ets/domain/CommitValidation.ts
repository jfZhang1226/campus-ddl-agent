import { BusinessSnapshot, ChecklistItem, Notice, Task } from './StorageModels';
import { TaskDraft } from './TaskContracts';
import { CommitProposal, CommitReceipt, ProposedTaskChange } from './CommitModels';
import { validateDraft, validateTask } from './TaskValidation';
import { isOffsetTimestamp, isTaskTimezone, timestampMillis } from './DateRules';
import { isStorageId, requireStorage, StorageFailure } from '../data/storage/StorageTypes';

export const LEGACY_PROPOSAL_RECORD: string = 't16.proposal.v1';
export const LEGACY_OPERATION_RECORD: string = 't16.operation.v1';
export const PROPOSAL_RECORD: string = 't16.proposal.v2';
export const OPERATION_RECORD: string = 't16.operation.v2';
export function isProposalRecord(type: string): boolean { return type === PROPOSAL_RECORD || type === LEGACY_PROPOSAL_RECORD; }
export function isOperationRecord(type: string): boolean { return type === OPERATION_RECORD || type === LEGACY_OPERATION_RECORD; }

function initialChecklist(items: ChecklistItem[]): void {
  requireStorage(Array.isArray(items) && items.length <= 200 && unique(items.map((item: ChecklistItem) => item.id)),
    '创建材料集合无效。');
  items.forEach((item: ChecklistItem) => requireStorage(isStorageId(item.id) && typeof item.taskId === 'string' &&
    item.taskId.trim().length > 0 && typeof item.label === 'string' && item.label.trim().length > 0 &&
    item.state === 'pending' && item.confirmedAt === null && (item.sourceNoticeId === null ||
    (typeof item.sourceNoticeId === 'string' && item.sourceNoticeId.trim().length > 0)) &&
    Object.keys(item).every((key: string) => ['id', 'taskId', 'label', 'state', 'sourceNoticeId', 'confirmedAt'].includes(key)),
    '创建材料必须是客户端预留 ID、pending 状态及合法来源。'));
}

function checklistText(items: ChecklistItem[]): string {
  return JSON.stringify(items.map((item: ChecklistItem) => [item.id, item.taskId, item.label, item.state, item.sourceNoticeId, item.confirmedAt]));
}

function unique(values: string[]): boolean {
  return Array.isArray(values) && values.every((id: string) => typeof id === 'string' && id.trim().length > 0) &&
    new Set<string>(values).size === values.length;
}

function editableText(task: TaskDraft): string {
  return JSON.stringify({ title: task.title, course: task.course, kind: task.kind, deadlinePrecision: task.deadlinePrecision,
    deadlineDate: task.deadlineDate, dueAt: task.dueAt, timezone: task.timezone, priority: task.priority, status: task.status,
    remainingMinutes: task.remainingMinutes, submissionChannel: task.submissionChannel, noticeIds: task.noticeIds });
}

export function validatePreparedNotice(notice: Notice): void {
  requireStorage(notice !== null && typeof notice === 'object' && !Array.isArray(notice) &&
    typeof notice.id === 'string' && notice.id.trim().length > 0 &&
    typeof notice.rawText === 'string' && notice.rawText.trim().length > 0 &&
    (notice.sourceLabel === null || (typeof notice.sourceLabel === 'string' && notice.sourceLabel.trim().length > 0)) &&
    (notice.publishedAt === null || isOffsetTimestamp(notice.publishedAt)) && isOffsetTimestamp(notice.importedAt) &&
    isTaskTimezone(notice.timezone) && typeof notice.contentHash === 'string' && /^[0-9a-f]{64}$/.test(notice.contentHash),
    '方案中的来源通知无效。');
}

export function validateProposal(proposal: CommitProposal): void {
  requireStorage(isProposalRecord(proposal.recordType) && isStorageId(proposal.id) && isStorageId(proposal.sessionId) &&
    proposal.kind === 'task_changes' && Number.isSafeInteger(proposal.expectedRevision) && proposal.expectedRevision > 0 &&
    ['pending', 'cancelled', 'applied'].includes(proposal.state) && isOffsetTimestamp(proposal.createdAt) &&
    (proposal.state === 'applied' ? isStorageId(proposal.operationId as string) : proposal.operationId === null), '方案元数据无效。');
  requireStorage(Array.isArray(proposal.changes) && proposal.changes.length > 0 && proposal.changes.length <= 50 &&
    unique(proposal.changes.map((change: ProposedTaskChange) => change.taskId)) && unique(proposal.sourceNoticeIds) &&
    Array.isArray(proposal.notices), '方案变更或来源集合无效。');
  proposal.notices.forEach((notice: Notice) => validatePreparedNotice(notice));
  requireStorage(unique(proposal.notices.map((notice: Notice) => notice.id)), '方案通知 ID 重复。');
  proposal.changes.forEach((change: ProposedTaskChange) => {
    requireStorage(change.action === 'create' || change.action === 'update', '当前方案只支持任务创建和编辑。');
    validateDraft(change.draft);
    if (change.action === 'create') {
      requireStorage(change.expectedVersion === null && change.before === null, '创建方案包含旧版本。');
    } else {
      requireStorage(change.before !== null && Number.isSafeInteger(change.expectedVersion) &&
        (change.expectedVersion as number) > 0, '编辑方案缺少旧任务和版本。');
      validateTask(change.before as Task);
      requireStorage((change.before as Task).id === change.taskId && (change.before as Task).version === change.expectedVersion,
        '编辑方案的任务版本不一致。');
    }
    requireStorage(change.draft.noticeIds.every((id: string) => proposal.sourceNoticeIds.includes(id)), '方案缺少关联来源。');
  });
  requireStorage(proposal.sourceNoticeIds.every((id: string) => proposal.changes.some((change: ProposedTaskChange) =>
    change.draft.noticeIds.includes(id))), '方案含未使用的来源。');
  requireStorage(proposal.notices.every((notice: Notice) => proposal.sourceNoticeIds.includes(notice.id)), '方案含未关联的新通知。');
  if (proposal.recordType === PROPOSAL_RECORD) {
    const items: ChecklistItem[] = proposal.checklistItems as ChecklistItem[];
    initialChecklist(items);
    items.forEach((item: ChecklistItem) => requireStorage(proposal.changes.some((change: ProposedTaskChange) =>
      change.action === 'create' && change.taskId === item.taskId &&
      (item.sourceNoticeId === null || change.draft.noticeIds.includes(item.sourceNoticeId))), '材料没有绑定本次新建任务或其来源。'));
  } else {
    requireStorage(!Object.keys(proposal).includes('checklistItems'), 'v1 方案不能携带 v2 材料。');
  }
  proposal.changes.forEach((change: ProposedTaskChange) => requireStorage(Object.keys(change).every((key: string) =>
    ['action', 'taskId', 'expectedVersion', 'before', 'draft'].includes(key)), '方案变更含未支持的字段。'));
}

export function validateReceipt(receipt: CommitReceipt): void {
  requireStorage(isOperationRecord(receipt.recordType) && isStorageId(receipt.operationId) && isStorageId(receipt.proposalId) &&
    receipt.resultStatus === 'committed' && Number.isSafeInteger(receipt.expectedRevision) && receipt.expectedRevision > 0 &&
    Number.isSafeInteger(receipt.committedRevision) && receipt.committedRevision === receipt.expectedRevision + 1 &&
    isOffsetTimestamp(receipt.confirmedAt) && isOffsetTimestamp(receipt.createdAt) &&
    timestampMillis(receipt.confirmedAt) <= timestampMillis(receipt.createdAt) &&
    unique(receipt.affectedTaskIds) && receipt.affectedTaskIds.length > 0 && unique(receipt.changedTaskIds) &&
    receipt.changedTaskIds.every((id: string) => receipt.affectedTaskIds.includes(id)) && Array.isArray(receipt.tasks) &&
    receipt.tasks.length === receipt.affectedTaskIds.length, '操作回执无效。');
  receipt.tasks.forEach((task: Task, index: number) => {
    validateTask(task);
    requireStorage(task.id === receipt.affectedTaskIds[index], '操作回执任务顺序或 ID 无效。');
  });
  if (receipt.recordType === OPERATION_RECORD) {
    initialChecklist(receipt.checklistItems as ChecklistItem[]);
    requireStorage(unique(receipt.createdChecklistItemIds as string[]) &&
      JSON.stringify(receipt.createdChecklistItemIds) === JSON.stringify((receipt.checklistItems as ChecklistItem[]).map((item: ChecklistItem) => item.id)) &&
      Array.isArray(receipt.notices) && unique((receipt.notices as Notice[]).map((notice: Notice) => notice.id)), '材料或来源回执无效。');
    (receipt.notices as Notice[]).forEach((notice: Notice) => validatePreparedNotice(notice));
    (receipt.checklistItems as ChecklistItem[]).forEach((item: ChecklistItem) => requireStorage(receipt.tasks.some((task: Task) =>
      task.id === item.taskId && (item.sourceNoticeId === null || task.noticeIds.includes(item.sourceNoticeId))), '材料回执任务或来源错绑。'));
  } else {
    requireStorage(!Object.keys(receipt).some((key: string) => ['checklistItems', 'createdChecklistItemIds', 'notices'].includes(key)),
      'v1 回执不能携带 v2 结果。');
  }
}

/** Additive tagged records; legacy/future untagged JSON remains untouched. */
export function validateCommitRecords(snapshot: BusinessSnapshot): void {
  const proposals: CommitProposal[] = [];
  const operations: CommitReceipt[] = [];
  snapshot.proposals.forEach((entry: Object) => {
    const proposal: CommitProposal = entry as CommitProposal;
    if (typeof proposal.recordType === 'string' && proposal.recordType.startsWith('t16.proposal.') && !isProposalRecord(proposal.recordType)) {
      throw new StorageFailure('UNSUPPORTED_SCHEMA', '方案记录版本不受支持，原文件已保留。');
    }
    if (isProposalRecord(proposal.recordType)) { validateProposal(proposal); proposals.push(proposal); }
  });
  snapshot.operations.forEach((entry: Object) => {
    const receipt: CommitReceipt = entry as CommitReceipt;
    if (typeof receipt.recordType === 'string' && receipt.recordType.startsWith('t16.operation.') && !isOperationRecord(receipt.recordType)) {
      throw new StorageFailure('UNSUPPORTED_SCHEMA', '操作记录版本不受支持，原文件已保留。');
    }
    if (isOperationRecord(receipt.recordType)) { validateReceipt(receipt); operations.push(receipt); }
  });
  requireStorage(unique(proposals.map((entry: CommitProposal) => entry.id)) &&
    unique(operations.map((entry: CommitReceipt) => entry.operationId)), '方案或操作 ID 重复。');
  proposals.forEach((proposal: CommitProposal) => {
    const matching: CommitReceipt[] = operations.filter((operation: CommitReceipt) => operation.proposalId === proposal.id);
    requireStorage(proposal.state === 'applied' ? matching.length === 1 && matching[0].operationId === proposal.operationId &&
      matching[0].expectedRevision === proposal.expectedRevision &&
      JSON.stringify(matching[0].affectedTaskIds) === JSON.stringify(proposal.changes.map((change: ProposedTaskChange) => change.taskId)) :
      matching.length === 0, '方案与操作回执关联不一致。');
    if (proposal.state === 'applied') {
      const receipt: CommitReceipt = matching[0];
      requireStorage((proposal.recordType === PROPOSAL_RECORD) === (receipt.recordType === OPERATION_RECORD), '方案与回执版本不一致。');
      if (proposal.recordType === PROPOSAL_RECORD) {
        requireStorage(checklistText(proposal.checklistItems as ChecklistItem[]) === checklistText(receipt.checklistItems as ChecklistItem[]) &&
          JSON.stringify(proposal.notices) === JSON.stringify(receipt.notices), '材料或来源结果与确认方案不一致。');
      }
      requireStorage(timestampMillis(receipt.confirmedAt) >= timestampMillis(proposal.createdAt), '确认时间早于方案。');
      proposal.changes.forEach((change: ProposedTaskChange, index: number) => {
        const task: Task = receipt.tasks[index];
        requireStorage(editableText(task) === editableText(change.draft), '回执内容与确认方案不一致。');
        if (change.action === 'create') {
          requireStorage(task.version === 1 && task.createdAt === receipt.createdAt && task.updatedAt === receipt.createdAt &&
            receipt.changedTaskIds.includes(task.id), '创建回执的版本或审计信息无效。');
        } else {
          const before: Task = change.before as Task;
          const changed: boolean = editableText(before) !== editableText(change.draft);
          requireStorage(task.createdAt === before.createdAt && task.version === before.version + (changed ? 1 : 0) &&
            task.updatedAt === (changed ? receipt.createdAt : before.updatedAt) &&
            receipt.changedTaskIds.includes(task.id) === changed, '编辑回执的版本、变更标志或审计信息无效。');
        }
      });
    }
  });
  requireStorage(operations.every((operation: CommitReceipt) => proposals.some((proposal: CommitProposal) => proposal.id === operation.proposalId)),
    '操作回执缺少方案。');
  const reserved: string[] = [];
  proposals.filter((proposal: CommitProposal) => proposal.recordType === PROPOSAL_RECORD).forEach((proposal: CommitProposal) => {
    (proposal.checklistItems as ChecklistItem[]).forEach((item: ChecklistItem) => {
      requireStorage(!reserved.includes(item.id), '方案材料 ID 重复预留。'); reserved.push(item.id);
      const current: ChecklistItem | undefined = snapshot.checklistItems.find((entry: ChecklistItem) => entry.id === item.id);
      requireStorage(proposal.state === 'applied' ? current !== undefined && current.taskId === item.taskId &&
        current.sourceNoticeId === item.sourceNoticeId : current === undefined, '方案材料与正式业务的绑定不一致。');
    });
  });
}
