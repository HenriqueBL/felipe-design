import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
