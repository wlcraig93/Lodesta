import "./load-env";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { computeFingerprintV1, fingerprintDistanceThresholdV1, minPairwiseDistanceV1, type SiteFingerprintV1 } from "../lib/fingerprint-v1";
import { repository } from "../lib/repository";
import { runInitialGeneratedSiteReadiness } from "../lib/generated-site-readiness";
import { generateSite } from "../lib/site-candidate-service";
import { setSupabaseJobGenerateSite } from "../lib/supabase/repository";
import type { GenerationQaRepairTarget, GenerationScorecard, SiteBundle, SiteCandidateRecord, SiteVersion } from "../lib/models";
import type { ModelFallbackPolicy } from "../lib/site-candidate-service";
import { getVisualSectionV3 } from "../lib/generated-site-v3-visual-controls";

type CandidateGrade = {
  candidateId: string;
  businessName: string;
  status: SiteCandidateRecord["status"];
  candidatePurpose: SiteCandidateRecord["candidatePurpose"];
  sourceUrl?: string;
  sourceHost?: string;
  verdict?: GenerationScorecard["verdict"];
  dimensions: Array<{
    id: string;
    score?: number;
    required: boolean;
    passes?: boolean;
    premiumPasses?: boolean;
    findings: Array<{ id: string; severity: string; title: string; detail: string; viewport?: string }>;
  }>;
  blockers: string[];
  warnings: string[];
  screenshots: {
    fullPage: number;
    section: number;
  };
  visualQa?: {
    source: string;
    score?: Record<string, number>;
    limitations: string[];
  };
  repairTargets: Array<
    Pick<
      GenerationQaRepairTarget,
      "target" | "activation" | "priority" | "findingId" | "title" | "sectionId" | "templateId" | "slotId" | "copyPart" | "itemIndex" | "viewport"
    >
  >;
  generationCost?: {
    mode: string;
    status: string;
    estimatedUnits: number;
    budgetUnits: number;
    lineItems: Array<{ id: string; quantity: number; units: number }>;
  };
  fingerprint?: ReturnType<typeof computeFingerprintV1>;
  debug?: {
    designBrief?: {
      register: string;
      brandPosture: string;
      presentationMap?: unknown;
      compositionPlan?: string[];
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
  generatedGrades.push(await gradeCandidate(generated.siteCandidateId, artifactRoot));

  for (const holdout of holdouts) {
    logProgress("baseline_generating_holdout", { url: holdout });
    const holdoutGenerated = await generateDirect(holdout, { reason: "phase-0 baseline holdout" });
    generatedGrades.push(await gradeCandidate(holdoutGenerated.siteCandidateId, artifactRoot));
  }

  for (const candidateId of [...knownBadIds, ...premiumFixtureIds]) {
    calibrationGrades.push(await gradeCandidate(candidateId, artifactRoot));
  }

  const calibration = {
    knownBad: knownBadIds.map((candidateId) => {
      const grade = calibrationGrades.find((item) => item.candidateId === candidateId);
      return {
        candidateId,
        verdict: grade?.verdict,
        passesAsPremium: grade ? premiumFailures(grade).length === 0 : false,
        topRepairTargets: grade?.repairTargets.slice(0, 5) ?? []
      };
    }),
    manualPremium: premiumFixtureIds.map((candidateId) => {
      const grade = calibrationGrades.find((item) => item.candidateId === candidateId);
      return {
        candidateId,
        verdict: grade?.verdict,
        reaches90RequiredDimensions: grade ? requiredDimensionFailures(grade).length === 0 : false,
        dimensionFailures: grade ? requiredDimensionFailures(grade) : [`${candidateId}: not graded`]
      };
    })
  };
  const fingerprints = generatedGrades.flatMap((grade) => (grade.fingerprint ? [grade.fingerprint] : []));
  const report = {
    generatedAt: new Date().toISOString(),
    artifactRoot,
    url,
    holdouts,
    generatedGrades,
    calibrationGrades,
    calibration,
    fingerprint: {
      minPairwiseDistance: minPairwiseDistanceV1(fingerprints),
      threshold: fingerprintDistanceThresholdV1,
      observedOnly: true
    },
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
  const artifactRoot = await runArtifactRoot("generate");
  const result = viaJob ? await generateViaJob(url) : await generateDirect(url);
  const grade = await gradeCandidate(result.siteCandidateId, artifactRoot);
  const output = {
    mode: viaJob ? "via_job" : "direct",
    runId: result.runId,
    siteCandidateId: result.siteCandidateId,
    adminUrl: `/admin/site-candidates/${result.siteCandidateId}`,
    previewUrl: `/site-candidate-previews/${result.siteCandidateId}`,
    grade
  };
  console.log(JSON.stringify(output, null, 2));
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
  const fingerprints: SiteFingerprintV1[] = [];

  for (let index = 0; index < runs; index += 1) {
    logProgress("generating_primary", { index: index + 1, url });
    const generated = await generateDirect(url, { reason: "candidate generator quality verifier", runIndex: index + 1 });
    logProgress("generated_primary", { index: index + 1, candidateId: generated.siteCandidateId });
    const grade = await gradeCandidate(generated.siteCandidateId, artifactRoot);
    grades.push(grade);
    if (grade.fingerprint) fingerprints.push(grade.fingerprint);
    console.log(JSON.stringify({ event: "graded_primary", index: index + 1, candidateId: grade.candidateId, verdict: grade.verdict }));
  }

  for (const holdout of holdouts) {
    logProgress("generating_holdout", { url: holdout });
    const generated = await generateDirect(holdout, { reason: "candidate generator quality holdout" });
    logProgress("generated_holdout", { url: holdout, candidateId: generated.siteCandidateId });
    const grade = await gradeCandidate(generated.siteCandidateId, artifactRoot);
    grades.push(grade);
    if (grade.fingerprint) fingerprints.push(grade.fingerprint);
    console.log(JSON.stringify({ event: "graded_holdout", url: holdout, candidateId: grade.candidateId, verdict: grade.verdict }));
  }

  let viaJobEquivalence: Awaited<ReturnType<typeof compareViaJobInputs>> | undefined;
  if (hasFlag("--via-job")) {
    logProgress("checking_via_job_equivalence", { url });
    viaJobEquivalence = await compareViaJobInputs(url, artifactRoot);
  }

  const minDistance = minPairwiseDistanceV1(fingerprints);
  const report = {
    generatedAt: new Date().toISOString(),
    artifactRoot,
    url,
    runs,
    holdouts,
    grades,
    viaJobEquivalence,
    fingerprint: {
      minPairwiseDistance: minDistance,
      threshold: fingerprintDistanceThresholdV1,
      observedOnly: true,
      healthy: minDistance === undefined || minDistance >= fingerprintDistanceThresholdV1
    }
  };
  const reportPath = join(artifactRoot, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ reportPath, fingerprint: report.fingerprint }, null, 2));

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
  const scorecard = qa.scorecard;
  logProgress("graded_candidate", {
    candidateId,
    verdict: scorecard?.verdict,
    visualQaSource: qa.visualQa?.source,
    blockers: qa.blockers.length,
    sectionScreenshots: qa.inspectionSummary?.sectionScreenshotCount ?? 0
  });
  return {
    candidateId,
    businessName: candidate.businessName,
    status: candidate.status,
    candidatePurpose: candidate.candidatePurpose,
    sourceUrl: candidate.sourceUrl,
    sourceHost: candidate.sourceHost,
    verdict: scorecard?.verdict,
    dimensions:
      scorecard?.dimensions.map((dimension) => ({
        id: dimension.id,
        score: dimension.score,
        required: dimension.requirement === "required",
        passes: dimension.passes,
        premiumPasses: dimension.premiumPasses,
        findings: dimension.findings.map((finding) => ({
          id: finding.id,
          severity: finding.severity,
          title: finding.title,
          detail: finding.detail,
          viewport: finding.viewport
        }))
      })) ?? [],
    blockers: qa.blockers.map((blocker) => blocker.id),
    warnings: qa.warnings.map((warning) => warning.id),
    screenshots: {
      fullPage: qa.inspectionSummary?.metricsByViewport ? Object.keys(qa.inspectionSummary.metricsByViewport).length : 0,
      section: qa.inspectionSummary?.sectionScreenshotCount ?? 0
    },
    visualQa: qa.visualQa
      ? {
          source: qa.visualQa.source,
          score: qa.visualQa.score,
          limitations: qa.visualQa.limitations
        }
      : undefined,
    repairTargets:
      qa.repairTargets?.slice(0, 12).map((target) => ({
        target: target.target,
        activation: target.activation,
        priority: target.priority,
        findingId: target.findingId,
        title: target.title,
        sectionId: target.sectionId,
        templateId: target.templateId,
        slotId: target.slotId,
        copyPart: target.copyPart,
        itemIndex: target.itemIndex,
        viewport: target.viewport
      })) ?? [],
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
    fingerprint: computeFingerprintV1(version),
    debug: candidateDebug(bundle, version)
  };
}

function candidateDebug(bundle: SiteBundle, version: SiteVersion): CandidateGrade["debug"] {
  const designBrief = bundle.presenceAssessment.designBrief;
  const siteDirector = bundle.presenceAssessment.siteDirectorPlanV1;
  const homePage = "pageComposition" in version ? version.pageComposition.pages.find((page) => page.id === "home") ?? version.pageComposition.pages[0] : undefined;
  return {
    designBrief: designBrief
      ? {
          register: designBrief.profile.register,
          brandPosture: designBrief.profile.brandPosture,
          presentationMap: designBrief.presentationMap,
          compositionPlan: designBrief.compositionPlan?.sections.map((section) => section.intent)
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

async function compareViaJobInputs(url: string, artifactRoot: string) {
  const direct = await generateDirect(url, { reason: "via-job input equivalence direct" });
  const viaJob = await generateViaJob(url);
  await gradeCandidate(direct.siteCandidateId, artifactRoot);
  await gradeCandidate(viaJob.siteCandidateId, artifactRoot);
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
  if (grade.verdict !== "premium") failures.push(`${grade.candidateId}: verdict ${grade.verdict ?? "missing"}`);
  for (const dimension of grade.dimensions) {
    if ((dimension.score ?? -1) < 90) failures.push(`${grade.candidateId}: ${dimension.id} ${dimension.score ?? "unscored"} < 90`);
    if (dimension.passes === false) failures.push(`${grade.candidateId}: ${dimension.id} failed readiness gate`);
    if (dimension.premiumPasses === false) failures.push(`${grade.candidateId}: ${dimension.id} failed premium gate`);
  }
  if (grade.blockers.length) failures.push(`${grade.candidateId}: blockers ${grade.blockers.join(", ")}`);
  return failures;
}

function requiredDimensionFailures(grade: CandidateGrade) {
  return grade.dimensions
    .filter((dimension) => dimension.required && (dimension.score ?? -1) < 90)
    .map((dimension) => `${grade.candidateId}: ${dimension.id} ${dimension.score ?? "unscored"} < 90`);
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
  npm run generate:candidate -- --url https://www.menciaautoshop.com/ [--via-job] [--allow-deterministic-fallback]
  npm run grade:candidate -- --id sitecand_... [--allow-deterministic-fallback]
  npm run baseline:candidate-generator-quality -- --url https://www.menciaautoshop.com/ [--holdout URL] [--known-bad-id sitecand_...] [--manual-premium-id sitecand_...]
  npm run verify:candidate-generator-quality -- --url https://www.menciaautoshop.com/ --runs 3 [--holdout URL] [--via-job] [--expect-premium] [--allow-deterministic-fallback]

  Canonical quality runs fail when model-backed generation or final visual QA is unavailable.
  Use --allow-deterministic-fallback only for offline renderer/template debugging.
  `);
}
