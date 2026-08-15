"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  adminFailureGuidance,
  adminRunInspectorViews,
  isAdminRunInspectorView,
  isMeteredModelEvent,
  mergeAdminRunEvents,
  resolveAdminRunEvent,
  type AdminRunInspectorView
} from "@/lib/admin-run-telemetry";
import type { SiteAgentRun, SiteAgentRunEvent } from "@/packages/site-contracts";
import { humanize, statusTone } from "@/lib/product-format";

type InspectorView = AdminRunInspectorView;
type PayloadState =
  | { state: "loading" }
  | { state: "available"; payload: unknown }
  | { state: "expired" }
  | { state: "integrity_error" }
  | { state: "error"; message: string };

export function RunTelemetryInspector({
  initialRun,
  initialEvents,
  siteSlug
}: {
  initialRun: SiteAgentRun;
  initialEvents: SiteAgentRunEvent[];
  siteSlug?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState(() => [...initialEvents].sort((left, right) => left.sequence - right.sequence));
  const [payloads, setPayloads] = useState<Record<string, PayloadState>>({});
  const [copied, setCopied] = useState<string>();
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(searchParams.get("event")));
  const [liveIssue, setLiveIssue] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [payloadRequestVersion, setPayloadRequestVersion] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const payloadsRef = useRef<Record<string, PayloadState>>({});
  const requestedEventId = searchParams.get("event");
  const requestedView = searchParams.get("view");
  const view: InspectorView = isAdminRunInspectorView(requestedView) ? requestedView : "detail";
  const selected = useMemo(
    () => resolveAdminRunEvent(events, run.status, requestedEventId),
    [events, requestedEventId, run.status]
  );
  const selectedPayload = selected ? payloads[selected.id] : undefined;

  const replaceInspectorState = useCallback((eventId: string | undefined, nextView: InspectorView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (eventId) params.set("event", eventId);
    else params.delete("event");
    if (nextView === "detail") params.delete("view");
    else params.set("view", nextView);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!selected) return;
    if (requestedEventId !== selected.id || requestedView && !isAdminRunInspectorView(requestedView)) {
      replaceInspectorState(selected.id, view);
    }
  }, [replaceInspectorState, requestedEventId, requestedView, selected, view]);

  useEffect(() => {
    if (!selected?.payloadRef || payloadsRef.current[selected.id]) return;
    const eventId = selected.id;
    const loading: PayloadState = { state: "loading" };
    payloadsRef.current[eventId] = loading;
    setPayloads((current) => ({ ...current, [eventId]: loading }));
    fetch(`/api/admin/runs/${encodeURIComponent(run.id)}/events/${encodeURIComponent(eventId)}/payload`)
      .then(async (response) => {
        const payload = await response.json() as { state?: PayloadState["state"]; payload?: unknown; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Payload request failed (${response.status}).`);
        if (payload.state === "expired" || payload.state === "integrity_error") return { state: payload.state } as PayloadState;
        return { state: "available", payload: payload.payload } as PayloadState;
      })
      .then((payload) => {
        payloadsRef.current[eventId] = payload;
        setPayloads((current) => ({ ...current, [eventId]: payload }));
      })
      .catch((cause: unknown) => {
        const error: PayloadState = { state: "error", message: cause instanceof Error ? cause.message : "Payload request failed." };
        delete payloadsRef.current[eventId];
        setPayloads((current) => ({ ...current, [eventId]: error }));
      });
  }, [payloadRequestVersion, run.id, selected?.id, selected?.payloadRef]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const eventParams = new URLSearchParams({ limit: "500" });
      const [runResponse, eventResponse] = await Promise.all([
        fetch(`/api/admin/runs/${encodeURIComponent(run.id)}`, { cache: "no-store" }),
        fetch(`/api/admin/runs/${encodeURIComponent(run.id)}/events?${eventParams}`, { cache: "no-store" })
      ]);
      if (!runResponse.ok) throw new Error(`Run refresh failed (${runResponse.status}).`);
      if (!eventResponse.ok) throw new Error(`Event refresh failed (${eventResponse.status}).`);
      const runPayload = await runResponse.json() as { run: SiteAgentRun };
      const eventPayload = await eventResponse.json() as { events: SiteAgentRunEvent[] };
      setRun(runPayload.run);
      if (eventPayload.events.length) {
        setEvents((current) => {
          return mergeAdminRunEvents(current, eventPayload.events);
        });
      }
      setLiveIssue(undefined);
    } catch (cause) {
      setLiveIssue(cause instanceof Error ? cause.message : "Live telemetry refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, run.id]);

  useEffect(() => {
    if (!["queued", "running"].includes(run.status)) return;
    const tick = () => {
      if (!document.hidden) void refresh();
    };
    const interval = window.setInterval(tick, 5000);
    const handleVisibility = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh, run.status]);

  function selectEvent(eventId: string, nextView: InspectorView = view) {
    setMobileDetailOpen(true);
    replaceInspectorState(eventId, nextView);
  }

  function selectView(nextView: InspectorView) {
    replaceInspectorState(selected?.id, nextView);
  }

  function retrySelectedPayload() {
    if (!selected) return;
    delete payloadsRef.current[selected.id];
    setPayloads((current) => {
      const next = { ...current };
      delete next[selected.id];
      return next;
    });
    setPayloadRequestVersion((current) => current + 1);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? adminRunInspectorViews.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + adminRunInspectorViews.length) % adminRunInspectorViews.length;
    tabRefs.current[nextIndex]?.focus();
    selectView(adminRunInspectorViews[nextIndex]);
  }

  async function copyValue(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? undefined : current), 1600);
    } catch {
      setCopied(undefined);
    }
  }

  const contactSheets = (run.screenshotKeys ?? []).filter((key) => key.endsWith("/contact-sheet.png"));
  const modelUsage = run.usage;
  const sourceRetrievals = events.filter((event) => ["search_sources", "read_source_page", "list_source_pages"].includes(event.name)).length;
  const webResearches = events.filter((event) => event.name === "search_public_web").length;

  return <section className="run-inspector" data-mobile-detail={mobileDetailOpen ? "true" : undefined}>
    <div className="run-inspector-summary" aria-label="Run summary">
      <SummaryFact label="Status"><span className={`badge is-${statusTone(run.status)}`}>{humanize(run.status)}</span></SummaryFact>
      <SummaryFact label="Stage" value={humanize(run.stage)} />
      <SummaryFact label="Execution" value={String(run.executionNumber)} />
      <SummaryFact label="Sandbox deployment" value={run.sandboxDeploymentId ?? "Not pinned"} />
      <SummaryFact label="Resume checkpoint" value={run.resumeCheckpointId ?? "None"} />
      <SummaryFact label="Model" value={run.modelId} />
      <SummaryFact label="Route" value={run.apiProvider} />
      <SummaryFact label="Tokens" value={(modelUsage.inputTokens + modelUsage.outputTokens).toLocaleString()} />
      <SummaryFact label={`Cost · ${humanize(modelUsage.costSource)}`} value={modelUsage.costSource !== "unavailable" ? `$${modelUsage.costUsd.toFixed(4)}` : "Unavailable"} />
      <SummaryFact label="Duration" value={formatDuration(run.usage.durationMs)} />
      <SummaryFact label="Source retrievals" value={sourceRetrievals.toLocaleString()} />
      <SummaryFact label="Web research" value={webResearches.toLocaleString()} />
      {["queued", "running"].includes(run.status) ? <span className="run-inspector-live"><span />{refreshing ? "Updating" : "Live"}</span> : null}
    </div>

    {liveIssue ? <div className="run-inspector-live-notice" role="status"><span>Showing the last successful snapshot. {liveIssue}</span><AdminButton type="button" size="sm" onClick={() => void refresh()}>Retry</AdminButton></div> : null}

    <div className="run-inspector-workspace">
      <aside className="run-event-rail" aria-label="Run events">
        <header><div><span>Trace</span><h2>Run events</h2></div><strong>{events.length}</strong></header>
        <div className="run-event-list">
          {events.map((event, index) => <button
            type="button"
            className={selected?.id === event.id ? "is-selected" : undefined}
            aria-current={selected?.id === event.id ? "true" : undefined}
            key={event.id}
            onClick={() => selectEvent(event.id)}
            onKeyDown={(keyboardEvent) => handleEventKeyDown(keyboardEvent, index)}
          >
            <span className="run-event-row-top">
              <span className={`run-event-kind run-event-kind-${event.kind}`}>{eventKindLabel(event.kind)}</span>
              {event.status === "failed" ? <span className="run-event-error">Failed</span> : null}
              <strong>{event.name.replaceAll("_", " ")}</strong>
              <time>{event.completedAt ? durationBetween(event.startedAt, event.completedAt) : "Running"}</time>
            </span>
            <span className="run-event-row-meta">
              <span>#{event.sequence}{event.turnIndex ? ` · Turn ${event.turnIndex}` : ""}</span>
              {event.inputTokens !== undefined ? <span>{event.inputTokens.toLocaleString()} → {(event.outputTokens ?? 0).toLocaleString()}</span> : null}
              {event.costUsd !== undefined && event.costSource !== "unavailable" ? <span>${event.costUsd.toFixed(4)}</span> : null}
            </span>
          </button>)}
          {!events.length ? <div className="run-event-empty"><strong>No events recorded</strong><p>The run exists, but no trace events are available.</p></div> : null}
        </div>
      </aside>

      <section className="run-inspector-detail">
        <button className="run-inspector-mobile-back" type="button" onClick={() => setMobileDetailOpen(false)}>← Events</button>
        <div className="run-inspector-tabs" role="tablist" aria-label="Telemetry view">
          {adminRunInspectorViews.map((tab, index) => <button
            type="button"
            role="tab"
            id={`run-tab-${tab}`}
            aria-selected={view === tab}
            aria-controls={`run-panel-${tab}`}
            tabIndex={view === tab ? 0 : -1}
            ref={(node) => { tabRefs.current[index] = node; }}
            key={tab}
            onClick={() => selectView(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >{humanize(tab)}</button>)}
        </div>
        <div
          className="run-inspector-panel"
          role="tabpanel"
          id={`run-panel-${view}`}
          aria-labelledby={`run-tab-${view}`}
          tabIndex={0}
        >
          {view === "detail" ? <DetailView event={selected} payload={selectedPayload} retryPayload={retrySelectedPayload} copyValue={copyValue} copied={copied} /> : null}
          {view === "log" ? <LogView events={events} selectedId={selected?.id} selectEvent={selectEvent} copyValue={copyValue} copied={copied} /> : null}
          {view === "outputs" ? <OutputsView event={selected} payload={selectedPayload} retryPayload={retrySelectedPayload} copyValue={copyValue} copied={copied} /> : null}
          {view === "verification" ? <VerificationView run={run} events={events} contactSheets={contactSheets} selectEvent={selectEvent} /> : null}
          {view === "run" ? <RunView run={run} events={events} siteSlug={siteSlug} copyValue={copyValue} copied={copied} /> : null}
        </div>
      </section>
    </div>
    <span className="sr-only" aria-live="polite">{copied ? "Copied to clipboard" : ""}</span>
  </section>;
}

function DetailView({ event, payload, retryPayload, copyValue, copied }: DiagnosticViewProps) {
  if (!event) return <InspectorEmpty title="No event selected" body="Select a trace event to inspect its diagnostics." />;
  const parts = payloadParts(payload);
  return <div className="run-diagnostic-view">
    <DiagnosticHeader event={event} copyValue={copyValue} copied={copied} />
    <FactGrid>
      <Fact label="Kind" value={humanize(event.kind)} />
      <Fact label="Status" value={humanize(event.status)} />
      <Fact label="Started" value={formatDate(event.startedAt)} />
      <Fact label="Duration" value={event.completedAt ? durationBetween(event.startedAt, event.completedAt) : "Running"} />
      <Fact label="Route" value={event.apiProvider ?? "—"} />
      <Fact label="Requested model" value={event.modelId ?? "—"} />
      <Fact label="Served model" value={event.servedModelId ?? "—"} />
      <Fact label="Error code" value={event.errorCode ?? "None"} tone={event.errorCode ? "danger" : undefined} />
    </FactGrid>
    {event.inputTokens !== undefined ? <section className="run-usage-inline">
      <Fact label="Input" value={event.inputTokens.toLocaleString()} />
      <Fact label="Cached" value={(event.cachedInputTokens ?? 0).toLocaleString()} />
      <Fact label="Reasoning" value={(event.reasoningTokens ?? 0).toLocaleString()} />
      <Fact label="Output" value={(event.outputTokens ?? 0).toLocaleString()} />
      <Fact label="Cost" value={event.costSource !== "unavailable" ? `$${(event.costUsd ?? 0).toFixed(4)}` : "Unavailable"} />
    </section> : null}
    <JsonSection title="Summary" value={event.summary} copyKey={`${event.id}-summary`} copyValue={copyValue} copied={copied} />
    {payloadNotice(payload, retryPayload)}
    {parts.input !== undefined ? <JsonSection title="Input" value={parts.input} copyKey={`${event.id}-input`} copyValue={copyValue} copied={copied} /> : null}
    {parts.metadata !== undefined ? <JsonSection title="Metadata" value={parts.metadata} copyKey={`${event.id}-metadata`} copyValue={copyValue} copied={copied} collapsed /> : null}
  </div>;
}

function OutputsView({ event, payload, retryPayload, copyValue, copied }: DiagnosticViewProps) {
  if (!event) return <InspectorEmpty title="No event selected" body="Select an event to inspect its output." />;
  const output = payloadParts(payload).output;
  return <div className="run-diagnostic-view">
    <DiagnosticHeader event={event} copyValue={copyValue} copied={copied} />
    {event.errorCode ? <div className="run-output-error"><span>Event error</span><strong>{event.errorCode}</strong></div> : null}
    {payloadNotice(payload, retryPayload)}
    {output !== undefined
      ? <JsonSection title="Event output" value={output} copyKey={`${event.id}-output`} copyValue={copyValue} copied={copied} />
      : payload?.state === "available"
        ? <InspectorEmpty title="No output recorded" body="This event has summary telemetry but no output-shaped retained payload." />
        : !event.payloadRef
          ? <InspectorEmpty title="No retained payload" body="This event did not record a detailed output payload." />
          : null}
  </div>;
}

function LogView({
  events,
  selectedId,
  selectEvent,
  copyValue,
  copied
}: {
  events: SiteAgentRunEvent[];
  selectedId?: string;
  selectEvent: (eventId: string, view?: InspectorView) => void;
  copyValue: (value: string, key: string) => Promise<void>;
  copied?: string;
}) {
  const text = events.map(logLine).join("\n");
  return <div className="run-log-view">
    <div className="run-panel-heading"><div><span>Chronological transcript</span><h3>Run log</h3></div><CopyButton value={text} copyKey="run-log" copyValue={copyValue} copied={copied} label="Copy all" /></div>
    <div className="run-log-list">
      {events.map((event) => <button type="button" className={event.id === selectedId ? "is-selected" : undefined} key={event.id} onClick={() => selectEvent(event.id, "detail")}>
        <time>{new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(event.startedAt))}</time>
        <span className={`run-event-kind run-event-kind-${event.kind}`}>{eventKindLabel(event.kind)}</span>
        <strong>{event.name.replaceAll("_", " ")}</strong>
        <span className={`run-log-status status-${event.status}`}>{humanize(event.status)}</span>
        <code>{compactSummary(event.summary)}</code>
      </button>)}
      {!events.length ? <InspectorEmpty title="No log entries" body="No run events were recorded." /> : null}
    </div>
  </div>;
}

function VerificationView({
  run,
  events,
  contactSheets,
  selectEvent
}: {
  run: SiteAgentRun;
  events: SiteAgentRunEvent[];
  contactSheets: string[];
  selectEvent: (eventId: string, view?: InspectorView) => void;
}) {
  const inspections = events.filter((event) => event.kind === "inspection");
  return <div className="run-verification-view">
    <div className="run-panel-heading"><div><span>Release evidence</span><h3>Verification</h3></div>{run.candidateVersionId ? <Link className="admin-button admin-button-primary admin-button-sm" href={`/api/site-versions/${run.candidateVersionId}/artifact/`}>Open candidate</Link> : null}</div>
    {inspections.length ? <section className="run-verification-events"><h4>Inspection events</h4>{inspections.map((event) => <button type="button" key={event.id} onClick={() => selectEvent(event.id, "detail")}>
      <span className={`badge is-${statusTone(event.status)}`}>{humanize(event.status)}</span><div><strong>{event.name.replaceAll("_", " ")}</strong><p>{compactSummary(event.summary)}</p></div>
    </button>)}</section> : null}
    {contactSheets.length ? <section className="run-verification-captures"><h4>Contact sheets</h4><div>{contactSheets.map((key, index) => <figure key={key}><img src={`/api/admin/runs/${run.id}/captures?key=${encodeURIComponent(key)}`} alt={`Run verification contact sheet ${index + 1}`} /><figcaption>{key.split("/").at(-2)?.replaceAll("-", " ") ?? "Verification capture"}</figcaption></figure>)}</div></section> : null}
    {!inspections.length && !contactSheets.length && !run.candidateVersionId ? <InspectorEmpty title="No verification evidence" body="This run has no retained inspection events, contact sheets, or candidate artifact." /> : null}
  </div>;
}

function RunView({
  run,
  events,
  siteSlug,
  copyValue,
  copied
}: {
  run: SiteAgentRun;
  events: SiteAgentRunEvent[];
  siteSlug?: string;
  copyValue: (value: string, key: string) => Promise<void>;
  copied?: string;
}) {
  const meteredEvents = events.filter(isMeteredModelEvent);
  return <div className="run-record-view">
    <div className="run-panel-heading"><div><span>Canonical record</span><h3>Run</h3></div><CopyButton value={JSON.stringify(run, null, 2)} copyKey="run-json" copyValue={copyValue} copied={copied} label="Copy JSON" /></div>
    <section className="run-record-section">
      <h4>Identity and output</h4>
      <dl className="run-record-list">
        <CopyFact label="Run ID" value={run.id} copyValue={copyValue} copied={copied} />
        <CopyFact label="Session ID" value={run.sessionId} copyValue={copyValue} copied={copied} />
        <FactRow label="Site" value={siteSlug ?? run.siteId} />
        <CopyFact label="Site ID" value={run.siteId} copyValue={copyValue} copied={copied} />
        <FactRow label="API provider" value={run.apiProvider} />
        <FactRow label="Requested model" value={run.modelId} />
        <CopyFact label="Parent revision" value={run.exactParentRevisionId ?? "Initial"} copyValue={copyValue} copied={copied} />
        <CopyFact label="Output revision" value={run.outputRevisionId ?? "None"} copyValue={copyValue} copied={copied} />
        <CopyFact label="Artifact" value={run.outputArtifactId ?? "None"} copyValue={copyValue} copied={copied} />
        <CopyFact label="Candidate" value={run.candidateVersionId ?? "None"} copyValue={copyValue} copied={copied} />
      </dl>
    </section>
    <section className="run-record-section">
      <h4>Failure and recovery</h4>
      <dl className="run-record-list">
        <FactRow label="Failure category" value={run.failureCategory ? humanize(run.failureCategory) : "None"} />
        <FactRow label="Failure code" value={run.failureCode ? humanize(run.failureCode) : "None"} tone={run.failureCode ? "danger" : undefined} />
        <FactRow label="Owner retry" value={run.retryableByOwner ? "Allowed" : "Not allowed"} />
        <FactRow label="Failure diagnostic" value={run.failureReason ?? "None"} tone={run.failureReason ? "danger" : undefined} />
        <FactRow label="Recovery" value={adminFailureGuidance(run.failureCode)} />
      </dl>
    </section>
    <section className="run-record-section">
      <h4>Guardrails</h4>
      <dl className="run-record-list">
        <FactRow label="Cost fuse" value={run.guardrails ? `$${run.guardrails.maxCostUsd.toFixed(2)}` : "External execution contract"} />
        <FactRow label="Absolute deadline" value={run.guardrails ? formatDate(run.guardrails.deadlineAt) : "External execution contract"} />
        <FactRow label="Identical failure limit" value={String(run.guardrails?.maxConsecutiveIdenticalFailures ?? "External execution contract")} />
      </dl>
    </section>
    <section className="run-record-section">
      <h4>Metered model usage by request</h4>
      {meteredEvents.length ? <div className="run-metering-table"><table><thead><tr><th>Turn</th><th>Route / model</th><th>Tokens</th><th>Cost</th><th>Duration</th></tr></thead><tbody>{meteredEvents.map((event) => <tr key={event.id}>
        <td>{event.turnIndex ?? "—"}</td>
        <td>{event.apiProvider ?? "—"} · {event.modelId ?? event.name}<small>{event.servedModelId && event.servedModelId !== event.modelId ? `Served ${event.servedModelId}` : event.upstreamProvider ?? ""}</small></td>
        <td>{(event.inputTokens ?? 0).toLocaleString()} in · {(event.outputTokens ?? 0).toLocaleString()} out<small>{(event.cachedInputTokens ?? 0).toLocaleString()} cached · {(event.reasoningTokens ?? 0).toLocaleString()} reasoning</small></td>
        <td>{event.costSource && event.costSource !== "unavailable" ? `$${(event.costUsd ?? 0).toFixed(4)}` : "—"}<small>{event.costSource ? humanize(event.costSource) : ""}</small></td>
        <td>{event.modelDurationMs !== undefined ? formatDuration(event.modelDurationMs) : event.completedAt ? durationBetween(event.startedAt, event.completedAt) : "Running"}</td>
      </tr>)}</tbody></table></div> : <InspectorEmpty title="No metered requests" body="This run did not record request-level model or image-generation metering." />}
    </section>
    <JsonSection title="Raw run JSON" value={run} copyKey="run-json-raw" copyValue={copyValue} copied={copied} collapsed />
  </div>;
}

function DiagnosticHeader({ event, copyValue, copied }: { event: SiteAgentRunEvent; copyValue: DiagnosticViewProps["copyValue"]; copied?: string }) {
  return <div className="run-diagnostic-header"><div><span>{eventKindLabel(event.kind)} · sequence {event.sequence}</span><h3>{event.name.replaceAll("_", " ")}</h3><code>{event.id}</code></div><CopyButton value={event.id} copyKey={`${event.id}-id`} copyValue={copyValue} copied={copied} label="Copy event ID" /></div>;
}

function SummaryFact({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return <div><span>{label}</span>{children ?? <strong title={value}>{value}</strong>}</div>;
}

function FactGrid({ children }: { children: ReactNode }) {
  return <dl className="run-fact-grid">{children}</dl>;
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return <div><dt>{label}</dt><dd className={tone === "danger" ? "error-text" : undefined}>{value}</dd></div>;
}

function FactRow({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return <div><dt>{label}</dt><dd className={tone === "danger" ? "error-text" : undefined}>{value}</dd></div>;
}

function CopyFact({ label, value, copyValue, copied }: { label: string; value: string; copyValue: DiagnosticViewProps["copyValue"]; copied?: string }) {
  return <div><dt>{label}</dt><dd><code>{value}</code>{!["None", "Initial"].includes(value) ? <CopyButton value={value} copyKey={`fact-${label}-${value}`} copyValue={copyValue} copied={copied} label="Copy" /> : null}</dd></div>;
}

function JsonSection({
  title,
  value,
  copyKey,
  copyValue,
  copied,
  collapsed = false
}: {
  title: string;
  value: unknown;
  copyKey: string;
  copyValue: DiagnosticViewProps["copyValue"];
  copied?: string;
  collapsed?: boolean;
}) {
  const json = JSON.stringify(value, null, 2);
  return <details className="run-json-section" open={!collapsed}><summary><span>{title}</span><span>JSON</span></summary><div><CopyButton value={json} copyKey={copyKey} copyValue={copyValue} copied={copied} label="Copy JSON" /><pre>{json}</pre></div></details>;
}

function CopyButton({
  value,
  copyKey,
  copyValue,
  copied,
  label
}: {
  value: string;
  copyKey: string;
  copyValue: DiagnosticViewProps["copyValue"];
  copied?: string;
  label: string;
}) {
  return <button className="run-copy-button" type="button" onClick={() => void copyValue(value, copyKey)}>{copied === copyKey ? "Copied" : label}</button>;
}

function InspectorEmpty({ title, body }: { title: string; body: string }) {
  return <div className="run-inspector-empty"><strong>{title}</strong><p>{body}</p></div>;
}

function payloadNotice(payload: PayloadState | undefined, retryPayload: () => void) {
  if (!payload || payload.state === "available") return null;
  if (payload.state === "loading") return <div className="run-payload-notice" role="status">Loading retained payload…</div>;
  if (payload.state === "expired") return <div className="run-payload-notice is-warning">The retained payload has expired. Summary telemetry remains available.</div>;
  if (payload.state === "integrity_error") return <div className="run-payload-notice is-danger">The retained payload failed its content-hash check and was not displayed.</div>;
  return <div className="run-payload-notice is-danger" role="alert"><span>{payload.message}</span><AdminButton type="button" size="sm" onClick={retryPayload}>Retry</AdminButton></div>;
}

function payloadParts(payload: PayloadState | undefined) {
  if (payload?.state !== "available") return {};
  const source = record(payload.payload);
  if (!source) return {};
  const inputKeys = ["request", "arguments", "input"];
  const outputKeys = ["response", "output", "modelResult", "diagnosticResult", "findings"];
  const input = pick(source, inputKeys);
  const output = pick(source, outputKeys);
  const metadata = pick(source, Object.keys(source).filter((key) => !inputKeys.includes(key) && !outputKeys.includes(key)));
  return {
    input: Object.keys(input).length ? input : undefined,
    output: Object.keys(output).length ? output : undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined
  };
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function handleEventKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(":scope > button") ?? []);
  if (!buttons.length) return;
  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
}

function eventKindLabel(kind: SiteAgentRunEvent["kind"]) {
  return ({ run: "Run", turn: "Turn", model_request: "Model", tool_call: "Tool", build: "Build", inspection: "Inspect" } as const)[kind];
}


function formatDuration(value: number) {
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round(value % 60_000 / 1000)}s`;
}

function durationBetween(start: string, end: string) {
  return formatDuration(Math.max(0, Date.parse(end) - Date.parse(start)));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function compactSummary(value: Record<string, unknown>) {
  const text = Object.entries(value).map(([key, item]) => `${humanize(key)}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ");
  return text || "No summary";
}

function logLine(event: SiteAgentRunEvent) {
  return `${event.startedAt}  #${event.sequence}  ${event.kind}  ${event.status}  ${event.name}  ${JSON.stringify(event.summary)}`;
}

type DiagnosticViewProps = {
  event?: SiteAgentRunEvent;
  payload?: PayloadState;
  retryPayload: () => void;
  copyValue: (value: string, key: string) => Promise<void>;
  copied?: string;
};
