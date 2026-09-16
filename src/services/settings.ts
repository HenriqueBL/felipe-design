import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppSettingRow } from "@/types/database";

const DEFAULT_CAPACITY = 4;
const DEFAULT_CUTOFF = "17:00";
const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const DEFAULT_MIN_SOURCE_PHOTOS = 3;
const DEFAULT_MAX_SOURCE_PHOTOS = 5;
const DEFAULT_MAX_SOURCE_PHOTO_SIZE_MB = 25;

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
    min_source_photos_per_knife: DEFAULT_MIN_SOURCE_PHOTOS,
    max_source_photos_per_knife: DEFAULT_MAX_SOURCE_PHOTOS,
    max_source_photo_size_mb: DEFAULT_MAX_SOURCE_PHOTO_SIZE_MB,
    updated_at: new Date().toISOString(),
  };
}

export interface UpdateSettingsInput {
  dailyCapacity: number;
  cutoffTime: string;
  timezone: string;
  minSourcePhotosPerKnife?: number;
  maxSourcePhotosPerKnife?: number;
  maxSourcePhotoSizeMb?: number;
}

export async function updateAppSettings(input: UpdateSettingsInput): Promise<AppSettingRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_app_settings", {
    p_daily_capacity: input.dailyCapacity,
    p_cutoff_time: input.cutoffTime,
    p_timezone: input.timezone,
    p_min_source_photos_per_knife: input.minSourcePhotosPerKnife ?? null,
    p_max_source_photos_per_knife: input.maxSourcePhotosPerKnife ?? null,
    p_max_source_photo_size_mb: input.maxSourcePhotoSizeMb ?? null,
  });

  if (error) {
    throw new Error("Failed to update settings: " + error.message);
  }
  return data;
}
