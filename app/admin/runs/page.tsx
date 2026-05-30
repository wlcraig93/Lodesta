import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository, type ListAgentRunsFilter } from "@/lib/repository";
import type { AgentRunSource, AgentRunStatus } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

type RunsSearchParams = {
  q?: string;
  status?: string;
  runType?: string;
  agentType?: string;
  source?: string;
  sourceHost?: string;
  targetId?: string;
  from?: string;
  to?: string;
};

const statuses = new Set<AgentRunStatus>(["queued", "running", "completed", "failed", "canceled"]);
const sources = new Set<AgentRunSource>(["admin_console", "api", "job"]);

export default async function AdminRunsPage({ searchParams }: { searchParams: Promise<RunsSearchParams> }) {
  await requireAdminPageAccess("/admin/runs");
  const params = await searchParams;
  const filter: ListAgentRunsFilter = {
    search: value(params.q),
    status: enumValue(params.status, statuses),
    runType: value(params.runType),
    agentType: value(params.agentType),
    source: enumValue(params.source, sources),
    sourceHost: value(params.sourceHost),
    targetId: value(params.targetId),
    from: value(params.from),
    to: value(params.to),
    limit: 100
  };
  const result = await repository.listAgentRuns(filter);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Telemetry</span>
          <h1>Runs</h1>
          <p>Inspect site generation attempts, spans, model calls, token totals, failures, and target links.</p>
        </div>
      </header>

      <section className="panel">
        <form className="admin-filter-form">
          <input name="q" placeholder="Run ID, site, URL, host" defaultValue={params.q ?? ""} />
          <select name="status" defaultValue={params.status ?? ""}>
            <option value="">Any status</option>
            {Array.from(statuses).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select name="source" defaultValue={params.source ?? ""}>
            <option value="">Any source</option>
            {Array.from(sources).map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <input name="sourceHost" placeholder="Source host" defaultValue={params.sourceHost ?? ""} />
          <input name="targetId" placeholder="Target ID" defaultValue={params.targetId ?? ""} />
          <input name="from" type="date" defaultValue={params.from ?? ""} />
          <input name="to" type="date" defaultValue={params.to ?? ""} />
          <button className="button secondary" type="submit">
            Filter
          </button>
        </form>
      </section>

      <section className="panel admin-section">
        <div className="section-heading-row">
          <h2>Recent Runs</h2>
          <span className="muted">{result.total} total</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Run</th>
              <th>Source</th>
              <th>Target</th>
              <th>Duration</th>
              <th>Model Calls</th>
              <th>Tokens</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {result.runs.map((run) => (
              <tr key={run.id}>
                <td><span className={`badge status-${run.status}`}>{run.status}</span></td>
                <td>
                  <Link href={`/admin/runs/${run.id}`}>{run.outputSummary ?? run.inputSummary ?? run.id}</Link>
                  <small>{run.id}</small>
                  {run.latestError ? <small className="error-text">{run.latestError}</small> : null}
                </td>
                <td>
                  {run.source}
                  <small>{run.sourceHost ?? "no host"}</small>
                </td>
                <td>
                  {run.targetId ? (
                    <>
                      {run.targetName ?? run.targetId}
                      <small>{run.targetType ?? "target"}</small>
                    </>
                  ) : (
                    <span className="muted">Not persisted</span>
                  )}
                </td>
                <td>{formatDuration(run.startedAt, run.endedAt)}</td>
                <td>{run.modelCallCount ?? 0}</td>
                <td>{run.tokenTotals?.totalTokens ?? 0}</td>
                <td>{formatDate(run.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.runs.length === 0 ? <p className="muted">No runs match these filters.</p> : null}
      </section>
    </main>
  );
}

function value(input?: string) {
  const trimmed = input?.trim();
  return trimmed || undefined;
}

function enumValue<T extends string>(input: string | undefined, values: Set<T>) {
  const trimmed = input?.trim();
  return trimmed && values.has(trimmed as T) ? (trimmed as T) : undefined;
}

function formatDate(input: string) {
  return new Date(input).toLocaleString();
}

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}
