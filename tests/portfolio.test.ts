import { describe, expect, it } from "vitest";
import { portfolioPublicUrl } from "@/lib/portfolio-url";

const SUPABASE_URL = "https://example.supabase.co";

describe("portfolioPublicUrl", () => {
  it("builds the public object URL for the portfolio bucket", () => {
    expect(portfolioPublicUrl(SUPABASE_URL, "items/abc.jpg")).toBe(
      "https://example.supabase.co/storage/v1/object/public/portfolio/items/abc.jpg",
    );
  });

  it("encodes nothing beyond path itself for simple paths", () => {
    expect(portfolioPublicUrl(SUPABASE_URL, "items/x.webp")).toContain(
      "/storage/v1/object/public/portfolio/items/x.webp",
    );
  });
});