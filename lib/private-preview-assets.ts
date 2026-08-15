import type { SitePlatformRepository } from "@/packages/platform-data";
import type { ArtifactBlobStore } from "@/packages/site-artifacts";

export function rewritePreviewAssetUrls(bytes: Uint8Array, contentType: string, previewId: string, siteId: string) {
  if (!contentType.includes("text/html") && !contentType.includes("text/css")) return bytes;
  const value = Buffer.from(bytes).toString("utf8");
  const current = `/api/assets/${encodeURIComponent(siteId)}/`;
  const replacement = `/preview/${encodeURIComponent(previewId)}/__asset/${encodeURIComponent(siteId)}/`;
  return Buffer.from(
    value
      .replaceAll(current, replacement)
      .replaceAll("/_lodesta/assets/", replacement),
    "utf8"
  );
}

type ManagedPreviewAssetRepository = Pick<SitePlatformRepository, "getAssetRevision">;

export async function resolveManagedPreviewAsset(input: {
  revisionId: string;
  businessId: string;
  allowedRevisionIds: string[];
  repository: ManagedPreviewAssetRepository;
  blobStore: ArtifactBlobStore;
}) {
  if (!input.allowedRevisionIds.includes(input.revisionId)) return undefined;
  const revision = await input.repository.getAssetRevision(input.revisionId);
  if (!revision || revision.businessId !== input.businessId) return undefined;
  const blob = await input.blobStore.get(revision.storageKey);
  if (!blob || blob.contentHash !== revision.contentHash) return undefined;
  return { bytes: blob.bytes, mimeType: revision.mimeType };
}
