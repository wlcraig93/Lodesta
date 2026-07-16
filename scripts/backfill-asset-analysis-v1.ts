/**
 * Report stored generated candidates whose first-party/source assets predate
 * AssetAnalysisV1.
 *
 * AssetAnalysisV1 is model-derived from image bytes and should not be faked by
 * a deterministic migration. This script is therefore the stored-artifact
 * check/report path: operators can regenerate stale candidates through the
 * canonical generator, or run a future explicit model-backed enrichment job.
 *
 *   npm run backfill:asset-analysis-v1 -- --check
 */
import "./load-env";

import type { AssetReference, SiteBundle } from "../lib/models";
import { assetAnalysisSelectionV1 } from "../lib/asset-analysis-v1";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const PAGE_SIZE = 100;

type Counts = {
  candidateRows: number;
  cleanRows: number;
  missingAnalysisRows: number;
  malformedAnalysisRows: number;
  missingAssetAnalyses: number;
  overBudgetAssetRows: number;
  skippedOverBudgetAssets: number;
  failedRows: number;
};

function isAnalysisCandidate(asset: AssetReference) {
  if (asset.source === "generated" || asset.source === "licensed" || asset.source === "placeholder") return false;
  return asset.source === "uploaded" || asset.source === "website_reference";
}

function assetAnalysisIssue(asset: AssetReference): string | null {
  if (!isAnalysisCandidate(asset)) return null;
  const analysis = asset.analysisV1;
  if (!analysis) return "missing AssetAnalysisV1";
  if (analysis.version !== "asset-analysis-v1") return `unsupported AssetAnalysisV1 version ${String(analysis.version)}`;
  if (analysis.source !== "openai") return `asset analysis source is ${String(analysis.source)}; expected openai`;
  if (!analysis.model || !analysis.analyzedAt) return "asset analysis is missing model/analyzedAt replay metadata";
  if (!analysis.imageKind || !analysis.focalPoint || !analysis.subjectPlacement) return "asset analysis is missing objective visual classification";
  if (!Array.isArray(analysis.warnings) || !Array.isArray(analysis.contentTags) || !Array.isArray(analysis.limitations)) {
    return "asset analysis is missing objective warning/tag metadata";
  }
  return null;
}

function candidateAssetIssues(bundle: SiteBundle) {
  const selection = assetAnalysisSelectionV1(bundle);
  const selectedIdentities = new Set(selection.selectedAssetIdentities);
  const assets = [
    ...(bundle.businessProfile.logo ? [{ label: "logo", asset: bundle.businessProfile.logo }] : []),
    ...bundle.businessProfile.photos.map((asset, index) => ({ label: `photo[${index}]`, asset }))
  ].filter(({ asset }) => selectedIdentities.has(asset.id || asset.url));
  const issues = assets
    .map(({ label, asset }) => {
      const issue = assetAnalysisIssue(asset);
      return issue ? { label, assetId: asset.id, issue } : undefined;
    })
    .filter((issue): issue is { label: string; assetId: string; issue: string } => Boolean(issue));
  return { issues, skippedOverBudget: selection.skippedOverBudget };
}

async function reportCandidates(): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = {
    candidateRows: 0,
    cleanRows: 0,
    missingAnalysisRows: 0,
    malformedAnalysisRows: 0,
    missingAssetAnalyses: 0,
    overBudgetAssetRows: 0,
    skippedOverBudgetAssets: 0,
    failedRows: 0
  };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_candidates")
      .select("id, business_name, bundle_json")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_candidates: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      counts.candidateRows += 1;
      try {
        const { issues, skippedOverBudget } = candidateAssetIssues(row.bundle_json as SiteBundle);
        if (skippedOverBudget) counts.overBudgetAssetRows += 1;
        counts.skippedOverBudgetAssets += skippedOverBudget;
        if (!issues.length) {
          counts.cleanRows += 1;
          continue;
        }
        const malformed = issues.some((issue) => !issue.issue.startsWith("missing AssetAnalysisV1"));
        if (malformed) counts.malformedAnalysisRows += 1;
        else counts.missingAnalysisRows += 1;
        counts.missingAssetAnalyses += issues.length;
        console.log(
          `${row.id} (${row.business_name}): ${issues
            .map((issue) => `${issue.label}/${issue.assetId}: ${issue.issue}`)
            .join("; ")}`
        );
      } catch (error) {
        counts.failedRows += 1;
        console.error(`${row.id} (${row.business_name}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function main() {
  const check = process.argv.includes("--check");
  const counts = await reportCandidates();
  console.log(
    JSON.stringify(
      {
        mode: check ? "check" : "report",
        action: "regenerate_required_or_model_enrich_assets",
        scope: "canonical_asset_analysis_budget",
        counts
      },
      null,
      2
    )
  );
  if (counts.failedRows || counts.malformedAnalysisRows) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
