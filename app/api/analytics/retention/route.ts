import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { retentionCutoffFromPayload, retentionDaysFromPayload } from "@/lib/jobs";

const retentionSchema = z.object({
  siteId: z.string().min(1).optional(),
  before: z.string().datetime().optional(),
  retentionDays: z.number().int().min(30).max(3650).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({}));
  const parsed = retentionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid analytics retention request", issues: parsed.error.issues }, { status: 400 });
  }

  const payload = parsed.data as Record<string, unknown>;
  const retentionDays = retentionDaysFromPayload(payload);
  const before = retentionCutoffFromPayload(payload);
  const result = await repository.pruneAnalyticsEvents({
    siteId: parsed.data.siteId,
    before
  });

  return NextResponse.json({
    ok: true,
    retentionDays,
    ...result
  });
}
