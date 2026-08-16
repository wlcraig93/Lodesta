import { sitePublicBuildInputSchema, type SitePublicBuildInput } from "@/packages/site-contracts";
import { agentAuthoredArtifactSchema, normalizeAgentAuthoredArtifact, type AgentAuthoredArtifact } from "@/packages/site-verification";
import { assertWorkspaceSourcePolicy } from "@/packages/site-agent/source-policy";
import { configuredSiteSandboxRuntimeForDeployment } from "./runtime-config";
import type { SiteSandboxDeployment } from "@/packages/site-contracts";

export type WorkspaceSourceFile = { path: string; content: string };

const sandboxRequestTimeoutMs = 150_000;
const sandboxBuildRequestTimeoutMs = 210_000;
const sandboxOperationSubmitTimeoutMs = 30_000;
const sandboxOperationStatusTimeoutMs = 10_000;
const sandboxOperationPollIntervalMs = 500;
const sandboxOperationReplayDelayMs = 250;

type SandboxBuildSuccess = {
  ok: true;
  revision: string;
  previewUrl: string;
  buildDurationMs: number;
  placementId: string;
  operationId: string;
  activeGenerationRevision: string;
  replayed?: boolean;
  submissionAttempts?: 1 | 2;
  submissionLatencyMs?: number;
  submissionPayloadBytes?: number;
  submissionRecoveryCause?: string;
  phaseTimings: Record<string, number>;
  warnings?: string[];
};

type SandboxOperationStatus = {
  ok: boolean;
  operationId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  phase: "queued" | "preparing" | "validating" | "compiling" | "promoting" | "complete";
  createdAt: string;
  updatedAt: string;
  phaseStartedAt: string;
  timestamps: Record<string, string>;
  phaseTimings: Record<string, number>;
  result?: SandboxBuildSuccess;
  failure?: {
    status: number;
    payload: { error?: string; detail?: string; stdout?: string; stderr?: string; currentRevision?: string };
  };
  submissionReplayed?: boolean;
};

export class SiteSandboxRequestError extends Error {
  readonly name = "SiteSandboxRequestError";

  constructor(
    readonly action: string,
    readonly sessionId: string,
    readonly status: number,
    readonly providerCode: string | undefined,
    diagnostics: string
  ) {
    super(`${action} failed (${status}): ${providerCode ?? "unknown"}${diagnostics ? `:\n${diagnostics}` : ""}`);
  }
}

export class SiteSandboxArtifactContractError extends Error {
  readonly name = "SiteSandboxArtifactContractError";

  constructor(readonly diagnostics: string) {
    super(`Sandbox artifact contract is invalid: ${diagnostics}`);
  }
}

export function isConfirmedSandboxAbsent(error: unknown) {
  return error instanceof SiteSandboxRequestError
    && error.status === 404
    && (error.providerCode === "session_not_found" || error.providerCode === "sandbox_not_found");
}

export function isUninitializedSandboxRevision(error: unknown) {
  return error instanceof SiteSandboxRequestError
    && error.status === 409
    && (
      error.providerCode === "workspace_uninitialized"
      || (
        error.providerCode === "revision_conflict"
        && /currentRevision=uninitialized/i.test(error.message)
      )
    );
}

export class SiteSandboxClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly beforeRequest?: () => Promise<unknown>
  ) {
    if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://127.0.0.1")) {
      throw new Error("Sandbox bridge must use HTTPS outside local development.");
    }
    if (!token) throw new Error("Sandbox bridge token is required.");
  }

  async bootstrap(sessionId: string, buildInput: SitePublicBuildInput) {
    const value = sitePublicBuildInputSchema.parse(buildInput);
    return this.call<{ ok: true; revision: string }>(sessionId, "bootstrap", "POST", { publicBuildInput: value });
  }

  async apply(sessionId: string, expectedRevision: string, files: WorkspaceSourceFile[]) {
    assertWorkspaceSourcePolicy(files);
    return this.submitAndPoll(sessionId, "apply", { expectedRevision, files });
  }

  async rebase(sessionId: string, expectedRevision: string, buildInput: SitePublicBuildInput) {
    const value = sitePublicBuildInputSchema.parse(buildInput);
    return this.submitAndPoll(sessionId, "rebase", { expectedRevision, publicBuildInput: value });
  }

  async getArtifact(sessionId: string): Promise<AgentAuthoredArtifact> {
    const artifact = await this.call<unknown>(sessionId, "artifact", "GET");
    const parsed = agentAuthoredArtifactSchema.safeParse(normalizeAgentAuthoredArtifact(artifact));
    if (!parsed.success) {
      throw new SiteSandboxArtifactContractError(parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "artifact"}: ${issue.message}`)
        .join("; ")
        .slice(0, 4000));
    }
    return parsed.data;
  }

  async getSource(sessionId: string) {
    return this.call<{ ok: true; revision: string; files: WorkspaceSourceFile[] }>(sessionId, "source", "GET");
  }

  async backup(sessionId: string) {
    return this.call<{ ok: true; backup: { id: string; revision: string; size: number; key: string; contentHash: `sha256:${string}` } }>(sessionId, "backup", "POST");
  }

  async restore(sessionId: string, backupId: string, expectedRevision: string, expectedArchiveHash: `sha256:${string}`) {
    return this.submitAndPoll(sessionId, "restore", { backupId, expectedRevision, expectedArchiveHash });
  }

  async diagnostics(sessionId: string) {
    return this.call<{
      ok: boolean;
      revision: string;
      versions: string[];
      sandboxManifest: {
        kind: "site-sandbox-manifest";
        apiIdentity: string;
        storageIdentity: string;
        durableObjectIdentity: string;
        artifactContractIdentity: string;
        toolchainIdentity: string;
        sourcePolicyIdentity: string;
      };
      placementId: string;
      activeGeneration?: {
        schemaVersion: 1;
        revision: string;
        sourceHash: string;
        publicInputHash: string;
        operationId: string;
        status: "initialized" | "built";
        createdAt: string;
      };
      activeGenerationTarget?: string;
      mutationLock?: { operationId?: string; startedAt?: string };
      activeOperation?: SandboxOperationStatus;
      processes: Array<{ id: string; command: string; status: string }>;
    }>(sessionId, "diagnostics", "GET");
  }

  async destroy(sessionId: string) {
    return this.call<{ ok: true }>(sessionId, "destroy", "POST");
  }

  previewUrl(sessionId: string, route = "/") {
    return `${this.baseUrl.replace(/\/$/, "")}/v1/sessions/${encodeURIComponent(sessionId)}/preview${route.startsWith("/") ? route : `/${route}`}`;
  }

  async fetchPreview(sessionId: string, route = "/") {
    if (!/^[a-z0-9_-]{1,80}$/.test(sessionId)) throw new Error("Sandbox session ID is invalid.");
    await this.beforeRequest?.();
    return fetch(this.previewUrl(sessionId, route), {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(sandboxRequestTimeoutMs)
    });
  }

  private async submitAndPoll(
    sessionId: string,
    action: "apply" | "rebase" | "restore",
    body: unknown
  ): Promise<SandboxBuildSuccess> {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    const submissionStartedAt = Date.now();
    let submissionAttempts: 1 | 2 = 1;
    let submissionRecoveryCause: string | undefined;
    let submitted: SandboxBuildSuccess | SandboxOperationStatus;
    try {
      submitted = await this.call<SandboxBuildSuccess | SandboxOperationStatus>(
        sessionId,
        action,
        "POST",
        body,
        sandboxOperationSubmitTimeoutMs
      );
    } catch (error) {
      if (!isRetryableOperationSubmission(error)) throw error;
      submissionAttempts = 2;
      submissionRecoveryCause = sanitizedSubmissionCause(error);
      if (error instanceof SiteSandboxRequestError && error.providerCode === "operation_in_progress") {
        await wait(sandboxOperationReplayDelayMs);
      }
      submitted = await this.call<SandboxBuildSuccess | SandboxOperationStatus>(
        sessionId,
        action,
        "POST",
        body,
        sandboxOperationSubmitTimeoutMs
      );
    }
    const submissionTelemetry = {
      submissionAttempts,
      submissionLatencyMs: Date.now() - submissionStartedAt,
      submissionPayloadBytes: payloadBytes,
      ...(submissionRecoveryCause ? { submissionRecoveryCause } : {})
    };
    if ("revision" in submitted) return { ...submitted, ...submissionTelemetry };
    const submissionReplayed = submissionAttempts === 2 || Boolean(submitted.submissionReplayed);
    const deadline = Date.now() + sandboxBuildRequestTimeoutMs;
    let lastStatus = submitted;
    while (Date.now() < deadline) {
      if (lastStatus.status === "succeeded" && lastStatus.result) {
        return submissionReplayed
          ? { ...lastStatus.result, replayed: true, ...submissionTelemetry }
          : { ...lastStatus.result, ...submissionTelemetry };
      }
      if (lastStatus.status === "failed") throw operationFailure(action, sessionId, lastStatus);
      await wait(Math.min(sandboxOperationPollIntervalMs, Math.max(0, deadline - Date.now())));
      try {
        lastStatus = await this.call<SandboxOperationStatus>(
          sessionId,
          `operations/${submitted.operationId}`,
          "GET",
          undefined,
          sandboxOperationStatusTimeoutMs
        );
      } catch (error) {
        if (error instanceof SiteSandboxRequestError && error.status < 500 && error.status !== 404) throw error;
        if (Date.now() >= deadline) break;
      }
    }
    throw new SiteSandboxRequestError(
      action,
      sessionId,
      504,
      "operation_status_timeout",
      `operationId=${submitted.operationId}\nlastPhase=${lastStatus.phase}\nlastUpdatedAt=${lastStatus.updatedAt}`
    );
  }

  private async call<T>(sessionId: string, action: string, method: "GET" | "POST", body?: unknown, timeoutMs = sandboxRequestTimeoutMs): Promise<T> {
    if (!/^[a-z0-9_-]{1,80}$/.test(sessionId)) throw new Error("Sandbox session ID is invalid.");
    await this.beforeRequest?.();
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/sessions/${sessionId}/${action}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    const payload = await response.json().catch(() => undefined) as (T & { error?: string; detail?: string; stdout?: string; stderr?: string; currentRevision?: string }) | undefined;
    if (!response.ok) {
      const diagnostics = [
        payload?.currentRevision ? `currentRevision=${payload.currentRevision}` : undefined,
        payload?.detail,
        payload?.stderr,
        payload?.stdout
      ].filter(Boolean).join("\n").slice(-12_000);
      throw new SiteSandboxRequestError(action, sessionId, response.status, payload?.error, diagnostics);
    }
    return payload as T;
  }
}

function isRetryableOperationSubmission(error: unknown) {
  if (error instanceof SiteSandboxRequestError) {
    return error.providerCode === "operation_in_progress"
      || error.status === 408
      || error.status >= 500;
  }
  const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /(?:abort|fetch failed|network|timeout|timed out|econnreset|socket hang up|temporarily unavailable)/i.test(value);
}

function sanitizedSubmissionCause(error: unknown) {
  if (error instanceof SiteSandboxRequestError) return error.providerCode ?? `http_${error.status}`;
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "transport_failure";
}

function operationFailure(action: string, sessionId: string, status: SandboxOperationStatus) {
  const failure = status.failure;
  const payload = failure?.payload;
  return new SiteSandboxRequestError(
    action,
    sessionId,
    failure?.status ?? 500,
    payload?.error ?? "sandbox_operation_failed",
    [
      `operationId=${status.operationId}`,
      `phase=${status.phase}`,
      payload?.currentRevision ? `currentRevision=${payload.currentRevision}` : undefined,
      payload?.detail,
      payload?.stderr,
      payload?.stdout
    ].filter(Boolean).join("\n").slice(-12_000)
  );
}

function wait(durationMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

export function configuredSiteSandboxClient(): SiteSandboxClient {
  throw new Error("Sandbox access requires an immutable pinned deployment.");
}

export function configuredSiteSandboxClientForDeployment(deployment: SiteSandboxDeployment) {
  const runtime = configuredSiteSandboxRuntimeForDeployment(deployment);
  return new SiteSandboxClient(
    runtime.url,
    runtime.token,
    async () => configuredSiteSandboxRuntimeForDeployment(deployment)
  );
}
