import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GET as servePublicSite } from "../app/sites/[slug]/[[...path]]/route";
import { POST as submitForm } from "../app/api/forms/submit/route";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "../packages/site-artifacts";
import type { SiteAgentRunV1, SiteBuildArtifactV1, SiteVersionV4 } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";
import { AgenticSiteWorkflowV1 } from "../packages/site-platform";

const sourceUrl = process.argv.find((value) => value.startsWith("--url="))?.slice("--url=".length)
  ?? "https://terrysbodyshop.com/";
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const actorId = `live_experiment_${suffix}`;
const workflow = new AgenticSiteWorkflowV1();
const blobStore = configuredArtifactBlobStore();
const startedAt = Date.now();

console.log(JSON.stringify({ stage: "bootstrap_experimental", sourceUrl }));
const bootstrapped = await workflow.bootstrapFromUrl({ url: sourceUrl, ownerId: actorId, mode: "experimental" });
assert(bootstrapped.site.status === "experimental", "Live experiment did not create an experimental site.");

console.log(JSON.stringify({ stage: "initial_build", runId: bootstrapped.run.id, siteId: bootstrapped.site.id }));
const initialRun = await workflow.executeRun(bootstrapped.run.id);
assertSuccessfulRun(initialRun, "initial build");
const initialVersion = await requireVersion(initialRun.candidateVersionId!);
const initialArtifact = await requireArtifact(initialVersion.artifactId);
await assertRetainedBytes(initialArtifact);
await assertPromotionRejected(initialVersion.id);
await assertNotPublic(bootstrapped.site.slug);
await assertCandidateFormRejected(bootstrapped.site.id, bootstrapped.buildInput.forms[0]?.id);

const currentSite = await sitePlatformRepository.getSite(bootstrapped.site.id);
const currentSession = await sitePlatformRepository.getAgentSession(bootstrapped.session.id);
assert(currentSite?.currentWorkspaceRevisionId, "Initial build did not advance the current workspace revision.");
assert(currentSession, "Initial agent session was not retained.");

const editInstruction = "Refine the visual treatment and hierarchy of the primary homepage action so it feels more intentional and specific to this business. Preserve its destination, all verified facts, existing routes, and unrelated design decisions.";
const editRun = await workflow.enqueueRun({
  session: currentSession,
  kind: "focused_edit",
  instruction: editInstruction,
  requestedBy: actorId,
  publishAfterSuccess: true,
  selection: {
    route: "/",
    selector: "primary homepage action",
    workspaceRevisionId: currentSite.currentWorkspaceRevisionId,
    versionId: initialVersion.id
  }
});

console.log(JSON.stringify({ stage: "focused_patch_edit", runId: editRun.id }));
const completedEdit = await workflow.executeRunAndFinalize(editRun.id);
assertSuccessfulRun(completedEdit, "focused edit");
const editedVersion = await requireVersion(completedEdit.candidateVersionId!);
const editedArtifact = await requireArtifact(editedVersion.artifactId);
assert(editedVersion.workspaceRevisionId !== initialVersion.workspaceRevisionId, "The edit did not create an immutable workspace revision.");
assert(sameRoutes(initialArtifact, editedArtifact), "The focused edit changed the site route set.");
assert(completedEdit.toolCalls.some((call) => call.name === "manager.apply_patch"), "The live edit never applied an exact patch.");
assert(!completedEdit.toolCalls.some((call) => call.name === "manager.write_file"), "The post-initial edit used write_file instead of patch-only mutation.");
await assertPromotionRejected(editedVersion.id);
await assertNotPublic(bootstrapped.site.slug);
const retainedSite = await sitePlatformRepository.getSite(bootstrapped.site.id);
assert(retainedSite?.status === "experimental" && !retainedSite.publishedVersionId, "Automatic publish bypassed experimental non-publishability.");

const report = {
  schemaVersion: "agentic-site-live-experiment-v1",
  recordedAt: new Date().toISOString(),
  sourceUrl,
  acknowledgedTargetStatus: "previously_observed_not_neutral_evaluation_evidence",
  siteId: bootstrapped.site.id,
  slug: bootstrapped.site.slug,
  status: retainedSite.status,
  authenticatedEditorPath: `/editor/${bootstrapped.site.slug}`,
  initial: summarizeRun(initialRun, initialVersion, initialArtifact),
  edit: summarizeRun(completedEdit, editedVersion, editedArtifact),
  editMutationProtocol: "apply_patch_only",
  publicServing: "rejected",
  tokenPreview: "not_created",
  candidateForms: "rejected",
  retention: "Private experimental rows, artifacts, runs, sessions, and captures are retained for continued experimentation and must be deleted before any pilot.",
  totalDurationMs: Date.now() - startedAt
};
const reportPath = join(".data", "experiments", `terrys-${suffix}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2));

function assertSuccessfulRun(run: SiteAgentRunV1, label: string) {
  assert(run.status === "succeeded", `${label} failed: ${run.failureReason ?? "unknown failure"}`);
  assert(run.candidateVersionId, `${label} did not create a candidate version.`);
  assert(run.attempts.at(-1)?.hardGate === "passed", `${label} did not finish with a passing objective gate.`);
  assert(run.attempts.length <= 2, `${label} exceeded the bounded candidate-attempt contract.`);
}

async function requireVersion(id: string) {
  const version = await sitePlatformRepository.getSiteVersion(id);
  assert(version, `Missing retained site version ${id}.`);
  return version;
}

async function requireArtifact(id: string) {
  const artifact = await sitePlatformRepository.getBuildArtifact(id);
  assert(artifact, `Missing retained build artifact ${id}.`);
  return artifact;
}

async function assertRetainedBytes(artifact: SiteBuildArtifactV1) {
  const retained = await readVerifiedArtifactFile({ artifact, path: "index.html", store: blobStore });
  assert(retained && retained.bytes.length > 0, "Experimental candidate is missing retained homepage bytes.");
}

async function assertPromotionRejected(versionId: string) {
  let rejected = false;
  try { await workflow.promoteVersion(versionId, actorId); } catch (error) {
    rejected = error instanceof Error && error.message.includes("experimental_site_not_publishable");
  }
  assert(rejected, "Experimental candidate promotion was not rejected.");
}

async function assertNotPublic(slug: string) {
  const response = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}`), {
    params: Promise.resolve({ slug, path: undefined })
  });
  assert(response.status === 404, `Experimental site unexpectedly returned public status ${response.status}.`);
}

async function assertCandidateFormRejected(siteId: string, formId: string | undefined) {
  assert(formId, "Canonical ingestion did not create a managed form definition.");
  const response = await submitForm(new Request("http://127.0.0.1/api/forms/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "lodesta-live-experiment-v1" },
    body: JSON.stringify({
      siteId,
      formId,
      pageId: "/contact",
      sessionId: `experiment_${suffix}`,
      visitorId: `visitor_${suffix}`,
      formRenderedAt: Date.now() - 2_000,
      payload: { name: "Experiment Test", phone: "5125550199", message: "This must not enter the inbox." }
    })
  }));
  assert(response.status >= 400, "A candidate-only experimental form accepted a public submission.");
}

function sameRoutes(left: SiteBuildArtifactV1, right: SiteBuildArtifactV1) {
  const normalize = (artifact: SiteBuildArtifactV1) => artifact.routes.map((route) => route.path).sort().join("\n");
  return normalize(left) === normalize(right);
}

function summarizeRun(run: SiteAgentRunV1, version: SiteVersionV4, artifact: SiteBuildArtifactV1) {
  return {
    runId: run.id,
    versionId: version.id,
    artifactId: artifact.id,
    attempts: run.attempts.length,
    objectiveGate: artifact.qa.hardGate,
    criticVerdict: run.attempts.at(-1)?.subjectiveVerdict,
    criticSummary: run.subjectiveReview?.summary,
    criticFindings: run.subjectiveReview?.findings,
    routes: artifact.routes.map((route) => route.path),
    screenshotKeys: artifact.qa.screenshotKeys,
    toolCalls: run.toolCalls.map((call) => call.name),
    usage: run.usage
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
