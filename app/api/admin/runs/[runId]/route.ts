import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { runId } = await params;
  const record = await sitePlatformRepository.getAgentRunAdminRecord(runId);
  if (!record) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!record.run) return NextResponse.json({ error: record.issue ?? "stale schema - rebuild", runId }, { status: 409 });
  return NextResponse.json({ run: record.run });
}
