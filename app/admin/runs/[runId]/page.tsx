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
  const [site, version, events] = await Promise.all([
    sitePlatformRepository.getSite(run.siteId),
    run.candidateVersionId ? sitePlatformRepository.getSiteVersion(run.candidateVersionId) : undefined,
    sitePlatformRepository.listAgentRunEvents(run.id, { limit: 500 })
  ]);
  const payloads = new Map<string, unknown>();
  const blobStore = configuredArtifactBlobStore();
  for (const event of events) {
    if (!event.payloadRef) continue;
    const blob = await blobStore.get(event.payloadRef);
    payloads.set(event.id, !blob
      ? { expired: true }
      : blob.contentHash !== event.payloadHash
        ? { integrityError: true }
        : JSON.parse(blob.bytes.toString("utf8")));
  }
  const contactSheets = (run.screenshotKeys ?? []).filter((key) => key.endsWith("/contact-sheet.png"));
  const modelUsage = run.usage.kind === "model_reported" ? run.usage : undefined;
  return <main className="admin-page">
    <AdminPageHeader eyebrow={<span className={`badge status-${run.status}`}>{run.status}</span>} title={run.kind.replaceAll("_", " ")} description={run.id} actions={<div className="button-row"><Link className="button secondary" href="/admin/runs">Activity</Link>{site ? <Link className="button secondary" href={`/workspace/${site.slug}/editor`}>Workspace</Link> : null}{version ? <Link className="button primary" href={`/api/site-versions/${version.id}/artifact/`}>Candidate</Link> : null}</div>} />
    <section className="metric-row"><Metric label="Stage" value={run.stage} /><Metric label="Execution" value={run.executionNumber} /><Metric label="Model tokens" value={modelUsage ? (modelUsage.inputTokens + modelUsage.outputTokens).toLocaleString() : "Unavailable"} /><Metric label="Reasoning tokens" value={modelUsage?.reasoningTokens.toLocaleString() ?? "Unavailable"} /><Metric label={`Cost · ${modelUsage ? costSourceLabel(modelUsage.costSource) : "external"}`} value={modelUsage && modelUsage.costSource !== "unavailable" ? `$${modelUsage.costUsd.toFixed(4)}` : "Unavailable"} /><Metric label="Execution time" value={`${Math.round(run.usage.durationMs / 1000)}s`} /></section>
    <div className="admin-grid">
      <section className="panel"><h2>Run events</h2><div className="timeline-list">{events.map((event) => <article className="timeline-item" key={event.id}><span className={`badge status-${event.status}`}>{event.status}</span><div><strong>{event.name}</strong><small>{event.kind} · #{event.sequence} · {event.completedAt ? duration(event.startedAt, event.completedAt) : "running"}</small><details><summary>Summary{payloads.has(event.id) ? " and payload" : ""}</summary><pre className="json-block">{JSON.stringify({ summary: event.summary, route: event.apiProvider ? { apiProvider: event.apiProvider, requestedModel: event.modelId, servedModel: event.servedModelId, upstreamProvider: event.upstreamProvider, providerRequestId: event.providerRequestId } : undefined, usage: event.inputTokens === undefined ? undefined : { input: event.inputTokens, cached: event.cachedInputTokens, reasoning: event.reasoningTokens, output: event.outputTokens, costUsd: event.costUsd, costSource: event.costSource, upstreamInferenceCostUsd: event.upstreamInferenceCostUsd }, errorCode: event.errorCode, payload: payloads.get(event.id) }, null, 2)}</pre></details></div></article>)}{!events.length ? <p className="muted">No run events recorded.</p> : null}</div></section>
      <aside className="panel"><h2>Result</h2><dl className="detail-list"><dt>Site</dt><dd>{site?.slug ?? run.siteId}</dd><dt>Execution driver</dt><dd>{run.executionDriver}</dd><dt>API provider</dt><dd>{run.apiProvider ?? "External"}</dd><dt>Requested model</dt><dd>{run.modelId ?? run.externalProvenance?.clientReportedModelId ?? "Unverified"}</dd><dt>Parent revision</dt><dd>{run.exactParentRevisionId ?? "Initial"}</dd><dt>Output revision</dt><dd>{run.outputRevisionId ?? "None"}</dd><dt>Artifact</dt><dd>{run.outputArtifactId ?? "None"}</dd><dt>Candidate</dt><dd>{run.candidateVersionId ?? "None"}</dd><dt>Failure category</dt><dd>{run.failureCategory ?? "None"}</dd><dt>Failure code</dt><dd>{run.failureCode ?? "None"}</dd><dt>Owner retry</dt><dd>{run.retryableByOwner ? "Allowed" : "Not allowed"}</dd><dt>Failure diagnostic</dt><dd>{run.failureReason ?? "None"}</dd><dt>Input limit</dt><dd>{run.limits?.maxInputTokens.toLocaleString() ?? "Unavailable for this run"}</dd><dt>Output limit</dt><dd>{run.limits?.maxOutputTokens.toLocaleString() ?? "Unavailable for this run"}</dd><dt>Time limit</dt><dd>{run.limits ? `${Math.round(run.limits.maxDurationMs / 60_000)}m` : "Unavailable for this run"}</dd></dl></aside>
    </div>
    <section className="panel"><h2>Model usage by turn</h2><div className="table-wrap"><table><thead><tr><th>Turn</th><th>Route</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Duration</th></tr></thead><tbody>{events.filter((event) => event.kind === "model_request").map((event) => <tr key={event.id}><td>{event.turnIndex ?? "-"}</td><td>{event.apiProvider ?? "-"}<small>{event.upstreamProvider ?? "—"}</small></td><td>{event.modelId ?? "-"}{event.servedModelId && event.servedModelId !== event.modelId ? <small>served {event.servedModelId}</small> : null}</td><td>{(event.inputTokens ?? 0).toLocaleString()} in · {(event.outputTokens ?? 0).toLocaleString()} out<small>{(event.cachedInputTokens ?? 0).toLocaleString()} cached · {(event.reasoningTokens ?? 0).toLocaleString()} reasoning</small></td><td>{event.costSource && event.costSource !== "unavailable" ? `$${(event.costUsd ?? 0).toFixed(4)}` : "—"}<small>{event.costSource ? costSourceLabel(event.costSource) : "—"}</small></td><td>{event.modelDurationMs !== undefined ? `${Math.round(event.modelDurationMs / 1000)}s` : event.completedAt ? duration(event.startedAt, event.completedAt) : "running"}</td></tr>)}</tbody></table></div></section>
    {contactSheets.length ? <section className="panel"><h2>Verification captures</h2><div className="capture-grid">{contactSheets.map((key) => <figure key={key}><img src={`/api/admin/runs/${run.id}/captures?key=${encodeURIComponent(key)}`} alt="Run verification contact sheet" /></figure>)}</div></section> : null}
    <section className="panel"><h2>Run record</h2><details><summary>Raw JSON</summary><pre className="json-block">{JSON.stringify(run, null, 2)}</pre></details></section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>; }
function duration(start: string, end: string) { return `${Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))}s`; }
function costSourceLabel(source: "provider_reported" | "catalog_estimate" | "mixed" | "unavailable") { return source.replaceAll("_", " "); }
