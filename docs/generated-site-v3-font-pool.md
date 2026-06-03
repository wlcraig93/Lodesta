# Generated Site V3 Approved Font Pool

## Rules

- Fonts are universal, not vertical-specific.
- Art direction can choose a pairing based on tone, density, brand cues, and content shape.
- Every pairing includes fallback stacks and approved weights.
- Body text must remain at least 16px in normal reading contexts.
- Do not use a font pairing if it makes mobile headings cramped or body copy hard to scan.

## Initial Pairings

| Id | Heading stack | Body stack | Weights | Best fit | Notes |
|---|---|---|---|---|---|
| `editorial_serif_clean_sans` | `Fraunces, Georgia, serif` | `DM Sans, "Segoe UI", system-ui, sans-serif` | heading 700-900, body 400-600 | premium local, studios, professional services | Strong editorial contrast. Use with restrained colors and generous whitespace. |
| `display_sans_humanist` | `"Aptos Display", "Avenir Next", "Segoe UI", system-ui, sans-serif` | `Figtree, "Segoe UI", system-ui, sans-serif` | heading 700-850, body 400-600 | broad local services | Clean, modern, less generic than system-only. Good default candidate. |
| `condensed_service_sans` | `"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif` | `Figtree, "Segoe UI", system-ui, sans-serif` | heading 750-900, body 400-600 | service businesses with short headlines | Use sparingly. Strong for punchy service headings, risky for long mobile headlines. |
| `warm_editorial_sans` | `"Source Serif 4", Georgia, serif` | `"Source Sans 3", "Segoe UI", system-ui, sans-serif` | heading 650-850, body 400-600 | restaurants, cafes, hospitality | Works with food/media-heavy pages and warmer palettes. |
| `precision_grotesk` | `"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif` | `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif` | heading 600-800, body 400-600 | professional, technical, repair, medical-like trust | Functional and precise. Needs strong layout to avoid feeling plain. |
| `friendly_rounded` | `"Nunito Sans", "Segoe UI", system-ui, sans-serif` | `"Nunito Sans", "Segoe UI", system-ui, sans-serif` | heading 700-900, body 400-600 | approachable local services, family businesses | Use with warm neutrals and soft buttons. Avoid for luxury/professional legal contexts. |
| `magazine_grotesk` | `"Space Grotesk", "Avenir Next", system-ui, sans-serif` | `"Public Sans", "Segoe UI", system-ui, sans-serif` | heading 650-800, body 400-600 | modern studios, creative services, standout local brands | Good for statement/cardless heroes and asymmetric layouts. |
| `quiet_serif` | `"Cormorant Garamond", Georgia, serif` | `"Work Sans", "Segoe UI", system-ui, sans-serif` | heading 600-800, body 400-550 | boutique, wellness, editorial local pages | Requires high whitespace discipline and shorter headings. |

## Selection Constraints

- If headline length is high, avoid condensed or delicate serif headings.
- If content density is high, prefer humanist or precision sans pairings.
- If imagery is weak, choose a pairing that can carry the page typographically.
- If business name is long, avoid wordmark-heavy header treatments that repeat the name.
- If mobile hero text exceeds 5 lines at 375px, switch font pairing, shorten copy, or choose a different hero variant.

## Performance Constraints

- Initial V3 can use system-safe stacks plus optional external fonts only when the loading strategy is explicit.
- If a remote font is unavailable or too expensive, the fallback stack must still satisfy the visual rubric.
- Browser QA must verify text sizing and line breaks at 375, 768, and 1280.
