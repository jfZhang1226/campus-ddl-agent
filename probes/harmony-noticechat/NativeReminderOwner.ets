import { ReminderOwner } from '../reminders/ReminderOwner';
import { HarmonyReminderPort } from './HarmonyReminderPort';

export const nativeReminderOwner = new ReminderOwner(context => new HarmonyReminderPort(context));
