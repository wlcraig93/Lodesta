import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { siteAgentRunEventSchema, siteAgentRunSchema, type SiteAgentRun, type SiteAgentRunEvent } from "@/packages/site-contracts";
import { ownerActivitySnapshot } from "@/packages/site-platform/owner-run-view";

const run = runFixture();
const empty = ownerActivitySnapshot(run, []);
assert.deepEqual(empty.completed, []);
assert.equal(empty.current, undefined);
assert.equal(empty.hasEarlierActivity, false);

const unknownOnly = ownerActivitySnapshot(run, [
  eventFixture({ id: "unknown", sequence: 1, name: "internal_secret_tool", status: "succeeded" }),
  eventFixture({ id: "structural", sequence: 2, kind: "turn", name: "write_file", status: "succeeded" })
]);
assert.deepEqual(unknownOnly.completed, []);
assert.equal(unknownOnly.current, undefined);

const active = ownerActivitySnapshot(run, [
  eventFixture({ id: "model-open", sequence: 1, kind: "model_request", name: "responses.create", status: "running" })
]);
assert.equal(active.current?.label, "Thinking through your request.");
assert.equal(active.current?.kind, "thinking");
assert.equal(active.completed.length, 0);

const completed = ownerActivitySnapshot(runFixture({ status: "succeeded" }), [
  eventFixture({ id: "read-1", sequence: 1, name: "read_files", status: "succeeded" }),
  eventFixture({ id: "read-2", sequence: 2, name: "list_files", status: "succeeded" }),
  eventFixture({ id: "write-1", sequence: 3, name: "write_file", status: "succeeded" }),
  eventFixture({ id: "finish-1", sequence: 4, kind: "inspection", name: "finish", status: "succeeded" })
]);
assert.deepEqual(completed.completed.map((group) => [group.kind, group.count]), [
  ["review", 2],
  ["edit", undefined],
  ["review", undefined]
]);
assert.equal(completed.current, undefined);

const failed = ownerActivitySnapshot(runFixture({ status: "failed" }), [
  eventFixture({ id: "build-failed", sequence: 1, kind: "build", name: "build_preview", status: "failed" })
]);
assert.equal(failed.completed[0]?.status, "failed");
assert.equal(failed.run.progress.label, "Website needs attention");
assert(!JSON.stringify(failed).includes("synthetic internal failure"));

const fortyToolEvents: SiteAgentRunEvent[] = [];
for (let index = 0; index < 40; index += 1) {
  const sequence = index * 3;
  fortyToolEvents.push(
    eventFixture({ id: `turn-${index}`, sequence, kind: "turn", name: `manager.turn.${index + 1}`, status: "succeeded" }),
    eventFixture({ id: `model-${index}`, sequence: sequence + 1, kind: "model_request", name: "responses.create", status: "succeeded" }),
    eventFixture({ id: `write-${index}`, sequence: sequence + 2, name: "write_file", status: "succeeded" })
  );
}
const fortyToolSnapshot = ownerActivitySnapshot(runFixture({ status: "succeeded" }), fortyToolEvents);
assert.equal(fortyToolEvents.length, 120);
assert.equal(fortyToolSnapshot.completed[0]?.count, 40);
assert.equal(fortyToolSnapshot.hasEarlierActivity, false);

const overWindowEvents: SiteAgentRunEvent[] = [];
for (let index = 0; index < 200; index += 1) {
  overWindowEvents.push(eventFixture({
    id: `window-${index}`,
    sequence: index,
    name: Math.floor(index / 3) % 2 ? "read_files" : "write_file",
    status: "succeeded"
  }));
}
const truncated = ownerActivitySnapshot(runFixture({ status: "succeeded" }), overWindowEvents, { rawTailTruncated: true });
assert.equal(truncated.hasEarlierActivity, true);
assert.equal(truncated.completed.length, 12);
assert.equal(truncated.completed[0]?.count, undefined);
assert.equal(truncated.completed[1]?.count, 3);

const growingTwo = ownerActivitySnapshot(run, [
  eventFixture({ id: "stable-first", sequence: 1, name: "write_file", status: "succeeded" }),
  eventFixture({ id: "stable-second", sequence: 2, name: "write_file", status: "succeeded" })
]);
const growingThree = ownerActivitySnapshot(run, [
  eventFixture({ id: "stable-first", sequence: 1, name: "write_file", status: "succeeded" }),
  eventFixture({ id: "stable-second", sequence: 2, name: "write_file", status: "succeeded" }),
  eventFixture({ id: "stable-third", sequence: 3, name: "write_file", status: "succeeded" })
]);
assert.equal(growingTwo.completed[0]?.key, growingThree.completed[0]?.key);
assert.equal(growingTwo.completed[0]?.count, 2);
assert.equal(growingThree.completed[0]?.count, 3);
assert(!growingThree.completed[0]?.key.includes("stable-first"));

const redactionEvent = siteAgentRunEventSchema.parse({
  ...eventFixture({ id: "redaction-event", sequence: 1, name: "write_file", status: "succeeded" }),
  apiProvider: "openai",
  modelId: "secret-model",
  providerRequestId: "secret-request",
  inputTokens: 999,
  costUsd: 12.34,
  summary: { path: "src/private/Secret.tsx", selector: "#secret", inputHash: "sha256:secret" },
  payloadRef: "private/raw-payload.json",
  payloadHash: `sha256:${"a".repeat(64)}`,
  errorCode: "secret_internal_error"
});
const redacted = JSON.stringify(ownerActivitySnapshot(run, [redactionEvent]));
for (const forbidden of [
  "secret-model",
  "secret-request",
  "src/private/Secret.tsx",
  "#secret",
  "sha256:secret",
  "private/raw-payload.json",
  "secret_internal_error",
  "inputTokens",
  "costUsd",
  "apiProvider"
]) {
  assert(!redacted.includes(forbidden), `Owner activity leaked ${forbidden}`);
}

const [component, activityRoute, manager, discussionBrief, css, tokens, documentation] = await Promise.all([
  readFile("components/SiteAgentWorkspace.tsx", "utf8"),
  readFile("app/api/site-agent/runs/[runId]/activity/route.ts", "utf8"),
  readFile("packages/site-agent/manager.ts", "utf8"),
  readFile("packages/site-agent/briefs.ts", "utf8"),
  readFile("app/globals.css", "utf8"),
  readFile("app/product-tokens.css", "utf8"),
  readFile("docs/owner-chat-legibility-plan.md", "utf8")
]);

assert(activityRoute.includes("RAW_EVENT_LIMIT + 1") && activityRoute.includes('order: "descending"')
  && activityRoute.includes(".slice(0, RAW_EVENT_LIMIT).reverse()"), "Activity endpoint does not return one bounded chronological tail snapshot.");
assert(activityRoute.includes("authorizedSiteActor") && activityRoute.includes("canAccessAgentSession")
  && activityRoute.includes('error: "Run not found"'), "Activity endpoint does not enforce the owner/run authorization boundary.");
assert(component.includes("ownerTranscriptItems(workspace.messages, workspace.runs)")
  && component.includes("firstMessageIndex") && component.includes("run.startedAt"), "Run cards are not deterministically placed after associated messages or by initial-build time.");
assert(component.includes("window.sessionStorage") && component.includes("Show activity")
  && component.includes("Loading activity") && component.includes("Activity is temporarily unavailable.")
  && component.includes("No detailed activity was recorded."), "Historical activity loading, caching, empty, and failure states are incomplete.");
assert(component.includes("window.setTimeout(() => void poll(), delay)") && component.includes("schedule(1000)")
  && component.includes("schedule(3000)") && component.includes('document.addEventListener("visibilitychange"')
  && component.includes("controller?.abort()"), "Active snapshot polling does not start, pause, retry, or tear down deterministically.");
assert(component.includes("isSettledOwnerRun(snapshot.run)") && component.includes("await refresh()"), "Terminal polling does not shut down with one full workspace refresh.");
assert(component.includes("followsLatestRef") && component.includes("New activity")
  && component.includes("element.scrollHeight - element.scrollTop - element.clientHeight < 96"), "Transcript auto-follow and scroll anchoring are incomplete.");
assert(!component.includes('className="site-agent-messages" aria-live=')
  && component.includes('aria-live="polite" aria-atomic="true"'), "Transcript activity would create a screen-reader firehose.");
assert(component.includes("<p>{item.message.content}</p>") && !component.includes("react-markdown")
  && !component.includes("dangerouslySetInnerHTML"), "Messages are not rendered as safe whitespace-preserving plain text.");
assert(component.includes("event.nativeEvent.isComposing") && component.includes("event.shiftKey")
  && component.includes("event.preventDefault()"), "Enter submission, Shift+Enter, or IME behavior is incomplete.");
assert(manager.includes("recordBestEffort") && manager.includes("isOwnerVisibleSlowTool")
  && manager.includes("id: toolEventId") && manager.includes("Owner activity is telemetry only"), "Slow opening spans are not best-effort or do not preserve terminal identity.");
assert(discussionBrief.includes("Speak in owner-facing page and section terms.")
  && discussionBrief.includes("raw run telemetry"), "Ordinary Ask is not guided toward owner-facing language.");
assert(tokens.includes("--product-shadow-command-dock") && tokens.includes("--product-radius-lg: 20px"), "Command dock tokens are incomplete.");
assert(css.includes("width: var(--product-control-height-compact)") && css.includes("@keyframes site-agent-mode-menu-in")
  && css.includes(".site-agent-activity-dot.is-running") && css.includes("min-height: var(--product-control-height-touch)"), "Composer and activity responsive/motion styling is incomplete.");
assert(documentation.includes("strict allow-list boundary") && documentation.includes("Free-form Ask")
  && documentation.includes("Preview is the evidence surface") && documentation.includes("single canonical"), "The lean owner-chat boundary decision is not canonicalized.");

console.log("Owner chat verification passed.");

function runFixture(input: { status?: SiteAgentRun["status"] } = {}) {
  const status = input.status ?? "running";
  const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
  return siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: "owner-run",
    sessionId: "owner-session",
    siteId: "owner-site",
    publicBuildInputId: "owner-input",
    origin: "owner_request",
    executionDriver: "responses_api",
    requestedBy: "owner",
    publishAfterSuccess: false,
    kind: "edit",
    status,
    stage: status === "succeeded" ? "candidate_ready" : status === "failed" || status === "cancelled" ? "failed" : "authoring",
    apiProvider: "openai",
    modelId: "test-model",
    executionNumber: 1,
    skillVersions: {},
    guardrails: {
      deadlineAt: "2026-07-25T01:00:00.000Z",
      maxCostUsd: 20,
      maxConsecutiveIdenticalFailures: 3
    },
    usage: {
      kind: "model_reported",
      inputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costSource: "provider_reported",
      upstreamInferenceCostUsd: 0,
      durationMs: terminal ? 10_000 : 0
    },
    failureCode: status === "failed" ? "unknown_internal_failure" : undefined,
    failureCategory: status === "failed" ? "platform" : undefined,
    retryableByOwner: status === "failed",
    failureReason: status === "failed" ? "synthetic internal failure" : undefined,
    startedAt: "2026-07-25T00:00:00.000Z",
    completedAt: terminal ? "2026-07-25T00:00:10.000Z" : undefined
  });
}

function eventFixture(input: {
  id: string;
  sequence: number;
  name: string;
  status: "running" | "succeeded" | "failed";
  kind?: SiteAgentRunEvent["kind"];
}) {
  return siteAgentRunEventSchema.parse({
    schemaVersion: "site-agent-run-event",
    id: input.id,
    runId: "owner-run",
    sequence: input.sequence,
    kind: input.kind ?? "tool_call",
    name: input.name,
    status: input.status,
    summary: {},
    startedAt: new Date(Date.parse("2026-07-25T00:00:00.000Z") + input.sequence * 1000).toISOString(),
    completedAt: input.status === "running"
      ? undefined
      : new Date(Date.parse("2026-07-25T00:00:00.500Z") + input.sequence * 1000).toISOString()
  });
}
