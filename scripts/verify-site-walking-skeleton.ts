import "./load-env";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "../packages/site-artifacts";
import { ControlPlaneService } from "../packages/control-plane/service";
import { sitePlatformRepository } from "../packages/platform-data";
import { SiteAuthoringWorkflow } from "../packages/site-platform";

const sourceUrl = process.argv.find((argument) => argument.startsWith("--url="))?.slice("--url=".length);
if (!sourceUrl) throw new Error("Usage: verify:site-walking-skeleton -- --url=https://experimental-source.example/");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const actorId = `site_skeleton_${suffix}`;
const workflow = new SiteAuthoringWorkflow();
const controlPlane = new ControlPlaneService(sitePlatformRepository, workflow);
const startedAt = Date.now();

const bootstrapped = await workflow.bootstrapFromUrl({ url: sourceUrl, ownerId: actorId, mode: "experimental" });
assert(bootstrapped.site.status === "experimental", "Walking skeleton was not created as an experimental site.");
assert(bootstrapped.buildInput.schemaVersion === "site-public-build-input-v3", "Canonical public input was not persisted.");
assert(bootstrapped.buildInput.intent.schemaVersion === "site-intent-v3", "Canonical site intent was not persisted.");
assert(bootstrapped.buildInput.intent.agentAccessPolicy.aiTrain === "disallow", "training was not default-denied.");

const initial = await workflow.executeRun(bootstrapped.run.id);
assert(initial.status === "succeeded" && initial.candidateVersionId, `Initial website-authoring run failed: ${initial.failureReason ?? "unknown"}`);
const firstVersion = await sitePlatformRepository.getSiteVersion(initial.candidateVersionId);
assert(firstVersion, "Initial candidate version was not persisted.");
const firstArtifact = await sitePlatformRepository.getBuildArtifact(firstVersion.artifactId);
assert(firstArtifact?.qa.hardGate === "passed", "Initial build artifact was not finalized.");
const retainedHome = await readVerifiedArtifactFile({ artifact: firstArtifact, path: "index.html", store: configuredArtifactBlobStore() });
assert(retainedHome?.bytes.length, "Initial immutable homepage bytes are missing.");
const retainedCss = await readVerifiedArtifactFile({ artifact: firstArtifact, path: "site.css", store: configuredArtifactBlobStore() });
assert(retainedCss?.bytes.length, "Initial immutable stylesheet bytes are missing.");

const exactEditRequest = "Change the site's primary visual accent to a deep teal and state that exact change in the owner message. Preserve the business facts, routes, capabilities, and all unrelated content.";
const { run: queuedEdit } = await workflow.enqueueEdit({
  session: bootstrapped.session,
  instruction: exactEditRequest,
  requestedBy: actorId
});
const edited = await workflow.executeRun(queuedEdit.id);
assert(edited.status === "succeeded" && edited.candidateVersionId, `Exact website edit failed: ${edited.failureReason ?? "unknown"}`);
const editedVersion = await sitePlatformRepository.getSiteVersion(edited.candidateVersionId);
assert(editedVersion && editedVersion.id !== firstVersion.id, "Exact edit did not create a distinct immutable candidate.");
const editedArtifact = await sitePlatformRepository.getBuildArtifact(editedVersion.artifactId);
assert(editedArtifact?.qa.hardGate === "passed", "Exact edit artifact did not pass release verification.");
const editedHome = await readVerifiedArtifactFile({ artifact: editedArtifact, path: "index.html", store: configuredArtifactBlobStore() });
const editedCss = await readVerifiedArtifactFile({ artifact: editedArtifact, path: "site.css", store: configuredArtifactBlobStore() });
assert(editedHome?.bytes.length, "Exact edit did not retain homepage bytes.");
assert(editedCss?.bytes.length, "Exact edit did not retain stylesheet bytes.");
assert(!editedHome.bytes.equals(retainedHome.bytes) || !editedCss.bytes.equals(retainedCss.bytes), "Exact visual edit did not change retained site bytes.");

let policyPhase: { status: "passed" | "failed"; error?: string } = { status: "passed" };
try {
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
  assert(policy.applied && !("run" in policy), "Policy-only change created a generation run.");
  const [siteAfterPolicy, intentAfterPolicy, versionsAfterPolicy] = await Promise.all([
    sitePlatformRepository.getSite(bootstrapped.site.id),
    sitePlatformRepository.getSiteIntent(bootstrapped.site.id),
    sitePlatformRepository.listSiteVersions(bootstrapped.site.id)
  ]);
  assert(siteAfterPolicy?.currentPublicBuildInputId === bootstrapped.buildInput.id, "Policy-only change replaced the immutable public input.");
  assert(versionsAfterPolicy.length === 2
    && versionsAfterPolicy.some((version) => version.id === initial.candidateVersionId)
    && versionsAfterPolicy.some((version) => version.id === edited.candidateVersionId), "Policy-only change created or replaced a candidate.");
  assert(intentAfterPolicy?.agentAccessPolicy.aiInput === "disallow", "Policy-only change did not update current site intent.");
} catch (error) {
  policyPhase = { status: "failed", error: error instanceof Error ? error.message : String(error) };
}

const retainedSite = await sitePlatformRepository.getSite(bootstrapped.site.id);
assert(retainedSite?.status === "experimental" && !retainedSite.publishedVersionId, "Walking skeleton experimental site became public.");
const report = {
  schemaVersion: "site-walking-skeleton-report",
  recordedAt: new Date().toISOString(),
  sourceUrl,
  siteId: bootstrapped.site.id,
  businessId: bootstrapped.site.businessId,
  publicBuildInputId: bootstrapped.buildInput.id,
  initialRunId: initial.id,
  initialVersionId: initial.candidateVersionId,
  exactEditRunId: edited.id,
  exactEditVersionId: edited.candidateVersionId,
  exactEditRequest,
  privatePreviewPath: `/api/site-versions/${edited.candidateVersionId}/artifact/`,
  publicServing: "blocked_experimental",
  phases: {
    generation: {
      status: "passed",
      initial: { runId: initial.id, versionId: initial.candidateVersionId },
      exactEdit: { runId: edited.id, versionId: edited.candidateVersionId }
    },
    policyUpdate: policyPhase
  },
  durationMs: Date.now() - startedAt,
  retention: "Retain until the operator explicitly includes this experimental site in a later cleanup report."
};
const reportPath = join(".data", "site-walking-skeleton", `${bootstrapped.site.id}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2));
if (policyPhase.status === "failed") throw new Error(`Policy phase failed after successful candidate retention: ${policyPhase.error}`);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
