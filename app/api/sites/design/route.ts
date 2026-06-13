import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import type { UpdateSiteDesignInput } from "@/lib/design";

const designSchema = z.object({
  siteId: z.string().min(1),
  pageId: z.string().min(1).optional(),
  designPlan: z.object({
    stylePack: z.enum(["local_modern", "premium_editorial", "urgent_service", "warm_neighborhood", "clinical_trust"]).optional(),
    typographyPack: z.enum(["clean_sans", "editorial_serif", "rounded_friendly", "utility_sans", "premium_sans"]).optional(),
    colorSystem: z.enum(["warm", "premium", "bold", "clinical"]).optional(),
    spacingDensity: z.enum(["compact", "standard", "spacious"]).optional(),
    buttonStyle: z.enum(["solid", "outline_heavy", "pill", "understated"]).optional(),
    radiusStyle: z.enum(["sharp", "soft", "rounded"]).optional(),
    imageTreatment: z.enum(["natural", "full_bleed", "framed", "soft_crop", "collage"]).optional(),
    motionPolicy: z.enum(["none", "subtle"]).optional(),
    hostedFontAssetId: z.string().min(1).optional()
  }).optional(),
  sectionOrder: z.array(z.string().min(1)).optional(),
  sectionTemplates: z.record(z.string().min(1)).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = designSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid design update", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;
  if (!parsed.data.designPlan && !parsed.data.sectionOrder && !parsed.data.sectionTemplates) {
    return NextResponse.json({ error: "Provide a designPlan, sectionOrder, or sectionTemplates." }, { status: 400 });
  }

  const result = await repository.updateSiteDesign(parsed.data as UpdateSiteDesignInput);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  return NextResponse.json({
    ok: true,
    draftVersionId: result.draftVersionId,
    applied: result.applied,
    findings: result.bundle.optimizationFindings
  });
}
