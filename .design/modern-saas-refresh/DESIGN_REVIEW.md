# Design Review: Lodesta Modern SaaS Refresh

## Release follow-up — 2026-07-24

The release-readiness pass rechecked the public marketing entry point and the
shared responsive shell after the wider product changes landed. Fresh viewport
captures were taken at 1280×800, 768×1024, and 375×812:

- `screenshots/qa-marketing-home-desktop-1280.png`
- `screenshots/qa-marketing-home-tablet-768.png`
- `screenshots/qa-marketing-home-mobile-375.png`

The marketing page preserves the intentionally light presentation, clear
headline/CTA hierarchy, and responsive reflow required by the brief. The
375px page reports no horizontal overflow, interactive targets remain legible,
and no visual regression or release-blocking accessibility issue was found.

## Summary

The refreshed product now reads as a calm agentic studio rather than a conventional card dashboard. Owner and admin surfaces share a compact, responsive shell vocabulary; the editor remains the strongest artifact-first pattern; and System, Light, and Dark preferences are available from the stable account utility area without changing marketing or generated customer-site presentation.

The implementation matches the approved brief closely. Visual hierarchy, responsive reorganization, theme behavior, and accessibility checks passed. No release-blocking design findings remain.

## What Works

- The owner overview establishes one clear **Now** region, then supports it with a compact metric strip, operational readiness, and agent activity.
- Open sections, rules, and whitespace replace most equal-weight nested cards without making dense operator data feel unbounded.
- The editor's conversation-and-preview workspace now sets the visual standard: compact chrome, quiet separators, and a genuinely dominant artifact.
- The owner and admin rails share the same 220px/64px desktop vocabulary and task-focused mobile navigation.
- Admin inventory becomes a dense sticky table on desktop and concise disclosure rows on mobile, with no 375px horizontal overflow.
- Dark mode is purpose-designed with warm near-black surfaces and stable semantic roles rather than direct inversion.
- Marketing remains explicitly light, while authentication inherits the stored product preference quietly.
- The three-option Appearance control is visually immediate and semantically exposed as a labelled radio group in desktop and mobile account surfaces.

## Findings

### Must Fix

None.

### Should Fix

None after the final responsive, keyboard, contrast, and overflow pass.

### Could Improve

- Replace the development-only Next.js status badge in future visual-regression captures with screenshots from a production build. The badge is not part of Lodesta UI.
- Add deterministic populated editor fixtures for future references so both loading/empty and completed artifact states are retained.
- When a formal visual-regression service is introduced, promote this approved screenshot set as its initial baseline rather than duplicating the capture matrix.

## Accessibility and Interaction Review

- Axe WCAG 2.1 AA audits passed with zero violations across authentication, owner overview, editor, admin sites, and admin queue in both light and dark modes.
- System, Light, Dark, missing, and invalid stored preferences were tested; invalid values resolve to System.
- System-mode operating-system changes, cross-tab storage changes, reload persistence, and pre-hydration resolution passed.
- Owner and admin mobile More dialogs close with Escape and restore focus to their triggers.
- Both mobile account sheets expose all three Appearance radio options.
- All measured admin mobile navigation targets are at least 44px.
- Every reference route reported `scrollWidth === innerWidth` at 375px, 768px, and 1280px.
- Reduced-motion rules cover the refresh's non-essential transitions.

## Screenshot Review

Reference images live in [`screenshots`](./screenshots).

| Surface | Light | Dark | Viewports reviewed |
| --- | --- | --- | --- |
| Authentication | Yes | Yes | 1280×800, 768×1024, 375×812 |
| Account overview | Yes | Yes | 1280×800, 768×1024, 375×812 |
| Owner overview | Yes | Yes | 1280×800, 768×1024, 375×812 |
| Editor | Yes | Yes | 1280×800, 768×1024, 375×812 |
| Admin sites | Yes | Yes | 1280×800, 768×1024, 375×812 |
| Admin queue | Yes | Yes | 1280×800, 768×1024, 375×812 |
| Owner mobile More | — | Yes | 375×812 |
| Admin mobile More | — | Yes | 375×812 |

## Decision

Approved. The refresh satisfies the design brief and is ready for product use without a feature flag or parallel legacy theme.
