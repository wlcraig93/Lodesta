import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const auditSchema = z.object({
  siteId: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = auditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid audit request", issues: parsed.error.issues }, { status: 400 });
  }
  const siteId = parsed.data.siteId ?? "site_joes_pizza";
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return unauthorized;
  const findings = await repository.runAndStoreAudit(siteId);
  const bundle = await repository.getSiteBundle(siteId);
  if (!findings || !bundle) {
    return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  }
  return NextResponse.json({
    siteId,
    findings,
    standardVersion: "launch-draft"
  });
}
