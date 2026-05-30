# Build Tasks: Admin Generation Portal

Generated from: `.design/admin-generation-portal/DESIGN_BRIEF.md`
Date: 2026-05-30

## Foundation

- [ ] **Add the platform admin shell**: Create a reusable admin layout with a left sidebar, Lodesta brand, active nav state, account/settings links, and a mobile fallback. _New component; reuses `requireAdminPageAccess`, existing button/panel styles, and global CSS._
- [ ] **Define the admin route map**: Add admin routes for Generate, Sites, Settings, and Outbound, with incomplete sections linking to existing pages or showing restrained placeholders. _New route structure; reuses existing `/settings`, `/outbound`, `/dashboard` capabilities._
- [ ] **Redirect or bridge the current dashboard**: Make `/dashboard` point platform admins toward the new portal while preserving owner/customer paths and local development behavior. _Modifies existing `app/dashboard/page.tsx` behavior or adds clear portal entry._

## Core UI

- [ ] **Build the Generate page**: Create the main admin page where URL-to-site generation is the primary action, with the form first and recent generated sites nearby. _New page; modifies/reuses `IntakeCreateForm` logic._
- [ ] **Upgrade the generation form states**: Replace the simple status string with loading, success, validation error, auth error, URL safety error, and backend failure states. _Modifies or creates a client form component; reuses `POST /api/intake`._
- [ ] **Add the generation result panel**: After success, show the generated business name, slug, score comparison, preview URL, editor link, optimization link, and next action. _New component; uses existing `/api/intake` response._
- [ ] **Add recent generated sites**: Show recent site bundles with name, vertical, slug, preview token, findings count, version count, and quick actions. _New component; reuses `repository.listSiteBundles()` or `GET /api/sites`._

## Website Generation Review

- [ ] **Expose design/style controls in the operator flow**: Add a clear route or panel from generated results into the existing curated editor and design controls. _Reuses `ResponsivePreview`, `DesignControls`, and `/editor/[slug]`._
- [ ] **Surface generation evidence**: Display current-site score, failed checks, crawl/render notes, selected design direction, and visual QA summary when present. _New summary component; reuses `PreviewWedge` data already stored on the bundle._
- [ ] **Add recovery links for failed/incomplete generations**: Give admins links to settings, deep health, and OpenAI runtime settings when generation fails due to missing service configuration. _New error affordance; reuses `/settings` and `/api/health?deep=1`._

## Responsive & Polish

- [ ] **Tune the admin visual system**: Add sidebar, compact resource-list, status-pill, and result-summary CSS while keeping the existing Lodesta admin palette and 8px radius convention. _Modifies `app/globals.css`._
- [ ] **Mobile check**: Verify the admin shell, generation form, and result panel at narrow widths so nav and buttons do not overflow. _Responsive QA._
- [ ] **Accessibility pass**: Verify labels, focus states, active nav semantics, loading announcements, and keyboard navigation. _Accessibility QA._

## Review

- [ ] **Run verification**: Run `npm run typecheck` and the most relevant smoke path for intake/admin routing.
- [ ] **Design review**: Run a design review against this brief after the V1 portal is implemented.
