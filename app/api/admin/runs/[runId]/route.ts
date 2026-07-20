import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const run = await sitePlatformRepository.getAgentRun((await params).runId);
  return run ? NextResponse.json({ run }) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}
