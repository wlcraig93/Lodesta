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
        description="Page views, sources and customer actions—without persistent visitor tracking."
        actions={<Link className="button secondary" href={`/workspace/${slug}/editor`}>Review website</Link>}
      />
      <AnalyticsReportNav slug={slug} query={query} />

      {!context.site.publishedVersionId ? (
        <LifecycleMessage
          title="Analytics starts when this website goes live."
          detail="Lodesta will count page activity and customer actions. Drafts, previews, identified Lodesta agents, and known bots are excluded."
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
          {report.current.pageViews === 0 && report.current.customerActions === 0 && report.current.formStarts === 0 ? (
            <LifecycleMessage
              title={report.collectionHealth.lastAcceptedAt ? "No activity in this date range." : "No counted page views yet."}
              detail={context.site.status === "active"
                ? "Tracking is active. Try a wider date range or review collection health."
                : "Historical results will remain here while collection is paused."}
            />
          ) : (
            <>
              <MetricSummary report={report} />
              <MetricDefinitions />
              {report.sufficiency === "early" ? (
                <div className="analytics-early-signal"><WorkspaceStatus tone="info">Early signal</WorkspaceStatus><p>These are observed activity counts, not unique people. Rates and comparisons are directional, especially below 20 page views.</p></div>
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
      <WorkspaceMetric label="Page views" value={report.current.pageViews} detail={comparisonDetail(report.current.pageViews, comparison?.pageViews)} />
      <WorkspaceMetric label="Tracked inquiries" value={report.current.leads} detail="See Inbox for all received inquiries" tone={report.current.leads ? "positive" : "default"} />
      <WorkspaceMetric label="Customer actions" value={report.current.customerActions} detail="Clicks and retained form submissions" tone={report.current.customerActions ? "positive" : "default"} />
      <WorkspaceMetric label="Page action rate" value={percentage(report.current.actionRate)} detail={`${report.current.actionPageViews} of ${report.current.pageViews} page views`} />
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
        <div className="workspace-panel-heading"><div><span>Trend</span><h2>Page views and customer actions</h2></div><small>{report.query.interval} intervals</small></div>
        <AnalyticsTrend points={report.trend} />
      </section>
      <div className="workspace-results-grid">
        <ReportTable eyebrow="Traffic" title="Leading channels" rows={report.channels} primary="pageViews" />
        <ReportTable eyebrow="Customer intent" title="Actions people took" rows={report.actions} primary="actions" />
        <ReportTable eyebrow="Content" title="Pages creating action" rows={report.pages} primary="actions" />
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
          <p>Lodesta waits for at least 50 relevant page views and 5 customer actions before making a performance recommendation.</p>
        </section>
      )}
    </>
  );
}

function TrafficView({ report }: { report: AnalyticsReport }) {
  return (
    <>
      <section className="workspace-panel analytics-trend-panel"><div className="workspace-panel-heading"><div><span>Acquisition trend</span><h2>Page views by reporting interval</h2></div></div><AnalyticsTrend points={report.trend} /></section>
      <div className="workspace-results-grid">
        <ReportTable eyebrow="Acquisition" title="Channels" rows={report.channels} primary="pageViews" />
        <ReportTable eyebrow="Sources" title="Referrers and campaign sources" rows={report.sources} primary="pageViews" />
        {report.campaigns.length ? <ReportTable eyebrow="Campaigns" title="Named campaigns" rows={report.campaigns} primary="pageViews" /> : null}
        <ReportTable eyebrow="Technology" title="Devices" rows={report.devices} primary="pageViews" />
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
      <section className="analytics-funnel-grid" aria-label="Observed page activity">
        <Funnel title="Page view to action" start={report.current.pageViews} end={report.current.actionPageViews} startLabel="Page views" endLabel="Page views with action" />
        <section className="workspace-panel"><h2>Form activity</h2><p>{report.current.formStarts} observed starts · {formSubmits} retained submissions</p><small>Starts and submissions are separate event counts, not a matched conversion funnel.</small></section>
      </section>
      {report.current.medianSecondsToAction !== undefined ? <p className="analytics-action-timing">Median elapsed time at customer actions: <strong>{formatDuration(Math.round(report.current.medianSecondsToAction))}</strong></p> : null}
      <div className="workspace-results-grid">
        <ReportTable eyebrow="Customer actions" title="Action types" rows={report.actions} primary="actions" />
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
  primary: "pageViews" | "actions";
}) {
  return (
    <section className="workspace-panel">
      <div className="workspace-panel-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div></div>
      <div className="workspace-result-table">
        {rows.slice(0, 8).map((row) => (
          <div key={row.key}>
            <span><strong>{row.label}</strong><small>{row.pageViews ? `${row.pageViews} page views · ` : ""}{row.customerActions} actions</small></span>
            <span><strong>{primary === "pageViews" ? row.pageViews : row.customerActions}</strong><small>{row.pageViews ? `${percentage(row.actionRate)} page action rate` : "—"}</small></span>
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
      <table><thead><tr><th>Page</th><th>Views</th><th>Engaged time</th><th>Actions</th><th>Page action rate</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}><th>{row.label}</th><td>{row.pageViews}</td><td>{formatDuration(row.engagedSeconds)}</td><td>{row.customerActions}</td><td>{percentage(row.actionRate)}</td></tr>)}</tbody>
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
        <div><dt>Page view</dt><dd>An observed page load. Reloads count again. No persistent browser identifier, unique-person count, or returning-visitor measurement.</dd></div>
        <div><dt>Page action rate</dt><dd>The fraction of observed page loads with at least one action on that same page. Missing beacons can undercount activity.</dd></div>
        <div><dt>Source</dt><dd>The referrer host or campaign supplied on this page load only. Attribution is not carried between pages or visits.</dd></div>
        <div><dt>Tracked inquiry</dt><dd>A retained managed-form inquiry with page-level analytics context. The Inbox includes received inquiries even when analytics is unavailable.</dd></div>
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
