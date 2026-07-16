import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { buildWorkerQueueStatus, repositoryModeFromEnv, workerHeartbeatStaleMs } from "@/lib/worker-runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const [jobs, heartbeats] = await Promise.all([
    repository.listJobs(),
    repository.listWorkerHeartbeats()
  ]);
  return NextResponse.json({
    ok: true,
    worker: buildWorkerQueueStatus({
      jobs,
      heartbeats,
      staleAfterMs: workerHeartbeatStaleMs(),
      repositoryMode: repositoryModeFromEnv()
    })
  });
}
