import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const updateExperimentSchema = z.object({
  siteId: z.string().min(1),
  experimentId: z.string().min(1),
  status: z.enum(["draft", "running", "concluded", "rolled_back"]),
  holdoutPercent: z.number().min(0).max(0.5).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = updateExperimentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid experiment update request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.updateExperiment(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json(result);
}
