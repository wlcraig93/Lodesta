import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({}));
  const limit = typeof body.limit === "number" ? body.limit : undefined;
  if (limit && limit > 1) {
    const jobs = await repository.processAllQueuedJobs(limit);
    return NextResponse.json({ processed: jobs.length, jobs });
  }
  const job = await repository.processNextJob();
  return NextResponse.json({ processed: job ? 1 : 0, job });
}
