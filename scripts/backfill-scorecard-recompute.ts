/**
 * Recompute stored generation scorecards and derived repair targets after QA
 * semantic changes.
 *
 * This script is intentionally a dry-run first migration tool: run with
 * `--check` before adding strict assertions that depend on current scorecard
 * semantics.
 *
 *   npm run backfill:scorecard-recompute -- --check
 *   npm run backfill:scorecard-recompute
 */
import "./load-env";

import type { GenerationQaBlocker, SiteBundle, SiteVersion } from "../lib/models";
import { buildFactCoverageReport } from "../lib/fact-coverage";
import { buildGenerationScorecard, scorecardEnforcementBlockers } from "../lib/generation-scorecard";
import { buildGenerationRepairTargets } from "../lib/generated-site-repair-targets";
import { evaluateSeoStructure } from "../lib/seo-structure";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { supabaseRepository } from "../lib/supabase/repository";

const PAGE_SIZE = 100;

type Counts = {
  fixedRows: number;
  cleanRows: number;
  recomputedScorecards: number;
  skippedRows: number;
  failedRows: number;
};

type RecomputeResult<T> = {
  value: T;
  changed: boolean;
  recomputedScorecards: number;
  skipped: boolean;
  errors: string[];
};

function scorecardInputBlockers(blockers: GenerationQaBlocker[]) {
  return blockers.filter((blocker) => !blocker.id.startsWith("scorecard_"));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, key === "evaluatedAt" ? "<evaluatedAt>" : stableNormalize(record[key])])
  );
}

function samePayload(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right);
}

function recomputeVersionScorecard(bundle: SiteBundle, version: SiteVersion, path: string): RecomputeResult<SiteVersion> {
  const qa = version.generationQa;
  if (!qa?.qualityReport) {
    return { value: version, changed: false, recomputedScorecards: 0, skipped: true, errors: [] };
  }

  const baseBlockers = scorecardInputBlockers(qa.blockers ?? []);
  const factCoverage = buildFactCoverageReport({ bundle, version });
  const scorecard = buildGenerationScorecard({
    qualityReport: qa.qualityReport,
    visualQa: qa.visualQa,
    bundle,
    version,
    blockers: baseBlockers,
    warnings: qa.warnings ?? [],
    inspectionSummary: qa.inspectionSummary,
    brandCueApplied: bundle.presenceAssessment.brandCueReport?.applied,
    aboveFoldCta: qa.inspectionSummary?.metricsByViewport?.desktop?.aboveFoldCtaDetected,
    telLinkCount: qa.inspectionSummary?.metricsByViewport?.desktop?.telLinkCount,
    seoScore: evaluateSeoStructure({ bundle, version }).score,
    factCoverageRatio: factCoverage.coverageRatio
  });
  const enforcementBlockers = scorecardEnforcementBlockers(scorecard);
  const nextBlockers = [...baseBlockers, ...enforcementBlockers];
  const repairTargets = buildGenerationRepairTargets({
    blockers: nextBlockers,
    warnings: qa.warnings ?? [],
    scorecard,
    inspectionSummary: qa.inspectionSummary,
    visualQa: qa.visualQa
  });
  const nextQa = {
    ...qa,
    blockers: nextBlockers,
    readiness: nextBlockers.length ? ("blocked" as const) : ("ready" as const),
    scorecard,
    factCoverage,
    repairTargets
  };
  const changed =
    !samePayload(qa.scorecard, scorecard) ||
    !samePayload(qa.factCoverage ?? null, factCoverage) ||
    !samePayload(qa.repairTargets ?? [], repairTargets) ||
    !samePayload(qa.blockers ?? [], nextBlockers) ||
    qa.readiness !== nextQa.readiness;
  if (!changed) {
    return { value: version, changed: false, recomputedScorecards: 0, skipped: false, errors: [] };
  }
  return {
    value: { ...version, generationQa: nextQa },
    changed: true,
    recomputedScorecards: 1,
    skipped: false,
    errors: path ? [] : ["Missing scorecard path"]
  };
}

function recomputeBundle(bundle: SiteBundle, rowId: string): RecomputeResult<SiteBundle> {
  let changed = false;
  let recomputedScorecards = 0;
  let skipped = false;
  const errors: string[] = [];
  const versions = bundle.siteModel.versions.map((version, index) => {
    const result = recomputeVersionScorecard(bundle, version, `site_candidates.${rowId}.bundle_json.siteModel.versions[${index}]`);
    changed ||= result.changed;
    recomputedScorecards += result.recomputedScorecards;
    skipped ||= result.skipped;
    errors.push(...result.errors);
    return result.value;
  });

  return {
    value: changed ? { ...bundle, siteModel: { ...bundle.siteModel, versions } } : bundle,
    changed,
    recomputedScorecards,
    skipped,
    errors
  };
}

async function backfillCandidates(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixedRows: 0, cleanRows: 0, recomputedScorecards: 0, skippedRows: 0, failedRows: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_candidates")
      .select("id, business_name, bundle_json")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_candidates: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const result = recomputeBundle(row.bundle_json as SiteBundle, row.id);
      if (result.errors.length) {
        counts.failedRows += 1;
        console.error(`failed: ${row.id} (${row.business_name}): ${result.errors.join("; ")}`);
        continue;
      }
      if (result.skipped && !result.changed) {
        counts.skippedRows += 1;
        continue;
      }
      if (!result.changed) {
        counts.cleanRows += 1;
        continue;
      }
      if (check) {
        counts.fixedRows += 1;
        counts.recomputedScorecards += result.recomputedScorecards;
        console.log(`would recompute scorecard: ${row.id} (${row.business_name})`);
        continue;
      }

      const { error: updateError } = await client
        .from("site_candidates")
        .update({ bundle_json: result.value, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updateError) {
        counts.failedRows += 1;
        console.error(`failed: ${row.id} (${row.business_name}): ${updateError.message}`);
        continue;
      }
      counts.fixedRows += 1;
      counts.recomputedScorecards += result.recomputedScorecards;
      console.log(`recomputed scorecard: ${row.id} (${row.business_name})`);
    }

    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function backfillSiteVersions(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixedRows: 0, cleanRows: 0, recomputedScorecards: 0, skippedRows: 0, failedRows: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_versions")
      .select("id, site_id, version_model")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_versions: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const bundle = await supabaseRepository.getSiteBundle(row.site_id);
      if (!bundle) {
        counts.skippedRows += 1;
        console.warn(`skipped: site version ${row.id} (site ${row.site_id}) has no resolvable bundle`);
        continue;
      }
      const result = recomputeVersionScorecard(bundle, row.version_model as SiteVersion, `site_versions.${row.id}.version_model`);
      if (result.errors.length) {
        counts.failedRows += 1;
        console.error(`failed: site version ${row.id} (site ${row.site_id}): ${result.errors.join("; ")}`);
        continue;
      }
      if (result.skipped && !result.changed) {
        counts.skippedRows += 1;
        continue;
      }
      if (!result.changed) {
        counts.cleanRows += 1;
        continue;
      }
      if (check) {
        counts.fixedRows += 1;
        counts.recomputedScorecards += result.recomputedScorecards;
        console.log(`would recompute scorecard: site version ${row.id} (site ${row.site_id})`);
        continue;
      }

      const { error: updateError } = await client.from("site_versions").update({ version_model: result.value }).eq("id", row.id);
      if (updateError) {
        counts.failedRows += 1;
        console.error(`failed: site version ${row.id} (site ${row.site_id}): ${updateError.message}`);
        continue;
      }
      counts.fixedRows += 1;
      counts.recomputedScorecards += result.recomputedScorecards;
      console.log(`recomputed scorecard: site version ${row.id} (site ${row.site_id})`);
    }

    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

function total(counts: Counts[]) {
  return counts.reduce<Counts>(
    (sum, count) => ({
      fixedRows: sum.fixedRows + count.fixedRows,
      cleanRows: sum.cleanRows + count.cleanRows,
      recomputedScorecards: sum.recomputedScorecards + count.recomputedScorecards,
      skippedRows: sum.skippedRows + count.skippedRows,
      failedRows: sum.failedRows + count.failedRows
    }),
    { fixedRows: 0, cleanRows: 0, recomputedScorecards: 0, skippedRows: 0, failedRows: 0 }
  );
}

function printCounts(label: string, counts: Counts, check: boolean) {
  const action = check ? "would fix" : "fixed";
  console.log(
    `${label}: ${action} ${counts.fixedRows}, clean ${counts.cleanRows}, skipped ${counts.skippedRows}, scorecards ${counts.recomputedScorecards}, failed ${counts.failedRows}`
  );
}

async function main() {
  const check = process.argv.includes("--check");
  console.log(check ? "dry run (--check): reporting only" : "repair run: recomputing scorecards");

  const candidates = await backfillCandidates(check);
  const siteVersions = await backfillSiteVersions(check);
  const all = total([candidates, siteVersions]);

  console.log("");
  printCounts("site_candidates", candidates, check);
  printCounts("site_versions", siteVersions, check);
  printCounts("total", all, check);

  if (all.failedRows > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
