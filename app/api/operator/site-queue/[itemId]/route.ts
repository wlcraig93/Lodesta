import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedOperator } from "@/app/api/site-agent/auth";
import { sitePlatformRepository } from "@/packages/platform-data";

const actionSchema = z.object({ action: z.enum(["resolve", "dismiss"]) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const actor = await authorizedOperator(request);
  if (!actor.ok) return actor.response;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid queue action" }, { status: 400 });
  const { itemId } = await params;
  const item = (await sitePlatformRepository.listOperatorQueue()).find((candidate) => candidate.id === itemId);
  if (!item) return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
  const now = new Date().toISOString();
  await sitePlatformRepository.saveOperatorQueueItem({ ...item, status: parsed.data.action === "resolve" ? "resolved" : "dismissed", resolvedBy: actor.actorId, resolvedAt: now, updatedAt: now });
  return NextResponse.json({ ok: true });
}
