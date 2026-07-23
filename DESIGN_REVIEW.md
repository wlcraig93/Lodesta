# Design Review: Owner Workspace and Website Editor

Reviewed against: `docs/design/lodesta-product-design-language.md`  
Date: 2026-07-23  
Scope: Owner-facing workspace, especially the Website editor. Admin surfaces and generated customer-site design are out of scope.

## Screenshots Captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-owner-editor-desktop-1280-current-nav.png` | Desktop, 1280×800 | Current Website editor with the 220px owner navigation expanded |
| `screenshots/review-owner-editor-desktop-1280-collapsed-nav.png` | Desktop, 1280×800 | The same editor using the existing 64px compact navigation |
| `screenshots/review-owner-editor-tablet-768.png` | Tablet, 768×1024 | Single-pane Chat state with mobile product navigation |
| `screenshots/review-owner-editor-mobile-375.png` | Mobile, 375×812 | Single-pane Chat state |
| `screenshots/review-owner-editor-mobile-preview-375.png` | Mobile, 375×812 | Single-pane Preview state and wrapped preview toolbar |
| `screenshots/review-owner-overview-desktop-layout.png` | Desktop layout | Owner Overview dashboard |
| `screenshots/review-owner-overview-tablet-768-viewport.png` | Tablet, 768×1024 | Responsive Owner Overview |
| `screenshots/review-owner-overview-mobile-375-viewport.png` | Mobile, 375×812 | Responsive Owner Overview |
| `screenshots/reference-replit-agent-thread-expanded.png` | Desktop reference | Current official Replit Project Editor reference |

The black circular `N` visible in some screenshots is the local Next.js development control, not Lodesta UI.

## Executive Summary

The general visual system is not the problem. Lodesta's typography, restrained forest palette, borders, cards, spacing, owner dashboard, responsive bottom navigation, and action-oriented copy are already credible and consistent with the product design language.

The clumsy feeling is concentrated in the desktop Website editor. It currently reads as three peer-level products placed beside one another:

1. a 220px account/site/navigation product,
2. a roughly 360–430px Website manager/chat product,
3. a preview product with its own dense toolbar.

That is too much persistent hierarchy for a website owner. At 1280px, the expanded navigation and default chat panel consume roughly 580px before the preview begins. The preview toolbar then exceeds the available pane width and makes the Publish action appear clipped. See `review-owner-editor-desktop-1280-current-nav.png`.

Using the existing 64px compact rail immediately changes the perception from a three-panel dashboard to a focused two-area editor. See `review-owner-editor-desktop-1280-collapsed-nav.png`. That is the clearest near-term direction.

## Competitor Comparison

### Lovable

Lovable explicitly describes its editor as two main areas: Chat on the left and Preview on the right. Its dashboard navigation is available from the Lovable logo, which opens the dashboard sidebar in place, while project controls live in the top bar. On smaller windows, controls move into overflow menus; on mobile, Chat and Preview become separate swipeable views.

Useful reference: [Lovable editor map](https://docs.lovable.dev/features/projects/editor) and [Lovable mobile app](https://docs.lovable.dev/integrations/lovable-mobile-app).

### Replit

Replit also describes the Project Editor as a conversation panel beside a live preview. Its persistent global/tool navigation is a very narrow icon dock, and the project identity, preview tabs, and Publish action share a unified top bar. Work status and task history stay inside the conversation area instead of becoming another top-level navigation surface.

Useful reference: [Replit Project Editor](https://docs.replit.com/learn/projects-and-artifacts/project-editor).

### Lodesta

Lodesta already has the same core two-area editor, but it nests that editor inside a full-width owner navigation shell. The difference is less about styling than focus management:

| Question | Lovable | Replit | Lodesta current |
| --- | --- | --- | --- |
| What dominates the editor? | Chat + Preview | Agent/Tasks + Preview | Owner nav + Chat + Preview |
| Where are all projects/sites? | Dashboard/sidebar opened from logo | Workspace/home and project switcher | Persistent 220px rail and site switcher |
| How are secondary actions handled? | Top bar and overflow menus | Tool tabs and compact controls | Many always-visible preview controls |
| Mobile model | Separate Chat/Preview views | Compact project tools | Separate Chat/Preview views |

Lodesta should copy the competitors' focus model, not their visual styling.

## Must Fix

1. **The editor must not depend on horizontal toolbar scrolling to reveal Publish.** The preview toolbar renders Preview, page selection, viewport mode, Select, Compare, History, optional Admin/Open live, and Publish as peers (`components/SiteAgentWorkspace.tsx:611`). Its CSS explicitly allows horizontal scrolling (`app/globals.css:3047`), which hides the decisive owner action when the preview pane narrows.

   **Direction:** Pin Publish to the right edge. Move History, Compare when unavailable, and any diagnostics into a single overflow menu at constrained desktop widths. Keep page and viewport controls visible because they directly affect the preview.

2. **The Website editor should default to compact app navigation.** The shell defaults to a 220px rail above 1180px and shares one persisted state across all owner routes (`components/ProductAppShell.tsx:54`, `app/globals.css:4685`). This makes the editor inherit an expanded dashboard state even though preview width is its primary resource.

   **Direction:** Give `/workspace/[slug]/website` a route-scoped compact default. Preserve the user's ability to expand it, but do not let an expanded Overview preference automatically consume editor space.

## Should Fix

1. **Make the editor read as two areas, not three panels.**

   Preferred end state:

   ```text
   [compact app rail] [website conversation] [live preview]
   ```

   The compact rail can remain 52–64px, or it can become an overlay drawer opened from the Lodesta mark. The current adjustable conversation/preview split is worth keeping.

2. **Put the website identity in the editor header.** “Website manager / Draft” is generic while the actual site name is truncated in a separate rail. The focused object should be obvious even when navigation is compact.

   **Direction:** Use the current website name as the primary label and “Website · Draft/Live” as supporting status. The website switcher can open from that identity or the avatar.

3. **Demote “All websites” from persistent editor chrome.** All websites is important on the account home and in a switcher, but it is not part of the active editing task.

   **Direction:** Keep All websites, Add website, and other site names inside the existing switcher/drawer. Do not allocate a standing content column to them in the editor.

4. **Reduce the number of toolbar peers.** The current toolbar gives nearly equal visual weight to page selection, device mode, Select, Compare, History, diagnostics/live-site access, and Publish.

   **Direction:** Establish three groups:

   - Context: page selector
   - Preview tools: Desktop/Mobile, Select
   - Outcome: Publish, with secondary actions in More

5. **Keep owner and operator concepts visually separate.** The local review shows Admin because the demo uses local operator access. In an admin preview, diagnostics should remain available but should not change the owner's primary toolbar geometry.

   **Direction:** Put diagnostics in an operator-only overflow menu or inspector drawer.

## Could Improve

1. **Mobile Preview controls wrap into a dense two-row toolbar.** It is functional, but the first screen of Preview is mostly product chrome.

   **Suggestion:** Keep page selection and Publish visible, then put device mode, Select, Compare, and History in a bottom sheet or compact More menu.

2. **The mobile site title truncates early.** The site switcher, chevron, and Draft badge compete for the same header row.

   **Suggestion:** Treat the site identity as one tappable unit and move status into the editor subheader when space is constrained.

3. **Empty editor states can better explain the relationship between Chat and Preview.** “What should we work on?” and “No preview yet” are individually clear, but the screen does not visually establish that a request in Chat produces a reviewable result in Preview.

   **Suggestion:** Use a subtle first-run handoff message or example prompt in Chat. Avoid adding a new onboarding layer.

## What Works Well

- The Owner Overview is calm, legible, and action-oriented. “Next best action” provides a strong hierarchy without feeling like a decorative dashboard.
- The palette, typography, card treatment, and status semantics feel credible and restrained.
- The mobile Chat/Preview switch is the right interaction model. It avoids shrinking three desktop panels into unusable columns.
- The mobile bottom navigation is clear and uses appropriate touch targets.
- The editor already supports collapsing both the outer navigation and the conversation panel, keyboard resizing, full-chat mode, and responsive reorganization. The underlying mechanics are stronger than the current default composition suggests.
- Focus states, skip navigation, semantic regions, and reduced-motion handling are present.

## Recommended Sequence

### Pass 1: High-leverage simplification

1. Default the Website route to the compact 64px app rail.
2. Keep Publish pinned and consolidate secondary toolbar actions into More when space is constrained.
3. Replace “Website manager” with the active website identity.

This should remove most of the awkwardness without a shell rewrite.

### Pass 2: Focused editor shell

1. Let the Lodesta mark or compact rail open owner navigation as an overlay/drawer.
2. Keep Chat and Preview as the only persistent content regions.
3. Preserve the full owner sidebar on Overview, Inbox, Results, Business info, and Settings, where navigation supports rather than competes with the task.
