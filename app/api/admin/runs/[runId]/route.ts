import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  notes: z.string().max(8000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional()
});

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { runId } = await params;
  const detail = await repository.getAgentRunDetail(runId);
  if (!detail) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run update", issues: parsed.error.issues }, { status: 400 });
  }
  const { runId } = await params;
  const run = await repository.updateAgentRunNotes({
    runId,
    notes: parsed.data.notes,
    tags: parsed.data.tags
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run });
}
