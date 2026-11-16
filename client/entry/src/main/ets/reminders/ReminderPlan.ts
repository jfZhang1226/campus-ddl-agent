import { Task } from '../domain/StorageModels';
import { timestampMillis } from '../domain/DateRules';
import { validateTask } from '../domain/TaskValidation';
import { sha256Hex } from '../data/storage/Sha256';
import { StorageFailure } from '../data/storage/StorageTypes';

export class ReminderPlan {
  constructor(public taskId: string, public taskVersion: number, public deadlineAt: string,
    public fireAt: string, public leadMinutes: number, public key: string, public title: string, public content: string) {}
}
export class ReminderRegistration {
  constructor(public id: number, public key: string) {}
}
/** Only native owners supply OS registration; the shared core never plays sounds. */
export interface ReminderPort {
  supported(): boolean;
  permission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  list(): Promise<ReminderRegistration[]>;
  publish(plan: ReminderPlan): Promise<number>;
  cancel(id: number): Promise<void>;
}
export class UnavailableReminderPort implements ReminderPort {
  supported(): boolean { return false; }
  async permission(): Promise<boolean> { return false; }
  async requestPermission(): Promise<boolean> { return false; }
  async list(): Promise<ReminderRegistration[]> { return []; }
  async publish(_plan: ReminderPlan): Promise<number> { throw new StorageFailure('UNSUPPORTED_PLATFORM', '当前入口尚不支持系统提醒。'); }
  async cancel(_id: number): Promise<void> { throw new StorageFailure('UNSUPPORTED_PLATFORM', '当前入口尚不支持系统提醒。'); }
}
function excerpt(value: string, limit: number): string {
  let result: string = value.slice(0, limit);
  const last: number = result.charCodeAt(result.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) result = result.slice(0, -1);
  return result;
}
/** A reminder time is derived from an exact, confirmed task deadline; it never edits that deadline. */
export function deadlineReminderPlan(task: Task, leadMinutes: number, now: string): ReminderPlan {
  validateTask(task);
  if (['submitted', 'done', 'cancelled'].includes(task.status)) {
    throw new StorageFailure('TASK_FINISHED', '已提交、已完成或已取消的任务不再设置到期提醒。');
  }
  if (task.deadlinePrecision !== 'exact' || task.dueAt === null) {
    throw new StorageFailure('EXACT_DEADLINE_REQUIRED', '缺少确切截止时刻，请先核对截止时间；不会擅自补成23:59。');
  }
  if (!Number.isSafeInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 10080) {
    throw new StorageFailure('INVALID_ARGUMENT', '提醒提前量须为1至10080分钟的整数。');
  }
  const current: number = timestampMillis(now);
  const fireMillis: number = timestampMillis(task.dueAt) - leadMinutes * 60000;
  if (!Number.isFinite(current)) throw new StorageFailure('INVALID_ARGUMENT', '当前时钟无效，请校正设备时间。');
  if (!Number.isFinite(fireMillis) || fireMillis < current + 60000) {
    throw new StorageFailure('REMINDER_TIME_PASSED', '所选提醒时间已过或不足一分钟，请核对截止及提前量。');
  }
  const fireAt: string = new Date(fireMillis).toISOString();
  const key: string = 'campusddl1-' + sha256Hex(JSON.stringify([task.id, task.version, task.dueAt, leadMinutes])).slice(0, 32);
  return new ReminderPlan(task.id, task.version, task.dueAt, fireAt, leadMinutes, key,
    excerpt(task.title, 80), '任务将在约' + String(leadMinutes) + '分钟后截止，请核对材料与提交渠道。');
}
