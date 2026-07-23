import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { SiteAgentRun } from "@/packages/site-contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminRunsPage({ searchParams }: { searchParams: Promise<{ status?: string; siteId?: string }> }) {
  await requireAdminPageAccess("/admin/runs");
  const params = await searchParams;
  const status = isRunStatus(params.status) ? params.status : undefined;
  const records = await sitePlatformRepository.listRecentAgentRunAdminRecords({ siteId: params.siteId, status, limit: 100 });
  const runs = records.flatMap((record) => record.run ? [record.run] : []);
  const stale = records.filter((record) => !record.run);
  const monitoredRuns = runs.filter((run) => ["succeeded", "failed", "cancelled"].includes(run.status)).slice(0, 20);
  const monitoredEvents = await Promise.all(monitoredRuns.map((run) => sitePlatformRepository.listAgentRunEvents(run.id, { limit: 500 })));
  const configuredCosts = monitoredRuns
    .filter((run) => run.usage.costEstimateStatus === "configured")
    .map((run) => run.usage.estimatedCostUsd)
    .sort((left, right) => left - right);
  const modelRequests = monitoredEvents.reduce(
    (total, events) => total + events.filter((event) => event.kind === "model_request").length,
    0
  );
  const failureCounts = Object.entries(monitoredRuns.reduce<Record<string, number>>((counts, run) => {
    if (run.status === "failed") counts[run.failureCode ?? "unclassified"] = (counts[run.failureCode ?? "unclassified"] ?? 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]);
  const sites = await sitePlatformRepository.listSites();
  const siteById = new Map(sites.map((site) => [site.id, site]));
  return <main className="admin-page">
    <AdminPageHeader eyebrow="Debug" title="Agent activity" description="Inspect manager turns, tools, usage, visual review, failures, and candidate output." />
    <section className="metric-row">
      <Metric label={`Success rate · last ${monitoredRuns.length}`} value={monitoredRuns.length ? `${Math.round(monitoredRuns.filter((run) => run.status === "succeeded").length / monitoredRuns.length * 100)}%` : "—"} />
      <Metric label="Median cost" value={formatPercentile(configuredCosts, 0.5)} />
      <Metric label="P95 cost" value={formatPercentile(configuredCosts, 0.95)} />
      <Metric label="Model requests" value={monitoredRuns.length ? `${modelRequests} · ${(modelRequests / monitoredRuns.length).toFixed(1)}/run` : "—"} />
    </section>
    {failureCounts.length ? <section className="panel"><strong>Terminal failures · last 20</strong><p className="muted">{failureCounts.map(([code, count]) => `${code}: ${count}`).join(" · ")}</p></section> : null}
    <section className="panel"><form className="admin-filter-form"><select name="status" defaultValue={status ?? ""}><option value="">Any status</option>{["queued", "running", "needs_input", "succeeded", "failed", "cancelled"].map((value) => <option key={value}>{value}</option>)}</select><input name="siteId" placeholder="Site ID" defaultValue={params.siteId ?? ""} /><button className="button secondary" type="submit">Filter</button></form></section>
    <section className="panel admin-section"><table className="data-table"><thead><tr><th>Status</th><th>Run</th><th>Site</th><th>Model</th><th>Usage</th><th>Started</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}>
      <td><span className={`badge status-${run.status}`}>{run.status}</span><small>{run.stage}</small></td>
      <td><Link href={`/admin/runs/${run.id}`}>{run.kind.replaceAll("_", " ")}</Link><small>{run.id}</small>{run.failureCode ? <small className="error-text">{run.failureCategory} · {run.failureCode}</small> : null}{run.failureReason ? <small className="error-text">{run.failureReason}</small> : null}</td>
      <td>{siteById.get(run.siteId)?.slug ?? run.siteId}</td><td>{run.modelId}</td>
      <td>{(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()} tokens<small>{run.usage.cachedInputTokens.toLocaleString()} cached · {formatCost(run.usage.estimatedCostUsd, run.usage.costEstimateStatus)}</small><small>{formatDuration(run.usage.durationMs)} model time · execution {run.executionNumber}</small></td>
      <td>{new Date(run.startedAt).toLocaleString()}</td>
    </tr>)}</tbody></table>{!runs.length && !stale.length ? <p className="muted">No runs match.</p> : null}{stale.map((record) => <p className="error-text" key={record.id}><Link href={`/admin/runs/${record.id}`}>{record.id}</Link>: {record.issue}</p>)}</section>
  </main>;
}

function isRunStatus(value: string | undefined): value is SiteAgentRun["status"] {
  return Boolean(value && ["queued", "running", "needs_input", "succeeded", "failed", "cancelled"].includes(value));
}
function formatDuration(value: number) { return `${Math.round(value / 1000)}s`; }
function formatCost(value: number, status: SiteAgentRun["usage"]["costEstimateStatus"]) {
  return status === "configured" ? `$${value.toFixed(4)}` : "cost unavailable";
}
function formatPercentile(values: number[], percentile: number) {
  if (!values.length) return "—";
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentile) - 1));
  return `$${values[index].toFixed(2)}`;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}
