import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminUser } from "@/services/auth";
import { getPortfolioWork } from "@/services/portfolio-cms";

const uuidSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  const admin = await isAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id || !uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
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