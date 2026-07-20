import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { agenticSiteWorkflow } from "@/packages/site-platform";

export const runtime = "nodejs";

const requestSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  staleAfterMs: z.number().int().min(60_000).max(3_600_000).optional()
}).strict();

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid maintenance request", issues: parsed.error.issues }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await agenticSiteWorkflow.processRecoverableRuns(parsed.data)) });
}
