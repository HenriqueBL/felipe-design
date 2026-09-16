import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

// Load .env.test.local before Vitest reads process.env
config({ path: path.resolve(__dirname, ".env.test.local"), override: true });

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    // afterAll cleanup deletes fixture users via the Supabase DEV API; the
    // default 10s hook timeout is too tight on CI runners (GH network latency).
    hookTimeout: 120000,
    // afterAll cleanup deletes fixture users via the Supabase DEV API; the
    // default 10s hook timeout is too tight on CI runners (GH network latency).
    hookTimeout: 120000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      ENABLE_MOCK_PAYMENTS: process.env.ENABLE_MOCK_PAYMENTS ?? "true",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});