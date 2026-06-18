/**
 * Report stored generated candidates that predate GenerationRepairStateV1.
 *
 * GenerationRepairStateV1 is produced by the canonical bounded repair loop and
 * cannot be reconstructed safely from an old bundle. This script is therefore a
 * stored-artifact check/report path: operators can use the counts to decide
 * which internal/test candidates should be regenerated.
 *
 *   npm run backfill:generation-repair-state -- --check
 */
import "./load-env";

import type { SiteBundle } from "../lib/models";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const PAGE_SIZE = 100;

type Counts = {
  candidateRows: number;
  notGeneratedV3: number;
  withRepairState: number;
  regenerateRequired: number;
  malformedRepairState: number;
  failedRows: number;
};

function repairStateIssueForBundle(bundle: SiteBundle): string | null {
  const hasGeneratedV3 = bundle.siteModel?.versions?.some((version) => version.rendererVersion === "layout-v3" && version.generationQa);
  if (!hasGeneratedV3) return null;
  const repairState = bundle.presenceAssessment?.generationRepairStateV1;
  if (!repairState) return "missing GenerationRepairStateV1; regenerate through canonical generation for repair telemetry";
  if (repairState.version !== "generation-repair-state-v1") return `unsupported repair state version ${String(repairState.version)}`;
  if (!Array.isArray(repairState.patches)) return "repair state patches must be an array";
  if (!Array.isArray(repairState.unresolvedBlockerIds) || !Array.isArray(repairState.unresolvedTargetIds)) {
    return "repair state unresolved ids must be arrays";
  }
  return null;
}

async function reportCandidates(): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = {
    candidateRows: 0,
    notGeneratedV3: 0,
    withRepairState: 0,
    regenerateRequired: 0,
    malformedRepairState: 0,
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
        const bundle = row.bundle_json as SiteBundle;
        const hasGeneratedV3 = bundle.siteModel?.versions?.some((version) => version.rendererVersion === "layout-v3" && version.generationQa);
        const issue = repairStateIssueForBundle(bundle);
        if (!hasGeneratedV3) {
          counts.notGeneratedV3 += 1;
          continue;
        }
        if (!issue) {
          counts.withRepairState += 1;
          continue;
        }
        if (issue.startsWith("missing GenerationRepairStateV1")) counts.regenerateRequired += 1;
        else counts.malformedRepairState += 1;
        console.log(`${row.id} (${row.business_name}): ${issue}`);
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
        action: "regenerate_required_only",
        counts
      },
      null,
      2
    )
  );
  if (!check && counts.regenerateRequired) {
    console.log("No automatic write was performed. Regenerate stale candidates through canonical generateSite to create repair-state telemetry.");
  }
  if (counts.failedRows || counts.malformedRepairState) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
