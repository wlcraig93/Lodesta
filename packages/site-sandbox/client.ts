import { sitePublicBuildInputV3Schema, type SitePublicBuildInputV3 } from "@/packages/site-contracts";
import { agentAuthoredArtifactSchema, normalizeAgentAuthoredArtifact, type AgentAuthoredArtifactV1 } from "@/packages/site-verification";
import { assertWorkspaceSourcePolicy } from "@/packages/site-agent/source-policy";

export type WorkspaceSourceFile = { path: string; content: string };

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

export function isConfirmedSandboxAbsent(error: unknown) {
  return error instanceof SiteSandboxRequestError
    && error.status === 404
    && (error.providerCode === "session_not_found" || error.providerCode === "sandbox_not_found");
}

export class SiteSandboxClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {
    if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://127.0.0.1")) {
      throw new Error("Sandbox bridge must use HTTPS outside local development.");
    }
    if (!token) throw new Error("Sandbox bridge token is required.");
  }

  async bootstrap(sessionId: string, buildInput: SitePublicBuildInputV3) {
    const value = sitePublicBuildInputV3Schema.parse(buildInput);
    return this.call<{ ok: true; revision: string }>(sessionId, "bootstrap", "POST", { publicBuildInput: value });
  }

  async apply(sessionId: string, expectedRevision: string, files: WorkspaceSourceFile[]) {
    assertWorkspaceSourcePolicy(files);
    return this.call<{
      ok: true;
      revision: string;
      previewUrl: string;
      buildDurationMs: number;
      placementId: string;
    }>(sessionId, "apply", "POST", { expectedRevision, files });
  }

  async rebase(sessionId: string, expectedRevision: string, buildInput: SitePublicBuildInputV3) {
    const value = sitePublicBuildInputV3Schema.parse(buildInput);
    return this.call<{
      ok: true;
      revision: string;
      previewUrl: string;
      buildDurationMs: number;
      placementId: string;
    }>(sessionId, "rebase", "POST", { expectedRevision, publicBuildInput: value });
  }

  async getArtifact(sessionId: string): Promise<AgentAuthoredArtifactV1> {
    const artifact = await this.call<unknown>(sessionId, "artifact", "GET");
    return agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact(artifact));
  }

  async getSource(sessionId: string) {
    return this.call<{ ok: true; revision: string; files: WorkspaceSourceFile[] }>(sessionId, "source", "GET");
  }

  async backup(sessionId: string) {
    return this.call<{ ok: true; backup: { id: string; revision: string; size: number; key: string; contentHash: `sha256:${string}` } }>(sessionId, "backup", "POST");
  }

  async restore(sessionId: string, backupId: string, expectedRevision: string, expectedArchiveHash: `sha256:${string}`) {
    return this.call<{ ok: true; revision: string }>(sessionId, "restore", "POST", { backupId, expectedRevision, expectedArchiveHash });
  }

  async diagnostics(sessionId: string) {
    return this.call<{
      ok: boolean;
      revision: string;
      versions: string[];
      placementId: string;
      lodestaVersions: {
        platform: string;
        toolchain: string;
        managerPrompt: string;
        claimPolicy: string;
        sourcePolicy: string;
        sandboxImageDigest: `sha256:${string}`;
      };
      processes: Array<{ id: string; command: string; status: string }>;
    }>(sessionId, "diagnostics", "GET");
  }

  async destroy(sessionId: string) {
    return this.call<{ ok: true }>(sessionId, "destroy", "POST");
  }

  previewUrl(sessionId: string, route = "/") {
    return `${this.baseUrl.replace(/\/$/, "")}/v1/sessions/${encodeURIComponent(sessionId)}/preview${route.startsWith("/") ? route : `/${route}`}`;
  }

  private async call<T>(sessionId: string, action: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    if (!/^[a-z0-9-]{1,80}$/.test(sessionId)) throw new Error("Sandbox session ID is invalid.");
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/sessions/${sessionId}/${action}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
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

export function configuredSiteSandboxClient() {
  const url = process.env.LODESTA_SANDBOX_URL;
  const token = process.env.LODESTA_SANDBOX_TOKEN;
  if (!url || !token) throw new Error("Cloudflare Sandbox requires LODESTA_SANDBOX_URL and LODESTA_SANDBOX_TOKEN.");
  return new SiteSandboxClient(url, token);
}
