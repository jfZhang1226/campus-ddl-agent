import { common } from '@kit.AbilityKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { BusinessError } from '@kit.BasicServicesKit';
import deviceInfo from '@ohos.deviceInfo';
import { ReminderPlan, ReminderPort, ReminderRegistration } from '../reminders/ReminderPlan';
import { StorageFailure } from '../data/storage/StorageTypes';
import { timestampMillis } from '../domain/DateRules';

/** Native API26 bridge only; no audio playback and no immediate test notification. */
export class HarmonyReminderPort implements ReminderPort {
  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) { this.context = context; }
  supported(): boolean { return deviceInfo.osFullName.startsWith('OpenHarmony') && deviceInfo.sdkApiVersion >= 26; }
  private failure(error: BusinessError, operation: string): StorageFailure {
    const code: string = Number.isSafeInteger(error.code) ? String(error.code) : 'NATIVE_EXCEPTION';
    return new StorageFailure('REMINDER_' + operation + '_' + code, '系统提醒操作未完成，请核对通知权限或重新读取。');
  }
  async permission(): Promise<boolean> {
    if (!this.supported()) return false;
    try { return await notificationManager.isNotificationEnabled(); }
    catch (error) { throw this.failure(error as BusinessError, 'PERMISSION'); }
  }
  async requestPermission(): Promise<boolean> {
    if (!this.supported()) return false;
    try { await notificationManager.requestEnableNotification(this.context); return await this.permission(); }
    catch (error) { throw this.failure(error as BusinessError, 'REQUEST_PERMISSION'); }
  }
  async list(): Promise<ReminderRegistration[]> {
    if (!this.supported()) throw new StorageFailure('UNSUPPORTED_PLATFORM', '此入口需API26鸿蒙设备。');
    try {
      const infos = await reminderAgentManager.getAllValidReminders();
      return infos.filter(info => /^campusddl1-[a-f0-9]{32}$/.test(info.reminderReq.groupId || ''))
        .map(info => new ReminderRegistration(info.reminderId, info.reminderReq.groupId || ''));
    } catch (error) { throw this.failure(error as BusinessError, 'LIST'); }
  }
  async publish(plan: ReminderPlan): Promise<number> {
    if (!this.supported()) throw new StorageFailure('UNSUPPORTED_PLATFORM', '此入口需API26鸿蒙设备。');
    const when: number = timestampMillis(plan.fireAt);
    if (!Number.isFinite(when) || when < Date.now() + 60000 || !/^campusddl1-[a-f0-9]{32}$/.test(plan.key) ||
      plan.title.length < 1 || plan.title.length > 80 || plan.content.length < 1 || plan.content.length > 200) {
      throw new StorageFailure('INVALID_ARGUMENT', '提醒计划无效或距离触发不足一分钟。');
    }
    const date = new Date(when);
    const notificationId: number = Number.parseInt(plan.key.slice(-7), 16);
    let operation: string = 'PUBLISH_CHECK';
    try {
      const existing = await reminderAgentManager.getAllValidReminders();
      if (existing.some(info => info.reminderReq.notificationId === notificationId && info.reminderReq.groupId !== plan.key)) {
        throw new StorageFailure('REMINDER_ID_COLLISION', '系统提醒编号冲突，本次未覆盖已有提醒。');
      }
      operation = 'BUILD_REQUEST';
      const request: reminderAgentManager.ReminderRequestCalendar = {
        reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
        dateTime: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
          hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() },
        fixedTimeZone: reminderAgentManager.TimeZoneType.FIXED_TIME_ZONE,
        title: plan.title, content: plan.content, expiredContent: '提醒时间已过，请查看任务实际截止。',
        groupId: plan.key, notificationId: notificationId, slotType: notificationManager.SlotType.CONTENT_INFORMATION,
        ringDuration: 0, snoozeTimes: 0, tapDismissed: true,
        wantAgent: { pkgName: this.context.abilityInfo.bundleName, abilityName: 'EntryAbility' }
      };
      // 0 uses the system notification tone; this is not a promise of silent delivery.
      operation = 'PUBLISH';
      return await reminderAgentManager.publishReminder(request);
    } catch (error) {
      if (error instanceof StorageFailure) throw error;
      throw this.failure(error as BusinessError, operation);
    }
  }
  async cancel(id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 0) throw new StorageFailure('INVALID_ARGUMENT', '提醒编号无效。');
    const ours = await this.list();
    if (!ours.some(record => record.id === id)) return; // Never cancel an unrelated feature's reminder.
    try { await reminderAgentManager.cancelReminder(id); }
    catch (error) { throw this.failure(error as BusinessError, 'CANCEL'); }
  }
}
