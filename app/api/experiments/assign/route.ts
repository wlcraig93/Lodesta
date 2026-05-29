import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";

const assignmentSchema = z.object({
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
  experimentId: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = assignmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid experiment assignment request", issues: parsed.error.issues }, { status: 400 });
  }

  return NextResponse.json(await repository.assignExperiment(parsed.data));
}
