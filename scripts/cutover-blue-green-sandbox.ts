import "./load-env";

import assert from "node:assert/strict";
import { sitePlatformRepository } from "../packages/platform-data";
import { SiteSandboxClient, configuredSiteSandboxRuntimeForSlot } from "../packages/site-sandbox";
import { sha256, stableJson } from "../packages/business-data";
import { siteAgentSessionSchema } from "../packages/site-contracts";

const mode = process.argv[2];
assert(mode === "report" || mode === "apply", "Use report or apply.");
const report = await buildReport();
const confirmation = `cancel-legacy-sandbox-pauses:${report.reportHash}`;

if (mode === "report") {
  process.stdout.write(`${JSON.stringify({ ...report, confirmation }, null, 2)}\n`);
} else {
  const supplied = process.argv.find((argument) => argument.startsWith("--confirm="))?.slice("--confirm=".length);
  assert.equal(supplied, confirmation, `Pass --confirm=${confirmation} after reviewing the report.`);
  assert(await sitePlatformRepository.isMaintenanceLeaseActive("site_authoring_maintenance", new Date().toISOString()), "The cutover requires the draining site-authoring maintenance lease.");
  const runtime = configuredSiteSandboxRuntimeForSlot("blue");
  const sandbox = new SiteSandboxClient(runtime.url, runtime.token);
  const cancelled: string[] = [];
  for (const entry of report.legacyPauses) {
    const run = await sitePlatformRepository.getAgentRun(entry.runId);
    if (!run || run.status !== "needs_input" || run.resumeCheckpointId) continue;
    const now = new Date().toISOString();
    const session = await sitePlatformRepository.getAgentSession(run.sessionId);
    if (session?.sandboxId) await sandbox.destroy(session.sandboxId);
    const retained = await sitePlatformRepository.cancelAgentRun(run.id, now);
    if (!retained) continue;
    if (session) {
      await sitePlatformRepository.saveAgentSession(siteAgentSessionSchema.parse({
        ...session,
        status: "checkpointed",
        sandboxDeploymentId: undefined,
        sandboxId: undefined,
        sandboxLastDestroyedAt: session.sandboxId ? now : session.sandboxLastDestroyedAt,
        leaseExpiresAt: now,
        updatedAt: now
      }));
    }
    cancelled.push(run.id);
  }
  const after = await buildReport();
  assert.equal(after.legacyPauses.length, 0, "Legacy needs-input runs remain after cutover cancellation.");
  process.stdout.write(`${JSON.stringify({ ok: true, cancelled, after }, null, 2)}\n`);
}

async function buildReport() {
  const runs = await sitePlatformRepository.listRecentAgentRuns({ status: "needs_input", limit: 500 });
  const legacyPauses = (await Promise.all(runs.filter((run) => !run.resumeCheckpointId).map(async (run) => {
    const session = await sitePlatformRepository.getAgentSession(run.sessionId);
    return {
      runId: run.id,
      executionNumber: run.executionNumber,
      sessionId: run.sessionId,
      sandboxId: session?.sandboxId,
      leaseExpiresAt: session?.leaseExpiresAt
    };
  }))).sort((left, right) => left.runId.localeCompare(right.runId));
  const payload = { schemaVersion: 1, legacyPauses };
  return { ...payload, reportHash: sha256(stableJson(payload)) };
}
