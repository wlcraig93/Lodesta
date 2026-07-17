export type StoredCandidateProjection = {
  id: string;
  status: string;
  candidate_purpose: string;
  input_snapshot_id: string | null;
  version_model: unknown;
  form_definition_id: string | null;
  plan: unknown;
  copy: unknown;
  evidence: unknown;
};

export type StoredVersionProjection = {
  id: string;
  site_id: string;
  input_snapshot_id: string | null;
  form_definition_id: string | null;
  version_model: unknown;
};

export function isCanonicalStoredCandidate(candidate: StoredCandidateProjection) {
  const version = versionModel(candidate);
  return Boolean(candidate.input_snapshot_id)
    && Boolean(candidate.form_definition_id)
    && version.inputSnapshotId === candidate.input_snapshot_id
    && version.formDefinitionId === candidate.form_definition_id
    && schema(candidate.plan) === "generation-plan-v1"
    && schema(candidate.copy) === "site-copy-v1"
    && schema(candidate.evidence) === "generation-evidence-manifest-v1"
    && isCanonicalStoredVersion(version);
}

export function isCanonicalStoredVersionRow(row: StoredVersionProjection) {
  const version = versionModel(row);
  return Boolean(row.input_snapshot_id)
    && Boolean(row.form_definition_id)
    && version.inputSnapshotId === row.input_snapshot_id
    && version.formDefinitionId === row.form_definition_id
    && isCanonicalStoredVersion(version);
}

export function isCanonicalStoredVersion(version: Record<string, unknown>) {
  const qa = record(version.generationQa);
  return version.rendererVersion === "layout-v3"
    && version.designSchemaVersion === "design-v3"
    && isRecord(version.pageComposition)
    && qa?.schemaVersion === "canonical-generation-qa-v1";
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
