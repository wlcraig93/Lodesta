import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { generationIdForJob, intakeJobStatusResponse } from "@/lib/intake-job-status";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { jobId } = await params;
  const job = await repository.getJob(jobId);
  if (!job || job.kind !== "generate_site") {
    return NextResponse.json({ error: "Unknown generation job" }, { status: 404 });
  }

  const generationId = generationIdForJob(job);
  const generation = generationId ? await repository.getSiteGeneration(generationId) : null;
  return NextResponse.json(intakeJobStatusResponse({ job, generation, origin: appOrigin(request) }));
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
