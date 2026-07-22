import { after, NextResponse } from "next/server";
import { z } from "zod";
import { controlPlaneService } from "@/packages/control-plane";
import { siteAuthoringWorkflow } from "@/packages/site-platform";
import { authorizedOperator } from "@/app/api/site-agent/auth";

const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const actor = await authorizedOperator(request);
  if (!actor.ok) return actor.response;
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid control-plane decision" }, { status: 400 });
  const { requestId } = await params;
  try {
    const result = await controlPlaneService.decide({ requestId, decision: parsed.data.decision, decidedBy: actor.actorId });
    if ("run" in result && result.run && result.deferred !== true) {
      after(async () => { await siteAuthoringWorkflow.executeRunAndFinalize(result.run.id); });
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.applied ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
