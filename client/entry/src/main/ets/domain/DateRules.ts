/** Gregorian dates, years 0001..9999. Never let Date.parse normalize impossible dates. */
export function isCalendarDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year: number = Number(value.slice(0, 4));
  const month: number = Number(value.slice(5, 7));
  const day: number = Number(value.slice(8, 10));
  const leap: boolean = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths: number[] = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= lengths[month - 1];
}

/** Explicit Z or numeric offset, seconds required, at most millisecond precision. */
export function timestampMillis(value: string): number {
  if (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !isCalendarDate(value.slice(0, 10))) return NaN;
  const hour: number = Number(value.slice(11, 13));
  const minute: number = Number(value.slice(14, 16));
  const second: number = Number(value.slice(17, 19));
  if (hour > 23 || minute > 59 || second > 59) return NaN;
  let offset: number = 0;
  const end: number = value.endsWith('Z') ? value.length - 1 : value.length - 6;
  if (!value.endsWith('Z')) {
    const zone: string = value.slice(-6);
    const hours: number = Number(zone.slice(1, 3));
    const minutes: number = Number(zone.slice(4, 6));
    // -00:00 means an unknown offset; it is not an exact instant in this contract.
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0) || zone === '-00:00') return NaN;
    offset = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
  }
  const fraction: string = value.slice(19, end);
  const millis: number = fraction.length === 0 ? 0 : Number((fraction.slice(1) + '00').slice(0, 3));
  const date: Date = new Date(0);
  // setUTCFullYear avoids Date.UTC's special handling of years 00..99.
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  date.setUTCHours(hour, minute, second, millis);
  return date.getTime() - offset * 60000;
}

export function isOffsetTimestamp(value: string): boolean {
  return Number.isFinite(timestampMillis(value));
}

/** Explicit first-release support; unknown zones never silently use the host timezone. */
export function isTaskTimezone(value: string): boolean {
  return value === 'Asia/Shanghai' || value === 'UTC' || value === 'Etc/UTC';
}

export function deadlineIsValid(precision: string, date: string | null, instant: string | null): boolean {
  return (precision === 'unknown' && date === null && instant === null) ||
    (precision === 'date_only' && isCalendarDate(date as string) && instant === null) ||
    (precision === 'exact' && date === null && isOffsetTimestamp(instant as string));
}

/** date_only stays literal; exact deadlines are projected into the requested supported zone. */
export function deadlineDay(precision: string, date: string | null, instant: string | null, zone: string): string | null {
  if (!isTaskTimezone(zone) || !deadlineIsValid(precision, date, instant)) return null;
  if (precision === 'unknown') return null;
  if (precision === 'date_only') return date;
  const shifted: Date = new Date(timestampMillis(instant as string) + (zone === 'Asia/Shanghai' ? 8 * 3600000 : 0));
  const year: number = shifted.getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  return year.toString().padStart(4, '0') + '-' + (shifted.getUTCMonth() + 1).toString().padStart(2, '0') +
    '-' + shifted.getUTCDate().toString().padStart(2, '0');
}
