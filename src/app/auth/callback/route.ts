import { NextResponse } from "next/server";
import { isSafeNextPath } from "@/domain/checkout";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  // Somente caminhos internos /en ou /pt (protecao contra open-redirect).
  const next = isSafeNextPath(nextParam) ? nextParam : "/en";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/en/login`);
}
