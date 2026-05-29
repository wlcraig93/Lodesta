import "./load-env";

import type { ClaimRecord } from "../lib/models";
import { createSiteFromInput } from "../lib/intake";
import { evaluateSiteAgainstStandard } from "../lib/standard-evaluation";
import { isIndexableSite } from "../lib/site-publication";

const bundle = createSiteFromInput({
  prompt: "Build a website for Boundary Verify HVAC, a call-first HVAC company in Austin."
});

const checkoutRequiredClaim: ClaimRecord = {
  id: "claim_checkout_required",
  siteId: bundle.businessProfile.siteId,
  ownerEmail: "owner@example.com",
  verifiedFacts: ["name", "phone"],
  acceptedTermsAt: new Date().toISOString(),
  acceptedManagementAt: new Date().toISOString(),
  status: "checkout_required",
  createdAt: new Date().toISOString()
};

const claimedClaim: ClaimRecord = {
  ...checkoutRequiredClaim,
  id: "claim_claimed",
  status: "claimed",
  claimedAt: new Date().toISOString()
};

assert(!isIndexableSite(bundle, []), "Generated sites without claims must not be indexable.");
assert(!isIndexableSite(bundle, [checkoutRequiredClaim]), "Checkout-required claims must not be indexable.");
assert(isIndexableSite(bundle, [claimedClaim]), "Completed claimed sites should be indexable.");

const generatedEvaluation = evaluateSiteAgainstStandard(bundle);
assert(generatedEvaluation.source === "site_model", "Generated evaluation should use the site model.");
assert(generatedEvaluation.score.percent > 0, "Generated site evaluation should produce a score.");
assert(
  bundle.siteModel.versions[0]?.pages.some((page) => page.slug.startsWith("services/")),
  "Generated launch sites should include service landing pages when services are known."
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      siteId: bundle.businessProfile.siteId,
      generatedScore: generatedEvaluation.score,
      pages: bundle.siteModel.versions[0]?.pages.length ?? 0
    },
    null,
    2
  )}\n`
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
