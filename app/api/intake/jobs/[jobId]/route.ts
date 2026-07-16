import { NextResponse } from "next/server";
import { appOriginFromRequest } from "@/lib/app-origin";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { siteCandidateIdForJob, intakeJobStatusResponse } from "@/lib/intake-job-status";
import { buildWorkerQueueStatus, repositoryModeFromEnv, workerHeartbeatStaleMs } from "@/lib/worker-runtime";

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
  const [candidate, activeRuns, jobs, heartbeats] = await Promise.all([
    siteCandidateId ? repository.getSiteCandidate(siteCandidateId) : Promise.resolve(null),
    job.status === "running"
      ? repository.listAgentRuns({ metadataJobId: job.id, status: "running", limit: 1 }).catch(() => ({ runs: [], total: 0 }))
      : Promise.resolve({ runs: [], total: 0 }),
    repository.listJobs(),
    repository.listWorkerHeartbeats()
  ]);
  const activeRunId = activeRuns.runs[0]?.id;
  const activeRun = activeRunId ? await repository.getAgentRunDetail(activeRunId).catch(() => null) : null;
  const workerStatus = buildWorkerQueueStatus({
    jobs,
    heartbeats,
    staleAfterMs: workerHeartbeatStaleMs(),
    repositoryMode: repositoryModeFromEnv()
  });
  return NextResponse.json(intakeJobStatusResponse({ job, candidate: candidate, activeRun, workerStatus, origin: appOrigin(request) }));
}

function appOrigin(request: Request) {
  return appOriginFromRequest(request);
}
