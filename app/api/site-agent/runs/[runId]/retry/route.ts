import { after, NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow } from "@/packages/site-platform";
import { authorizedSiteActor, canAccessAgentSession } from "../../../auth";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const failed = await sitePlatformRepository.getAgentRun(runId);
  if (!failed) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, failed.siteId);
  if (!actor.ok) return actor.response;
  const session = await sitePlatformRepository.getAgentSession(failed.sessionId);
  if (!session || !canAccessAgentSession(actor, session.ownerId)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    const run = await siteAuthoringWorkflow.retryFailedRun({ runId, actorId: actor.actorId });
    after(async () => { await siteAuthoringWorkflow.executeRunAndFinalize(run.id); });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
