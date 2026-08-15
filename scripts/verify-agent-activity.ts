import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAdminRunQuery } from "@/lib/admin-run-query";
import {
  adminFailureGuidance,
  isAdminRunInspectorView,
  mergeAdminRunEvents,
  resolveAdminRunEvent
} from "@/lib/admin-run-telemetry";
import { LocalSitePlatformRepository } from "@/packages/platform-data";
import { siteAgentRunEventSchema, siteAgentRunSchema, type SiteAgentRun } from "@/packages/site-contracts";

const directory = await mkdtemp(join(tmpdir(), "lodesta-agent-activity-"));
try {
  const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
  await Promise.all([
    repository.saveAgentRun(runFixture({ id: "run-alpha", siteId: "site-one", status: "succeeded", startedAt: "2026-07-01T10:00:00.000Z", modelId: "gpt-alpha", costUsd: 1.25, durationMs: 30_000 })),
    repository.saveAgentRun(runFixture({ id: "run-beta", siteId: "site-one", status: "failed", startedAt: "2026-07-02T10:00:00.000Z", modelId: "gpt-beta", costUsd: 8.5, durationMs: 90_000, failureCode: "authoring_stalled" })),
    repository.saveAgentRun(runFixture({ id: "run-gamma", siteId: "site-two", status: "cancelled", startedAt: "2026-07-03T10:00:00.000Z", modelId: "gpt-gamma", costUsd: 3.75, durationMs: 45_000 }))
  ]);

  const newest = await repository.listAgentRunAdminPage({ limit: 25 });
  assert.equal(newest.total, 3);
  assert.deepEqual(newest.items.map((item) => item.id), ["run-gamma", "run-beta", "run-alpha"]);

  const filtered = await repository.listAgentRunAdminPage({
    statuses: ["failed", "cancelled"],
    startedAfter: "2026-07-02T00:00:00.000Z",
    startedBefore: "2026-07-03T23:59:59.999Z",
    limit: 25
  });
  assert.deepEqual(filtered.items.map((item) => item.id), ["run-gamma", "run-beta"]);

  const searched = await repository.listAgentRunAdminPage({ search: "gpt-beta", limit: 25 });
  assert.deepEqual(searched.items.map((item) => item.id), ["run-beta"]);
  assert.deepEqual((await repository.listAgentRunAdminPage({ search: "site-two", limit: 25 })).items.map((item) => item.id), ["run-gamma"]);
  assert.deepEqual((await repository.listAgentRunAdminPage({ search: "openai", limit: 25 })).items.map((item) => item.id), ["run-gamma", "run-beta", "run-alpha"]);
  assert.deepEqual((await repository.listAgentRunAdminPage({ search: "edit", limit: 25 })).items.map((item) => item.id), ["run-gamma", "run-beta", "run-alpha"]);
  assert.deepEqual((await repository.listAgentRunAdminPage({ search: "authoring_stalled", limit: 25 })).items.map((item) => item.id), ["run-beta"]);

  const site = await repository.listAgentRunAdminPage({ siteId: "site-one", sort: "oldest", limit: 25 });
  assert.deepEqual(site.items.map((item) => item.id), ["run-alpha", "run-beta"]);

  const highestCost = await repository.listAgentRunAdminPage({ sort: "highest_cost", limit: 25 });
  assert.deepEqual(highestCost.items.map((item) => item.id), ["run-beta", "run-gamma", "run-alpha"]);

  const lowestCost = await repository.listAgentRunAdminPage({ sort: "lowest_cost", limit: 25 });
  assert.deepEqual(lowestCost.items.map((item) => item.id), ["run-alpha", "run-gamma", "run-beta"]);

  const longest = await repository.listAgentRunAdminPage({ sort: "longest_duration", offset: 1, limit: 25 });
  assert.deepEqual(longest.items.map((item) => item.id), ["run-gamma", "run-alpha"]);

  const paged = await repository.listAgentRunAdminPage({ limit: 1, offset: 1 });
  assert.equal(paged.total, 3);
  assert.deepEqual(paged.items.map((item) => item.id), ["run-beta"]);

  assert.equal(parseAdminRunQuery(new URLSearchParams("status=failed,cancelled&sort=highest_cost&limit=25&offset=25")).success, true);
  assert.equal(parseAdminRunQuery(new URLSearchParams("range=7d")).success, true);
  assert.equal(parseAdminRunQuery(new URLSearchParams("limit=100")).success, true);
  assert.equal(parseAdminRunQuery(new URLSearchParams("status=unknown")).success, false);
  assert.equal(parseAdminRunQuery(new URLSearchParams("sort=expensive")).success, false);
  assert.equal(parseAdminRunQuery(new URLSearchParams("from=yesterday")).success, false);
  assert.equal(parseAdminRunQuery(new URLSearchParams("offset=-1")).success, false);
  assert.equal(parseAdminRunQuery(new URLSearchParams("range=7d&from=2026-07-01T00%3A00%3A00.000Z")).success, false);
  assert.equal(parseAdminRunQuery(new URLSearchParams("limit=30")).success, false);
  assert.equal(parseAdminRunQuery(new URLSearchParams("from=2026-07-03T00%3A00%3A00.000Z&to=2026-07-02T00%3A00%3A00.000Z")).success, false);

  const initialEvent = eventFixture({ id: "event-one", sequence: 1, status: "running" });
  const failedEvent = eventFixture({ id: "event-two", sequence: 2, status: "failed" });
  const updatedEvent = eventFixture({ id: "event-one", sequence: 1, status: "succeeded" });
  const appendedEvent = eventFixture({ id: "event-three", sequence: 3, status: "succeeded" });
  assert.equal(resolveAdminRunEvent([initialEvent, failedEvent], "failed", "missing")?.id, failedEvent.id);
  assert.equal(resolveAdminRunEvent([initialEvent, failedEvent], "succeeded", "missing")?.id, initialEvent.id);
  assert.equal(resolveAdminRunEvent([initialEvent, failedEvent], "failed", initialEvent.id)?.id, initialEvent.id);
  assert.equal(resolveAdminRunEvent([], "failed", "missing"), undefined);
  assert.equal(isAdminRunInspectorView("verification"), true);
  assert.equal(isAdminRunInspectorView("unknown"), false);
  assert.deepEqual(
    mergeAdminRunEvents([initialEvent, failedEvent], [appendedEvent, updatedEvent]).map((event) => [event.id, event.status]),
    [["event-one", "succeeded"], ["event-two", "failed"], ["event-three", "succeeded"]]
  );
  assert.equal(adminFailureGuidance("authoring_stalled").includes("release diagnostic"), true);
  assert.equal(adminFailureGuidance(undefined), "None");

  const [inventory, inspector, css, migration, payloadRoute, runRoute] = await Promise.all([
    readFile("components/admin/AdminRunInventory.tsx", "utf8"),
    readFile("components/admin/RunTelemetryInspector.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
    readFile("supabase/migrations/202607230017_site_agent_run_admin_inventory.sql", "utf8"),
    readFile("app/api/admin/runs/[runId]/events/[eventId]/payload/route.ts", "utf8"),
    readFile("app/api/admin/runs/[runId]/route.ts", "utf8")
  ]);
  assert(inventory.includes("item.issue") && inventory.includes("No runs found"), "Run inventory does not degrade stale or empty records legibly.");
  const rowLinkMarkup = inventory.match(/<Link\s+className="admin-run-row-link"[\s\S]*?<\/Link>/)?.[0] ?? "";
  assert(rowLinkMarkup && !rowLinkMarkup.includes("<button") && !rowLinkMarkup.includes("<input"), "Inventory row links must not contain nested controls.");
  assert(inventory.includes("<RunIdCopyButton") && inventory.includes("navigator.clipboard.writeText(runId)")
    && inventory.includes('aria-live="polite"'), "Run IDs do not expose an accessible clipboard action.");
  assert(inspector.includes('role="tablist"') && inspector.includes('role="tabpanel"') && inspector.includes('aria-current=')
    && inspector.includes('"ArrowLeft"') && inspector.includes('"ArrowDown"'), "Run inspector selection and tabs are not keyboard-readable.");
  assert(inspector.includes("visibilitychange") && inspector.includes("document.hidden") && inspector.includes("window.setInterval")
    && inspector.includes('["queued", "running"]'), "Active-run polling, hidden-document pausing, or terminal shutdown is missing.");
  assert(inspector.includes("Showing the last successful snapshot") && inspector.includes("Retry"), "Transient polling or payload failures do not preserve usable diagnostics.");
  assert(inspector.includes("expired") && inspector.includes("integrity_error") && inspector.includes("No verification evidence")
    && inspector.includes("No events recorded"), "Payload, verification, or empty-history states are incomplete.");
  assert(inspector.includes("Copied to clipboard") && inspector.includes("Copy all"), "Accessible copy feedback is incomplete.");
  assert(css.includes("@media (min-width: 700px)") && css.includes("data-mobile-detail")
    && css.includes("grid-template-columns: 240px") && css.includes("grid-template-columns: 300px"), "Run inspector responsive drill-in widths are missing.");
  assert(css.includes(".run-inspector-tabs button:focus-visible") && css.includes(".admin-run-row-link:focus-visible")
    && css.includes(".admin-run-id-copy:focus-visible"), "Required focus indicators are missing.");
  assert(migration.includes("security_invoker = true") && migration.includes("revoke all") && migration.includes("grant select")
    && !migration.includes("  runs.run,\n"), "Admin inventory view is not lightweight and service-role scoped.");
  assert(payloadRoute.includes("blob.contentHash !== event.payloadHash") && payloadRoute.includes('state: "expired"')
    && payloadRoute.includes('state: "integrity_error"') && payloadRoute.includes("JSON.parse"), "Retained payload integrity and expiry handling is incomplete.");
  assert(runRoute.includes("getAgentRunAdminRecord") && runRoute.includes("status: 409") && runRoute.includes("stale schema"), "Stale run records must produce a legible 409 admin response.");

  console.log("Agent activity verification passed.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

function runFixture(input: {
  id: string;
  siteId: string;
  status: "succeeded" | "failed" | "cancelled";
  startedAt: string;
  modelId: string;
  costUsd: number;
  durationMs: number;
  failureCode?: SiteAgentRun["failureCode"];
}) {
  return siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: input.id,
    sessionId: `session-${input.id}`,
    siteId: input.siteId,
    publicBuildInputId: `input-${input.id}`,
    request: { kind: "owner_instruction", messageIds: [`message-${input.id}`] },
    origin: "owner_request",
    requestedBy: "operator-test",
    kind: "edit",
    status: input.status,
    stage: input.status === "succeeded" ? "candidate_ready" : "failed",
    apiProvider: "openai",
    modelId: input.modelId,
    executionNumber: 1,
    skillVersions: {},
    guardrails: {
      deadlineAt: "2026-07-10T00:00:00.000Z",
      maxCostUsd: 20,
      maxConsecutiveIdenticalFailures: 3
    },
    usage: {
      inputTokens: 1000,
      cachedInputTokens: 100,
      reasoningTokens: 200,
      outputTokens: 500,
      costUsd: input.costUsd,
      costSource: "provider_reported",
      upstreamInferenceCostUsd: input.costUsd,
      durationMs: input.durationMs
    },
    failureCode: input.failureCode,
    failureCategory: input.failureCode ? "authoring" : undefined,
    retryableByOwner: false,
    failureReason: input.failureCode ? "The same release failure repeated." : undefined,
    startedAt: input.startedAt,
    completedAt: new Date(Date.parse(input.startedAt) + input.durationMs).toISOString()
  });
}

function eventFixture(input: {
  id: string;
  sequence: number;
  status: "running" | "succeeded" | "failed";
}) {
  return siteAgentRunEventSchema.parse({
    schemaVersion: "site-agent-run-event",
    id: input.id,
    runId: "run-alpha",
    sequence: input.sequence,
    kind: "tool_call",
    name: "fixture",
    status: input.status,
    summary: {},
    startedAt: "2026-07-01T10:00:00.000Z",
    completedAt: input.status === "running" ? undefined : "2026-07-01T10:00:01.000Z"
  });
}
