import { NextResponse } from "next/server";
import { isSafeNextPath } from "@/domain/checkout";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const errorParam = searchParams.get("error");
  // Somente caminhos internos /en ou /pt (protecao contra open-redirect).
  const safeNext = isSafeNextPath(nextParam) ? nextParam : null;
  // Deriva locale do next seguro para preservar idioma no fluxo de erro/retry.
  const errorLocale = safeNext?.startsWith("/pt") ? "pt" : "en";
  // Atras do nginx/Docker o request.url carrega a origin interna (ex. 0.0.0.0:3000),
  // entao redirects publicos usam a origin configurada em NEXT_PUBLIC_SITE_URL.
  const baseUrl = siteUrl();

  // Supabase redirects here with error params when the magic link is expired,
  // already used, or otherwise invalid. Surface a user-friendly error page
  // instead of silently looping back to login with no explanation.
  // Raw error_description / error.message are intentionally NOT forwarded:
  // they can leak internal details via browser history, referrer headers, or logs.
  // The UI maps the stable `callback_error` code to a localized message.
  if (errorParam) {
    const loginUrl = new URL(`${baseUrl}/${errorLocale}/login`);
    loginUrl.searchParams.set("error", "callback_error");
    if (safeNext) {
      loginUrl.searchParams.set("next", safeNext);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const destination = safeNext ?? "/en";
      return NextResponse.redirect(`${baseUrl}${destination}`);
    }
    // Exchange failed (expired code, already consumed, etc.)
    const loginUrl = new URL(`${baseUrl}/${errorLocale}/login`);
    loginUrl.searchParams.set("error", "callback_error");
    if (safeNext) {
      loginUrl.searchParams.set("next", safeNext);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(`${baseUrl}/en/login`);
}
