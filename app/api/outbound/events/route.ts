import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const eventSchema = z.object({
  campaignId: z.string().min(1),
  prospectId: z.string().min(1).optional(),
  siteId: z.string().min(1).optional(),
  type: z.enum([
    "mailer_sent",
    "preview_viewed",
    "claim_started",
    "claim_completed",
    "published",
    "support_contact",
    "disqualified",
    "credibility_feedback"
  ]),
  value: z.number().optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  occurredAt: z.string().datetime().optional()
});

export async function GET(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { searchParams } = new URL(request.url);
  return NextResponse.json({ events: await repository.listOutboundEvents(searchParams.get("campaignId") ?? undefined) });
}

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid outbound event request", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await repository.recordOutboundEvent(parsed.data));
}
