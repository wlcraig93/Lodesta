# Generated Site V3 Benchmark Holdout Mapping Report

Generated at: 2026-06-03T05:52:14.015Z

This report is produced by `npm run verify:generated-site-v3-benchmark-holdouts`. It verifies that the reserved holdout references can be mapped to selectable V3 variants without one-off CSS. It is not a visual parity score.

## Summary

- Holdout references: 10
- Confidence: strong=3, moderate=4, weak=3
- Weak mappings are intentionally retained as evidence gaps, not hidden as successes.

## Mappings

| Holdout | Archetype | Confidence | Hero | Services | Media | Notes | Remaining Gap |
|---|---|---:|---|---|---|---|---|
| `framer:noksh` (framer) | quiet_editorial_professional | moderate | quiet_centerpiece | portfolio_index | immersive_media_band | Uses quiet text hierarchy, professional capability rows, and one large image band without custom CSS. | Needs a true architectural image-spread/control pair to match the reference's slow image rhythm. |
| `framer:elevate` (framer) | studio_portfolio_editorial | moderate | editorial_scatter | editorial_rows | mosaic_wall | Maps to editorial scatter, portfolio-style work cards, and asymmetric media with existing variants. | Still needs stronger section-level negative-space controls and case-study depth. |
| `framer:athletix` (framer) | venue_community_energy | strong | media_masthead | plan_cards | immersive_media_band | Venue and fitness references can use the existing media masthead plus plan cards or program rows and a large rhythm band. | Motion and membership/schedule widgets are intentionally out of scope for generic V3. |
| `framer:cassis` (framer) | restaurant_hospitality | strong | editorial_scatter | hospitality_menu_preview | immersive_media_band | Hospitality references map to scatter media, menu-preview offerings, and full-width atmosphere imagery. | Full menu, reservation, and event-detail components are later vertical-specific work. |
| `webflow:youga` (webflow) | wellness_soft_service | moderate | appointment_card_overlay | showcase_grid | mosaic_wall | Wellness appointment pages can use the overlay request card, soft service showcase, and calm media grid. | Class schedule/teacher modules are out of generic V3 and should not be faked. |
| `webflow:pretty` (webflow) | wellness_soft_service | weak | appointment_card_overlay | showcase_grid | mosaic_wall | The current mapping is structurally possible through wellness variants. | The captured live demo appears to be a mismatched SaaS/product page, so this holdout should be replaced before using it as visual evidence. |
| `webflow:fleety` (webflow) | premium_media_led | strong | premium_object_stage | showcase_grid | immersive_media_band | Premium media-led pages map to object staging, visual service cards, and large image slabs. | Fleet/inventory filtering and ecommerce flows are not part of generic V3. |
| `webflow:adox-studio` (webflow) | studio_portfolio_editorial | moderate | editorial_scatter | editorial_rows | mosaic_wall | Studio/agency structure maps to editorial hero, concise service rows, and asymmetric gallery rhythm. | Reusable portfolio case-study cards and index sections remain missing. |
| `webflow:brivex` (webflow) | urgent_service_conversion | weak | appointment_card_overlay | editorial_rows | mosaic_wall | Service-conversion structure maps to the overlay action card and problem-led rows. | Only marketplace-detail evidence is available in the current corpus; replace with a live demo before scoring visual parity. |
| `squarespace:restaurant-category` (squarespace) | restaurant_hospitality | weak | editorial_scatter | hospitality_menu_preview | immersive_media_band | The category-level restaurant reference maps to the same hospitality primitives as Camino/Cassis. | A category page is useful for vocabulary but too weak for side-by-side visual scoring; replace with a concrete Squarespace template demo. |

## Interpretation

- The holdouts can be assigned to the current launch variant surface without adding new CSS for individual references.
- This does not mean the holdouts would score 8.5+ visually. It means the component architecture has a non-bespoke route for each reserved reference.
- The weak mappings identify corpus-quality gaps: two references are marketplace/category evidence rather than concrete live demos, and one appears to be a mismatched live demo.
- The next renderer pass should prioritize the gaps that appear across multiple mappings: richer image-spread controls, portfolio/work-card anatomy, directory footer variants, and replacement of weak marketplace/category references with concrete live templates.
