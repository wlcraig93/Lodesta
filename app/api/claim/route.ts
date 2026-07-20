import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { resolveClaimOwner } from "@/lib/claim-ownership";
import { verifyClaimVerificationChallenge } from "@/lib/claim-verification-challenge";
import { controlPlaneService } from "@/packages/control-plane";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";

const verifiedClaimLevelSchema = z.enum(["contact_verified", "owner_verified", "operator_verified"]);
const claimSchema = z.object({
  siteId: z.string().min(1),
  ownerEmail: z.string().email().optional(),
  verificationLevel: verifiedClaimLevelSchema.optional(),
  verificationMethod: z.string().trim().min(1).max(80).optional(),
  verifiedBy: z.string().trim().min(1).max(160).optional(),
  verificationChallenge: z.object({ challengeId: z.string().min(1), code: z.string().min(4).max(12) }).optional(),
  outboundCampaignId: z.string().min(1).optional(),
  outboundProspectId: z.string().min(1).optional(),
  previewToken: z.string().min(1).optional(),
  verifiedFacts: z.array(z.string().min(1)).max(200).optional(),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: "Content rights and hosting terms must be accepted." }) }),
  acceptedManagement: z.literal(true, { errorMap: () => ({ message: "Managed-site authority must be accepted." }) }),
  acceptedAssetRights: z.boolean().optional(),
  attestedAssetIds: z.array(z.string().min(1).max(160)).max(40).optional()
});

export async function POST(request: Request) {
  const limit = rateLimit(request, { bucket: "claim_create", limit: 8, windowMs: 60 * 60_000 });
  if (!limit.ok) return limit.response;
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return applyRateLimitHeaders(NextResponse.json({ error: "Invalid claim request", issues: parsed.error.issues }, { status: 400 }), limit);

  const auth = await getCurrentUser();
  const owner = resolveClaimOwner({ authUser: auth.user, requestedOwnerEmail: parsed.data.ownerEmail });
  if (!owner.ok) return applyRateLimitHeaders(NextResponse.json({ error: owner.error }, { status: 400 }), limit);

  const site = await sitePlatformRepository.getSite(parsed.data.siteId);
  const state = site ? await sitePlatformRepository.getBusinessState(site.businessId) : undefined;
  if (!site || !state) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);

  const adminAccess = (await requireAdmin(request)) === null;
  const challenge = parsed.data.verificationChallenge
    ? verifyClaimVerificationChallenge({ state, challengeId: parsed.data.verificationChallenge.challengeId, code: parsed.data.verificationChallenge.code })
    : undefined;
  if (challenge && !challenge.ok) return applyRateLimitHeaders(NextResponse.json({ error: challenge.reason, code: "claim_verification_failed" }, { status: 400 }), limit);
  const verification = adminAccess && parsed.data.verificationLevel
    ? { verificationLevel: parsed.data.verificationLevel, verificationMethod: parsed.data.verificationMethod ?? "operator_manual", verifiedBy: parsed.data.verifiedBy ?? owner.ownerEmail ?? owner.ownerUserId ?? "operator" }
    : challenge?.ok
      ? { verificationLevel: challenge.verificationLevel, verificationMethod: challenge.verificationMethod, verifiedBy: challenge.verifiedBy }
      : undefined;
  if (!verification) return applyRateLimitHeaders(NextResponse.json({ error: "Business-contact verification is required before checkout.", code: "claim_verification_required" }, { status: 409 }), limit);

  const requiredFactIds = state.facts.filter((fact) => fact.publicEligible).map((fact) => fact.id);
  const verifiedFacts = new Set(parsed.data.verifiedFacts ?? []);
  const missingFacts = requiredFactIds.filter((id) => !verifiedFacts.has(id));
  if (missingFacts.length) return applyRateLimitHeaders(NextResponse.json({ error: "Required business facts must be verified before checkout.", missingRequiredFacts: missingFacts }, { status: 400 }), limit);

  const requiredAssets = state.assets.filter((asset) => asset.activeForFutureBuilds && asset.rightsStatus === "reference_only");
  const attestedAssetIds = parsed.data.attestedAssetIds ?? [];
  const missingAssets = requiredAssets.filter((asset) => !attestedAssetIds.includes(asset.revisionId)).map((asset) => asset.revisionId);
  if (requiredAssets.length && (!parsed.data.acceptedAssetRights || missingAssets.length)) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Photo and logo rights must be confirmed before checkout.", missingAssetRights: missingAssets }, { status: 400 }), limit);
  }

  const actor = owner.ownerEmail ?? owner.ownerUserId ?? "site_owner_claim";
  try {
    await controlPlaneService.submit({ siteId: site.id, requestedBy: actor, payload: { kind: "confirm_facts", factIds: requiredFactIds } });
    for (const asset of requiredAssets) {
      await controlPlaneService.submit({ siteId: site.id, requestedBy: actor, payload: { kind: "attest_asset_rights", assetRevisionId: asset.revisionId, statement: "Owner attests they own this image or hold rights to use it on the managed website." } });
    }
  } catch (error) {
    return applyRateLimitHeaders(NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }), limit);
  }

  const claim = await platformOperationsRepository.createClaim({
    ...parsed.data,
    ownerUserId: owner.ownerUserId,
    ownerEmail: owner.ownerEmail,
    verificationLevel: verification.verificationLevel,
    verificationMethod: verification.verificationMethod,
    verifiedBy: verification.verifiedBy,
    verifiedAt: new Date().toISOString(),
    verifiedFacts: requiredFactIds,
    acceptedAssetRights: requiredAssets.length ? parsed.data.acceptedAssetRights : undefined,
    attestedAssetIds: requiredAssets.length ? attestedAssetIds : []
  });
  if (!claim) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
  if (claim.outboundCampaignId) {
    await platformOperationsRepository.recordOutboundEvent({ campaignId: claim.outboundCampaignId, prospectId: claim.outboundProspectId, siteId: claim.siteId, type: "checkout_started", metadata: { source: "claim_api", previewToken: parsed.data.previewToken ?? "", checkoutConfigured: claim.checkout.configured } });
  }
  return applyRateLimitHeaders(NextResponse.json(claim), limit);
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ claims: await platformOperationsRepository.listClaims(new URL(request.url).searchParams.get("siteId") ?? undefined) });
}
