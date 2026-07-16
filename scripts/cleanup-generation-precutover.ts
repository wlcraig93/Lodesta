import { getSupabaseAdminClient } from "../lib/supabase/client";
import {
  isCanonicalStoredCandidate,
  isCanonicalStoredSite,
  isCanonicalStoredVersion,
  versionModel,
  type StoredCandidateProjection,
  type StoredSiteProjection
} from "../lib/generation-stored-state";

const confirmation = "DELETE_PRE_CUTOVER_GENERATION_DATA";
const execute = process.argv.includes("--execute");
const suppliedConfirmation = process.argv.find((value) => value.startsWith("--confirm="))?.slice("--confirm=".length);
const client = getSupabaseAdminClient();

const candidatesResponse = await client.from("site_candidates").select([
  "id",
  "status",
  "candidate_purpose",
  "versions:bundle_json->siteModel->versions",
  "plan:bundle_json->presenceAssessment->generationPlan",
  "copy:bundle_json->presenceAssessment->siteCopy",
  "evidence:bundle_json->presenceAssessment->evidenceLedger",
  "trace:bundle_json->presenceAssessment->generationTrace",
  "judge:bundle_json->presenceAssessment->generationJudge"
].join(","));
if (candidatesResponse.error) throw new Error(`Read site candidates: ${candidatesResponse.error.message}`);

const sitesResponse = await client.from("sites").select("id,slug,status,site_model,presence_assessment");
if (sitesResponse.error) throw new Error(`Read sites: ${sitesResponse.error.message}`);
const versionsResponse = await client.from("site_versions").select("id,site_id,version_model");
if (versionsResponse.error) throw new Error(`Read site versions: ${versionsResponse.error.message}`);
const bucketsResponse = await client.storage.listBuckets();
if (bucketsResponse.error) throw new Error(`Read storage buckets: ${bucketsResponse.error.message}`);

const candidates = (candidatesResponse.data ?? []) as unknown as StoredCandidateProjection[];
const sites = (sitesResponse.data ?? []) as unknown as StoredSiteProjection[];
const versions = versionsResponse.data ?? [];
const preCutoverCandidates = candidates.filter((candidate) => !isCanonicalStoredCandidate(candidate));
const preCutoverSites = sites.filter((site) => !isCanonicalStoredSite(site));
const protectedCandidateIds = preCutoverCandidates.filter((candidate) => candidate.status === "accepted").map((candidate) => candidate.id);
const protectedSiteIds = preCutoverSites.filter((site) => site.status !== "draft").map((site) => site.id);
const preCutoverSiteIds = new Set(preCutoverSites.map((site) => site.id));
const standaloneVersionIds = versions
  .filter((row) => !preCutoverSiteIds.has(row.site_id ?? "") && !isCanonicalStoredVersion(versionModel(row)))
  .map((row) => row.id);
const legacyAssetLibraryBucket = bucketsResponse.data.some((bucket) => bucket.id === "lodesta-asset-library");

const summary = {
  mode: execute ? "execute" : "dry_run",
  preCutoverCandidates: preCutoverCandidates.length,
  preCutoverCandidateIds: preCutoverCandidates.map((candidate) => candidate.id),
  preCutoverSites: preCutoverSites.length,
  preCutoverSiteIds: preCutoverSites.map((site) => site.id),
  standaloneNoncanonicalVersions: standaloneVersionIds.length,
  standaloneNoncanonicalVersionIds: standaloneVersionIds,
  legacyAssetLibraryBucket,
  protectedCandidateIds,
  protectedSiteIds
};
console.log(JSON.stringify(summary, null, 2));

if (!execute) {
  console.log(`Dry run only. Execute with --execute --confirm=${confirmation}.`);
  process.exit(0);
}
if (suppliedConfirmation !== confirmation) throw new Error(`Refusing cleanup without --confirm=${confirmation}.`);
if (protectedCandidateIds.length) throw new Error(`Refusing to delete accepted candidates: ${protectedCandidateIds.join(", ")}.`);
if (protectedSiteIds.length) throw new Error(`Refusing to delete non-draft sites: ${protectedSiteIds.join(", ")}.`);

if (legacyAssetLibraryBucket) await deleteLegacyAssetLibraryBucket();

for (const ids of chunks(preCutoverCandidates.map((candidate) => candidate.id), 100)) {
  const response = await client.from("site_candidates").delete().in("id", ids);
  if (response.error) throw new Error(`Delete pre-cutover candidates: ${response.error.message}`);
}
for (const ids of chunks(standaloneVersionIds, 100)) {
  const response = await client.from("site_versions").delete().in("id", ids);
  if (response.error) throw new Error(`Delete noncanonical site versions: ${response.error.message}`);
}
for (const ids of chunks(preCutoverSites.map((site) => site.id), 100)) {
  const response = await client.from("sites").delete().in("id", ids);
  if (response.error) throw new Error(`Delete pre-cutover draft sites: ${response.error.message}`);
}

const [candidateCheck, siteCheck, versionCheck] = await Promise.all([
  client.from("site_candidates").select("id", { count: "exact", head: true }),
  client.from("sites").select("id", { count: "exact", head: true }),
  client.from("site_versions").select("id", { count: "exact", head: true })
]);
if (candidateCheck.error) throw new Error(`Verify candidate cleanup: ${candidateCheck.error.message}`);
if (siteCheck.error) throw new Error(`Verify site cleanup: ${siteCheck.error.message}`);
if (versionCheck.error) throw new Error(`Verify version cleanup: ${versionCheck.error.message}`);
if ((candidateCheck.count ?? 0) !== candidates.length - preCutoverCandidates.length) throw new Error("Candidate cleanup count did not match the audited target set.");
if ((siteCheck.count ?? 0) !== sites.length - preCutoverSites.length) throw new Error("Site cleanup count did not match the audited target set.");
if ((versionCheck.count ?? 0) !== versions.length - standaloneVersionIds.length - versions.filter((row) => preCutoverSiteIds.has(row.site_id ?? "")).length) {
  throw new Error("Site-version cleanup count did not match the audited target set.");
}

console.log(JSON.stringify({
  ok: true,
  deletedCandidates: preCutoverCandidates.length,
  deletedSites: preCutoverSites.length,
  deletedStandaloneVersions: standaloneVersionIds.length,
  deletedLegacyAssetLibraryBucket: legacyAssetLibraryBucket
}, null, 2));

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function deleteLegacyAssetLibraryBucket() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const emptyResponse = await client.storage.emptyBucket("lodesta-asset-library");
    if (emptyResponse.error) throw new Error(`Empty legacy asset-library bucket: ${emptyResponse.error.message}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    const deleteResponse = await client.storage.deleteBucket("lodesta-asset-library");
    if (!deleteResponse.error) return;
    if (!/not empty/i.test(deleteResponse.error.message)) {
      throw new Error(`Delete legacy asset-library bucket: ${deleteResponse.error.message}`);
    }
  }
  throw new Error("Delete legacy asset-library bucket: bucket remained nonempty after five Storage API cleanup attempts.");
}
