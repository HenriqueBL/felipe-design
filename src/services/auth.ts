import type { User } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase/server";

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

// Checagem de papel no servidor (defesa em profundidade alem do middleware):
// usada nas acoes administrativas que enviam entregas finais.
export async function isAdminUser(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) {
    return false;
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return data?.role === "admin";
}

/**
 * Admin-only role check using service-role client to bypass RLS.
 * Use ONLY in admin pages/API routes where the caller has already been
 * authenticated via middleware or SSR cookie injection.
 * The user-scoped client may not receive SSR cookies during RSC rendering
 * in test environments (Playwright headless), causing false negatives.
 */
export async function isAdminUserAdmin(userId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return data?.role === "admin";
}
