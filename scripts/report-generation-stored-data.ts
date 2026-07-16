import { getSupabaseAdminClient } from "../lib/supabase/client";
import {
  isCanonicalStoredCandidate,
  isCanonicalStoredSite,
  isCanonicalStoredVersion,
  schema,
  versionModel,
  type StoredCandidateProjection,
  type StoredSiteProjection
} from "../lib/generation-stored-state";

const client = getSupabaseAdminClient();
const candidates: StoredCandidateProjection[] = [];
const pageSize = 100;
for (let offset = 0; ; offset += pageSize) {
  const response = await client
    .from("site_candidates")
    .select([
      "id",
      "status",
      "candidate_purpose",
      "versions:bundle_json->siteModel->versions",
      "plan:bundle_json->presenceAssessment->generationPlan",
      "copy:bundle_json->presenceAssessment->siteCopy",
      "evidence:bundle_json->presenceAssessment->evidenceLedger",
      "trace:bundle_json->presenceAssessment->generationTrace",
      "judge:bundle_json->presenceAssessment->generationJudge"
    ].join(","))
    .order("created_at", { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (response.error) throw new Error(`Read site candidate generation shapes: ${response.error.message}`);
  candidates.push(...((response.data ?? []) as unknown as StoredCandidateProjection[]));
  if ((response.data?.length ?? 0) < pageSize) break;
}

const storedVersionsResponse = await client.from("site_versions").select("id,site_id,version_model");
if (storedVersionsResponse.error) throw new Error(`Read stored site versions: ${storedVersionsResponse.error.message}`);
const sitesResponse = await client.from("sites").select("id,slug,status,site_model,presence_assessment");
if (sitesResponse.error) throw new Error(`Read sites: ${sitesResponse.error.message}`);

const sites = (sitesResponse.data ?? []) as unknown as StoredSiteProjection[];
const canonicalCandidates = candidates.filter(isCanonicalStoredCandidate);
const preCutoverCandidates = candidates.filter((candidate) => !isCanonicalStoredCandidate(candidate));
const canonicalSites = sites.filter(isCanonicalStoredSite);
const preCutoverSites = sites.filter((site) => !isCanonicalStoredSite(site));
const storedVersions = storedVersionsResponse.data ?? [];
const noncanonicalStoredVersions = storedVersions.filter((row) => !isCanonicalStoredVersion(versionModel(row)));
const report = {
  schemaVersion: "generation-stored-data-report-v2",
  mutation: "none",
  generatedAt: new Date().toISOString(),
  sites: {
    total: sites.length,
    canonical: canonicalSites.length,
    preCutover: preCutoverSites.length,
    preCutoverIds: preCutoverSites.map((site) => site.id),
    nonDraftPreCutover: preCutoverSites.filter((site) => site.status !== "draft").length
  },
  siteCandidates: {
    total: candidates.length,
    canonical: canonicalCandidates.length,
    preCutover: preCutoverCandidates.length,
    preCutoverIds: preCutoverCandidates.map((candidate) => candidate.id),
    acceptedPreCutover: preCutoverCandidates.filter((candidate) => candidate.status === "accepted").length,
    byStatus: countBy(candidates.map((candidate) => candidate.status)),
    byPurpose: countBy(candidates.map((candidate) => candidate.candidate_purpose ?? "customer_prospect")),
    canonicalContractCoverage: {
      generationPlan: candidates.filter((candidate) => schema(candidate.plan) === "generation-plan-v1").length,
      siteCopy: candidates.filter((candidate) => schema(candidate.copy) === "site-copy-v1").length,
      evidenceLedger: candidates.filter((candidate) => schema(candidate.evidence) === "evidence-ledger-v1").length,
      generationTrace: candidates.filter((candidate) => schema(candidate.trace) === "generation-pipeline-trace-v1").length,
      generationJudge: candidates.filter((candidate) => schema(candidate.judge) === "generation-judge-v1").length
    }
  },
  storedSiteVersions: {
    total: storedVersions.length,
    canonical: storedVersions.length - noncanonicalStoredVersions.length,
    noncanonical: noncanonicalStoredVersions.length,
    noncanonicalIds: noncanonicalStoredVersions.map((row) => row.id)
  },
  operatorAction: preCutoverCandidates.length || preCutoverSites.length || noncanonicalStoredVersions.length
    ? "Delete pre-cutover test candidates/sites/versions or regenerate them canonically before cutover."
    : "No stored generation cleanup is required.",
  cutoverReady: preCutoverCandidates.length === 0 && preCutoverSites.length === 0 && noncanonicalStoredVersions.length === 0
};

console.log(JSON.stringify(report, null, 2));

function countBy(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((candidate) => candidate === value).length]));
}
