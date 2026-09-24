import { describe, expect, it, vi, afterEach } from "vitest";
import { extractCountry, resolveMarket } from "@/lib/market";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractCountry — production security", () => {
  it("ignores x-test-country in production (NODE_ENV=production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = new Headers();
    h.set("x-test-country", "BR");
    // Without TRUSTED_GEO_SOURCE, production always returns null
    expect(extractCountry(h)).toBeNull();
  });

  it("ignores cf-ipcountry in production when TRUSTED_GEO_SOURCE is not set", () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = new Headers();
    h.set("cf-ipcountry", "BR");
    expect(extractCountry(h)).toBeNull();
  });

  it("ignores x-vercel-ip-country in production when TRUSTED_GEO_SOURCE is not set", () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = new Headers();
    h.set("x-vercel-ip-country", "BR");
    expect(extractCountry(h)).toBeNull();
  });

  it("reads TRUSTED_GEO_SOURCE header in production when explicitly configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_GEO_SOURCE", "cf-ipcountry");
    const h = new Headers();
    h.set("cf-ipcountry", "BR");
    expect(extractCountry(h)).toBe("BR");
  });

  it("does NOT read other headers when TRUSTED_GEO_SOURCE is set to a specific header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_GEO_SOURCE", "cf-ipcountry");
    const h = new Headers();
    // Only cf-ipcountry is trusted; x-vercel-ip-country is ignored
    h.set("x-vercel-ip-country", "BR");
    expect(extractCountry(h)).toBeNull();
  });

  it("spoofed cf-ipcountry in production without TRUSTED_GEO_SOURCE → null → en/USD", () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = new Headers();
    h.set("cf-ipcountry", "BR");
    const country = extractCountry(h);
    const market = resolveMarket(country);
    expect(country).toBeNull();
    expect(market.locale).toBe("en");
    expect(market.currency).toBe("USD");
  });
});

describe("extractCountry — dev/test", () => {
  it("accepts x-test-country in non-production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const h = new Headers();
    h.set("x-test-country", "BR");
    expect(extractCountry(h)).toBe("BR");
  });

  it("x-test-country takes priority over cf-ipcountry in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    const h = new Headers();
    h.set("x-test-country", "US");
    h.set("cf-ipcountry", "BR");
    expect(extractCountry(h)).toBe("US");
  });
});

describe("crawler cannot influence currency authority", () => {
  it("Googlebot with spoofed cf-ipcountry in prod still gets en/USD", () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = new Headers();
    h.set("user-agent", "Googlebot");
    h.set("cf-ipcountry", "BR");
    const country = extractCountry(h);
    const market = resolveMarket(country);
    // Crawler or not, without TRUSTED_GEO_SOURCE → null → en/USD
    expect(market.currency).toBe("USD");
    expect(market.locale).toBe("en");
  });
});