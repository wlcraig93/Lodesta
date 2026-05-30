import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RunNotesForm } from "@/components/admin/RunNotesForm";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import type { AgentModelCallRecord, AgentRunSpanRecord } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function AdminRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAdminPageAccess(`/admin/runs/${runId}`);
  const detail = await repository.getAgentRunDetail(runId);
  if (!detail) notFound();

  const slug = typeof detail.run.metadata?.slug === "string" ? detail.run.metadata.slug : detail.run.targetSlug;
  const previewUrl = typeof detail.run.metadata?.previewUrl === "string" ? detail.run.metadata.previewUrl : undefined;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className={`badge status-${detail.run.status}`}>{detail.run.status}</span>
          <h1>Run Inspector</h1>
          <p>{detail.run.outputSummary ?? detail.run.inputSummary ?? detail.run.id}</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/admin/runs">
            Runs
          </Link>
          {previewUrl ? (
            <Link className="button secondary" href={previewUrl}>
              Preview
            </Link>
          ) : null}
          {slug ? (
            <Link className="button secondary" href={`/editor/${slug}`}>
              Editor
            </Link>
          ) : null}
          {slug ? (
            <Link className="button secondary" href={`/sites/${slug}`}>
              Site
            </Link>
          ) : null}
        </div>
      </header>

      <section className="metric-row">
        <div className="metric-card">
          <strong>{detail.spans.length}</strong>
          <span>Spans</span>
        </div>
        <div className="metric-card">
          <strong>{detail.modelCalls.length}</strong>
          <span>Model calls</span>
        </div>
        <div className="metric-card">
          <strong>{detail.tokenTotals.totalTokens}</strong>
          <span>Total tokens</span>
        </div>
        <div className="metric-card">
          <strong>{formatDuration(detail.run.startedAt, detail.run.endedAt)}</strong>
          <span>Duration</span>
        </div>
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Timeline</h2>
          <div className="timeline-list">
            {detail.spans.map((span) => (
              <article key={span.id} className="timeline-item">
                <span className={`badge status-${span.status}`}>{span.status}</span>
                <div>
                  <strong>{span.name}</strong>
                  <small>{span.spanType} / {formatDuration(span.startedAt, span.endedAt)}</small>
                  {span.errorMessage ? <p className="error-text">{span.errorMessage}</p> : null}
                </div>
              </article>
            ))}
            {detail.spans.length === 0 ? <p className="muted">No spans were recorded for this run.</p> : null}
          </div>
        </section>

        <section className="panel">
          <h2>Notes</h2>
          <RunNotesForm runId={detail.run.id} initialNotes={detail.run.notes} initialTags={detail.run.tags} />
        </section>
      </div>

      <section className="panel admin-section">
        <h2>Spans</h2>
        <div className="finding-list">
          {detail.spans.map((span) => (
            <SpanCard key={span.id} span={span} />
          ))}
        </div>
      </section>

      <section className="panel admin-section">
        <h2>Model Calls</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Operation</th>
              <th>Model</th>
              <th>Duration</th>
              <th>Tokens</th>
              <th>Raw</th>
            </tr>
          </thead>
          <tbody>
            {detail.modelCalls.map((call) => (
              <ModelCallRow key={call.id} call={call} />
            ))}
          </tbody>
        </table>
        {detail.modelCalls.length === 0 ? <p className="muted">No model calls were recorded for this run.</p> : null}
      </section>

      <section className="panel admin-section">
        <h2>Run JSON</h2>
        <details>
          <summary>Raw run record</summary>
          <pre className="json-block">{pretty(detail.run)}</pre>
        </details>
      </section>
    </main>
  );
}

function SpanCard({ span }: { span: AgentRunSpanRecord }) {
  return (
    <article className="finding-card">
      <span className={`badge status-${span.status}`}>{span.status}</span>
      <h3>{span.name}</h3>
      <p className="muted">{span.spanType} / {formatDuration(span.startedAt, span.endedAt)}</p>
      {span.errorMessage ? <p className="error-text">{span.errorMessage}</p> : null}
      <details>
        <summary>Input</summary>
        <pre className="json-block">{pretty(span.inputJson)}</pre>
      </details>
      <details>
        <summary>Output</summary>
        <pre className="json-block">{pretty(span.outputJson)}</pre>
      </details>
      <details>
        <summary>Metadata</summary>
        <pre className="json-block">{pretty({ metadata: span.metadata, artifactRefs: span.artifactRefs })}</pre>
      </details>
    </article>
  );
}

function ModelCallRow({ call }: { call: AgentModelCallRecord }) {
  const tokens =
    (call.inputTokens ?? 0) + (call.outputTokens ?? 0) + (call.cacheCreationTokens ?? 0) + (call.cacheReadTokens ?? 0);
  return (
    <tr>
      <td><span className={`badge status-${call.status}`}>{call.status}</span></td>
      <td>
        {call.operation}
        {call.errorMessage ? <small className="error-text">{call.errorMessage}</small> : null}
      </td>
      <td>
        {call.provider}
        <small>{call.model}</small>
      </td>
      <td>{formatDuration(call.startedAt, call.endedAt)}</td>
      <td>{tokens}</td>
      <td>
        <details>
          <summary>JSON</summary>
          <pre className="json-block">{pretty({
            request: call.requestJson,
            response: call.responseJson,
            usage: call.usageJson
          })}</pre>
        </details>
      </td>
    </tr>
  );
}

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}
