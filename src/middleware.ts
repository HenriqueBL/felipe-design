import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/lib/i18n/config";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    return NextResponse.redirect(new URL(`/${defaultLocale}`, request.url));
  }

  const { response, supabase, user } = await updateSession(request);

  const segments = pathname.split("/").filter(Boolean);
  const maybeLocale = segments[0] ?? "";
  if (!isLocale(maybeLocale)) {
    return response;
  }
  const locale = maybeLocale;

  // Area do cliente exige autenticacao; o fluxo original e preservado via next.
  // Middleware roda antes dos rewrites, entao cobrimos tambem o caminho publico de PT.
  const section = segments[1] ?? "";
  if ((section === "account" || section === "conta") && !user) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (segments[1] === "dashboard") {
    if (!user) {
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.redirect(new URL(`/${locale}`, request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/", "/en/:path*", "/pt/:path*"],
};
