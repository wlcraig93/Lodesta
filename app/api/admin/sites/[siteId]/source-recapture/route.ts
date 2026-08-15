import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { siteId } = await params;
  try {
    const result = await siteAuthoringWorkflow.recaptureWebsiteSource({ siteId, signal: request.signal });
    if (!result.applied) {
      return NextResponse.json({ error: "Source recapture could not be applied because the site changed or has active authoring work." }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      unchanged: result.unchanged,
      sourceSnapshotId: result.snapshot.id,
      publicBuildInputId: result.publicBuildInput.id
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "source_recapture_failed" }, { status: 500 });
  }
}
