import "./load-env";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";
import { SiteAuthoringWorkflow } from "../packages/site-platform";
import { siteQualityFailureStatus } from "./support/site-quality-failure";

const root = join(".data", "site-quality");
const cohortSchema = z.enum(["discovery", "validation"]);
const roundSchema = z.union([z.literal(1), z.literal(2)]);
const targetStatusSchema = z.enum(["pending", "running", "crawl_failed", "generation_failed", "succeeded"]);
const targetSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  role: z.enum(["primary", "spare"]),
  status: targetStatusSchema,
  siteId: z.string().optional(),
  businessId: z.string().optional(),
  reportPath: z.string().optional(),
  failure: z.string().optional()
}).strict();
const planSchema = z.object({
  schemaVersion: z.literal("site-quality-cohort-v2"),
  cohort: cohortSchema,
  round: roundSchema,
  frozenAt: z.string().datetime(),
  generalFixReason: z.string().min(20).max(2000).optional(),
  rubricVersion: z.literal("credible-customer-draft-v1"),
  targets: z.array(targetSchema)
}).strict().superRefine((value, context) => {
  if (value.cohort === "discovery" && value.round !== 1) context.addIssue({ code: "custom", path: ["round"], message: "Discovery has exactly one baseline round." });
  if (value.cohort === "validation" && value.round === 2 && !value.generalFixReason) context.addIssue({ code: "custom", path: ["generalFixReason"], message: "Validation round 2 requires the general platform fix reason." });
});
type CohortPlan = z.infer<typeof planSchema>;

const action = process.argv[2];
if (action === "plan") await createPlan();
else if (action === "run") await runTarget();
else if (action === "review") await recordReview();
else if (action === "pilot-entry") await evaluatePilotEntry();
else throw new Error("Usage: quality:site -- <plan|run|review|pilot-entry> [options]");

async function createPlan() {
  const cohort = requiredCohort();
  const round = requiredRound(cohort);
  const primaryUrls = values("url").map(canonicalUrl);
  const spareUrls = values("spare").map(canonicalUrl);
  const expected = cohort === "discovery" ? 4 : 3;
  if (primaryUrls.length !== expected) throw new Error(`${cohort} requires exactly ${expected} primary --url values.`);
  if (spareUrls.length < 2) throw new Error(`${cohort} requires at least two predeclared --spare values.`);
  const all = [...primaryUrls, ...spareUrls];
  if (new Set(all).size !== all.length) throw new Error("Cohort URLs must be unique.");
  const priorPlans = (await Promise.all([
    readPlan("discovery", 1, false),
    readPlan("validation", 1, false),
    readPlan("validation", 2, false)
  ])).filter((plan): plan is CohortPlan => Boolean(plan));
  if (priorPlans.some((plan) => all.some((url) => plan.targets.some((target) => target.url === url)))) throw new Error("Frozen quality cohorts cannot share a URL.");
  let generalFixReason: string | undefined;
  if (cohort === "validation" && round === 2) {
    const first = await readPlan("validation", 1, true);
    const primaryStillRunning = first.targets.some((target) => target.role === "primary" && (target.status === "pending" || target.status === "running"));
    const retainedResults = first.targets.filter((target) => target.status !== "pending" && target.status !== "running" && target.status !== "crawl_failed").length;
    if (primaryStillRunning || retainedResults < 3) throw new Error("Validation round 1 must have three retained terminal results before freezing the one permitted replacement cohort.");
    generalFixReason = required("general-fix-reason");
    if (generalFixReason.length < 20) throw new Error("The shared platform fix must be recorded with --general-fix-reason (at least 20 characters).");
  }
  const path = planPath(cohort, round);
  if (await exists(path)) throw new Error(`Frozen cohort already exists at ${path}.`);
  const targets = [
    ...primaryUrls.map((url, index) => ({ id: `${cohort}-${round}-${String(index + 1).padStart(2, "0")}`, url, role: "primary" as const, status: "pending" as const })),
    ...spareUrls.map((url, index) => ({ id: `${cohort}-${round}-spare-${String(index + 1).padStart(2, "0")}`, url, role: "spare" as const, status: "pending" as const }))
  ];
  const plan = planSchema.parse({ schemaVersion: "site-quality-cohort-v2", cohort, round, frozenAt: new Date().toISOString(), generalFixReason, rubricVersion: "credible-customer-draft-v1", targets });
  await writeJson(path, plan);
  print({ ok: true, path, plan });
}

async function runTarget() {
  const cohort = requiredCohort();
  const round = requiredRound(cohort);
  const plan = await readPlan(cohort, round, true);
  const requestedId = value("case");
  const target = requestedId ? plan.targets.find((item) => item.id === requestedId) : nextEligibleTarget(plan);
  if (!target) throw new Error("No eligible pending target remains in this cohort.");
  if (target.status !== "pending") throw new Error(`${target.id} is ${target.status}; quality targets cannot be rerun.`);
  if (target.role === "spare" && !spareIsEligible(plan)) throw new Error("A spare may run only after a predeclared primary has a crawl-stage failure.");
  target.status = "running";
  await writePlan(plan);

  const caseDir = join(root, cohort, `round-${round}`, target.id);
  await mkdir(caseDir, { recursive: true });
  const actorId = `quality_${cohort}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const workflow = new SiteAuthoringWorkflow();
  const blobStore = configuredArtifactBlobStore();
  let bootstrapped: Awaited<ReturnType<SiteAuthoringWorkflow["bootstrapFromUrl"]>> | undefined;
  const startedAt = Date.now();
  try {
    progress(target.id, "bootstrap_started", { url: target.url });
    bootstrapped = await workflow.bootstrapFromUrl({ url: target.url, ownerId: actorId, mode: "experimental" });
    target.siteId = bootstrapped.site.id;
    target.businessId = bootstrapped.site.businessId;
    progress(target.id, "bootstrap_completed", { siteId: bootstrapped.site.id, runId: bootstrapped.run.id });
    progress(target.id, "generation_started", { runId: bootstrapped.run.id });
    const run = await workflow.executeRunAndFinalize(bootstrapped.run.id);
    progress(target.id, "generation_completed", { runId: run.id, status: run.status, elapsedMs: Date.now() - startedAt });
    const version = run.candidateVersionId ? await sitePlatformRepository.getSiteVersion(run.candidateVersionId) : undefined;
    const artifact = version ? await sitePlatformRepository.getBuildArtifact(version.artifactId) : undefined;
    const snapshots = await Promise.all(bootstrapped.buildInput.sourceSnapshotIds.map((id) => sitePlatformRepository.getSourceSnapshot(id)));
    const ingestionCoverage = snapshots.map((snapshot) => (snapshot?.payload.ingestion as { coverage?: unknown } | undefined)?.coverage).find((coverage) => typeof coverage === "string");
    const frozenValidationEligible = ingestionCoverage !== "incomplete";
    const runStatus: "succeeded" | "generation_failed" = run.status === "succeeded" && version && artifact && frozenValidationEligible ? "succeeded" : "generation_failed";
    const report = {
      schemaVersion: "site-quality-run-v1",
      cohort,
      targetId: target.id,
      sourceUrl: target.url,
      actorId,
      siteId: bootstrapped.site.id,
      businessId: bootstrapped.site.businessId,
      slug: bootstrapped.site.slug,
      status: runStatus,
      candidateArtifactPath: version ? `/api/site-versions/${version.id}/artifact/` : undefined,
      editorPath: `/workspace/${bootstrapped.site.slug}/website`,
      run,
      version,
      artifact,
      elapsedMs: Date.now() - startedAt,
      ingestionCoverage,
      frozenValidationEligible,
      generatedOutputsAreBaselines: false
    };
    await writeJson(join(caseDir, "public-input.json"), bootstrapped.buildInput);
    await writeJson(join(caseDir, "report.json"), report);
    if (artifact) await copyCaptures(artifact.qa.screenshotKeys, caseDir, blobStore);
    await writeJson(join(caseDir, "review-template.json"), reviewTemplate(target.id));
    target.status = report.status;
    target.reportPath = join(caseDir, "report.json");
    target.failure = run.failureReason;
    await writePlan(plan);
    progress(target.id, "artifacts_retained", { reportPath: target.reportPath, captureCount: artifact?.qa.screenshotKeys.length ?? 0 });
    print({ ok: report.status === "succeeded", reportPath: target.reportPath, target, runId: run.id, versionId: version?.id });
    if (report.status !== "succeeded") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    target.status = siteQualityFailureStatus(error);
    target.siteId = bootstrapped?.site.id;
    target.businessId = bootstrapped?.site.businessId;
    target.failure = message;
    const reportPath = join(caseDir, "report.json");
    target.reportPath = reportPath;
    await writeJson(reportPath, {
      schemaVersion: "site-quality-run-v1",
      cohort,
      targetId: target.id,
      sourceUrl: target.url,
      actorId,
      siteId: bootstrapped?.site.id,
      businessId: bootstrapped?.site.businessId,
      status: target.status,
      failure: message,
      elapsedMs: Date.now() - startedAt,
      generatedOutputsAreBaselines: false
    });
    await writePlan(plan);
    throw error;
  }
}

async function recordReview() {
  const cohort = requiredCohort();
  const round = requiredRound(cohort);
  const plan = await readPlan(cohort, round, true);
  const targetId = required("case");
  const target = plan.targets.find((item) => item.id === targetId);
  if (!target?.reportPath || target.status !== "succeeded") throw new Error("Only a successful retained target can be reviewed.");
  const role = z.enum(["product_owner", "independent"]).parse(required("role"));
  const reviewer = required("reviewer");
  if (role === "independent" && value("independent") !== "yes") {
    throw new Error("Independent reviewers must pass --independent=yes to attest they did not implement, iterate, or select targets.");
  }
  const criteria = {
    businessSpecificIdentity: yesNo("identity"),
    coherentExperience: yesNo("coherence"),
    groundedContent: yesNo("grounding"),
    finishedResponsivePresentation: yesNo("responsive"),
    customerReadyWithoutRedesign: yesNo("customer-ready")
  };
  const result = {
    schemaVersion: "site-quality-review-v1",
    rubricVersion: "credible-customer-draft-v1",
    cohort,
    targetId,
    role,
    reviewer,
    independentAttestation: role === "independent",
    criteria,
    credible: Object.values(criteria).every(Boolean),
    managedLocationPanel: z.enum(["pass", "fail", "not_present"]).parse(required("location-panel")),
    notes: required("notes"),
    recordedAt: new Date().toISOString()
  };
  const path = join(dirname(target.reportPath), `review-${role}.json`);
  if (await exists(path)) throw new Error(`Review is already locked at ${path}.`);
  await writeJson(path, result);
  print({ ok: true, path, result });
}

async function evaluatePilotEntry() {
  const second = await readPlan("validation", 2, false);
  const plan = second ?? await readPlan("validation", 1, true);
  const considered = plan.targets.filter((target) => target.status !== "crawl_failed").slice(0, 3);
  const findings: string[] = [];
  let estimatedCostUsd = 0;
  if (considered.length !== 3) findings.push("Three non-crawl validation results are required.");
  for (const target of considered) {
    if (target.status !== "succeeded" || !target.reportPath) {
      findings.push(`${target.id} did not produce a successful objectively valid candidate.`);
      continue;
    }
    const report = JSON.parse(await readFile(target.reportPath, "utf8")) as { elapsedMs?: number; frozenValidationEligible?: boolean; run?: { status?: string; candidateVersionId?: string; failureReason?: string; usage?: { estimatedCostUsd?: number } } };
    if (report.run?.status !== "succeeded" || !report.run.candidateVersionId) findings.push(`${target.id} did not finish with a verified candidate.`);
    if (report.frozenValidationEligible !== true) findings.push(`${target.id} has incomplete ingestion coverage and is private-review-only.`);
    if ((report.elapsedMs ?? Number.POSITIVE_INFINITY) > 60 * 60_000) findings.push(`${target.id} exhausted the 60-minute initial workflow deadline.`);
    if (/limit_exhausted|deadline_exhausted|budget_exhausted/.test(JSON.stringify(report))) findings.push(`${target.id} exhausted a stage or orchestration safety budget.`);
    estimatedCostUsd += report.run?.usage?.estimatedCostUsd ?? 0;
    const product = await readJson(join(dirname(target.reportPath), "review-product_owner.json"));
    const independent = await readJson(join(dirname(target.reportPath), "review-independent.json"));
    if (!isCredibleReview(product, "product_owner")) findings.push(`${target.id} lacks a credible product-owner review.`);
    if (!isCredibleReview(independent, "independent")) findings.push(`${target.id} lacks a credible independent review.`);
    if (isRecord(product) && isRecord(independent) && product.reviewer === independent.reviewer) findings.push(`${target.id} uses the same person for product-owner and independent review.`);
  }
  const editBatteryPath = value("edit-battery-report");
  const editBattery = editBatteryPath ? await readJson(editBatteryPath) : undefined;
  if (!validEditBattery(editBattery)) findings.push("A passing restyle, add-page, move-form, and mobile-fix edit battery report is required.");
  if (/limit_exhausted|deadline_exhausted|budget_exhausted/.test(JSON.stringify(editBattery ?? {}))) findings.push("The edit battery exhausted a stage or orchestration safety budget.");
  const agentReadyPath = value("agent-ready-report");
  const agentReady = agentReadyPath ? await readJson(agentReadyPath) : undefined;
  if (!validAgentReadyReport(agentReady)) findings.push("A passing Agent Ready report with at least three live generated-site scans is required.");
  const report = {
    schemaVersion: "site-pilot-entry-review-v1",
    evaluatedAt: new Date().toISOString(),
    eligible: findings.length === 0,
    validationRound: plan.round,
    consideredTargetIds: considered.map((target) => target.id),
    evidence: { editBatteryPath, agentReadyPath },
    measuredEstimatedCostUsd: estimatedCostUsd,
    findings,
    constraints: ["operator approval required before every pilot publish", "three-owner concierge pilot only", "explicit exit review required before expansion"]
  };
  const path = join(root, "pilot-entry-report.json");
  await writeJson(path, report);
  print({ ok: report.eligible, path, report });
  if (!report.eligible) process.exitCode = 1;
}

function reviewTemplate(targetId: string) {
  return {
    schemaVersion: "site-quality-review-template-v1",
    targetId,
    rubricVersion: "credible-customer-draft-v1",
    criteria: ["business-specific identity", "coherent hierarchy/navigation/conversion", "grounded content", "finished desktop/mobile presentation", "customer-ready without redesign"],
    observation: "Check that agent CSS has not reduced the managed location panel below its usable presentation floor."
  };
}

async function copyCaptures(keys: string[], caseDir: string, store: ReturnType<typeof configuredArtifactBlobStore>) {
  const captureDir = join(caseDir, "captures");
  await mkdir(captureDir, { recursive: true });
  for (const [index, key] of keys.entries()) {
    const blob = await store.get(key);
    if (!blob) throw new Error(`Retained capture is missing: ${key}`);
    await writeFile(join(captureDir, `${String(index + 1).padStart(2, "0")}-${basename(key)}`), blob.bytes);
  }
}

function nextEligibleTarget(plan: CohortPlan) {
  return plan.targets.find((target) => target.role === "primary" && target.status === "pending")
    ?? (spareIsEligible(plan) ? plan.targets.find((target) => target.role === "spare" && target.status === "pending") : undefined);
}

function spareIsEligible(plan: CohortPlan) {
  const expected = plan.cohort === "discovery" ? 4 : 3;
  return plan.targets.filter((target) => target.status !== "pending" && target.status !== "running" && target.status !== "crawl_failed").length < expected
    && plan.targets.some((target) => target.role === "primary" && target.status === "crawl_failed");
}

async function readPlan(cohort: "discovery" | "validation", round: 1 | 2, requiredPlan: true): Promise<CohortPlan>;
async function readPlan(cohort: "discovery" | "validation", round: 1 | 2, requiredPlan: false): Promise<CohortPlan | undefined>;
async function readPlan(cohort: "discovery" | "validation", round: 1 | 2, requiredPlan: boolean): Promise<CohortPlan | undefined> {
  const parsed = await readJson(planPath(cohort, round));
  if (!parsed) {
    if (requiredPlan) throw new Error(`Frozen ${cohort} round ${round} cohort does not exist.`);
    return undefined;
  }
  return planSchema.parse(parsed);
}

async function writePlan(plan: CohortPlan) { await writeJson(planPath(plan.cohort, plan.round), planSchema.parse(plan)); }
function planPath(cohort: "discovery" | "validation", round: 1 | 2) { return join(root, `${cohort}-${round}-plan.json`); }
async function writeJson(path: string, input: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(input, null, 2)}\n`); }
async function readJson(path: string) { return readFile(path, "utf8").then((text) => JSON.parse(text) as unknown).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error)); }
async function exists(path: string) { return readFile(path).then(() => true).catch(() => false); }
function canonicalUrl(input: string) { const url = new URL(input); if (url.protocol !== "https:") throw new Error("Quality targets must use HTTPS."); url.hash = ""; return url.toString(); }
function requiredCohort() { return cohortSchema.parse(required("cohort")); }
function requiredRound(cohort: "discovery" | "validation") {
  const parsed = value("round") ? Number(value("round")) : 1;
  const round = roundSchema.parse(parsed);
  if (cohort === "discovery" && round !== 1) throw new Error("Discovery has exactly one frozen baseline cohort.");
  return round;
}
function values(name: string) { return process.argv.slice(3).filter((item) => item.startsWith(`--${name}=`)).map((item) => item.slice(name.length + 3)); }
function value(name: string) { return values(name).at(-1); }
function required(name: string) { const result = value(name); if (!result) throw new Error(`--${name}= is required.`); return result; }
function yesNo(name: string) { return z.enum(["yes", "no"]).parse(required(name)) === "yes"; }
function isRecord(input: unknown): input is Record<string, unknown> { return Boolean(input) && typeof input === "object" && !Array.isArray(input); }
function isCredibleReview(input: unknown, role: string) { return isRecord(input) && input.role === role && input.credible === true && (role !== "independent" || input.independentAttestation === true); }
function validEditBattery(input: unknown) {
  if (!isRecord(input) || input.schemaVersion !== "site-edit-battery-report-v1" || !Array.isArray(input.results)) return false;
  const expected = new Set(["element_restyle", "add_page", "move_form", "mobile_fix"]);
  for (const result of input.results) {
    if (!isRecord(result) || typeof result.taskId !== "string" || result.status !== "succeeded" || result.artifactGate !== "passed") return false;
    expected.delete(result.taskId);
  }
  return expected.size === 0;
}
function validAgentReadyReport(input: unknown) {
  return isRecord(input)
    && input.schemaVersion === "agent-ready-sites-report-v1"
    && input.ok === true
    && input.externalScan === "passed"
    && Array.isArray(input.liveSites)
    && input.liveSites.length >= 3;
}
function print(input: unknown) { process.stdout.write(`${JSON.stringify(input, null, 2)}\n`); }
function progress(targetId: string, stage: string, detail: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ type: "site_quality_progress", targetId, stage, at: new Date().toISOString(), ...detail })}\n`);
}
