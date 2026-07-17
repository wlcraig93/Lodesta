import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const schema = z.object({
  siteId: z.string().min(1),
  formId: z.string().min(1),
  notificationEmail: z.string().email().or(z.literal("")).optional(),
  webhookUrl: z.string().url().or(z.literal("")).optional()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid inquiry settings", issues: parsed.error.issues }, { status: 400 });
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;
  const result = await repository.updateInquiryRouting(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true, workflows: result.workflows });
}
