import { NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { ownerActivitySnapshot } from "@/packages/site-platform/owner-run-view";
import { authorizedSiteActor, canAccessAgentSession } from "../../../auth";

const RAW_EVENT_LIMIT = 200;

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await sitePlatformRepository.getAgentRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, run.siteId);
  if (!actor.ok) return actor.response;
  const session = await sitePlatformRepository.getAgentSession(run.sessionId);
  if (!session || session.principal.kind !== "owner" || !canAccessAgentSession(actor, session.principal.id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const newest = await sitePlatformRepository.listAgentRunEvents(run.id, {
    limit: RAW_EVENT_LIMIT + 1,
    order: "descending"
  });
  const rawTailTruncated = newest.length > RAW_EVENT_LIMIT;
  const chronological = newest.slice(0, RAW_EVENT_LIMIT).reverse();
  return NextResponse.json(ownerActivitySnapshot(run, chronological, { rawTailTruncated }));
}
