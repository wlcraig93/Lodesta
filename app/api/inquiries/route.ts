import { NextResponse } from "next/server";
import { publicInquiry, publicInquiryEvent } from "@/lib/inquiries";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";
import { siteCapabilityRepository } from "@/packages/site-capabilities";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const inquiries = await siteCapabilityRepository.listInquiries(siteId);
  const inquiryEvents = (
    await Promise.all(inquiries.map((inquiry) => siteCapabilityRepository.listInquiryEvents(inquiry.id)))
  ).flat();

  return NextResponse.json({
    inquiries: inquiries.map(publicInquiry),
    inquiryEvents: inquiryEvents.map(publicInquiryEvent),
    inquiryDeliveries: []
  });
}
