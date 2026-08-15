import "./load-env";
import { getSupabaseAdminClient } from "../lib/supabase/client";

const admin = getSupabaseAdminClient();
const [
  { data: artifactRows, error: artifactError },
  { data: versionRows, error: versionError },
  { data: inputRows, error: inputError }
] = await Promise.all([
  admin.from("site_build_artifacts").select("id,site_id,public_build_input_id,artifact"),
  admin.from("site_versions").select("id,site_id,artifact_id,status"),
  admin.from("site_public_build_inputs").select("id,input")
]);
if (artifactError) throw new Error(`Read site_build_artifacts: ${artifactError.message}`);
if (versionError) throw new Error(`Read site_versions: ${versionError.message}`);
if (inputError) throw new Error(`Read site_public_build_inputs: ${inputError.message}`);

const retiredSubjectiveBlockingIds = new Set(["render.text_clipping", "render.text_occlusion", "route.required"]);
const inputById = new Map((inputRows ?? []).map((row) => [String(row.id), record(row.input)]));
const artifactViolations = (artifactRows ?? []).flatMap((row) => {
  const artifact = record(row.artifact);
  const qa = record(artifact?.qa);
  const findings = Array.isArray(qa?.findings) ? qa.findings : [];
  const matching = findings
    .map(record)
    .filter((finding): finding is Record<string, unknown> =>
      Boolean(finding && typeof finding.id === "string" && retiredSubjectiveBlockingIds.has(finding.id)));
  const builtRoutes = new Set(arrayOfRecords(artifact?.routes)
    .map((route) => route.path)
    .filter((path): path is string => typeof path === "string"));
  const input = inputById.get(String(row.public_build_input_id));
  const intent = record(input?.intent);
  const missingRequiredRoutes = arrayOfRecords(intent?.pageRequirements)
    .filter((page) => page.required === true)
    .map((page) => typeof page.slug === "string" && page.slug.length
      ? `/${page.slug.replace(/^\/+|\/+$/g, "")}`
      : "/")
    .filter((path) => !builtRoutes.has(path));
  return matching.length || missingRequiredRoutes.length ? [{
    artifactId: String(row.id),
    siteId: String(row.site_id),
    findingIds: [
      ...new Set([
        ...matching.map((finding) => String(finding.id)),
        ...(missingRequiredRoutes.length ? ["route.required"] : [])
      ])
    ].sort(),
    missingRequiredRoutes
  }] : [];
});
const publishedArtifactIds = new Set(
  (versionRows ?? [])
    .filter((row) => row.status === "published")
    .map((row) => String(row.artifact_id))
);
const publishedViolations = artifactViolations.filter((violation) =>
  publishedArtifactIds.has(violation.artifactId));
const report = {
  generatedAt: new Date().toISOString(),
  policyChange: "Treat rendered-text clipping, occlusion, and requested-route omissions as advisory authoring guidance.",
  retainedArtifacts: artifactRows?.length ?? 0,
  retainedVersions: versionRows?.length ?? 0,
  publishedVersions: publishedArtifactIds.size,
  artifactViolations,
  publishedViolations,
  cleanCutAllowed: true
};

console.log(JSON.stringify(report, null, 2));

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = record(item);
        return parsed ? [parsed] : [];
      })
    : [];
}
