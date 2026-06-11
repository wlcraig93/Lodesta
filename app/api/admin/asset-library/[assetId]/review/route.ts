import { NextResponse } from "next/server";
import { z } from "zod";
import { ASSET_LIBRARY_POLICY_FAIL_TAGS, ASSET_LIBRARY_REVIEW_DECISIONS, reviewAssetLibraryAsset } from "@/lib/asset-library";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  decision: z.enum(ASSET_LIBRARY_REVIEW_DECISIONS),
  notes: z.string().max(2000).optional(),
  rejectionReasons: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  policyFailureTags: z.array(z.enum(ASSET_LIBRARY_POLICY_FAIL_TAGS)).max(ASSET_LIBRARY_POLICY_FAIL_TAGS.length).optional(),
  reviewer: z.string().trim().min(1).max(120).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid asset review", issues: parsed.error.issues }, { status: 400 });
  }
  const { assetId } = await params;
  try {
    const result = await reviewAssetLibraryAsset({ assetId, ...parsed.data });
    return NextResponse.json(result);
  } catch (caught) {
    return NextResponse.json({ error: caught instanceof Error ? caught.message : String(caught) }, { status: 409 });
  }
}
