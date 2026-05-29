import { NextResponse } from "next/server";
import { readLocalAsset } from "@/lib/asset-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string; file: string }> }) {
  const { siteId, file } = await params;
  const asset = await readLocalAsset(`${siteId}/${file}`);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  return new Response(asset.bytes, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
