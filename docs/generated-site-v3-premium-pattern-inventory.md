# Generated Site V3 Premium Pattern Inventory

Updated: 2026-06-16

This inventory is the working map for the AI Site Director catalog. The model should get creative authority over composition, but only from typed renderer capabilities that are already workbench-safe. New ideas enter here first, then the static catalog manifest, then model selection.

## Current Selectable Catalog

The current static manifest exposes 26 active, model-selectable templates:

- `hero_split`
- `hero_statement`
- `facts_strip`
- `split_media`
- `intro_grid`
- `feature_band`
- `side_intro_rows`
- `numbered_steps`
- `stat_band`
- `proof_pair`
- `media_feature`
- `media_mosaic`
- `quote_wall`
- `faq_list`
- `facts_cta`
- `eligibility_band`
- `service_index`
- `case_study_preview`
- `comparison_table`
- `team_story`
- `offer_band`
- `editorial_statement`
- `location_directory`
- `service_area_showcase`
- `location_showcase`
- `contact_split`

The Site Director chooses templates, sequence, presentation values, backgrounds, CTA roles, copy jobs, asset refs, and template enum controls. The compiler validates those choices and hydrates slots; hidden seed ownership should not override a valid director plan.

## Service And Card Geometry

Primary template: `intro_grid`.

Available template controls:

- `cardTreatment`: `standard`, `comparison`, `feature_cards`, `service_cards`, `media_top_cards`, `editorial_cards`
- `headingLayout`: `full_width`, `split_header`, `side_rail`, `compact_top`
- `numberDisplay`: `none`, `subtle_index`, `badge`
- `cardAction`: `none`, `text_link`, `bottom_aligned_button`, `full_width_button`
- `mediaAspect`: `none`, `square`, `4x3`, `16x10`, `portrait`
- `mediaCrop`: `center`, `subject`, `wide`, `detail_zoom`
- `cardTone`: `uniform`, `alternating_surface`, `featured_first`, `dark_feature`
- `gridPattern`: `equal_grid`, `lead_card`, `mixed_masonry`, `two_by_two`, `compact_rows`

Model-selectable service presentations:

- `action_tiles`
- `coaching_cards`
- `premium_showcase`
- `feature_list`
- `showcase_grid`
- `image_tiles`
- `media_grid`
- `menu_preview`
- `card_grid`

Default guidance:

- Services should default to `numberDisplay: none`. Numbering is for ordered process, not service catalogs.
- Use `full_width` or `compact_top` headings when the service grid needs strong visual balance. Use `side_rail` only when the adjacent cards still fill the row.
- Prefer `bottom_aligned_button`, `full_width_button`, or `text_link` based on card density; avoid mixed vertical button alignment inside one grid.
- Use `media_grid`, `showcase_grid`, or `image_tiles` only when asset analysis marks enough relevant images usable for cards.

Promotion target:

- At least four independently premium service/card configurations should stay workbench-green: text-only grid, media-top grid, lead-card showcase, and dense menu/list preview.

## Process Geometry

Primary templates: `numbered_steps`, `side_intro_rows`.

Available `numbered_steps` controls:

- `stepTreatment`: `stepper_vertical`, `checklist_cards`, `numbered_ledger`
- `orientation`: `vertical`, `horizontal`, `timeline`, `cards`, `ledger`
- `numberStyle`: `none`, `small_badge`, `oversized`, `connector`
- `mediaMode`: `none`, `one_feature_image`, `per_step_media`
- `stepDensity`: `compact`, `balanced`, `detailed`

Default guidance:

- Process sections may use numbers; services should not.
- `numbered_ledger` is best for calm editorial flows.
- `checklist_cards` is best for short expectation-setting flows.
- `stepper_vertical` is best when order matters.
- `side_intro_rows` remains useful for dense editorial rows, but should be demoted from service defaults when section QA shows repeated weak visuals.

Promotion target:

- At least three independently premium process configurations should stay workbench-green: editorial ledger, checklist cards, and full stepper.

## Proof, Trust, And Eligibility Geometry

Templates:

- `facts_strip`
- `facts_cta`
- `stat_band`
- `proof_pair`
- `quote_wall`
- `eligibility_band`
- `case_study_preview`
- `comparison_table`
- `feature_band`
- `offer_band`
- `editorial_statement`

Key controls:

- `eligibilityTreatment`: `logo_strip`, `icon_cards`, `statement_plus_list`, `split_cta`
- `caseStudyTreatment`: `before_after_pair`, `story_card`, `media_plus_results`, `three_step_case`
- `comparisonTreatment`: `feature_compare`, `table_rows`, `pros_cons_cards`
- `offerBandTreatment`: `coupon_panel`, `financing_strip`, `urgent_banner`, `quiet_offer`

Default guidance:

- Insurance-like or acceptance-strip patterns should stay purpose-neutral: acceptance, eligibility, proof, credential, coverage, or participation can all use the same geometry.
- Claims and insurance language must be deterministically verified. The model may propose the section; deterministic policy decides whether the exact claim can ship.
- `proof_pair` requires safe, distinct media; otherwise use a non-claiming proof or media section.

Promotion target:

- At least three proof/eligibility configurations should stay workbench-green: compact proof strip, acceptance/eligibility band, and media-backed proof/case pattern.

## Location, Hours, And Visit Geometry

Templates:

- `location_showcase`
- `location_directory`
- `service_area_showcase`
- `contact_split`

Available `location_showcase` controls:

- `locationLayout`: `map_left_hours_right`, `hours_card_over_map`, `map_top_hours_below`, `compact_visit_card`
- `statusBadge`: `none`, `open_now`, `closed_until`, `appointment_only`
- `hoursDisplay`: `today_first`, `full_week`, `compact_week`, `expandable`
- `actionCluster`: `directions_call`, `call_first`, `appointment_first`

Default guidance:

- Single-location businesses should normally get a premium map + hours module.
- Open/closed status is runtime/request-time state, not static generated copy.
- Map embeds should use configured Google Maps embed/browser keys when available; fallback maps should be treated as degraded, not as a premium endpoint.
- Multi-location businesses use `location_directory`; service-area businesses without a physical public address use `service_area_showcase`.

Promotion target:

- At least two single-location variants should stay workbench-green: a Texas-Tires-style map/hours card and a compact visit card. Directory and service-area variants should remain green independently.

## Hero, Header, CTA, And Global Controls

Hero templates:

- `hero_split`
- `hero_statement`

Hero controls:

- `heroLayout`: `classic_split`, `media_left`, `editorial_overlap`, `card_overlay`, `full_bleed_masthead`, `text_first`
- `proofPlacement`: `below_copy`, `side_panel`, `bottom_strip`, `none`
- `ctaLayout`: `inline`, `stacked`, `button_plus_text_link`, `callout_card`
- `mediaTreatment`: `flush`, `framed`, `rounded_panel`, `bleed`, `collage_pair`
- `headlineScale`: `compact`, `standard`, `display`

Global director controls:

- `fontPosture`
- `colorPosture`
- `buttonSystem`
- `cardChrome`
- `figureTreatment`
- `headingTreatment`
- `sectionRhythm`

Default guidance:

- Button style should vary by the director's global button system and the section's CTA role. The renderer should not make every CTA the same pill by default.
- Transparent or image-overlay headers are valid only when contrast and hero media support them.
- A services dropdown is preferred when the service list is large enough.

## Workbench Promotion Checklist

Before a template, presentation, or enum option becomes model-selectable:

- Render with `npm run section-workbench -- --template <template>`.
- Render the relevant variant controls, for example:
  - `npm run section-workbench -- --template intro_grid --list-presentation media_grid --card-treatment media_top_cards --fixture-media`
  - `npm run section-workbench -- --template intro_grid --list-presentation card_grid --card-treatment service_cards --fixture-count 6`
  - `npm run section-workbench -- --template numbered_steps --step-treatment numbered_ledger`
- Inspect desktop, tablet, and mobile section screenshots.
- Blocking findings must be zero unless the fixture is intentionally edge-case-only.
- Run `npm run verify:template-matrix`.
- Run `npm run verify:generated-site-v3-director-manifest`.

## Pattern Inventory Program

Use this loop for future catalog growth:

1. Collect 5-10 strong examples from small-business websites, web-builder section libraries, and internal generated candidates.
2. Abstract the geometry, not the business purpose. Example: "acceptance strip" is broader than auto-body insurance.
3. Decide whether the pattern is a new template, a presentation value, or an enum option on an existing template.
4. Build the smallest bounded renderer capability that captures the pattern.
5. Pass workbench and template matrix.
6. Add model-facing guidance to the manifest source.
7. Run canonical benchmark only after the section is already workbench-green.

## Known Backlog

- Add a stronger mixed-size editorial service showcase if `showcase_grid` and `feature_list` do not cover enough real-service cases.
- Add a compact "proof + CTA rail" variant for sections that currently become repetitive facts strips.
- Add richer header/dropdown visual variants once nav interaction tests cover dropdown behavior.
- Add more non-auto fixtures to section workbench so the same geometry is proven outside the early automotive examples.
