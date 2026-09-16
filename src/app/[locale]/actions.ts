"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLocale, defaultLocale, type Locale } from "@/lib/i18n/config";

/**
 * Sign out via Server Action (POST semantics).
 *
 * A GET route handler redirect does not invalidate the Next.js client Router
 * Cache, so the header kept showing the authenticated state until a manual
 * refresh. A Server Action lets us sign out, revalidate the whole layout
 * tree, and redirect in one round trip — the UI updates immediately.
 */
export async function signOutAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // Flush cached layouts/pages that may embed the authenticated header.
  revalidatePath("/", "layout");

  const raw = String(formData.get("locale") ?? "");
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  redirect(`/${locale}`);
}
