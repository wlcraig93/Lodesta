import Link from "next/link";
import { AnalyticsReportControls, AnalyticsReportNav } from "@/components/AnalyticsReportControls";
import { AnalyticsTrend } from "@/components/AnalyticsTrend";
import { WorkspaceMetric, WorkspacePageHeader, WorkspaceStatus } from "@/components/OwnerWorkspaceUI";
import {
  analyticsQuerySearchParams,
  formatAnalyticsRange,
  parseAnalyticsQuery,
  type AnalyticsUrlQuery
} from "@/lib/analytics-query";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { AnalyticsReport, AnalyticsReportRow } from "@/packages/site-capabilities/contracts";

export default async function WorkspaceAnalyticsPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, requestedQuery] = await Promise.all([params, searchParams]);
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/analytics`);
  const publishedVersion = context.site.publishedVersionId
    ? await sitePlatformRepository.getSiteVersion(context.site.publishedVersionId)
    : undefined;
  const query = parseAnalyticsQuery(requestedQuery, {
    timezone: context.site.reportingTimezone,
    siteCreatedAt: publishedVersion?.publishedAt ?? context.site.createdAt
  });
  const report = await siteCapabilityRepository.analyticsReport(context.site.id, query);
  const queryParams = analyticsQuerySearchParams(query);
  const exportHref = `/api/sites/${context.site.id}/analytics/export?${queryParams.toString()}`;

  return (
    <main className="workspace-page workspace-analytics-page">
      <WorkspacePageHeader
        eyebrow={`Analytics · ${formatAnalyticsRange(query)}`}
        title="Website analytics"
        description="Real visits, the paths that brought them here, and the customer actions they took."
        actions={<Link className="button secondary" href={`/workspace/${slug}/editor`}>Review website</Link>}
      />
      <AnalyticsReportNav slug={slug} query={query} />

      {!context.site.publishedVersionId ? (
        <LifecycleMessage
          title="Analytics starts when this website goes live."
          detail="Lodesta will measure real visits and customer actions. Drafts, previews, Lodesta agents, and known bots will not count."
          action={<Link className="button primary" href={`/workspace/${slug}/editor`}>Prepare to publish</Link>}
        />
      ) : (
        <>
          {context.site.status === "paused" ? (
            <LifecycleMessage
              tone="attention"
              title="Collection is paused."
              detail={`These results include activity${report.collectionHealth.lastAcceptedAt ? ` through ${formatDateTime(report.collectionHealth.lastAcceptedAt, query.timezone)}` : " recorded before the site was paused"}.`}
            />
          ) : null}
          <AnalyticsReportControls query={query} report={report} exportHref={exportHref} />
          {report.current.visits === 0 ? (
            <LifecycleMessage
              title={report.collectionHealth.lastAcceptedAt ? "No activity in this date range." : "No counted visits yet."}
              detail={context.site.status === "active"
                ? "Tracking is active. Try a wider date range or review collection health."
                : "Historical results will remain here while collection is paused."}
            />
          ) : (
            <>
              <MetricSummary report={report} />
              <MetricDefinitions />
              {report.sufficiency === "early" ? (
                <div className="analytics-early-signal"><WorkspaceStatus tone="info">Early signal</WorkspaceStatus><p>Counts are reliable. Rates and comparisons are directional until this range reaches 20 visits.</p></div>
              ) : null}
              <ReportView report={report} query={query} />
            </>
          )}
          {context.canAccessAdmin ? <CollectionDiagnostics report={report} /> : null}
        </>
      )}
    </main>
  );
}

function MetricSummary({ report }: { report: AnalyticsReport }) {
  const comparison = report.comparison;
  return (
    <section className="workspace-metric-grid analytics-metric-grid" aria-label="Website performance">
      <WorkspaceMetric label="Visitors" value={report.current.visitors} detail={comparisonDetail(report.current.visitors, comparison?.visitors)} />
      <WorkspaceMetric label="Visits" value={report.current.visits} detail={`${report.current.pageViews} page view${report.current.pageViews === 1 ? "" : "s"}`} />
      <WorkspaceMetric label="Leads" value={report.current.leads} detail={comparisonDetail(report.current.leads, comparison?.leads)} tone={report.current.leads ? "positive" : "default"} />
      <WorkspaceMetric label="Customer actions" value={report.current.customerActions} detail={`${report.current.actionVisits} visit${report.current.actionVisits === 1 ? "" : "s"} with action`} tone={report.current.customerActions ? "positive" : "default"} />
      <WorkspaceMetric label="Action rate" value={percentage(report.current.actionRate)} detail={`${report.current.actionVisits} of ${report.current.visits} visits`} />
    </section>
  );
}

function ReportView({ report, query }: { report: AnalyticsReport; query: AnalyticsUrlQuery }) {
  if (query.view === "traffic") return <TrafficView report={report} />;
  if (query.view === "content") return <ContentView report={report} />;
  if (query.view === "actions") return <ActionsView report={report} />;
  return <OverviewView report={report} />;
}

function OverviewView({ report }: { report: AnalyticsReport }) {
  return (
    <>
      <section className="workspace-panel analytics-trend-panel">
        <div className="workspace-panel-heading"><div><span>Trend</span><h2>Visits and customer actions</h2></div><small>{report.query.interval} intervals</small></div>
        <AnalyticsTrend points={report.trend} />
      </section>
      <div className="workspace-results-grid">
        <ReportTable eyebrow="Traffic" title="Leading channels" rows={report.channels} primary="visits" />
        <ReportTable eyebrow="Customer intent" title="Actions people took" rows={report.actions} primary="actions" />
        <ReportTable eyebrow="Content" title="Pages creating action" rows={report.pages} primary="actions" />
        <ReportTable eyebrow="Landing pages" title="Where visits begin" rows={report.landingPages} primary="visits" />
      </div>
      {report.recommendations.length ? (
        <section className="workspace-panel analytics-recommendations">
          <div className="workspace-panel-heading"><div><span>Evidence</span><h2>Recommended next moves</h2></div></div>
          {report.recommendations.map((recommendation) => (
            <article key={recommendation.key}><span aria-hidden="true">→</span><div><strong>{recommendation.title}</strong><p>{recommendation.detail}</p><small>{recommendation.denominator}</small></div></article>
          ))}
        </section>
      ) : (
        <section className="workspace-panel analytics-recommendations is-collecting">
          <div className="workspace-panel-heading"><div><span>Evidence</span><h2>Recommendations need more signal</h2></div></div>
          <p>Lodesta waits for at least 50 relevant visits and 5 customer actions before making a performance recommendation.</p>
        </section>
      )}
    </>
  );
}

function TrafficView({ report }: { report: AnalyticsReport }) {
  return (
    <>
      <section className="workspace-panel analytics-trend-panel"><div className="workspace-panel-heading"><div><span>Acquisition trend</span><h2>Visits by reporting interval</h2></div></div><AnalyticsTrend points={report.trend} /></section>
      <div className="workspace-results-grid">
        <ReportTable eyebrow="Acquisition" title="Channels" rows={report.channels} primary="visits" />
        <ReportTable eyebrow="Sources" title="Referrers and campaign sources" rows={report.sources} primary="visits" />
        {report.campaigns.length ? <ReportTable eyebrow="Campaigns" title="Named campaigns" rows={report.campaigns} primary="visits" /> : null}
        <ReportTable eyebrow="Entry points" title="Landing pages" rows={report.landingPages} primary="visits" />
        <ReportTable eyebrow="Technology" title="Devices" rows={report.devices} primary="visits" />
        <ReportTable eyebrow="Visitors" title="New and returning browsers" rows={report.visitorTypes} primary="visits" />
      </div>
    </>
  );
}

function ContentView({ report }: { report: AnalyticsReport }) {
  return (
    <section className="workspace-panel analytics-wide-table">
      <div className="workspace-panel-heading"><div><span>Content performance</span><h2>Pages visitors used</h2></div></div>
      <AnalyticsDataTable rows={report.pages} />
    </section>
  );
}

function ActionsView({ report }: { report: AnalyticsReport }) {
  const formSubmits = report.actions.find((row) => row.key === "form_submit")?.customerActions ?? 0;
  return (
    <>
      <section className="analytics-funnel-grid" aria-label="Customer action funnels">
        <Funnel title="Visit to action" start={report.current.visits} end={report.current.actionVisits} startLabel="Visits" endLabel="Visits with action" />
        <Funnel title="Form completion" start={report.current.formStarts} end={formSubmits} startLabel="Form starts" endLabel="Submissions" />
      </section>
      {report.current.medianSecondsToAction !== undefined ? <p className="analytics-action-timing">Median time to first customer action: <strong>{formatDuration(Math.round(report.current.medianSecondsToAction))}</strong></p> : null}
      <div className="workspace-results-grid">
        <ReportTable eyebrow="Customer actions" title="Action types" rows={report.actions} primary="actions" />
        <ReportTable eyebrow="Landing contribution" title="Entry pages leading to action" rows={report.landingPages} primary="actions" />
        <ReportTable eyebrow="Page contribution" title="Pages leading to action" rows={report.pages} primary="actions" />
        <ReportTable eyebrow="Device" title="Where people acted" rows={report.devices} primary="actions" />
      </div>
    </>
  );
}

function ReportTable({
  eyebrow,
  title,
  rows,
  primary
}: {
  eyebrow: string;
  title: string;
  rows: AnalyticsReportRow[];
  primary: "visits" | "actions";
}) {
  return (
    <section className="workspace-panel">
      <div className="workspace-panel-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div></div>
      <div className="workspace-result-table">
        {rows.slice(0, 8).map((row) => (
          <div key={row.key}>
            <span><strong>{row.label}</strong><small>{row.visits} visits · {row.customerActions} actions</small></span>
            <span><strong>{primary === "visits" ? row.visits : row.customerActions}</strong><small>{row.visits ? `${percentage(row.actionRate)} rate` : "No visits"}</small></span>
          </div>
        ))}
        {!rows.length ? <div className="workspace-empty-state"><strong>No matching activity</strong><p>Try a wider range or remove a filter.</p></div> : null}
      </div>
    </section>
  );
}

function AnalyticsDataTable({ rows }: { rows: AnalyticsReportRow[] }) {
  return (
    <div className="analytics-data-table" role="region" aria-label="Content performance table" tabIndex={0}>
      <table><thead><tr><th>Page</th><th>Views</th><th>Visitors</th><th>Visits</th><th>Engaged time</th><th>Exits</th><th>Actions</th><th>Action rate</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}><th>{row.label}</th><td>{row.pageViews}</td><td>{row.visitors}</td><td>{row.visits}</td><td>{formatDuration(row.engagedSeconds)}</td><td>{row.exits}</td><td>{row.customerActions}</td><td>{percentage(row.actionRate)}</td></tr>)}</tbody>
      </table>
      {!rows.length ? <div className="workspace-empty-state"><strong>No matching page activity</strong><p>Try a wider range or remove a filter.</p></div> : null}
    </div>
  );
}

function Funnel({ title, start, end, startLabel, endLabel }: { title: string; start: number; end: number; startLabel: string; endLabel: string }) {
  return (
    <section className="workspace-panel analytics-funnel">
      <div className="workspace-panel-heading"><div><span>Funnel</span><h2>{title}</h2></div><WorkspaceStatus tone={start && end / start >= 0.1 ? "success" : "neutral"}>{start ? percentage(end / start) : "No data"}</WorkspaceStatus></div>
      <div><span><strong>{start}</strong><small>{startLabel}</small></span><i aria-hidden="true">→</i><span><strong>{end}</strong><small>{endLabel}</small></span></div>
      <p>{end} of {start} {startLabel.toLowerCase()} reached the next step.</p>
    </section>
  );
}

function CollectionDiagnostics({ report }: { report: AnalyticsReport }) {
  const health = report.collectionHealth;
  return (
    <details className="workspace-advanced-results">
      <summary>Collection diagnostics <span>Admin only</span></summary>
      <div><section className="workspace-panel"><h2>Selected-window collection</h2><dl>
        <div><dt>Accepted</dt><dd>{health.accepted}</dd></div>
        <div><dt>Internal excluded</dt><dd>{health.internal}</dd></div>
        <div><dt>Known bots excluded</dt><dd>{health.bot}</dd></div>
        <div><dt>Preview excluded</dt><dd>{health.preview}</dd></div>
        <div><dt>Duplicates</dt><dd>{health.duplicate}</dd></div>
        <div><dt>Invalid</dt><dd>{health.invalid}</dd></div>
      </dl></section></div>
    </details>
  );
}

function MetricDefinitions() {
  return (
    <details className="analytics-definitions">
      <summary>What these metrics mean</summary>
      <dl>
        <div><dt>Visitor</dt><dd>A pseudonymous browser for this website, not a verified person.</dd></div>
        <div><dt>Visit</dt><dd>Activity from one browser until 30 minutes of inactivity.</dd></div>
        <div><dt>Lead</dt><dd>A valid managed-form inquiry retained by Lodesta.</dd></div>
        <div><dt>Customer action</dt><dd>A form submission, call, email, directions, booking, or ordering click.</dd></div>
      </dl>
    </details>
  );
}

function LifecycleMessage({ title, detail, tone = "neutral", action }: { title: string; detail: string; tone?: "neutral" | "attention"; action?: React.ReactNode }) {
  return <section className={`analytics-lifecycle is-${tone}`}><span aria-hidden="true" /><div><h2>{title}</h2><p>{detail}</p>{action}</div></section>;
}

function percentage(value: number) { return `${Math.round(value * 100)}%`; }
function comparisonDetail(current: number, comparison?: number) {
  if (comparison === undefined) return "Selected date range";
  const delta = current - comparison;
  return `${delta > 0 ? "+" : ""}${delta} from comparison`;
}
function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
