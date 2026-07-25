# Design Review: Chat Composer

Reviewed against: `.design/modern-saas-refresh/DESIGN_BRIEF.md`, `docs/design/lodesta-product-design-language.md`, and the supplied Lovable reference
Philosophy: Functionalist calm agentic studio with Scandinavian warmth
Date: 2026-07-24

## Screenshots Captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-chat-composer-desktop-1280.png` | Desktop (1280×800) | Dark split editor with the empty composer |
| `screenshots/review-chat-composer-tablet-768.png` | Tablet (768×1024) | Dark chat-first responsive workspace |
| `screenshots/review-chat-composer-mobile-375.png` | Mobile (375×812) | Dark mobile composer with touch-sized controls |
| `screenshots/review-chat-composer-menu-desktop-1280.png` | Desktop (1280×800) | Open Build/Ask product menu |
| `screenshots/review-chat-composer-focus-desktop-1280.png` | Desktop (1280×800) | Focused textarea and whole-dock focus treatment |
| `screenshots/review-chat-composer-light-desktop-1280.png` | Desktop (1280×800) | Light split editor with the empty composer |

All screenshots are in `.design/chat-composer-review/screenshots/`.

## Summary

The second developer's assessment is directionally sound and appropriately cautious. The current implementation has already fixed the concrete geometry and native-control problems: the rendered empty dock is 106px high rather than reserving 136px, the one-line textarea is 24px high with no internal slack, the prompt and rail share clear inner edges, and the Build/Ask menu is now a tokenized, keyboard-managed product popover.

It is not yet a close Lovable interaction match. The remaining gap with the largest user impact is the keyboard contract, followed by the desktop rail density and the light-theme material treatment. Attachment support is not a quality defect because it was explicitly excluded from the approved scope.

## Must Fix

1. **Use the chat-standard Enter contract.** The composer currently submits only on Cmd/Ctrl+Enter, while plain Enter always inserts a newline (`components/SiteAgentWorkspace.tsx:813`). For a surface that visually presents itself as a chat composer, this is a meaningful expectation mismatch. Make Enter submit, preserve Shift+Enter for a newline, retain Cmd/Ctrl+Enter, and ignore submission while an IME composition is active.

## Should Fix

1. **Lighten the desktop action rail.** The microphone and submit controls are both 40×40px (`app/globals.css:4336`) inside a rendered 106px empty dock. They are usable and balanced, but visually heavier than the Lovable reference and the design language's “compact action rail.” Use the compact 32px control token on desktop while preserving 44px touch targets below 900px. Keep the filled submit treatment so its strength comes from semantic color rather than diameter.

2. **Make the light-theme dock read as a placed surface rather than an inset slab.** In light mode the dock uses `surface-soft` (`#f1f3f0`) and a 3.5%-alpha shadow (`app/globals.css:4093`, `app/product-tokens.css:105`). Against the white chat panel this reads more recessed than raised. Test a near-white/default surface with the existing border and a slightly clearer structural shadow, without introducing floating-card theatrics. The dark material already reads more successfully.

3. **Quiet the whole-dock focus treatment without losing accessibility.** Textarea focus currently applies the shared 3px focus halo to the entire 340px dock (`app/globals.css:4108`, `app/product-tokens.css:108`). The state is accessible and unmistakable, but stronger than the reference. Use an emphasized border plus a restrained one-pixel outer ring for `:focus-within`; retain the stronger shared focus ring on the individual mode, microphone, and submit controls for keyboard navigation.

## Could Improve

1. **Add a short popover entrance transition.** The Build/Ask menu is visually strong and has the correct labelled trigger, checked state, arrow-key movement, Escape behavior, and focus return. A 120–150ms opacity/translate or opacity/scale entrance using the existing motion tokens would make it feel less abrupt. Reduced-motion coverage already exists globally.

2. **Keep attachment handling out until it has a real workflow.** The missing plus/attachment control is a difference from Lovable, but the approved scope explicitly excluded attachments. Adding a decorative affordance with no handling path would reduce product quality rather than improve it.

## What Works Well

- The previous 136px reservation and textarea slack are gone; negative space now belongs to the dock instead of the text field.
- Prompt text, mode trigger, and action rail align coherently in the rendered editor.
- The Build/Ask popover is materially better than a native select and explains the consequence of each mode.
- Voice and submit actions have clear enabled, disabled, focus, and listening semantics.
- Mobile controls resolve to 44px targets and the 375px layout has no horizontal overflow.
- The forest/neutral material system remains recognizably Lodesta rather than becoming a literal color copy of Lovable.

## Review Note

The earlier developer's “not rendered in the workspace route” caveat no longer applies to this review. The current editor was inspected successfully at `http://127.0.0.1:4330/workspace/tj-plumber-austin-tx/editor/` in dark and light modes at desktop, tablet, and mobile breakpoints.
