import { NextResponse } from "next/server";
import { getAssetLibraryAsset, getAssetLibraryReviews } from "@/lib/asset-library";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { assetId } = await params;
  const asset = await getAssetLibraryAsset(assetId);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  const reviews = await getAssetLibraryReviews(assetId);
  return NextResponse.json({ asset, reviews });
}
