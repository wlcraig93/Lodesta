import { NextResponse } from "next/server";
import { appOriginFromRequest } from "@/lib/app-origin";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { siteCandidateIdForJob, intakeJobStatusResponse } from "@/lib/intake-job-status";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { jobId } = await params;
  const job = await repository.getJob(jobId);
  if (!job || job.kind !== "generate_site") {
    return NextResponse.json({ error: "Unknown candidate job" }, { status: 404 });
  }

  const siteCandidateId = siteCandidateIdForJob(job);
  const candidate = siteCandidateId ? await repository.getSiteCandidate(siteCandidateId) : null;
  return NextResponse.json(intakeJobStatusResponse({ job, candidate: candidate, origin: appOrigin(request) }));
}

function appOrigin(request: Request) {
  return appOriginFromRequest(request);
}
