import { NextResponse } from "next/server";
import { getHealthReport } from "@/lib/health";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deep = searchParams.get("deep") === "1" || searchParams.get("ready") === "1";

  // Railway uses this route as a process-liveness probe. Keep the shallow
  // response independent of Supabase, sandbox compatibility, and every other
  // readiness dependency so a coordinated release cannot deadlock before its
  // authenticated deep-health phase.
  if (!deep) {
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString()
    });
  }

  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const report = await getHealthReport({ deep: true });
  const status = report.status === "error" ? 503 : 200;

  return NextResponse.json(report, { status });
}
