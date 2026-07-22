import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAdminPageAccess(`/admin/runs/${runId}`);
  const record = await sitePlatformRepository.getAgentRunAdminRecord(runId);
  if (!record) notFound();
  if (!record.run) return <main className="admin-page"><AdminPageHeader eyebrow="Stale run" title="Run cannot be parsed" description={record.id} actions={<Link className="button secondary" href="/admin/runs">Activity</Link>} /><section className="panel"><p className="error-text">{record.issue ?? "stale schema - rebuild"}</p><p className="muted">This internal run predates the active contract. Rebuild the site instead of interpreting stale run data.</p></section></main>;
  const run = record.run;
  const objective = await sitePlatformRepository.getEditObjective(run.id);
  const [site, version, runSpans, preflightSpans] = await Promise.all([
    sitePlatformRepository.getSite(run.siteId),
    run.candidateVersionId ? sitePlatformRepository.getSiteVersion(run.candidateVersionId) : undefined,
    sitePlatformRepository.listTraceSpans(run.id, { limit: 500 }),
    objective ? sitePlatformRepository.listTraceSpans(objective.requestId, { limit: 50 }) : []
  ]);
  const spans = [...preflightSpans, ...runSpans];
  const payloads = new Map<string, unknown>();
  const blobStore = configuredArtifactBlobStore();
  for (const span of spans) {
    if (!span.payloadRef) continue;
    const blob = await blobStore.get(span.payloadRef);
    payloads.set(span.id, !blob
      ? { expired: true }
      : blob.contentHash !== span.payloadHash
        ? { integrityError: true }
        : JSON.parse(blob.bytes.toString("utf8")));
  }
  const depths = traceDepths(spans);
  const contactSheets = run.attempts.flatMap((attempt) => attempt.screenshotKeys ?? []).filter((key) => key.endsWith("/contact-sheet.png"));
  return <main className="admin-page">
    <AdminPageHeader eyebrow={<span className={`badge status-${run.status}`}>{run.status}</span>} title={run.kind.replaceAll("_", " ")} description={run.id} actions={<div className="button-row"><Link className="button secondary" href="/admin/runs">Activity</Link>{site ? <Link className="button secondary" href={`/workspace/${site.slug}/website`}>Workspace</Link> : null}{version ? <Link className="button primary" href={`/api/site-versions/${version.id}/artifact/`}>Candidate</Link> : null}</div>} />
    <section className="metric-row"><Metric label="Stage" value={run.stage} /><Metric label="Attempt" value={run.attempt} /><Metric label="Model tokens" value={run.usage.inputTokens + run.usage.outputTokens} /><Metric label="Model time" value={`${Math.round(run.usage.durationMs / 1000)}s`} /></section>
    <div className="admin-grid">
      <section className="panel"><h2>Execution trace</h2><div className="timeline-list">{spans.map((span) => <article className="timeline-item" key={span.id} style={{ marginLeft: `${Math.min(depths.get(span.id) ?? 0, 5) * 18}px` }}><span className={`badge status-${span.status}`}>{span.status}</span><div><strong>{span.name}</strong><small>{span.kind} · #{span.sequence} · {span.completedAt ? duration(span.startedAt, span.completedAt) : "running"}</small><details><summary>Summary{payloads.has(span.id) ? " and payload" : ""}</summary><pre className="json-block">{JSON.stringify({ summary: span.summary, usage: span.inputTokens === undefined ? undefined : { input: span.inputTokens, cached: span.cachedInputTokens, output: span.outputTokens }, errorCode: span.errorCode, payload: payloads.get(span.id) }, null, 2)}</pre></details></div></article>)}{!spans.length ? <p className="muted">No trace spans recorded.</p> : null}</div></section>
      <aside className="panel"><h2>Result</h2><dl className="detail-list"><dt>Site</dt><dd>{site?.slug ?? run.siteId}</dd><dt>Parent revision</dt><dd>{run.exactParentRevisionId ?? "Initial"}</dd><dt>Output revision</dt><dd>{run.outputRevisionId ?? "None"}</dd><dt>Candidate</dt><dd>{run.candidateVersionId ?? "None"}</dd><dt>Objective</dt><dd>{objective?.requestedOutcome ?? "Initial or system run"}</dd><dt>Failure</dt><dd>{run.failureReason ?? "None"}</dd></dl></aside>
    </div>
    <section className="panel"><h2>Model usage by turn</h2><div className="table-wrap"><table><thead><tr><th>Turn</th><th>Model</th><th>Tokens</th><th>Cached input</th><th>Duration</th></tr></thead><tbody>{spans.filter((span) => span.kind === "model_request").map((span) => <tr key={span.id}><td>{span.turnIndex ?? "-"}</td><td>{span.modelId ?? "-"}</td><td>{(span.inputTokens ?? 0).toLocaleString()} in · {(span.outputTokens ?? 0).toLocaleString()} out</td><td>{(span.cachedInputTokens ?? 0).toLocaleString()}</td><td>{span.completedAt ? duration(span.startedAt, span.completedAt) : "running"}</td></tr>)}</tbody></table></div></section>
    {run.subjectiveReview ? <section className="panel"><h2>Visual review</h2><div className="button-row"><span className={`badge status-${run.subjectiveReview.verdict === "ship" ? "ready" : "warning"}`}>{run.subjectiveReview.verdict}</span><span>{run.subjectiveReview.modelId}</span></div><p>{run.subjectiveReview.summary}</p><div className="finding-list">{run.subjectiveReview.findings.map((finding, index) => <article className="finding-card" key={`${finding.route}-${index}`}><span className="badge">{finding.area} · {finding.severity}</span><h3>{finding.route}</h3><p>{finding.message}</p></article>)}</div></section> : null}
    {contactSheets.length ? <section className="panel"><h2>Attempt captures</h2><div className="capture-grid">{contactSheets.map((key, index) => <figure key={key}><img src={`/api/admin/runs/${run.id}/captures?key=${encodeURIComponent(key)}`} alt={`Run attempt ${index + 1} contact sheet`} /><figcaption>Attempt {index + 1}</figcaption></figure>)}</div></section> : null}
    <section className="panel"><h2>Run record</h2><details><summary>Raw JSON</summary><pre className="json-block">{JSON.stringify(run, null, 2)}</pre></details></section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>; }
function duration(start: string, end: string) { return `${Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))}s`; }
function traceDepths(spans: Array<{ id: string; parentSpanId?: string }>) {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const depths = new Map<string, number>();
  for (const span of spans) {
    let depth = 0;
    let parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
    const seen = new Set<string>();
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); depth += 1; parent = parent.parentSpanId ? byId.get(parent.parentSpanId) : undefined; }
    depths.set(span.id, depth);
  }
  return depths;
}
