import { NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { ownerSiteAgentRun } from "@/packages/site-platform/owner-run-view";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";
import { authorizedSiteActor, canAccessAgentSession } from "../../../auth";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const failed = await sitePlatformRepository.getAgentRun(runId);
  if (!failed) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, failed.siteId);
  if (!actor.ok) return actor.response;
  const session = await sitePlatformRepository.getAgentSession(failed.sessionId);
  if (!session || session.principal.kind !== "owner" || !canAccessAgentSession(actor, session.principal.id)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    const run = await siteAuthoringWorkflow.retryFailedRun({ runId, actorId: actor.actorId });
    return NextResponse.json({ run: ownerSiteAgentRun(run) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
