export type StoredCandidateProjection = {
  id: string;
  status: string;
  candidate_purpose: string;
  versions: unknown;
  plan: unknown;
  copy: unknown;
  evidence: unknown;
  trace: unknown;
  judge: unknown;
};

export type StoredSiteProjection = {
  id: string;
  slug: string;
  status: string;
  site_model: unknown;
  presence_assessment: unknown;
};

export function isCanonicalStoredCandidate(candidate: StoredCandidateProjection) {
  return schema(candidate.plan) === "generation-plan-v1"
    && schema(candidate.copy) === "site-copy-v1"
    && schema(candidate.evidence) === "evidence-ledger-v1"
    && schema(candidate.trace) === "generation-pipeline-trace-v1"
    && schema(candidate.judge) === "generation-judge-v1"
    && storedCandidateVersions(candidate).length > 0
    && storedCandidateVersions(candidate).every(isCanonicalStoredVersion);
}

export function isCanonicalStoredSite(site: StoredSiteProjection) {
  const assessment = record(site.presence_assessment);
  const siteModel = record(site.site_model);
  const versions = Array.isArray(siteModel?.versions) ? siteModel.versions.filter(isRecord) : [];
  return schema(assessment?.generationPlan) === "generation-plan-v1"
    && schema(assessment?.siteCopy) === "site-copy-v1"
    && schema(assessment?.evidenceLedger) === "evidence-ledger-v1"
    && schema(assessment?.generationTrace) === "generation-pipeline-trace-v1"
    && schema(assessment?.generationJudge) === "generation-judge-v1"
    && versions.length > 0
    && versions.every(isCanonicalStoredVersion);
}

export function isCanonicalStoredVersion(version: Record<string, unknown>) {
  const qa = record(version.generationQa);
  return version.rendererVersion === "layout-v3"
    && version.designSchemaVersion === "design-v3"
    && isRecord(version.pageComposition)
    && qa?.schemaVersion === "canonical-generation-qa-v1";
}

export function storedCandidateVersions(candidate: StoredCandidateProjection) {
  return Array.isArray(candidate.versions) ? candidate.versions.filter(isRecord) : [];
}

export function versionModel(row: { version_model: unknown }) {
  return record(row.version_model) ?? {};
}

export function schema(value: unknown) {
  return isRecord(value) && typeof value.schemaVersion === "string" ? value.schemaVersion : undefined;
}

function record(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
