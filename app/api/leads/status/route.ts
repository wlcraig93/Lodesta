import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { publicLeadSubmission } from "@/lib/lead-privacy";

const leadStatusSchema = z.object({
  siteId: z.string().min(1),
  submissionId: z.string().min(1),
  status: z.enum(["new", "reviewed", "spam"])
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = leadStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid lead status request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const lead = await repository.updateLeadStatus(parsed.data);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  return NextResponse.json({ ok: true, lead: publicLeadSubmission(lead) });
}
