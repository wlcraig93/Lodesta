/**
 * Benchmark vector cadence (next-level plan, measurement loop).
 *
 * Regenerates the benchmark shop set through the live pipeline and reports
 * candidate readiness, blocker categories, visual QA source/score, and cost.
 * Run after every generation-system batch; the trajectory of this output is
 * the product's honest progress meter.
 *
 *   npm run benchmark:vector                  # default Austin auto set
 *   npm run benchmark:vector -- <url..>       # explicit targets
 *   npm run benchmark:vector:weekly           # mixed-vertical report from configured targets
 *   npm run benchmark:vector -- --mixed       # mixed-vertical target set
 *   npm run benchmark:vector -- --targets-file ./targets.txt --report .data/benchmarks/vector.ndjson
 *
 * Requires .env.local (OpenAI + Supabase + Places). Costs real LLM calls.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { generateSite } from "../lib/site-candidate-service";
import { repository } from "../lib/repository";
import { generationFailureDetail } from "../lib/generation-failure";
import { generateSiteTimeoutMs, generationTimeoutSignal } from "../lib/generation-timeout";
import type { GenerationCostEstimate, GenerationQaBlocker, GenerationQaReadiness, SiteArtifactRecord, VisualQaResult } from "../lib/models";

const defaultTargets = [
  "http://www.texastires30.com/",
  "https://www.lambstire.com/locations/tx/austin/auto-repair-5405-n-lamar"
];

type ParsedArgs = {
  mixed: boolean;
  reportPath?: string;
  targetArgs: string[];
  targetsFile?: string;
};

type BenchmarkTarget = {
  url: string;
  expectedVertical?: string;
};

type BenchmarkTargets = {
  label: string;
  targets: BenchmarkTarget[];
  urls: string[];
};

type TargetCostSample = {
  url: string;
  status: string;
  costEstimate?: GenerationCostEstimate;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { mixed: false, targetArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mixed") {
      parsed.mixed = true;
      continue;
    }
    if (arg === "--report") {
      const reportPath = argv[index + 1];
      if (!reportPath) throw new Error("--report requires an output path.");
      parsed.reportPath = reportPath;
      index += 1;
      continue;
    }
    if (arg === "--targets-file") {
      const targetsFile = argv[index + 1];
      if (!targetsFile) throw new Error("--targets-file requires a path.");
      parsed.targetsFile = targetsFile;
      index += 1;
      continue;
    }
    if (arg.startsWith("http")) {
      parsed.targetArgs.push(arg);
      continue;
    }
    throw new Error(`Unknown benchmark argument: ${arg}`);
  }
  return parsed;
}

function parseUrlList(raw: string): string[] {
  return (raw.match(/https?:\/\/[^\s"',)]+/g) ?? []).map((url) => url.replace(/[.;]+$/, ""));
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls)];
}

function benchmarkTargetsFromUrls(label: string, urls: string[]): BenchmarkTargets {
  const unique = uniqueUrls(urls);
  return { label, urls: unique, targets: unique.map((url) => ({ url })) };
}

function parseTargetFile(raw: string): BenchmarkTarget[] {
  const targets: BenchmarkTarget[] = [];
  let expectedVertical: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const comment = line.match(/^\s*#\s*(.+?)\s*$/)?.[1];
    if (comment) {
      expectedVertical = expectedVerticalFromComment(comment) ?? expectedVertical;
      continue;
    }
    for (const url of parseUrlList(line)) targets.push({ url, expectedVertical });
  }
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.url)) return false;
    seen.add(target.url);
    return true;
  });
}

function expectedVerticalFromComment(comment: string): string | undefined {
  const normalized = comment.toLowerCase();
  if (/\brestaurant|cafe|dining\b/.test(normalized)) return "restaurant";
  if (/\bdental|dentist\b/.test(normalized)) return "dental";
  if (/\bbarber|salon|hair|beauty\b/.test(normalized)) return "beauty_salon";
  if (/\bauto[_\s-]?services|automotive|tire|mechanic\b/.test(normalized)) return "auto_services";
  if (/\bauto[_\s-]?body|collision\b/.test(normalized)) return "auto_body";
  if (/\bhome services\b/.test(normalized)) return "home_services";
  return undefined;
}

function benchmarkTargets(parsed: ParsedArgs): BenchmarkTargets {
  if (parsed.targetArgs.length) return benchmarkTargetsFromUrls("explicit_args", parsed.targetArgs);

  const targetsFile = parsed.targetsFile ?? process.env.LODESTA_BENCHMARK_TARGETS_FILE;
  if (targetsFile) {
    const targets = parseTargetFile(readFileSync(targetsFile, "utf8"));
    if (!targets.length) throw new Error(`Benchmark targets file has no http(s) URLs: ${targetsFile}`);
    return { label: "targets_file", targets, urls: targets.map((target) => target.url) };
  }

  const envTargets = process.env.LODESTA_BENCHMARK_URLS ? uniqueUrls(parseUrlList(process.env.LODESTA_BENCHMARK_URLS)) : [];
  if (envTargets.length) return benchmarkTargetsFromUrls("env_urls", envTargets);

  if (parsed.mixed) {
    throw new Error(
      "Mixed-vertical benchmark runs require LODESTA_BENCHMARK_URLS or LODESTA_BENCHMARK_TARGETS_FILE with real US business URLs. Visual template benchmark references are not valid generation targets."
    );
  }
  return benchmarkTargetsFromUrls("default_austin_auto", defaultTargets);
}

function minimumScoredTargets() {
  const raw = process.env.LODESTA_BENCHMARK_MIN_SCORED_TARGETS;
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function minimumScoredTargetsPerMeasuredVertical(targets: BenchmarkTargets) {
  const raw = process.env.LODESTA_BENCHMARK_MIN_SCORED_PER_VERTICAL;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
  }
  return targets.label === "targets_file" || targets.label === "env_urls" ? 2 : 1;
}

function appendReport(reportPath: string, records: unknown[]) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", { flag: "a" });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const targets = benchmarkTargets(parsed);
  const minScoredTargets = minimumScoredTargets();
  const minScoredPerMeasuredVertical = minimumScoredTargetsPerMeasuredVertical(targets);
  const runId = new Date().toISOString();
  const targetTimeoutMs = generateSiteTimeoutMs();
  const reportRecords: unknown[] = [
    {
      kind: "benchmark_vector_run",
      runId,
      targetSet: targets.label,
      targetCount: targets.urls.length,
      createdAt: runId
    }
  ];
  const checkedTargets: Array<{ url: string; readiness: GenerationQaReadiness; blockerCount: number; visualJudgment?: Pick<VisualQaResult, "verdict" | "craftScore"> }> = [];
  const targetCosts: TargetCostSample[] = [];
  const checkedByVertical = new Map<string, number>();
  const targetByMeasuredVertical = targetCountsByMeasuredVertical(targets.targets);

  for (const target of targets.targets) {
    const url = target.url;
    const targetDeadline = generationTimeoutSignal(targetTimeoutMs, `benchmark target ${url}`);
    console.error(JSON.stringify({ kind: "benchmark_vector_progress", event: "target_start", runId, url, timeoutMs: targetTimeoutMs }));
    try {
      const result = await generateSite({
        repository,
        input: { url },
        source: "api",
        actorType: "operator",
        metadata: { reason: "benchmark vector cadence" },
        signal: targetDeadline.signal
      });
      const version = result.bundle.siteModel.versions[0];
      const qa = version?.generationQa;
      const measuredVertical = target.expectedVertical ?? result.bundle.businessProfile.vertical;
      const blockers = await blockersForCandidate(result.siteCandidateId, qa?.blockers);
      const readiness = qa?.readiness ?? (result.generation.status === "blocked" ? "blocked" : "unavailable");
      if (readiness !== "unavailable") {
        checkedTargets.push({
          url,
          readiness,
          blockerCount: blockers.length,
          visualJudgment: qa?.visualQa ? { verdict: qa.visualQa.verdict, craftScore: qa.visualQa.craftScore } : undefined
        });
        checkedByVertical.set(measuredVertical, (checkedByVertical.get(measuredVertical) ?? 0) + 1);
      }
      const costEstimate = result.bundle.presenceAssessment.generationCostEstimate;
      targetCosts.push({ url, status: result.generation.status, costEstimate });
      const record = {
        kind: "benchmark_vector_target",
        runId,
        url,
        candidateId: result.siteCandidateId,
        adminReviewUrl: `/admin/site-candidates/${result.siteCandidateId}`,
        vertical: result.bundle.businessProfile.vertical,
        expectedVertical: target.expectedVertical,
        status: result.generation.status,
        stage: stageForTarget(result.generation.status, blockers),
        readiness,
        visualQa: qa?.visualQa
          ? {
              source: qa.visualQa.source,
              verdict: qa.visualQa.verdict,
              craftScore: qa.visualQa.craftScore,
              findingCount: qa.visualQa.findings.length
            }
          : undefined,
        blockers,
        errorDetail: result.generation.status === "blocked"
          ? {
              stage: "precompile_gate",
              code: "precompile_generation_block",
              message: blockers.length ? "Generation blocked before scoring." : "Generation blocked."
            }
          : undefined,
        costEstimate
      };
      reportRecords.push(record);
      console.log(JSON.stringify(record));
      console.error(JSON.stringify({ kind: "benchmark_vector_progress", event: "target_done", runId, url, status: result.generation.status }));
    } catch (error) {
      const detail = generationFailureDetail(error, {
        stage: "compile",
        code: "unknown_generation_failure"
      });
      const failedCandidate = detail.siteCandidateId ? await repository.getSiteCandidate(detail.siteCandidateId).catch(() => null) : null;
      const blockers = detail.siteCandidateId ? await blockersForCandidate(detail.siteCandidateId, detail.blockers) : (detail.blockers ?? []);
      if (blockers.length) {
        checkedTargets.push({ url, readiness: "blocked", blockerCount: blockers.length });
        const measuredVertical = failedCandidate?.vertical ?? target.expectedVertical;
        if (measuredVertical) checkedByVertical.set(measuredVertical, (checkedByVertical.get(measuredVertical) ?? 0) + 1);
      }
      const costEstimate = failedCandidate?.bundle.presenceAssessment.generationCostEstimate;
      if (costEstimate) targetCosts.push({ url, status: "failed", costEstimate });
      const record = {
        kind: "benchmark_vector_target",
        runId,
        url,
        status: "failed",
        stage: detail.stage,
        candidateId: detail.siteCandidateId,
        adminReviewUrl: detail.siteCandidateId ? `/admin/site-candidates/${detail.siteCandidateId}` : undefined,
        vertical: failedCandidate?.vertical ?? target.expectedVertical,
        expectedVertical: target.expectedVertical,
        blockers,
        errorDetail: detail,
        validationIssues: detail.validationIssues,
        readiness: blockers.length ? "blocked" : "unavailable",
        costEstimate
      };
      reportRecords.push(record);
      console.log(JSON.stringify(record));
      console.error(JSON.stringify({ kind: "benchmark_vector_progress", event: "target_failed", runId, url, stage: detail.stage, code: detail.code }));
    } finally {
      targetDeadline.clear();
    }
  }
  const scoredTargets = checkedTargets.length;
  const failedTargets = targets.urls.length - scoredTargets;
  const readinessCounts = checkedTargets.reduce<Record<string, number>>((counts, target) => {
    counts[target.readiness] = (counts[target.readiness] ?? 0) + 1;
    return counts;
  }, {});
  const summary = {
    kind: "benchmark_vector_summary",
    runId,
    targetSet: targets.label,
    targetCount: targets.urls.length,
    scoredTargets,
    failedTargets,
    minScoredTargets,
    minScoredPerMeasuredVertical,
    readinessCounts,
    checkedByVertical: Object.fromEntries([...checkedByVertical.entries()].sort(([left], [right]) => left.localeCompare(right))),
    targetByMeasuredVertical: Object.fromEntries([...targetByMeasuredVertical.entries()].sort(([left], [right]) => left.localeCompare(right))),
    costTotals: costTotals(targetCosts)
  };
  reportRecords.push(summary);
  console.log(JSON.stringify(summary));
  const measuredVerticals = targetByMeasuredVertical.size ? targetByMeasuredVertical : checkedByVertical;
  const underScoredMeasuredVerticals = [...measuredVerticals.entries()]
    .map(([vertical]) => ({ vertical, scored: checkedByVertical.get(vertical) ?? 0, minScoredPerMeasuredVertical }))
    .filter((entry) => entry.scored < minScoredPerMeasuredVertical);
  if (scoredTargets < minScoredTargets || underScoredMeasuredVerticals.length) {
    const failure = {
      kind: "benchmark_vector_failure",
      runId,
      targetSet: targets.label,
      scoredTargets,
      minScoredTargets,
      underScoredMeasuredVerticals,
      reason: scoredTargets < minScoredTargets
        ? "Benchmark vector run produced fewer scored targets than required."
        : "Benchmark vector run produced fewer than the required scored targets for a measured vertical."
    };
    reportRecords.push(failure);
    console.error(JSON.stringify(failure));
    if (parsed.reportPath) appendReport(parsed.reportPath, reportRecords);
    process.exitCode = 1;
    return;
  }
  if (parsed.reportPath) appendReport(parsed.reportPath, reportRecords);
}

async function blockersForCandidate(siteCandidateId: string, qaBlockers: readonly GenerationQaBlocker[] | undefined) {
  const blockers = new Map<string, GenerationQaBlocker>();
  for (const blocker of qaBlockers ?? []) blockers.set(blocker.id, blocker);
  const artifacts = await repository.listSiteArtifacts({ siteCandidateId, scope: "qa_evidence" }).catch(() => []);
  for (const artifact of artifacts) {
    for (const blocker of blockersFromArtifact(artifact)) blockers.set(blocker.id, blocker);
  }
  return [...blockers.values()].map((blocker) => ({
    id: blocker.id,
    title: blocker.title,
    detail: blocker.detail,
    category: blocker.category,
    severity: blocker.severity
  }));
}

function blockersFromArtifact(artifact: SiteArtifactRecord): GenerationQaBlocker[] {
  const raw = artifact.payload.blockers;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is GenerationQaBlocker => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.title === "string" && typeof record.detail === "string";
  });
}

function stageForTarget(status: string, blockers: readonly unknown[]) {
  if (status === "blocked" && blockers.length) return "precompile_gate";
  if (status === "blocked") return "qa";
  return "qa";
}

function targetCountsByMeasuredVertical(targets: readonly BenchmarkTarget[]) {
  const counts = new Map<string, number>();
  for (const target of targets) {
    if (!target.expectedVertical) continue;
    counts.set(target.expectedVertical, (counts.get(target.expectedVertical) ?? 0) + 1);
  }
  return counts;
}

function costTotals(samples: TargetCostSample[]) {
  const estimates = samples.map((sample) => sample.costEstimate).filter((estimate): estimate is GenerationCostEstimate => Boolean(estimate));
  return {
    targetsWithCostEstimate: estimates.length,
    estimatedUnits: estimates.reduce((sum, estimate) => sum + estimate.estimatedUnits, 0),
    budgetUnits: estimates.reduce((sum, estimate) => sum + estimate.budgetUnits, 0),
    byStatus: samples.reduce<Record<string, { targets: number; estimatedUnits: number }>>((accumulator, sample) => {
      const current = accumulator[sample.status] ?? { targets: 0, estimatedUnits: 0 };
      current.targets += 1;
      current.estimatedUnits += sample.costEstimate?.estimatedUnits ?? 0;
      accumulator[sample.status] = current;
      return accumulator;
    }, {})
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
