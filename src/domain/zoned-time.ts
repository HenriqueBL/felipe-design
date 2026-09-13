import type { CalendarDate } from "./business-days";

export interface ZonedDateTimeParts extends CalendarDate {
  hour: number;
  minute: number;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const partValue = (type: string): string => {
    const part = parts.find((item) => item.type === type);
    if (!part) {
      throw new Error(`DateTimeFormat did not return a ${type} part`);
    }
    return part.value;
  };
  return {
    year: Number(partValue("year")),
    month: Number(partValue("month")),
    day: Number(partValue("day")),
    hour: Number(partValue("hour")),
    minute: Number(partValue("minute")),
  };
}

export function parseTimeToMinutes(time: string): number {
  const parts = time.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid time (expected HH:MM): ${time}`);
  }
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid time (expected HH:MM): ${time}`);
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time (expected HH:MM): ${time}`);
  }
  return hour * 60 + minute;
}

export function isValidTimeFormat(time: string): boolean {
  try {
    parseTimeToMinutes(time);
    return true;
  } catch {
    return false;
  }
}
