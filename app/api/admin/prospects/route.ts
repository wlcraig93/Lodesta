import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import {
  prospectAgencyStatuses,
  prospectOperatingStatuses,
  prospectTargetFitStatuses,
  prospectVerificationStatuses,
  prospectWebsiteKinds,
  upsertProspectSchema
} from "@/packages/prospect-research";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().min(1).optional(),
  vertical: z.string().trim().min(1).optional(),
  industryCode: z.string().trim().min(1).optional(),
  region: z.string().trim().length(2).optional(),
  websiteKind: z.enum(prospectWebsiteKinds).optional(),
  cms: z.string().trim().min(1).optional(),
  managedProvider: z.string().trim().min(1).optional(),
  agencyStatus: z.enum(prospectAgencyStatuses).optional(),
  verificationStatus: z.enum(prospectVerificationStatuses).optional(),
  operatingStatus: z.enum(prospectOperatingStatuses).optional(),
  targetFitStatus: z.enum(prospectTargetFitStatuses).optional(),
  minimumReviewCount: z.coerce.number().int().min(0).optional(),
  minimumPriorityScore: z.coerce.number().min(0).max(100).optional(),
  minimumVerificationScore: z.coerce.number().min(0).max(100).optional(),
  sortBy: z.enum(["priority", "business_name", "state", "reviews", "verification", "observed_at"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(1_000).optional()
});

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prospect filters", issues: parsed.error.issues }, { status: 400 });
  }
  const [prospects, total] = await Promise.all([
    repository.listProspectCandidates(parsed.data),
    repository.countProspectCandidates(parsed.data)
  ]);
  return NextResponse.json({ prospects, total });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = upsertProspectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prospect", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await repository.upsertProspect(parsed.data));
}
