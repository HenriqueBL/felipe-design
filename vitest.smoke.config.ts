import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.spec.ts"],
    testTimeout: 20_000,
    hookTimeout: 10_000,
  },
});