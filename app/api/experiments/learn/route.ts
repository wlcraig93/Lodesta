import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const learnSchema = z.object({
  siteId: z.string().min(1),
  experimentId: z.string().min(1)
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  if (siteId) {
    const unauthorized = await requireAdminOrSiteOwner(request, siteId);
    if (unauthorized) return unauthorized;
  }

  return NextResponse.json({
    learnings: await repository.listExperimentLearnings({ siteId })
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = learnSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid experiment learning request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.concludeExperimentWithLearning(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason, analysis: result.analysis }, { status: 400 });
  return NextResponse.json(result);
}
