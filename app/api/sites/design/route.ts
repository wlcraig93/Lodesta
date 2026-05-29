import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const designSchema = z.object({
  siteId: z.string().min(1),
  pageId: z.string().min(1).optional(),
  themePreset: z.enum(["warm", "premium", "bold", "clinical"]).optional(),
  sectionOrder: z.array(z.string().min(1)).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = designSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid design update", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;
  if (!parsed.data.themePreset && !parsed.data.sectionOrder) {
    return NextResponse.json({ error: "Provide a themePreset or sectionOrder." }, { status: 400 });
  }

  const result = await repository.updateSiteDesign(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  return NextResponse.json({
    ok: true,
    draftVersionId: result.draftVersionId,
    applied: result.applied,
    findings: result.bundle.optimizationFindings
  });
}
