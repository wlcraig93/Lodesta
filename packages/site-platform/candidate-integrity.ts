import { sha256, stableJson } from "@/packages/business-data";
import type { SitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository, redirectsStrandedByRoutes, type PlatformOperationsRepository } from "@/packages/platform-operations";
import {
  siteCandidateIntegritySchema,
  websiteSourceSnapshotPayloadSchema,
  type SiteBuildArtifact,
  type SiteCandidateIntegrity
} from "@/packages/site-contracts";

export async function deriveSiteCandidateIntegrity(input: {
  versionId: string;
  repository: SitePlatformRepository;
  operationsRepository?: PlatformOperationsRepository;
}): Promise<SiteCandidateIntegrity> {
  const operations = input.operationsRepository ?? platformOperationsRepository;
  const version = await input.repository.getSiteVersion(input.versionId);
  if (!version) throw new Error("Site version not found.");
  const [site, artifact, buildInput, redirects, versionRedirects, sourceCoverage] = await Promise.all([
    input.repository.getSite(version.siteId),
    input.repository.getBuildArtifact(version.artifactId),
    input.repository.getPublicBuildInput(version.publicBuildInputId),
    operations.listRedirects(version.siteId),
    input.repository.listSiteVersionRedirects(version.id),
    input.repository.getSiteVersionSourceCoverage(version.id)
  ]);
  if (!site) throw new Error("Site not found.");
  const [state, intent, forms, assets, snapshots, workspace, runtimeSeries, runtimePatch] = await Promise.all([
    input.repository.getBusinessState(site.businessId),
    input.repository.getSiteIntent(site.id),
    Promise.all(version.formDefinitionIds.map((formId) => input.repository.getFormDefinition(formId))),
    Promise.all(version.assetRevisionIds.map((assetId) => input.repository.getAssetRevision(assetId))),
    Promise.all(version.sourceSnapshotIds.map((snapshotId) => input.repository.getSourceSnapshot(snapshotId))),
    input.repository.getWorkspaceRevision(version.workspaceRevisionId),
    artifact ? input.repository.getRuntimeSeries(artifact.runtimeSeriesId) : undefined,
    artifact ? input.repository.getRuntimePatch(artifact.runtimePatchAtFinalization) : undefined
  ]);
  const issues: SiteCandidateIntegrity["issues"] = [];
  const staleOwnerAuthority = (
    version.status === "stale"
    && version.staleReason === "owner_authority_changed"
  ) || Boolean(
    buildInput
    && state
    && intent
    && (
      version.ownerOperationalRevision !== state.ownerOperationalRevision
      || version.ownerIntentRevision !== intent.ownerIntentRevision
      || buildInput.ownerOperationalRevision !== state.ownerOperationalRevision
      || buildInput.ownerIntentRevision !== intent.ownerIntentRevision
    )
  );
  if (staleOwnerAuthority) {
    issues.push(issue(
      "owner_authority_changed",
      "Business details or site preferences changed after this version. Review the refreshed candidate.",
      version.publicBuildInputId
    ));
  }
  if (
    !artifact
    || artifact.siteId !== site.id
    || artifact.artifactHash !== version.artifactHash
    || artifact.artifactHash !== artifactContentHash(artifact)
    || artifact.qa.hardGate !== "passed"
    || !artifactManifestIsCoherent(artifact)
  ) {
    issues.push(issue("artifact_integrity", "The exact candidate artifact failed technical integrity verification.", version.artifactId));
  }
  if (
    !buildInput
    || !state
    || !intent
    || buildInput.siteId !== site.id
    || buildInput.businessId !== site.businessId
    || buildInput.inputHash !== publicBuildInputContentHash(buildInput)
    || buildInput.intent.siteId !== site.id
    || buildInput.intent.ownerIntentRevision !== buildInput.ownerIntentRevision
    || !sameIds(buildInput.forms.map((form) => form.id), version.formDefinitionIds)
    || !sameIds(buildInput.assetRevisionIds, version.assetRevisionIds)
    || !sameIds(buildInput.sourceSnapshotIds, version.sourceSnapshotIds)
  ) {
    issues.push(issue("artifact_integrity", "The retained candidate input manifest is missing or inconsistent.", version.publicBuildInputId));
  }
  if (
    !workspace
    || workspace.siteId !== site.id
    || workspace.publicBuildInputId !== version.publicBuildInputId
    || workspace.ownerOperationalRevision !== version.ownerOperationalRevision
    || workspace.ownerIntentRevision !== version.ownerIntentRevision
    || artifact?.workspaceRevisionId !== workspace.id
    || artifact?.publicBuildInputId !== version.publicBuildInputId
    || artifact?.ownerOperationalRevision !== version.ownerOperationalRevision
    || artifact?.ownerIntentRevision !== version.ownerIntentRevision
  ) {
    issues.push(issue("artifact_integrity", "The candidate workspace manifest and retained artifact references do not match.", version.workspaceRevisionId));
  }
  if (
    !artifact
    || !runtimeSeries
    || !runtimePatch
    || runtimePatch.seriesId !== artifact.runtimeSeriesId
    || runtimePatch.securityStatus !== "audited"
    || runtimePatch.compatibilityStatus !== "passed"
  ) {
    issues.push(issue("managed_capability", "The trusted runtime retained for this candidate is unavailable or invalid.", artifact?.runtimePatchAtFinalization));
  }
  if (assets.some((asset) => !asset || asset.businessId !== site.businessId)) {
    issues.push(issue("managed_capability", "The candidate references a missing or foreign retained asset.", version.id));
  }
  if (snapshots.some((snapshot) => !snapshot || snapshot.businessId !== site.businessId)) {
    issues.push(issue("artifact_integrity", "The candidate references missing or foreign retained source material.", version.id));
  }
  if (snapshots.some((snapshot) => snapshot?.payload.kind === "website-mirror"
    && !websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload).success)) {
    issues.push(issue("artifact_integrity", "The retained website-source manifest is malformed.", version.id));
  }
  const hasWebsiteCrawl = snapshots.some((snapshot) => snapshot?.payload.kind === "website-mirror");
  if (hasWebsiteCrawl && (!sourceCoverage || sourceCoverage.versionId !== version.id || sourceCoverage.artifactHash !== version.artifactHash)) {
    issues.push(issue("artifact_integrity", "The candidate source-coverage manifest is missing or does not match the artifact.", version.id));
  }
  if (forms.some((form) => !form || form.siteId !== site.id || form.status === "retired")) {
    issues.push(issue("managed_capability", "The candidate references a missing, retired, or foreign lead form.", version.id));
  }
  if (
    artifact
    && artifact.capabilityBindings.some((binding) =>
      binding.kind === "form"
      && !version.formDefinitionIds.includes(String(binding.config.formId ?? "")))
  ) {
    issues.push(issue("managed_capability", "The candidate references a form outside its retained managed capabilities.", artifact.id));
  }
  if (artifact) {
    const routes = new Set(artifact.routes.map((route) => route.path));
    const versionSources = new Set(versionRedirects.map((redirect) => redirect.sourcePath));
    for (const redirect of versionRedirects) {
      if (routes.has(redirect.sourcePath) || !routes.has(redirect.destinationPath) || versionSources.has(redirect.destinationPath)) {
        issues.push(issue("stranded_redirect", `Candidate redirect ${redirect.sourcePath} is conflicting, chained, or points to an unavailable route.`, redirect.id));
      }
    }
    for (const redirect of redirects.filter((candidate) => candidate.status === "active")) {
      const candidate = versionRedirects.find((versionRedirect) => versionRedirect.sourcePath === redirect.sourcePath);
      if (routes.has(redirect.sourcePath) || !routes.has(redirect.destinationPath) || candidate && candidate.destinationPath !== redirect.destinationPath) {
        issues.push(issue("stranded_redirect", `Owner redirect ${redirect.sourcePath} conflicts with this candidate or points to an unavailable route.`, redirect.id));
      }
    }
    for (const redirect of redirectsStrandedByRoutes(redirects, artifact.routes.map((route) => route.path))) {
      issues.push(issue("stranded_redirect", `Active redirect ${redirect.sourcePath} points to an unavailable route.`, redirect.id));
    }
  }
  return siteCandidateIntegritySchema.parse({
    schemaVersion: 1,
    siteId: site.id,
    versionId: version.id,
    artifactHash: version.artifactHash,
    status: staleOwnerAuthority
      ? "stale_owner_authority"
      : issues.length
        ? "failed_integrity"
        : "current",
    issues,
    checkedAt: new Date().toISOString()
  });
}

function artifactContentHash(artifact: SiteBuildArtifact) {
  return sha256(stableJson({
    files: artifact.files.map(({ path, contentType, contentHash, bytes }) => ({ path, contentType, contentHash, bytes })),
    routes: artifact.routes.map(({ path, htmlFile, title, description }) => ({ path, htmlFile, title, description })),
    factBindings: artifact.factBindings,
    capabilityBindings: artifact.capabilityBindings,
    runtimeSeriesId: artifact.runtimeSeriesId
  }));
}

function publicBuildInputContentHash(buildInput: NonNullable<Awaited<ReturnType<SitePlatformRepository["getPublicBuildInput"]>>>) {
  const { inputHash: _inputHash, ...withoutHash } = buildInput;
  return sha256(stableJson(withoutHash));
}

function artifactManifestIsCoherent(artifact: SiteBuildArtifact) {
  const filePaths = new Set(artifact.files.map((file) => file.path));
  const storageKeys = new Set(artifact.files.map((file) => file.storageKey));
  const routePaths = new Set(artifact.routes.map((route) => route.path));
  return (
    filePaths.size === artifact.files.length
    && storageKeys.size === artifact.files.length
    && routePaths.size === artifact.routes.length
    && artifact.files.every((file) => file.storageKey === `${artifact.storagePrefix.replace(/\/$/, "")}/${file.path}`)
    && artifact.routes.every((route) => filePaths.has(route.htmlFile))
  );
}

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function issue(code: SiteCandidateIntegrity["issues"][number]["code"], message: string, referenceId?: string) {
  return { code, message, referenceId };
}
