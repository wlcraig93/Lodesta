import { NextResponse } from "next/server";
import { z } from "zod";
import { siteElementSelectionV1Schema } from "@/packages/site-contracts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow } from "@/packages/site-platform";
import { authorizedSiteActor, canAccessAgentSession } from "../auth";

const discussionSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(6000),
  selection: siteElementSelectionV1Schema.optional()
}).strict();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = discussionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid discussion request", issues: parsed.error.issues }, { status: 400 });
  const session = await sitePlatformRepository.getAgentSession(parsed.data.sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, session.siteId);
  if (!actor.ok) return actor.response;
  if (!canAccessAgentSession(actor, session.ownerId)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  try {
    return NextResponse.json(await siteAuthoringWorkflow.discuss({ ...parsed.data, ownerId: actor.actorId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
