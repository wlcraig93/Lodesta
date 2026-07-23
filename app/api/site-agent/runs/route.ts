import { after, NextResponse } from "next/server";
import { z } from "zod";
import { siteElementSelectionSchema } from "@/packages/site-contracts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow } from "@/packages/site-platform";
import { authorizedSiteActor, canAccessAgentSession } from "../auth";

const runRequestSchema = z.object({
  sessionId: z.string().min(1),
  instruction: z.string().min(1).max(6000),
  selection: siteElementSelectionSchema.optional(),
  resumeRunId: z.string().min(1).optional()
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
    if (parsed.data.resumeRunId) {
      const run = await siteAuthoringWorkflow.resumeNeedsInput({
        runId: parsed.data.resumeRunId,
        sessionId: session.id,
        answer: parsed.data.instruction,
        actorId: actor.actorId
      });
      after(async () => { await siteAuthoringWorkflow.executeRunAndFinalize(run.id); });
      return NextResponse.json({ run }, { status: 202 });
    }
    const { run } = await siteAuthoringWorkflow.enqueueEdit({ session, ...parsed.data, requestedBy: actor.actorId, signal: request.signal });
    after(async () => { await siteAuthoringWorkflow.executeRunAndFinalize(run.id, parsed.data.selection); });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
