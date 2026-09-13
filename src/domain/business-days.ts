export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function toISODate(date: CalendarDate): string {
  const year = String(date.year).padStart(4, "0");
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromISODate(value: string): CalendarDate {
  const parts = value.split("-");
  if (parts.length !== 3) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  if (toISODate({ year, month, day }) !== value) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return { year, month, day };
}

export function isValidISODateString(value: string): boolean {
  try {
    return toISODate(fromISODate(value)) === value;
  } catch {
    return false;
  }
}

function toUtcDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromUtcDate(utc: Date): CalendarDate {
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function getWeekday(date: CalendarDate): number {
  return toUtcDate(date).getUTCDay();
}

export function isBusinessDay(date: CalendarDate, blockedDates?: ReadonlySet<string>): boolean {
  const weekday = getWeekday(date);
  if (weekday < 1 || weekday > 5) {
    return false;
  }
  if (blockedDates && blockedDates.has(toISODate(date))) {
    return false;
  }
  return true;
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const utc = toUtcDate(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtcDate(utc);
}

export function nextBusinessDay(
  date: CalendarDate,
  blockedDates?: ReadonlySet<string>,
): CalendarDate {
  let current = addCalendarDays(date, 1);
  while (!isBusinessDay(current, blockedDates)) {
    current = addCalendarDays(current, 1);
  }
  return current;
}

export function addBusinessDays(
  date: CalendarDate,
  days: number,
  blockedDates?: ReadonlySet<string>,
): CalendarDate {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error("days must be a non-negative integer");
  }
  let current = date;
  let remaining = days;
  while (remaining > 0) {
    current = addCalendarDays(current, 1);
    if (isBusinessDay(current, blockedDates)) {
      remaining -= 1;
    }
  }
  return current;
}
