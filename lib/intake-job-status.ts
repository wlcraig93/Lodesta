import type { JobRecord, SiteCandidateRecord, SiteVersion } from "./models";

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
    runId: string | null;
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
    state: "active" | "not_processing";
    staleAfterSeconds: number;
  };
};

export const intakeJobStaleAfterSeconds = 900;

export function intakeJobStatusResponse(input: {
  job: JobRecord;
  candidate?: SiteCandidateRecord | null;
  origin: string;
  now?: number;
}): IntakeJobStatusResponse {
  const runId = stringResult(input.job.result, "runId");
  const error = failureForJob(input.job);
  return {
    ok: true,
    job: {
      id: input.job.id,
      status: input.job.status,
      attempts: input.job.attempts,
      errorCode: error.errorCode,
      failureReason: error.failureReason,
      runId,
      createdAt: input.job.createdAt,
      updatedAt: input.job.updatedAt,
      startedAt: input.job.startedAt ?? null,
      completedAt: input.job.completedAt ?? null
    },
    candidate: input.candidate ? candidateSummary(input.candidate, input.origin) : null,
    worker: {
      state: workerState(input.job, input.now ?? Date.now()),
      staleAfterSeconds: intakeJobStaleAfterSeconds
    }
  };
}

export function siteCandidateIdForJob(job: JobRecord) {
  return stringResult(job.result, "siteCandidateId");
}

function candidateSummary(candidate: SiteCandidateRecord, origin: string): NonNullable<IntakeJobStatusResponse["candidate"]> {
  const version = candidate.bundle.siteModel.versions[0];
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

function workerState(job: JobRecord, now: number): IntakeJobStatusResponse["worker"]["state"] {
  if (job.status !== "queued") return "active";
  const reference = Date.parse(job.runAfter || job.updatedAt || job.createdAt);
  if (!Number.isFinite(reference)) return "active";
  return now - reference > intakeJobStaleAfterSeconds * 1000 ? "not_processing" : "active";
}

function failureForJob(job: JobRecord): { errorCode: IntakeJobFailureCode | null; failureReason: string | null } {
  if (job.status !== "failed") return { errorCode: null, failureReason: null };
  const message = job.error ?? "Candidate failed.";
  return {
    errorCode: classifyFailure(message),
    failureReason: message
  };
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
