/**
 * Report stored generated candidates that predate SiteDirectorPlanV1.
 *
 * SiteDirectorPlanV1 is model-derived and cannot be reconstructed safely from
 * stale stored bundles. This script therefore does not synthesize plans. It is
 * the required stored-artifact check/report path: operators can use the counts
 * to decide which internal/test candidates should be regenerated through the
 * canonical generator.
 *
 *   npm run backfill:site-director-plan -- --check
 */
import "./load-env";

import type { SiteBundle } from "../lib/models";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const PAGE_SIZE = 100;

type Counts = {
  candidateRows: number;
  withDirectorPlan: number;
  regenerateRequired: number;
  malformedDirectorPlan: number;
  failedRows: number;
};

function directorIssueForBundle(bundle: SiteBundle): string | null {
  const runtime = bundle.presenceAssessment?.siteDirectorPlanV1;
  if (!runtime) return "missing SiteDirectorPlanV1; regenerate through canonical generation";
  if (runtime.version !== "site-director-runtime-v1") return `unsupported director runtime version ${String(runtime.version)}`;
  if (runtime.source !== "model") return `director source is ${String(runtime.source)}; expected model`;
  if (!runtime.catalogSchemaHash || !runtime.businessDirectorInputHash || !runtime.planInputHash) {
    return "director runtime is missing replay hashes";
  }
  if (runtime.validation?.status !== "passed") return "director validation did not pass";
  if (!runtime.plan || runtime.plan.version !== "site-director-plan-v1") return "missing SiteDirectorPlanV1 payload";
  return null;
}

async function reportCandidates(): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = {
    candidateRows: 0,
    withDirectorPlan: 0,
    regenerateRequired: 0,
    malformedDirectorPlan: 0,
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
        const issue = directorIssueForBundle(row.bundle_json as SiteBundle);
        if (!issue) {
          counts.withDirectorPlan += 1;
          continue;
        }
        if (issue.startsWith("missing SiteDirectorPlanV1")) counts.regenerateRequired += 1;
        else counts.malformedDirectorPlan += 1;
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
    console.log("No automatic write was performed. Regenerate stale candidates through canonical generateSite to create model-authored director plans.");
  }
  if (counts.failedRows || counts.malformedDirectorPlan) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
