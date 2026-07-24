import type { AnalyticsTrendPoint } from "@/packages/site-capabilities/contracts";

export function AnalyticsTrend({ points }: { points: AnalyticsTrendPoint[] }) {
  if (!points.length) {
    return <div className="workspace-empty-state"><strong>No activity in this date range</strong><p>The trend will appear after a counted visit.</p></div>;
  }
  const width = 720;
  const height = 220;
  const inset = 24;
  const max = Math.max(1, ...points.flatMap((point) => [point.visits, point.customerActions]));
  const coordinate = (value: number, index: number) => ({
    x: points.length === 1 ? width / 2 : inset + index / (points.length - 1) * (width - inset * 2),
    y: height - inset - value / max * (height - inset * 2)
  });
  const path = (key: "visits" | "customerActions") => points.map((point, index) => {
    const { x, y } = coordinate(point[key], index);
    return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="analytics-trend">
      <div className="analytics-trend-legend" aria-hidden="true"><span><i />Visits</span><span><i />Customer actions</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="analytics-trend-title analytics-trend-desc">
        <title id="analytics-trend-title">Visits and customer actions over time</title>
        <desc id="analytics-trend-desc">{points.length} reporting intervals. Peak value {max}.</desc>
        <line x1={inset} y1={height - inset} x2={width - inset} y2={height - inset} />
        <path className="is-visits" d={path("visits")} />
        <path className="is-actions" d={path("customerActions")} />
      </svg>
      <details className="analytics-trend-table">
        <summary>View trend as a table</summary>
        <div className="analytics-data-table" role="region" aria-label="Trend data" tabIndex={0}>
          <table><thead><tr><th>Date</th><th>Visits</th><th>Customer actions</th></tr></thead><tbody>
            {points.map((point) => <tr key={point.bucket}><th>{formatBucket(point.bucket)}</th><td>{point.visits}</td><td>{point.customerActions}</td></tr>)}
          </tbody></table>
        </div>
      </details>
    </div>
  );
}

function formatBucket(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}
