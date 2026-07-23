import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";
import { OperatorQueueActions } from "@/components/admin/OperatorQueueActions";
import { deriveSitePublicationReadiness } from "@/packages/site-platform";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OperatorReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  await requireAdminPageAccess(`/admin/site-queue/${reviewId}`);
  const queue = await sitePlatformRepository.listOperatorQueue();
  const item = queue.find((candidate) => candidate.id === reviewId);
  const directVersion = await sitePlatformRepository.getSiteVersion(reviewId);
  const version = directVersion ?? (item?.versionId ? await sitePlatformRepository.getSiteVersion(item.versionId) : undefined);
  const run = item?.runId ? await sitePlatformRepository.getAgentRun(item.runId) : undefined;
  const siteId = version?.siteId ?? item?.siteId ?? run?.siteId;
  if (!siteId) notFound();
  const site = await sitePlatformRepository.getSite(siteId);
  if (!site) notFound();
  const artifact = version ? await sitePlatformRepository.getBuildArtifact(version.artifactId) : undefined;
  const readiness = version ? await deriveSitePublicationReadiness({ versionId: version.id, repository: sitePlatformRepository }) : undefined;
  const failedContactSheet = run?.screenshotKeys?.filter((key) => key.endsWith("/contact-sheet.png")).at(-1);

  return <main className="admin-page">
    <header className="admin-header"><div><span className="badge">Operator review</span><h1>{site.slug}</h1><p>{item?.reason.replaceAll("_", " ") ?? `Candidate version ${version?.number}`}</p></div>
      <div className="button-row"><Link className="button secondary" href="/admin/site-queue">Back to queue</Link><Link className="button secondary" href={`/workspace/${site.slug}/website`}>Open workspace</Link></div></header>
    <div className="admin-grid">
      <section className="panel"><h2>Artifact</h2>{version ? <div className="admin-artifact-frame"><iframe title={`${site.slug} candidate`} src={`/api/site-versions/${version.id}/artifact/`} /></div> : failedContactSheet && run ? <figure><img className="operator-contact-sheet" src={`/api/admin/runs/${run.id}/captures?key=${encodeURIComponent(failedContactSheet)}`} alt="Failed candidate contact sheet" /><figcaption>Final failed execution</figcaption></figure> : <p className="muted">This run did not produce a candidate artifact.</p>}</section>
      <aside className="panel"><h2>Decision</h2>
        {version ? <dl className="detail-list"><dt>Version</dt><dd>{version.number} · {version.status}</dd><dt>Hard gate</dt><dd>{artifact?.qa.hardGate ?? "unavailable"}</dd><dt>Routes checked</dt><dd>{artifact?.qa.routesChecked ?? "unavailable"}</dd></dl> : null}
        {run ? <><dl className="detail-list"><dt>Run</dt><dd>{run.status} · {run.stage}</dd><dt>Model</dt><dd>{run.modelId}</dd><dt>Failure</dt><dd>{run.failureCategory ?? "unknown"} · {run.failureCode ?? "unclassified"}</dd><dt>Estimated cost</dt><dd>{run.usage.costEstimateStatus === "configured" ? `$${run.usage.estimatedCostUsd.toFixed(4)}` : "Unavailable"}</dd><dt>Diagnostic</dt><dd>{run.failureReason ?? "None"}</dd></dl><Link className="button secondary" href={`/admin/runs/${run.id}`}>Run diagnostics</Link></> : null}
        {readiness ? <><h3>Publication readiness</h3><ul>{readiness.blockers.map((blocker) => <li key={`${blocker.code}:${blocker.referenceId ?? "site"}`}>{blocker.message}</li>)}{readiness.status === "ready" ? <li>All publication checks pass.</li> : null}</ul></> : null}
        <OperatorQueueActions queueItem={item} version={version} readiness={readiness} />
      </aside>
    </div>
    <section className="panel"><h2>Findings</h2><pre className="json-block">{JSON.stringify(item?.findings ?? artifact?.qa.findings ?? [], null, 2)}</pre></section>
  </main>;
}
