"use client";

import { useActionState } from "react";
import type { AppSettingRow } from "@/types/database";
import { updateSettingsAction, type ActionResult } from "@/app/[locale]/dashboard/actions";

interface SettingsLabels {
  dailyCapacity: string;
  cutoffTime: string;
  timezone: string;
  minSourcePhotosPerKnife: string;
  maxSourcePhotosPerKnife: string;
  maxSourcePhotoSizeMb: string;
  sourcePhotoSnapshotNote: string;
  saved: string;
  saveError: string;
  save: string;
}

export default function SettingsForm({
  locale,
  settings,
  labels,
}: {
  locale: string;
  settings: AppSettingRow;
  labels: SettingsLabels;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    updateSettingsAction.bind(null, locale),
    null,
  );

  return (
    <form action={formAction}>
      <div className="form-group">
        <label htmlFor="dailyCapacity">{labels.dailyCapacity}</label>
        <input
          id="dailyCapacity"
          name="dailyCapacity"
          type="number"
          min={1}
          max={1000}
          defaultValue={settings.daily_capacity}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="cutoffTime">{labels.cutoffTime}</label>
        <input
          id="cutoffTime"
          name="cutoffTime"
          type="text"
          pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
          defaultValue={settings.cutoff_time}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="timezone">{labels.timezone}</label>
        <input
          id="timezone"
          name="timezone"
          type="text"
          defaultValue={settings.timezone}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="minSourcePhotosPerKnife">{labels.minSourcePhotosPerKnife}</label>
        <input
          id="minSourcePhotosPerKnife"
          name="minSourcePhotosPerKnife"
          type="number"
          min={1}
          max={100}
          defaultValue={settings.min_source_photos_per_knife}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="maxSourcePhotosPerKnife">{labels.maxSourcePhotosPerKnife}</label>
        <input
          id="maxSourcePhotosPerKnife"
          name="maxSourcePhotosPerKnife"
          type="number"
          min={1}
          max={100}
          defaultValue={settings.max_source_photos_per_knife}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="maxSourcePhotoSizeMb">{labels.maxSourcePhotoSizeMb}</label>
        <input
          id="maxSourcePhotoSizeMb"
          name="maxSourcePhotoSizeMb"
          type="number"
          min={1}
          max={200}
          defaultValue={settings.max_source_photo_size_mb}
          required
        />
      </div>
      <p className="note">{labels.sourcePhotoSnapshotNote}</p>
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {labels.save}
      </button>
      {state?.success === true && <p className="form-status ok">{labels.saved}</p>}
      {state?.success === false && (
        <p className="form-status err">{state.message ?? labels.saveError}</p>
      )}
    </form>
  );
}
