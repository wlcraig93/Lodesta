import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const assetInputSchema = z.object({
  url: z.string().url(),
  alt: z.string().min(1).max(180)
});

const ownerAssetsSchema = z.object({
  siteId: z.string().min(1),
  logo: assetInputSchema.optional(),
  photos: z.array(assetInputSchema).max(12).optional(),
  rightsAccepted: z.boolean()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ownerAssetsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid owner asset request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.updateOwnerAssets(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  return NextResponse.json({
    ok: true,
    logo: result.logo,
    photos: result.photos,
    assets: result.assets
  });
}
