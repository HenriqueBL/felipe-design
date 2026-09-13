import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppSettingRow } from "@/types/database";

const DEFAULT_CAPACITY = 4;
const DEFAULT_CUTOFF = "17:00";
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export async function getAppSettings(): Promise<AppSettingRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load settings: " + error.message);
  }

  if (data) {
    return data;
  }

  return {
    id: 1,
    daily_capacity: DEFAULT_CAPACITY,
    cutoff_time: DEFAULT_CUTOFF,
    timezone: DEFAULT_TIMEZONE,
    updated_at: new Date().toISOString(),
  };
}

export interface UpdateSettingsInput {
  dailyCapacity: number;
  cutoffTime: string;
  timezone: string;
}

export async function updateAppSettings(input: UpdateSettingsInput): Promise<AppSettingRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_app_settings", {
    p_daily_capacity: input.dailyCapacity,
    p_cutoff_time: input.cutoffTime,
    p_timezone: input.timezone,
  });

  if (error) {
    throw new Error("Failed to update settings: " + error.message);
  }
  return data;
}
