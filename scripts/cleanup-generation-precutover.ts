import { getSupabaseAdminClient } from "../lib/supabase/client";

const confirmation = "DELETE_ALL_PRELAUNCH_CONTROL_PLANE_DATA";
const execute = process.argv.includes("--execute");
const suppliedConfirmation = process.argv.find((value) => value.startsWith("--confirm="))?.slice("--confirm=".length);
const client = getSupabaseAdminClient();

const deletionRoots = [
  "publish_records",
  "site_candidates",
  "sites",
  "businesses"
] as const;
const assertedEmptyTables = [
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
const counts: Record<string, number> = {};
const absentTables: string[] = [];
for (const table of assertedEmptyTables) {
  const result = await tableCount(table);
  counts[table] = result.count;
  if (!result.exists) absentTables.push(table);
}
const bucketsResponse = await client.storage.listBuckets();
if (bucketsResponse.error) throw new Error(`Read storage buckets: ${bucketsResponse.error.message}`);
const legacyAssetLibraryBucket = bucketsResponse.data.some((bucket) => bucket.id === "lodesta-asset-library");

console.log(JSON.stringify({
  mode: execute ? "execute" : "dry_run",
  mutation: execute ? "delete_all_prelaunch_control_plane_data" : "none",
  counts,
  absentTables,
  legacyAssetLibraryBucket
}, null, 2));

if (!execute) {
  console.log(`Dry run only. Execute with --execute --confirm=${confirmation}.`);
  process.exit(0);
}
if (suppliedConfirmation !== confirmation) throw new Error(`Refusing cleanup without --confirm=${confirmation}.`);

if (legacyAssetLibraryBucket) await deleteLegacyAssetLibraryBucket();
for (const table of deletionRoots) {
  if (absentTables.includes(table)) continue;
  if (!counts[table]) continue;
  const response = await client.from(table).delete().not("id", "is", null);
  if (response.error) throw new Error(`Delete ${table}: ${response.error.message}`);
}

for (const table of assertedEmptyTables) {
  const result = await tableCount(table);
  if (result.count !== 0) throw new Error(`${table} was not empty after explicit cleanup.`);
}

console.log(JSON.stringify({ ok: true, deleted: counts, deletedLegacyAssetLibraryBucket: legacyAssetLibraryBucket }, null, 2));

async function deleteLegacyAssetLibraryBucket() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const emptyResponse = await client.storage.emptyBucket("lodesta-asset-library");
    if (emptyResponse.error) throw new Error(`Empty legacy asset-library bucket: ${emptyResponse.error.message}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    const deleteResponse = await client.storage.deleteBucket("lodesta-asset-library");
    if (!deleteResponse.error) return;
    if (!/not empty/i.test(deleteResponse.error.message)) throw new Error(`Delete legacy asset-library bucket: ${deleteResponse.error.message}`);
  }
  throw new Error("Delete legacy asset-library bucket: bucket remained nonempty after five Storage API cleanup attempts.");
}

async function tableCount(table: string) {
  const response = await client.from(table).select("id", { count: "exact" }).limit(1);
  if (!response.error) return { exists: true, count: response.count ?? 0 };
  if (/does not exist|schema cache|could not find the table/i.test(response.error.message)) return { exists: false, count: 0 };
  throw new Error(`Count ${table}: ${response.error.message}`);
}
