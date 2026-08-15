import "./load-env";

import { configuredArtifactBlobStore, workspaceSourceSidecarKey, workspaceSourceSidecarSchema } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";

const removedBindingKinds = new Set(["gallery", "disclosure", "map"]);
const retiredIntentCapabilities = new Set(["gallery", "disclosure"]);
const approvedAnalyticsAttributes = new Set(["data-lodesta-conversion", "data-lodesta-role"]);
const bindingAttributePattern = /\bdata-lodesta-[a-z0-9-]+/gi;

const sites = await sitePlatformRepository.listSites();
const artifactBindings: Array<{
  siteId: string;
  versionId: string;
  versionStatus: string;
  artifactId: string;
  runtimeSeriesId: string;
  bindings: Array<{ kind: string; id: string; route: string }>;
}> = [];
const intentCapabilities: Array<{ siteId: string; intentId: string; revision: number; values: string[] }> = [];
const revisionIds = new Set<string>();

await mapConcurrent(sites, 12, async (site) => {
  if (site.currentWorkspaceRevisionId) revisionIds.add(site.currentWorkspaceRevisionId);
  const [intent, versions] = await Promise.all([
    sitePlatformRepository.getSiteIntent(site.id),
    sitePlatformRepository.listSiteVersions(site.id)
  ]);
  if (intent) {
    const values = intent.enabledCapabilities.filter((value) => retiredIntentCapabilities.has(value));
    if (values.length) intentCapabilities.push({ siteId: site.id, intentId: intent.id, revision: intent.revision, values });
  }
  await mapConcurrent(versions, 12, async (version) => {
    revisionIds.add(version.workspaceRevisionId);
    const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
    if (!artifact) throw new Error(`Retained version ${version.id} references missing artifact ${version.artifactId}.`);
    const bindings = artifact.capabilityBindings
      .filter((binding) => removedBindingKinds.has(binding.kind))
      .map((binding) => ({ kind: binding.kind, id: binding.id, route: binding.route }));
    if (bindings.length) artifactBindings.push({
      siteId: site.id,
      versionId: version.id,
      versionStatus: version.status,
      artifactId: artifact.id,
      runtimeSeriesId: artifact.runtimeSeriesId,
      bindings
    });
  });
});

const blobStore = configuredArtifactBlobStore();
const workspaceAttributes: Array<{
  revisionId: string;
  siteId: string;
  file: string;
  attributes: string[];
}> = [];
const workspaceSeries: Array<{ revisionId: string; siteId: string; publicBuildInputId: string; runtimeSeriesId: string }> = [];
const legacySdkImports: Array<{ revisionId: string; siteId: string; file: string; imports: string[] }> = [];

await mapConcurrent([...revisionIds].sort(), 12, async (revisionId) => {
  const revision = await sitePlatformRepository.getWorkspaceRevision(revisionId);
  if (!revision) throw new Error(`Retained workspace revision ${revisionId} is missing.`);
  const buildInput = await sitePlatformRepository.getPublicBuildInput(revision.publicBuildInputId);
  if (!buildInput) throw new Error(`Retained workspace revision ${revisionId} references missing build input ${revision.publicBuildInputId}.`);
  workspaceSeries.push({
    revisionId: revision.id,
    siteId: revision.siteId,
    publicBuildInputId: revision.publicBuildInputId,
    runtimeSeriesId: buildInput.capabilityConfiguration.trustedRuntimeSeries
  });
  const sidecarKey = workspaceSourceSidecarKey(revision.sourceArchiveKey);
  const blob = await blobStore.get(sidecarKey);
  if (!blob) throw new Error(`Retained workspace sidecar ${sidecarKey} is missing.`);
  const sidecar = workspaceSourceSidecarSchema.parse(JSON.parse(blob.bytes.toString("utf8")));
  if (sidecar.archiveKey !== revision.sourceArchiveKey || sidecar.sourceHash !== revision.sourceHash) {
    throw new Error(`Workspace sidecar ${sidecarKey} does not match revision ${revision.id}.`);
  }
  for (const file of sidecar.files) {
    if (!/\.tsx?$/.test(file.path)) continue;
    const attributes = [...new Set(file.content.match(bindingAttributePattern) ?? [])]
      .map((value) => value.toLowerCase())
      .filter((value) => !approvedAnalyticsAttributes.has(value))
      .sort();
    if (attributes.length) workspaceAttributes.push({ revisionId: revision.id, siteId: revision.siteId, file: file.path, attributes });
    const imports = [...file.content.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']#lodesta-sdk["']/g)]
      .flatMap((match) => match[1].split(",").map((value) => value.trim().split(/\s+as\s+/i)[0]).filter((value) => ["NavigationDisclosure", "ManagedMap", "Gallery", "Disclosure"].includes(value)))
      .sort();
    if (imports.length) legacySdkImports.push({ revisionId: revision.id, siteId: revision.siteId, file: file.path, imports: [...new Set(imports)] });
  }
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  siteCount: sites.length,
  retainedWorkspaceRevisionCount: revisionIds.size,
  retainedArtifactBindings: artifactBindings,
  retainedIntentCapabilities: intentCapabilities,
  retainedWorkspaceKernelAttributes: workspaceAttributes,
  retainedWorkspaceRuntimeSeries: workspaceSeries,
  retainedWorkspaceLegacySdkImports: legacySdkImports,
  cutoverDecision: {
    preserveV1BindingEnums: artifactBindings.some((entry) => entry.bindings.some((binding) => binding.kind === "gallery" || binding.kind === "disclosure")),
    preserveHistoricalIntentValues: intentCapabilities.length > 0,
    staleWorkspaceRevisionIds: [...new Set([
      ...workspaceAttributes.map((entry) => entry.revisionId),
      ...workspaceSeries.filter((entry) => entry.runtimeSeriesId !== "site-runtime-v3").map((entry) => entry.revisionId),
      ...legacySdkImports.map((entry) => entry.revisionId)
    ])].sort()
  }
};

const output = process.argv.includes("--summary")
  ? {
      schemaVersion: report.schemaVersion,
      generatedAt: report.generatedAt,
      siteCount: report.siteCount,
      retainedWorkspaceRevisionCount: report.retainedWorkspaceRevisionCount,
      retainedArtifactCountWithLegacyBindings: report.retainedArtifactBindings.length,
      retainedLegacyBindingCounts: countBy(report.retainedArtifactBindings.flatMap((entry) => entry.bindings.map((binding) => binding.kind))),
      retainedIntentCountWithLegacyCapabilities: report.retainedIntentCapabilities.length,
      retainedLegacyIntentCapabilityCounts: countBy(report.retainedIntentCapabilities.flatMap((entry) => entry.values)),
      retainedWorkspaceCountWithReservedAttributes: new Set(report.retainedWorkspaceKernelAttributes.map((entry) => entry.revisionId)).size,
      retainedWorkspaceRuntimeSeriesCounts: countBy(report.retainedWorkspaceRuntimeSeries.map((entry) => entry.runtimeSeriesId)),
      retainedWorkspaceCountWithLegacySdkImports: new Set(report.retainedWorkspaceLegacySdkImports.map((entry) => entry.revisionId)).size,
      retainedLegacySdkImportCounts: countBy(report.retainedWorkspaceLegacySdkImports.flatMap((entry) => entry.imports)),
      cutoverDecision: {
        preserveV1BindingEnums: report.cutoverDecision.preserveV1BindingEnums,
        preserveHistoricalIntentValues: report.cutoverDecision.preserveHistoricalIntentValues,
        staleWorkspaceRevisionCount: report.cutoverDecision.staleWorkspaceRevisionIds.length
      }
    }
  : report;
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

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
