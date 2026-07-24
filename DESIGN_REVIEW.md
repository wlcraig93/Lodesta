# Design Review: Lodesta Product UI

Reviewed against: `docs/design/lodesta-product-design-language.md`  
Date: 2026-07-23  
Scope: Owner account, website workspace, website editor, and shared product chrome. Generated customer-site design and admin/operator UI are out of scope.

## Evidence Reviewed

### Lodesta captures

| Screenshot | Description |
| --- | --- |
| `screenshots/review-account-overview-desktop-1280-current.png` | Current signed-in empty account / create-website experience |
| `screenshots/review-owner-overview-desktop-layout.png` | Website Overview |
| `screenshots/review-owner-overview-tablet-768-viewport.png` | Website Overview at tablet width |
| `screenshots/review-owner-overview-mobile-375-viewport.png` | Website Overview at mobile width |
| `screenshots/review-owner-editor-desktop-1280-current-nav.png` | Baseline editor with expanded owner navigation |
| `screenshots/review-owner-editor-desktop-1280-collapsed-nav.png` | Editor with compact navigation |
| `screenshots/review-owner-editor-tablet-768.png` | Editor at tablet width |
| `screenshots/review-owner-editor-mobile-375.png` | Mobile Chat view |
| `screenshots/review-owner-editor-mobile-preview-375.png` | Mobile Preview view |

### Competitor references

| Screenshot | Description |
| --- | --- |
| `screenshots/reference-lovable-dashboard-official.png` | Current official Lovable dashboard reference |
| `screenshots/reference-replit-project-home-official.png` | Current official Replit project-home reference |
| `screenshots/reference-replit-agent-thread-expanded.png` | Replit Agent thread and editor reference |
| `screenshots/reference-lovable-authenticated-dashboard.png` | Authenticated Lovable dashboard with populated projects |
| `screenshots/reference-lovable-authenticated-editor.png` | Authenticated Lovable editor |
| `screenshots/reference-lovable-authenticated-project-switcher.png` | Lovable workspace/project switcher overlay |
| `screenshots/reference-replit-authenticated-home.png` | Authenticated Replit home and creation prompt |
| `screenshots/reference-replit-authenticated-projects.png` | Authenticated Replit recent-project presentation |

Official product maps reviewed:

- [Lovable dashboard overview](https://docs.lovable.dev/introduction/dashboard-overview)
- [Lovable editor map](https://docs.lovable.dev/features/projects/editor)
- [Replit Project Editor](https://docs.replit.com/learn/projects-and-artifacts/project-editor)

The review includes authenticated passes through the current Lovable dashboard, editor, and project switcher, plus the Replit home, populated project list, and a live project editor. It also uses current first-party product documentation and official product screenshots. No competitor data was changed.

## Executive Summary

Lodesta already has a credible foundation: self-hosted Inter, a restrained forest accent, shared product tokens, clear focus styles, a responsive app shell, practical owner-facing pages, and an editor that now supports a compact outer rail, a resizable conversation panel, a More menu, and a pinned Publish action.

The remaining gap is not “make it look more like Lovable.” It is product hierarchy and finish:

1. The account shell shows an email address and “Owner account” where a person’s name should be.
2. Websites are presented as operational rows with peer-level open/remove actions instead of visual project cards.
3. The Overview can simultaneously say “Your site is current,” “Healthy,” “Not live,” and “No candidate.”
4. The green-tinted canvas, borders, and selected states wash together, while some 11–12px metadata is too small or too low contrast.
5. Similar UI roles use one-off badges, buttons, panels, status labels, and control heights.
6. The mobile editor spends too much vertical space on global navigation and stacked toolbars.

Lovable and Replit feel polished because they consistently distinguish account, workspace, project, and active task; visually represent projects; reserve the primary surface for creation; and move secondary/destructive actions into menus. Lodesta should adopt those focus rules while keeping its quieter, evidence-forward visual identity.

## What the Competitors Do Better

### Shared patterns

- The account is represented by a compact avatar or person identity. Email and plan details live inside a menu.
- The dashboard separates global navigation from project content.
- Projects are visual objects with previews, names, and recent context—not database-like rows.
- Creation is the most obvious action, but existing projects remain visible on the same surface.
- Editors collapse to two persistent work areas: conversation and output.
- Publish/share is a clear outcome action. History, diagnostics, and destructive actions live behind menus.
- Controls use a small number of repeatable heights, radii, text sizes, and interaction states.

### Authenticated observations

- Replit labels the account context as “William’s Workspace,” then greets the person by first name. It never uses the email address as persistent navigation identity.
- Replit presents recent projects as contained thumbnail rows with title, recency, link, and overflow actions. Lovable uses visual project cards. The formats differ, but both give projects a recognizable visual footprint and keep destructive actions out of the scan path.
- Lovable’s dashboard gives creation a vivid, central surface while keeping projects immediately below it. Its account avatar stays at the bottom of the navigation without an exposed email address.
- Lovable’s editor uses one integrated top bar for project identity, responsive preview controls, sharing, and publishing. Conversation and preview remain the two dominant surfaces; project/workspace navigation opens as a temporary overlay.
- Replit’s editor is more complex, but its complexity is contained in a coherent project workspace: Agent, preview, tools, deployment, history, and project identity share one frame rather than reading as separate admin pages.

### What Lodesta should not copy

- Do not copy Lovable’s saturated gradient. Lodesta’s product language calls for a quiet operational canvas.
- Do not copy Replit’s breadth of global tools. Lodesta has a smaller, owner-focused job set.
- Do not add new orchestration or a planning workflow to mimic competitor modes. The existing Edit/Discuss behavior only needs clearer presentation.

## Must Fix

### 1. Show the person, not the authentication identifier

The account label is currently the raw email in both `app/(owner)/layout.tsx:14` and `lib/owner-workspace.ts:54`. `components/AccountMenu.tsx:65-68` then renders that email beside “Owner account” in the persistent rail.

This makes authentication metadata part of the main navigation hierarchy and produces a visibly truncated identity. It also makes the interface feel internal rather than customer-ready.

**Direction**

- Add an editable display name to Account settings.
- Resolve the label from an explicit profile name, then trusted auth metadata (`full_name` or `name`), then a humanized email local-part as a last resort.
- In the sidebar, show avatar + display name only.
- In the account popover, show display name + email, followed by Account settings and Sign out.
- Keep “Admin preview,” “Token session,” and “Local development” only for non-owner contexts where the distinction matters.

### 2. Make lifecycle state internally consistent

The Overview derives “Your site is current” whenever there is no candidate (`app/(owner-workspace)/workspace/[slug]/page.tsx:127`). The same screen can still show “Not live” (`:57`), “No candidate” (`:67`), and “Healthy” (`:65`). This contradiction is visible in `review-owner-overview-desktop-layout.png`.

No amount of styling will make a product feel professional if the most prominent status disagrees with the supporting status cards.

**Direction**

Create one owner-facing lifecycle model and derive every surface from it:

- `building`: first version is being prepared
- `needs_attention`: owner or Lodesta must resolve something
- `ready_to_publish`: verified candidate is ready
- `live`: published and current
- `update_in_progress`: a live site has a new run/candidate

The next action, health badge, site switcher subtitle, account-card status, and editor status should all use that canonical projection.

### 3. Replace account rows with website cards

Authenticated websites render in `account-relationship-list` as full-width rows (`app/(owner)/account/page.tsx:22-43`; `app/globals.css:4731-4747`). The status badge is nested beside the title and aligned to the top, while Open overview and Remove website are peers at the far edge.

For a pre-launch account likely to contain one to a handful of websites, cards are the better model.

**Card specification**

- Two columns from roughly 760–1199px; three columns on wide screens; one column on mobile.
- A 16:10 visual preview using the latest retained website screenshot or neutral setup placeholder.
- Website name, hostname/Lodesta URL, and one short recent-context line.
- Status centered on the metadata row, not floating beside the title.
- The main card opens the website. Do not require a separate “Open overview” button.
- A top-right More button contains Rename when supported, Remove website, and other infrequent actions.
- Setup cards use the same footprint with a building/attention state so the grid does not jump between unrelated row types.
- Put “Add website” in the page header and optionally repeat it as a dashed final grid tile. Do not leave it as a detached button below the list.

### 4. Move destructive actions out of the primary scan path

The current working copy adds `RemoveWebsiteButton` beside the open action on each account row (`app/(owner)/account/page.tsx:31-38`). This gives a rare destructive action too much visual weight and makes every row busier.

**Direction**

Place Remove website inside a per-card More menu. Keep the existing confirmation dialog and danger styling for the final action.

### 5. Fix low-contrast and undersized metadata

`--product-color-text-tertiary` is `#7a847c` (`app/product-tokens.css:39`). It measures approximately 3.56:1 against the product canvas and 3.88:1 against white, below WCAG AA for the 12px overlines that use it.

The CSS also bypasses the 12px micro token with repeated 0.68–0.72rem values, including mobile navigation labels (`app/globals.css:4185`), badges (`:4497`), metrics (`:4531`), and several editor/status labels.

**Direction**

- Darken tertiary text to at least the current muted tone or approximately `#68736b`.
- Use 12px as the floor for visible metadata and navigation labels.
- Keep 11px only for truly nonessential diagnostic text, never owner navigation or status.
- Add automated contrast checks for product tokens and visual regression captures for the owner shell.

## Should Fix

### 1. Remove the green wash from structural surfaces

The forest primary color is strong and should stay. The issue is that canvas (`#f4f6f2`), soft surface (`#edf2eb`), selected surface (`#e3ebe0`), and borders (`#d8e0d5`) are all visibly green. In large empty areas this makes the product feel muted and slightly unfinished.

**Suggested token direction**

| Role | Current | Direction |
| --- | --- | --- |
| Canvas | `#f4f6f2` | warmer-neutral `#f7f8f6` |
| Raised canvas | `#fafbf8` | `#fbfcfa` |
| Soft surface | `#edf2eb` | neutral `#f1f3f0` |
| Default border | `#d8e0d5` | neutral `#dfe4de` |
| Selected surface | `#e3ebe0` | keep a subtle forest tint, around `#e7efea` |
| Primary | `#173f35` | keep |

The result should be mostly neutral structure with green reserved for active state, focus, progress, and decisive actions.

### 2. Clarify the navigation vocabulary

The current site navigation mixes object names and destinations: Overview, Website, Inbox, Results, Business info. “Website” under an “All websites” switcher is especially easy to read as duplication.

Use one canonical set:

- Overview
- Editor
- Leads
- Analytics
- Business details
- Settings

On the account route, do not render “All websites” as if it were an active website. Use simple account navigation: Websites, Add website, Account.

### 3. Make the account home feel populated even with zero sites

The current onboarding screen has a large centered headline and URL composer surrounded by empty green canvas (`review-account-overview-desktop-1280-current.png`). The prompt-first idea is good, but Lovable and Replit support it with richer project context, templates, or recent work.

For Lodesta:

- Keep the URL composer as the primary action.
- Reduce the headline from the current 4.25rem maximum to approximately 40–48px.
- Add a compact three-step explanation below the composer: Read existing site, Create private draft, Review and publish.
- Once a site exists, make the account home project-first: header action + website cards. Do not keep the onboarding hero above the project grid.

### 4. Finish the editor’s empty and mode states

The editor structure is now directionally strong:

- `ProductAppShell` uses a focused compact rail on the Website route.
- `SiteAgentWorkspace` shows the active business name.
- Preview secondary actions are in More.
- Publish is pinned outside the overflow.

Remaining polish:

- Replace the “Discuss” checkbox with a compact, explicit mode control: **Edit** / **Ask**. This is a presentation change, not a new planning phase.
- Add three business-aware example requests to the empty chat state.
- Make the preview empty state communicate the handoff: “Ask for a change → review the result here.”
- When Publish is disabled, expose the reason next to or inside the More/requirements surface.
- Use a lightweight preview skeleton or current live preview during generation instead of a nearly blank canvas.

### 5. Make mobile Editor immersive

On mobile, the editor reserves 58px for the account header and roughly 68px for global bottom navigation before adding the Chat/Preview switch and Preview toolbar (`app/globals.css:4092-4169`). The Preview view then uses a two-row tool layout.

**Direction**

- Hide the global bottom navigation while the Editor route is active.
- Keep one top row with back/site identity, Chat/Preview, and Publish.
- Put device mode, Select, Compare, and History in More or a bottom sheet.
- Restore global navigation when leaving the editor.

### 6. Remove internal implementation language from owner UI

Examples:

- Account settings exposes “Supabase Auth” (`app/(owner)/account/settings/page.tsx:14`).
- Overview uses “Managed and accountable,” “Publication review,” and “Primary actions.”
- Results uses “Agent-readable requests” in admin-only content, which is appropriate there but should never leak into owner summaries.

Prefer:

- Website status
- Ready to publish
- Business details
- Calls and leads
- Visitor conversion
- Secure sign-in

### 7. Consolidate product primitives

The token foundation is good, but visual roles still diverge:

- `WorkspaceStatus` exists, while Account uses a custom title badge.
- `.badge`, `.workspace-status`, `.account-relationship-title span`, and editor status text are separate systems.
- Product controls use 30, 34, 36, 38, 40, 42, 44, 46, 48, 50, and 52px heights.
- Panels use both `.panel` and `.workspace-panel`.

Create canonical local primitives without adding a UI framework:

- `ProductButton`: compact 32px, default 40px, touch 44px
- `IconButton`: compact 32px, default/touch 40–44px
- `StatusBadge`
- `ProductCard`
- `ProductPanel`
- `PageHeader`
- `EmptyState`
- `Menu` / `MenuItem`
- `SegmentedControl`

Migrate owner-facing routes first. Admin can remain denser.

## Could Improve

1. Use a real site thumbnail or branded placeholder instead of initials as the primary website identity.
2. Add “Last updated” or “Last published” context to account cards.
3. Keep active site status in one consistent position across switcher, card, Overview, and Editor.
4. Use skeletons shaped like the final content for account inventory and editor startup.
5. Complete dark-mode tokens before exposing a theme toggle. A partial `[data-theme="dark"]` block exists, but there is no product theme mechanism.
6. Add hover, focus, open-menu, building, needs-attention, empty, and published visual-regression fixtures.

## What Already Works

- The self-hosted Inter typography is appropriate for product UI.
- Forest is distinctive, legible, and strong for decisive actions.
- Focus styles, skip links, touch-target adjustments, and reduced-motion handling are present.
- The website Overview has a useful next-action-first structure.
- The editor’s compact outer rail is the correct desktop direction.
- The editor now keeps Publish visible and moves secondary actions into More.
- The mobile Chat/Preview split is the correct interaction model.
- The app avoids a generic component-library appearance and remains consistent with Lodesta’s brand.

## Recommended Implementation Order

### Pass 1: Trust and hierarchy

1. Add display name and fix the account-menu identity.
2. Introduce one canonical owner-facing site lifecycle projection.
3. Fix contradictory Overview/health text.
4. Move Remove website into a More menu.
5. Raise metadata contrast and size.

### Pass 2: Account home

1. Replace account rows with preview cards.
2. Move Add website to the page header and add-tile position.
3. Remove the fake “All websites” switcher state from account chrome.
4. Simplify account settings and remove infrastructure labels.

### Pass 3: Editor and mobile polish

1. Present Edit/Ask as a clear mode control.
2. Improve empty chat and preview states.
3. Make the mobile editor immersive.
4. Verify populated, building, failed, ready, and published states at 1280px, 768px, and 375px.

### Pass 4: System cleanup

1. Consolidate statuses, cards, panels, menus, and control heights.
2. Neutralize structural color tokens while preserving forest as the product accent.
3. Add a focused screenshot regression set for Account, Overview, Editor, Leads, Analytics, Business details, and Settings.
