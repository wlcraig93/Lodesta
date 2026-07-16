# Expression V4 Schema

Expression V4 is implemented as one reserved `VisualSectionV3` template id: `expression_composition`. It is not an existing catalog section and it is not a parallel renderer. It reuses the existing V3 slot content types: copy, intro, media, facts, items, action, contact, and locations.

## Proposal Shape

`SectionCompositionProposalV1` lives in `lib/expression-v4-schema.ts`.

- `version`: `section-composition-proposal-v1`
- `id`: stable proposal id
- `rhythmRole`: bounded render-state role
- `columns`: one of `4 | 6 | 8 | 10 | 12`
- `minHeight`: `auto | short | feature | viewport_minus_header`
- `contentAlign`: `start | center`
- `foreground`: `dark | light`
- `mobileOrder`: explicit primitive order
- `blocks`: 1-8 primitive blocks

Primitive kinds:

- `stack`: vertical slot grouping
- `split`: bounded two-column relationship with ratio `40_60 | 50_50 | 60_40 | 62_38 | 38_62`
- `grid`: 2-4 columns
- `band`: full-width content band
- `layer`: background-only primitive; no foreground slots

Structural caps:

- Nesting depth <= 2
- Total blocks <= 8
- Children per primitive <= 4
- Slots per primitive <= 4
- No raw CSS, no absolute foreground positioning, no foreground overlap
- Contrast token must match the section background token
- Tablet/mobile split and grid primitives stack deterministically by `mobileOrder`

## Hand-Authored Spike Proposals

1. `media_proof_split`
   - Dark section, light foreground.
   - Uses a background layer plus a 60/40 split.
   - Reused slots: `copy`, `action`, `media`, `facts`.

2. `no_media_service_stack`
   - Surface section, dark foreground.
   - Text-first no-media layout with intro/proof, services grid, and action band.
   - Reused slots: `intro`, `facts`, `items`, `action`.

3. `proof_contact_grid`
   - Subtle gradient section, dark foreground.
   - Proof/context grid plus contact/location split.
   - Reused slots: `copy`, `facts`, `items`, `locations`, `contact`, `action`.

The fixtures are generated from canonical V3 grammar bundles in `lib/expression-v4-fixtures.ts`, so QA has real business facts, services, media, contact data, and locations to grade against.

## Tooling

- `npm run verify:expression-v4`
- `npm run expression-v4:bakeoff`
- `npm run expression-v4:workbench`

The browser-backed workbench writes reports and screenshots under `.data/expression-v4-workbench/`.
