# Generated Site V3 Failure Audit

## Purpose

V3 is justified only where it fixes a V2 failure that blocks production-quality generated sites. This audit is the decision record for what V3 carries forward, extends, replaces, or retires.

## Audit Table

| V2 capability | Observed failure | Root cause | V3 change | Test proving fixed |
|---|---|---|---|---|
| `SiteDesignSystemV2` tokens | Sites can change colors/fonts yet still feel like recolors of the same page. | Tokens describe surface styling, not art direction, page density, media strategy, or section-to-section rhythm. | Extend into `SiteArtDirectionV3` and `SiteArtDirectionRecipeV3`, selected from a bounded recipe catalog. | V3 contract test verifies recipe selection is fail-closed, font-bound, contrast-bound, and artifacted. Golden prototypes prove distinct art directions across 5 businesses. |
| Section family and variant contracts | Contracts exist, but actual output still repeats the same section rhythm. | Family/variant names are not enough. They do not encode component regions, slot density, responsive behavior, or sparse-data degradation. | Replace visual-layer contracts with `SectionInstanceV3`, `ComponentControlSchemaV3`, `SlotV3`, and per-section sparse rules. | V3 golden prototype verifier checks no repeated shallow section rhythm and validates sparse fixture behavior. |
| V2 compiler sequencing | Auto/body, restaurant, home services, and general local output follow narrow fixed page sequences. | Compiler mostly emits deterministic section order and props rather than assembling from an approved composition catalog. | Add `PageCompositionV3` and section selection from screenshot-approved launch variants. | URL-based V3 fixture test proves materially different section sequences for different synthetic businesses without business-specific hacks. |
| V2 renderer anatomy | Renderer switches on section family and renders fixed sections. | Section markup does not expose enough layout controls to produce Webflow/Framer-like variety. | Add a V3 renderer fork that renders bounded component controls and site-specific art direction. | Browser screenshots at 1280, 768, and 375 prove each selectable launch variant renders correctly. |
| Header/hero integration | Headers often feel detached from the site and repeat the same lockup/nav/CTA treatment. | Header is a narrow renderer primitive rather than a composition decision tied to hero mode. | Header mode becomes part of art direction and must be compatible with hero variant. | QA blocks disconnected headers, wrapping nav, and incompatible header/hero pairings. |
| Media/image selection | Sites can pass image checks while using wrong-context, repeated, or visually weak imagery. | V2 validates broken images and some policy concerns, but does not make media choice a first-class auditable decision. | Add `MediaAssetDecisionV3` with rights metadata, usage scope, source, policy notes, and real-work implication flag. | Media policy tests reject missing rights metadata, repeated hero reuse, wrong context, fake business-specific imagery, and poor mobile crop. |
| Copy artifacts and claim spans | Claim safety exists, but copy can still read like planning/template language. | Copy checks focus on factual safety more than slot purpose, conversion clarity, and rendered copy quality. | Add copy candidate/evaluator artifacts with slot goals, candidate scoring, rejection reasons, and rendered-text verification. | Copy verifier blocks template/meta language, weak "ask about" phrasing when facts are known, and unsupported claims. |
| Visual QA/readiness | V2 can pass deterministic QA while still looking generic. | Current QA proves "not broken", not "designed". | Carry forward V2 deterministic QA and add V3 visual checks for repetition, weak hierarchy, disconnected header, CTA grouping, mobile composition, and admin UI leakage. | V3 review packet stores screenshots, deterministic findings, visual rubric scores, reviewer/date, and blocker notes. |
| Public route/SEO/markdown compatibility | Public surfaces still require legacy projections in places. | Existing base version shape includes `pages` and `designPlan`; V2 uses `compiledPages` as canonical but transitional projections remain. | Add a V3 page adapter/index from day one while retaining transitional projections until cutover. | Tests assert render, SEO, markdown, preview, sitemap/robots, and admin review use the V3 page adapter. |
| Artifact persistence | V2 already has `site_artifacts`, but V3 review artifacts need explicit types. | Review packets and design decisions would otherwise live only in docs or screenshots. | Extend artifact types for `art_direction_decision`, `media_asset_decision`, `copy_evaluation_report`, `v3_review_packet`, and `generation_cost_report`. | Contract verifier checks TS union and Supabase constraints contain V3 artifact types. |
| Rollout gating | Keeping V2 as the default path lets weak legacy output survive after V3 proves cleaner structure. | The V2 compiler/renderer stayed wired as fallback even after the V3 section-template renderer became the canonical architecture. | Make `layout-v3` unconditional for new generation and remove V2 compiler/pipeline/renderer dispatch from the active path. | V3 contracts verify `generateSite` emits `layout-v3` without a V2 fallback. |

## Carry Forward

- Source-aware fact graph and render policy.
- Claim spans and claim verification.
- Google proof policy: durable `place_id` only, no static review/rating/count output.
- Playwright render inspection.
- Contrast, overflow, broken-image, CTA, and mobile screenshot checks.
- Readiness blockers.
- Generation artifacts as the durable audit store.
- Async intake/job status.
- Public renderer wrapper dispatches only to V3. Pre-cutover V1/V2 artifacts are not rendered as customer-site output and must be regenerated before visual review.
- Form, analytics, publish, preview, and indexing gates.
- Existing generation-cost tracking, extended for V3 cost categories.

## Extend

- Design tokens become art direction recipes and decisions.
- Visual QA gains design-quality checks, not just render-safety checks.
- Copy artifacts gain candidate/evaluator/rejection metadata.
- Media artifacts gain rights/policy metadata.
- Public page handling gains a V3 page adapter/index.

## Replace In The Visual Layer

- V2 section-family rendering as the customer-site visual surface.
- Fixed page sequencing for the first generated homepage.
- Narrow header/hero composition.
- One-size section rhythm.

## Retired In Section-Template Cutover

- V2 default generation path.
- V2 visual compiler and generated-site pipeline.
- V2 public renderer dispatch.
- V2 visual tests that only proved legacy output shape.
- V1 public renderer fallback.

## Phase 0 Exit Criteria

- Every V3 primitive in the first implementation maps to a row in this audit.
- V3 does not rename V2 concepts without increasing expressive power or QA evidence.
- Future phases must narrow or stop if prototypes do not prove that the V3 delta improves output quality.
