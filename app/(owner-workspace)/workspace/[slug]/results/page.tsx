import Link from "next/link";
import { WorkspaceMetric, WorkspacePageHeader, WorkspaceStatus, humanize } from "@/components/OwnerWorkspaceUI";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { siteCapabilityRepository } from "@/packages/site-capabilities";

export const dynamic = "force-dynamic";

export default async function WorkspaceResultsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/results`);
  const [summary, inquiries, events] = await Promise.all([
    siteCapabilityRepository.analyticsSummary(context.site.id),
    siteCapabilityRepository.listInquiries(context.site.id),
    context.canAccessAdmin ? siteCapabilityRepository.listAnalyticsEvents(context.site.id) : Promise.resolve([])
  ]);
  const leadRate = summary.sessions ? inquiries.length / summary.sessions : 0;
  const comparison = summary.baselineComparison;

  return (
    <main className="workspace-page workspace-results-page">
      <WorkspacePageHeader eyebrow="Results · Since launch" title="Website results" description="A practical view of attention, customer actions, and where the website is doing its best work." actions={<Link className="button secondary" href={`/workspace/${slug}/website`}>Review website</Link>} />

      <section className="workspace-metric-grid" aria-label="Website performance">
        <WorkspaceMetric label="Sessions" value={summary.sessions} detail={`${summary.pageviews} page view${summary.pageviews === 1 ? "" : "s"}`} />
        <WorkspaceMetric label="Primary actions" value={summary.primaryActions} detail={`${summary.telClicks} calls · ${summary.formSubmits} forms`} tone={summary.primaryActions ? "positive" : "default"} />
        <WorkspaceMetric label="Leads" value={inquiries.length} detail={`${Math.round(leadRate * 100)}% of tracked sessions`} />
        <WorkspaceMetric label="Action rate" value={`${Math.round(summary.actionRate * 100)}%`} detail="Sessions with a customer action" />
      </section>

      {comparison.status === "ready" ? (
        <section className="workspace-results-comparison">
          <div><span>Current period</span><strong>{comparison.current.sessions}</strong><small>sessions</small></div>
          <div><span>Customer actions</span><strong>{comparison.current.primaryActions}</strong><small>{signed(comparison.delta.primaryActions)} from baseline</small></div>
          <div><span>Action rate</span><strong>{Math.round(comparison.current.actionRate * 100)}%</strong><small>{signed(Math.round(comparison.delta.actionRate * 100))}% from baseline</small></div>
          <WorkspaceStatus tone={comparison.delta.actionRate >= 0 ? "success" : "attention"}>{comparison.delta.actionRate >= 0 ? "Improving" : "Worth watching"}</WorkspaceStatus>
        </section>
      ) : <section className="workspace-collecting"><span /><div><strong>Building a useful comparison</strong><p>Lodesta is collecting enough visits and actions to compare the current website with its baseline.</p></div></section>}

      <div className="workspace-results-grid">
        <section className="workspace-panel">
          <div className="workspace-panel-heading"><div><span>Acquisition</span><h2>Where visits come from</h2></div></div>
          <div className="workspace-bar-list">{summary.outcomesBySource.slice(0, 6).map((row) => <ResultBar key={row.key} label={row.label} value={row.sessions} detail={`${row.primaryActions} actions`} max={Math.max(summary.sessions, 1)} />)}{!summary.outcomesBySource.length ? <EmptyResults /> : null}</div>
        </section>
        <section className="workspace-panel">
          <div className="workspace-panel-heading"><div><span>Content</span><h2>Pages creating action</h2></div></div>
          <div className="workspace-result-table">{summary.outcomesByPage.slice(0, 6).map((row) => <div key={row.key}><span><strong>{pageLabel(row.label)}</strong><small>{row.sessions} sessions</small></span><span><strong>{row.primaryActions}</strong><small>{Math.round(row.actionRate * 100)}% rate</small></span></div>)}{!summary.outcomesByPage.length ? <EmptyResults /> : null}</div>
        </section>
      </div>

      <section className="workspace-panel workspace-results-signals">
        <div className="workspace-panel-heading"><div><span>Evidence</span><h2>What the signals say</h2></div><small>Based on Lodesta’s website standard</small></div>
        <div>{summary.standardCorrelations.slice(0, 6).map((signal) => <article key={signal.criterionId}><WorkspaceStatus tone={signalTone(signal.signal)}>{humanize(signal.signal)}</WorkspaceStatus><div><strong>{signal.title}</strong><p>{signal.insight}</p></div><span>{Math.round(signal.rate * 100)}%</span></article>)}{!summary.standardCorrelations.length ? <EmptyResults /> : null}</div>
      </section>

      {context.canAccessAdmin ? (
        <details className="workspace-advanced-results">
          <summary>Advanced telemetry <span>Admin only</span></summary>
          <div>
            <section className="workspace-panel"><h2>Collection health</h2><dl><div><dt>Events</dt><dd>{summary.events}</dd></div><div><dt>Agent-readable requests</dt><dd>{summary.agentReadableRequests}</dd></div><div><dt>Average engagement</dt><dd>{summary.avgEngagedSeconds}s</dd></div><div><dt>Average scroll depth</dt><dd>{summary.avgScrollDepth}%</dd></div><div><dt>Raw events loaded</dt><dd>{events.length}</dd></div></dl></section>
            <section className="workspace-panel"><h2>Recent web vitals</h2><div className="workspace-result-table">{summary.webVitals.slice(-8).reverse().map((vital, index) => <div key={`${vital.timestamp}:${index}`}><span><strong>{String(vital.metric ?? "Metric")}</strong><small>{new Date(vital.timestamp).toLocaleString()}</small></span><strong>{vital.value ?? "n/a"}</strong></div>)}{!summary.webVitals.length ? <EmptyResults /> : null}</div></section>
            <section className="workspace-panel"><h2>Agent-readable resources</h2><div className="workspace-result-table">{summary.agentReadableByResource.map((row) => <div key={row.key}><span><strong>{row.label}</strong><small>{row.sessions} sessions</small></span><strong>{row.requests}</strong></div>)}{!summary.agentReadableByResource.length ? <EmptyResults /> : null}</div></section>
            <section className="workspace-panel"><h2>Click diagnostics</h2><div className="workspace-result-table">{summary.clickMap.slice(0, 10).map((point) => <div key={point.key}><span><strong>{point.label}</strong><small>{point.deviceType ?? "unknown device"} · {point.pageId ?? "unknown page"}</small></span><strong>{point.count}</strong></div>)}{!summary.clickMap.length ? <EmptyResults /> : null}</div></section>
          </div>
        </details>
      ) : null}
    </main>
  );
}

function ResultBar({ label, value, detail, max }: { label: string; value: number; detail: string; max: number }) { return <div><span><strong>{label}</strong><small>{detail}</small></span><span className="workspace-result-bar"><i style={{ width: `${Math.max(3, Math.round(value / max * 100))}%` }} /></span><strong>{value}</strong></div>; }
function EmptyResults() { return <div className="workspace-empty-state"><strong>Still collecting</strong><p>This section will fill in as people use the website.</p></div>; }
function signed(value: number) { return value > 0 ? `+${value}` : String(value); }
function pageLabel(value: string) { return value === "unknown" || value === "/" ? "Homepage" : value.replace(/^\//, "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function signalTone(signal: string): "neutral" | "success" | "attention" | "danger" | "info" { if (signal === "positive") return "success"; if (signal === "weak") return "danger"; if (signal === "watch") return "attention"; return "info"; }
