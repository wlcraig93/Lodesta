import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { retryExternalAuthoringExecution } from "@/packages/external-authoring/service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { batchId, itemId } = await params;
  const auth = await getCurrentUser();
  try {
    const result = await retryExternalAuthoringExecution({
      batchId,
      itemId,
      actorId: auth.user?.id ?? "operator:lodesta-owner"
    });
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to retry external authoring."
    }, { status: 409 });
  }
}
