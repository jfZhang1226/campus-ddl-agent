import { ReminderPlan, ReminderPort, ReminderRegistration } from './ReminderPlan';
import { timestampMillis } from '../domain/DateRules';
import { StorageFailure } from '../data/storage/StorageTypes';

export interface CalendarReminderEvent {
  id: number; key: string; startTime: number; endTime: number; reminderMinutes: number[]; allDay: boolean;
}
export interface CalendarReminderInsert {
  key: string; title: string; description: string; startTime: number; endTime: number; leadMinutes: number;
}
/** Every handle is for this application's explicitly named LOCAL calendar, never the default calendar. */
export interface CalendarReminderAccess {
  supported(): boolean;
  permission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  ensureLegacyClear(): Promise<void>;
  find(): Promise<number | null>;
  create(): Promise<number>;
  reminderEnabled(calendarId: number): Promise<boolean>;
  events(calendarId: number): Promise<CalendarReminderEvent[]>;
  insert(calendarId: number, event: CalendarReminderInsert): Promise<number>;
  remove(calendarId: number, id: number): Promise<void>;
}
function ours(key: string): boolean { return /^campusddl1-[a-f0-9]{32}$/.test(key); }
/** Calendar data stays local. Creation is possible only through the explicitly confirmed publish path. */
export class CalendarReminderPort implements ReminderPort {
  constructor(private access: CalendarReminderAccess, private now: () => number = () => Date.now()) {}
  supported(): boolean { return this.access.supported(); }
  permissionAction(): string { return '允许任务日历权限'; }
  permissionNotice(): string { return '使用课事清专用日历，需要日历读写权限；只管理本应用标记的提醒。日历提示音由系统设置控制。'; }
  permission(): Promise<boolean> { return this.access.permission(); }
  requestPermission(): Promise<boolean> { return this.access.requestPermission(); }
  private async guard(): Promise<void> {
    if (!this.supported()) throw new StorageFailure('UNSUPPORTED_PLATFORM', '当前设备不支持任务日历提醒。');
    await this.access.ensureLegacyClear();
    if (!await this.access.permission()) throw new StorageFailure('CALENDAR_PERMISSION_REQUIRED', '请本人核对并允许课事清的日历权限，任务仍可正常保存。');
  }
  async list(): Promise<ReminderRegistration[]> {
    await this.guard();
    const calendar = await this.access.find();
    if (calendar === null) return [];
    const enabled = await this.access.reminderEnabled(calendar);
    const events = await this.access.events(calendar);
    if (events.length > 2000) throw new StorageFailure('CALENDAR_LIMIT', '专用日历事件较多，请先核对后再试。');
    const records: ReminderRegistration[] = [];
    events.filter(event => ours(event.key)).forEach(event => {
      if (!Number.isSafeInteger(event.id) || event.id < 0 || records.some(record => record.id === event.id)) throw new StorageFailure('CALENDAR_UNCERTAIN', '日历返回的事件编号无效或重复，请重新读取。');
      const valid: boolean = Number.isFinite(event.startTime) && Number.isFinite(event.endTime) && event.endTime > event.startTime &&
        !event.allDay && Array.isArray(event.reminderMinutes) && event.reminderMinutes.length === 1 &&
        Number.isSafeInteger(event.reminderMinutes[0]) && event.reminderMinutes[0] >= 1 && event.reminderMinutes[0] <= 10080;
      const instant: number = valid ? event.startTime - event.reminderMinutes[0] * 60000 : NaN;
      const inRange: boolean = valid && Math.abs(instant) <= 8640000000000000 && Math.abs(event.startTime) <= 8640000000000000;
      records.push(new ReminderRegistration(event.id, event.key, inRange ? new Date(instant).toISOString() : '',
        inRange ? new Date(event.startTime).toISOString() : '', enabled && inRange));
    });
    return records;
  }
  async publish(plan: ReminderPlan): Promise<number> {
    await this.guard();
    const deadline: number = timestampMillis(plan.deadlineAt), fire: number = timestampMillis(plan.fireAt);
    // Match the explicit native metadata query. Never create an event outside
    // the range we can subsequently discover, deduplicate and cancel.
    if (deadline < 0 || deadline + 60000 >= 4102444800000) {
      throw new StorageFailure('CALENDAR_TIME_OUT_OF_RANGE', '当前日历提醒支持1970年至2100年前的时刻；任务截止保持不变，请核对提醒时间。');
    }
    if (!ours(plan.key) || !Number.isSafeInteger(plan.leadMinutes) || plan.leadMinutes < 1 || plan.leadMinutes > 10080 ||
      !Number.isFinite(deadline) || !Number.isFinite(fire) || deadline - fire !== plan.leadMinutes * 60000 || fire < this.now() + 60000 ||
      plan.title.length < 1 || plan.title.length > 80 || plan.content.length < 1 || plan.content.length > 200) {
      throw new StorageFailure('INVALID_ARGUMENT', '日历提醒计划无效、时刻不一致或距离触发不足一分钟。');
    }
    const existing = (await this.list()).filter(record => record.key === plan.key);
    if (existing.length > 0) {
      if (existing.some(record => record.enabled === false || timestampMillis(record.deadlineAt || '') !== deadline || timestampMillis(record.fireAt || '') !== fire)) {
        throw new StorageFailure('REMINDER_EXTERNALLY_CHANGED', '日历中的提醒已被修改或关闭，请明确核对后处理，不会自动覆盖。');
      }
      return existing[0].id;
    }
    let calendar = await this.access.find();
    if (calendar === null) calendar = await this.access.create();
    if (!Number.isSafeInteger(calendar) || calendar < 0) throw new StorageFailure('CALENDAR_UNCERTAIN', '专用日历编号未核实。');
    if (!await this.access.reminderEnabled(calendar)) throw new StorageFailure('CALENDAR_REMINDERS_DISABLED', '课事清专用日历的提醒开关已关闭，请本人在系统日历设置中核对；不会自动重新开启。');
    const id = await this.access.insert(calendar, { key: plan.key, title: plan.title, description: plan.content,
      startTime: deadline, endTime: deadline + 60000, leadMinutes: plan.leadMinutes });
    if (!Number.isSafeInteger(id) || id < 0) throw new StorageFailure('CALENDAR_UNCERTAIN', '日历事件编号未核实，请读取实际结果，勿重复新增。');
    return id;
  }
  async cancel(id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 0) throw new StorageFailure('INVALID_ARGUMENT', '日历提醒编号无效。');
    const owned = await this.list();
    if (!owned.some(record => record.id === id)) return;
    const calendar = await this.access.find();
    if (calendar !== null) await this.access.remove(calendar, id);
  }
}
