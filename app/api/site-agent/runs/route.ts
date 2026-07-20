import { after, NextResponse } from "next/server";
import { z } from "zod";
import { siteElementSelectionV1Schema } from "@/packages/site-contracts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { agenticSiteWorkflow } from "@/packages/site-platform";
import { authorizedSiteActor, canAccessAgentSession } from "../auth";

const runRequestSchema = z.object({
  sessionId: z.string().min(1),
  instruction: z.string().min(1).max(6000),
  kind: z.enum(["focused_edit", "page_edit", "seo_aeo_improvement", "rebase"]).default("focused_edit"),
  selection: siteElementSelectionV1Schema.optional()
}).strict();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid agent run request", issues: parsed.error.issues }, { status: 400 });
  const session = await sitePlatformRepository.getAgentSession(parsed.data.sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, session.siteId);
  if (!actor.ok) return actor.response;
  if (!canAccessAgentSession(actor, session.ownerId)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  try {
    const run = await agenticSiteWorkflow.enqueueRun({ session, ...parsed.data, requestedBy: actor.actorId });
    after(async () => { await agenticSiteWorkflow.executeRunAndFinalize(run.id, parsed.data.selection); });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
