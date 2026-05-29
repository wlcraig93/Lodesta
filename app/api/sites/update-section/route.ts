import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const updateSectionSchema = z.object({
  siteId: z.string().min(1),
  pageId: z.string().min(1),
  sectionId: z.string().min(1),
  props: z.record(z.unknown())
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = updateSectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid section update", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.updateSectionProps(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site, page, or section" }, { status: 404 });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, issues: result.issues, qa: result.qa }, { status: 400 });
  }
  return NextResponse.json(result);
}
