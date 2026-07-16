import { getSupabaseAdminClient } from "../lib/supabase/client";

type CandidateProjection = {
  id: string;
  status: string;
  versions: unknown;
  director: unknown;
  copy: unknown;
  dossier: unknown;
  evidence: unknown;
  findings: unknown;
};

const client = getSupabaseAdminClient();
const candidates: CandidateProjection[] = [];
const pageSize = 50;
for (let offset = 0; ; offset += pageSize) {
  const response = await client
    .from("site_candidates")
    .select([
      "id",
      "status",
      "versions:bundle_json->siteModel->versions",
      "director:bundle_json->presenceAssessment->siteDirectorPlanV1",
      "copy:bundle_json->presenceAssessment->generatedCopyDeck",
      "dossier:bundle_json->presenceAssessment->siteDossierV1",
      "evidence:bundle_json->presenceAssessment->evidenceLedgerV1",
      "findings:bundle_json->optimizationFindings"
    ].join(","))
    .order("created_at", { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (response.error) throw new Error(`Read site candidate generation shapes: ${response.error.message}`);
  candidates.push(...((response.data ?? []) as unknown as CandidateProjection[]));
  if ((response.data?.length ?? 0) < pageSize) break;
}

const storedVersionsResponse = await client.from("site_versions").select("id,version_model");
if (storedVersionsResponse.error) throw new Error(`Read stored site versions: ${storedVersionsResponse.error.message}`);
const sitesResponse = await client.from("sites").select("id", { count: "exact", head: true });
if (sitesResponse.error) throw new Error(`Count sites: ${sitesResponse.error.message}`);

const report = {
  schemaVersion: "generation-stored-data-report-v1",
  mutation: "none",
  generatedAt: new Date().toISOString(),
  sites: sitesResponse.count ?? 0,
  siteCandidates: {
    total: candidates.length,
    byStatus: countBy(candidates.map((candidate) => candidate.status)),
    accepted: candidates.filter((candidate) => candidate.status === "accepted").length,
    withSiteDirectorPlan: candidates.filter((candidate) => candidate.director !== null).length,
    withGeneratedCopyDeck: candidates.filter((candidate) => candidate.copy !== null).length,
    withDossier: candidates.filter((candidate) => candidate.dossier !== null).length,
    withLegacyEvidenceLedger: candidates.filter((candidate) => candidate.evidence !== null).length,
    withOptimizationFindings: candidates.filter((candidate) => Array.isArray(candidate.findings) && candidate.findings.length > 0).length,
    withNonLayoutV3Version: candidates.filter((candidate) => versions(candidate).some((version) => version.rendererVersion !== "layout-v3")).length,
    withNonQaV4Version: candidates.filter((candidate) => versions(candidate).some((version) => version.generationQa?.schemaVersion !== "generation-qa-v4")).length,
    requireOperatorDeletionOrCanonicalRegenerationBeforeCutover: candidates.length
  },
  storedSiteVersions: {
    total: storedVersionsResponse.data?.length ?? 0,
    nonLayoutV3: (storedVersionsResponse.data ?? []).filter((row) => versionModel(row).rendererVersion !== "layout-v3").length,
    nonQaV4: (storedVersionsResponse.data ?? []).filter((row) => versionModel(row).generationQa?.schemaVersion !== "generation-qa-v4").length
  },
  cutoverReady: candidates.length === 0 && (storedVersionsResponse.data?.length ?? 0) === 0
};

console.log(JSON.stringify(report, null, 2));

function versions(candidate: CandidateProjection) {
  return Array.isArray(candidate.versions) ? candidate.versions.filter(isRecord) : [];
}

function versionModel(row: { version_model: unknown }) {
  return isRecord(row.version_model) ? row.version_model : {};
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countBy(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((candidate) => candidate === value).length]));
}
