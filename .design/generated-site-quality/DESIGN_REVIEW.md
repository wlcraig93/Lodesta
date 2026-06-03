# Design Review: Generated Site Quality

Reviewed artifact: `sitegen_fd3aee3d75ab443e9b09d872435e6e07`
Business: Auto Repair done right! - SUPER-B Automotive Repair
Date: 2026-06-01

## Verdict

This is not a high-quality generated website. Desktop is a generic scaffold with weak content specificity. Mobile is objectively broken: the hero does not stack, text and media collide, and the sticky call bar covers first-viewport content.

The expectation that Lodesta should generate something meaningfully better than this is realistic. The current product is producing a structured website shell, not a polished SMB website.

## Screenshots Captured

- `.design/generated-site-quality/screenshots/sitegen-fd3aee3d-exact-desktop-viewport-1280.png`
- `.design/generated-site-quality/screenshots/sitegen-fd3aee3d-exact-desktop-1280.png`
- `.design/generated-site-quality/screenshots/sitegen-fd3aee3d-exact-tablet-viewport-768.png`
- `.design/generated-site-quality/screenshots/sitegen-fd3aee3d-exact-tablet-768.png`
- `.design/generated-site-quality/screenshots/sitegen-fd3aee3d-exact-mobile-viewport-375.png`
- `.design/generated-site-quality/screenshots/sitegen-fd3aee3d-exact-mobile-375.png`

## Must Fix

1. Mobile renderer fails on `hero.service_first`.
   The desktop preset rule is more specific than the mobile `.hero` override, so the two-column hero survives on a 375px viewport. The result is a narrow text column, overlapping image, hidden primary CTA, and sticky CTA collision.

2. Generated candidates are marked `ready` while generated-site QA is still `pending`.
   This generation has `generationQa.readiness = "pending"` with no blockers. The source-site visual QA ran, but the generated site itself was not visually gated before the candidate became ready.

3. Content is provenance-safe but quality-poor.
   The copy includes placeholders like "Credential details can be verified," "Visual proof slot ready," and generic service-card text. That is safe, but it reads unfinished and undermines trust.

4. The design system has no real art direction.
   `urgent_service` currently maps to plain cards, large black sans type, a muted background, and one generic vertical image. It does not create an auto-body brand experience, a credible repair-shop feel, or a memorable page.

5. Planning mockups are disconnected from the production renderer.
   The system generates polished planning mockups, but the final structured site does not compile those decisions into layout, imagery, section rhythm, or visual hierarchy.

## Should Fix

1. Treat visual QA as a promotion gate for `site_generations`, not only for managed/published sites.
2. Add generated-site screenshot capture immediately after candidate creation and block on mobile layout failures.
3. Promote deterministic repair issues such as missing required slots to actual readiness blockers or repair them before persistence.
4. Replace generic fallback copy with vertical-specific, source-grounded copy modules that can sound finished without inventing claims.
5. Build richer vertical recipes for the top launch categories instead of relying on one generic section renderer.

## Product Direction

The current architecture is good for safety and structure, but not for excellence. To produce great sites, Lodesta needs a stricter quality loop:

1. Source audit and fact extraction.
2. Art direction selection with constraints.
3. Structured page generation.
4. Browser-rendered desktop/tablet/mobile screenshots.
5. Vision QA against the generated site, not the source site.
6. Deterministic repair.
7. Second screenshot pass.
8. Block or require operator intervention if the site still looks bad.

Until that loop is enforced, the agent can create plausible JSON while shipping visibly poor websites.
