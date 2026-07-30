import { NextResponse } from "next/server";
import { z } from "zod";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const prospectSchema = z.object({
  id: z.string().min(1).optional(),
  prospectId: z.string().min(1),
  selectionObservationId: z.string().min(1),
  campaignId: z.string().min(1),
  siteId: z.string().min(1).optional(),
  reportId: z.string().min(1).optional(),
  previewId: z.string().min(1).optional(),
  mailingCode: z.string().min(1).optional(),
  status: z.enum(["queued", "mailed", "preview_viewed", "adoption_started", "adopted", "published", "disqualified"]).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { searchParams } = new URL(request.url);
  return NextResponse.json({ prospects: await repository.listOutboundProspects(searchParams.get("campaignId") ?? undefined) });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = prospectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid outbound prospect request", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await repository.upsertOutboundProspect(parsed.data));
}
