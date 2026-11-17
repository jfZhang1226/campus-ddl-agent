import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { calendarManager } from '@kit.CalendarKit';
import { BusinessError } from '@kit.BasicServicesKit';
import deviceInfo from '@ohos.deviceInfo';
import { CalendarReminderAccess, CalendarReminderEvent, CalendarReminderInsert } from '../reminders/CalendarReminderPort';
import { StorageFailure } from '../data/storage/StorageTypes';
import { HarmonyReminderPort } from './HarmonyReminderPort';

/** API21+ narrow calendar permissions; never uses a default or all-calendars query. */
export class HarmonyCalendarAccess implements CalendarReminderAccess {
  private context: common.UIAbilityContext;
  private manager: calendarManager.CalendarManager;
  private account: calendarManager.CalendarAccount;
  private legacy: HarmonyReminderPort;
  private permissions: Permissions[] = ['ohos.permission.READ_CALENDAR', 'ohos.permission.WRITE_CALENDAR'];
  constructor(context: common.UIAbilityContext) {
    this.context = context; this.manager = calendarManager.getCalendarManager(context);
    this.account = { name: context.applicationInfo.name + '.campusddl.reminders.v1', type: calendarManager.CalendarType.LOCAL, displayName: '课事清任务提醒' };
    this.legacy = new HarmonyReminderPort(context);
  }
  supported(): boolean { return deviceInfo.osFullName.startsWith('OpenHarmony') && deviceInfo.sdkApiVersion >= 26 && canIUse('SystemCapability.Applications.CalendarData'); }
  private fail(error: BusinessError, operation: string): StorageFailure {
    const code: string = Number.isSafeInteger(error.code) ? String(error.code) : 'NATIVE_EXCEPTION';
    return new StorageFailure('CALENDAR_' + operation + '_' + code, '课事清专用日历操作未完成，请核对权限或重新读取。');
  }
  async permission(): Promise<boolean> {
    if (!this.supported()) return false;
    try {
      const manager = abilityAccessCtrl.createAtManager();
      for (const permission of this.permissions) {
        if (await manager.checkAccessToken(this.context.applicationInfo.accessTokenId, permission) !== abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) return false;
      }
      return true;
    } catch (error) { throw this.fail(error as BusinessError, 'PERMISSION'); }
  }
  async requestPermission(): Promise<boolean> {
    if (!this.supported()) return false;
    try { await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(this.context, this.permissions); return await this.permission(); }
    catch (error) { throw this.fail(error as BusinessError, 'REQUEST_PERMISSION'); }
  }
  async ensureLegacyClear(): Promise<void> {
    if ((await this.legacy.list()).length > 0) throw new StorageFailure('REMINDER_BACKEND_MIGRATION_REQUIRED', '旧代理提醒仍有登记，需先在旧入口核对取消再切换日历，不会漏清或重复设置。');
  }
  private async calendar(id: number): Promise<calendarManager.Calendar> {
    const calendar = await this.manager.getCalendar(this.account);
    const account = calendar.getAccount();
    if (calendar.id !== id || account.name !== this.account.name || account.type !== calendarManager.CalendarType.LOCAL) {
      throw new StorageFailure('CALENDAR_CHANGED', '课事清专用日历已变化，请重新读取；不会改用默认日历。');
    }
    return calendar;
  }
  async find(): Promise<number | null> {
    try {
      const calendar = await this.manager.getCalendar(this.account);
      if (calendar.getAccount().name !== this.account.name || calendar.getAccount().type !== calendarManager.CalendarType.LOCAL || !Number.isSafeInteger(calendar.id) || calendar.id < 0) {
        throw new StorageFailure('CALENDAR_UNCERTAIN', '专用日历的实际账户未核实。');
      }
      return calendar.id;
    } catch (error) {
      if (error instanceof StorageFailure) throw error;
      if ((error as BusinessError).code === 23900003) return null;
      throw this.fail(error as BusinessError, 'FIND');
    }
  }
  async create(): Promise<number> {
    try {
      const calendar = await this.manager.createCalendar(this.account);
      await calendar.setConfig({ enableReminder: true, color: '#176766' });
      return calendar.id;
    } catch (error) { throw this.fail(error as BusinessError, 'CREATE'); }
  }
  async reminderEnabled(id: number): Promise<boolean> {
    try { return (await this.calendar(id)).getConfig().enableReminder === true; }
    catch (error) { if (error instanceof StorageFailure) throw error; throw this.fail(error as BusinessError, 'CONFIG'); }
  }
  async events(id: number): Promise<CalendarReminderEvent[]> {
    try {
      const calendar = await this.calendar(id);
      const metadata = await calendar.getEvents(undefined, ['id', 'identifier']);
      if (metadata.length > 2000) throw new StorageFailure('CALENDAR_LIMIT', '专用日历项目较多，请先核对后再试。');
      const ids: number[] = metadata.filter(event => /^campusddl1-[a-f0-9]{32}$/.test(event.identifier || '')).map(event => event.id as number);
      if (ids.length === 0) return [];
      if (ids.some(value => !Number.isSafeInteger(value) || value < 0)) throw new StorageFailure('CALENDAR_UNCERTAIN', '日历事件编号未核实。');
      const events = await calendar.getEvents(calendarManager.EventFilter.filterById(ids), ['id', 'identifier', 'startTime', 'endTime', 'reminderTime', 'isAllDay']);
      return events.map(event => ({ id: event.id as number, key: event.identifier || '', startTime: event.startTime,
        endTime: event.endTime, reminderMinutes: event.reminderTime || [], allDay: event.isAllDay || false }));
    } catch (error) { if (error instanceof StorageFailure) throw error; throw this.fail(error as BusinessError, 'EVENTS'); }
  }
  async insert(id: number, input: CalendarReminderInsert): Promise<number> {
    try {
      return await (await this.calendar(id)).addEvent({ type: calendarManager.EventType.NORMAL, title: input.title,
        description: input.description, startTime: input.startTime, endTime: input.endTime, isAllDay: false,
        timeZone: 'Asia/Shanghai', reminderTime: [input.leadMinutes], identifier: input.key });
    } catch (error) { if (error instanceof StorageFailure) throw error; throw this.fail(error as BusinessError, 'INSERT'); }
  }
  async remove(id: number, eventId: number): Promise<void> {
    try { await (await this.calendar(id)).deleteEvent(eventId); }
    catch (error) { if (error instanceof StorageFailure) throw error; throw this.fail(error as BusinessError, 'REMOVE'); }
  }
}
