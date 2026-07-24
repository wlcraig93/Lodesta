# Design Brief: Lodesta Modern SaaS Refresh

## Problem

Lodesta's product is calm and usable, but several owner and admin screens still read as conventional dashboard software: too many equal-weight cards, too much enclosing chrome, and responsive admin behavior that compresses desktop patterns instead of reorganizing around the current task. Users also cannot choose a comfortable appearance for long owner, editor, or operator sessions.

## Solution

Evolve Lodesta into a calm agentic studio. Each screen should establish one work object or next action, then reveal evidence, history, and secondary controls progressively. Owner and admin surfaces share one responsive shell vocabulary, while the existing conversation-and-preview editor remains the canonical artifact-first workspace. System, Light, and Dark appearance preferences live in the account menu and apply before the interface paints.

## Experience Principles

1. **Work object over dashboard** — Make the website, conversation, customer inquiry, or operator queue the visual center; metrics and evidence support it.
2. **Structure over decoration** — Use alignment, whitespace, dividers, and semantic color before cards, shadows, or effects.
3. **Confidence over novelty** — Keep states, consequences, and next actions explicit in both themes and at every breakpoint.

## Aesthetic Direction

- **Philosophy**: Functionalist calm agentic studio with Scandinavian warmth
- **Tone**: Precise, capable, quiet, trustworthy, and current
- **Reference points**: Replit and Codex for artifact-first interaction; Linear and Ramp for density and restraint
- **Anti-references**: Neon AI gradients, glass-heavy dashboards, excessive pills, generic admin templates, and dark mode created by simple color inversion

## Existing Patterns

- Typography: Inter for product UI and Figtree for marketing
- Colors: Warm-neutral product canvas, forest actions, amber intelligence and attention, semantic status roles
- Spacing: Existing 2–72px `--product-space-*` scale
- Components: ProductAppShell, AccountMenu, WebsiteWorkspaceFrame, ProductStatusBadge, owner workspace recipes, and admin navigation

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Theme bootstrap | New | Resolves preference before hydration and sets the root DOM contract |
| Appearance control | New | Accessible System, Light, and Dark radio group |
| Account menu | Modify | Hosts Appearance above account and session actions |
| Product shell | Modify | Flatter rail and mobile Appearance placement |
| Admin shell | Modify | Shared 220px/64px responsive vocabulary and mobile tabs |
| Owner overview | Modify | One Now region, metric strip, checklist, and activity timeline |
| Account website card | Modify | Thumbnail, one state, one consequence, and one action |
| Admin site inventory | Modify | Dense desktop table and disclosure-based mobile rows |
| Website workspace | Modify | Theme-aware chrome; generated preview remains independent |

## Key Interactions

- Appearance defaults to System, persists on the current device, and changes immediately.
- Operating-system appearance changes update Lodesta only while System is selected.
- Desktop shells collapse to an icon rail without losing visible focus labels or account access.
- Mobile product navigation uses task-focused bottom tabs and a More sheet instead of stacked desktop navigation.
- Editor chat and preview retain their resizable, collapsible, and mobile pane-switch behavior.

## Responsive Behavior

- Mobile starts at 375px with 44px minimum targets, bottom navigation, no horizontally scrolling admin inventory, and full-screen focused editor behavior.
- Tablet uses mobile shell behavior where a compressed desktop rail would reduce task clarity.
- Desktop uses compact persistent rails, dense work surfaces, and the resizable conversation/preview frame.

## Accessibility Requirements

- WCAG AA contrast in both resolved themes
- Keyboard-operable menus, radio groups, disclosures, pane resizing, and mobile sheets
- Visible focus in every semantic surface
- Screen-reader labels for icon-only controls and current navigation state
- Reduced-motion support for all non-essential transitions and animation

## Out of Scope

- Marketing dark mode
- Generated customer-site presentation or public rendering
- Authentication, ownership, or route changes
- Account-synced theme storage
- Database, API, or schema changes
- New styling frameworks, component libraries, or icon packages
