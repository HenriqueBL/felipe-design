import { describe, expect, it } from "vitest";
import {
  isLegacySupabaseJwt,
  isSupabasePublicKey,
  isSupabaseServerKey,
  validateProductionEnv,
} from "../scripts/validate-production-env.mjs";

// All values below are FAKE, structurally equivalent only.
const fakeJwt =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2Zha2Uuc3VwYWJhc2UuY28iLCJyb2xlIjoiYW5vbiJ9."
  + "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0";
const fakePublishable = "sb_publishable_2f9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c";
const fakeSecret = "sb_secret_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";

const validBaseEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://fake-project.supabase.co",
  NEXT_PUBLIC_SITE_URL: "https://fake.example.com",
  SUPABASE_SERVICE_ROLE_KEY: fakeJwt,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt,
};

function keyErrors(env: Record<string, string | undefined>) {
  return validateProductionEnv(env).filter((e) => e.includes("KEY"));
}

describe("isLegacySupabaseJwt", () => {
  it("accepts a structurally valid JWT", () => {
    expect(isLegacySupabaseJwt(fakeJwt)).toBe(true);
  });

  it("rejects two-segment strings", () => {
    expect(isLegacySupabaseJwt("abc.def")).toBe(false);
  });

  it("rejects four-segment strings", () => {
    expect(isLegacySupabaseJwt("abc.def.ghi.jkl")).toBe(false);
  });

  it("rejects empty segments", () => {
    expect(isLegacySupabaseJwt("abc..def")).toBe(false);
    expect(isLegacySupabaseJwt(".abc.def")).toBe(false);
    expect(isLegacySupabaseJwt("abc.def.")).toBe(false);
  });

  it("rejects invalid characters", () => {
    expect(isLegacySupabaseJwt("ab c.def.ghi")).toBe(false);
    expect(isLegacySupabaseJwt("ab+c.def.ghi")).toBe(false);
  });
});

describe("key type helpers", () => {
  it("accepts publishable keys and rejects secrets for public use", () => {
    expect(isSupabasePublicKey(fakePublishable)).toBe(true);
    expect(isSupabasePublicKey(fakeSecret)).toBe(false);
  });

  it("accepts server secrets and rejects publishable keys for server use", () => {
    expect(isSupabaseServerKey(fakeSecret)).toBe(true);
    expect(isSupabaseServerKey(fakePublishable)).toBe(false);
  });

  it("rejects long strings without dots or known prefixes", () => {
    const long = "a".repeat(150);
    expect(isSupabasePublicKey(long)).toBe(false);
    expect(isSupabaseServerKey(long)).toBe(false);
  });
});

describe("validateProductionEnv", () => {
  it("passes with legacy JWT keys", () => {
    expect(validateProductionEnv(validBaseEnv)).toEqual([]);
  });

  it("passes with sb_publishable_ anon key", () => {
    expect(
      validateProductionEnv({
        ...validBaseEnv,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: fakePublishable,
      })
    ).toEqual([]);
  });

  it("passes with sb_secret_ service key", () => {
    expect(
      validateProductionEnv({
        ...validBaseEnv,
        SUPABASE_SERVICE_ROLE_KEY: fakeSecret,
      })
    ).toEqual([]);
  });

  it("fails with a long dot-less string as anon key", () => {
    const errors = keyErrors({
      ...validBaseEnv,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(150),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("fails with two-segment JWT", () => {
    expect(
      keyErrors({ ...validBaseEnv, SUPABASE_SERVICE_ROLE_KEY: "abc.def" })
    ).toHaveLength(1);
  });

  it("fails with four-segment JWT", () => {
    expect(
      keyErrors({ ...validBaseEnv, SUPABASE_SERVICE_ROLE_KEY: "a.b.c.d" })
    ).toHaveLength(1);
  });

  it("fails with invalid characters in JWT", () => {
    expect(
      keyErrors({
        ...validBaseEnv,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "ab c.def.ghi",
      })
    ).toHaveLength(1);
  });

  it("rejects sb_secret_ in the public variable", () => {
    expect(
      keyErrors({ ...validBaseEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeSecret })
    ).toHaveLength(1);
  });

  it("rejects sb_publishable_ in the server variable", () => {
    expect(
      keyErrors({ ...validBaseEnv, SUPABASE_SERVICE_ROLE_KEY: fakePublishable })
    ).toHaveLength(1);
  });

  it("still rejects ENABLE_MOCK_PAYMENTS=true in production", () => {
    const errors = validateProductionEnv({
      ...validBaseEnv,
      ENABLE_MOCK_PAYMENTS: "true",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ENABLE_MOCK_PAYMENTS");
  });

  it("still validates NEXT_PUBLIC_SITE_URL and other checks", () => {
    const errors = validateProductionEnv({
      ...validBaseEnv,
      NEXT_PUBLIC_SITE_URL: "not-a-url",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("NEXT_PUBLIC_SITE_URL");

    expect(
      validateProductionEnv({
        ...validBaseEnv,
        NEXT_PUBLIC_SUPABASE_URL: "http://wrong.example.com",
      })
    ).toHaveLength(1);

    expect(validateProductionEnv({ ...validBaseEnv, NEXT_PUBLIC_SITE_URL: undefined })).toEqual([
      "Missing required environment variable: NEXT_PUBLIC_SITE_URL",
    ]);
  });

  it("passes when TRUSTED_GEO_SOURCE is absent (geo disabled)", () => {
    expect(validateProductionEnv(validBaseEnv)).toEqual([]);
  });

  it("passes when TRUSTED_GEO_SOURCE=x-origin-country", () => {
    expect(
      validateProductionEnv({
        ...validBaseEnv,
        TRUSTED_GEO_SOURCE: "x-origin-country",
      })
    ).toEqual([]);
  });

  it("rejects TRUSTED_GEO_SOURCE=cf-ipcountry in production", () => {
    const errors = validateProductionEnv({
      ...validBaseEnv,
      TRUSTED_GEO_SOURCE: "cf-ipcountry",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("TRUSTED_GEO_SOURCE");
    expect(errors[0]).toContain("x-origin-country");
  });

  it("rejects TRUSTED_GEO_SOURCE=x-vercel-ip-country in production", () => {
    const errors = validateProductionEnv({
      ...validBaseEnv,
      TRUSTED_GEO_SOURCE: "x-vercel-ip-country",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("TRUSTED_GEO_SOURCE");
  });

  it("rejects arbitrary TRUSTED_GEO_SOURCE values in production", () => {
    const errors = validateProductionEnv({
      ...validBaseEnv,
      TRUSTED_GEO_SOURCE: "random-header",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("TRUSTED_GEO_SOURCE");
  });
});