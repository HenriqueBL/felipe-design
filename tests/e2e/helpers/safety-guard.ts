/**
 * E2E Safety Guard — ensures tests only run against the authorized Supabase DEV project.
 * Mirrors the integration test harness guard to prevent accidental execution against production.
 */

const ALLOWED_PROJECT_REF = "jfsymthtepikfpexzxvk";

export function assertDevEnvironment(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "E2E SAFETY GUARD: NEXT_PUBLIC_SUPABASE_URL is not set. Aborting.",
    );
  }

  // Extract project ref from URL: https://<ref>.supabase.co
  const match = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match || match[1] !== ALLOWED_PROJECT_REF) {
    throw new Error(
      `E2E SAFETY GUARD: Supabase URL does not match allowed DEV project ref (${ALLOWED_PROJECT_REF}). ` +
        `Got: ${url}. Aborting to prevent execution against production or unauthorized environments.`,
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "E2E SAFETY GUARD: SUPABASE_SERVICE_ROLE_KEY is not set. Required for fixture setup/cleanup only.",
    );
  }
}