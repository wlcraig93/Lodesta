import { NextResponse } from "next/server";
import { getHealthReport } from "@/lib/health";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deep = searchParams.get("deep") === "1" || searchParams.get("ready") === "1";

  if (deep) {
    const unauthorized = requireAdmin(request);
    if (unauthorized) return unauthorized;
  }

  const report = await getHealthReport({ deep });
  const status = deep && report.status === "error" ? 503 : 200;

  if (!deep) {
    return NextResponse.json({
      status: "ok",
      timestamp: report.timestamp
    });
  }

  return NextResponse.json(report, { status });
}
