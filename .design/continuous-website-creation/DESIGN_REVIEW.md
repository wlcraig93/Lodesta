# Design Review: Continuous Website-Creation Thread

Reviewed against: `DESIGN_BRIEF.md`
Philosophy: Dieter Rams functionalism within Lodesta’s calm AI-operations workspace
Date: 2026-07-25

## Screenshots Reviewed

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-unified-build-desktop-1280.png` | Desktop (1280×720) | Dark editor shell with normalized website navigation, command-dock selection, and a static attention canvas |
| `screenshots/review-unified-build-desktop-light-1280.png` | Desktop (1280×800) | Light-theme validation of the same blank-preview state |
| `screenshots/review-unified-build-tablet-768.png` | Tablet (768×1024) | Preview pane with the focused workspace header and shared build canvas |
| `screenshots/review-unified-build-mobile-preview-375.png` | Mobile (375×812) | Mobile Preview pane with the attention canvas |
| `screenshots/review-unified-build-mobile-chat-375.png` | Mobile (375×812) | Mobile Chat pane with the command dock and disabled Select-on-page action |

## Summary

The creation experience now reads as one editor whose website is changing state. Before a render exists, the right pane is an intentional build surface rather than an empty browser frame, and the normal page, device, More, and Publish controls are absent. The compact website rail uses one navigation hierarchy, with Website settings beside the other website destinations and the account control isolated at the bottom.

The shared frame holds up cleanly at desktop, tablet, and mobile sizes. The 375px layout has no horizontal overflow, and the Chat/Preview, selection, voice, and send controls retain 44px touch targets.

No active provisional setup record was available in the local review data, so the responsive captures use the canonical editor’s failed-without-preview state. The provisional route and shell were verified separately through the focused route, ownership, and product-UI checks.

## Must Fix

None.

## Should Fix

None.

## Could Improve

1. **Exercise the first real preview crossfade in a durable visual fixture.** The current local websites all stop before producing a preview, so the canvas-to-iframe transition and enabled Select-on-page state were verified through implementation and contract checks rather than a stable design-review capture.

2. **Add a non-production visual fixture for provisional setup stages.** A deterministic queued, gathering, and attention fixture would make future responsive reviews possible without creating or mutating a real setup record.

## What Works Well

- The right pane communicates queued, gathering, composing, building, paused, and attention states without invented percentages or raw crawl telemetry.
- Source fragments, assembling page blocks, and the render sweep form one restrained visual language; reduced motion resolves to the complete static composition.
- “Select on page” now sits beside Build/Ask, where its resulting context chip is consumed.
- The selection handoff is coherent: desktop full-chat restores split view, while mobile moves Chat → Preview → Chat and returns focus to the composer.
- Website settings uses the same outline weight as the rest of the rail and no longer competes with the account control.
- Light and dark themes both preserve hierarchy and contrast, including the attention canvas and command dock.
