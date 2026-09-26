import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_PER_WORK,
  MIN_MEDIA_PER_WORK,
  VALID_FOCAL_POINTS,
  computeAspectRatio,
  focalPointToObjectPosition,
  getMediaOrientation,
  isValidFocalPoint,
  normalizePositions,
  validateMediaPositions,
} from "@/domain/portfolio";

describe("Portfolio domain — focal point", () => {
  it("accepts all valid focal points", () => {
    for (const fp of VALID_FOCAL_POINTS) {
      expect(isValidFocalPoint(fp)).toBe(true);
    }
  });

  it("rejects invalid focal point strings", () => {
    expect(isValidFocalPoint("invalid")).toBe(false);
    expect(isValidFocalPoint("")).toBe(false);
    expect(isValidFocalPoint("top-left ")).toBe(false);
  });

  it("maps focal points to correct object-position values", () => {
    expect(focalPointToObjectPosition("center")).toBe("center center");
    expect(focalPointToObjectPosition("top-left")).toBe("left top");
    expect(focalPointToObjectPosition("bottom-right")).toBe("right bottom");
    expect(focalPointToObjectPosition("center-left")).toBe("left center");
  });
});

describe("Portfolio domain — aspect ratio & orientation", () => {
  it("computes aspect ratio correctly", () => {
    expect(computeAspectRatio(1920, 1080)).toBeCloseTo(1.7778, 3);
    expect(computeAspectRatio(1080, 1920)).toBeCloseTo(0.5625, 3);
    expect(computeAspectRatio(1000, 1000)).toBe(1);
  });

  it("returns null for invalid dimensions", () => {
    expect(computeAspectRatio(null, 100)).toBeNull();
    expect(computeAspectRatio(100, null)).toBeNull();
    expect(computeAspectRatio(0, 100)).toBeNull();
    expect(computeAspectRatio(100, -1)).toBeNull();
  });

  it("classifies orientation correctly", () => {
    expect(getMediaOrientation(1920, 1080)).toBe("landscape");
    expect(getMediaOrientation(1080, 1920)).toBe("portrait");
    expect(getMediaOrientation(1000, 1000)).toBe("square");
  });

  it("returns unknown when dimensions are missing or invalid", () => {
    expect(getMediaOrientation(null, null)).toBe("unknown");
    expect(getMediaOrientation(undefined, undefined)).toBe("unknown");
    expect(getMediaOrientation(0, 100)).toBe("unknown");
    expect(getMediaOrientation(100, 0)).toBe("unknown");
    expect(getMediaOrientation(-1, 100)).toBe("unknown");
  });
});

describe("Portfolio domain — media position validation", () => {
  it("validates correct positions for 1, 2, and 3 media", () => {
    expect(validateMediaPositions([1])).toBeNull();
    expect(validateMediaPositions([1, 2])).toBeNull();
    expect(validateMediaPositions([1, 2, 3])).toBeNull();
  });

  it("rejects empty positions array", () => {
    expect(validateMediaPositions([])).toContain("At least one");
  });

  it("rejects more than max media per work", () => {
    expect(validateMediaPositions([1, 2, 3, 4])).toContain(
      `Maximum ${MAX_MEDIA_PER_WORK}`,
    );
  });

  it("rejects out-of-range positions", () => {
    expect(validateMediaPositions([0])).toContain("between 1 and");
    expect(validateMediaPositions([4])).toContain("between 1 and");
    expect(validateMediaPositions([-1])).toContain("between 1 and");
  });

  it("rejects duplicate positions", () => {
    expect(validateMediaPositions([1, 1])).toContain("Duplicate");
    expect(validateMediaPositions([1, 2, 2])).toContain("Duplicate");
  });

  it("enforces constants", () => {
    expect(MAX_MEDIA_PER_WORK).toBe(3);
    expect(MIN_MEDIA_PER_WORK).toBe(1);
  });
});

describe("Portfolio domain — normalizePositions", () => {
  it("generates sequential 1..N positions", () => {
    expect(normalizePositions(1)).toEqual([1]);
    expect(normalizePositions(2)).toEqual([1, 2]);
    expect(normalizePositions(3)).toEqual([1, 2, 3]);
  });

  it("returns empty array for zero count", () => {
    expect(normalizePositions(0)).toEqual([]);
  });
});