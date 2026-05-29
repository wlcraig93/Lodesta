import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const prospectSchema = z.object({
  id: z.string().min(1).optional(),
  campaignId: z.string().min(1),
  siteId: z.string().min(1).optional(),
  businessName: z.string().min(1),
  vertical: z
    .enum([
      "restaurant",
      "auto_body",
      "beauty_salon",
      "med_spa",
      "law_firm",
      "dental",
      "home_services",
      "fitness",
      "real_estate",
      "landscaping",
      "veterinary",
      "creative_studio",
      "general_local"
    ])
    .optional(),
  sourceUrl: z.string().url().optional(),
  previewToken: z.string().min(1).optional(),
  mailingCode: z.string().min(1).optional(),
  status: z.enum(["queued", "mailed", "preview_viewed", "claim_started", "claimed", "published", "disqualified"]).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

export async function GET(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { searchParams } = new URL(request.url);
  return NextResponse.json({ prospects: await repository.listOutboundProspects(searchParams.get("campaignId") ?? undefined) });
}

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = prospectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid outbound prospect request", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await repository.upsertOutboundProspect(parsed.data));
}
