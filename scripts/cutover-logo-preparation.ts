import "./load-env";

import { decodeRetainedSourceResource, sha256, stableJson } from "../packages/business-data";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";
import {
  assetRevisionSchema,
  businessStateSchema,
  type AssetRevision,
  type AssetRevisionRef,
  type BusinessState
} from "../packages/site-contracts";
import {
  materializeSourceLogo,
  sourceLogoPreparedRevisionId,
  type SourceLogoMaterialization
} from "../packages/site-platform/source-logo-materialization";

const apply = process.argv.includes("--apply");
const expectedActiveCount = integerArgument("--expected-active-source-logo-count");
if (apply && expectedActiveCount === undefined) {
  throw new Error("Applying the cutover requires --expected-active-source-logo-count=<reviewed report count>.");
}

const blobStore = configuredArtifactBlobStore();
const sites = await sitePlatformRepository.listSites();
const states = (await sitePlatformRepository.getBusinessStatesByIds(sites.map((site) => site.businessId)))
  .sort((left, right) => left.businessId.localeCompare(right.businessId));
const activeSourceLogoCount = states.reduce((count, state) => count + state.assets.filter(isActiveSourceLogo).length, 0);
if (expectedActiveCount !== undefined && activeSourceLogoCount !== expectedActiveCount) {
  throw new Error(`Active source logo count changed after report review: expected ${expectedActiveCount}, found ${activeSourceLogoCount}.`);
}

const preparedByBusiness = new Map<string, Array<PreparedCutover>>();
const failures: Array<{ businessId: string; revisionId: string; reason: string }> = [];
let alreadyCanonical = 0;

for (const state of states) {
  for (const ref of state.assets.filter(isActiveSourceLogo)) {
    try {
      const cutover = await prepareCutover(state, ref);
      if (!cutover) {
        alreadyCanonical += 1;
        continue;
      }
      const prior = preparedByBusiness.get(state.businessId) ?? [];
      prior.push(cutover);
      preparedByBusiness.set(state.businessId, prior);
    } catch (error) {
      failures.push({
        businessId: state.businessId,
        revisionId: ref.revisionId,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, apply, activeSourceLogoCount, alreadyCanonical, failures }, null, 2)}\n`);
  throw new Error(`Logo preparation cutover has ${failures.length} unusable source logo(s); no authority was changed.`);
}

const prepared = [...preparedByBusiness.values()].flat();
if (apply) {
  // All candidates are decoded and validated above before the first immutable
  // write or mutable authority update occurs.
  for (const item of prepared) {
    await blobStore.putImmutable({
      key: item.revision.storageKey,
      bytes: item.materialization.bytes,
      contentType: item.revision.mimeType,
      contentHash: asContentHash(item.revision.contentHash)
    });
    await sitePlatformRepository.saveAssetRevision(item.revision);
  }
  for (const state of states) {
    const replacements = preparedByBusiness.get(state.businessId);
    if (!replacements?.length) continue;
    await sitePlatformRepository.saveBusinessState(nextBusinessState(state, replacements));
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  apply,
  activeSourceLogoCount,
  alreadyCanonical,
  preparedRevisionCount: prepared.length,
  updatedBusinessCount: preparedByBusiness.size,
  sourceBytesChangedCount: prepared.filter((item) => item.materialization.presentation.changed).length,
  unchangedReceiptCount: prepared.filter((item) => !item.materialization.presentation.changed).length
}, null, 2)}\n`);

async function prepareCutover(state: BusinessState, ref: AssetRevisionRef): Promise<PreparedCutover | undefined> {
  const retainedRevision = await sitePlatformRepository.getAssetRevision(ref.revisionId);
  if (!retainedRevision || retainedRevision.provenance.origin !== "source_website") {
    throw new Error("active source logo revision is missing or has mismatched provenance");
  }
  const sourceResourceId = retainedRevision.provenance.sourceResourceId;
  if (!sourceResourceId) throw new Error("source resource identity is unavailable");
  const resource = await sitePlatformRepository.getSourceSnapshotResource(
    sourceResourceId,
    retainedRevision.provenance.sourceSnapshotId
  );
  const resourceMimeType = resource?.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const mimeType = resourceMimeType ?? retainedRevision.mimeType;
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    throw new Error(`unsupported source logo content type: ${mimeType ?? "missing"}`);
  }
  const retainedSourceAvailable = Boolean(resource?.storageKey && resource.rawContentHash);
  const sourceBlob = await blobStore.get(retainedSourceAvailable ? resource!.storageKey! : retainedRevision.storageKey);
  if (!sourceBlob) throw new Error("retained source logo blob is unavailable");
  const raw = retainedSourceAvailable ? decodeRetainedSourceResource(resource!, sourceBlob.bytes) : sourceBlob.bytes;
  const sourceContentHash = retainedSourceAvailable
    ? asContentHash(resource!.rawContentHash!)
    : retainedRevision.contentHash;
  if (sha256(raw) !== sourceContentHash) throw new Error("retained source logo content hash does not match decoded bytes");
  // Cloned experiment authorities can retain the canonical source-resource
  // identity after their mirror rows are gone. Keep that stable identity in
  // the recipe-bound revision formula and use the immutable clone bytes only
  // as the materialization input.
  const sourceRevisionId = sourceResourceId;
  const revisionId = sourceLogoPreparedRevisionId({
    sourceRevisionId,
    sourceContentHash
  });
  if (
    retainedRevision.id === revisionId
    && retainedRevision.provenance.preparation
    && retainedRevision.width
    && retainedRevision.height
  ) {
    return undefined;
  }
  const materialization = await materializeSourceLogo({
    bytes: raw,
    mimeType,
    sourceRevisionId,
    sourceContentHash
  });
  if (materialization.status === "unusable") throw new Error(`${materialization.reason}:${materialization.message}`);
  const storageKey = `site-assets/${state.businessId}/source/${revisionId}/${materialization.contentHash.slice("sha256:".length)}`;
  const revision = assetRevisionSchema.parse({
    ...retainedRevision,
    id: revisionId,
    contentHash: materialization.contentHash,
    storageKey,
    mimeType: materialization.mimeType,
    bytes: materialization.bytes.byteLength,
    width: materialization.presentation.width,
    height: materialization.presentation.height,
    publicUrl: undefined,
    provenance: {
      ...retainedRevision.provenance,
      preparation: materialization.preparation
    },
    createdAt: new Date().toISOString()
  });
  return {
    priorRevisionId: ref.revisionId,
    materialization,
    revision,
    ref: {
      ...ref,
      revisionId,
      contentHash: revision.contentHash,
      storageKey,
      mimeType: revision.mimeType,
      width: revision.width,
      height: revision.height,
      publicUrl: undefined
    }
  };
}

function nextBusinessState(state: BusinessState, replacements: PreparedCutover[]) {
  const replacementByPriorRevision = new Map(replacements.map((item) => [item.priorRevisionId, item.ref]));
  const now = new Date().toISOString();
  const nextWithoutHash = {
    ...structuredClone(state),
    revision: state.revision + 1,
    updatedAt: now,
    assets: state.assets.map((asset) => replacementByPriorRevision.get(asset.revisionId) ?? asset)
  };
  const { stateHash: _priorHash, ...hashable } = nextWithoutHash;
  return businessStateSchema.parse({ ...hashable, stateHash: sha256(stableJson(hashable)) });
}

function isActiveSourceLogo(ref: AssetRevisionRef) {
  return ref.kind === "logo" && ref.origin === "source_website" && ref.activeForFutureBuilds;
}

function asContentHash(value: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`invalid content hash: ${value}`);
  return value as `sha256:${string}`;
}

function integerArgument(name: string) {
  const prefix = `${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

type PreparedCutover = {
  priorRevisionId: string;
  materialization: SourceLogoMaterialization;
  revision: AssetRevision;
  ref: AssetRevisionRef;
};
