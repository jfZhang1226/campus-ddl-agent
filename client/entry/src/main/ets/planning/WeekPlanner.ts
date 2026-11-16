import { Task } from '../domain/StorageModels';
import { validateTask, requireArgument } from '../domain/TaskValidation';
import { isOffsetTimestamp, timestampMillis } from '../domain/DateRules';
import { requireJsonValue } from '../data/storage/JsonValues';
import { sha256Hex } from '../data/storage/Sha256';

export interface AvailabilityBlock { id: string; startAt: string; endAt: string; }
export interface PlanBlock {
  id: string; taskId: string; startAt: string; endAt: string;
  state: string; locked: boolean; planRevision: number;
}
export interface WeekPlanInput {
  revision: number; fromAt: string; toAt: string; now: string;
  tasks: Task[]; availability: AvailabilityBlock[]; existing: PlanBlock[];
}
export class UnscheduledWork {
  constructor(public taskId: string, public minutes: number | null, public reason: string) {}
}
export class PlanConflict {
  constructor(public blockId: string, public taskId: string, public reason: string) {}
}
export class WeekPlanCandidate {
  revision: number = 0;
  retained: PlanBlock[] = [];
  generated: PlanBlock[] = [];
  replacedBlockIds: string[] = [];
  unscheduled: UnscheduledWork[] = [];
  conflicts: PlanConflict[] = [];
  knownDemandMinutes: number = 0;
  suppliedCapacityMinutes: number = 0;
  freeCapacityMinutes: number = 0;
  newlyAssignedMinutes: number = 0;
  retainedPendingMinutes: number = 0;
}
interface Interval { start: number; end: number; }
const MINUTE: number = 60000;
const TERMINAL: string[] = ['submitted', 'done', 'cancelled'];
function copy<T>(input: T): T { return JSON.parse(JSON.stringify(input)) as T; }
function interval(block: AvailabilityBlock | PlanBlock): Interval {
  requireArgument(block !== null && typeof block === 'object' && typeof block.id === 'string' && block.id.trim().length > 0 &&
    isOffsetTimestamp(block.startAt) && isOffsetTimestamp(block.endAt), '时间块标识或带偏移时刻无效。');
  const result: Interval = { start: timestampMillis(block.startAt), end: timestampMillis(block.endAt) };
  requireArgument(result.start < result.end && result.start % MINUTE === 0 && result.end % MINUTE === 0, '时间块须为正长度，起止对齐整分钟。');
  return result;
}
function union(input: Interval[]): Interval[] {
  const sorted = input.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const result: Interval[] = [];
  sorted.forEach(item => {
    const previous = result[result.length - 1];
    if (previous !== undefined && item.start <= previous.end) previous.end = Math.max(previous.end, item.end);
    else result.push({ start: item.start, end: item.end });
  });
  return result;
}
function subtract(input: Interval[], occupied: Interval): Interval[] {
  const result: Interval[] = [];
  input.forEach(item => {
    if (occupied.end <= item.start || occupied.start >= item.end) result.push(item);
    else {
      if (item.start < occupied.start) result.push({ start: item.start, end: occupied.start });
      if (occupied.end < item.end) result.push({ start: occupied.end, end: item.end });
    }
  });
  return result;
}
function minutes(input: Interval[]): number { return input.reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0); }
/** A read-only heuristic. It returns conflicts and gaps, never claims or commits a saved plan. */
export function buildWeekPlan(source: WeekPlanInput): WeekPlanCandidate {
  requireJsonValue(source);
  const input: WeekPlanInput = copy(source);
  requireArgument(input !== null && typeof input === 'object' && Number.isSafeInteger(input.revision) && input.revision >= 0 &&
    isOffsetTimestamp(input.fromAt) && isOffsetTimestamp(input.toAt) && isOffsetTimestamp(input.now) &&
    Array.isArray(input.tasks) && input.tasks.length <= 200 && Array.isArray(input.availability) && input.availability.length <= 200 &&
    Array.isArray(input.existing) && input.existing.length <= 1000, '七日安排输入无效或超过当前支持范围。');
  requireArgument(input.availability.every(block => block !== null && typeof block === 'object') &&
    input.existing.every(block => block !== null && typeof block === 'object'), '时间块必须为对象。');
  const start: number = Math.max(Math.ceil(timestampMillis(input.fromAt) / MINUTE), Math.ceil(timestampMillis(input.now) / MINUTE)) * MINUTE;
  const end: number = Math.floor(timestampMillis(input.toAt) / MINUTE) * MINUTE;
  requireArgument(timestampMillis(input.fromAt) < timestampMillis(input.toAt) &&
    timestampMillis(input.toAt) - timestampMillis(input.fromAt) <= 7 * 86400000 && start < end, '安排范围须为未来有效区间，最长七天。');
  input.tasks.forEach(task => validateTask(task));
  requireArgument(new Set(input.tasks.map(task => task.id)).size === input.tasks.length &&
    new Set(input.availability.map(block => block.id)).size === input.availability.length &&
    new Set(input.existing.map(block => block.id)).size === input.existing.length, '任务或时间块ID重复。');
  const available: Interval[] = union(input.availability.map(block => interval(block))
    .map(block => ({ start: Math.max(start, block.start), end: Math.min(end, block.end) })).filter(block => block.start < block.end));
  const allAvailable: Interval[] = union(input.availability.map(block => interval(block)));
  input.existing.forEach(block => {
    interval(block);
    requireArgument(input.tasks.some(task => task.id === block.taskId) && ['pending', 'done'].includes(block.state) && typeof block.locked === 'boolean' &&
      Number.isSafeInteger(block.planRevision) && block.planRevision >= 0 && block.planRevision <= input.revision, '既有安排的任务、状态或版本无效。');
  });
  const output: WeekPlanCandidate = new WeekPlanCandidate(); output.revision = input.revision;
  input.existing.forEach(block => {
    const time = interval(block);
    // Keep cross-boundary blocks whole; never drop work outside the user's replacement range.
    if (block.locked || block.state === 'done' || time.start < start || time.end > end) output.retained.push(block);
    else output.replacedBlockIds.push(block.id);
  });
  output.retained.sort((a, b) => timestampMillis(a.startAt) - timestampMillis(b.startAt) || a.id.localeCompare(b.id));
  output.replacedBlockIds.sort();
  let free: Interval[] = copy(available);
  output.retained.forEach((block, index) => {
    const time = interval(block), task = input.tasks.find(task => task.id === block.taskId) as Task;
    if (output.retained.slice(0, index).some(other => { const t = interval(other); return t.start < time.end && time.start < t.end; })) {
      output.conflicts.push(new PlanConflict(block.id, block.taskId, 'retained_blocks_overlap'));
    }
    if (block.state === 'pending' && time.end > start) {
      if (time.start < start) output.conflicts.push(new PlanConflict(block.id, block.taskId, 'retained_work_started_or_in_past'));
      if (TERMINAL.includes(task.status)) output.conflicts.push(new PlanConflict(block.id, block.taskId, 'retained_work_for_finished_task'));
      if (task.deadlinePrecision !== 'exact' || task.dueAt === null || time.end > timestampMillis(task.dueAt)) output.conflicts.push(new PlanConflict(block.id, block.taskId, 'retained_work_deadline_unverified'));
      const visibleStart: number = Math.max(start, time.start), visibleEnd: number = Math.min(end, time.end);
      if (visibleStart < visibleEnd && !allAvailable.some(item => item.start <= visibleStart && item.end >= visibleEnd)) output.conflicts.push(new PlanConflict(block.id, block.taskId, 'retained_work_outside_availability'));
      if (task.remainingMinutes === null) output.conflicts.push(new PlanConflict(block.id, block.taskId, 'remaining_effort_unknown'));
    }
    free = subtract(free, time);
  });
  output.suppliedCapacityMinutes = minutes(available); output.freeCapacityMinutes = minutes(free);
  const priority = (task: Task): number => task.priority === 'high' ? 0 : task.priority === 'low' ? 2 : 1;
  const active: Task[] = input.tasks.filter(task => !TERMINAL.includes(task.status)).sort((a, b) => {
    const due = (task: Task): number => task.dueAt === null ? Number.MAX_SAFE_INTEGER : timestampMillis(task.dueAt);
    return due(a) - due(b) || priority(a) - priority(b) || a.id.localeCompare(b.id);
  });
  active.forEach(task => {
    const reserved = output.retained.filter(block => block.taskId === task.id && block.state === 'pending' && timestampMillis(block.endAt) > start)
      .reduce((sum, block) => sum + (timestampMillis(block.endAt) - timestampMillis(block.startAt)) / MINUTE, 0);
    output.retainedPendingMinutes += reserved;
    if (task.remainingMinutes !== null) {
      output.knownDemandMinutes += task.remainingMinutes;
      if (reserved > task.remainingMinutes) output.conflicts.push(new PlanConflict('', task.id, 'retained_work_exceeds_remaining_effort'));
    }
  });
  active.forEach(task => {
    if (task.remainingMinutes === null) { output.unscheduled.push(new UnscheduledWork(task.id, null, 'remaining_effort_unknown')); return; }
    const reserved: number = output.retained.filter(block => block.taskId === task.id && block.state === 'pending' && timestampMillis(block.endAt) > start)
      .reduce((sum, block) => sum + (timestampMillis(block.endAt) - timestampMillis(block.startAt)) / MINUTE, 0);
    let remaining: number = Math.max(0, task.remainingMinutes - reserved);
    if (output.conflicts.length > 0) { output.unscheduled.push(new UnscheduledWork(task.id, remaining, 'resolve_retained_conflicts_first')); return; }
    if (remaining === 0) return;
    if (task.deadlinePrecision !== 'exact' || task.dueAt === null) { output.unscheduled.push(new UnscheduledWork(task.id, remaining, 'exact_deadline_required')); return; }
    const cutoff: number = Math.min(end, Math.floor(timestampMillis(task.dueAt) / MINUTE) * MINUTE);
    if (cutoff <= start) { output.unscheduled.push(new UnscheduledWork(task.id, remaining, 'deadline_passed')); return; }
    for (const slot of free.slice()) {
      let cursor: number = slot.start;
      const limit: number = Math.min(slot.end, cutoff);
      while (remaining > 0 && cursor < limit) {
        const count: number = Math.min(30, remaining, (limit - cursor) / MINUTE);
        const finish: number = cursor + count * MINUTE;
        const id: string = 'plan-' + sha256Hex(JSON.stringify([input.revision, task.id, task.version, cursor, finish])).slice(0, 32);
        requireArgument(!input.existing.some(block => block.id === id), '候选ID与既有安排冲突，请保留数据后重新核对。');
        output.generated.push({ id: id, taskId: task.id, startAt: new Date(cursor).toISOString(), endAt: new Date(finish).toISOString(), state: 'pending', locked: false, planRevision: input.revision });
        free = subtract(free, { start: cursor, end: finish });
        output.newlyAssignedMinutes += count; remaining -= count; cursor = finish;
      }
      if (remaining === 0) break;
    }
    if (remaining > 0) output.unscheduled.push(new UnscheduledWork(task.id, remaining, 'insufficient_capacity_before_deadline'));
  });
  return output;
}
