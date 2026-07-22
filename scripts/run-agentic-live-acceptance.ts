import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GET as servePublicSite } from "../app/sites/[slug]/[[...path]]/route";
import { POST as submitForm } from "../app/api/forms/submit/route";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "../packages/site-artifacts";
import type { SiteAgentRunV2, SiteBuildArtifactV1, SiteVersionV4 } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";
import { AgenticSiteWorkflowV1, candidateAttemptForRun } from "../packages/site-platform";

const sourceUrl = process.argv.find((value) => value.startsWith("--url="))?.slice("--url=".length)
  ?? "https://terrysbodyshop.com/";
const expectedDomainContext = parseDomainContextExpectation();
const structuralEdit = process.argv.includes("--structural-edit");
const targetLabel = process.argv.find((value) => value.startsWith("--label="))?.slice("--label=".length)
  ?? new URL(sourceUrl).hostname.replace(/^www\./, "").split(".")[0];
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const actorId = `live_experiment_${suffix}`;
const workflow = new AgenticSiteWorkflowV1();
const blobStore = configuredArtifactBlobStore();
const startedAt = Date.now();

console.log(JSON.stringify({ stage: "bootstrap_experimental", sourceUrl }));
const bootstrapped = await workflow.bootstrapFromUrl({ url: sourceUrl, ownerId: actorId, mode: "experimental" });
assert(bootstrapped.site.status === "experimental", "Live experiment did not create an experimental site.");
if (expectedDomainContext === "none") {
  assert(!bootstrapped.buildInput.domainContext, `Expected neutral context, received ${bootstrapped.buildInput.domainContext?.id}.`);
  const demand = (await sitePlatformRepository.listVerticalDemandEvents("open")).find((event) => event.requestedBy === actorId);
  assert(demand, "Neutral generation did not retain nonblocking domain-demand telemetry.");
} else if (expectedDomainContext) {
  assert(bootstrapped.buildInput.domainContext?.id === expectedDomainContext, `Expected ${expectedDomainContext} context, received ${bootstrapped.buildInput.domainContext?.id ?? "none"}.`);
}

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

const editInstruction = structuralEdit
  ? "Add a dedicated /services-overview page that presents only the existing canonical offerings through their Fact bindings, links to existing service routes where relevant, and is reachable from the primary navigation. Preserve every existing route, capability, verified fact, and unrelated design decision."
  : "Refine the visual treatment and hierarchy of the primary homepage action so it feels more intentional and specific to this business. Preserve its destination, all verified facts, existing routes, and unrelated design decisions.";
const { run: editRun } = await workflow.preflightAndEnqueueApply({
  session: currentSession,
  instruction: editInstruction,
  requestedBy: actorId,
  selection: structuralEdit ? undefined : {
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
const editSpans = await sitePlatformRepository.listTraceSpans(completedEdit.id, { limit: 500 });
const objective = await sitePlatformRepository.getEditObjective(completedEdit.id);
assert(objective, "The edit run is missing its immutable server-created objective.");
const preflightSpans = await sitePlatformRepository.listTraceSpans(objective.requestId, { limit: 100 });
assert(editedVersion.workspaceRevisionId !== initialVersion.workspaceRevisionId, "The edit did not create an immutable workspace revision.");
if (structuralEdit) {
  assert(objective.operation === "add_page", `Structural edit was classified as ${objective.operation}.`);
  assert(objective.ownerSpecifiedRoutes.includes("/services-overview"), "The exact owner-specified route was not retained in the edit objective.");
  assert(initialArtifact.routes.every((route) => editedArtifact.routes.some((candidate) => candidate.path === route.path)), "The structural edit removed an existing route.");
  assert(editedArtifact.routes.some((route) => route.path === "/services-overview"), "The structural edit did not add /services-overview.");
} else {
  assert(sameRoutes(initialArtifact, editedArtifact), "The focused edit changed the site route set.");
}
assert(editSpans.some((span) => span.kind === "tool_call" && span.name === "apply_patch" && span.status === "succeeded"), "The live edit never applied an exact patch.");
assert(!editSpans.some((span) => span.kind === "tool_call" && span.name === "write_file"), "The post-initial edit used write_file instead of patch-only mutation.");
assert(preflightSpans.some((span) => span.kind === "preflight" && span.status === "succeeded"), "The edit preflight span was not retained.");
assertTraceHierarchy(editSpans, completedEdit.id);
await assertPromotionRejected(editedVersion.id);
await assertNotPublic(bootstrapped.site.slug);
const retainedSite = await sitePlatformRepository.getSite(bootstrapped.site.id);
assert(retainedSite?.status === "experimental" && !retainedSite.publishedVersionId, "Automatic publish bypassed experimental non-publishability.");

const [initialSpans] = await Promise.all([sitePlatformRepository.listTraceSpans(initialRun.id, { limit: 500 })]);
const report = {
  schemaVersion: "agentic-site-live-experiment-v1",
  recordedAt: new Date().toISOString(),
  sourceUrl,
  targetLabel,
  acknowledgedTargetStatus: sourceUrl.includes("terrysbodyshop.com") ? "previously_observed_not_neutral_evaluation_evidence" : "frozen_live_cutover_acceptance",
  domainContext: bootstrapped.buildInput.domainContext?.id ?? "none",
  siteId: bootstrapped.site.id,
  slug: bootstrapped.site.slug,
  status: retainedSite.status,
  authenticatedEditorPath: `/workspace/${bootstrapped.site.slug}/website`,
  initial: summarizeRun(initialRun, initialVersion, initialArtifact, initialSpans),
  edit: summarizeRun(completedEdit, editedVersion, editedArtifact, editSpans),
  editObjective: objective,
  editMutationProtocol: "apply_patch_only",
  editMode: structuralEdit ? "structural_page_add" : "focused_restyle",
  preflightSpanCount: preflightSpans.length,
  publicServing: "rejected",
  tokenPreview: "not_created",
  candidateForms: "rejected",
  retention: "Private experimental rows, artifacts, runs, sessions, and captures are retained for continued experimentation and must be deleted before any pilot.",
  totalDurationMs: Date.now() - startedAt
};
const reportPath = join(".data", "experiments", `${targetLabel}-${suffix}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2));

function assertSuccessfulRun(run: SiteAgentRunV2, label: string) {
  assert(run.status === "succeeded", `${label} failed: ${run.failureReason ?? "unknown failure"}`);
  assert(run.candidateVersionId, `${label} did not create a candidate version.`);
  assert(candidateAttemptForRun(run), `${label} has no passing attempt for its retained output revision.`);
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
    rejected = error instanceof Error && (error.message.includes("experimental_site_not_publishable") || error.message.includes("experimental_site"));
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

function assertTraceHierarchy(spans: Awaited<ReturnType<typeof sitePlatformRepository.listTraceSpans>>, runId: string) {
  const ids = new Set(spans.map((span) => span.id));
  const roots = spans.filter((span) => !span.parentSpanId);
  assert(roots.length >= 1 && roots.every((span) => span.kind === "attempt"), `Run ${runId} has a non-attempt root trace span.`);
  assert(spans.every((span) => !span.parentSpanId || ids.has(span.parentSpanId)), `Run ${runId} has an orphaned child span.`);
  assert(spans.some((span) => span.kind === "model_request" && span.inputTokens !== undefined), `Run ${runId} has no model-request usage span.`);
  assert(spans.some((span) => span.kind === "inspection"), `Run ${runId} has no inspection span.`);
}

function parseDomainContextExpectation() {
  const raw = process.argv.find((value) => value.startsWith("--expect-domain-context="))?.slice("--expect-domain-context=".length);
  if (!raw) return undefined;
  if (raw === "none" || raw === "auto_body") return raw;
  throw new Error("--expect-domain-context must be none or auto_body.");
}

function summarizeRun(run: SiteAgentRunV2, version: SiteVersionV4, artifact: SiteBuildArtifactV1, spans: Awaited<ReturnType<typeof sitePlatformRepository.listTraceSpans>>) {
  const candidateAttempt = candidateAttemptForRun(run);
  return {
    runId: run.id,
    versionId: version.id,
    artifactId: artifact.id,
    attempts: run.attempts.length,
    objectiveGate: artifact.qa.hardGate,
    criticVerdict: candidateAttempt?.subjectiveVerdict,
    criticSummary: run.subjectiveReview?.summary,
    criticFindings: run.subjectiveReview?.findings,
    routes: artifact.routes.map((route) => route.path),
    screenshotKeys: artifact.qa.screenshotKeys,
    toolCalls: spans.filter((span) => span.kind === "tool_call").map((span) => span.name),
    usage: run.usage
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
