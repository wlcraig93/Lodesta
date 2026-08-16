import "./load-env";

import { configuredArtifactBlobStore, workspaceSourceSidecarKey, workspaceSourceSidecarSchema } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";

const legacySeries = new Set(["site-runtime-v1", "site-runtime-v2", "site-runtime-v3"]);
const managedImports = new Set(["NavigationDisclosure", "LeadForm", "LeadField", "LeadLabel", "LeadControl", "LeadSubmit", "LeadFormStatus"]);

const [sites, inputs, revisions, artifacts, runtimePatches, runtimeSeries] = await Promise.all([
  sitePlatformRepository.listSites(),
  sitePlatformRepository.listPublicBuildInputs(),
  sitePlatformRepository.listWorkspaceRevisions(),
  sitePlatformRepository.listBuildArtifacts(),
  sitePlatformRepository.listRuntimePatches(),
  sitePlatformRepository.listRuntimeSeries()
]);

const siteVersions = (await Promise.all(sites.map((site) => sitePlatformRepository.listSiteVersions(site.id)))).flat();
const inputById = new Map(inputs.map((input) => [input.id, input]));
const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
const blobStore = configuredArtifactBlobStore();
const workspaceSourceUsage: Array<{
  revisionId: string;
  siteId: string;
  createdByKind: string;
  runtimeSeriesId: string;
  files: Array<{ path: string; imports: string[]; legacySdkPath: boolean }>;
}> = [];
const missingWorkspaceSidecars: Array<{ revisionId: string; storageKey: string; reason: string }> = [];

await mapConcurrent(revisions, 12, async (revision) => {
  const input = inputById.get(revision.publicBuildInputId);
  const runtimeSeriesId = input?.capabilityConfiguration.trustedRuntimeSeries ?? "missing-input";
  const sidecarKey = workspaceSourceSidecarKey(revision.sourceArchiveKey);
  try {
    const blob = await blobStore.get(sidecarKey);
    if (!blob) throw new Error("missing blob");
    const sidecar = workspaceSourceSidecarSchema.parse(JSON.parse(blob.bytes.toString("utf8")));
    if (sidecar.archiveKey !== revision.sourceArchiveKey || sidecar.sourceHash !== revision.sourceHash) {
      throw new Error("sidecar does not match the retained revision");
    }
    const files = sidecar.files.flatMap((file) => {
      if (!/\.[cm]?[jt]sx?$/.test(file.path)) return [];
      const imports = sdkImports(file.content);
      const legacySdkPath = /from\s*["'](?:\.\.\/)+platform\/sdk["']/.test(file.content);
      return imports.length || legacySdkPath ? [{ path: file.path, imports, legacySdkPath }] : [];
    });
    if (files.length) workspaceSourceUsage.push({
      revisionId: revision.id,
      siteId: revision.siteId,
      createdByKind: revision.createdBy.kind,
      runtimeSeriesId,
      files
    });
  } catch (error) {
    missingWorkspaceSidecars.push({
      revisionId: revision.id,
      storageKey: sidecarKey,
      reason: error instanceof Error ? error.message : "unknown error"
    });
  }
});

const currentInputReferences = sites.flatMap((site) => {
  if (!site.currentPublicBuildInputId) return [];
  const input = inputById.get(site.currentPublicBuildInputId);
  return [{
    siteId: site.id,
    inputId: site.currentPublicBuildInputId,
    runtimeSeriesId: input?.capabilityConfiguration.trustedRuntimeSeries ?? "missing-input",
    ownerCreatedCurrentRevision: revisions.find((revision) => revision.id === site.currentWorkspaceRevisionId)?.createdBy.kind === "owner"
  }];
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  counts: {
    sites: sites.length,
    publicBuildInputs: inputs.length,
    workspaceRevisions: revisions.length,
    buildArtifacts: artifacts.length,
    siteVersions: siteVersions.length,
    runtimeSeries: runtimeSeries.length,
    runtimePatches: runtimePatches.length
  },
  strictReferences: {
    publicBuildInputs: inputs.map((input) => ({
      id: input.id,
      siteId: input.siteId,
      runtimeSeriesId: input.capabilityConfiguration.trustedRuntimeSeries,
      ownerOperationalRevision: input.ownerOperationalRevision,
      ownerIntentRevision: input.ownerIntentRevision
    })),
    workspaceRevisions: revisions.map((revision) => ({
      id: revision.id,
      siteId: revision.siteId,
      publicBuildInputId: revision.publicBuildInputId,
      runtimeSeriesId: inputById.get(revision.publicBuildInputId)?.capabilityConfiguration.trustedRuntimeSeries ?? "missing-input",
      createdBy: revision.createdBy
    })),
    buildArtifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      siteId: artifact.siteId,
      publicBuildInputId: artifact.publicBuildInputId,
      workspaceRevisionId: artifact.workspaceRevisionId,
      runtimeSeriesId: artifact.runtimeSeriesId,
      runtimePatchId: artifact.runtimePatchAtFinalization
    })),
    siteVersions: siteVersions.map((version) => ({
      id: version.id,
      siteId: version.siteId,
      status: version.status,
      publicBuildInputId: version.publicBuildInputId,
      workspaceRevisionId: version.workspaceRevisionId,
      artifactId: version.artifactId,
      runtimeSeriesId: artifactById.get(version.artifactId)?.runtimeSeriesId ?? "missing-artifact"
    })),
    runtimeSeries,
    runtimePatches
  },
  currentInputReferences,
  workspaceSourceUsage,
  missingWorkspaceSidecars,
  cutoverDecision: {
    currentSitesRequiringNewV4Input: currentInputReferences.filter((entry) => entry.runtimeSeriesId !== "site-runtime-v4").map((entry) => entry.siteId).sort(),
    ownerApprovalRequiredSiteIds: currentInputReferences.filter((entry) => entry.runtimeSeriesId !== "site-runtime-v4" && entry.ownerCreatedCurrentRevision).map((entry) => entry.siteId).sort(),
    retainedRuntimeSeriesIds: [...new Set([
      ...inputs.map((input) => input.capabilityConfiguration.trustedRuntimeSeries),
      ...artifacts.map((artifact) => artifact.runtimeSeriesId)
    ].filter((seriesId) => legacySeries.has(seriesId)))].sort(),
    retainedWorkspaceRevisionIds: revisions.filter((revision) => {
      const seriesId = inputById.get(revision.publicBuildInputId)?.capabilityConfiguration.trustedRuntimeSeries;
      return seriesId ? legacySeries.has(seriesId) : true;
    }).map((revision) => revision.id).sort(),
    retainedOwnerCreatedRevisionIds: revisions.filter((revision) => revision.createdBy.kind === "owner").map((revision) => revision.id).sort(),
    retainedWorkspaceCountWithLegacyFormOrNavigationImports: new Set(workspaceSourceUsage.map((entry) => entry.revisionId)).size,
    historicalRenderingMustRemainForSeries: [...new Set(artifacts.map((artifact) => artifact.runtimeSeriesId).filter((seriesId) => legacySeries.has(seriesId)))].sort(),
    newAuthoringTarget: "site-runtime-v4"
  }
};

const output = process.argv.includes("--summary") ? {
  schemaVersion: report.schemaVersion,
  generatedAt: report.generatedAt,
  counts: report.counts,
  publicBuildInputRuntimeCounts: countBy(report.strictReferences.publicBuildInputs.map((entry) => entry.runtimeSeriesId)),
  workspaceRevisionRuntimeCounts: countBy(report.strictReferences.workspaceRevisions.map((entry) => entry.runtimeSeriesId)),
  buildArtifactRuntimeCounts: countBy(report.strictReferences.buildArtifacts.map((entry) => entry.runtimeSeriesId)),
  siteVersionRuntimeCounts: countBy(report.strictReferences.siteVersions.map((entry) => entry.runtimeSeriesId)),
  workspaceManagedImportCounts: countBy(report.workspaceSourceUsage.flatMap((entry) => entry.files.flatMap((file) => file.imports))),
  workspaceLegacySdkPathCount: report.workspaceSourceUsage.filter((entry) => entry.files.some((file) => file.legacySdkPath)).length,
  missingWorkspaceSidecarCount: report.missingWorkspaceSidecars.length,
  cutoverDecision: {
    currentSiteCountRequiringNewV4Input: report.cutoverDecision.currentSitesRequiringNewV4Input.length,
    ownerApprovalRequiredSiteCount: report.cutoverDecision.ownerApprovalRequiredSiteIds.length,
    retainedRuntimeSeriesIds: report.cutoverDecision.retainedRuntimeSeriesIds,
    retainedWorkspaceRevisionCount: report.cutoverDecision.retainedWorkspaceRevisionIds.length,
    retainedOwnerCreatedRevisionCount: report.cutoverDecision.retainedOwnerCreatedRevisionIds.length,
    historicalRenderingMustRemainForSeries: report.cutoverDecision.historicalRenderingMustRemainForSeries,
    newAuthoringTarget: report.cutoverDecision.newAuthoringTarget
  }
} : report;

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

function sdkImports(source: string) {
  return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']#lodesta-sdk["']/g)]
    .flatMap((match) => match[1].split(",").map((value) => value.trim().split(/\s+as\s+/i)[0]))
    .filter((value) => managedImports.has(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
}

async function mapConcurrent<Input>(values: Input[], concurrency: number, visit: (value: Input) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const value = values[index++];
      if (value !== undefined) await visit(value);
    }
  }));
}

function countBy(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((candidate) => candidate === value).length]));
}
