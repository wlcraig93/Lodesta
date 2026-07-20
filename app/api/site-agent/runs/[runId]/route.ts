import { NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { authorizedSiteActor, canAccessAgentSession } from "../../auth";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await sitePlatformRepository.getAgentRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, run.siteId);
  if (!actor.ok) return actor.response;
  const session = await sitePlatformRepository.getAgentSession(run.sessionId);
  if (!session || !canAccessAgentSession(actor, session.ownerId)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run });
}
