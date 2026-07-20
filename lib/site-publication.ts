import type { ClaimRecord } from "@/packages/platform-operations";
import { claimVerificationSatisfies, minimumCheckoutClaimVerificationLevel } from "./owner-access";

export type ClaimGateResult =
  | { ok: true; claim: ClaimRecord }
  | { ok: false; code: "claim_required" | "payment_required" | "verification_required"; reason: string; missingFacts?: string[] };

export function claimGateForSite(siteId: string, claims: ClaimRecord[], requiredFacts: string[] = []): ClaimGateResult {
  const siteClaims = claims.filter((claim) => claim.siteId === siteId);
  const completed = siteClaims.find((claim) => claim.status === "claimed");
  if (completed) {
    if (!claimVerificationSatisfies(completed.verificationLevel, minimumCheckoutClaimVerificationLevel)) {
      return {
        ok: false,
        code: "verification_required",
        reason: "Verify ownership through a listed business contact before publishing or connecting a custom domain."
      };
    }
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
