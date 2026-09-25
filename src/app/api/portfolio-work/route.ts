import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, isAdminUserAdmin } from "@/services/auth";
import { getPortfolioWorkAdmin } from "@/services/portfolio-cms";

const uuidSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = await isAdminUserAdmin(user.id);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id || !uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const work = await getPortfolioWorkAdmin(id);
    if (!work) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(work);
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}