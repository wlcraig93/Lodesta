import { NextResponse } from "next/server";
import { z } from "zod";
import { updateAssetLibraryAssetTags } from "@/lib/asset-library";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tagSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  intendedUses: z.array(z.string().trim().min(1).max(48)).max(12).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = tagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid asset tags", issues: parsed.error.issues }, { status: 400 });
  }
  const { assetId } = await params;
  try {
    const asset = await updateAssetLibraryAssetTags({ assetId, ...parsed.data });
    return NextResponse.json({ asset });
  } catch (caught) {
    return NextResponse.json({ error: caught instanceof Error ? caught.message : String(caught) }, { status: 409 });
  }
}
