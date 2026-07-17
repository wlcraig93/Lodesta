import { getSupabaseAdminClient } from "../lib/supabase/client";
import {
  isCanonicalStoredCandidate,
  isCanonicalStoredVersionRow,
  type StoredCandidateProjection,
  type StoredVersionProjection
} from "../lib/generation-stored-state";

const client = getSupabaseAdminClient();
const preCutoverTables = [
  "site_candidates",
  "site_versions",
  "sites",
  "businesses",
  "business_locations",
  "business_profiles",
  "site_assets",
  "forms",
  "fact_candidates",
  "business_services",
  "owner_audit_log",
  "fact_revisions",
  "publish_records"
] as const;

const canonicalSchemaPresent = await columnExists("businesses", "state_revision")
  && await columnExists("site_candidates", "input_snapshot_id");
if (!canonicalSchemaPresent) {
  const counts = Object.fromEntries(await Promise.all(preCutoverTables.map(async (table) => [table, await tableCount(table)])));
  const cutoverReady = Object.values(counts).every((count) => count === 0);
  console.log(JSON.stringify({
    schemaVersion: "canonical-control-plane-stored-data-report-v1",
    schemaState: "pre_cutover",
    mutation: "none",
    generatedAt: new Date().toISOString(),
    counts,
    cutoverReady
  }, null, 2));
  if (!cutoverReady) process.exitCode = 1;
} else {
  await reportCanonicalState();
}

async function reportCanonicalState() {
  const [candidateResponse, siteResponse, versionResponse, snapshotResponse, formResponse] = await Promise.all([
    client.from("site_candidates").select([
      "id",
      "status",
      "candidate_purpose",
      "input_snapshot_id",
      "version_model",
      "form_definition_id",
      "plan:generation_plan",
      "copy:site_copy",
      "evidence:evidence_manifest"
    ].join(",")),
    client.from("sites").select("id,slug,status,business_id"),
    client.from("site_versions").select("id,site_id,input_snapshot_id,form_definition_id,version_model"),
    client.from("generation_input_snapshots").select("id,site_id,business_state_revision,site_intent_revision,input_hash"),
    client.from("form_definitions").select("id,site_id")
  ]);
  for (const [label, response] of [
    ["site candidates", candidateResponse],
    ["sites", siteResponse],
    ["site versions", versionResponse],
    ["generation input snapshots", snapshotResponse],
    ["form definitions", formResponse]
  ] as const) {
    if (response.error) throw new Error(`Read ${label}: ${response.error.message}`);
  }

  const candidates = (candidateResponse.data ?? []) as unknown as StoredCandidateProjection[];
  const versions = (versionResponse.data ?? []) as unknown as StoredVersionProjection[];
  const invalidCandidates = candidates.filter((candidate) => !isCanonicalStoredCandidate(candidate));
  const invalidVersions = versions.filter((version) => !isCanonicalStoredVersionRow(version));
  const snapshotIds = new Set((snapshotResponse.data ?? []).map((row) => row.id));
  const formIds = new Set((formResponse.data ?? []).map((row) => row.id));
  const danglingCandidates = candidates.filter(
    (candidate) => !snapshotIds.has(candidate.input_snapshot_id ?? "") || !formIds.has(candidate.form_definition_id ?? "")
  );
  const danglingVersions = versions.filter(
    (version) => !snapshotIds.has(version.input_snapshot_id ?? "") || !formIds.has(version.form_definition_id ?? "")
  );
  const cutoverReady = invalidCandidates.length === 0
    && invalidVersions.length === 0
    && danglingCandidates.length === 0
    && danglingVersions.length === 0;

  console.log(JSON.stringify({
    schemaVersion: "canonical-control-plane-stored-data-report-v1",
    schemaState: "canonical",
    mutation: "none",
    generatedAt: new Date().toISOString(),
    sites: { total: siteResponse.data?.length ?? 0 },
    siteCandidates: {
      total: candidates.length,
      canonical: candidates.length - invalidCandidates.length,
      invalidIds: invalidCandidates.map((candidate) => candidate.id),
      danglingReferenceIds: danglingCandidates.map((candidate) => candidate.id)
    },
    siteVersions: {
      total: versions.length,
      canonical: versions.length - invalidVersions.length,
      invalidIds: invalidVersions.map((version) => version.id),
      danglingReferenceIds: danglingVersions.map((version) => version.id)
    },
    generationInputSnapshots: snapshotResponse.data?.length ?? 0,
    formDefinitions: formResponse.data?.length ?? 0,
    cutoverReady
  }, null, 2));
  if (!cutoverReady) process.exitCode = 1;
}

async function tableCount(table: string) {
  const response = await client.from(table).select("id", { count: "exact" }).limit(1);
  if (!response.error) return response.count ?? 0;
  if (missingRelation(response.error.message)) return 0;
  throw new Error(`Count ${table}: ${response.error.message}`);
}

async function columnExists(table: string, column: string) {
  const response = await client.from(table).select(column).limit(1);
  if (!response.error) return true;
  if (missingRelation(response.error.message) || /column .* does not exist/i.test(response.error.message)) return false;
  throw new Error(`Inspect ${table}.${column}: ${response.error.message}`);
}

function missingRelation(message: string) {
  return /does not exist|schema cache|could not find the table/i.test(message);
}
