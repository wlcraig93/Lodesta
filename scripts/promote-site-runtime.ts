import "./load-env";

import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";
import { createSiteRuntimePatch, promoteRuntimePatch, type RuntimeRegistry } from "../packages/trusted-runtime";

const apply = process.argv.includes("--apply");
const actorId = process.argv.find((value) => value.startsWith("--verified-by="))?.slice("--verified-by=".length);
if (!apply || !actorId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(actorId)) {
  throw new Error("Use --apply --verified-by=<operator-id> after runtime security, capability, CSP, browser, and compatibility verification passes.");
}

const seriesId = "site-runtime-v1";
const prepared = await createSiteRuntimePatch({
  id: `runtime_patch_${crypto.randomUUID().replaceAll("-", "")}`,
  seriesId,
  sourceRevision: process.env.RAILWAY_GIT_COMMIT_SHA ?? "verified-working-tree",
  builderVersion: "trusted-runtime-builder@sha256:31d24faf0bf5265f2af840b87c7c5f2e2b6811780b68e949086e5b55da80cf61",
  securityStatus: "audited",
  compatibilityStatus: "passed"
});

// Compile without executing; browser behavior is covered by the release verification suite.
new Function(prepared.bytes.toString("utf8"));

const [series, retained] = await Promise.all([
  sitePlatformRepository.getRuntimeSeries(seriesId),
  sitePlatformRepository.getRuntimePatchByHash(prepared.patch.contentHash)
]);
if (series && retained?.id === series.activePatchId) {
  console.log(JSON.stringify({ ok: true, status: "already_active", seriesId, patchId: retained.id, contentHash: retained.contentHash }));
  process.exit(0);
}

const sites = await sitePlatformRepository.listSites();
let retainedVersionsChecked = 0;
for (const site of sites) {
  for (const version of await sitePlatformRepository.listSiteVersions(site.id)) {
    const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
    if (!artifact) throw new Error(`Retained version ${version.id} references a missing artifact.`);
    if (artifact.runtimeSeriesId === seriesId && artifact.qa.hardGate !== "passed") {
      throw new Error(`Retained version ${version.id} does not have a passed compatibility baseline.`);
    }
    retainedVersionsChecked += 1;
  }
}

const patch = retained ?? prepared.patch;
if (!retained) {
  await configuredArtifactBlobStore().putImmutable({
    key: patch.storageKey,
    bytes: prepared.bytes,
    contentType: "application/javascript; charset=utf-8",
    contentHash: asContentHash(patch.contentHash)
  });
  await sitePlatformRepository.saveRuntimePatch(patch);
}

const registry: RuntimeRegistry = {
  getSeries: (id) => sitePlatformRepository.getRuntimeSeries(id),
  getPatch: (id) => sitePlatformRepository.getRuntimePatch(id),
  savePatch: async (value) => sitePlatformRepository.saveRuntimePatch(value),
  saveSeries: (value) => sitePlatformRepository.saveRuntimeSeries(value)
};
const promoted = await promoteRuntimePatch({ registry, seriesId, patchId: patch.id, actorId });
console.log(JSON.stringify({
  ok: true,
  status: "promoted",
  seriesId,
  patchId: patch.id,
  previousPatchId: promoted.previousPatchId,
  contentHash: patch.contentHash,
  retainedVersionsChecked
}));

function asContentHash(value: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Runtime patch content hash is invalid.");
  return value as `sha256:${string}`;
}
