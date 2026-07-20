import { NextResponse } from "next/server";
import { readStoredAsset } from "@/lib/asset-storage";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string; file: string }> }) {
  const { siteId, file } = await params;
  const storageKey = `${siteId}/${file}`;
  const site = await sitePlatformRepository.getSite(siteId);
  if (!site) return notFound();

  const revision = await sitePlatformRepository.getAssetRevisionByStorageKey(storageKey);
  if (!revision || revision.businessId !== site.businessId) return notFound();

  const publiclyReferenced = await sitePlatformRepository.isAssetRevisionPublic(revision.id);
  let previewReferenced = false;
  const previewToken = new URL(request.url).searchParams.get("previewToken");
  if (!publiclyReferenced && previewToken) {
    const token = await platformOperationsRepository.resolvePreviewToken(previewToken);
    const version = token?.siteId === siteId ? await sitePlatformRepository.getSiteVersion(token.siteVersionId) : undefined;
    previewReferenced = Boolean(version?.assetRevisionIds.includes(revision.id));
  }
  if (!publiclyReferenced && !previewReferenced) {
    const unauthorized = await requireAdminOrSiteOwner(request, siteId);
    if (unauthorized) return notFound();
  }

  const asset = await readStoredAsset(storageKey);
  if (!asset) return notFound();
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": publiclyReferenced ? "public, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function notFound() {
  return NextResponse.json({ error: "Asset not found" }, { status: 404 });
}
