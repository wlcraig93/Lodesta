import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { searchParams } = new URL(request.url);
  return NextResponse.json(await repository.outboundSummary(searchParams.get("campaignId") ?? undefined));
}
