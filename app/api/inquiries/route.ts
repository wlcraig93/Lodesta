import { NextResponse } from "next/server";
import { publicInquiry, publicInquiryDelivery, publicInquiryEvent } from "@/lib/inquiries";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const inquiries = await repository.listInquiries(siteId);
  const inquiryEvents = (
    await Promise.all(inquiries.map((inquiry) => repository.listInquiryEvents(inquiry.id)))
  ).flat();

  return NextResponse.json({
    inquiries: inquiries.map(publicInquiry),
    inquiryEvents: inquiryEvents.map(publicInquiryEvent),
    inquiryDeliveries: (await repository.listInquiryDeliveries(siteId)).map(publicInquiryDelivery)
  });
}
