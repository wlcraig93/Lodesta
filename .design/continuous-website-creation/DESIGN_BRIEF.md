# Design Brief: Continuous Website-Creation Thread

## Product Goal

Move owners directly from URL submission into a conversation-and-preview workspace. The temporary setup workspace should become the existing editor without making the owner feel that the conversation restarted.

## Experience Principles

- Use Lodesta’s calm, functional AI-operations aesthetic: warm neutral surfaces, restrained green action color, and amber only for attention.
- Keep owner-facing progress concise. Put reassuring detail behind an expandable disclosure.
- Never show raw tool activity, model events, file operations, or internal failure diagnostics.
- Keep the preview pane honest and neutral until a real preview exists.
- Disable authoring controls until the first private draft is ready, with an accessible explanation.
- Preserve the canonical owner instruction across the setup-to-editor handoff.

## Responsive Direction

- Desktop uses the existing resizable chat/preview split with collapse and full-chat modes.
- Mobile uses a full-screen focused workspace with a Chat/Preview switch and 44px interaction targets.
- Tablet follows the focused mobile workspace rather than compressing the desktop split.
- Reduced-motion preferences should suppress non-essential motion.

## Critical States

- Queued: “Waiting to begin”
- Processing: “Learning about your business”
- Failed: “Website setup needs attention”
- Linked initial build: owner-safe stage progress in the editor
- Preview ready and candidate ready: existing editor preview and publication boundaries

## Out of Scope

Publishing policy, generated customer-site presentation, analytics schema, new run orchestration, and structured product areas outside creation/editor.
