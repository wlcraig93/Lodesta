import { NextResponse } from "next/server";
import { z } from "zod";
import { controlPlaneService } from "@/packages/control-plane";
import { authorizedOperator, authorizedSiteActor } from "@/app/api/site-agent/auth";
import { sitePlatformRepository } from "@/packages/platform-data";

const decisionSchema = z.object({ siteId: z.string().min(1), decision: z.enum(["approve", "reject"]) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid control-plane decision" }, { status: 400 });
  const actor = await authorizedSiteActor(request, parsed.data.siteId);
  if (!actor.ok) return actor.response;
  const { requestId } = await params;
  const change = await sitePlatformRepository.getControlPlaneChangeRequest(requestId);
  if (!change || change.siteId !== parsed.data.siteId) return NextResponse.json({ error: "Change not found" }, { status: 404 });
  if (change.payload.kind !== "replace_source_document") {
    const operator = await authorizedOperator(request);
    if (!operator.ok) return operator.response;
  }
  try {
    const result = await controlPlaneService.decide({ requestId, decision: parsed.data.decision, decidedBy: actor.actorId });
    return NextResponse.json({ ok: true, ...result }, { status: result.applied ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
