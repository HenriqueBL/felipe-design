import type { PortfolioActionCode } from "@/app/[locale]/dashboard/portfolio/actions";

/**
 * Labels shape expected by the mapper. Matches the dashboard.portfolioAction*
 * keys in src/lib/i18n/en.ts and pt.ts. Components pass the relevant slice
 * of their dictionary so the mapper stays locale-agnostic.
 */
export interface PortfolioActionLabels {
  forbidden: string;
  invalidInput: string;
  imageRequired: string;
  imageInvalid: string;
  createFailed: string;
  updateFailed: string;
  publishFailed: string;
  featuredFailed: string;
  clearFeaturedFailed: string;
  reorderFailed: string;
  notFound: string;
  deleteFailed: string;
  created: string;
  updated: string;
  publishedAction: string;
  unpublished: string;
  featuredSet: string;
  featuredCleared: string;
  reordered: string;
  deleted: string;
}

const CODE_TO_LABEL_KEY: Record<PortfolioActionCode, keyof PortfolioActionLabels> = {
  forbidden: "forbidden",
  invalid_input: "invalidInput",
  image_required: "imageRequired",
  image_invalid: "imageInvalid",
  create_failed: "createFailed",
  update_failed: "updateFailed",
  publish_failed: "publishFailed",
  featured_failed: "featuredFailed",
  clear_featured_failed: "clearFeaturedFailed",
  reorder_failed: "reorderFailed",
  not_found: "notFound",
  delete_failed: "deleteFailed",
  created: "created",
  updated: "updated",
  published: "publishedAction",
  unpublished: "unpublished",
  featured_set: "featuredSet",
  featured_cleared: "featuredCleared",
  reordered: "reordered",
  deleted: "deleted",
};

/**
 * Maps a stable action code returned by portfolio Server Actions to the
 * corresponding localized label. Pure function — no side effects, no React.
 * Returns undefined for unknown codes so callers can fall back safely.
 */
export function portfolioActionMessage(
  code: PortfolioActionCode | undefined | null,
  labels: PortfolioActionLabels,
): string | undefined {
  if (!code) return undefined;
  const key = CODE_TO_LABEL_KEY[code];
  if (!key) return undefined;
  return labels[key];
}