/**
 * Canonical 20-URL auto-body launch pilot.
 *
 * This is a product gate, not another grader. It records the canonical
 * pipeline's objective gate, final judge, retry, evidence, and claim-safety
 * outputs and exits nonzero when an approved launch threshold is missed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { generationFailureDetail } from "../lib/generation-failure";
import { generateSiteTimeoutMs, generationTimeoutSignal } from "../lib/generation-timeout";
import type { GenerationEvidenceManifestV1 } from "../lib/generation-evidence-manifest";
import type { GenerationPipelineTrace } from "../lib/generation-pipeline";
import type { GenerationQaBlocker } from "../lib/models";
import { repository } from "../lib/repository";
import { generateSite } from "../lib/site-candidate-service";

const defaultTargetsFile = "config/benchmark-targets/auto-body-pilot.txt";
const defaultReportPath = ".data/benchmarks/canonical-auto-body-pilot.ndjson";
const requiredTargetCount = 20;

type ParsedArgs = {
  reportPath: string;
  targetsFile: string;
};

type PilotTargetResult = {
  kind: "canonical_auto_body_pilot_target";
  runId: string;
  url: string;
  candidateId?: string;
  adminReviewUrl?: string;
  businessName?: string;
  vertical?: string;
  generationStatus: "ready" | "operator_review" | "failed";
  firstObjectivePass: boolean;
  firstJudgeShip: boolean;
  finalShip: boolean;
  copySchemaRetries: number;
  unsupportedPublicClaims: number;
  trace?: GenerationPipelineTrace["counts"];
  evidenceYield?: GenerationEvidenceManifestV1["yield"];
  blockers: Array<Pick<GenerationQaBlocker, "id" | "title" | "detail" | "category">>;
  failure?: ReturnType<typeof generationFailureDetail>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    targetsFile: process.env.LODESTA_BENCHMARK_TARGETS_FILE ?? defaultTargetsFile,
    reportPath: process.env.LODESTA_BENCHMARK_REPORT_PATH ?? defaultReportPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--targets-file") {
      parsed.targetsFile = requiredValue(argv, ++index, arg);
    } else if (arg === "--report") {
      parsed.reportPath = requiredValue(argv, ++index, arg);
    } else {
      throw new Error(`Unknown pilot argument: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function readTargets(path: string) {
  const urls = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.startsWith("http"));
  const unique = [...new Set(urls)];
  if (unique.length !== requiredTargetCount) {
    throw new Error(`Canonical auto-body pilot requires exactly ${requiredTargetCount} unique URLs; found ${unique.length} in ${path}.`);
  }
  return unique;
}

async function runTarget(runId: string, url: string): Promise<PilotTargetResult> {
  const timeout = generationTimeoutSignal(generateSiteTimeoutMs(), `canonical auto-body pilot target ${url}`);
  console.error(JSON.stringify({ kind: "canonical_auto_body_pilot_progress", runId, event: "target_start", url }));
  try {
    const result = await generateSite({
      repository,
      mode: "fresh",
      input: { url },
      source: "api",
      actorType: "operator",
      candidatePurpose: "test_generation",
      metadata: { reason: "canonical 20-url auto-body launch pilot", pilotRunId: runId },
      signal: timeout.signal
    });
    const assessment = result.bundle.presenceAssessment;
    const trace = assessment.generationTrace;
    const firstAttempt = trace?.attempts[0];
    const finalAttempt = trace?.attempts.at(-1);
    const version = result.bundle.siteModel.versions[0];
    const blockers = normalizedBlockers(version?.generationQa?.blockers);
    const unsupportedPublicClaims = blockers.filter((blocker) => blocker.id.startsWith("sensitive_claim_")).length;
    const record: PilotTargetResult = {
      kind: "canonical_auto_body_pilot_target",
      runId,
      url,
      candidateId: result.siteCandidateId,
      adminReviewUrl: `/admin/site-candidates/${result.siteCandidateId}`,
      businessName: result.bundle.businessProfile.name,
      vertical: result.bundle.businessProfile.vertical,
      generationStatus: result.generation.status === "ready" ? "ready" : "operator_review",
      firstObjectivePass: firstAttempt?.gateStatus === "pass",
      firstJudgeShip: firstAttempt?.judgeVerdict === "ship",
      finalShip: result.generation.status === "ready" && finalAttempt?.judgeVerdict === "ship",
      copySchemaRetries: trace ? Math.max(0, trace.counts.copyModelAttempts - trace.counts.copies) : 0,
      unsupportedPublicClaims,
      trace: trace?.counts,
      evidenceYield: assessment.evidenceManifest?.yield,
      blockers
    };
    console.error(JSON.stringify({ kind: "canonical_auto_body_pilot_progress", runId, event: "target_done", url, generationStatus: record.generationStatus }));
    return record;
  } catch (error) {
    const failure = generationFailureDetail(error, { stage: "compile", code: "unknown_generation_failure" });
    console.error(JSON.stringify({ kind: "canonical_auto_body_pilot_progress", runId, event: "target_failed", url, failure }));
    return {
      kind: "canonical_auto_body_pilot_target",
      runId,
      url,
      generationStatus: "failed",
      firstObjectivePass: false,
      firstJudgeShip: false,
      finalShip: false,
      copySchemaRetries: 0,
      unsupportedPublicClaims: 0,
      blockers: [],
      failure
    };
  } finally {
    timeout.clear();
  }
}

function normalizedBlockers(blockers: readonly GenerationQaBlocker[] | undefined) {
  return (blockers ?? []).map((blocker) => ({
    id: blocker.id,
    title: blocker.title,
    detail: blocker.detail,
    category: blocker.category
  }));
}

function count(results: PilotTargetResult[], predicate: (result: PilotTargetResult) => boolean) {
  return results.filter(predicate).length;
}

function appendReport(path: string, records: unknown[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n", { flag: "a" });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const urls = readTargets(parsed.targetsFile);
  const runId = new Date().toISOString();
  const results: PilotTargetResult[] = [];
  for (const url of urls) results.push(await runTarget(runId, url));

  const metrics = {
    targetCount: results.length,
    firstObjectivePasses: count(results, (result) => result.firstObjectivePass),
    firstJudgeShips: count(results, (result) => result.firstJudgeShip),
    finalShips: count(results, (result) => result.finalShip),
    operatorReviews: count(results, (result) => result.generationStatus === "operator_review"),
    failures: count(results, (result) => result.generationStatus === "failed"),
    copySchemaRetries: results.reduce((sum, result) => sum + result.copySchemaRetries, 0),
    unsupportedPublicClaims: results.reduce((sum, result) => sum + result.unsupportedPublicClaims, 0),
    evidence: {
      proposed: results.reduce((sum, result) => sum + (result.evidenceYield?.proposed ?? 0), 0),
      accepted: results.reduce((sum, result) => sum + (result.evidenceYield?.accepted ?? 0), 0),
      rejected: results.reduce((sum, result) => sum + (result.evidenceYield?.rejected ?? 0), 0),
      sourceSparseUrls: count(results, (result) => result.evidenceYield?.sourceSparse === true)
    }
  };
  const failures = [
    ...(metrics.firstObjectivePasses === 20 ? [] : [`First-compile objective pass: ${metrics.firstObjectivePasses}/20; required 20/20.`]),
    ...(metrics.firstJudgeShips >= 14 ? [] : [`First-judge ship: ${metrics.firstJudgeShips}/20; required at least 14/20.`]),
    ...(metrics.finalShips >= 18 ? [] : [`Final ship: ${metrics.finalShips}/20; required at least 18/20.`]),
    ...(metrics.copySchemaRetries <= 1 ? [] : [`Whole-site copy schema retries: ${metrics.copySchemaRetries}; allowed at most 1.`]),
    ...(metrics.unsupportedPublicClaims === 0 ? [] : [`Unsupported public claims: ${metrics.unsupportedPublicClaims}; required 0.`])
  ];
  const summary = {
    kind: "canonical_auto_body_pilot_summary",
    runId,
    targetsFile: parsed.targetsFile,
    thresholds: {
      firstObjectivePasses: 20,
      firstJudgeShips: 14,
      finalShips: 18,
      maxCopySchemaRetries: 1,
      unsupportedPublicClaims: 0
    },
    metrics,
    status: failures.length ? "fail" : "pass",
    failures
  };
  appendReport(parsed.reportPath, [
    { kind: "canonical_auto_body_pilot_run", runId, targetsFile: parsed.targetsFile, targetCount: urls.length },
    ...results,
    summary
  ]);
  for (const result of results) console.log(JSON.stringify(result));
  console.log(JSON.stringify(summary));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
