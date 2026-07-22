# Phase 1.5 Commercial Launch Slice

**Status:** Historical commercial hypothesis; not an active launch or pricing authority.

This document predates the current site-authoring platform and is retained only as business-context history. The current milestone is private experimentation and does not authorize an owner pilot. Pricing, outreach volume, and the commands below must be re-approved before use.

## Vertical

Start with **auto services / tire shops in Austin and nearby Texas markets**. The generated-site corpus, image library, and service vocabulary are strongest here, and the prospect list is reachable from public website/contact data.

## Offer And Price

- Offer: Lodesta-managed website, protected preview, claim verification, hosted site, domain connection/registration support, fact corrections, media rights handling, and one monthly improvement proposal.
- Price: **$149/month**, cancel anytime.
- Setup fee: **none during Phase 1.5**; revisit only if support minutes make payback fail.
- Refund: full refund in the first 30 days.

## Terms And Ownership

- Domain: registered in the owner's name when possible, or transferable on request. Lodesta never holds domains hostage.
- Cancellation: site remains live through the paid period, then enters a 14-day grace period. Static export and domain transfer are available on request.
- Included service: reasonable fact/copy corrections and one improvement cycle per month. Custom branding systems, ecommerce, multilingual content, and large page builds route to concierge scope review.
- Marketing rights: Lodesta may use draft screenshots in outreach only while token-gated; portfolio use requires explicit approval after claim.

## Trust Posture

- Candidate previews stay token-gated, no-indexed, and visibly labeled as drafts prepared by Lodesta, not official business sites.
- Claim links go only to independently sourced business contacts from the crawled site or public listing. Do not send to an address supplied by an unverified claimant.
- Ownership verification uses the business contact of record: automated email/phone code challenge where delivery is configured, with operator manual verification as the fallback before enabling canonical owner powers, billing attachment, or publishing.
- Takedown requests are immediate and unconditional.
- Cold email must include an identified sender, physical mailing address, working opt-out, and campaign suppression list.

## Outreach Channel

- Batch size: 20 operator-approved candidates.
- Sender: Lodesta operator account with clear identity and opt-out.
- Message: short, specific, and non-impersonating. Lead with "we prepared a draft" and the token-gated preview link; do not imply the business requested it.
- Expected comparison numbers for the first batch: 35% open rate, 12% preview/claim-link click rate, 8% paid conversion from approved candidates. Replace these with real numbers immediately.

## Capacity

Run:

```bash
npm run model:launch-capacity -- --json
```

Default Phase 1.5 assumptions:

- 20 generated candidates, 1 direction each.
- 12 operator review minutes per candidate.
- 20% gate-failure/drop rate before send.
- 10% failed-claim/manual-verification loss.
- 8% checkout conversion from approved candidates.
- 5% refund/chargeback rate.
- $149/month, 5% monthly churn assumption, 3-month target payback ceiling.

## Kill / Scale Criteria

- Scale candidate: observed expected payback is **3 months or less**, no reputation incidents, and operator can approve enough candidates at the modeled review-time target.
- Hold: payback is over 3 months but objections are fixable through candidate quality, pricing, or claim-flow changes.
- Pivot: prospects distrust the outreach posture, takedown/complaint rate is non-trivial, or paid conversion cannot support payback after obvious fixes.

Internal quality metrics inform candidate selection, but Phase 1.5 decisions are made from real outreach, claim, checkout, support, refund, and objection data.
