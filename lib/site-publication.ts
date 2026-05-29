import type { ClaimRecord, SiteBundle } from "./models";
import { missingRequiredClaimFacts } from "./fact-verification";

export type ClaimGateResult =
  | { ok: true; claim: ClaimRecord }
  | { ok: false; code: "claim_required" | "payment_required" | "verification_required"; reason: string; missingFacts?: string[] };

export function claimGateForSite(siteId: string, claims: ClaimRecord[], requiredFacts: string[] = []): ClaimGateResult {
  const siteClaims = claims.filter((claim) => claim.siteId === siteId);
  const completed = siteClaims.find((claim) => claim.status === "claimed");
  if (completed) {
    const verified = new Set(completed.verifiedFacts);
    const missingFacts = requiredFacts.filter((fact) => !verified.has(fact));
    if (missingFacts.length) {
      return {
        ok: false,
        code: "verification_required",
        reason: "Verify required business facts before publishing or connecting a custom domain.",
        missingFacts
      };
    }
    return { ok: true, claim: completed };
  }

  const checkoutRequired = siteClaims.find((claim) => claim.status === "checkout_required");
  if (checkoutRequired) {
    return {
      ok: false,
      code: "payment_required",
      reason: "Complete checkout before publishing or connecting a custom domain."
    };
  }

  return {
    ok: false,
    code: "claim_required",
    reason: "Claim and pay for this site before publishing or connecting a custom domain."
  };
}

export function isIndexableSite(bundle: SiteBundle, claims: ClaimRecord[]) {
  return claimGateForBundle(bundle, claims).ok;
}

export function claimGateForBundle(bundle: SiteBundle, claims: ClaimRecord[]) {
  const claimGate = claimGateForSite(bundle.businessProfile.siteId, claims);
  if (!claimGate.ok) return claimGate;
  const missingFacts = missingRequiredClaimFacts(bundle.businessProfile, claimGate.claim.verifiedFacts);
  if (missingFacts.length) {
    return {
      ok: false,
      code: "verification_required" as const,
      reason: "Verify required business facts before publishing or connecting a custom domain.",
      missingFacts
    };
  }
  return claimGate;
}
