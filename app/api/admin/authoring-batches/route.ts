import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { createExternalAuthoringBatch } from "@/packages/external-authoring/service";
import { externalAuthoringRepository } from "@/packages/external-authoring/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createBatchSchema = z.object({
  name: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  websites: z.array(z.object({
    url: z.string().url(),
    businessName: z.string().trim().min(1).max(200).optional()
  }).strict()).min(1).max(500)
}).strict();
const idempotencyKeySchema = z.string().trim().min(8).max(160);

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const batches = await externalAuthoringRepository.listBatches();
  return NextResponse.json({ batches }, privateHeaders());
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = createBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid authoring batch.", issues: parsed.error.issues }, { status: 400 });
  }
  const headerKey = request.headers.get("idempotency-key")?.trim();
  const idempotencyKey = idempotencyKeySchema.safeParse(headerKey || parsed.data.idempotencyKey);
  if (!idempotencyKey.success) {
    return NextResponse.json({ error: "An Idempotency-Key header or body field is required." }, { status: 400 });
  }
  const auth = await getCurrentUser();
  const requestedBy = auth.user?.id ?? "operator:lodesta-owner";
  try {
    const result = await createExternalAuthoringBatch({
      ...parsed.data,
      requestedBy,
      idempotencyKey: idempotencyKey.data
    });
    return NextResponse.json(result, {
      status: result.created ? 201 : 200,
      ...privateHeaders()
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to create external authoring batch."
    }, { status: 409, ...privateHeaders() });
  }
}

function privateHeaders() {
  return { headers: { "cache-control": "private, no-store" } };
}
