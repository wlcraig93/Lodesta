# Generated Site V3 Validation Pack Report

Generated at: 2026-06-09T21:07:06.953Z

This report is produced by `npm run verify:generated-site-v3-validation-pack`. It validates four generic landing pages rendered through the canonical V3 typed-slot section-template model: auto body, home service, restaurant, and professional service.

## Summary

- Sites: 4
- Blockers: 0
- Warnings: 0
- Known limits: 3

## Template Coverage

- Section purposes are generation metadata only; rendered sections carry typed `visualSectionV3` objects.
- Template order, hero template choice, background choices, slot contracts, and browser render metrics are validated.

## Sites

### Canonical editorial / Meridian Body Works

- Shell: `auto_body`
- Renderer: `layout-v3`
- Purposes: hero.split -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_panel -> contact.split
- Templates: hero_split -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> faq_list -> facts_cta -> editorial_statement -> location_panel -> contact_split
- Hero template: hero_split
- Backgrounds: solid:page -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 5843 chars, 16 CTAs, 6 images, min contrast 6.69, header contrast 6.10
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039210396-d3cf6b9d/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039210396-d3cf6b9d/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039210396-d3cf6b9d/mobile.png

No issues classified.

### Canonical editorial / Harbor Home Service

- Shell: `home_service`
- Renderer: `layout-v3`
- Purposes: hero.split -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_panel -> contact.split
- Templates: hero_split -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> faq_list -> facts_cta -> editorial_statement -> location_panel -> contact_split
- Hero template: hero_split
- Backgrounds: solid:page -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 5827 chars, 14 CTAs, 6 images, min contrast 6.69, header contrast 6.10
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039214658-5f49d472/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039214658-5f49d472/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039214658-5f49d472/mobile.png

| Category | Severity | Issue | Detail |
|---|---:|---|---|
| asset | known_limit | placeholder_vertical_mismatch | Uses current auto-body fixture media to test geometry; replace with vertical-appropriate assets before judging business-specific quality. |

### Canonical editorial / Alder & Hearth Cafe

- Shell: `restaurant`
- Renderer: `layout-v3`
- Purposes: hero.image_statement -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_panel -> contact.split
- Templates: hero_statement -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> faq_list -> facts_cta -> editorial_statement -> location_panel -> contact_split
- Hero template: hero_statement
- Backgrounds: image -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 5860 chars, 15 CTAs, 5 images, min contrast 6.69, header contrast 7.40
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039218526-90a69e82/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039218526-90a69e82/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039218526-90a69e82/mobile.png

| Category | Severity | Issue | Detail |
|---|---:|---|---|
| asset | known_limit | placeholder_vertical_mismatch | Uses current auto-body fixture media to test geometry; replace with vertical-appropriate assets before judging business-specific quality. |

### Canonical editorial / Cedarline Legal

- Shell: `law_firm`
- Renderer: `layout-v3`
- Purposes: hero.statement -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_panel -> contact.split
- Templates: hero_statement -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> faq_list -> facts_cta -> editorial_statement -> location_panel -> contact_split
- Hero template: hero_statement
- Backgrounds: gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 5806 chars, 16 CTAs, 5 images, min contrast 6.69, header contrast 6.10
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039222881-5fc4a969/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039222881-5fc4a969/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781039222881-5fc4a969/mobile.png

| Category | Severity | Issue | Detail |
|---|---:|---|---|
| asset | known_limit | placeholder_vertical_mismatch | Uses current auto-body fixture media to test geometry; replace with vertical-appropriate assets before judging business-specific quality. |

