"use client";

import { useMemo, useState } from "react";
import type { SiteSourceCoverageReport } from "@/packages/site-contracts";

type Disposition = SiteSourceCoverageReport["entries"][number]["disposition"];

const labels: Record<Disposition | "all", string> = {
  all: "All source paths",
  preserved: "Preserved",
  redirected: "Redirected",
  canonical_duplicate: "Canonical duplicates",
  retired: "Intentionally retired",
  unaccounted: "Unaccounted"
};

export function SourceCoveragePanel({ report, compact = false }: {
  report: SiteSourceCoverageReport;
  compact?: boolean;
}) {
  const [filter, setFilter] = useState<Disposition | "all">("all");
  const counts = useMemo(() => Object.fromEntries(
    Object.keys(labels).filter((key) => key !== "all").map((key) => [
      key,
      report.entries.filter((entry) => entry.disposition === key).length
    ])
  ) as Record<Disposition, number>, [report]);
  const visible = filter === "all"
    ? report.entries
    : report.entries.filter((entry) => entry.disposition === filter);

  return <section className="panel source-coverage-panel" aria-labelledby={`source-coverage-${report.versionId}`}>
    <div className="section-heading-row">
      <div>
        <h2 id={`source-coverage-${report.versionId}`}>Source coverage</h2>
        <p className="muted">How this candidate accounts for every retained source path. Content-quality dispositions are advisory; invalid redirects remain a technical publish error.</p>
      </div>
      <span className={`badge ${counts.unaccounted ? "is-warning" : "is-success"}`}>{counts.unaccounted ? `${counts.unaccounted} unaccounted` : "All accounted for"}</span>
    </div>
    <div className="metric-row" aria-label="Source path coverage summary">
      <CoverageMetric label="Source paths" value={report.entries.length} />
      <CoverageMetric label="Preserved" value={counts.preserved} />
      <CoverageMetric label="Redirected" value={counts.redirected} />
      <CoverageMetric label="Canonical duplicates" value={counts.canonical_duplicate} />
      <CoverageMetric label="Retired" value={counts.retired} />
      <CoverageMetric label="New routes" value={report.newRoutes.length} />
    </div>
    {compact ? null : <details className="source-coverage-details" open={counts.unaccounted > 0}>
      <summary>Review source-path details</summary>
      <div className="section-heading-row source-coverage-controls">
        <label>Show <select value={filter} onChange={(event) => setFilter(event.target.value as Disposition | "all")}>
          {(Object.keys(labels) as Array<Disposition | "all">).map((value) => <option key={value} value={value}>{labels[value]} ({value === "all" ? report.entries.length : counts[value]})</option>)}
        </select></label>
        <span className="muted">{visible.length} path{visible.length === 1 ? "" : "s"}</span>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Source path</th><th>Disposition</th><th>Destination or reason</th></tr></thead><tbody>
        {visible.map((entry) => <tr key={`${entry.sourcePageId}:${entry.sourcePath}`}>
          <td><code>{entry.sourcePath}</code></td>
          <td>{labels[entry.disposition]}</td>
          <td>{entry.destinationPath ? <code>{entry.destinationPath}</code> : entry.reason ?? "—"}</td>
        </tr>)}
      </tbody></table></div>
      {report.newRoutes.length ? <div className="source-coverage-new-routes"><h3>New routes</h3><p>{report.newRoutes.map((route) => <code key={route}>{route} </code>)}</p></div> : null}
    </details>}
  </section>;
}

function CoverageMetric({ label, value }: { label: string; value: number }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}
