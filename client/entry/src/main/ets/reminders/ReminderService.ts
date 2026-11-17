import { TaskReadPort } from '../tasks/TaskBoardController';
import { StorageFailure, StorageResult } from '../data/storage/StorageTypes';
import { ReminderPlan, ReminderPort, ReminderRegistration, deadlineReminderPlan } from './ReminderPlan';
import { ReminderSetting, ReminderSettingsDocument, ReminderSettingsPort } from './ReminderSettings';
import { timestampMillis } from '../domain/DateRules';

function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) throw new StorageFailure(result.errorCode || 'STORAGE_FAILED', result.message || '提醒操作未完成。');
  return result.data;
}
function copy<T>(input: T): T { return JSON.parse(JSON.stringify(input)) as T; }
export class ReminderService {
  private tail: Promise<void> = Promise.resolve();
  constructor(private tasks: TaskReadPort, private settings: ReminderSettingsPort,
    private port: ReminderPort, private now: () => string = () => new Date().toISOString()) {}
  supported(): boolean { return this.port.supported(); }
  permissionAction(): string { return this.port.permissionAction?.() || '允许本应用通知'; }
  permissionNotice(): string { return this.port.permissionNotice?.() || '通知提示音由系统设置控制；本页不会播放测试声音。'; }
  permission(): Promise<boolean> { return this.port.permission(); }
  requestPermission(): Promise<boolean> { return this.port.requestPermission(); }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.tail.then(work);
    this.tail = result.then(() => {}, () => {}); return result;
  }
  private async save(document: ReminderSettingsDocument, entry: ReminderSetting): Promise<ReminderSettingsDocument> {
    entry.updatedAt = this.now();
    const index: number = document.entries.findIndex(item => item.taskId === entry.taskId);
    if (index < 0) document.entries.push(entry); else document.entries[index] = entry;
    return value(await this.settings.save(document, document.revision));
  }
  private keys(entry: ReminderSetting): string[] {
    return entry.retiredKeys.concat(entry.plan === null ? [] : [entry.plan.key]);
  }
  private matches(record: ReminderRegistration, plan: ReminderPlan): boolean {
    return record.key === plan.key && record.enabled !== false &&
      (record.fireAt === undefined || timestampMillis(record.fireAt) === timestampMillis(plan.fireAt)) &&
      (record.deadlineAt === undefined || timestampMillis(record.deadlineAt) === timestampMillis(plan.deadlineAt));
  }
  private async cleanup(keys: string[], keep: string = ''): Promise<void> {
    const records: ReminderRegistration[] = await this.port.list();
    for (const record of records) if (record.key !== keep && keys.includes(record.key)) await this.port.cancel(record.id);
    const remaining: ReminderRegistration[] = await this.port.list();
    if (remaining.some(item => item.key !== keep && keys.includes(item.key))) {
      throw new StorageFailure('REMINDER_CANCEL_PENDING', '旧提醒尚未清理，请重新核对提醒状态。');
    }
  }
  /** Explicit screen action. No model tool receives this capability. */
  enable(taskId: string, expectedVersion: number, leadMinutes: number): Promise<ReminderSetting> {
    return this.serial(async () => {
      if (!this.supported()) throw new StorageFailure('UNSUPPORTED_PLATFORM', '当前入口不支持系统提醒。');
      if (!await this.port.permission()) throw new StorageFailure('NOTIFICATION_PERMISSION_REQUIRED', '请先允许提醒所需权限，再明确启用提醒。');
      const detail = value(await this.tasks.get(taskId));
      if (detail.task.version !== expectedVersion) throw new StorageFailure('VERSION_CONFLICT', '任务已变化，请重新读取后设置提醒。');
      const plan = deadlineReminderPlan(detail.task, leadMinutes, this.now());
      let document = value(await this.settings.read());
      const existing = document.entries.find(entry => entry.taskId === taskId);
      if (existing === undefined && document.entries.length >= 200) throw new StorageFailure('REMINDER_LIMIT', '本机提醒设置已达上限，请先清理旧设置。');
      if (!existing?.enabled && document.entries.filter(entry => entry.enabled).length >= 20) throw new StorageFailure('REMINDER_LIMIT', '本应用最多同时启用20条提醒，请先关闭部分提醒。');
      const entry: ReminderSetting = existing === undefined ? new ReminderSetting() : copy(existing);
      entry.taskId = taskId;
      if (entry.plan !== null && entry.plan.key !== plan.key && !entry.retiredKeys.includes(entry.plan.key)) entry.retiredKeys.push(entry.plan.key);
      if (entry.retiredKeys.length > 16) throw new StorageFailure('REMINDER_CANCEL_PENDING', '旧提醒积累较多，请先关闭并清理后再启用。');
      entry.enabled = true; entry.leadMinutes = leadMinutes; entry.plan = plan; entry.phase = 'pending';
      document = await this.save(document, entry); // Durable intent before OS side effects.
      return this.register(document, copy(entry), plan);
    });
  }
  private async register(document: ReminderSettingsDocument, entry: ReminderSetting, plan: ReminderPlan): Promise<ReminderSetting> {
    await this.cleanup(entry.retiredKeys, plan.key);
    let records = (await this.port.list()).filter(record => record.key === plan.key);
    if (records.some(record => !this.matches(record, plan))) throw new StorageFailure('REMINDER_EXTERNALLY_CHANGED', '系统中的提醒时间、提前量或开关已变化；请先核对或明确取消，不会自动覆盖。');
    if (records.length === 0) {
      const id = await this.port.publish(plan);
      if (!Number.isSafeInteger(id) || id < 0) throw new StorageFailure('REMINDER_UNCERTAIN', '系统未返回有效提醒编号，请重新读取。');
      records = (await this.port.list()).filter(record => record.key === plan.key);
      if (!records.some(record => record.id === id && this.matches(record, plan))) throw new StorageFailure('REMINDER_UNCERTAIN', '提醒登记时刻或编号未读到，请重新读取，勿重复启用。');
    }
    for (const duplicate of records.slice(1)) await this.port.cancel(duplicate.id);
    const actual = (await this.port.list()).filter(record => record.key === plan.key);
    if (actual.length !== 1 || !this.matches(actual[0], plan)) throw new StorageFailure('REMINDER_UNCERTAIN', '提醒登记数量或时刻不一致，请重新读取。');
    const result = await this.tasks.get(entry.taskId);
    if (!result.success && result.errorCode === 'NOT_FOUND') {
      await this.cleanup([plan.key]); entry.enabled = false; entry.phase = 'disabled'; entry.plan = null; entry.retiredKeys = [];
      await this.save(document, entry);
      throw new StorageFailure('VERSION_CONFLICT', '登记期间任务已删除，本次提醒已撤销。');
    }
    const detail = value(result);
    if (detail.task.version !== plan.taskVersion || detail.task.dueAt !== plan.deadlineAt || ['submitted', 'done', 'cancelled'].includes(detail.task.status)) {
      await this.cleanup([plan.key]);
      entry.phase = 'needs_attention'; await this.save(document, entry);
      throw new StorageFailure('VERSION_CONFLICT', '登记期间任务已变化，已撤销本次提醒；请重新读取。');
    }
    entry.phase = 'registered'; entry.retiredKeys = [];
    await this.save(document, entry); // Failure leaves pending intent; recovery locates the same OS key.
    return copy(entry);
  }
  disable(taskId: string): Promise<ReminderSetting> {
    return this.serial(async () => {
      let document = value(await this.settings.read());
      const original = document.entries.find(entry => entry.taskId === taskId);
      if (original === undefined) throw new StorageFailure('NOT_FOUND', '此任务尚未设置提醒。');
      const entry = copy(original); entry.enabled = false; entry.phase = 'cancel_pending';
      document = await this.save(document, entry); // Keep cancellation intent if OS or final persistence fails.
      await this.cleanup(this.keys(entry));
      entry.phase = 'disabled'; entry.plan = null; entry.retiredKeys = [];
      await this.save(document, entry); return copy(entry);
    });
  }
  /** Reconcile existing intent after restart or task save; never enables a task by itself. */
  reconcile(): Promise<ReminderSetting[]> {
    return this.serial(async () => {
      if (!this.supported()) return [];
      let document = value(await this.settings.read());
      if (document.entries.length === 0) return [];
      const allowed: boolean = await this.port.permission();
      for (const original of document.entries.slice()) {
        let entry = copy(original);
        if (!entry.enabled) {
          if (entry.phase !== 'disabled') {
            await this.cleanup(this.keys(entry)); entry.phase = 'disabled'; entry.plan = null; entry.retiredKeys = [];
            document = await this.save(document, entry);
          }
          continue;
        }
        const registered = await this.port.list();
        if (entry.phase === 'registered' && entry.plan !== null && !registered.some(record => record.key === entry.plan?.key)) {
          // A system-side deletion/expiry is not permission to resurrect a reminder on app launch.
          await this.cleanup(entry.retiredKeys); entry.enabled = false; entry.phase = 'disabled'; entry.plan = null; entry.retiredKeys = [];
          document = await this.save(document, entry); continue;
        }
        if (entry.plan !== null && registered.some(record => record.key === entry.plan?.key && !this.matches(record, entry.plan as ReminderPlan))) {
          if (entry.phase !== 'needs_attention') { entry.phase = 'needs_attention'; document = await this.save(document, entry); }
          continue; // User calendar edits/disabled account never silently turn back on.
        }
        const detailResult = await this.tasks.get(entry.taskId);
        if (!detailResult.success && detailResult.errorCode !== 'NOT_FOUND') {
          throw new StorageFailure(detailResult.errorCode || 'STORAGE_FAILED', detailResult.message);
        }
        const task = detailResult.data?.task;
        let plan: ReminderPlan | null = null;
        if (task !== undefined) {
          try { plan = deadlineReminderPlan(task, entry.leadMinutes, this.now()); }
          catch (error) {
            if (!(error instanceof StorageFailure) || !['TASK_FINISHED', 'EXACT_DEADLINE_REQUIRED', 'REMINDER_TIME_PASSED'].includes(error.code)) throw error;
          }
        }
        if (plan === null || !allowed) {
          await this.cleanup(this.keys(entry));
          entry.enabled = task !== undefined && !['submitted', 'done', 'cancelled'].includes(task.status);
          entry.phase = entry.enabled ? 'needs_attention' : 'disabled'; entry.plan = null; entry.retiredKeys = [];
          document = await this.save(document, entry); continue;
        }
        const wantedKey: string = plan.key;
        if (entry.phase === 'registered' && entry.plan?.key === wantedKey && entry.retiredKeys.length === 0 &&
          registered.filter(record => record.key === wantedKey).length === 1) continue;
        if (entry.plan !== null && entry.plan.key !== plan.key && !entry.retiredKeys.includes(entry.plan.key)) entry.retiredKeys.push(entry.plan.key);
        if (entry.retiredKeys.length > 16) throw new StorageFailure('REMINDER_CANCEL_PENDING', '请先关闭并清理旧提醒。');
        entry.plan = plan; entry.phase = 'pending'; document = await this.save(document, entry);
        await this.register(document, entry, plan);
        document = value(await this.settings.read());
      }
      return copy(document.entries);
    });
  }
  async readSettings(): Promise<ReminderSetting[]> { return copy(value(await this.settings.read()).entries); }
}
