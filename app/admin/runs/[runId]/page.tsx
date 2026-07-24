import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { RunTelemetryInspector } from "@/components/admin/RunTelemetryInspector";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";
import { statusTone } from "@/lib/product-format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requireAdminPageAccess(`/admin/runs/${runId}`);
  const record = await sitePlatformRepository.getAgentRunAdminRecord(runId);
  if (!record) notFound();
  if (!record.run) {
    return <main className="admin-page">
      <AdminPageHeader eyebrow="Stale run" title="Run cannot be parsed" description={record.id} actions={<Link className="button secondary" href="/admin/runs">Activity</Link>} />
      <section className="panel"><p className="error-text">{record.issue ?? "stale schema - rebuild"}</p><p className="muted">This internal run predates the active contract. Rebuild the site instead of interpreting stale run data.</p></section>
    </main>;
  }
  const run = record.run;
  const [site, events] = await Promise.all([
    sitePlatformRepository.getSite(run.siteId),
    sitePlatformRepository.listAgentRunEvents(run.id, { limit: 500 })
  ]);
  return <main className="admin-page admin-run-detail-page">
    <AdminPageHeader
      eyebrow={<span className={`badge is-${statusTone(run.status)}`}>{run.status.replaceAll("_", " ")}</span>}
      title={run.kind.replaceAll("_", " ")}
      description={run.id}
      actions={<div className="button-row">
        <Link className="button secondary" href="/admin/runs">Activity</Link>
        {site ? <Link className="button secondary" href={`/workspace/${site.slug}/editor`}>Workspace</Link> : null}
      </div>}
    />
    <RunTelemetryInspector initialRun={run} initialEvents={events} siteSlug={site?.slug} />
  </main>;
}
