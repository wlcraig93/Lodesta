import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GET as servePublicSite } from "../app/sites/[slug]/[[...path]]/route";
import { POST as submitForm } from "../app/api/forms/submit/route";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "../packages/site-artifacts";
import type { SiteAgentRun, SiteBuildArtifactV1, SiteVersionV4 } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const sourceUrl = process.argv.find((value) => value.startsWith("--url="))?.slice("--url=".length)
  ?? "https://terrysbodyshop.com/";
const targetLabel = process.argv.find((value) => value.startsWith("--label="))?.slice("--label=".length)
  ?? new URL(sourceUrl).hostname.replace(/^www\./, "").split(".")[0];
const apiOrigin = (process.env.LODESTA_API_URL ?? process.env.LODESTA_APP_ORIGIN ?? "https://dev.lodesta.com").replace(/\/$/, "");
const configuredAdminToken = process.env.LODESTA_ADMIN_TOKEN?.trim();
if (!configuredAdminToken) throw new Error("LODESTA_ADMIN_TOKEN is required for the live site-authoring acceptance test.");
const adminToken: string = configuredAdminToken;

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const blobStore = configuredArtifactBlobStore();
const startedAt = Date.now();

console.log(JSON.stringify({ stage: "bootstrap_experimental", sourceUrl, apiOrigin }));
const bootstrap = await postJson<{
  site: { id: string; slug: string; status: string };
  session: { id: string; ownerId: string };
  run: SiteAgentRun;
}>("/api/site-agent/sites", { url: sourceUrl, mode: "experimental", slug: `site-authoring-${suffix}` });
assert(bootstrap.status === 202, `Bootstrap API returned ${bootstrap.status}: ${JSON.stringify(bootstrap.body)}`);
assert(bootstrap.body.site.status === "experimental", "Live acceptance did not create an experimental site.");
assert(bootstrap.body.session.ownerId === "authorized_operator", "API bootstrap did not bind the session to the deployed operator identity.");
const siteId = bootstrap.body.site.id;
const sessionId = bootstrap.body.session.id;

console.log(JSON.stringify({ stage: "initial_generation", runId: bootstrap.body.run.id, siteId }));
const initialRun = await waitForRun(bootstrap.body.run.id, ["succeeded", "failed", "cancelled", "needs_input"], 45 * 60_000);
assertSuccessfulRun(initialRun, "initial generation");
const initialVersion = await requireVersion(initialRun.candidateVersionId!);
const initialArtifact = await requireArtifact(initialVersion.artifactId);
await assertRetainedBytes(initialArtifact);
await assertPromotionRejected(initialVersion.id);
await assertNotPublic(bootstrap.body.site.slug);
const initialSite = await requireSite(siteId);
const publicInput = await requirePublicInput(initialSite.currentPublicBuildInputId);
await assertCandidateFormRejected(siteId, publicInput.forms[0]?.id);

const exactInstruction = "Change only the primary homepage CTA label to ‘Get your free estimate’. Preserve its destination, all verified facts, every route, and all unrelated design and content.";
const exactResponse = await postJson<{ run: SiteAgentRun }>("/api/site-agent/runs", {
  sessionId,
  instruction: exactInstruction,
  selection: { route: "/", selector: "primary homepage CTA", workspaceRevisionId: initialRun.outputRevisionId, versionId: initialVersion.id }
});
assert(exactResponse.status === 202, `Exact-edit API returned ${exactResponse.status}: ${JSON.stringify(exactResponse.body)}`);
console.log(JSON.stringify({ stage: "exact_edit", runId: exactResponse.body.run.id }));
const exactRun = await waitForRun(exactResponse.body.run.id, ["succeeded", "failed", "cancelled", "needs_input"], 30 * 60_000);
assertSuccessfulRun(exactRun, "exact edit");
const exactVersion = await requireVersion(exactRun.candidateVersionId!);
const exactArtifact = await requireArtifact(exactVersion.artifactId);
assert(sameRoutes(initialArtifact, exactArtifact), "The exact text edit changed the route set.");

const headBeforeQuestion = (await requireSite(siteId)).currentWorkspaceRevisionId;
const ambiguousInstruction = "This is intentionally consequential and ambiguous. Before changing any file, ask me whether the primary homepage CTA should use ‘Call now’ or ‘Request a quote.’ Do not choose, edit, or inspect until I answer.";
const ambiguousResponse = await postJson<{ run: SiteAgentRun }>("/api/site-agent/runs", { sessionId, instruction: ambiguousInstruction });
assert(ambiguousResponse.status === 202, `Ambiguous-edit API returned ${ambiguousResponse.status}: ${JSON.stringify(ambiguousResponse.body)}`);
console.log(JSON.stringify({ stage: "clarification_wait", runId: ambiguousResponse.body.run.id }));
const waitingRun = await waitForRun(ambiguousResponse.body.run.id, ["needs_input", "succeeded", "failed", "cancelled"], 15 * 60_000);
assert(waitingRun.status === "needs_input", `Ambiguous request did not reach needs_input: ${waitingRun.status} ${waitingRun.failureReason ?? ""}`);
assert(waitingRun.inputQuestion?.includes("Call now") && waitingRun.inputQuestion.includes("Request a quote"), "Clarification question did not preserve the consequential choice.");
assert(!waitingRun.outputRevisionId && (await requireSite(siteId)).currentWorkspaceRevisionId === headBeforeQuestion, "The waiting request mutated source before clarification.");
const waitingSession = await sitePlatformRepository.getAgentSession(sessionId);
assert(waitingSession?.status === "checkpointed" && !waitingSession.sandboxId && waitingSession.sandboxLastDestroyedAt, "needs_input did not checkpoint the session and destroy its sandbox.");
assert(!(await sitePlatformRepository.listAgentRuns(sessionId)).some((run) => run.status === "running"), "needs_input did not release run capacity.");
const ownerWorkspace = await getJson<{ messages: Array<{ runId?: string; role: string; content: string }>; runs: SiteAgentRun[] }>(`/api/site-agent/sessions?siteId=${encodeURIComponent(siteId)}`);
assert(ownerWorkspace.status === 200, `Owner workspace API returned ${ownerWorkspace.status}.`);
assert(ownerWorkspace.body.messages.some((message) => message.runId === waitingRun.id && message.role === "agent" && message.content.includes("Call now") && message.content.includes("Request a quote")), "The clarification question is not visible through the owner-facing data path.");

const structuralResponse = await postJson<{ run: SiteAgentRun }>("/api/site-agent/runs", {
  sessionId,
  instruction: "Add a dedicated /services-overview page using only existing canonical offering facts, link it from the primary navigation, and preserve every existing route and unrelated design decision."
});
assert(structuralResponse.status === 202, `Structural-edit API returned ${structuralResponse.status}: ${JSON.stringify(structuralResponse.body)}`);
console.log(JSON.stringify({ stage: "intervening_structural_edit", runId: structuralResponse.body.run.id }));
const structuralRun = await waitForRun(structuralResponse.body.run.id, ["succeeded", "failed", "cancelled", "needs_input"], 30 * 60_000);
assertSuccessfulRun(structuralRun, "intervening structural edit");
const structuralVersion = await requireVersion(structuralRun.candidateVersionId!);
const structuralArtifact = await requireArtifact(structuralVersion.artifactId);
assert(structuralArtifact.routes.some((route) => route.path === "/services-overview"), "The structural edit did not add /services-overview.");
assert(exactArtifact.routes.every((route) => structuralArtifact.routes.some((candidate) => candidate.path === route.path)), "The structural edit removed an existing route.");

const resumeResponse = await postJson<{ run: SiteAgentRun }>("/api/site-agent/runs", {
  sessionId,
  resumeRunId: waitingRun.id,
  instruction: "Use ‘Request a quote.’ Preserve the intervening /services-overview page and every unrelated change."
});
assert(resumeResponse.status === 202, `Clarification resume API returned ${resumeResponse.status}: ${JSON.stringify(resumeResponse.body)}`);
assert(resumeResponse.body.run.id === waitingRun.id, "Unexpired clarification did not resume the same run ID.");
console.log(JSON.stringify({ stage: "clarification_resume", runId: waitingRun.id }));
const resumedRun = await waitForRun(waitingRun.id, ["succeeded", "failed", "cancelled", "needs_input"], 30 * 60_000);
assertSuccessfulRun(resumedRun, "clarification resume");
assert(resumedRun.exactParentRevisionId === structuralRun.outputRevisionId, "Resumed clarification did not rebase onto the current workspace head.");
assert(resumedRun.publicBuildInputId === (await requireSite(siteId)).currentPublicBuildInputId, "Resumed clarification did not use the current public input.");
assert(resumedRun.candidateVersionId !== structuralRun.candidateVersionId, "Resumed clarification did not create a distinct verified candidate.");
const resumedVersion = await requireVersion(resumedRun.candidateVersionId!);
const resumedArtifact = await requireArtifact(resumedVersion.artifactId);
assert(resumedArtifact.routes.some((route) => route.path === "/services-overview"), "Clarification resume discarded the intervening structural edit.");

const countsBeforePolicy = await generationCounts(siteId);
const intentBeforePolicy = await sitePlatformRepository.getSiteIntent(siteId);
assert(intentBeforePolicy, "Policy verification could not load the current site intent.");
const nextSearch = intentBeforePolicy.agentAccessPolicy.search === "allow" ? "disallow" : "allow";
const policyResponse = await postJson<{ applied?: boolean; run?: SiteAgentRun }>("/api/control-plane/changes", {
  siteId,
  payload: {
    kind: "update_agent_access_policy",
    policy: { ...intentBeforePolicy.agentAccessPolicy, search: nextSearch }
  }
});
assert(policyResponse.status === 202 && policyResponse.body.applied === true && !policyResponse.body.run, `Policy-only API change did not apply in isolation: ${JSON.stringify(policyResponse.body)}`);
const countsAfterPolicy = await generationCounts(siteId);
assert(JSON.stringify(countsAfterPolicy) === JSON.stringify(countsBeforePolicy), `Policy-only change created generation artifacts: ${JSON.stringify({ countsBeforePolicy, countsAfterPolicy })}`);
const intentAfterPolicy = await sitePlatformRepository.getSiteIntent(siteId);
assert(intentAfterPolicy?.revision === intentBeforePolicy.revision + 1 && intentAfterPolicy.agentAccessPolicy.search === nextSearch, "Policy-only change did not advance only the site-intent authority.");

const runs = [initialRun, exactRun, structuralRun, resumedRun];
const versions = [initialVersion, exactVersion, structuralVersion, resumedVersion];
const artifacts = [initialArtifact, exactArtifact, structuralArtifact, resumedArtifact];
const report = {
  schemaVersion: "site-authoring-live-acceptance",
  recordedAt: new Date().toISOString(),
  sourceUrl,
  targetLabel,
  siteId,
  slug: bootstrap.body.site.slug,
  status: "experimental",
  apiOrigin,
  actorIdentity: bootstrap.body.session.ownerId,
  runs: await Promise.all(runs.map(async (run, index) => summarizeRun(run, versions[index]!, artifacts[index]!))),
  clarification: {
    runId: waitingRun.id,
    question: waitingRun.inputQuestion,
    resumedSameRun: true,
    interveningRevisionId: structuralRun.outputRevisionId,
    resumedParentRevisionId: resumedRun.exactParentRevisionId,
    ownerFacingVisibility: "passed"
  },
  policyOnlyIsolation: { before: countsBeforePolicy, after: countsAfterPolicy, intentRevision: intentAfterPolicy.revision },
  baseline: { versionId: resumedVersion.id, artifactId: resumedArtifact.id, screenshotKeys: resumedArtifact.qa.screenshotKeys },
  retention: "Private and unpublished. Retained only for plumbing and safety inspection.",
  totalDurationMs: Date.now() - startedAt
};
const reportPath = join(".data", "experiments", `${targetLabel}-${suffix}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2));

async function waitForRun(runId: string, statuses: SiteAgentRun["status"][], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await getJson<{ run: SiteAgentRun }>(`/api/site-agent/runs/${encodeURIComponent(runId)}`);
    if (response.status !== 200) throw new Error(`Run poll returned ${response.status}: ${JSON.stringify(response.body)}`);
    if (statuses.includes(response.body.run.status)) return response.body.run;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Timed out waiting for run ${runId}.`);
}

async function postJson<T>(path: string, body: unknown) {
  return apiJson<T>(path, { method: "POST", body: JSON.stringify(body) });
}

async function getJson<T>(path: string) {
  return apiJson<T>(path, { method: "GET" });
}

async function apiJson<T>(path: string, init: RequestInit) {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-lodesta-admin-token": adminToken, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000)
  });
  const body = await response.json().catch(() => ({ error: "Non-JSON API response" })) as T;
  return { status: response.status, body };
}

function assertSuccessfulRun(run: SiteAgentRun, label: string) {
  assert(run.status === "succeeded", `${label} failed: ${run.status} ${run.failureReason ?? "unknown failure"}`);
  assert(run.candidateVersionId && run.outputRevisionId && run.outputArtifactId, `${label} did not retain a verified candidate.`);
}

async function requireSite(id: string) {
  const site = await sitePlatformRepository.getSite(id);
  assert(site, `Missing site ${id}.`);
  return site;
}

async function requirePublicInput(id: string | undefined) {
  assert(id, "Site is missing a current public build input.");
  const input = await sitePlatformRepository.getPublicBuildInput(id);
  assert(input, `Missing public build input ${id}.`);
  return input;
}

async function requireVersion(id: string) {
  const version = await sitePlatformRepository.getSiteVersion(id);
  assert(version, `Missing retained site version ${id}.`);
  return version;
}

async function requireArtifact(id: string) {
  const artifact = await sitePlatformRepository.getBuildArtifact(id);
  assert(artifact, `Missing retained build artifact ${id}.`);
  assert(artifact.qa.hardGate === "passed", `Artifact ${id} did not pass the hard gate.`);
  return artifact;
}

async function assertRetainedBytes(artifact: SiteBuildArtifactV1) {
  const retained = await readVerifiedArtifactFile({ artifact, path: "index.html", store: blobStore });
  assert(retained && retained.bytes.length > 0, "Experimental candidate is missing retained homepage bytes.");
}

async function assertPromotionRejected(versionId: string) {
  let rejected = false;
  try { await sitePlatformRepository.promoteSiteVersion(versionId, "authorized_operator"); } catch (error) {
    rejected = error instanceof Error && error.message.includes("experimental_site");
  }
  assert(rejected, "Experimental candidate promotion was not rejected.");
}

async function assertNotPublic(slug: string) {
  const response = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}`), { params: Promise.resolve({ slug, path: undefined }) });
  assert(response.status === 404, `Experimental site unexpectedly returned public status ${response.status}.`);
}

async function assertCandidateFormRejected(siteIdValue: string, formId: string | undefined) {
  assert(formId, "Canonical ingestion did not create a managed form definition.");
  const response = await submitForm(new Request("http://127.0.0.1/api/forms/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "lodesta-site-authoring-live-acceptance" },
    body: JSON.stringify({
      siteId: siteIdValue, formId, pageId: "/contact", sessionId: `experiment_${suffix}`,
      visitorId: `visitor_${suffix}`, formRenderedAt: Date.now() - 2_000,
      payload: { name: "Experiment Test", phone: "5125550199", message: "This must not enter the inbox." }
    })
  }));
  assert(response.status >= 400, "A candidate-only experimental form accepted a public submission.");
}

async function generationCounts(siteIdValue: string) {
  const client = getSupabaseAdminClient();
  const tables = ["site_public_build_inputs", "site_agent_runs", "site_workspace_revisions", "site_build_artifacts", "site_versions_v4"] as const;
  const result: Record<string, number> = {};
  for (const table of tables) {
    const { count, error } = await client.from(table).select("id", { count: "exact", head: true }).eq("site_id", siteIdValue);
    if (error) throw new Error(`Count ${table}: ${error.message}`);
    result[table] = count ?? 0;
  }
  return result;
}

function sameRoutes(left: SiteBuildArtifactV1, right: SiteBuildArtifactV1) {
  const normalize = (artifact: SiteBuildArtifactV1) => artifact.routes.map((route) => route.path).sort().join("\n");
  return normalize(left) === normalize(right);
}

async function summarizeRun(run: SiteAgentRun, version: SiteVersionV4, artifact: SiteBuildArtifactV1) {
  const events = await sitePlatformRepository.listAgentRunEvents(run.id, { limit: 500 });
  assert(events.some((event) => event.kind === "run"), `Run ${run.id} has no run event.`);
  assert(events.some((event) => event.kind === "inspection"), `Run ${run.id} has no inspection event.`);
  return {
    runId: run.id,
    versionId: version.id,
    artifactId: artifact.id,
    parentRevisionId: run.exactParentRevisionId,
    outputRevisionId: run.outputRevisionId,
    artifactGate: artifact.qa.hardGate,
    routes: artifact.routes.map((route) => route.path),
    screenshotKeys: artifact.qa.screenshotKeys,
    toolCalls: events.filter((event) => event.kind === "tool_call").map((event) => event.name),
    usage: run.usage
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
