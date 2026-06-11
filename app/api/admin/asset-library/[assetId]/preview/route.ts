import { NextResponse } from "next/server";
import { ASSET_LIBRARY_BUCKET_NAME, getAssetLibraryAsset } from "@/lib/asset-library";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { assetId } = await params;
  const asset = await getAssetLibraryAsset(assetId);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  const path = asset.approvedStoragePaths["thumb-320.webp"] ?? asset.rawStoragePath;
  const { data, error } = await getSupabaseAdminClient().storage.from(ASSET_LIBRARY_BUCKET_NAME).download(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Asset bytes not found" }, { status: 404 });
  const bytes = Buffer.from(await data.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": path.endsWith(".webp") ? "image/webp" : asset.mimeType,
      "Cache-Control": "private, max-age=60"
    }
  });
}
