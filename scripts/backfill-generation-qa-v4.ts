/**
 * Move stored generation QA to the single-judgment v4 contract.
 *
 * Legacy visual scores cannot be converted into the new ship/revise judgment
 * without rerunning screenshot review. The safe migration removes that grade,
 * marks readiness pending, and preserves render artifacts for operator context.
 *
 *   npm run backfill:generation-qa-v4 -- --check
 *   npm run backfill:generation-qa-v4
 */
import "./load-env";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import type { SiteBundle, SiteVersion } from "../lib/models";

const PAGE_SIZE = 100;
const qaSchemaVersion = "generation-qa-v4" as const;
const visualSchemaVersion = "visual-judgment-v1" as const;

type Counts = { changed: number; clean: number; failed: number };

function migrateVersion(version: SiteVersion): { version: SiteVersion; changed: boolean } {
  const qa = version.generationQa;
  if (!qa) return { version, changed: false };
  const visualCurrent = !qa.visualQa || qa.visualQa.schemaVersion === visualSchemaVersion;
  if (qa.schemaVersion === qaSchemaVersion && visualCurrent) return { version, changed: false };
  const { visualQa: _legacyVisualQa, ...retainedQa } = qa;
  return {
    version: {
      ...version,
      generationQa: {
        ...retainedQa,
        schemaVersion: qaSchemaVersion,
        readiness: "pending",
        blockers: [],
        warnings: []
      }
    } as SiteVersion,
    changed: true
  };
}

function migrateBundle(bundle: SiteBundle) {
  let changed = false;
  const versions = bundle.siteModel.versions.map((version) => {
    const result = migrateVersion(version);
    changed ||= result.changed;
    return result.version;
  });
  const presence = bundle.presenceAssessment as SiteBundle["presenceAssessment"] & { visualQa?: unknown };
  const { visualQa: legacyPresenceVisualQa, ...nextPresence } = presence;
  changed ||= legacyPresenceVisualQa !== undefined;
  return {
    changed,
    bundle: {
      ...bundle,
      siteModel: { ...bundle.siteModel, versions },
      presenceAssessment: nextPresence
    } as SiteBundle
  };
}

async function backfillCandidates(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { changed: 0, clean: 0, failed: 0 };
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_candidates")
      .select("id, business_name, bundle_json")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_candidates: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      const result = migrateBundle(row.bundle_json as SiteBundle);
      if (!result.changed) {
        counts.clean += 1;
        continue;
      }
      if (check) {
        counts.changed += 1;
        console.log(`would reset generation QA: ${row.id} (${row.business_name})`);
        continue;
      }
      const { error: updateError } = await client
        .from("site_candidates")
        .update({ bundle_json: result.bundle, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updateError) {
        counts.failed += 1;
        console.error(`failed candidate ${row.id}: ${updateError.message}`);
      } else {
        counts.changed += 1;
      }
    }
    if (data.length < PAGE_SIZE) break;
  }
  return counts;
}

async function backfillSiteVersions(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { changed: 0, clean: 0, failed: 0 };
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_versions")
      .select("id, site_id, version_model")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_versions: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      const result = migrateVersion(row.version_model as SiteVersion);
      if (!result.changed) {
        counts.clean += 1;
        continue;
      }
      if (check) {
        counts.changed += 1;
        console.log(`would reset generation QA: site version ${row.id} (site ${row.site_id})`);
        continue;
      }
      const { error: updateError } = await client
        .from("site_versions")
        .update({ version_model: result.version })
        .eq("id", row.id);
      if (updateError) {
        counts.failed += 1;
        console.error(`failed site version ${row.id}: ${updateError.message}`);
      } else {
        counts.changed += 1;
      }
    }
    if (data.length < PAGE_SIZE) break;
  }
  return counts;
}

async function main() {
  const check = process.argv.includes("--check");
  console.log(check ? "dry run (--check): reporting only" : "repair run: resetting stale generation QA");
  const candidates = await backfillCandidates(check);
  const siteVersions = await backfillSiteVersions(check);
  console.log(JSON.stringify({ check, candidates, siteVersions }, null, 2));
  if (candidates.failed + siteVersions.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
