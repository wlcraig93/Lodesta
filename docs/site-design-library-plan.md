# Site design library plan

September 23, 2026. Owner-approved direction after the GPT-6 quality ladder (`.design/quality-ladder-2026-09-22/RESULTS.md`).

## Why

The hardened harness builds reliably (20/20 hosted, 10–20 min), but every site converges on one improvised layout: dark hero with an eyebrow, big headline, numbered service list, quote block, closing call-to-action band. A stronger author (GPT-6 Sol) writes better copy inside the same skeleton. Asking the model to invent a design system from a blank page every run produces safe, same-y results and most of the layout defects the release gate catches.

## What changes

The blank workspace starts from an editable **section library** and a choice of **design directions**. The author picks a direction that fits the business and its photographs, composes pages from sections, writes the copy, chooses the photos, and writes custom sections only where the library falls short. Everything is ordinary source in the workspace: the author, an owner, or a later edit can change or replace any section, component or style. Nothing is locked; the library changes the starting point only.

## Principles (from builder and trade-site research)

- Directions differ by **tone**, not industry. Wix names its trade templates "Plumbing (Bright)", "Plumbing (Blue)", "Handyman (Elevated)", "Roofing (Clean)"; Squarespace templates are tone-first too. Any business can land in any direction.
- **Photography carries the page when it is real and strong**; a type-led or proof-led treatment carries it when photos are thin or stock. Every photo-led section has a type-led fallback.
- **Restraint**: fewer, larger sections; one font pairing; one accent; generous space; no decorative numbering, eyebrow on every section, or filler value triads.
- **Conviction**: one plain headline that says what and where, the primary action (call / request / book) visible in the first viewport on every width, and real proof (rating, quote, project, years) near the decision.
- Conversion content model follows `docs/local-business-cro-research-playbook.md` (homepage and service-page default patterns); sections exist to serve those jobs.

## Design directions (tokens + type + treatment)

| Direction | Feel | Type | Palette logic | Treatments |
| --- | --- | --- | --- | --- |
| Trade Bold | rugged, direct, high-energy | Roboto Condensed display, Inter body | charcoal/off-white + one saturated accent from the logo | square edges, full-bleed photo heroes with overlay headline, heavy rules |
| Clean Pro | trustworthy, orderly, clinical | Manrope display, Inter body | white/cool gray + blue or teal accent | 8px radius, split heroes, soft bands, crisp lists |
| Warm Local | family, heritage, craft | Fraunces display, Figtree body | cream + deep green/brown + terracotta accent | rounded photo frames, testimonial-forward, serif quotes |
| Premium Studio | refined, confident, quiet | Newsreader display, Manrope body | near-black/stone + restrained metallic or brand accent | large imagery, thin rules, generous spacing, dark sections |
| Fresh Modern | bright, friendly, approachable | Figtree display and body | light background + two cheerful brand-derived colors | rounded shapes, color blocks, playful but tidy |

Each direction is a token set (color pairs that meet contrast, type roles, radius, spacing, image treatment) scoped to a theme class on the site root, so one site uses one direction and the author can tune any token.

## Section library (job-based, variants per section)

Hero (photo-full, split, type-led) · Proof bar (rating, years, licensed/insured only when facts exist, service area) · Services (rows, cards, detailed with inclusions/packages) · Featured project and project gallery (captions, provenance-honest) · Before/after · Testimonials (single large, pair) · Service area (towns + directions) · Emergency / availability banner · About story (photo + text) · Team / crew · Process (only with real steps) · FAQ (native details) · Contact (form + phone/address/hours) · Page header (inner pages) · Call-to-action band.

Sections take content as props and bind facts through the existing SDK components (BusinessName, Fact, Asset, BusinessAddress, BusinessHours, LeadForm, DirectionsLink, SafeLink).

## Verification

- A gallery route renders every section in every direction; the release browser gate must report zero blockers at desktop, tablet and phone.
- Owner reviews gallery screenshots once before the library is wired into authoring.
- Test on GPT-6 Luna with the five frozen ladder inputs (two builds each), judged blind against release `736ddf23`; then a GPT-6 Sol confirmation; then deploy.

## Photo pipeline (separate step)

Label each candidate image with provenance (portfolio/project page, homepage hero, team page, stock-looking, generated) and quality (resolution, subject), and collect Google Business Profile photos through the visible browser during prospect research (owner approved; never the paid Places API), private until adoption.
