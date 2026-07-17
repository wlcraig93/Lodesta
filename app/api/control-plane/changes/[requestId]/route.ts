import { NextResponse } from "next/server";
import { decideControlPlaneChangeSchema } from "@/lib/control-plane-contracts";
import { decideControlPlaneChange } from "@/lib/control-plane-service";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = decideControlPlaneChangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid control-plane decision" }, { status: 400 });
  const siteId = new URL(request.url).searchParams.get("siteId")?.trim() ?? "";
  if (!siteId) return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  const { requestId } = await context.params;
  const auth = await getCurrentUser();
  try {
    const result = await decideControlPlaneChange({
      repository,
      siteId,
      requestId,
      decision: parsed.data.decision,
      decidedBy: auth.user?.id ?? auth.user?.email ?? "authenticated_operator"
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
