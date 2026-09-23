import "./load-env";

import { randomUUID } from "node:crypto";
import {
  assertNoPrivateBuildInputFields,
  createPublicBuildInput,
  decodeRetainedSourceResource,
  ingestWebsite,
  retainedWebsiteReplayTransport,
  sha256,
  stableJson,
  type RetainedReplayResource
} from "../packages/business-data";
import { sitePlatformRepository as repository } from "../packages/platform-data";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import {
  businessStateSchema,
  canonicalSiteAuthoringRuntimeSeriesId,
  websiteSourceSnapshotPayloadSchema,
  type BusinessState
} from "../packages/site-contracts";

/**
 * Operator command: re-derive a site's discovered business state from its
 * retained website source mirror with the current extraction code, without
 * any network crawl. Dry run by default; prints what would change.
 *
 * --apply attaches the result the same way a source recapture does: a new
 * immutable snapshot replayed from the retained bytes, a new BusinessState
 * revision, and a new public build input, compare-and-swapped against the
 * current build input. Retained snapshots, versions, and inputs are untouched.
 * It refuses sites with owner-confirmed facts or owner operational edits,
 * which a discovered state would overwrite.
 */
const siteId = argument("--site");
const apply = process.argv.includes("--apply");
if (!siteId) throw new Error("Usage: npm run regenerate:website-business-state -- --site=<siteId> [--apply]");

const site = await repository.getSite(siteId);
if (!site?.currentPublicBuildInputId) throw new Error("site_public_build_input_unavailable");
const [currentInput, state, intent] = await Promise.all([
  repository.getPublicBuildInput(site.currentPublicBuildInputId),
  repository.getBusinessState(site.businessId),
  repository.getSiteIntent(site.id)
]);
if (!currentInput || !state || !intent) throw new Error("site_authority_unavailable");
const snapshots = (await Promise.all(currentInput.sourceSnapshotIds.map((id) => repository.getSourceSnapshot(id))))
  .filter((snapshot) => snapshot !== undefined);
const retained = snapshots.find((snapshot) => websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload).success);
if (!retained?.sourceUrl) throw new Error("retained_website_snapshot_unavailable");

const blobStore = configuredArtifactBlobStore();
const resources: RetainedReplayResource[] = [];
for (const resource of await repository.listSourceSnapshotResources(retained.id)) {
  if (resource.outcome !== "fetched" || !resource.storageKey) {
    resources.push({ resource });
    continue;
  }
  const blob = await blobStore.get(resource.storageKey);
  if (!blob) throw new Error(`retained_source_blob_missing:${resource.id}`);
  resources.push({ resource, body: decodeRetainedSourceResource(resource, Buffer.from(blob.bytes)) });
}

const replayed = await ingestWebsite({
  url: retained.sourceUrl,
  siteId: site.id,
  businessId: site.businessId,
  crawlTransport: retainedWebsiteReplayTransport(resources)
});
const replayedSnapshot = replayed.sourceSnapshots[0];
if (!replayedSnapshot) throw new Error("replayed_snapshot_missing");

const {
  stateHash: _stateHash,
  revision: _revision,
  ownerOperationalRevision: _ownerOperationalRevision,
  updatedAt: _updatedAt,
  assets: _discoveredAssets,
  ...discovered
} = replayed.state;
const nextWithoutHash = {
  ...discovered,
  assets: state.assets,
  revision: state.revision + 1,
  ownerOperationalRevision: state.ownerOperationalRevision,
  updatedAt: new Date().toISOString()
};
const nextState = businessStateSchema.parse({ ...nextWithoutHash, stateHash: sha256(stableJson(nextWithoutHash)) });
const retainedNonWebsiteIds = snapshots.filter((snapshot) => snapshot.id !== retained.id).map((snapshot) => snapshot.id);
const publicBuildInput = createPublicBuildInput({
  id: `input_${randomUUID().replace(/-/g, "")}`,
  state: nextState,
  intent,
  forms: currentInput.forms,
  sourceSnapshotIds: [...retainedNonWebsiteIds, replayedSnapshot.id],
  runtimeSeriesId: canonicalSiteAuthoringRuntimeSeriesId
});
assertNoPrivateBuildInputFields(publicBuildInput);

const ownerEdited = state.ownerOperationalRevision > 1 || state.facts.some((fact) => fact.source.ownerConfirmed);
const report = {
  siteId: site.id,
  retainedSnapshotId: retained.id,
  replayedSnapshotId: replayedSnapshot.id,
  replayCoverage: replayed.generationIngestion.coverage,
  replayCounts: replayed.generationIngestion.counts,
  ownerEdited,
  before: summarize(state),
  after: summarize(nextState),
  afterPublicFacts: publicBuildInput.publicFacts.length
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (apply) {
  if (ownerEdited) throw new Error("Refusing to replace a business state that carries owner edits; reconcile them explicitly.");
  for (const { resource, bytes } of replayed.retainedSourceResources) {
    if (!resource.storageKey || !resource.blobContentHash || !bytes) continue;
    await blobStore.putImmutable({
      key: resource.storageKey,
      bytes,
      contentType: resource.storedEncoding === "gzip" ? "application/gzip" : resource.contentType ?? "application/octet-stream",
      contentHash: resource.blobContentHash as `sha256:${string}`
    });
  }
  const applied = await repository.applyPreparedSourceRecapture({
    expectedPublicBuildInputId: currentInput.id,
    snapshot: replayedSnapshot,
    resources: replayed.retainedSourceResources.map(({ resource }) => resource),
    pages: replayed.sourceSnapshotPages,
    assetRevisions: [],
    businessState: nextState,
    publicBuildInput
  });
  process.stdout.write(`${JSON.stringify({ applied, publicBuildInputId: applied ? publicBuildInput.id : currentInput.id })}\n`);
  if (!applied) process.exitCode = 1;
}

function summarize(value: BusinessState) {
  const count = (items: string[]) => items.reduce<Record<string, number>>((totals, item) => ({ ...totals, [item]: (totals[item] ?? 0) + 1 }), {});
  return {
    name: value.identity.name,
    contacts: value.contacts,
    phones: value.facts.filter((fact) => fact.kind === "phone").map((fact) => ({ value: fact.value, publicEligible: fact.publicEligible })),
    facts: count(value.facts.map((fact) => fact.kind)),
    proof: count(value.proof.map((item) => `${item.kind}:${item.status}`))
  };
}

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}
