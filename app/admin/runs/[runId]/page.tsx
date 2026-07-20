import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAdminPageAccess(`/admin/runs/${runId}`);
  const run = await sitePlatformRepository.getAgentRun(runId);
  if (!run) notFound();
  const [site, version] = await Promise.all([
    sitePlatformRepository.getSite(run.siteId),
    run.candidateVersionId ? sitePlatformRepository.getSiteVersion(run.candidateVersionId) : undefined
  ]);
  const contactSheets = run.attempts.flatMap((attempt) => attempt.screenshotKeys ?? []).filter((key) => key.endsWith("/contact-sheet.png"));
  return <main className="admin-page">
    <AdminPageHeader eyebrow={<span className={`badge status-${run.status}`}>{run.status}</span>} title={run.kind.replaceAll("_", " ")} description={run.id} actions={<div className="button-row"><Link className="button secondary" href="/admin/runs">Activity</Link>{site ? <Link className="button secondary" href={`/editor/${site.slug}`}>Workspace</Link> : null}{version ? <Link className="button primary" href={`/api/site-versions/${version.id}/artifact/`}>Candidate</Link> : null}</div>} />
    <section className="metric-row"><Metric label="Stage" value={run.stage} /><Metric label="Attempt" value={run.attempt} /><Metric label="Model tokens" value={run.usage.inputTokens + run.usage.outputTokens} /><Metric label="Model time" value={`${Math.round(run.usage.durationMs / 1000)}s`} /></section>
    <div className="admin-grid">
      <section className="panel"><h2>Tool trace</h2><div className="timeline-list">{run.toolCalls.map((tool) => <article className="timeline-item" key={tool.id}><span className={`badge status-${tool.status}`}>{tool.status}</span><div><strong>{tool.name}</strong><small>{tool.inputHash.slice(0, 20)} · {tool.completedAt ? duration(tool.startedAt, tool.completedAt) : "running"}</small></div></article>)}{!run.toolCalls.length ? <p className="muted">No tool calls recorded.</p> : null}</div></section>
      <aside className="panel"><h2>Result</h2><dl className="detail-list"><dt>Site</dt><dd>{site?.slug ?? run.siteId}</dd><dt>Parent revision</dt><dd>{run.exactParentRevisionId ?? "Initial"}</dd><dt>Output revision</dt><dd>{run.outputRevisionId ?? "None"}</dd><dt>Candidate</dt><dd>{run.candidateVersionId ?? "None"}</dd><dt>Failure</dt><dd>{run.failureReason ?? "None"}</dd></dl></aside>
    </div>
    {run.subjectiveReview ? <section className="panel"><h2>Visual review</h2><div className="button-row"><span className={`badge status-${run.subjectiveReview.verdict === "ship" ? "ready" : "warning"}`}>{run.subjectiveReview.verdict}</span><span>{run.subjectiveReview.modelId}</span></div><p>{run.subjectiveReview.summary}</p><div className="finding-list">{run.subjectiveReview.findings.map((finding, index) => <article className="finding-card" key={`${finding.route}-${index}`}><span className="badge">{finding.area} · {finding.severity}</span><h3>{finding.route}</h3><p>{finding.message}</p></article>)}</div></section> : null}
    {contactSheets.length ? <section className="panel"><h2>Attempt captures</h2><div className="capture-grid">{contactSheets.map((key, index) => <figure key={key}><img src={`/api/admin/runs/${run.id}/captures?key=${encodeURIComponent(key)}`} alt={`Run attempt ${index + 1} contact sheet`} /><figcaption>Attempt {index + 1}</figcaption></figure>)}</div></section> : null}
    <section className="panel"><h2>Run record</h2><details><summary>Raw JSON</summary><pre className="json-block">{JSON.stringify(run, null, 2)}</pre></details></section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>; }
function duration(start: string, end: string) { return `${Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))}s`; }
