import assert from "node:assert/strict";
import { basename } from "node:path";
import {
  expectedSiteSandboxManifest,
  siteSandboxManifestSchema,
  type SiteSandboxManifest
} from "../packages/site-contracts";
import {
  configuredSiteSandboxRuntimeForSlot,
  SiteSandboxClient,
  type SandboxDiagnostics
} from "../packages/site-sandbox";

export type SiteSandboxReadinessClient = {
  diagnostics(sessionId: string, timeoutMs?: number): Promise<SandboxDiagnostics>;
  destroy(sessionId: string): Promise<{ ok: true }>;
};

export async function probeSiteSandboxContainerReadiness(
  sandbox: SiteSandboxReadinessClient,
  sessionId: string,
  expectedManifest: SiteSandboxManifest,
  timeoutMs = 45_000
) {
  let diagnosticError: unknown;
  try {
    const diagnostics = await sandbox.diagnostics(sessionId, timeoutMs);
    // The fresh probe has no workspace yet, so its aggregate `ok` may be false.
    // Reading this manifest still requires the candidate container to answer.
    assert.deepEqual(
      diagnostics.sandboxManifest,
      expectedManifest,
      "The serving sandbox container manifest does not match the candidate checkout."
    );
    return {
      ok: true as const,
      provider: "cloudflare-sandbox" as const,
      observation: "container_manifest_read",
      sandboxManifest: diagnostics.sandboxManifest,
      placementId: diagnostics.placementId ?? null,
      observedAt: new Date().toISOString()
    };
  } catch (error) {
    diagnosticError = error;
    throw error;
  } finally {
    try {
      await sandbox.destroy(sessionId);
    } catch (cleanupError) {
      if (!diagnosticError) throw cleanupError;
      throw new AggregateError(
        [diagnosticError, cleanupError],
        "Sandbox container readiness probe and cleanup both failed."
      );
    }
  }
}

if (basename(process.argv[1] ?? "") === "probe-site-sandbox-container-readiness.ts") {
  const slot = process.env.LODESTA_SANDBOX_READINESS_SLOT?.trim();
  assert(slot === "blue" || slot === "green", "LODESTA_SANDBOX_READINESS_SLOT must be blue or green.");
  const sessionId = process.env.LODESTA_SANDBOX_READINESS_SESSION_ID?.trim();
  assert(sessionId && /^[a-z0-9_-]{1,80}$/.test(sessionId), "LODESTA_SANDBOX_READINESS_SESSION_ID is invalid.");
  const expectedManifestSource = process.env.LODESTA_EXPECTED_SANDBOX_MANIFEST_JSON;
  const expectedManifest = expectedManifestSource
    ? siteSandboxManifestSchema.parse(JSON.parse(expectedManifestSource))
    : expectedSiteSandboxManifest;
  const timeoutSource = process.env.LODESTA_SANDBOX_READINESS_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutSource ? Number(timeoutSource) : 45_000;
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000,
    "LODESTA_SANDBOX_READINESS_TIMEOUT_MS must be an integer between 1 and 120000.");
  const runtime = configuredSiteSandboxRuntimeForSlot(slot);
  const result = await probeSiteSandboxContainerReadiness(
    new SiteSandboxClient(runtime.url, runtime.token),
    sessionId,
    expectedManifest,
    timeoutMs
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
