import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { formatProductDate } from "@/lib/product-format";
import { sitePlatformRepository } from "@/packages/platform-data";
import { websiteSourceSnapshotPayloadSchema } from "@/packages/site-contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminSourceSnapshotPage(input: {
  params: Promise<{ snapshotId: string }>;
  searchParams: Promise<{ outcome?: string; role?: string; path?: string; status?: string; reason?: string }>;
}) {
  const { snapshotId } = await input.params;
  await requireAdminPageAccess(`/admin/source-snapshots/${snapshotId}`);
  const snapshot = await sitePlatformRepository.getSourceSnapshot(snapshotId);
  if (!snapshot) notFound();
  const payload = websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload);
  if (!payload.success) {
    return <main className="admin-page">
      <AdminPageHeader eyebrow="Source mirror" title={snapshot.sourceUrl ?? snapshot.id} description={`${snapshot.id} · captured ${formatProductDate(snapshot.capturedAt)}`} actions={<Link className="button secondary" href="/admin/sites">Manage sites</Link>} />
      <section className="panel"><h2>Stale schema — recapture required</h2><p className="muted">This retained source snapshot does not match the current replayable-mirror contract. Recreate or recapture its site before inspecting it.</p></section>
    </main>;
  }
  const [pages, resources] = await Promise.all([
    sitePlatformRepository.listSourceSnapshotPages(snapshotId),
    sitePlatformRepository.listSourceSnapshotResources(snapshotId)
  ]);
  const filters = await input.searchParams;
  const filteredPages = pages.filter((page) =>
    (!filters.outcome || page.outcome === filters.outcome)
    && (!filters.path || page.path.toLocaleLowerCase().includes(filters.path.toLocaleLowerCase()))
    && (!filters.status || String(page.status ?? "") === filters.status)
    && (!filters.reason || page.reason === filters.reason)
  );
  const filteredResources = resources.filter((resource) => !filters.role || resource.role === filters.role);
  const replayPage = filteredPages.find((page) => page.path === "/" && page.outcome === "fetched")
    ?? filteredPages.find((page) => page.outcome === "fetched");
  const rawBytes = resources.reduce((total, resource) => total + resource.rawBytes, 0);
  const storedBytes = resources.reduce((total, resource) => total + resource.storedBytes, 0);
  const statuses = countedValues(pages.flatMap((page) => page.status === undefined ? [] : [String(page.status)]));
  const reasons = countedValues(pages.flatMap((page) => page.reason ? [page.reason] : []));
  const retryCount = resources.reduce((total, resource) => total + metadataNumber(resource.metadata, "retryCount"), 0);
  const retryWaitMs = resources.reduce((total, resource) => total + metadataNumber(resource.metadata, "retryWaitMs"), 0);
  const throttleEvents = resources.reduce((total, resource) => total + metadataNumber(resource.metadata, "throttleEvents"), 0);
  const throttledResources = resources.filter((resource) => metadataNumber(resource.metadata, "throttleEvents") > 0).length;
  return <main className="admin-page">
    <AdminPageHeader eyebrow="Source mirror" title={snapshot.sourceUrl ?? snapshot.id} description={`${snapshot.id} · captured ${formatProductDate(snapshot.capturedAt)}`} actions={<div className="button-row"><Link className="button secondary" href="/admin/sites">Manage sites</Link>{replayPage ? <Link className="button primary" href={`/api/admin/source-snapshots/${snapshot.id}/replay${replayPage.path === "/" ? "" : replayPage.path}`} target="_blank">Replay source</Link> : null}</div>} />
    <section className="metric-row"><Metric label="Coverage" value={payload.data.coverage} /><Metric label="Pages" value={pages.length} /><Metric label="Resources" value={resources.length} /><Metric label="Retries" value={retryCount} /><Metric label="Throttle events" value={throttleEvents} /><Metric label="Browser fallbacks" value={payload.data.counts.browserRendered} /></section>
    <section className="panel"><h2>Capture telemetry</h2><dl className="detail-list"><dt>Completion</dt><dd>{payload.data.completionReason}</dd><dt>Raw / stored bytes</dt><dd>{rawBytes.toLocaleString()} / {storedBytes.toLocaleString()}</dd><dt>Unique blobs</dt><dd>{payload.data.counts.uniqueBlobs}</dd><dt>Retry wait</dt><dd>{retryWaitMs.toLocaleString()} ms across {throttledResources.toLocaleString()} throttled resources</dd><dt>Terminal statuses</dt><dd>{formattedCounts(statuses)}</dd><dt>Terminal reasons</dt><dd>{formattedCounts(reasons)}</dd>{Object.entries(payload.data.stages).map(([stage, duration]) => <Fragment key={stage}><dt>{stage.replace(/([A-Z])/g, " $1")}</dt><dd>{duration.toLocaleString()} ms</dd></Fragment>)}</dl></section>
    <section className="panel"><div className="section-heading-row"><div><h2>Page manifest</h2><p className="muted">Every discovered document has a terminal outcome and retained source identity.</p></div><span className="badge">{filteredPages.length} shown</span></div><form className="button-row" method="get"><label>Path <input name="path" defaultValue={filters.path ?? ""} /></label><label>Outcome <select name="outcome" defaultValue={filters.outcome ?? ""}><option value="">All</option><option value="fetched">Fetched</option><option value="excluded">Excluded</option><option value="failed">Failed</option><option value="unfinished">Unfinished</option></select></label><label>Status <select name="status" defaultValue={filters.status ?? ""}><option value="">All</option>{statuses.map(([status, count]) => <option value={status} key={status}>{status} ({count})</option>)}</select></label><label>Reason <select name="reason" defaultValue={filters.reason ?? ""}><option value="">All</option>{reasons.map(([reason, count]) => <option value={reason} key={reason}>{reason.replaceAll("_", " ")} ({count})</option>)}</select></label><label>Resource role <select name="role" defaultValue={filters.role ?? ""}><option value="">All</option>{["document", "rendered_document", "stylesheet", "script", "image", "font", "data", "sitemap", "robots", "other"].map((role) => <option value={role} key={role}>{role}</option>)}</select></label><button className="button secondary" type="submit">Filter</button></form><div className="finding-list">{filteredPages.slice(0, 500).map((page) => <article className="finding-card" key={page.id}><div className="button-row"><span className={`badge is-${page.outcome === "fetched" ? "success" : page.outcome === "excluded" ? "neutral" : "warning"}`}>{page.outcome}</span><span>{page.status ?? "—"}</span><span>{page.indexability}</span></div><h3>{page.title ?? page.path}</h3><p>{page.path} · {page.wordCount.toLocaleString()} words{page.reason ? ` · ${page.reason.replaceAll("_", " ")}` : ""}</p>{page.outcome === "fetched" ? <Link className="button secondary" href={`/api/admin/source-snapshots/${snapshot.id}/replay${page.path === "/" ? "" : page.path}`} target="_blank">Replay</Link> : null}</article>)}</div></section>
    <section className="panel"><div className="section-heading-row"><div><h2>Resource manifest</h2><p className="muted">Documents, stylesheets, images, fonts, scripts, sitemaps, robots, and explicit exclusions.</p></div><span className="badge">{filteredResources.length} shown</span></div><div className="finding-list">{filteredResources.slice(0, 500).map((resource) => <article className="finding-card" key={resource.id}><div className="button-row"><span className="badge">{resource.role}</span><span className={`badge is-${resource.outcome === "fetched" ? "success" : resource.outcome === "excluded" ? "neutral" : "warning"}`}>{resource.outcome}</span></div><p>{resource.requestedUrl}</p><small>{resource.contentType ?? resource.reason ?? "No retained body"} · {resource.rawBytes.toLocaleString()} bytes</small></article>)}</div></section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function countedValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
}

function formattedCounts(values: Array<[string, number]>) {
  return values.length ? values.map(([value, count]) => `${value.replaceAll("_", " ")}: ${count}`).join(" · ") : "None";
}
