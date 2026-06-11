import { NextResponse } from "next/server";
import {
  ASSET_LIBRARY_APPROVED_VARIANTS,
  ASSET_LIBRARY_BUCKET_NAME,
  assessAssetLibraryPolicy,
  getAssetLibraryAsset,
  type AssetLibraryApprovedVariant
} from "@/lib/asset-library";
import { getSupabaseAdminClient } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approvedVariants = new Set<string>(ASSET_LIBRARY_APPROVED_VARIANTS);

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string; variant: string }> }) {
  const { assetId, variant } = await params;
  if (!approvedVariants.has(variant)) return NextResponse.json({ error: "Unknown asset variant" }, { status: 404 });

  const asset = await getAssetLibraryAsset(assetId);
  if (!asset || asset.status !== "approved") return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (!assessAssetLibraryPolicy(asset).siteSelectable) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  const path = asset.approvedStoragePaths[variant as AssetLibraryApprovedVariant];
  if (!path || path.startsWith("raw/")) return NextResponse.json({ error: "Approved asset variant not found" }, { status: 404 });

  const { data, error } = await getSupabaseAdminClient().storage.from(ASSET_LIBRARY_BUCKET_NAME).download(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Asset bytes not found" }, { status: 404 });
  const bytes = Buffer.from(await data.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
