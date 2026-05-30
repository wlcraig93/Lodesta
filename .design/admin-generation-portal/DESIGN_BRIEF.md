# Design Brief: Admin Generation Portal

## Problem

When a Lodesta platform admin signs in, the app exposes many operational routes but does not provide a coherent operator workspace. The current dashboard mixes generation, owner/customer controls, preview links, analytics, optimization, outbound, account, and settings into one page. That makes the most important early operator job, creating and judging a Lodesta version of an existing website, harder than it should be.

## Solution

Create a Lodesta admin portal with a durable left-side navigation shell and one polished V1 workflow: paste a public website URL, generate a Lodesta site, inspect the generated result, and continue into preview/editor/review actions. The backend generation path should reuse the existing `/api/intake`, repository, preview-token, renderer, and design-control systems rather than introducing a separate website-builder path.

## Experience Principles

1. Operator command center over owner dashboard -- Platform admins need fast access to internal workflows, site status, and generated artifacts, not customer-facing onboarding copy.
2. One primary workflow first -- The V1 portal should make URL-to-site generation feel obvious and complete before adding more admin sections.
3. Structured generation over freeform website cloning -- The UI should reinforce that Lodesta extracts facts and creates an optimized structured site, not a copied version of the source website.

## Aesthetic Direction

- **Philosophy**: Quiet SaaS operations console.
- **Tone**: Calm, precise, work-focused, authoritative.
- **Reference points**: Linear/Stripe-style app navigation density, Supabase-style resource tables, the existing Lodesta panel/card language.
- **Anti-references**: Marketing landing page, generic website-builder canvas, decorative dashboard, customer self-serve wizard.

## Existing Patterns

- Typography: System/Inter-style stack defined in `app/globals.css`.
- Colors: Light admin surface with `#f5f7fb` background, white panels, blue-gray borders, deep green primary actions.
- Spacing: Existing `admin-page`, `admin-header`, `admin-grid`, `panel`, `metric-row`, `finding-list`, `button-row`, and `editor-form` classes.
- Components: Reuse `IntakeCreateForm` behavior but replace its placement and feedback model for an operator workflow. Reuse `ResponsivePreview`, `DesignControls`, `PreviewWedge`, and existing per-site routes after generation.
- Auth: Admin page access already exists through `requireAdminPageAccess`; API access already exists through `requireAdmin`.
- Data/API: URL-to-site generation already exists through `POST /api/intake`; site listing exists through `GET /api/sites`; previews exist through preview tokens.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Admin app shell | New | Persistent left nav for platform-admin sections. |
| Admin sidebar nav | New | Links for Generate, Sites, Settings, Outbound, Jobs/Health later. Only Generate needs to be complete in V1. |
| Generation workspace page | New | Primary `/admin/generate` or equivalent route for paste-link workflow. |
| URL generation form | Modify | Extract/extend `IntakeCreateForm` into an operator-focused form with clearer states and result handling. |
| Generation result panel | New | Shows generated site name, score delta, failed checks, preview/editor/public links, and next recommended action. |
| Recent generated sites list | New/Modify | Reuse `repository.listSiteBundles()` and `/api/sites` shape for recent work. |
| Admin home redirect/overview | New/Modify | Route signed-in admins away from the current mixed `/dashboard` into the admin portal. |
| Legacy owner/customer surfaces | Exists | Keep existing `/editor/[slug]`, `/analytics/[slug]`, `/optimization/[slug]`, `/leads/[slug]`, etc. |

## Key Interactions

- Admin opens the portal and lands on Generate.
- Admin pastes a public website URL, optionally adds guidance, and submits.
- UI enters a long-running generation state that explains the current backend stages at a high level: crawl, inspect, plan, generate, QA.
- On success, the page shows a result summary with links to private preview, editor, public slug route, optimization, and claim flow.
- On failure, the page shows a specific operator-readable error from `/api/intake`, including unsupported market, URL safety, auth, crawl, or model/settings failures.
- Recent generated sites remain visible so an admin can recover if they navigate away after generation.

## Responsive Behavior

- Desktop: Fixed left sidebar plus main content region. The generation form and result/recent-sites panel can sit in a two-column layout.
- Tablet/mobile: Sidebar collapses to a top app nav or stacked navigation list; the generation form remains first and full-width.
- Tables/lists should become stacked cards on small screens, following current mobile behavior in `app/globals.css`.

## Accessibility Requirements

- Sidebar nav uses semantic `nav` with active-page state.
- Form inputs have labels and explicit error/status regions.
- Long-running generation status updates should be announced politely for assistive tech.
- Buttons and links must remain keyboard reachable with visible focus states.
- Maintain sufficient contrast against the light admin background.

## Out of Scope

- Building a general customer website builder.
- Autonomous publishing or domain connection from the V1 generation page.
- Batch import and outbound campaign workflows, except links/placeholders in nav.
- Owner account redesign.
- New generation backend or new persistence model.
- Arbitrary customer-authored custom code/components.
