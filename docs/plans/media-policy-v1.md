# Media Policy V1 — Consolidation & Unblock Plan

Handoff for the implementing agent. This resolves the current media deadlock (all 7 auto-body corpus sites blocked) with one simple policy, then runs the corpus gate. Product decisions below are Willie's, made 2026-07-08. Read `AGENTS.md` first; the media floor and public QA are boundary-sensitive.

## The policy (one rule, three slot classes)

**Real photos make claims. Library photos set mood. No photo may fake a claim.**

| Slot class | What it claims | Allowed media |
| --- | --- | --- |
| **Proof** (before/after strips, "our work", case study) | "We did this work" | First-party photos only. Imperfect ones (collage, text overlay) render with **framed treatment**. Never library, never AI-generated. |
| **Context** (backgrounds, service-card accents, atmosphere) | Nothing — decoration | First-party preferred; **curated library allowed as supplement** when first-party is insufficient. Alt text keeps marking library images as generic; `mayImplyRealBusinessWork` stays `false`. |
| **Hero** | "This is our shop's site" | First-party if it clears the strict technical bar; otherwise the identity-led text hero. Library hero stays off by default (premium thesis: strong type beats generic imagery) — revisit only with eyeball-board evidence. |

**Zero-photo businesses:** ship the text-first site. The "auto-body with zero photos" visual-QA **blocker becomes a warning** plus an owner-action item ("add photos to strengthen your site"). An honest text-first site beats fabricated adequacy.

Rejection still exists — but only for *technical* disqualifiers in proof slots: `logo_like`, `low_resolution`, `blurry`, `not_business_relevant`, broken URL. Aesthetic imperfection (collage, text overlay) is handled by **placement and framing, not rejection**.

## Code changes

1. **Restore the two-tier floor** in `lib/media-floor-v1.ts`: remove `text_overlay`, `collage_or_composite`, and `logo_like`→keep, from the proof/gallery blocked set — restore `proofBlockedWarnings = ["logo_like", "low_resolution", "blurry", "not_business_relevant"]` (the original two-tier design). This revives the currently dead framed-treatment branch (`needsFramedTreatment`, ~line 89). Hero/background strict set is unchanged.
2. **Demote the zero-photo blocker** in `lib/generation-quality-v2.ts` (the "no credible media plan / not commercially credible" blocker): severity `blocking` → `warning`, and emit an owner-action item. Leave the `textFirstFallbackApproval` machinery in place but unused for now — it's a candidate for the later deletion pass, not this change.
3. **Context supplement**: confirm the existing asset-library fallback path fills *context slots only* (never proof — `curatedMediaMayBeProof: false` already enforces this; add a regression test). Curate/approve a small `auto_body` **context** set in the asset library (shop atmosphere, tool/paint detail textures — explicitly not before/after or repair-outcome imagery). The 53 approved `auto_services` context assets may be reused where category-appropriate via the profile's curated fallback categories.
4. **Do not** add stock/AI imagery to proof slots under any code path. The existing blocker for `generated_ai` media with `mayImplyRealBusinessWork` stays.

## Verification & rollout

1. `npm run typecheck`, `npm run verify:generation-quality-v2`, `npm run verify:auto-body-quality-benchmark`, `npm run verify:launch-boundaries`.
2. Add fixtures: collage/text-overlay proof media renders framed; library asset in a proof slot is rejected; zero-photo site passes with warning + action item.
3. **Rerun Mencia** (single target, live). Expected: not blocked; real before/after imagery framed in the proof strip; a11y 100 holds.
4. **Then run the 7-target corpus** with identity reporting — produce the final tables (blockers, scorecard, identity distance, copy overlap) and the eyeball board for Willie.

## Explicitly out of scope

- Collage-splitting / text-removal photo rescue (approved direction, later enhancement — subtract-only editing, never synthesis).
- Library hero imagery.
- The broader policy deletion pass (runs after the corpus data is in).

Do not stage/commit unrelated dirty-tree changes; stage only files touched for this task.
