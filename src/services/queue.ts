import { z } from "zod";
import { isValidISODateString } from "@/domain/business-days";
import {
  isValidTimeFormat,
  isValidTimezone,
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

export interface TurnaroundEstimate {
  businessDaysAfterReady: number;
  currentBacklogImages: number;
}

// Estimativa comercial pre-compra: quantos dias uteis de producao serao
// necessarios apos o pedido ficar ready_for_production. Nao retorna data
// absoluta porque o prazo definitivo so existe quando pagamento + fotos
// completas sao satisfeitos (migration 0006).
export function estimateTurnaroundAfterReady(input: DeadlineInput): TurnaroundEstimate {
  const parsed = deadlineInputSchema.parse(input);

  const totalImages = parsed.backlogImages + parsed.newImages;
  const businessDaysAfterReady = Math.ceil(totalImages / parsed.dailyCapacity);

  return {
    businessDaysAfterReady,
    currentBacklogImages: parsed.backlogImages,
  };
}
