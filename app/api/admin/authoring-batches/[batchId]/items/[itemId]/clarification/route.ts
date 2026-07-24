import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { submitExternalAuthoringClarification } from "@/packages/external-authoring/service";

export const runtime = "nodejs";

const inputSchema = z.object({
  answer: z.string().trim().min(1).max(4000)
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A clarification answer is required." }, { status: 400 });
  const { batchId, itemId } = await params;
  const auth = await getCurrentUser();
  try {
    const result = await submitExternalAuthoringClarification({
      batchId,
      itemId,
      answer: parsed.data.answer,
      actorId: auth.user?.id ?? "operator:lodesta-owner"
    });
    return NextResponse.json({
      itemId: result.item.id,
      executionId: result.executionId,
      runId: result.run.id,
      status: result.run.status
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to submit clarification."
    }, { status: 409 });
  }
}
