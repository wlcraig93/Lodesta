import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import {
  cancelExternalAuthoringBatch,
  getExternalAuthoringBatchView
} from "@/packages/external-authoring/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { batchId } = await params;
  const view = await getExternalAuthoringBatchView(batchId);
  if (!view) return NextResponse.json({ error: "Authoring batch not found." }, { status: 404 });
  return NextResponse.json(view, privateHeaders());
}

export async function DELETE(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { batchId } = await params;
  try {
    return NextResponse.json(await cancelExternalAuthoringBatch(batchId), privateHeaders());
  } catch {
    return NextResponse.json({ error: "Authoring batch not found." }, { status: 404 });
  }
}

function privateHeaders() {
  return { headers: { "cache-control": "private, no-store" } };
}
