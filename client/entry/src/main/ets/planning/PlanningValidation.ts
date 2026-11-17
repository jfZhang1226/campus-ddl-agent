import { BusinessSnapshot } from '../domain/StorageModels';
import { CommitProposal, CommitReceipt } from '../domain/CommitModels';
import { TaskDraft } from '../domain/TaskContracts';
import { timestampMillis } from '../domain/DateRules';
import { requireStorage, StorageFailure } from '../data/storage/StorageTypes';
import { PlanningChange, PlanningResult } from './PlanningContracts';
import { planningCollections, planningResult, planningTaskChanges, preparePlanningChange } from './PlanningRules';

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function exactKeys(value: Object, keys: string[]): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function fields(task: TaskDraft): string {
  return JSON.stringify([task.title, task.course, task.kind, task.deadlinePrecision, task.deadlineDate, task.dueAt,
    task.timezone, task.priority, task.status, task.remainingMinutes, task.submissionChannel, task.noticeIds]);
}
/** v4 freezes this intent/greedy-v1 recipe; future recipe changes require a new version and retained v4 validation. */
export function validatePlanningProposal(proposal: CommitProposal): void {
  const change = proposal.planning as PlanningChange;
  requireStorage(exactKeys(change, ['intent', 'tasksBefore', 'beforeAvailability', 'beforeBlocks', 'afterAvailability', 'afterBlocks', 'candidate']) &&
    Array.isArray(change.tasksBefore) && Array.isArray(change.beforeAvailability) && Array.isArray(change.beforeBlocks), '安排方案缺少完整旧值。');
  requireStorage(proposal.notices.length === 0 && (proposal.checklistItems || []).length === 0, '安排方案不创建通知或材料。');
  const before = new BusinessSnapshot(); before.revision = proposal.expectedRevision - 1;
  before.tasks = copy(change.tasksBefore); before.availabilityBlocks = copy(change.beforeAvailability); before.planBlocks = copy(change.beforeBlocks);
  try {
    const expected = preparePlanningChange(before, change.intent, proposal.createdAt);
    requireStorage(JSON.stringify(change.afterAvailability) === JSON.stringify(expected.afterAvailability) &&
      JSON.stringify(change.afterBlocks) === JSON.stringify(expected.afterBlocks) && JSON.stringify(change.candidate) === JSON.stringify(expected.candidate),
      '安排结果不符合明确意图与冻结规则。');
    const updates = planningTaskChanges(expected);
    requireStorage(updates.length === proposal.changes.length, '安排任务变化数量不一致。');
    updates.forEach((update, index) => {
      const actual = proposal.changes[index], task = change.tasksBefore.find(item => item.id === update.taskId);
      requireStorage(actual.action === 'update' && actual.taskId === update.taskId && actual.expectedVersion === update.expectedVersion &&
        JSON.stringify(actual.before) === JSON.stringify(task) && fields(actual.draft) === fields(update.draft), '完成安排仅可修改同一任务的明确剩余工时。');
    });
  } catch (error) { throw new StorageFailure('CORRUPT_DATA', '安排方案旧值、意图或结果不一致，原文件已保留。'); }
}
export function validatePlanningReceipt(receipt: CommitReceipt): void {
  const result = receipt.planning as PlanningResult;
  requireStorage(exactKeys(result, ['availability', 'blocks', 'unscheduled']) && Array.isArray(result.availability) &&
    Array.isArray(result.blocks) && Array.isArray(result.unscheduled), '安排回执集合无效。');
  try {
    const snapshot = new BusinessSnapshot(); snapshot.revision = receipt.committedRevision;
    snapshot.availabilityBlocks = result.availability; snapshot.planBlocks = result.blocks;
    planningCollections(snapshot, false); // Historical task binding is checked against its paired proposal.
    requireStorage(new Set(result.unscheduled.map(item => item.taskId)).size === result.unscheduled.length, '未安排任务ID重复。');
    result.unscheduled.forEach(item => requireStorage(exactKeys(item, ['taskId', 'minutes', 'reason']) && typeof item.taskId === 'string' && item.taskId.trim().length > 0 &&
      (item.minutes === null || Number.isSafeInteger(item.minutes) && item.minutes >= 0) &&
      ['remaining_effort_unknown', 'exact_deadline_required', 'deadline_passed', 'insufficient_capacity_before_deadline', 'resolve_retained_conflicts_first'].includes(item.reason), '未安排原因或分钟无效。'));
  } catch (error) { throw new StorageFailure('CORRUPT_DATA', '安排回执的日期、标识或关联无效，原文件已保留。'); }
}
export function validatePlanningPair(proposal: CommitProposal, receipt: CommitReceipt): void {
  requireStorage(JSON.stringify(receipt.planning) === JSON.stringify(planningResult(proposal.planning as PlanningChange)), '安排回执与确认方案不一致。');
}
export function assertPlanningBefore(snapshot: BusinessSnapshot, change: PlanningChange): void {
  if (JSON.stringify(snapshot.tasks) !== JSON.stringify(change.tasksBefore) || JSON.stringify(snapshot.availabilityBlocks) !== JSON.stringify(change.beforeAvailability) ||
    JSON.stringify(snapshot.planBlocks) !== JSON.stringify(change.beforeBlocks)) throw new StorageFailure('VERSION_CONFLICT', '任务或原安排已变化，请重读差异并重新确认。');
}
export function assertPlanningNotExpired(change: PlanningChange, now: string): void {
  if (change.intent.action !== 'replan') return;
  try {
    const before = new BusinessSnapshot(); before.revision = change.candidate?.revision as number;
    before.tasks = copy(change.tasksBefore); before.availabilityBlocks = copy(change.beforeAvailability); before.planBlocks = copy(change.beforeBlocks);
    const current = preparePlanningChange(before, change.intent, now);
    if (timestampMillis(change.intent.toAt as string) <= timestampMillis(now) ||
      JSON.stringify(current.candidate) !== JSON.stringify(change.candidate)) throw new Error('expired candidate');
  } catch (error) { throw new StorageFailure('PLAN_EXPIRED', '候选时刻或容量已随时间变化，请放弃后按当前时间重新生成并核对，不会自动移动安排。'); }
}
