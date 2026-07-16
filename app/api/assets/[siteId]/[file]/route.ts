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
  const publicLocalAsset = isPublicLocalAssetPath(bundle, storagePath);
  if (isScrapedAssetFile(file)) {
    // Scraped reference media is private until it is either loaded through a
    // scoped noindex preview token or converted into a public owner-attested
    // asset. Authenticated owner/admin sessions can also inspect it.
    const previewToken = new URL(request.url).searchParams.get("previewToken");
    const preview = previewToken ? await repository.resolvePreviewToken(previewToken) : null;
    const previewTokenMatchesSite = preview?.bundle.businessProfile.siteId === siteId;
    if (!publicLocalAsset && !previewTokenMatchesSite) {
      const unauthorized = await requireAdminOrSiteOwner(request, siteId);
      if (unauthorized) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
  } else if (!publicLocalAsset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  const asset = await readLocalAsset(storagePath);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  return new Response(asset.bytes, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": publicLocalAsset ? "public, max-age=31536000, immutable" : "private, max-age=3600"
    }
  });
}
