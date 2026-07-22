import { after, NextResponse } from "next/server";
import { z } from "zod";
import { siteAuthoringWorkflow } from "@/packages/site-platform";
import { authorizedOperator } from "../auth";

const bootstrapSchema = z.object({
  url: z.string().url(),
  mode: z.enum(["draft", "experimental"]).default("draft"),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  workspaceId: z.string().min(1).max(120).optional()
}).strict();

export async function POST(request: Request) {
  const actor = await authorizedOperator(request);
  if (!actor.ok) return actor.response;
  const body = await request.json().catch(() => null);
  const parsed = bootstrapSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid site bootstrap request", issues: parsed.error.issues }, { status: 400 });
  try {
    const result = await siteAuthoringWorkflow.bootstrapFromUrl({ ...parsed.data, ownerId: actor.actorId });
    after(async () => { await siteAuthoringWorkflow.executeRunAndFinalize(result.run.id); });
    return NextResponse.json({ site: result.site, session: result.session, run: result.run }, { status: 202 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code }, { status: 422 });
  }
}
