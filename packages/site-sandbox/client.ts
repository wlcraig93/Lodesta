import type { SitePublicBuildInput } from "@/packages/site-contracts";
import type { AgentAuthoredArtifact } from "@/packages/site-verification";

export type WorkspaceSourceFile = { path: string; content: string };

export type SandboxBuildSuccess = {
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

export type SandboxOperationStatus = {
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

export type SandboxOperationPollDiagnostic = {
  operationId: string;
  lastJournal: Pick<SandboxOperationStatus,
    "status" | "phase" | "createdAt" | "updatedAt" | "phaseStartedAt" | "timestamps" | "phaseTimings">;
  pollAttempts: number;
  journalResponses: number;
  transportErrors: number;
  httpErrors: number;
  lastPollError?: {
    kind: "transport" | "http";
    name?: string;
    status?: number;
    providerCode?: string;
  };
};

export type SandboxDiagnostics = {
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
};

export interface AuthoringSandbox {
  provision?: () => Promise<string>;
  bootstrap(sessionId: string, buildInput: SitePublicBuildInput): Promise<{ ok: true; revision: string }>;
  apply(sessionId: string, expectedRevision: string, files: WorkspaceSourceFile[]): Promise<SandboxBuildSuccess>;
  rebase(sessionId: string, expectedRevision: string, buildInput: SitePublicBuildInput): Promise<SandboxBuildSuccess>;
  getArtifact(sessionId: string): Promise<AgentAuthoredArtifact>;
  getSource(sessionId: string): Promise<{ ok: true; revision: string; files: WorkspaceSourceFile[] }>;
  backup(sessionId: string): Promise<{ ok: true; backup: { id: string; revision: string; size: number; key: string; contentHash: `sha256:${string}` } }>;
  restore(sessionId: string, backupId: string, expectedRevision: string, expectedArchiveHash: `sha256:${string}`): Promise<SandboxBuildSuccess>;
  diagnostics(sessionId: string, timeoutMs?: number): Promise<SandboxDiagnostics>;
  destroy(sessionId: string): Promise<{ ok: true }>;
  fetchPreview(sessionId: string, route?: string): Promise<Response>;
}

export class SiteSandboxRequestError extends Error {
  readonly name = "SiteSandboxRequestError";

  constructor(
    readonly action: string,
    readonly sessionId: string,
    readonly status: number,
    readonly providerCode: string | undefined,
    diagnostics: string,
    readonly operationPollDiagnostic?: SandboxOperationPollDiagnostic,
    readonly transportCause?: string
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
