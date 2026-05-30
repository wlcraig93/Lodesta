import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const jobSchema = z.object({
  kind: z.enum([
    "presence_assessment",
    "audit_site",
    "generate_site",
    "monthly_action_list",
    "import_batch",
    "analytics_retention"
  ]),
  payload: z.record(z.unknown()).default({})
});

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const jobs = await repository.listJobs(
    status === "queued" || status === "running" || status === "completed" || status === "failed" ? status : undefined
  );
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = jobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job request", issues: parsed.error.issues }, { status: 400 });
  }

  const job = await repository.enqueueJob(parsed.data.kind, parsed.data.payload);
  return NextResponse.json(job);
}
