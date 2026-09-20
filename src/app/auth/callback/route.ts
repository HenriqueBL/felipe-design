import { NextResponse } from "next/server";
import { isSafeNextPath } from "@/domain/checkout";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  // Somente caminhos internos /en ou /pt (protecao contra open-redirect).
  const next = isSafeNextPath(nextParam) ? nextParam : "/en";
  // Atras do nginx/Docker o request.url carrega a origin interna (ex. 0.0.0.0:3000),
  // entao redirects publicos usam a origin configurada em NEXT_PUBLIC_SITE_URL.
  const baseUrl = siteUrl();

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${baseUrl}${next}`);
    }
  }

  return NextResponse.redirect(`${baseUrl}/en/login`);
}
