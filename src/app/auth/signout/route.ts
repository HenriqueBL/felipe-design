import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // Use canonical public origin — never request.url, which behind nginx/Docker
  // resolves to the internal bind address (e.g. http://0.0.0.0:3000).
  return NextResponse.redirect(`${siteUrl()}/en`);
}
