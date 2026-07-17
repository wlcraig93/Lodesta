import type { AgentRunDetail, AgentRunSpanRecord, JobRecord, SiteCandidateRecord, SiteVersion, WorkerQueueStatus } from "./models";
import { generationFailureFromJobResult } from "./generation-failure";

export type IntakeJobFailureCode =
  | "invalid_url"
  | "out_of_market"
  | "identity_conflict"
  | "data_incomplete"
  | "render_failed"
  | "generation_crash";

export type IntakeJobStatusResponse = {
  ok: true;
  job: {
    id: string;
    status: JobRecord["status"];
    attempts: number;
    errorCode: IntakeJobFailureCode | null;
    failureReason: string | null;
    effectiveStatus: "queued_waiting_for_worker" | "queued_worker_busy" | "running" | "blocked" | "ready" | "failed";
    runId: string | null;
    currentSpan: {
      id: string;
      name: string;
      spanType: string;
      status: AgentRunSpanRecord["status"];
      startedAt: string;
    } | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  candidate: {
    id: string;
    businessName: string;
    vertical: string;
    rendererVersion: SiteVersion["rendererVersion"] | "not_compiled" | null;
    readiness: "ready" | "blocked" | "unavailable" | "pending" | null;
    adminReviewUrl: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  worker: {
    state: "active" | "busy" | "not_processing";
    staleAfterSeconds: number;
    activeCount: number;
    currentJob: {
      id: string;
      kind: string;
      lockedBy?: string;
      lockedAt?: string;
      elapsedSeconds?: number;
    } | null;
    warning?: string;
  };
};

export const intakeJobStaleAfterSeconds = 10;

export function intakeJobStatusResponse(input: {
  job: JobRecord;
  candidate?: SiteCandidateRecord | null;
  activeRun?: AgentRunDetail | null;
  workerStatus?: WorkerQueueStatus;
  origin: string;
  now?: number;
}): IntakeJobStatusResponse {
  const activeRunId = input.activeRun?.run.id ?? null;
  const runId = stringResult(input.job.result, "runId") ?? activeRunId;
  const error = failureForJob(input.job);
  return {
    ok: true,
    job: {
      id: input.job.id,
      status: input.job.status,
      attempts: input.job.attempts,
      errorCode: error.errorCode,
      failureReason: error.failureReason,
      effectiveStatus: effectiveStatus(input.job, input.candidate ?? null, input.workerStatus),
      runId,
      currentSpan: input.activeRun ? currentSpanSummary(input.activeRun.spans) : null,
      createdAt: input.job.createdAt,
      updatedAt: input.job.updatedAt,
      startedAt: input.job.startedAt ?? null,
      completedAt: input.job.completedAt ?? null
    },
    candidate: input.candidate ? candidateSummary(input.candidate, input.origin) : null,
    worker: {
      ...workerSummary(input.job, input.workerStatus, input.now ?? Date.now()),
      staleAfterSeconds: input.workerStatus?.staleAfterSeconds ?? intakeJobStaleAfterSeconds
    }
  };
}

function currentSpanSummary(spans: AgentRunSpanRecord[]): IntakeJobStatusResponse["job"]["currentSpan"] {
  const current = [...spans]
    .filter((span) => span.status === "running")
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  if (!current) return null;
  return {
    id: current.id,
    name: current.name,
    spanType: current.spanType,
    status: current.status,
    startedAt: current.startedAt
  };
}

export function siteCandidateIdForJob(job: JobRecord) {
  return stringResult(job.result, "siteCandidateId");
}

function candidateSummary(candidate: SiteCandidateRecord, origin: string): NonNullable<IntakeJobStatusResponse["candidate"]> {
  const version = candidate.version;
  return {
    id: candidate.id,
    businessName: candidate.businessName,
    vertical: candidate.vertical,
    rendererVersion: version?.rendererVersion ?? "not_compiled",
    readiness: version?.generationQa?.readiness ?? (candidate.status === "blocked" ? "blocked" : candidate.status === "ready" ? "ready" : null),
    adminReviewUrl: `${origin}/admin/site-candidates/${candidate.id}`,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

function effectiveStatus(
  job: JobRecord,
  candidate: SiteCandidateRecord | null,
  workerStatus: WorkerQueueStatus | undefined
): IntakeJobStatusResponse["job"]["effectiveStatus"] {
  if (job.status === "failed") return "failed";
  if (candidate?.status === "blocked") return "blocked";
  const readiness = candidate?.version.generationQa?.readiness;
  if (job.status === "completed" && readiness === "ready") return "ready";
  if (job.status === "completed" && candidate?.status === "ready") return "ready";
  if (job.status === "running") return "running";
  if (job.status === "queued") {
    if (!workerStatus || workerStatus.activeWorkerCount === 0) return "queued_waiting_for_worker";
    if (busyJob(workerStatus)) return "queued_worker_busy";
    return "queued_waiting_for_worker";
  }
  return "failed";
}

function workerSummary(
  job: JobRecord,
  workerStatus: WorkerQueueStatus | undefined,
  now: number
): Omit<IntakeJobStatusResponse["worker"], "staleAfterSeconds"> {
  const current = workerStatus ? busyJob(workerStatus) : undefined;
  const warning = workerStatus?.activeWorkers.some((worker) => worker.repositoryMode !== workerStatus.repositoryMode)
    ? "Worker repository mode does not match the web process; jobs may be invisible across repositories."
    : undefined;
  if (job.status === "queued" && (!workerStatus || workerStatus.activeWorkerCount === 0)) {
    return {
      state: "not_processing",
      activeCount: 0,
      currentJob: null,
      warning: warning ?? "Worker is not running."
    };
  }
  if (job.status === "queued" && current) {
    return {
      state: "busy",
      activeCount: workerStatus?.activeWorkerCount ?? 0,
      currentJob: current,
      warning
    };
  }
  if (job.status === "queued") {
    const reference = Date.parse(job.runAfter || job.updatedAt || job.createdAt);
    const stale = Number.isFinite(reference) && now - reference > intakeJobStaleAfterSeconds * 1000;
    return {
      state: stale ? "not_processing" : "active",
      activeCount: workerStatus?.activeWorkerCount ?? 0,
      currentJob: null,
      warning: stale ? warning ?? "Worker has not claimed this queued job within 10 seconds." : warning
    };
  }
  return {
    state: current ? "busy" : "active",
    activeCount: workerStatus?.activeWorkerCount ?? 0,
    currentJob: current ?? null,
    warning
  };
}

function busyJob(workerStatus: WorkerQueueStatus) {
  const heartbeatJob = workerStatus.activeWorkers.find((worker) => worker.currentJobId);
  if (heartbeatJob?.currentJobId && heartbeatJob.currentJobKind) {
    return {
      id: heartbeatJob.currentJobId,
      kind: heartbeatJob.currentJobKind,
      lockedBy: heartbeatJob.workerId
    };
  }
  const running = workerStatus.runningJobs[0];
  return running
    ? {
        id: running.id,
        kind: running.kind,
        lockedBy: running.lockedBy,
        lockedAt: running.lockedAt,
        elapsedSeconds: running.elapsedSeconds
      }
    : null;
}

function failureForJob(job: JobRecord): { errorCode: IntakeJobFailureCode | null; failureReason: string | null } {
  if (job.status !== "failed") return { errorCode: null, failureReason: null };
  const detail = generationFailureFromJobResult(job.result);
  if (detail) {
    return {
      errorCode: classifyFailureCode(detail.code),
      failureReason: detail.message
    };
  }
  const message = job.error ?? "Candidate failed.";
  return {
    errorCode: classifyFailure(message),
    failureReason: message
  };
}

function classifyFailureCode(code: string): IntakeJobFailureCode {
  if (code === "invalid_url") return "invalid_url";
  if (code === "unsupported_launch_market") return "out_of_market";
  if (code === "precompile_generation_block") return "data_incomplete";
  if (code.includes("qa") || code.includes("render")) return "render_failed";
  return "generation_crash";
}

function classifyFailure(message: string): IntakeJobFailureCode {
  const value = message.toLowerCase();
  if (value.includes("url") || value.includes("hostname") || value.includes("crawl jobs") || value.includes("public website")) {
    return "invalid_url";
  }
  if (value.includes("us-only") || value.includes("launch intake")) return "out_of_market";
  if (value.includes("identity") || value.includes("name conflict") || value.includes("phone conflict")) return "identity_conflict";
  if (value.includes("missing") || value.includes("data_incomplete") || value.includes("address")) return "data_incomplete";
  if (value.includes("render") || value.includes("screenshot") || value.includes("browser")) return "render_failed";
  return "generation_crash";
}

function stringResult(result: JobRecord["result"], key: string) {
  const value = result?.[key];
  return typeof value === "string" && value ? value : null;
}
