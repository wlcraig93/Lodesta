import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizedInquiryStatus, publicInquiry } from "@/lib/inquiries";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const inquiryStatusSchema = z.object({
  siteId: z.string().min(1),
  inquiryId: z.string().min(1),
  status: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = inquiryStatusSchema.safeParse(body);
  const status = parsed.success ? normalizedInquiryStatus(parsed.data.status) : undefined;
  if (!parsed.success || !status) {
    return NextResponse.json({ error: "Invalid inquiry status request" }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const inquiry = await repository.updateInquiryStatus({ ...parsed.data, status });
  if (!inquiry) return NextResponse.json({ error: "Inquiry not found" }, { status: 404 });
  return NextResponse.json({ ok: true, inquiry: publicInquiry(inquiry) });
}
