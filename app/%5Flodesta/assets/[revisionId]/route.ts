import { sitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { requireAdminOrSiteOwner } from "@/lib/security";

export async function GET(request: Request, { params }: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await params;
  const revision = await sitePlatformRepository.getAssetRevision(revisionId);
  if (!revision) return new Response(null, { status: 404 });
  const isPublic = await sitePlatformRepository.isAssetRevisionPublic(revisionId);
  if (!isPublic) {
    const state = await sitePlatformRepository.getBusinessState(revision.businessId);
    if (!state) return new Response(null, { status: 404 });
    const unauthorized = await requireAdminOrSiteOwner(request, state.siteId);
    if (unauthorized) return unauthorized;
  }
  const blob = await configuredArtifactBlobStore().get(revision.storageKey);
  if (!blob || blob.contentHash !== revision.contentHash) return new Response(null, { status: 503 });
  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": revision.mimeType,
      "cache-control": isPublic ? "public, max-age=31536000, immutable" : "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
