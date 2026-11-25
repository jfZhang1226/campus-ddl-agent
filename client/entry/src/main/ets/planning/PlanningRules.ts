import { BusinessSnapshot, Task } from '../domain/StorageModels';
import { TaskDraft } from '../domain/TaskContracts';
import { TaskChangeDraft } from '../domain/CommitModels';
import { isOffsetTimestamp, timestampMillis } from '../domain/DateRules';
import { requireArgument, validateTask } from '../domain/TaskValidation';
import { requireJsonValue } from '../data/storage/JsonValues';
import { sha256Hex } from '../data/storage/Sha256';
import { StorageFailure } from '../data/storage/StorageTypes';
import { AvailabilityBlock, PlanBlock, WeekPlanCandidate, buildWeekPlan } from './WeekPlanner';
import { AvailabilityDraft, PlanningChange, PlanningIntent, PlanningResult } from './PlanningContracts';

function copy<T>(input: T): T { return JSON.parse(JSON.stringify(input)) as T; }
function object(value: Object): boolean { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: string | null): boolean { return typeof value === 'string' && value.trim().length > 0; }
function exactKeys(value: Object, keys: string[]): boolean {
  return object(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function span(value: AvailabilityDraft): void {
  requireArgument(isOffsetTimestamp(value.startAt) && isOffsetTimestamp(value.endAt) && timestampMillis(value.startAt) < timestampMillis(value.endAt) &&
    timestampMillis(value.startAt) % 60000 === 0 && timestampMillis(value.endAt) % 60000 === 0, '可用时间须为带偏移、对齐分钟的正长度区间。');
}
export function validatePlanningIntent(intent: PlanningIntent): void {
  requireJsonValue(intent);
  requireArgument(exactKeys(intent, Object.keys(new PlanningIntent())) && ['availability', 'replan', 'lock', 'done'].includes(intent.action), '安排意图字段缺失或包含不支持的动作。');
  const noRange: boolean = intent.fromAt === null && intent.toAt === null;
  if (intent.action === 'availability') {
    requireArgument(Array.isArray(intent.availability) && intent.availability.length <= 200 && noRange && intent.blockId === null && intent.locked === null && intent.remainingMinutes === null,
      '可用时间设置只接受区间，不接受任务或计划块修改。');
    const ranges = intent.availability as AvailabilityDraft[];
    ranges.forEach(range => { requireArgument(exactKeys(range, ['startAt', 'endAt']), '新可用区间不接受外部ID或额外字段。'); span(range); });
    const keys = ranges.map(range => String(timestampMillis(range.startAt)) + ':' + String(timestampMillis(range.endAt)));
    requireArgument(new Set(keys).size === keys.length, '可用时间包含重复区间，请先核对。');
  } else if (intent.action === 'replan') {
    requireArgument(intent.availability === null && intent.blockId === null && intent.locked === null && intent.remainingMinutes === null &&
      isOffsetTimestamp(intent.fromAt as string) && isOffsetTimestamp(intent.toAt as string) &&
      timestampMillis(intent.toAt as string) > timestampMillis(intent.fromAt as string) &&
      timestampMillis(intent.toAt as string) - timestampMillis(intent.fromAt as string) <= 7 * 86400000, '重排范围须明确且不超过七天，不接受任意候选块。');
  } else {
    requireArgument(intent.availability === null && noRange && text(intent.blockId), '安排块操作需要真实块ID，不接受替换时间或可用区间。');
    if (intent.action === 'lock') requireArgument(typeof intent.locked === 'boolean' && intent.remainingMinutes === null, '锁定操作需要明确开关，不更改工时。');
    else requireArgument(intent.locked === null && Number.isSafeInteger(intent.remainingMinutes) && (intent.remainingMinutes as number) >= 0,
      '完成时间块时须明确提供当前剩余分钟，不能按计划时长自动扣减。');
  }
}
/** Older opaque reserved objects remain readable elsewhere; planning refuses to interpret/drop them. */
export function planningCollections(snapshot: BusinessSnapshot, verifyTaskReferences: boolean = true): void {
  if (!Array.isArray(snapshot.availabilityBlocks) || !Array.isArray(snapshot.planBlocks) || snapshot.availabilityBlocks.length > 200 || snapshot.planBlocks.length > 1000) {
    throw new StorageFailure('UNSUPPORTED_SCHEMA', '已有时间集合超出当前安排接口支持范围，原数据已保留。');
  }
  if (snapshot.availabilityBlocks.some(row => !exactKeys(row, ['id', 'startAt', 'endAt'])) ||
    snapshot.planBlocks.some(row => !exactKeys(row, ['id', 'taskId', 'startAt', 'endAt', 'state', 'locked', 'planRevision']))) {
    throw new StorageFailure('UNSUPPORTED_SCHEMA', '已有保留集合包含暂不支持的对象，请先核对，不能猜测或覆盖。');
  }
  const available = snapshot.availabilityBlocks as AvailabilityBlock[], blocks = snapshot.planBlocks as PlanBlock[];
  try {
    available.forEach(row => { requireArgument(text(row.id), '可用区间标识无效。'); span(row); });
    blocks.forEach(row => {
      span(row);
      requireArgument(text(row.id) && text(row.taskId) && (!verifyTaskReferences || snapshot.tasks.some(task => task.id === row.taskId)) && ['pending', 'done'].includes(row.state) && typeof row.locked === 'boolean' &&
        Number.isSafeInteger(row.planRevision) && row.planRevision >= 0 && row.planRevision <= snapshot.revision, '已有安排引用、状态或版本无效。');
    });
    requireArgument(new Set(available.map(row => row.id)).size === available.length && new Set(blocks.map(row => row.id)).size === blocks.length, '时间集合ID重复。');
  } catch (error) { throw new StorageFailure('CORRUPT_DATA', '已使用的时间集合包含无效日期或关联，原数据已保留。'); }
}
export function preparePlanningChange(source: BusinessSnapshot, intentSource: PlanningIntent, createdAt: string): PlanningChange {
  requireJsonValue(source); validatePlanningIntent(intentSource);
  requireArgument(source !== null && typeof source === 'object' && Array.isArray(source.tasks), '安排快照需要实际任务集合。');
  requireArgument(Number.isSafeInteger(source.revision) && source.revision >= 0 && Number.isSafeInteger(source.revision + 2) &&
    isOffsetTimestamp(createdAt) && source.tasks.length <= 200, '安排版本、时钟无效或任务超过当前200项支持范围。');
  source.tasks.forEach(task => { validateTask(task); requireArgument(timestampMillis(task.updatedAt) <= timestampMillis(createdAt), '当前时钟早于已有任务修改，请校正后再安排。'); }); planningCollections(source);
  const intent = copy(intentSource), beforeAvailability = copy(source.availabilityBlocks as AvailabilityBlock[]), beforeBlocks = copy(source.planBlocks as PlanBlock[]);
  const result: PlanningChange = { intent: intent, tasksBefore: copy(source.tasks), beforeAvailability: beforeAvailability,
    beforeBlocks: beforeBlocks, afterAvailability: copy(beforeAvailability), afterBlocks: copy(beforeBlocks), candidate: null };
  if (intent.action === 'availability') {
    result.afterAvailability = (intent.availability as AvailabilityDraft[]).map((row: AvailabilityDraft): AvailabilityBlock => {
      const start = timestampMillis(row.startAt), end = timestampMillis(row.endAt);
      const old = beforeAvailability.find(item => timestampMillis(item.startAt) === start && timestampMillis(item.endAt) === end);
      if (old !== undefined) return copy(old);
      const id: string = 'availability-' + sha256Hex(JSON.stringify([source.revision, start, end])).slice(0, 32);
      requireArgument(!beforeAvailability.some(item => item.id === id), '新区间标识与不同旧区间冲突，请保留数据并核对。');
      return { id: id, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
    });
    requireArgument(new Set(result.afterAvailability.map(row => row.id)).size === result.afterAvailability.length, '新可用区间标识冲突，请重新核对。');
  } else if (intent.action === 'replan') {
    const candidate: WeekPlanCandidate = buildWeekPlan({ revision: source.revision, fromAt: intent.fromAt as string, toAt: intent.toAt as string,
      now: createdAt, tasks: copy(source.tasks), availability: beforeAvailability, existing: beforeBlocks });
    requireArgument(candidate.conflicts.length === 0, '已有锁定/完成块存在冲突，请先核对其时间、剩余工时和可用区间，不能用新计划掩盖。');
    candidate.generated.forEach(block => { block.planRevision = source.revision + 2; });
    result.candidate = candidate;
    result.afterBlocks = copy(candidate.retained.concat(candidate.generated));
  } else {
    const block = result.afterBlocks.find(item => item.id === intent.blockId);
    if (block === undefined) throw new StorageFailure('NOT_FOUND', '安排块不存在，请读取实际安排。');
    requireArgument(block.state === 'pending', '已完成安排保持历史，不能重新打开或修改锁定状态。');
    const changed: boolean = intent.action === 'done' || block.locked !== intent.locked;
    if (intent.action === 'lock') block.locked = intent.locked as boolean;
    else {
      const task = source.tasks.find(item => item.id === block.taskId) as Task;
      requireArgument(!['submitted', 'done', 'cancelled'].includes(task.status), '该任务已进入终态，不能用完成时间块改写其工时历史。');
      block.state = 'done';
    }
    if (changed) block.planRevision = source.revision + 2;
  }
  const after = copy(source); after.revision = source.revision + 2; after.availabilityBlocks = result.afterAvailability; after.planBlocks = result.afterBlocks;
  planningCollections(after); return result;
}
export function planningTaskChanges(change: PlanningChange): TaskChangeDraft[] {
  if (change.intent.action !== 'done') return [];
  const block = change.beforeBlocks.find(item => item.id === change.intent.blockId) as PlanBlock;
  const task = change.tasksBefore.find(item => item.id === block.taskId) as Task;
  const draft = new TaskDraft();
  draft.title = task.title; draft.course = task.course; draft.kind = task.kind; draft.deadlinePrecision = task.deadlinePrecision;
  draft.deadlineDate = task.deadlineDate; draft.dueAt = task.dueAt; draft.timezone = task.timezone; draft.priority = task.priority;
  draft.status = task.status; draft.remainingMinutes = change.intent.remainingMinutes; draft.submissionChannel = task.submissionChannel; draft.noticeIds = task.noticeIds.slice();
  return [{ action: 'update', taskId: task.id, expectedVersion: task.version, draft: draft, checklistCreates: [] }];
}
export function planningResult(change: PlanningChange): PlanningResult {
  return { availability: copy(change.afterAvailability), blocks: copy(change.afterBlocks), unscheduled: copy(change.candidate?.unscheduled || []) };
}
