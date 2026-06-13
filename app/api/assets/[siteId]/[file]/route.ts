import { NextResponse } from "next/server";
import { readLocalAsset } from "@/lib/asset-storage";
import { isPublicLocalAssetPath } from "@/lib/public-assets";
import { repository } from "@/lib/repository";
import { isScrapedAssetFile } from "@/lib/scraped-media";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string; file: string }> }) {
  const { siteId, file } = await params;
  const storagePath = `${siteId}/${file}`;
  if (siteId.startsWith("sitecand_")) {
    // Candidate preview assets live under the provisional sitecand_*
    // namespace and stay admin-only until acceptance, like the preview
    // surface itself. Public visitors keep getting 404 (no existence leak),
    // and scraped reference media never becomes publicly reachable here.
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    const candidateAsset = await readLocalAsset(storagePath);
    if (!candidateAsset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    return new Response(candidateAsset.bytes, {
      headers: {
        "Content-Type": candidateAsset.mimeType,
        "Cache-Control": "private, max-age=3600"
      }
    });
  }
  const bundle = await repository.getSiteBundle(siteId);
  if (!bundle) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (isScrapedAssetFile(file)) {
    // Scraped reference media is private: owner/admin sessions only, never
    // public visitors, until per-photo attestation converts it.
    const unauthorized = await requireAdminOrSiteOwner(request, siteId);
    if (unauthorized) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  } else if (!isPublicLocalAssetPath(bundle, storagePath)) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  const asset = await readLocalAsset(storagePath);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  return new Response(asset.bytes, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
