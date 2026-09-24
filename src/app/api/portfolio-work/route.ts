import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/services/auth";
import { getPortfolioWork } from "@/services/portfolio-cms";

export async function GET(request: NextRequest) {
  const admin = await isAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  try {
    const work = await getPortfolioWork(id);
    if (!work) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(work);
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}