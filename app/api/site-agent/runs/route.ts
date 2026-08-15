import { NextResponse } from "next/server";
import { z } from "zod";
import { siteElementSelectionSchema } from "@/packages/site-contracts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { ownerSiteAgentRun } from "@/packages/site-platform/owner-run-view";
import { siteAuthoringKernel } from "@/packages/site-authoring";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";
import { authorizedSiteActor, canAccessAgentSession } from "../auth";

const runRequestSchema = z.object({
  sessionId: z.string().min(1),
  instruction: z.string().min(1).max(6000),
  selection: siteElementSelectionSchema.optional(),
  resumeRunId: z.string().min(1).optional()
}).strict();
const cancelRequestSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1)
}).strict();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid agent run request", issues: parsed.error.issues }, { status: 400 });
  const session = await sitePlatformRepository.getAgentSession(parsed.data.sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, session.siteId);
  if (!actor.ok) return actor.response;
  if (session.principal.kind !== "owner" || !canAccessAgentSession(actor, session.principal.id)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  try {
    if (parsed.data.resumeRunId) {
      const run = await siteAuthoringWorkflow.resumeNeedsInput({
        runId: parsed.data.resumeRunId,
        sessionId: session.id,
        answer: parsed.data.instruction,
        actorId: actor.actorId
      });
      return NextResponse.json({ run: ownerSiteAgentRun(run) }, { status: 202 });
    }
    const { run } = await siteAuthoringKernel.startEdit({
      sessionId: session.id,
      actor: { kind: "owner", id: actor.actorId },
      instruction: parsed.data.instruction,
      selection: parsed.data.selection,
      signal: request.signal
    });
    return NextResponse.json({ run: ownerSiteAgentRun(run) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = cancelRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid cancellation request", issues: parsed.error.issues }, { status: 400 });
  const session = await sitePlatformRepository.getAgentSession(parsed.data.sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, session.siteId);
  if (!actor.ok) return actor.response;
  if (session.principal.kind !== "owner" || !canAccessAgentSession(actor, session.principal.id)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    const run = await siteAuthoringWorkflow.cancelRun({
      runId: parsed.data.runId,
      sessionId: session.id,
      actorId: actor.actorId
    });
    return NextResponse.json({ run: ownerSiteAgentRun(run) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
