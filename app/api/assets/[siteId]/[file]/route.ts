import { NextResponse } from "next/server";
import { readLocalAsset } from "@/lib/asset-storage";
import { isPublicLocalAssetPath } from "@/lib/public-assets";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string; file: string }> }) {
  const { siteId, file } = await params;
  const storagePath = `${siteId}/${file}`;
  const bundle = await repository.getSiteBundle(siteId);
  if (!bundle || !isPublicLocalAssetPath(bundle, storagePath)) {
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
