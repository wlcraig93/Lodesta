# Generated Site V3 Validation Pack Report

Generated at: 2026-06-18T21:05:42.195Z

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
- Purposes: hero.split -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> proof.eligibility_band -> services.index -> proof.case_study_preview -> comparison.table -> team.story -> offer.band -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_showcase -> contact.split
- Templates: hero_split -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> eligibility_band -> service_index -> case_study_preview -> comparison_table -> team_story -> offer_band -> faq_list -> facts_cta -> editorial_statement -> location_showcase -> contact_split
- Hero template: hero_split
- Backgrounds: solid:page -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> solid:surface -> gradient:brand -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 8646 chars, 22 CTAs, 10 images, min contrast 6.23, header contrast 6.17
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816680879-53d2c38e/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816680879-53d2c38e/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816680879-53d2c38e/mobile.png

No issues classified.

### Canonical editorial / Harbor Home Service

- Shell: `home_service`
- Renderer: `layout-v3`
- Purposes: hero.split -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> proof.eligibility_band -> services.index -> proof.case_study_preview -> comparison.table -> team.story -> offer.band -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_showcase -> contact.split
- Templates: hero_split -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> eligibility_band -> service_index -> case_study_preview -> comparison_table -> team_story -> offer_band -> faq_list -> facts_cta -> editorial_statement -> location_showcase -> contact_split
- Hero template: hero_split
- Backgrounds: solid:page -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> solid:surface -> gradient:brand -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 8698 chars, 20 CTAs, 10 images, min contrast 6.23, header contrast 6.17
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816695891-12ef0c0d/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816695891-12ef0c0d/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816695891-12ef0c0d/mobile.png

| Category | Severity | Issue | Detail |
|---|---:|---|---|
| asset | known_limit | placeholder_vertical_mismatch | Uses current auto-body fixture media to test geometry; replace with vertical-appropriate assets before judging business-specific quality. |

### Canonical editorial / Alder & Hearth Cafe

- Shell: `restaurant`
- Renderer: `layout-v3`
- Purposes: hero.image_statement -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> proof.eligibility_band -> services.index -> proof.case_study_preview -> comparison.table -> team.story -> offer.band -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_showcase -> contact.split
- Templates: hero_statement -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> eligibility_band -> service_index -> case_study_preview -> comparison_table -> team_story -> offer_band -> faq_list -> facts_cta -> editorial_statement -> location_showcase -> contact_split
- Hero template: hero_statement
- Backgrounds: image -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> solid:surface -> gradient:brand -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 8610 chars, 21 CTAs, 9 images, min contrast 6.23, header contrast 7.40
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816711533-cd55a653/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816711533-cd55a653/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816711533-cd55a653/mobile.png

| Category | Severity | Issue | Detail |
|---|---:|---|---|
| asset | known_limit | placeholder_vertical_mismatch | Uses current auto-body fixture media to test geometry; replace with vertical-appropriate assets before judging business-specific quality. |

### Canonical editorial / Cedarline Legal

- Shell: `law_firm`
- Renderer: `layout-v3`
- Purposes: hero.statement -> proof.facts_strip -> story.split_media -> highlights.grid -> feature.band -> pricing.packages -> services.rows -> media.feature -> media.gallery -> proof.quote_wall -> process.steps -> proof.eligibility_band -> services.index -> proof.case_study_preview -> comparison.table -> team.story -> offer.band -> faq.list -> proof.facts_cta -> statement.editorial -> local.location_showcase -> contact.split
- Templates: hero_statement -> facts_strip -> split_media -> intro_grid -> feature_band -> intro_grid -> side_intro_rows -> media_feature -> media_mosaic -> quote_wall -> side_intro_rows -> eligibility_band -> service_index -> case_study_preview -> comparison_table -> team_story -> offer_band -> faq_list -> facts_cta -> editorial_statement -> location_showcase -> contact_split
- Hero template: hero_statement
- Backgrounds: gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:subtle -> gradient:brand -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> solid:surface -> gradient:subtle -> solid:surface -> gradient:brand -> gradient:subtle -> gradient:subtle -> solid:surface -> solid:surface -> gradient:brand
- Metrics: body 8617 chars, 22 CTAs, 9 images, min contrast 6.23, header contrast 6.17
- Screenshots: desktop: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816726824-b4e75a62/desktop.png; tablet: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816726824-b4e75a62/tablet.png; mobile: /Users/williamcraig/Documents/GitHub/Lodesta/.data/render-inspections/generated.lodesta.local-1781816726824-b4e75a62/mobile.png

| Category | Severity | Issue | Detail |
|---|---:|---|---|
| asset | known_limit | placeholder_vertical_mismatch | Uses current auto-body fixture media to test geometry; replace with vertical-appropriate assets before judging business-specific quality. |

