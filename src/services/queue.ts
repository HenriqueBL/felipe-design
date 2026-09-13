import { z } from "zod";
import {
  addBusinessDays,
  isBusinessDay,
  isValidISODateString,
  nextBusinessDay,
  toISODate,
  type CalendarDate,
} from "@/domain/business-days";
import {
  getZonedParts,
  isValidTimeFormat,
  isValidTimezone,
  parseTimeToMinutes,
} from "@/domain/zoned-time";

export const queueSettingsSchema = z.object({
  dailyCapacity: z.number().int().min(1).max(1000),
  cutoffTime: z.string().refine(isValidTimeFormat, "cutoffTime must use the HH:MM format"),
  timezone: z.string().refine(isValidTimezone, "timezone must be a valid IANA timezone"),
});

export type QueueSettings = z.infer<typeof queueSettingsSchema>;

export const deadlineInputSchema = queueSettingsSchema.extend({
  now: z.instanceof(Date),
  backlogImages: z.number().int().min(0),
  newImages: z.number().int().min(1),
  blockedDates: z
    .array(z.string().refine(isValidISODateString, "blockedDates must use the YYYY-MM-DD format"))
    .optional(),
});

export type DeadlineInput = z.infer<typeof deadlineInputSchema>;

export interface DeadlineResult {
  startsCountingFrom: string;
  businessDaysNeeded: number;
  promisedDeliveryDate: string;
}

export function calculatePromisedDeliveryDate(input: DeadlineInput): DeadlineResult {
  const parsed = deadlineInputSchema.parse(input);
  const blockedDates = new Set(parsed.blockedDates ?? []);

  const zonedParts = getZonedParts(parsed.now, parsed.timezone);
  const today: CalendarDate = {
    year: zonedParts.year,
    month: zonedParts.month,
    day: zonedParts.day,
  };

  const minutesNow = zonedParts.hour * 60 + zonedParts.minute;
  const afterCutoff = minutesNow >= parseTimeToMinutes(parsed.cutoffTime);

  const firstProductionDay =
    afterCutoff || !isBusinessDay(today, blockedDates)
      ? nextBusinessDay(today, blockedDates)
      : today;

  const totalImages = parsed.backlogImages + parsed.newImages;
  const businessDaysNeeded = Math.ceil(totalImages / parsed.dailyCapacity);

  const promisedDate = addBusinessDays(firstProductionDay, businessDaysNeeded - 1, blockedDates);

  return {
    startsCountingFrom: toISODate(firstProductionDay),
    businessDaysNeeded,
    promisedDeliveryDate: toISODate(promisedDate),
  };
}
