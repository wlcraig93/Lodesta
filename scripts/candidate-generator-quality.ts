import "./load-env";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { repository } from "../lib/repository";
import { runInitialGeneratedSiteReadiness } from "../lib/generated-site-readiness";
import { generateSite } from "../lib/site-candidate-service";
import { setSupabaseJobGenerateSite } from "../lib/supabase/repository";
import type { GenerationQaMetadata, GenerationQaReadiness, SiteBundle, SiteCandidateRecord, SiteVersion } from "../lib/models";
import type { ModelFallbackPolicy } from "../lib/site-candidate-service";
import { getVisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import {
  defaultOpenAiRuntimeEditableSettings,
  seedOpenAiRuntimeSettings,
  setOperatorSettingsLocalFileForTests
} from "../lib/operator-settings";

type CandidateGrade = {
  candidateId: string;
  businessName: string;
  status: SiteCandidateRecord["status"];
  candidatePurpose: SiteCandidateRecord["candidatePurpose"];
  sourceUrl?: string;
  sourceHost?: string;
  readiness: GenerationQaReadiness;
  blockers: string[];
  warnings: string[];
  screenshots: {
    fullPage: number;
    section: number;
  };
  visualQa?: {
    source: string;
    verdict: string;
    craftScore?: number;
    summary: string;
    findings: Array<{
      id: string;
      category: string;
      severity: string;
      title: string;
      evidence: string;
      recommendation?: string;
      viewport?: string;
      defectCategory?: string;
      confidence?: number;
    }>;
    limitations: string[];
  };
  generationCost?: {
    mode: string;
    status: string;
    estimatedUnits: number;
    budgetUnits: number;
    lineItems: Array<{ id: string; quantity: number; units: number }>;
  };
  debug?: {
    designSystem?: {
      id: string;
      label: string;
      source: string;
    };
    renderedHomeSections: Array<{ id: string; templateId?: string; background?: string }>;
    siteDirector?: {
      status: string;
      requestedOrder: string[];
      acceptedOrder: string[];
      finalOrder: string[];
    };
  };
};

const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);
const modelFallbackPolicy: ModelFallbackPolicy = hasFlag("--allow-deterministic-fallback") ? "allow" : "fail";
const modelOverride = await configureModelOverride();

setSupabaseJobGenerateSite((options) => generateSite({ ...options, repository }));

switch (command) {
  case "generate":
    await generateCommand();
    break;
  case "grade":
    await gradeCommand();
    break;
  case "verify":
    await verifyCommand();
    break;
  case "baseline":
    await baselineCommand();
    break;
  default:
    usage();
    process.exit(command === "help" ? 0 : 1);
}

async function baselineCommand() {
  const url = valueAfter("--url") ?? "https://www.menciaautoshop.com/";
  const holdouts = valuesAfter("--holdout");
  const knownBadIds = valuesAfter("--known-bad-id");
  const premiumFixtureIds = valuesAfter("--manual-premium-id");
  const artifactRoot = await runArtifactRoot("baseline");
  const generatedGrades: CandidateGrade[] = [];
  const calibrationGrades: CandidateGrade[] = [];

  logProgress("baseline_generating_primary", { url });
  const generated = await generateDirect(url, { reason: "phase-0 baseline primary" });
  generatedGrades.push(await storedCandidateGrade(generated.siteCandidateId));

  for (const holdout of holdouts) {
    logProgress("baseline_generating_holdout", { url: holdout });
    const holdoutGenerated = await generateDirect(holdout, { reason: "phase-0 baseline holdout" });
    generatedGrades.push(await storedCandidateGrade(holdoutGenerated.siteCandidateId));
  }

  for (const candidateId of [...knownBadIds, ...premiumFixtureIds]) {
    calibrationGrades.push(await gradeCandidate(candidateId, artifactRoot));
  }

  const calibration = {
    knownBad: knownBadIds.map((candidateId) => {
      const grade = calibrationGrades.find((item) => item.candidateId === candidateId);
      return {
        candidateId,
        readiness: grade?.readiness,
        passesAsPremium: grade ? premiumFailures(grade).length === 0 : false,
        blockers: grade?.blockers.slice(0, 5) ?? []
      };
    }),
    manualPremium: premiumFixtureIds.map((candidateId) => {
      const grade = calibrationGrades.find((item) => item.candidateId === candidateId);
      return {
        candidateId,
        readiness: grade?.readiness,
        ready: grade?.readiness === "ready",
        blockers: grade?.blockers ?? [`${candidateId}: not graded`]
      };
    })
  };
  const report = {
    generatedAt: new Date().toISOString(),
    artifactRoot,
    url,
    holdouts,
    generatedGrades,
    calibrationGrades,
    calibration,
    costObservation: generatedGrades.map((grade) => ({
      candidateId: grade.candidateId,
      generationCost: grade.generationCost
    }))
  };
  const reportPath = join(artifactRoot, "baseline.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ reportPath, calibration, generatedCandidateIds: generatedGrades.map((grade) => grade.candidateId) }, null, 2));
}

async function generateCommand() {
  const url = requiredValue("--url");
  const viaJob = hasFlag("--via-job");
  const result = viaJob ? await generateViaJob(url) : await generateDirect(url);
  const grade = await storedCandidateGrade(result.siteCandidateId);
  const output = {
    mode: viaJob ? "via_job" : "direct",
    modelOverride,
    runId: result.runId,
    siteCandidateId: result.siteCandidateId,
    adminUrl: `/admin/site-candidates/${result.siteCandidateId}`,
    previewUrl: `/site-candidate-previews/${result.siteCandidateId}`,
    grade
  };
  console.log(JSON.stringify(output, null, 2));
}

async function configureModelOverride() {
  const generationModel = valueAfter("--generation-model");
  const visualQaModel = valueAfter("--visual-qa-model") ?? generationModel;
  if (!generationModel && !visualQaModel) return undefined;

  const settings = {
    ...defaultOpenAiRuntimeEditableSettings(),
    generationModel: generationModel ?? defaultOpenAiRuntimeEditableSettings().generationModel,
    visualQaModel: visualQaModel ?? defaultOpenAiRuntimeEditableSettings().visualQaModel
  };
  const fileName = `${settings.generationModel}--${settings.visualQaModel}`.replace(/[^a-z0-9._-]+/gi, "_");
  setOperatorSettingsLocalFileForTests(join(process.cwd(), ".data", "model-bakeoff", `${fileName}.json`));
  await seedOpenAiRuntimeSettings({ settings, changedBy: "candidate-quality:model-bakeoff" });
  return { generationModel: settings.generationModel, visualQaModel: settings.visualQaModel };
}

async function gradeCommand() {
  const candidateId = requiredValue("--id");
  const artifactRoot = await runArtifactRoot("grade");
  const grade = await gradeCandidate(candidateId, artifactRoot);
  const reportPath = join(artifactRoot, "grade.json");
  await writeFile(reportPath, JSON.stringify(grade, null, 2), "utf8");
  console.log(JSON.stringify({ reportPath, grade }, null, 2));
}

async function verifyCommand() {
  const runs = numberValue("--runs", 3);
  const url = valueAfter("--url") ?? "https://www.menciaautoshop.com/";
  const holdouts = valuesAfter("--holdout");
  const artifactRoot = await runArtifactRoot("verify");
  const grades: CandidateGrade[] = [];

  for (let index = 0; index < runs; index += 1) {
    logProgress("generating_primary", { index: index + 1, url });
    const generated = await generateDirect(url, { reason: "candidate generator quality verifier", runIndex: index + 1 });
    logProgress("generated_primary", { index: index + 1, candidateId: generated.siteCandidateId });
    const grade = await storedCandidateGrade(generated.siteCandidateId);
    grades.push(grade);
    console.log(JSON.stringify({ event: "read_stored_candidate_qa", index: index + 1, candidateId: grade.candidateId, readiness: grade.readiness }));
  }

  for (const holdout of holdouts) {
    logProgress("generating_holdout", { url: holdout });
    const generated = await generateDirect(holdout, { reason: "candidate generator quality holdout" });
    logProgress("generated_holdout", { url: holdout, candidateId: generated.siteCandidateId });
    const grade = await storedCandidateGrade(generated.siteCandidateId);
    grades.push(grade);
    console.log(JSON.stringify({ event: "read_stored_candidate_qa", url: holdout, candidateId: grade.candidateId, readiness: grade.readiness }));
  }

  let viaJobEquivalence: Awaited<ReturnType<typeof compareViaJobInputs>> | undefined;
  if (hasFlag("--via-job")) {
    logProgress("checking_via_job_equivalence", { url });
    viaJobEquivalence = await compareViaJobInputs(url);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    artifactRoot,
    url,
    runs,
    holdouts,
    grades,
    viaJobEquivalence
  };
  const reportPath = join(artifactRoot, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ reportPath, ready: grades.filter((grade) => grade.readiness === "ready").length, total: grades.length }, null, 2));

  if (hasFlag("--expect-premium")) {
    const failures = grades.flatMap((grade) => premiumFailures(grade));
    if (failures.length) throw new Error(`Candidate generator quality verifier failed:\n${failures.join("\n")}`);
  }
}

async function generateDirect(url: string, metadata: Record<string, unknown> = {}) {
  return generateSite({
    repository,
    input: { url },
    source: "api",
    actorType: "operator",
    metadata,
    candidatePurpose: "test_generation",
    modelFallbackPolicy
  });
}

async function generateViaJob(url: string) {
  const job = await repository.enqueueJob("generate_site", { url, candidatePurpose: "test_generation", modelFallbackPolicy });
  let completed = await repository.getJob(job.id);
  const deadline = Date.now() + 1000 * 60 * 20;
  while (Date.now() < deadline && completed?.status !== "completed") {
    if (completed?.status === "failed") {
      throw new Error(`generate_site job failed: ${completed.id} ${completed.error ?? ""}`);
    }
    const processed = completed?.status === "queued" ? await repository.processNextJob() : null;
    completed = await repository.getJob(job.id);
    if (!processed && completed?.status !== "completed" && completed?.status !== "running" && completed?.status !== "queued") {
      throw new Error(`generate_site job was not processed: ${job.id} ${completed?.status ?? "missing"}`);
    }
    if (completed?.status === "running" || completed?.status === "queued") await sleep(5000);
  }
  if (!completed || completed.status !== "completed") {
    throw new Error(`generate_site job did not complete: ${completed?.id ?? job.id} ${completed?.status ?? "missing"}`);
  }
  const siteCandidateId = typeof completed.result?.siteCandidateId === "string" ? completed.result.siteCandidateId : undefined;
  const runId = typeof completed.result?.runId === "string" ? completed.result.runId : completed.id;
  if (!siteCandidateId) throw new Error("generate_site job did not return a siteCandidateId.");
  const generation = await repository.getSiteCandidate(siteCandidateId);
  if (!generation) throw new Error(`Generated job candidate not found: ${siteCandidateId}`);
  return { runId, siteCandidateId, generation, bundle: generation.bundle };
}

async function gradeCandidate(candidateId: string, artifactRoot: string): Promise<CandidateGrade> {
  logProgress("grading_candidate", { candidateId });
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) throw new Error(`Unknown candidate: ${candidateId}`);
  const bundle = structuredClone(candidate.bundle);
  const version = draftVersion(bundle);
  if (!version) throw new Error(`Candidate ${candidateId} has no renderable version.`);
  const readiness = await runInitialGeneratedSiteReadiness({
    bundle,
    version,
    artifactRoot,
    modelFallbackPolicy
  });
  const qa = readiness.qa;
  logProgress("graded_candidate", {
    candidateId: candidate.id,
    readiness: qa.readiness,
    visualQaSource: qa.visualQa?.source,
    blockers: qa.blockers.length,
    sectionScreenshots: qa.inspectionSummary?.sectionScreenshotCount ?? 0
  });
  return candidateGradeFromQa(candidate, bundle, version, qa);
}

async function storedCandidateGrade(candidateId: string): Promise<CandidateGrade> {
  logProgress("reading_stored_candidate_qa", { candidateId });
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) throw new Error(`Unknown candidate: ${candidateId}`);
  const bundle = structuredClone(candidate.bundle);
  const version = draftVersion(bundle);
  if (!version) throw new Error(`Candidate ${candidateId} has no renderable version.`);
  const qa = version.generationQa;
  if (!qa || qa.schemaVersion !== "generation-qa-v4") {
    throw new Error(`Candidate ${candidateId} has no canonical stored generation-qa-v4 result.`);
  }
  logProgress("read_stored_candidate_qa", {
    candidateId,
    readiness: qa.readiness,
    visualQaSource: qa.visualQa?.source,
    blockers: qa.blockers.length,
    sectionScreenshots: qa.inspectionSummary?.sectionScreenshotCount ?? 0
  });
  return candidateGradeFromQa(candidate, bundle, version, qa);
}

function candidateGradeFromQa(
  candidate: SiteCandidateRecord,
  bundle: SiteBundle,
  version: SiteVersion,
  qa: GenerationQaMetadata
): CandidateGrade {
  return {
    candidateId: candidate.id,
    businessName: candidate.businessName,
    status: candidate.status,
    candidatePurpose: candidate.candidatePurpose,
    sourceUrl: candidate.sourceUrl,
    sourceHost: candidate.sourceHost,
    readiness: qa.readiness,
    blockers: qa.blockers.map((blocker) => blocker.id),
    warnings: qa.warnings.map((warning) => warning.id),
    screenshots: {
      fullPage: qa.inspectionSummary?.metricsByViewport ? Object.keys(qa.inspectionSummary.metricsByViewport).length : 0,
      section: qa.inspectionSummary?.sectionScreenshotCount ?? 0
    },
    visualQa: qa.visualQa
      ? {
          source: qa.visualQa.source,
          verdict: qa.visualQa.verdict,
          craftScore: qa.visualQa.craftScore,
          summary: qa.visualQa.summary,
          findings: qa.visualQa.findings,
          limitations: qa.visualQa.limitations
        }
      : undefined,
    generationCost: qa.generationCostEstimate
      ? {
          mode: qa.generationCostEstimate.mode,
          status: qa.generationCostEstimate.status,
          estimatedUnits: qa.generationCostEstimate.estimatedUnits,
          budgetUnits: qa.generationCostEstimate.budgetUnits,
          lineItems: qa.generationCostEstimate.lineItems.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            units: item.units
          }))
        }
      : undefined,
    debug: candidateDebug(bundle, version)
  };
}

function candidateDebug(bundle: SiteBundle, version: SiteVersion): CandidateGrade["debug"] {
  const siteDirector = bundle.presenceAssessment.siteDirectorPlanV1;
  const homePage = "pageComposition" in version ? version.pageComposition.pages.find((page) => page.id === "home") ?? version.pageComposition.pages[0] : undefined;
  return {
    designSystem: siteDirector?.designSystem
      ? {
          id: siteDirector.designSystem.id,
          label: siteDirector.designSystem.label,
          source: siteDirector.source
        }
      : undefined,
    renderedHomeSections:
      homePage?.sections.map((section) => {
        const visual = getVisualSectionV3(section.props);
        return {
          id: section.id,
          templateId: visual?.templateId,
          background: visual?.options.background.kind === "image" ? "image" : `${visual?.options.background.kind}:${visual?.options.background.token}`
        };
      }) ?? [],
    siteDirector: siteDirector
      ? {
          status: siteDirector.validation.status,
          requestedOrder: siteDirector.plan.home.sections.map((section) => section.id),
          acceptedOrder: siteDirector.validation.acceptedSectionBlueprints.map((section) => section.id),
          finalOrder: homePage?.sections.map((section) => section.id) ?? []
        }
      : undefined
  };
}

async function compareViaJobInputs(url: string) {
  const direct = await generateDirect(url, { reason: "via-job input equivalence direct" });
  const viaJob = await generateViaJob(url);
  await storedCandidateGrade(direct.siteCandidateId);
  await storedCandidateGrade(viaJob.siteCandidateId);
  const directCandidate = await repository.getSiteCandidate(direct.siteCandidateId);
  const jobCandidate = await repository.getSiteCandidate(viaJob.siteCandidateId);
  if (!directCandidate || !jobCandidate) throw new Error("Missing generated candidates for input equivalence check.");
  const directSnapshot = inputSnapshot(directCandidate.bundle);
  const jobSnapshot = inputSnapshot(jobCandidate.bundle);
  const equal = JSON.stringify(directSnapshot) === JSON.stringify(jobSnapshot);
  return {
    equal,
    directCandidateId: direct.siteCandidateId,
    jobCandidateId: viaJob.siteCandidateId,
    directSnapshot,
    jobSnapshot
  };
}

function inputSnapshot(bundle: SiteBundle) {
  const profile = bundle.businessProfile;
  return {
    sourceUrl: normalizeUrlSnapshot(bundle.presenceAssessment.sourceUrl),
    name: profile.name,
    vertical: profile.vertical,
    categories: normalizeStringList(profile.categories),
    phone: profile.phone,
    email: profile.email?.toLowerCase(),
    address: profile.address,
    hours: profile.hours,
    services: normalizeStringList(profile.services),
    serviceAreas: normalizeStringList(profile.serviceAreas),
    understanding: bundle.presenceAssessment.businessUnderstanding
      ? {
          vertical: bundle.presenceAssessment.businessUnderstanding.vertical,
          services: normalizeStringList(bundle.presenceAssessment.businessUnderstanding.cleanedServices.map((service) => service.name))
        }
      : undefined,
    mediaManifest: profile.photos.map((photo) => ({
      id: photo.id,
      source: photo.source,
      url: mediaUrlSnapshot(photo.url),
      width: photo.width,
      height: photo.height
    })).sort((left, right) => `${left.source}:${left.width}x${left.height}:${left.url}`.localeCompare(`${right.source}:${right.width}x${right.height}:${right.url}`))
  };
}

function mediaUrlSnapshot(url: string) {
  return url
    .replace(/\/api\/assets\/sitecand_[^/]+\//g, "/api/assets/<candidate>/")
    .replace(/scraped-photo-(\d+)-[a-f0-9]+\.(?:webp|png|jpe?g)$/i, "scraped-photo-$1");
}

function normalizeStringList(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizeUrlSnapshot(url: string | undefined) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

function draftVersion(bundle: SiteBundle): SiteVersion | undefined {
  return bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
}

function premiumFailures(grade: CandidateGrade) {
  const failures: string[] = [];
  if (grade.readiness !== "ready") failures.push(`${grade.candidateId}: readiness ${grade.readiness}`);
  if (grade.blockers.length) failures.push(`${grade.candidateId}: blockers ${grade.blockers.join(", ")}`);
  return failures;
}

async function runArtifactRoot(label: string) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = join(process.cwd(), ".data", "candidate-generator-quality", `${label}-${runId}`);
  await mkdir(artifactRoot, { recursive: true });
  return artifactRoot;
}

function requiredValue(name: string) {
  const value = valueAfter(name);
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
}

function valueAfter(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesAfter(name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function numberValue(name: string, fallback: number) {
  const raw = valueAfter(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive number.`);
  return Math.floor(parsed);
}

function hasFlag(name: string) {
  return args.includes(name);
}

function logProgress(event: string, payload: Record<string, unknown>) {
  console.error(JSON.stringify({ event, ...payload }));
}

function usage() {
  console.log(`Usage:
  npm run generate:candidate -- --url https://www.menciaautoshop.com/ [--generation-model MODEL] [--visual-qa-model MODEL] [--via-job] [--allow-deterministic-fallback]
  npm run grade:candidate -- --id sitecand_... [--allow-deterministic-fallback]
  npm run baseline:candidate-generator-quality -- --url https://www.menciaautoshop.com/ [--holdout URL] [--known-bad-id sitecand_...] [--manual-premium-id sitecand_...]
  npm run verify:candidate-generator-quality -- --url https://www.menciaautoshop.com/ --runs 3 [--holdout URL] [--via-job] [--expect-premium] [--allow-deterministic-fallback]

  Canonical quality runs fail when model-backed generation or final visual QA is unavailable.
  Use --allow-deterministic-fallback only for offline renderer/template debugging.
  `);
}
