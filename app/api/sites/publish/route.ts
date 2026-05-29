import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const publishSchema = z.object({
  siteId: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid publish request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.publishDraft(parsed.data.siteId);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json(result);
}
