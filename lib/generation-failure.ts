import type { GenerationQaBlocker } from "./models";

export type GenerationFailureStage =
  | "queued"
  | "crawl"
  | "precompile_gate"
  | "asset_analysis"
  | "planner"
  | "copy"
  | "compile"
  | "qa";

export type GenerationFailureCode =
  | "unknown_generation_failure"
  | "invalid_url"
  | "unsupported_launch_market"
  | "crawl_failed"
  | "precompile_generation_block"
  | "asset_analysis_unavailable"
  | "planner_unavailable"
  | "director_invalid_json"
  | "director_validation_failed"
  | "copy_unavailable"
  | "copy_http_error"
  | "copy_incomplete_response"
  | "copy_timeout"
  | "copy_refusal"
  | "copy_invalid_json"
  | "copy_validation_failed"
  | "copy_lint_rejected"
  | "copy_empty_output"
  | "compile_failed"
  | "qa_failed";

export type GenerationFailureDetail = {
  stage: GenerationFailureStage;
  code: GenerationFailureCode | string;
  message: string;
  jobId?: string;
  runId?: string;
  siteCandidateId?: string;
  validationIssues?: unknown[];
  blockers?: GenerationQaBlocker[];
  artifactRefs?: Record<string, unknown>;
};

export class GenerationFailureError extends Error {
  readonly detail: GenerationFailureDetail;

  constructor(detail: GenerationFailureDetail, options?: ErrorOptions) {
    super(detail.message, options);
    this.name = "GenerationFailureError";
    this.detail = detail;
  }
}

export function generationFailure(
  error: unknown,
  defaults: Omit<GenerationFailureDetail, "message" | "code"> & {
    code: GenerationFailureDetail["code"];
    message?: string;
    validationIssues?: unknown[];
    blockers?: GenerationQaBlocker[];
    artifactRefs?: Record<string, unknown>;
  }
): GenerationFailureError {
  if (error instanceof GenerationFailureError) {
    return mergeGenerationFailure(error, defaults);
  }
  return new GenerationFailureError({
    ...defaults,
    message: defaults.message ?? errorMessage(error),
    validationIssues: defaults.validationIssues,
    blockers: defaults.blockers,
    artifactRefs: defaults.artifactRefs
  }, error instanceof Error ? { cause: error } : undefined);
}

export function mergeGenerationFailure(
  error: GenerationFailureError,
  defaults: Partial<Omit<GenerationFailureDetail, "message">>
): GenerationFailureError {
  return new GenerationFailureError(
    {
      ...definedObject(defaults),
      ...error.detail,
      jobId: error.detail.jobId ?? defaults.jobId,
      runId: error.detail.runId ?? defaults.runId,
      siteCandidateId: error.detail.siteCandidateId ?? defaults.siteCandidateId,
      validationIssues: error.detail.validationIssues ?? defaults.validationIssues,
      blockers: error.detail.blockers ?? defaults.blockers,
      artifactRefs: error.detail.artifactRefs ?? defaults.artifactRefs
    },
    { cause: error.cause ?? error }
  );
}

export function generationFailureDetail(
  error: unknown,
  defaults: Pick<GenerationFailureDetail, "stage" | "code"> & Partial<GenerationFailureDetail>
): GenerationFailureDetail {
  if (error instanceof GenerationFailureError) {
    return {
      ...definedObject(defaults),
      ...error.detail,
      jobId: error.detail.jobId ?? defaults.jobId,
      runId: error.detail.runId ?? defaults.runId,
      siteCandidateId: error.detail.siteCandidateId ?? defaults.siteCandidateId,
      validationIssues: error.detail.validationIssues ?? defaults.validationIssues,
      blockers: error.detail.blockers ?? defaults.blockers,
      artifactRefs: error.detail.artifactRefs ?? defaults.artifactRefs
    };
  }
  return {
    stage: defaults.stage,
    code: defaults.code,
    message: defaults.message ?? errorMessage(error),
    jobId: defaults.jobId,
    runId: defaults.runId,
    siteCandidateId: defaults.siteCandidateId,
    validationIssues: defaults.validationIssues,
    blockers: defaults.blockers,
    artifactRefs: defaults.artifactRefs
  };
}

export function isGenerationFailureError(error: unknown): error is GenerationFailureError {
  return error instanceof GenerationFailureError;
}

export function generationFailureFromUnknown(error: unknown): GenerationFailureDetail | undefined {
  if (error instanceof GenerationFailureError) return error.detail;
  if (!isRecord(error)) return undefined;
  const detail = error.generationFailureDetail;
  if (!isRecord(detail)) return undefined;
  if (typeof detail.stage !== "string" || typeof detail.code !== "string" || typeof detail.message !== "string") {
    return undefined;
  }
  return detail as GenerationFailureDetail;
}

export function generationFailureFromJobResult(result: Record<string, unknown> | undefined): GenerationFailureDetail | undefined {
  const detail = result?.generationFailureDetail;
  if (!isRecord(detail)) return undefined;
  if (typeof detail.stage !== "string" || typeof detail.code !== "string" || typeof detail.message !== "string") {
    return undefined;
  }
  return detail as GenerationFailureDetail;
}

export function serializeGenerationFailure(detail: GenerationFailureDetail): GenerationFailureDetail {
  return {
    stage: detail.stage,
    code: detail.code,
    message: detail.message,
    jobId: detail.jobId,
    runId: detail.runId,
    siteCandidateId: detail.siteCandidateId,
    validationIssues: detail.validationIssues,
    blockers: detail.blockers,
    artifactRefs: detail.artifactRefs
  };
}

export function isDeterministicGenerationFailure(detail: GenerationFailureDetail | undefined) {
  if (!detail) return false;
  return new Set([
    "invalid_url",
    "unsupported_launch_market",
    "precompile_generation_block",
    "director_validation_failed",
    "copy_validation_failed",
    "copy_lint_rejected"
  ]).has(detail.code);
}

export function isRetryableGenerationFailure(detail: GenerationFailureDetail | undefined) {
  if (!detail) return true;
  if (isDeterministicGenerationFailure(detail)) return false;
  return new Set([
    "crawl_failed",
    "asset_analysis_unavailable",
    "planner_unavailable",
    "copy_unavailable",
    "copy_http_error",
    "copy_incomplete_response",
    "copy_timeout",
    "copy_refusal",
    "copy_invalid_json",
    "copy_empty_output",
    "compile_failed",
    "qa_failed",
    "unknown_generation_failure"
  ]).has(detail.code);
}

export function isRetryableTransientGenerationError(error: unknown) {
  const detail = generationFailureFromUnknown(error);
  if (detail) return isRetryableGenerationFailure(detail);
  const message = errorMessage(error).toLowerCase();
  return [
    "abort",
    "aborted",
    "timeout",
    "timed out",
    "fetch failed",
    "network",
    "econnreset",
    "etimedout",
    "eai_again",
    "429",
    "rate limit",
    "500",
    "502",
    "503",
    "504",
    "overloaded"
  ].some((needle) => message.includes(needle));
}

function definedObject<T extends Record<string, unknown>>(value: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
