/**
 * Convert stored visual QA scores from the original 1-10 shape to the native
 * 0-100 score scale introduced by `visual_qa_score_100_v1`.
 *
 * The migration is keyed only by the explicit missing `scoreScale` marker.
 * It never infers legacy/new state from score magnitude, so a future genuine
 * low score such as 8/100 stays 8 when this script is re-run.
 *
 * Repair targets:
 *   - site_candidates.bundle_json -> presenceAssessment.visualQa
 *   - site_candidates.bundle_json -> siteModel.versions[*].generationQa.visualQa
 *   - site_versions.version_model -> generationQa.visualQa
 *   - site_artifacts.payload_json -> visualQa
 *
 *   npm run backfill:visual-qa-score-scale -- --check   # dry run / drift report
 *   npm run backfill:visual-qa-score-scale              # repair
 */
import "./load-env";
import { createHash } from "node:crypto";
import type { SiteBundle, SiteVersion, VisualQaResult } from "../lib/models";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const PAGE_SIZE = 100;
const SCORE_SCALE = "visual_qa_score_100_v1" as const;
const SCORE_KEYS = ["craft", "overall", "brand", "layout", "copy", "conversion", "media", "mobile"] as const;

type Counts = {
  fixedRows: number;
  cleanRows: number;
  migratedVisualQa: number;
  failedRows: number;
};

type MigrationResult<T> = {
  value: T;
  changed: boolean;
  migratedVisualQa: number;
  errors: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function combine<T>(base: T, patches: MigrationResult<unknown>[]): MigrationResult<T> {
  return {
    value: base,
    changed: patches.some((patch) => patch.changed),
    migratedVisualQa: patches.reduce((sum, patch) => sum + patch.migratedVisualQa, 0),
    errors: patches.flatMap((patch) => patch.errors)
  };
}

function migrateVisualQa(value: unknown, path: string): MigrationResult<unknown> {
  if (!isRecord(value) || !isRecord(value.score)) {
    return { value, changed: false, migratedVisualQa: 0, errors: [] };
  }
  if (value.scoreScale === SCORE_SCALE) {
    return { value, changed: false, migratedVisualQa: 0, errors: [] };
  }
  if ("scoreScale" in value && value.scoreScale !== undefined) {
    return {
      value,
      changed: false,
      migratedVisualQa: 0,
      errors: [`${path}: unsupported scoreScale ${String(value.scoreScale)}`]
    };
  }

  const nextScore: Record<string, unknown> = { ...value.score };
  const errors: string[] = [];
  for (const key of SCORE_KEYS) {
    const raw = value.score[key];
    if (raw === undefined) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push(`${path}.score.${key}: expected finite number`);
      continue;
    }
    const next = raw * 10;
    if (next < 0 || next > 100) {
      errors.push(`${path}.score.${key}: 1-10 legacy score converts outside 0-100 (${next})`);
      continue;
    }
    nextScore[key] = Math.round(next * 100) / 100;
  }
  if (errors.length) {
    return { value, changed: false, migratedVisualQa: 0, errors };
  }

  return {
    value: { ...value, scoreScale: SCORE_SCALE, score: nextScore },
    changed: true,
    migratedVisualQa: 1,
    errors: []
  };
}

function migrateBundle(bundle: SiteBundle, rowId: string): MigrationResult<SiteBundle> {
  let nextBundle = bundle;
  const patches: MigrationResult<unknown>[] = [];

  const presenceResult = migrateVisualQa(bundle.presenceAssessment?.visualQa, `site_candidates.${rowId}.bundle_json.presenceAssessment.visualQa`);
  patches.push(presenceResult);
  if (presenceResult.changed) {
    nextBundle = {
      ...nextBundle,
      presenceAssessment: {
        ...nextBundle.presenceAssessment,
        visualQa: presenceResult.value as VisualQaResult
      }
    };
  }

  const versions = bundle.siteModel?.versions ?? [];
  let versionsChanged = false;
  const nextVersions = versions.map((version, index) => {
    const result = migrateVisualQa(
      version.generationQa?.visualQa,
      `site_candidates.${rowId}.bundle_json.siteModel.versions[${index}].generationQa.visualQa`
    );
    patches.push(result);
    if (!result.changed || !version.generationQa) return version;
    versionsChanged = true;
    return {
      ...version,
      generationQa: {
        ...version.generationQa,
        visualQa: result.value as VisualQaResult
      }
    } as SiteVersion;
  });
  if (versionsChanged) {
    nextBundle = {
      ...nextBundle,
      siteModel: {
        ...nextBundle.siteModel,
        versions: nextVersions
      }
    };
  }

  const result = combine(nextBundle, patches);
  return { ...result, value: nextBundle };
}

function migrateVersion(version: SiteVersion, rowId: string): MigrationResult<SiteVersion> {
  const result = migrateVisualQa(version.generationQa?.visualQa, `site_versions.${rowId}.version_model.generationQa.visualQa`);
  if (!result.changed || !version.generationQa) {
    return { value: version, changed: false, migratedVisualQa: result.migratedVisualQa, errors: result.errors };
  }
  return {
    value: {
      ...version,
      generationQa: {
        ...version.generationQa,
        visualQa: result.value as VisualQaResult
      }
    } as SiteVersion,
    changed: true,
    migratedVisualQa: result.migratedVisualQa,
    errors: result.errors
  };
}

function migrateArtifactPayload(payload: unknown, rowId: string): MigrationResult<unknown> {
  if (!isRecord(payload)) return { value: payload, changed: false, migratedVisualQa: 0, errors: [] };
  const result = migrateVisualQa(payload.visualQa, `site_artifacts.${rowId}.payload_json.visualQa`);
  if (!result.changed) return { value: payload, changed: false, migratedVisualQa: result.migratedVisualQa, errors: result.errors };
  return {
    value: { ...payload, visualQa: result.value },
    changed: true,
    migratedVisualQa: result.migratedVisualQa,
    errors: result.errors
  };
}

async function backfillCandidates(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixedRows: 0, cleanRows: 0, migratedVisualQa: 0, failedRows: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_candidates")
      .select("id, business_name, bundle_json")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_candidates: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const result = migrateBundle(row.bundle_json as SiteBundle, row.id);
      if (result.errors.length) {
        counts.failedRows += 1;
        console.error(`failed: ${row.id} (${row.business_name}): ${result.errors.join("; ")}`);
        continue;
      }
      if (!result.changed) {
        counts.cleanRows += 1;
        continue;
      }
      if (check) {
        counts.fixedRows += 1;
        counts.migratedVisualQa += result.migratedVisualQa;
        console.log(`would migrate visual QA score scale: ${row.id} (${row.business_name})`);
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
      counts.migratedVisualQa += result.migratedVisualQa;
      console.log(`migrated visual QA score scale: ${row.id} (${row.business_name})`);
    }

    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function backfillSiteVersions(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixedRows: 0, cleanRows: 0, migratedVisualQa: 0, failedRows: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_versions")
      .select("id, site_id, version_model")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_versions: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const result = migrateVersion(row.version_model as SiteVersion, row.id);
      if (result.errors.length) {
        counts.failedRows += 1;
        console.error(`failed: site version ${row.id} (site ${row.site_id}): ${result.errors.join("; ")}`);
        continue;
      }
      if (!result.changed) {
        counts.cleanRows += 1;
        continue;
      }
      if (check) {
        counts.fixedRows += 1;
        counts.migratedVisualQa += result.migratedVisualQa;
        console.log(`would migrate visual QA score scale: site version ${row.id} (site ${row.site_id})`);
        continue;
      }

      const { error: updateError } = await client.from("site_versions").update({ version_model: result.value }).eq("id", row.id);
      if (updateError) {
        counts.failedRows += 1;
        console.error(`failed: site version ${row.id} (site ${row.site_id}): ${updateError.message}`);
        continue;
      }
      counts.fixedRows += 1;
      counts.migratedVisualQa += result.migratedVisualQa;
      console.log(`migrated visual QA score scale: site version ${row.id} (site ${row.site_id})`);
    }

    if (data.length < PAGE_SIZE) break;
  }

  return counts;
}

async function backfillSiteArtifacts(check: boolean): Promise<Counts> {
  const client = getSupabaseAdminClient();
  const counts: Counts = { fixedRows: 0, cleanRows: 0, migratedVisualQa: 0, failedRows: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("site_artifacts")
      .select("id, artifact_type, artifact_version, payload_json")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`List site_artifacts: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const result = migrateArtifactPayload(row.payload_json, row.id);
      if (result.errors.length) {
        counts.failedRows += 1;
        console.error(`failed: artifact ${row.id} (${row.artifact_type}/${row.artifact_version}): ${result.errors.join("; ")}`);
        continue;
      }
      if (!result.changed) {
        counts.cleanRows += 1;
        continue;
      }
      if (check) {
        counts.fixedRows += 1;
        counts.migratedVisualQa += result.migratedVisualQa;
        console.log(`would migrate visual QA score scale: artifact ${row.id} (${row.artifact_type}/${row.artifact_version})`);
        continue;
      }

      const { error: updateError } = await client
        .from("site_artifacts")
        .update({ payload_json: result.value, content_hash: hashPayload(result.value) })
        .eq("id", row.id);
      if (updateError) {
        counts.failedRows += 1;
        console.error(`failed: artifact ${row.id} (${row.artifact_type}/${row.artifact_version}): ${updateError.message}`);
        continue;
      }
      counts.fixedRows += 1;
      counts.migratedVisualQa += result.migratedVisualQa;
      console.log(`migrated visual QA score scale: artifact ${row.id} (${row.artifact_type}/${row.artifact_version})`);
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
      migratedVisualQa: sum.migratedVisualQa + count.migratedVisualQa,
      failedRows: sum.failedRows + count.failedRows
    }),
    { fixedRows: 0, cleanRows: 0, migratedVisualQa: 0, failedRows: 0 }
  );
}

function printCounts(label: string, counts: Counts, check: boolean) {
  const action = check ? "would fix" : "fixed";
  console.log(
    `${label}: ${action} ${counts.fixedRows}, clean ${counts.cleanRows}, visual QA records ${counts.migratedVisualQa}, failed ${counts.failedRows}`
  );
}

async function main() {
  const check = process.argv.includes("--check");
  console.log(check ? "dry run (--check): reporting only" : "repair run: migrating visual QA score scale");

  const candidates = await backfillCandidates(check);
  const siteVersions = await backfillSiteVersions(check);
  const siteArtifacts = await backfillSiteArtifacts(check);
  const all = total([candidates, siteVersions, siteArtifacts]);

  console.log("");
  printCounts("site_candidates", candidates, check);
  printCounts("site_versions", siteVersions, check);
  printCounts("site_artifacts", siteArtifacts, check);
  printCounts("total", all, check);

  if (all.failedRows > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
