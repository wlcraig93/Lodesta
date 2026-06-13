/**
 * Strip the removed SiteVersionV3.pages projection from stored versions.
 *
 * Rows written before the projection was removed still carry a top-level
 * `pages` key next to `pageComposition`, which the strict
 * `assertSiteVersionV3` now rejects on every render surface. This script
 * repairs both persistence locations:
 *
 *   - site_candidates.bundle_json -> siteModel.versions[*]
 *   - site_versions.version_model
 *
 * Versions that are not layout-v3 at all cannot be migrated; they are
 * reported (regenerate or delete manually), never auto-deleted.
 *
 *   npm run backfill:strip-pages-projection -- --check   # dry run / drift report
 *   npm run backfill:strip-pages-projection              # repair
 *
 * Uses the raw Supabase admin client on purpose: repository writes assert
 * v3 (good), so validation happens here via assertSiteVersionV3 after the
 * strip, before each row is written back.
 */
import "./load-env";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { assertSiteVersionV3 } from "../lib/site-version-v3";
import type { SiteBundle, SiteVersion } from "../lib/models";

const PAGE_SIZE = 100;

type Counts = { fixed: number; clean: number; nonMigratable: number; failed: number };

function stripVersion(version: SiteVersion): { version: SiteVersion; changed: boolean; migratable: boolean } {
  if (version.rendererVersion !== "layout-v3") return { version, changed: false, migratable: false };
  if (!("pages" in version)) return { version, changed: false, migratable: true };
  const { pages: _removed, ...rest } = version as SiteVersion & { pages?: unknown };
  return { version: rest as SiteVersion, changed: true, migratable: true };
}

async function backfillCandidates(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixed: 0, clean: 0, nonMigratable: 0, failed: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_candidates")
      .select("id, business_name, bundle_json")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_candidates: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const bundle = row.bundle_json as SiteBundle;
      const versions = bundle?.siteModel?.versions ?? [];
      let changed = false;
      let nonMigratable = false;
      const nextVersions = versions.map((version) => {
        const result = stripVersion(version);
        changed ||= result.changed;
        nonMigratable ||= !result.migratable;
        return result.version;
      });

      if (nonMigratable) {
        counts.nonMigratable += 1;
        console.warn(`non-migratable candidate (not layout-v3): ${row.id} (${row.business_name}) — regenerate or delete`);
      }
      if (!changed) {
        if (!nonMigratable) counts.clean += 1;
        continue;
      }
      if (check) {
        counts.fixed += 1;
        console.log(`would strip pages projection: ${row.id} (${row.business_name})`);
        continue;
      }

      try {
        for (const version of nextVersions) {
          if (version.rendererVersion === "layout-v3") assertSiteVersionV3(version, `candidate ${row.id} version ${version.id}`);
        }
        const nextBundle = { ...bundle, siteModel: { ...bundle.siteModel, versions: nextVersions } };
        const { error: updateError } = await client
          .from("site_candidates")
          .update({ bundle_json: nextBundle, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (updateError) throw new Error(updateError.message);
        counts.fixed += 1;
        console.log(`stripped pages projection: ${row.id} (${row.business_name})`);
      } catch (error) {
        counts.failed += 1;
        console.error(`failed: ${row.id} (${row.business_name}): ${error instanceof Error ? error.message : error}`);
      }
    }

    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function backfillSiteVersions(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixed: 0, clean: 0, nonMigratable: 0, failed: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_versions")
      .select("id, site_id, version_model")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_versions: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const result = stripVersion(row.version_model as SiteVersion);
      if (!result.migratable) {
        counts.nonMigratable += 1;
        console.warn(`non-migratable site version (not layout-v3): ${row.id} (site ${row.site_id}) — regenerate or delete`);
        continue;
      }
      if (!result.changed) {
        counts.clean += 1;
        continue;
      }
      if (check) {
        counts.fixed += 1;
        console.log(`would strip pages projection: site version ${row.id} (site ${row.site_id})`);
        continue;
      }

      try {
        assertSiteVersionV3(result.version, `site version ${row.id}`);
        const { error: updateError } = await client
          .from("site_versions")
          .update({ version_model: result.version })
          .eq("id", row.id);
        if (updateError) throw new Error(updateError.message);
        counts.fixed += 1;
        console.log(`stripped pages projection: site version ${row.id} (site ${row.site_id})`);
      } catch (error) {
        counts.failed += 1;
        console.error(`failed: site version ${row.id}: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function main() {
  const check = process.argv.includes("--check");
  console.log(check ? "dry run (--check): reporting only" : "repair run: stripping stale pages projections");

  const candidates = await backfillCandidates(check);
  const siteVersions = await backfillSiteVersions(check);

  const label = check ? "would fix" : "fixed";
  console.log(
    `\nsite_candidates: ${label} ${candidates.fixed}, clean ${candidates.clean}, non-migratable ${candidates.nonMigratable}, failed ${candidates.failed}`
  );
  console.log(
    `site_versions:   ${label} ${siteVersions.fixed}, clean ${siteVersions.clean}, non-migratable ${siteVersions.nonMigratable}, failed ${siteVersions.failed}`
  );

  if (candidates.failed + siteVersions.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
