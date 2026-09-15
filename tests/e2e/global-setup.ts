/**
 * Playwright Global Setup — runs once before all tests.
 * Validates Supabase DEV safety guard to prevent accidental execution against production.
 */

import { assertDevEnvironment } from "./helpers/safety-guard";

export default async function globalSetup(): Promise<void> {
  console.log("🔒 E2E Global Setup: Validating Supabase DEV safety guard...");
  assertDevEnvironment();
  console.log("✅ Safety guard passed. Tests will run against authorized DEV environment.");
}