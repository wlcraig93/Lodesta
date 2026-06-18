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
import { getSupabaseAdminClient } from "../lib/supabase/client";

const PAGE_SIZE = 100;

type Counts = {
  candidateRows: number;
  cleanRows: number;
  missingAnalysisRows: number;
  malformedAnalysisRows: number;
  missingAssetAnalyses: number;
  failedRows: number;
};

function isAnalysisCandidate(asset: AssetReference) {
  if (asset.source === "generated" || asset.source === "licensed" || asset.source === "placeholder") return false;
  return asset.rightsStatus === "reference_only" || asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe";
}

function assetAnalysisIssue(asset: AssetReference): string | null {
  if (!isAnalysisCandidate(asset)) return null;
  const analysis = asset.analysisV1;
  if (!analysis) return "missing AssetAnalysisV1";
  if (analysis.version !== "asset-analysis-v1") return `unsupported AssetAnalysisV1 version ${String(analysis.version)}`;
  if (analysis.source !== "openai") return `asset analysis source is ${String(analysis.source)}; expected openai`;
  if (!analysis.model || !analysis.analyzedAt) return "asset analysis is missing model/analyzedAt replay metadata";
  if (!analysis.imageKind || !analysis.focalPoint || !analysis.recommendedCropIntent) return "asset analysis is missing image/crop classification";
  return null;
}

function candidateAssetIssues(bundle: SiteBundle) {
  const assets = [
    ...(bundle.businessProfile.logo ? [{ label: "logo", asset: bundle.businessProfile.logo }] : []),
    ...bundle.businessProfile.photos.map((asset, index) => ({ label: `photo[${index}]`, asset }))
  ];
  return assets
    .map(({ label, asset }) => {
      const issue = assetAnalysisIssue(asset);
      return issue ? { label, assetId: asset.id, issue } : undefined;
    })
    .filter((issue): issue is { label: string; assetId: string; issue: string } => Boolean(issue));
}

async function reportCandidates(): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = {
    candidateRows: 0,
    cleanRows: 0,
    missingAnalysisRows: 0,
    malformedAnalysisRows: 0,
    missingAssetAnalyses: 0,
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
        const issues = candidateAssetIssues(row.bundle_json as SiteBundle);
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
