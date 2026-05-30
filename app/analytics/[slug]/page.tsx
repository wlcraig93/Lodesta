import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedVersion } from "@/lib/sample-data";
import { repository } from "@/lib/repository";
import type { AnalyticsEvent } from "@/lib/models";
import { requireSiteOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/analytics/${slug}`);

  const siteId = bundle.businessProfile.siteId;
  const [summary, events, leads] = await Promise.all([
    repository.analyticsSummary(siteId),
    repository.listAnalyticsEvents(siteId),
    repository.listFormSubmissions(siteId)
  ]);
  const version = getPublishedVersion(bundle.siteModel);
  const sectionNames = new Map(
    version.pages.flatMap((page) =>
      page.sections.map((section) => [
        section.id,
        `${page.slug || "home"} / ${String(section.props.heading ?? section.type)}`
      ])
    )
  );

  const eventCounts = countBy(events, (event) => event.eventType);
  const deviceCounts = countBy(events, (event) => event.deviceType ?? "unknown");
  const recentClicks = events
    .filter((event) => event.eventType === "click" || event.eventType === "tel_click" || event.eventType === "outbound_click")
    .slice(0, 12);
  const sessions = summarizeSessions(events);
  const latestVitals = latestWebVitals(events);
  const primaryActions = summary.primaryActions;
  const primaryActionRate = summary.actionRate;
  const leadRate = summary.sessions ? leads.length / summary.sessions : 0;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Analytics</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>
            First-party behavioral data for the optimization loop: sessions, attention, primary actions, section exposure,
            Web Vitals, and recent conversion clicks.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/dashboard">
            Dashboard
          </Link>
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <Metric label="Sessions" value={summary.sessions} />
        <Metric label="Primary actions" value={primaryActions} />
        <Metric label="Action rate" value={`${Math.round(primaryActionRate * 100)}%`} />
        <Metric label="Engaged seconds" value={Math.round(summary.engagedMs / 1000)} />
      </section>

      <section className="metric-row">
        <Metric label="Baseline status" value={summary.baselineComparison.status} />
        <Metric label="Current actions" value={summary.baselineComparison.current.primaryActions} />
        <Metric label="Action delta" value={formatSigned(summary.baselineComparison.delta.primaryActions)} />
        <Metric label="Rate delta" value={`${formatSigned(Math.round(summary.baselineComparison.delta.actionRate * 100))}%`} />
      </section>

      <section className="metric-row">
        <Metric label="Leads" value={leads.length} />
        <Metric label="Lead rate" value={`${Math.round(leadRate * 100)}%`} />
        <Metric label="Avg engaged/session" value={`${summary.avgEngagedSeconds}s`} />
        <Metric label="Avg scroll depth" value={`${summary.avgScrollDepth}%`} />
      </section>

      <section className="metric-row">
        <Metric label="Tracked clicks" value={summary.clicks + summary.telClicks + summary.outboundClicks} />
        <Metric label="Median time to action" value={formatDuration(summary.medianTimeToActionMs)} />
        <Metric label="Avg time to action" value={formatDuration(summary.avgTimeToActionMs)} />
        <Metric label="Agent-readable" value={summary.agentReadableRequests} />
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Conversion Funnel</h2>
          <div className="bar-list">
            <Bar label="Pageviews" value={summary.pageviews} max={Math.max(summary.pageviews, 1)} />
            <Bar label="Section views" value={eventCounts.section_view ?? 0} max={Math.max(summary.pageviews, 1)} />
            <Bar label="Form starts" value={summary.formStarts} max={Math.max(summary.pageviews, 1)} />
            <Bar label="Calls" value={summary.telClicks} max={Math.max(summary.pageviews, 1)} />
            <Bar label="Forms submitted" value={summary.formSubmits} max={Math.max(summary.pageviews, 1)} />
            <Bar label="Outbound actions" value={summary.outboundClicks} max={Math.max(summary.pageviews, 1)} />
          </div>
        </section>

        <aside className="panel">
          <h2>Devices</h2>
          <div className="bar-list">
            {topEntries(deviceCounts).map(([label, value]) => (
              <Bar key={label} label={label} value={value} max={events.length || 1} />
            ))}
            {events.length === 0 ? <p className="muted">No device data yet.</p> : null}
          </div>
        </aside>
      </div>

      <section className="panel">
        <h2>Funnel Dropoff</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Start</th>
              <th>Reached</th>
              <th>Dropoff</th>
              <th>Conversion</th>
            </tr>
          </thead>
          <tbody>
            {summary.funnelDropoffs.map((row) => (
              <tr key={row.key}>
                <td>
                  {row.from} to {row.to}
                </td>
                <td>{row.fromCount}</td>
                <td>{row.toCount}</td>
                <td>{row.dropoffCount}</td>
                <td>{Math.round(row.conversionRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Agent-Readable Requests</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Requests</th>
              <th>Sessions</th>
              <th>Latest</th>
            </tr>
          </thead>
          <tbody>
            {summary.agentReadableByResource.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{row.requests}</td>
                <td>{row.sessions}</td>
                <td>{row.latestAt ? formatDate(row.latestAt) : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {summary.agentReadableByResource.length === 0 ? (
          <p className="muted">No llms.txt or Markdown alternate requests yet.</p>
        ) : null}
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Traffic Sources</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Sessions</th>
                <th>Actions</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {summary.outcomesBySource.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{row.sessions}</td>
                  <td>{row.primaryActions}</td>
                  <td>{Math.round(row.actionRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.outcomesBySource.length === 0 ? <p className="muted">No source attribution yet.</p> : null}
        </section>

        <aside className="panel">
          <h2>Click Map</h2>
          <ClickMap points={summary.clickMap} sectionNames={sectionNames} />
        </aside>
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2>Section Outcomes</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Events</th>
                <th>Actions</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {summary.outcomesBySection.map((row) => (
                <tr key={row.key}>
                  <td>{sectionNames.get(row.key) ?? row.label}</td>
                  <td>{row.events}</td>
                  <td>{row.primaryActions}</td>
                  <td>{Math.round(row.actionRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.outcomesBySection.length === 0 ? <p className="muted">No section exposure events yet.</p> : null}
        </section>

        <aside className="panel">
          <h2>Web Vitals</h2>
          <div className="finding-list">
            {latestVitals.map((metric) => (
              <article key={metric.name} className="finding-card">
                <span className="badge">{metric.name}</span>
                <h3>{metric.value}</h3>
                <p>{formatDate(metric.timestamp)}</p>
              </article>
            ))}
            {latestVitals.length === 0 ? <p className="muted">No Web Vital samples yet.</p> : null}
          </div>
        </aside>
      </div>

      <section className="panel">
        <h2>Section Conversion Paths</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Exposed section</th>
              <th>Sessions</th>
              <th>Action sessions</th>
              <th>Actions</th>
              <th>Median time</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {summary.sectionConversionPaths.map((row) => (
              <tr key={row.key}>
                <td>{sectionNames.get(row.sectionId) ?? row.sectionId}</td>
                <td>{row.exposedSessions}</td>
                <td>{row.actionSessions}</td>
                <td>{row.primaryActions}</td>
                <td>{formatDuration(row.medianTimeToActionMs)}</td>
                <td>{Math.round(row.actionRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {summary.sectionConversionPaths.length === 0 ? (
          <p className="muted">No section-to-action paths yet.</p>
        ) : null}
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Page Attribution</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Sessions</th>
                <th>Actions</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {summary.outcomesByPage.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{row.sessions}</td>
                  <td>{row.primaryActions}</td>
                  <td>{Math.round(row.actionRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.outcomesByPage.length === 0 ? <p className="muted">No page attribution yet.</p> : null}
        </section>

        <aside className="panel">
          <h2>CTA Attribution</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>CTA</th>
                <th>Events</th>
                <th>Actions</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {summary.outcomesByCtaRole.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{row.events}</td>
                  <td>{row.primaryActions}</td>
                  <td>{Math.round(row.actionRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.outcomesByCtaRole.length === 0 ? <p className="muted">No CTA attribution yet.</p> : null}
        </aside>
      </div>

      <section className="panel">
        <h2>Experiment Attribution</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Experiment / variant</th>
              <th>Sessions</th>
              <th>Calls</th>
              <th>Forms</th>
              <th>Outbound</th>
              <th>Action rate</th>
            </tr>
          </thead>
          <tbody>
            {summary.outcomesByExperimentVariant.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{row.sessions}</td>
                <td>{row.telClicks}</td>
                <td>{row.formSubmits}</td>
                <td>{row.outboundClicks}</td>
                <td>{Math.round(row.actionRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {summary.outcomesByExperimentVariant.length === 0 ? (
          <p className="muted">No experiment-attributed sessions yet.</p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Standard Correlations</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Standard criterion</th>
              <th>Signal</th>
              <th>Metric</th>
              <th>Events</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {summary.standardCorrelations.map((row) => (
              <tr key={row.criterionId}>
                <td>
                  {row.title}
                  <small className="muted">{row.insight}</small>
                </td>
                <td>{row.signal}</td>
                <td>{row.metric}</td>
                <td>{row.events}</td>
                <td>{Math.round(row.rate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Recent Clicks</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>After</th>
                <th>Role</th>
                <th>Section</th>
              </tr>
            </thead>
            <tbody>
              {recentClicks.map((event, index) => (
                <tr key={`${event.timestamp}-${index}`}>
                  <td>{formatDate(event.timestamp)}</td>
                  <td>{event.hrefType ?? event.eventType}</td>
                  <td>{formatDuration(numberMetadata(event, "elapsedMs"))}</td>
                  <td>{event.elementRole ?? "unknown"}</td>
                  <td>{event.sectionId ? sectionNames.get(event.sectionId) ?? event.sectionId : "unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentClicks.length === 0 ? <p className="muted">No click events yet.</p> : null}
        </section>

        <aside className="panel">
          <h2>Recent Sessions</h2>
          <div className="finding-list">
            {sessions.slice(0, 8).map((session) => (
              <article key={session.sessionId} className="finding-card">
                <span className="badge">{session.events} events</span>
                <h3>{session.deviceType}</h3>
                <p>
                  {formatDate(session.firstSeen)} to {formatDate(session.lastSeen)}
                </p>
              </article>
            ))}
            {sessions.length === 0 ? <p className="muted">No sessions yet.</p> : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const width = Math.max(4, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div className="bar-row">
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <div className="bar-track">
        <span className="bar-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ClickMap({
  points,
  sectionNames
}: {
  points: NonNullable<Awaited<ReturnType<typeof repository.analyticsSummary>>["clickMap"]>;
  sectionNames: Map<string, string>;
}) {
  if (points.length === 0) return <p className="muted">No coordinate click events yet.</p>;
  const max = Math.max(...points.map((point) => point.count), 1);
  return (
    <div className="click-map-wrap">
      <div className="click-map-canvas" aria-label="Aggregated click map">
        {points.slice(0, 12).map((point) => (
          <span
            key={point.key}
            className="click-map-dot"
            title={`${point.label}: ${point.count}`}
            style={
              {
                left: `${Math.round(point.normalizedX * 100)}%`,
                top: `${Math.round(point.normalizedY * 100)}%`,
                "--dot-size": `${12 + Math.round((point.count / max) * 22)}px`
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="finding-list">
        {points.slice(0, 5).map((point) => (
          <article key={point.key} className="finding-card compact-card">
            <span className="badge">{point.count} clicks</span>
            <h3>{point.label}</h3>
            <p>{point.sectionId ? sectionNames.get(point.sectionId) ?? point.sectionId : point.pageId ?? "unknown"}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function countBy<T extends string>(events: AnalyticsEvent[], getKey: (event: AnalyticsEvent) => T) {
  return events.reduce<Record<T, number>>((counts, event) => {
    const key = getKey(event);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<T, number>);
}

function topEntries(counts: Record<string, number>) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function summarizeSessions(events: AnalyticsEvent[]) {
  const sessions = new Map<
    string,
    { sessionId: string; firstSeen: string; lastSeen: string; events: number; deviceType: string }
  >();

  for (const event of events) {
    const existing = sessions.get(event.sessionId);
    if (!existing) {
      sessions.set(event.sessionId, {
        sessionId: event.sessionId,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        events: 1,
        deviceType: event.deviceType ?? "unknown"
      });
      continue;
    }
    existing.events += 1;
    if (event.timestamp < existing.firstSeen) existing.firstSeen = event.timestamp;
    if (event.timestamp > existing.lastSeen) existing.lastSeen = event.timestamp;
    if (existing.deviceType === "unknown" && event.deviceType) existing.deviceType = event.deviceType;
  }

  return Array.from(sessions.values()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

function latestWebVitals(events: AnalyticsEvent[]) {
  const byMetric = new Map<string, { name: string; value: number | string; timestamp: string }>();
  for (const event of events) {
    if (event.eventType !== "web_vital") continue;
    const name = String(event.metadata?.metric ?? "metric");
    const existing = byMetric.get(name);
    if (!existing || event.timestamp > existing.timestamp) {
      byMetric.set(name, {
        name,
        value: typeof event.value === "number" ? event.value : "n/a",
        timestamp: event.timestamp
      });
    }
  }
  return Array.from(byMetric.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function numberMetadata(event: AnalyticsEvent, key: string) {
  const value = event.metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function formatDuration(value?: number) {
  if (value === undefined) return "n/a";
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
