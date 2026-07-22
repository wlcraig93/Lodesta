import "./load-env";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "../packages/site-artifacts";
import { ControlPlaneServiceV2 } from "../packages/control-plane/service";
import { sitePlatformRepository } from "../packages/platform-data";
import { AgenticSiteWorkflowV1, candidateAttemptForRun } from "../packages/site-platform";

const sourceUrl = process.argv.find((argument) => argument.startsWith("--url="))?.slice("--url=".length);
if (!sourceUrl) throw new Error("Usage: verify:site-v3-walking-skeleton -- --url=https://experimental-source.example/");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const actorId = `site_v3_skeleton_${suffix}`;
const workflow = new AgenticSiteWorkflowV1();
const controlPlane = new ControlPlaneServiceV2(sitePlatformRepository, workflow);
const startedAt = Date.now();

const bootstrapped = await workflow.bootstrapFromUrl({ url: sourceUrl, ownerId: actorId, mode: "experimental" });
assert(bootstrapped.site.status === "experimental", "V3 skeleton was not created as an experimental site.");
assert(bootstrapped.buildInput.schemaVersion === "site-public-build-input-v3", "V3 public input was not persisted.");
assert(bootstrapped.buildInput.intent.schemaVersion === "site-intent-v3", "V3 intent was not persisted.");
assert(bootstrapped.buildInput.intent.agentAccessPolicy.aiTrain === "disallow", "training was not default-denied.");

const initial = await workflow.executeRun(bootstrapped.run.id);
assert(initial.status === "succeeded" && initial.candidateVersionId, `Initial V3 manager run failed: ${initial.failureReason ?? "unknown"}`);
assert(candidateAttemptForRun(initial)?.hardGate === "passed", "Initial V3 candidate did not pass immutable artifact verification.");
const firstVersion = await sitePlatformRepository.getSiteVersion(initial.candidateVersionId);
assert(firstVersion, "Initial V3 candidate version was not persisted.");
const firstArtifact = await sitePlatformRepository.getBuildArtifact(firstVersion.artifactId);
assert(firstArtifact?.qa.hardGate === "passed", "Initial V3 build artifact was not finalized.");
const retainedHome = await readVerifiedArtifactFile({ artifact: firstArtifact, path: "index.html", store: configuredArtifactBlobStore() });
assert(retainedHome?.bytes.length, "Initial V3 immutable homepage bytes are missing.");

const policy = await controlPlane.submit({
  siteId: bootstrapped.site.id,
  requestedBy: actorId,
  payload: {
    kind: "update_agent_access_policy",
    policy: {
      search: "allow",
      aiInput: "disallow",
      aiTrain: "disallow",
      trainingPermission: { status: "not_granted" }
    }
  }
});
assert(policy.applied && policy.run.kind === "rebase", "Policy-only V3 change did not select deterministic rebase.");
const rebased = await workflow.executeRun(policy.run.id);
assert(rebased.status === "succeeded" && rebased.candidateVersionId, `Deterministic policy rebase failed: ${rebased.failureReason ?? "unknown"}`);
assert(rebased.candidateVersionId !== initial.candidateVersionId, "Policy rebase did not create a new immutable candidate version.");
const rebaseSpans = await sitePlatformRepository.listTraceSpans(rebased.id, { limit: 500 });
assert(rebaseSpans.some((span) => span.kind === "tool_call" && span.name === "rebase_public_input" && span.status === "succeeded"), "Policy rebase did not use the deterministic artifact path.");
assert(!rebaseSpans.some((span) => span.kind === "model_request"), "Policy rebase invoked a manager model.");

const retainedSite = await sitePlatformRepository.getSite(bootstrapped.site.id);
assert(retainedSite?.status === "experimental" && !retainedSite.publishedVersionId, "Walking skeleton became public without an owner pilot.");
const report = {
  schemaVersion: "site-v3-walking-skeleton-report-v1",
  recordedAt: new Date().toISOString(),
  sourceUrl,
  siteId: bootstrapped.site.id,
  businessId: bootstrapped.site.businessId,
  publicBuildInputId: bootstrapped.buildInput.id,
  initialRunId: initial.id,
  initialVersionId: initial.candidateVersionId,
  policyRunId: rebased.id,
  policyVersionId: rebased.candidateVersionId,
  privatePreviewPath: `/api/site-versions/${initial.candidateVersionId}/artifact/`,
  publicServing: "blocked_experimental",
  deterministicPolicyRebase: "passed",
  durationMs: Date.now() - startedAt,
  retention: "Retain until the operator explicitly includes this experimental site in a later cleanup report."
};
const reportPath = join(".data", "site-v3-skeleton", `${bootstrapped.site.id}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
