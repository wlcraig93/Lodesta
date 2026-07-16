import { NextResponse } from "next/server";
import { z } from "zod";
import { applyBusinessProfileUpdate, type BusinessProfileUpdateInput } from "@/lib/business-profile-update";
import { validateBusinessProfileUpdate } from "@/lib/editor-guardrails";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { siteVersionV3Issue } from "@/lib/site-version-v3";
import { markAllVersionsOwnerTouched } from "@/lib/site-version-metadata";
import { runSiteQa } from "@/lib/qa";

export const runtime = "nodejs";

const optionalString = z.string().optional();

const candidateBusinessProfileSchema = z.object({
  siteId: z.string().min(1).optional(),
  phone: optionalString,
  email: optionalString,
  services: z.array(z.string()).optional(),
  credentials: z.array(z.string()).optional(),
  offers: z.array(z.string()).optional(),
  serviceAreas: z.array(z.string()).optional(),
  bookingLinks: z.array(z.string()).optional(),
  orderingLinks: z.array(z.string()).optional(),
  socialLinks: z.array(z.string()).optional(),
  pressLinks: z.array(z.string()).optional(),
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

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { candidateId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = candidateBusinessProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidate business profile request", issues: parsed.error.issues }, { status: 400 });
  }

  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) return NextResponse.json({ error: "Unknown site candidate" }, { status: 404 });

  if (parsed.data.siteId && parsed.data.siteId !== candidate.bundle.businessProfile.siteId) {
    return NextResponse.json({ error: "Candidate siteId does not match this business profile" }, { status: 409 });
  }

  const staleIssue = candidate.bundle.siteModel.versions
    .map((version) => siteVersionV3Issue(version))
    .find((issue): issue is string => Boolean(issue));
  if (staleIssue) {
    return NextResponse.json(
      {
        error: `Site candidate stored version schema is stale: ${staleIssue}. Regenerate the candidate before editing business facts.`,
        candidateStatus: candidate.status
      },
      { status: 409 }
    );
  }

  const input: BusinessProfileUpdateInput = {
    ...parsed.data,
    siteId: candidate.bundle.businessProfile.siteId
  };
  const guardrails = validateBusinessProfileUpdate(candidate.bundle, input);
  if (!guardrails.ok) {
    return NextResponse.json({ error: guardrails.reason, issues: guardrails.issues, qa: guardrails.qa }, { status: 400 });
  }

  const nextBundle = applyBusinessProfileUpdate(structuredClone(candidate.bundle), input);
  markAllVersionsOwnerTouched(nextBundle);
  const updated = await repository.updateSiteCandidateBundle(candidate.id, nextBundle);
  if (!updated) return NextResponse.json({ error: "Unknown site candidate" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    businessProfile: updated.bundle.businessProfile,
    findings: updated.bundle.optimizationFindings,
    qa: runSiteQa(updated.bundle, { versionStatus: "draft" }),
    guardrailWarnings: guardrails.warnings
  });
}
