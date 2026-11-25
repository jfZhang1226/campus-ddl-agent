import { ReminderOwner } from '../reminders/ReminderOwner';
import { HarmonyCalendarAccess } from './HarmonyCalendarAccess';
import { CalendarReminderPort } from '../reminders/CalendarReminderPort';

export const nativeReminderOwner = new ReminderOwner(context => new CalendarReminderPort(new HarmonyCalendarAccess(context)));
