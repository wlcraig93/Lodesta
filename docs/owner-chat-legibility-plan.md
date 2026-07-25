# Lean Owner Chat and Composer

Status: accepted

Date: 2026-07-25

## Decision

The owner chat uses a small, deterministic presentation layer over Lodesta’s persisted
run events. It does not display or summarize model reasoning. The server maps known
model/tool spans into a short owner vocabulary, groups adjacent completed operations,
and returns one bounded snapshot. The browser replaces that snapshot wholesale.

This snapshot protocol is the single canonical owner-activity implementation. There is
no cursor protocol, client-side event merge or grouping, event pagination, mid-run model
narration, Markdown renderer, idle status poll, contextual failure discussion, screenshot
endpoint, or prompt queue.

## Experience

The transcript keeps owner and Lodesta messages as whitespace-preserving plain text with
quiet local timestamps. Each run has one activity card placed after its first associated
message; an initial build without a message is placed by its run timestamp.

The active and most recent completed run load automatically. Older run cards show their
deterministic run status and load activity once when the owner chooses **Show activity**.
Terminal snapshots are cached in session storage. Loading, empty, temporarily unavailable,
retryable, non-retryable, truncated, and unknown-only histories all keep a stable card.

The transcript follows new work only when the reader is near the bottom. Otherwise it
preserves the reading position and offers **New activity**. The scrolling transcript is
not a live region; one visually hidden atomic polite region announces only input-needed,
preview-ready, completed, and failed transitions.

The composer is a naturally sized, subtly raised command dock. It retains Build/Ask,
browser-managed US English speech recognition, selected-element context, a 20px radius,
and a textarea that grows to 160px. Desktop actions are 32px; mobile actions are 44px.
Focus emphasizes the border with a quiet one-pixel ring. The mode menu fades and scales
for 150ms, with motion disabled by the reduced-motion preference.

Enter submits, Shift+Enter inserts a newline, Cmd/Ctrl+Enter submits, and IME composition
never submits. Owners may draft while another run is active, but cannot submit until it
settles. Failed submission preserves the draft.

## Owner activity contract

`GET /api/site-agent/runs/[runId]/activity` authorizes the site and owner session, reads
the newest 201 raw events through the existing `(run_id, sequence)` index, retains 200,
reverses them into chronological order, and returns:

```ts
type OwnerActivityGroup = {
  key: string;
  kind: "thinking" | "review" | "edit" | "image" | "build" | "question";
  status: "running" | "succeeded" | "failed";
  label: string;
  count?: number;
  startedAt: string;
  completedAt?: string;
};

type OwnerActivitySnapshot = {
  run: OwnerSiteAgentRun;
  current?: OwnerActivityGroup;
  completed: OwnerActivityGroup[];
  hasEarlierActivity: boolean;
};
```

Current work remains separate from completed groups. Completed model-request spans are
omitted. Adjacent completed operations with the same kind, label, and result are grouped.
Keys are stable opaque values derived from the first contributing event, so a growing
group keeps its identity. At most twelve completed groups are returned. A truncated raw
tail sets `hasEarlierActivity`; the oldest visible group then omits its count because the
true group may have started outside the window.

The UI shows current work and the latest four completed groups in the card, with up to
twelve under Details. If no event maps while a run is active, the real run header remains
with “Working on your website.”

## Strict projection boundary

The activity projection is a strict allow-list boundary. It constructs each returned
group from scratch:

| Persisted event | Owner label |
| --- | --- |
| running model request | Thinking through your request. |
| `list_files`, `read_file` | Reviewing the current website. |
| `write_file`, `delete_file`, `apply_patch` | Updating the website. |
| `create_image` | Creating an image. |
| `build_preview` | Building the private preview. |
| `inspect_site` | Checking the website. |
| `request_input` | Preparing a question. |
| `finish` | Finalizing the draft. |

Structural run/turn events, completed model-request events, cancelled events, and unknown
tools are omitted. The response never includes paths, filenames, selectors, arguments,
payloads, provider/model identity, costs, tokens, hashes, provider request IDs, or
internal errors.

Free-form Ask is model-authored content, not telemetry projection or guaranteed content
redaction. It receives no raw run telemetry and is prompted to speak in owner-facing page
and section terms. The distinction is deliberate: activity has a strict data boundary;
ordinary conversation remains advisory model output.

Preview is the evidence surface. Activity says what operation occurred, while the mounted
private preview shows the result. Owner activity never gates a candidate or publication.

## Instrumentation and polling

Existing live model-request spans remain. Only operations long enough to be perceived
(`create_image`, `build_preview`, `inspect_site`, and `finish`) receive a best-effort
running tool span. Its terminal update uses the same event ID. Failure to persist the
opening span cannot interrupt tool execution; fast file operations stay completion-only.

For a known active run, the browser uses one non-overlapping recursive timeout at one
second. It pauses and aborts the request while hidden, refreshes the workspace when
visible again, retains the last good snapshot after an error, and retries after three
seconds. Input-needed or terminal status stops polling, caches the snapshot, and performs
one full workspace refresh. There is no permanent idle timer or status endpoint.

## Verification

`npm run verify:owner-chat` owns projection, redaction, endpoint, snapshot, transcript,
composer, polling, cache, accessibility, and responsive assertions.
`npm run verify:agent-activity` remains focused on admin telemetry. Manager verification
proves that a failed opening-span persistence call is non-fatal and that running and
terminal slow-tool events retain the same identity.
