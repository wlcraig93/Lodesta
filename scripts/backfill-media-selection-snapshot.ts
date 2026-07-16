/**
 * Add MediaSelectionSnapshotV1 to stored layout-v3 media decisions.
 *
 * The snapshot is derivable from each existing MediaAssetDecisionV3, so this is
 * a real repair backfill rather than a regenerate-only report:
 *
 *   npm run backfill:media-selection-snapshot -- --check
 *   npm run backfill:media-selection-snapshot
 */
import "./load-env";

import type { MediaAssetDecisionV3, MediaSelectionSnapshotV1, SiteBundle, SiteVersion, SiteVersionV3 } from "../lib/models";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { assertSiteVersionV3 } from "../lib/site-version-v3";

const PAGE_SIZE = 100;

type Counts = {
  fixed: number;
  clean: number;
  notLayoutV3: number;
  decisionsScanned: number;
  snapshotsAdded: number;
  failed: number;
};

function snapshotForDecision(decision: MediaAssetDecisionV3): MediaSelectionSnapshotV1 {
  return {
    version: "media-selection-snapshot-v1",
    id: decision.id,
    url: decision.sourceUrl,
    artifactRef: decision.artifactRef,
    rightsStatus: decision.rightsStatus,
    source: decision.source,
    policyNotes: [...(decision.policyNotes ?? [])],
    mayImplyRealBusinessWork: decision.mayImplyRealBusinessWork
  };
}

function backfillVersion(version: SiteVersion): { version: SiteVersion; changed: boolean; layoutV3: boolean; snapshotsAdded: number; decisionsScanned: number } {
  if (version.rendererVersion !== "layout-v3") {
    return { version, changed: false, layoutV3: false, snapshotsAdded: 0, decisionsScanned: 0 };
  }
  const v3 = version as SiteVersionV3;
  const decisions = Array.isArray(v3.mediaDecisions) ? v3.mediaDecisions : [];
  let snapshotsAdded = 0;
  const mediaDecisions = decisions.map((decision) => {
    if (decision.selectionSnapshot?.version === "media-selection-snapshot-v1") return decision;
    snapshotsAdded += 1;
    return { ...decision, selectionSnapshot: snapshotForDecision(decision) };
  });
  if (!snapshotsAdded) {
    return { version, changed: false, layoutV3: true, snapshotsAdded: 0, decisionsScanned: decisions.length };
  }
  return {
    version: { ...v3, mediaDecisions },
    changed: true,
    layoutV3: true,
    snapshotsAdded,
    decisionsScanned: decisions.length
  };
}

async function backfillCandidates(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixed: 0, clean: 0, notLayoutV3: 0, decisionsScanned: 0, snapshotsAdded: 0, failed: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_candidates")
      .select("id, business_name, bundle_json")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_candidates: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      try {
        const bundle = row.bundle_json as SiteBundle;
        const versions = bundle.siteModel?.versions ?? [];
        let changed = false;
        let hasLayoutV3 = false;
        let snapshotsAdded = 0;
        let decisionsScanned = 0;
        const nextVersions = versions.map((version) => {
          const result = backfillVersion(version);
          changed ||= result.changed;
          hasLayoutV3 ||= result.layoutV3;
          snapshotsAdded += result.snapshotsAdded;
          decisionsScanned += result.decisionsScanned;
          return result.version;
        });
        counts.decisionsScanned += decisionsScanned;
        counts.snapshotsAdded += snapshotsAdded;
        if (!hasLayoutV3) {
          counts.notLayoutV3 += 1;
          continue;
        }
        if (!changed) {
          counts.clean += 1;
          continue;
        }
        if (check) {
          counts.fixed += 1;
          console.log(`would add ${snapshotsAdded} media selection snapshots: ${row.id} (${row.business_name})`);
          continue;
        }

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
        console.log(`added ${snapshotsAdded} media selection snapshots: ${row.id} (${row.business_name})`);
      } catch (error) {
        counts.failed += 1;
        console.error(`${row.id} (${row.business_name}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function backfillSiteVersions(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixed: 0, clean: 0, notLayoutV3: 0, decisionsScanned: 0, snapshotsAdded: 0, failed: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_versions")
      .select("id, site_id, version_model")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_versions: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      try {
        const result = backfillVersion(row.version_model as SiteVersion);
        counts.decisionsScanned += result.decisionsScanned;
        counts.snapshotsAdded += result.snapshotsAdded;
        if (!result.layoutV3) {
          counts.notLayoutV3 += 1;
          continue;
        }
        if (!result.changed) {
          counts.clean += 1;
          continue;
        }
        if (check) {
          counts.fixed += 1;
          console.log(`would add ${result.snapshotsAdded} media selection snapshots: site version ${row.id} (site ${row.site_id})`);
          continue;
        }

        assertSiteVersionV3(result.version, `site version ${row.id}`);
        const { error: updateError } = await client
          .from("site_versions")
          .update({ version_model: result.version })
          .eq("id", row.id);
        if (updateError) throw new Error(updateError.message);
        counts.fixed += 1;
        console.log(`added ${result.snapshotsAdded} media selection snapshots: site version ${row.id} (site ${row.site_id})`);
      } catch (error) {
        counts.failed += 1;
        console.error(`site version ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function main() {
  const check = process.argv.includes("--check");
  console.log(check ? "dry run (--check): reporting only" : "repair run: adding media selection snapshots");

  const candidates = await backfillCandidates(check);
  const siteVersions = await backfillSiteVersions(check);
  const label = check ? "would fix" : "fixed";

  console.log(`\nsite_candidates: ${label} ${candidates.fixed}, clean ${candidates.clean}, not layout-v3 ${candidates.notLayoutV3}, decisions ${candidates.decisionsScanned}, snapshots ${candidates.snapshotsAdded}, failed ${candidates.failed}`);
  console.log(`site_versions:   ${label} ${siteVersions.fixed}, clean ${siteVersions.clean}, not layout-v3 ${siteVersions.notLayoutV3}, decisions ${siteVersions.decisionsScanned}, snapshots ${siteVersions.snapshotsAdded}, failed ${siteVersions.failed}`);

  if (candidates.failed + siteVersions.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
