import Link from "next/link";
import {
  analyticsQuerySearchParams,
  analyticsViewLabel,
  type AnalyticsUrlQuery
} from "@/lib/analytics-query";
import type { AnalyticsReport } from "@/packages/site-capabilities/contracts";

export function AnalyticsReportNav({ slug, query }: { slug: string; query: AnalyticsUrlQuery }) {
  return (
    <nav className="analytics-report-nav" aria-label="Analytics reports">
      {(["overview", "traffic", "content", "actions"] as const).map((view) => (
        <Link
          key={view}
          href={`/workspace/${slug}/analytics?${analyticsQuerySearchParams(query, { view }).toString()}`}
          aria-current={query.view === view ? "page" : undefined}
        >
          {analyticsViewLabel(view)}
        </Link>
      ))}
    </nav>
  );
}

export function AnalyticsReportControls({
  query,
  report,
  exportHref
}: {
  query: AnalyticsUrlQuery;
  report: AnalyticsReport;
  exportHref: string;
}) {
  return (
    <form className="analytics-controls" method="get">
      <input type="hidden" name="view" value={query.view} />
      <div className="analytics-control-row">
        <label>
          <span>Date range</span>
          <select name="range" defaultValue={query.range}>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="mtd">Month to date</option>
            <option value="ytd">Year to date</option>
            <option value="since_launch">Since launch</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          <span>From</span>
          <input type="date" name="from" defaultValue={query.from} />
        </label>
        <label>
          <span>To</span>
          <input type="date" name="to" defaultValue={query.to} />
        </label>
        <label>
          <span>Compare</span>
          <select name="compare" defaultValue={query.compare}>
            <option value="off">Off</option>
            <option value="previous_period">Previous period</option>
            <option value="previous_year">Previous year</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          <span>Interval</span>
          <select name="interval" defaultValue={query.requestedInterval}>
            <option value="auto">Auto</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </div>
      {query.compare === "custom" ? (
        <div className="analytics-control-row is-comparison">
          <label><span>Comparison from</span><input type="date" name="compareFrom" defaultValue={query.compareFrom} /></label>
          <label><span>Comparison to</span><input type="date" name="compareTo" defaultValue={query.compareTo} /></label>
        </div>
      ) : null}
      <details className="analytics-filter-drawer" open={Boolean(query.filters.channel || query.filters.source || query.filters.page || query.filters.action || query.filters.device)}>
        <summary>Filters <span>{filterCount(query)} active</span></summary>
        <div className="analytics-control-row">
          <label>
            <span>Channel</span>
            <select name="channel" defaultValue={query.filters.channel ?? ""}>
              <option value="">All channels</option>
              <option value="campaign">Campaign</option>
              <option value="organic_search">Organic search</option>
              <option value="social">Social</option>
              <option value="referral">Referral</option>
              <option value="direct">Direct / unknown</option>
            </select>
          </label>
          <label>
            <span>Source</span>
            <select name="source" defaultValue={query.filters.source ?? ""}>
              <option value="">All sources</option>
              {report.sources.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
            </select>
          </label>
          <label>
            <span>Page</span>
            <select name="page" defaultValue={query.filters.page ?? ""}>
              <option value="">All pages</option>
              {uniqueRows([...report.pages, ...report.landingPages]).map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
            </select>
          </label>
          <label>
            <span>Customer action</span>
            <select name="action" defaultValue={query.filters.action ?? ""}>
              <option value="">All actions</option>
              <option value="form_submit">Form submissions</option>
              <option value="call_click">Calls</option>
              <option value="email_click">Emails</option>
              <option value="directions_click">Directions</option>
              <option value="booking_click">Bookings</option>
              <option value="ordering_click">Orders</option>
            </select>
          </label>
          <label>
            <span>Device</span>
            <select name="device" defaultValue={query.filters.device ?? ""}>
              <option value="">All devices</option>
              <option value="mobile">Mobile</option>
              <option value="tablet">Tablet</option>
              <option value="desktop">Desktop</option>
            </select>
          </label>
        </div>
      </details>
      <div className="analytics-control-actions">
        <button className="button primary" type="submit">Apply</button>
        <Link className="button secondary" href={`?view=${query.view}`}>Reset</Link>
        <a className="button secondary" href={exportHref}>Export CSV</a>
      </div>
    </form>
  );
}

function filterCount(query: AnalyticsUrlQuery) {
  return Object.values(query.filters).filter(Boolean).length;
}

function uniqueRows(rows: AnalyticsReport["pages"]) {
  return [...new Map(rows.map((row) => [row.key, row])).values()].sort((left, right) => left.label.localeCompare(right.label));
}
