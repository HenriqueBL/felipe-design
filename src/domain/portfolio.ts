import type { FocalPoint } from "@/types/database";

export const VALID_FOCAL_POINTS: readonly FocalPoint[] = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export const MAX_MEDIA_PER_WORK = 3;
export const MIN_MEDIA_PER_WORK = 1;

export function isValidFocalPoint(value: string): value is FocalPoint {
  return (VALID_FOCAL_POINTS as readonly string[]).includes(value);
}

export function focalPointToObjectPosition(fp: FocalPoint): string {
  const map: Record<FocalPoint, string> = {
    "top-left": "left top",
    "top-center": "center top",
    "top-right": "right top",
    "center-left": "left center",
    center: "center center",
    "center-right": "right center",
    "bottom-left": "left bottom",
    "bottom-center": "center bottom",
    "bottom-right": "right bottom",
  };
  return map[fp];
}

export function computeAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
): number | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return Number((width / height).toFixed(4));
}

export type MediaOrientation = "landscape" | "portrait" | "square";

export function getMediaOrientation(
  width: number | null | undefined,
  height: number | null | undefined,
): MediaOrientation {
  if (!width || !height) return "landscape";
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

/**
 * Validates that media positions are within allowed range and unique.
 * Returns error message or null if valid.
 */
export function validateMediaPositions(positions: number[]): string | null {
  if (positions.length === 0) return "At least one media is required";
  if (positions.length > MAX_MEDIA_PER_WORK) {
    return `Maximum ${MAX_MEDIA_PER_WORK} media per work`;
  }
  for (const pos of positions) {
    if (pos < 1 || pos > MAX_MEDIA_PER_WORK) {
      return `Position must be between 1 and ${MAX_MEDIA_PER_WORK}`;
    }
  }
  const unique = new Set(positions);
  if (unique.size !== positions.length) {
    return "Duplicate positions are not allowed";
  }
  return null;
}

/**
 * Normalizes an ordered list of IDs into sequential positions 1..N.
 * Used after reorder operations to ensure clean sequence.
 */
export function normalizePositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}