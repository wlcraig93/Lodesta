import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
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

  const generationUrl = typeof detail.run.metadata?.generationUrl === "string" ? detail.run.metadata.generationUrl : undefined;
  const generationId = detail.run.targetType === "site_generation" ? detail.run.targetId : undefined;

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow={<span className={`badge status-${detail.run.status}`}>{detail.run.status}</span>}
        title="Run inspector"
        description={detail.run.outputSummary ?? detail.run.inputSummary ?? detail.run.id}
        actions={
          <AdminButtonRow>
            <AdminButtonLink variant="secondary" href="/admin/runs">
              Runs
            </AdminButtonLink>
            {generationUrl ? (
              <AdminButtonLink variant="secondary" href={generationUrl}>
                Site generation
              </AdminButtonLink>
            ) : null}
          </AdminButtonRow>
        }
      />

      <section className="run-inspector-identifiers" aria-label="Run identifiers">
        <div>
          <span>Run ID</span>
          <code>{detail.run.id}</code>
        </div>
        {generationId ? (
          <div>
            <span>Generation ID</span>
            <code>{generationId}</code>
          </div>
        ) : null}
      </section>

      <section className="metric-row run-inspector-metrics">
        <div className="metric-card">
          <strong>{formatDate(detail.run.startedAt)}</strong>
          <span>Started</span>
        </div>
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

function formatDate(input: string) {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}
