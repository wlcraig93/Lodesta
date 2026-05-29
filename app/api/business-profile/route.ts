import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const optionalString = z.string().optional();

const businessProfileSchema = z.object({
  siteId: z.string().min(1),
  phone: optionalString,
  email: optionalString,
  services: z.array(z.string()).optional(),
  serviceAreas: z.array(z.string()).optional(),
  bookingLinks: z.array(z.string()).optional(),
  orderingLinks: z.array(z.string()).optional(),
  socialLinks: z.array(z.string()).optional(),
  hours: z.record(z.string()).optional(),
  address: z
    .object({
      street: optionalString,
      city: optionalString,
      region: optionalString,
      postalCode: optionalString,
      country: optionalString
    })
    .optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = businessProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid business profile request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const bundle = await repository.updateBusinessProfile(parsed.data);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  return NextResponse.json({ ok: true, businessProfile: bundle.businessProfile, findings: bundle.optimizationFindings });
}
