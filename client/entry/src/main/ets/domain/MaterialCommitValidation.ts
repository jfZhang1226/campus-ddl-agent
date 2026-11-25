import { ChecklistItem, Task } from './StorageModels';
import { CommitProposal, CommitReceipt, ProposedChecklistState, UserSubmissionSnapshot } from './CommitModels';
import { isOffsetTimestamp, timestampMillis } from './DateRules';
import { requireStorage } from '../data/storage/StorageTypes';
import { sha256Hex } from '../data/storage/Sha256';

export const MATERIAL_PROPOSAL_RECORD: string = 't16.proposal.v3';
export const MATERIAL_OPERATION_RECORD: string = 't16.operation.v3';
export function materialFields(item: ChecklistItem): string {
  return JSON.stringify([item.id, item.taskId, item.label, item.state, item.sourceNoticeId, item.confirmedAt]);
}
export function materialListText(items: ChecklistItem[]): string { return JSON.stringify(items.map(item => materialFields(item)).sort()); }
export function checkMaterialItems(items: ChecklistItem[]): void {
  requireStorage(Array.isArray(items) && items.length <= 10000 && items.every(item => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
    new Set(items.map(item => item.id)).size === items.length, '材料历史集合无效。');
  items.forEach(item => requireStorage(typeof item.id === 'string' && item.id.trim().length > 0 && typeof item.taskId === 'string' && item.taskId.trim().length > 0 &&
    typeof item.label === 'string' && item.label.trim().length > 0 && (item.sourceNoticeId === null || typeof item.sourceNoticeId === 'string' && item.sourceNoticeId.trim().length > 0) &&
    (item.state === 'pending' && item.confirmedAt === null || item.state === 'prepared' && isOffsetTimestamp(item.confirmedAt as string)) &&
    Object.keys(item).every(key => ['id', 'taskId', 'label', 'state', 'sourceNoticeId', 'confirmedAt'].includes(key)), '材料历史字段无效。'));
}
export function materialChangeForTask(proposal: CommitProposal, taskId: string): boolean {
  if (proposal.recordType !== MATERIAL_PROPOSAL_RECORD) return false;
  return (proposal.checklistItems || []).some(item => item.taskId === taskId) ||
    (proposal.checklistUpdates || []).some(item => item.taskId === taskId && item.before.state !== item.state);
}
export function finalMaterials(proposal: CommitProposal, taskId: string, confirmedAt: string): ChecklistItem[] {
  const before: ChecklistItem[] = JSON.parse(JSON.stringify((proposal.checklistBefore || []).filter(item => item.taskId === taskId))) as ChecklistItem[];
  const updates = proposal.checklistUpdates || [];
  before.forEach(item => {
    const update = updates.find(change => change.itemId === item.id);
    if (update !== undefined && update.state !== item.state) {
      item.state = update.state; item.confirmedAt = update.state === 'prepared' ? confirmedAt : null;
    }
  });
  return before.concat(JSON.parse(JSON.stringify((proposal.checklistItems || []).filter(item => item.taskId === taskId))) as ChecklistItem[]);
}
export function submissionId(operationId: string, taskId: string): string {
  return 'submission-' + sha256Hex(JSON.stringify([operationId, taskId])).slice(0, 32);
}
export function needsSubmissionSnapshot(proposal: CommitProposal, taskId: string): boolean {
  const change = proposal.changes.find(item => item.taskId === taskId);
  return change !== undefined && change.draft.status === 'submitted' && (change.before?.status !== 'submitted' || change.confirmSubmission === true);
}
export function validateMaterialProposal(proposal: CommitProposal): void {
  const before = proposal.checklistBefore as ChecklistItem[];
  const updates = proposal.checklistUpdates as ProposedChecklistState[];
  checkMaterialItems(before);
  requireStorage(Array.isArray(updates) && updates.length <= 200 && updates.every(item => item !== null && typeof item === 'object') &&
    new Set(updates.map(item => item.itemId)).size === updates.length, '材料状态变更集合无效。');
  before.forEach(item => requireStorage(proposal.changes.some(change => change.action === 'update' && change.taskId === item.taskId &&
    (item.sourceNoticeId === null || change.before !== null && change.before.noticeIds.includes(item.sourceNoticeId))), '旧材料错绑任务或来源。'));
  updates.forEach(update => {
    requireStorage(typeof update.itemId === 'string' && update.itemId.trim().length > 0 && typeof update.taskId === 'string' && ['pending', 'prepared'].includes(update.state) &&
      Object.keys(update).every(key => ['itemId', 'taskId', 'before', 'state'].includes(key)), '材料状态变更字段无效。');
    checkMaterialItems([update.before]);
    requireStorage(update.before.id === update.itemId && update.before.taskId === update.taskId &&
      before.some(item => materialFields(item) === materialFields(update.before)) &&
      proposal.changes.some(change => change.action === 'update' && change.taskId === update.taskId), '材料状态变更缺少匹配的旧记录。');
  });
  requireStorage((proposal.checklistItems || []).every(item => !before.some(old => old.id === item.id)), '新旧材料ID混用。');
  proposal.changes.forEach(change => {
    requireStorage(change.confirmSubmission === undefined || typeof change.confirmSubmission === 'boolean' && change.draft.status === 'submitted', '提交声明标记无效。');
    requireStorage(finalMaterials(proposal, change.taskId, proposal.createdAt).length <= 200, '单个任务材料最多200项。');
  });
}
export function validateMaterialReceipt(receipt: CommitReceipt): void {
  const updates = receipt.updatedChecklistItems as ChecklistItem[];
  const submissions = receipt.submissionSnapshots as UserSubmissionSnapshot[];
  checkMaterialItems(updates);
  requireStorage(updates.length <= 200 && updates.every(item => receipt.tasks.some(task => task.id === item.taskId &&
    (item.sourceNoticeId === null || task.noticeIds.includes(item.sourceNoticeId)))), '材料更新回执错绑任务/来源。');
  requireStorage(Array.isArray(submissions) && submissions.length <= 50 && submissions.every(item => item !== null && typeof item === 'object') &&
    new Set(submissions.map(item => item.taskId)).size === submissions.length, '用户提交快照无效。');
  submissions.forEach(submission => {
    const task: Task | undefined = receipt.tasks.find(item => item.id === submission.taskId);
    requireStorage(task !== undefined && task.status === 'submitted' && submission.id === submissionId(receipt.operationId, submission.taskId) &&
      submission.taskVersion === task.version && submission.confirmedSubmittedAt === receipt.confirmedAt &&
      submission.submissionChannel === task.submissionChannel && JSON.stringify(submission.sourceNoticeIds) === JSON.stringify(task.noticeIds), '用户提交快照与回执不一致。');
    checkMaterialItems(submission.materials);
    requireStorage(submission.materials.length <= 200 && submission.materials.every(item => item.taskId === submission.taskId && item.state === 'prepared' &&
      timestampMillis(item.confirmedAt as string) <= timestampMillis(submission.confirmedSubmittedAt) &&
      (item.sourceNoticeId === null || submission.sourceNoticeIds.includes(item.sourceNoticeId))), '提交时材料尚未准备或错绑任务/来源。');
  });
}
export function validateMaterialPair(proposal: CommitProposal, receipt: CommitReceipt): void {
  const updates = proposal.checklistUpdates as ProposedChecklistState[];
  const actual = receipt.updatedChecklistItems as ChecklistItem[];
  requireStorage(actual.length === updates.length, '材料更新回执数量与方案不一致。');
  updates.forEach((update, index) => {
    const expected: ChecklistItem = JSON.parse(JSON.stringify(update.before)) as ChecklistItem;
    if (expected.state !== update.state) { expected.state = update.state; expected.confirmedAt = update.state === 'prepared' ? receipt.confirmedAt : null; }
    requireStorage(materialFields(expected) === materialFields(actual[index]), '材料回执与明确确认的状态不一致。');
  });
  const submissions = receipt.submissionSnapshots as UserSubmissionSnapshot[];
  const expectedTasks = proposal.changes.filter(change => needsSubmissionSnapshot(proposal, change.taskId)).map(change => change.taskId);
  requireStorage(JSON.stringify(submissions.map(item => item.taskId)) === JSON.stringify(expectedTasks), '提交声明回执与方案不一致。');
  submissions.forEach(submission => requireStorage(materialListText(submission.materials) === materialListText(finalMaterials(proposal, submission.taskId, receipt.confirmedAt)), '提交时材料快照与确认方案不一致。'));
}
