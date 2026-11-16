import { ReminderPlan } from './ReminderPlan';
import { StorageCoordinator } from '../data/storage/StorageCoordinator';
import { JsonSnapshotFile } from '../data/storage/JsonSnapshotFile';
import { SnapshotCodec, StorageResult, StorageFailure, checkHeader, requireStorage, isStorageId } from '../data/storage/StorageTypes';
import { isOffsetTimestamp, timestampMillis } from '../domain/DateRules';
import { sha256Hex } from '../data/storage/Sha256';
import { requireJsonValue } from '../data/storage/JsonValues';

export class ReminderSetting {
  taskId: string = '';
  enabled: boolean = false;
  leadMinutes: number = 60;
  phase: string = 'disabled';
  plan: ReminderPlan | null = null;
  retiredKeys: string[] = [];
  updatedAt: string = '';
}
export class ReminderSettingsDocument {
  schemaVersion: number = 1;
  revision: number = 0;
  entries: ReminderSetting[] = [];
}
export interface ReminderSettingsPort {
  read(): Promise<StorageResult<ReminderSettingsDocument>>;
  save(candidate: ReminderSettingsDocument, revision: number): Promise<StorageResult<ReminderSettingsDocument>>;
}
class ReminderSettingsCodec implements SnapshotCodec<ReminderSettingsDocument> {
  empty(): ReminderSettingsDocument { return new ReminderSettingsDocument(); }
  decode(text: string): ReminderSettingsDocument {
    let value: ReminderSettingsDocument;
    try { value = JSON.parse(text) as ReminderSettingsDocument; }
    catch (_) { throw new StorageFailure('CORRUPT_DATA', '提醒设置不是有效JSON，原文件已保留。'); }
    checkHeader(value);
    requireStorage(Array.isArray(value.entries) && value.entries.length <= 200, '提醒设置集合无效。');
    const ids: string[] = [];
    value.entries.forEach(entry => {
      requireStorage(entry !== null && typeof entry === 'object' && isStorageId(entry.taskId) && !ids.includes(entry.taskId), '提醒任务ID重复或无效。'); ids.push(entry.taskId);
      requireStorage(typeof entry.enabled === 'boolean' && Number.isSafeInteger(entry.leadMinutes) && entry.leadMinutes >= 1 && entry.leadMinutes <= 10080 &&
        ['disabled', 'pending', 'registered', 'cancel_pending', 'needs_attention'].includes(entry.phase) && isOffsetTimestamp(entry.updatedAt), '提醒设置字段无效。');
      requireStorage(Array.isArray(entry.retiredKeys) && entry.retiredKeys.length <= 16 && new Set(entry.retiredKeys).size === entry.retiredKeys.length &&
        entry.retiredKeys.every(key => /^campusddl1-[a-f0-9]{32}$/.test(key)), '待清理提醒标识无效。');
      if (entry.plan !== null) {
        const plan = entry.plan;
        requireStorage(plan !== undefined && plan.taskId === entry.taskId && Number.isSafeInteger(plan.taskVersion) && plan.taskVersion > 0 &&
          isOffsetTimestamp(plan.deadlineAt) && isOffsetTimestamp(plan.fireAt) && plan.leadMinutes === entry.leadMinutes &&
          /^campusddl1-[a-f0-9]{32}$/.test(plan.key) && typeof plan.title === 'string' && plan.title.length > 0 && plan.title.length <= 80 &&
          typeof plan.content === 'string' && plan.content.length > 0 && plan.content.length <= 200, '提醒计划无效。');
        requireStorage(plan.key === 'campusddl1-' + sha256Hex(JSON.stringify([plan.taskId, plan.taskVersion, plan.deadlineAt, plan.leadMinutes])).slice(0, 32) &&
          timestampMillis(plan.deadlineAt) - timestampMillis(plan.fireAt) === plan.leadMinutes * 60000, '提醒时间或稳定标识不一致。');
      }
      requireStorage(entry.phase !== 'registered' || entry.enabled && entry.plan !== null, '已登记状态缺少有效计划。');
    });
    return value;
  }
}
/** Preferences and OS reconciliation journal only; tasks stay in the original business snapshot. */
export class ReminderSettingsRepository implements ReminderSettingsPort {
  private snapshot: JsonSnapshotFile<ReminderSettingsDocument>;
  constructor(coordinator: StorageCoordinator) {
    this.snapshot = new JsonSnapshotFile(coordinator, new ReminderSettingsCodec(), 'reminder-settings');
  }
  read(): Promise<StorageResult<ReminderSettingsDocument>> { return this.snapshot.read(); }
  save(candidate: ReminderSettingsDocument, revision: number): Promise<StorageResult<ReminderSettingsDocument>> {
    try { requireJsonValue(candidate); return this.snapshot.save(candidate, revision); }
    catch (_) { return Promise.resolve(new StorageResult<ReminderSettingsDocument>(false, null, 'INVALID_ARGUMENT', '提醒设置必须是完整有限的JSON。')); }
  }
  recoverBackup(): Promise<StorageResult<ReminderSettingsDocument>> { return this.snapshot.recoverBackup(); }
}
