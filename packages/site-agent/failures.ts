import type {
  SiteAgentFailureCategory,
  SiteAgentFailureCode
} from "@/packages/site-contracts";

export class SiteAuthoringTerminalError extends Error {
  readonly name = "SiteAuthoringTerminalError";

  constructor(
    readonly code: SiteAgentFailureCode,
    readonly category: SiteAgentFailureCategory,
    readonly retryableByOwner: boolean,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

export function isSiteAuthoringTerminalError(error: unknown): error is SiteAuthoringTerminalError {
  return error instanceof SiteAuthoringTerminalError;
}

export function classifySiteAuthoringFailure(error: unknown) {
  if (isSiteAuthoringTerminalError(error)) {
    return {
      code: error.code,
      category: error.category,
      retryableByOwner: error.retryableByOwner,
      message: boundedFailureMessage(error)
    };
  }
  const message = boundedFailureMessage(error);
  if (/manager_cost_limit_exhausted|cost_limit_exhausted/i.test(message)) {
    return failure("cost_limit_exhausted", "budget", false, message);
  }
  if (/cost_telemetry_unavailable/i.test(message)) {
    return failure("cost_telemetry_unavailable", "platform", false, message);
  }
  if (/browser_verification_unavailable/i.test(message)) {
    return failure("browser_verification_unavailable", "platform", true, message);
  }
  if (/source_preparation_failed|source_preparation_deadline_exhausted/i.test(message)) {
    return failure("source_preparation_failed", "platform", true, message);
  }
  if (/sandbox_destroy_retry_required/i.test(message)) {
    return failure("sandbox_unavailable", "platform", true, message);
  }
  if (/Development sandbox (?:configuration|source) changed|Development sandbox receipt (?:has a stale manifest|is malformed)|Site sandbox manifest is stale|sandbox manifest does not match/i.test(message)) {
    return failure("platform_version_mismatch", "platform", false, message);
  }
  if (/Development sandbox (?:is not deployed|credentials are (?:missing|malformed)|URL must)|Cloudflare Sandbox requires/i.test(message)) {
    return failure("sandbox_unavailable", "platform", false, message);
  }
  if (/workspace_uninitialized|sandbox.*uninitialized|revision.*uninitialized/i.test(message)) {
    return failure("sandbox_unavailable", "platform", false, message);
  }
  if (/authoring_stalled/i.test(message)) {
    return failure("authoring_stalled", "authoring", false, message);
  }
  if (/context_capacity_exhausted|context_length_exceeded|maximum context length|max_context_length|context window.*(?:exceed|limit|maximum)/i.test(message)) {
    return failure("context_capacity_exhausted", "provider", false, message);
  }
  if (/manager_model_incomplete:max_output_tokens/i.test(message)) {
    return failure("output_budget_exhausted", "budget", false, message);
  }
  if (/workflow_deadline_exhausted|deadline_exhausted/i.test(message)) {
    return failure("deadline_exhausted", "budget", false, message);
  }
  if (/fetch failed|network|timeout|timed out|econnreset|socket hang up|temporarily unavailable/i.test(message)) {
    return failure("unknown_internal_failure", "platform", true, message);
  }
  if (/duplicate key value violates unique constraint|foreign key constraint|serialization failure|deadlock detected/i.test(message)) {
    return failure("unknown_internal_failure", "platform", true, message);
  }
  return failure("unknown_internal_failure", "platform", false, message);
}

export function classifyModelProviderError(error: unknown): SiteAuthoringTerminalError {
  const message = boundedFailureMessage(error);
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const providerCode = String(nested.code ?? record.code ?? "");
  const status = typeof record.status === "number" ? record.status : undefined;
  const providerFailure = `${providerCode} ${message}`;
  if (
    (status === 400 || status === undefined)
    && /context_length_exceeded|maximum context length|max_context_length|context window.*(?:exceed|limit|maximum)|too many tokens.*context/i.test(providerFailure)
  ) {
    return new SiteAuthoringTerminalError("context_capacity_exhausted", "provider", false, message, { cause: error });
  }
  if (/manager_model_incomplete:max_output_tokens/i.test(message)) {
    return new SiteAuthoringTerminalError("output_budget_exhausted", "budget", false, message, { cause: error });
  }
  if (
    (status === 400 || status === undefined)
    && /Invalid schema for function|invalid (?:strict )?(?:function|tool) schema|schema for function.+(?:not a valid format|unsupported)/i.test(providerFailure)
  ) {
    return new SiteAuthoringTerminalError("model_tool_schema_invalid", "platform", false, message, { cause: error });
  }
  if (status === 402 || /insufficient_quota|quota_exceeded|billing_hard_limit|insufficient_credits/i.test(`${providerCode} ${message}`)) {
    return new SiteAuthoringTerminalError("provider_quota_exhausted", "provider", false, message, { cause: error });
  }
  if (status === 429 || (status !== undefined && status >= 500) || /rate.?limit|timeout|timed out|connection|socket|network/i.test(message)) {
    return new SiteAuthoringTerminalError("provider_temporarily_unavailable", "provider", true, message, { cause: error });
  }
  return new SiteAuthoringTerminalError("unknown_internal_failure", "provider", false, message, { cause: error });
}

export function boundedFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 2000 ? message : `${message.slice(0, 1980)}... [truncated]`;
}

function failure(
  code: SiteAgentFailureCode,
  category: SiteAgentFailureCategory,
  retryableByOwner: boolean,
  message: string
) {
  return { code, category, retryableByOwner, message };
}
