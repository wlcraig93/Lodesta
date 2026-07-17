import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceConfirmationForm } from "@/components/EvidenceConfirmationForm";
import { ManagedSiteRegenerateButton } from "@/components/ManagedSiteRegenerateButton";
import { managedSiteStatus } from "@/lib/managed-site-status";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ManagedStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/status/${slug}`);
  const controlPlane = await repository.getCanonicalControlPlane(bundle.businessProfile.siteId);
  const status = managedSiteStatus(bundle, controlPlane);
  const pending = controlPlane?.state.proof.filter((item) => item.status === "observed") ?? [];

  return (
    <main className="admin-page owner-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-page-eyebrow">Managed site status</p>
          <h1>{bundle.businessProfile.name}</h1>
          <p className="owner-page-lede">Current generation, source evidence, and publish state for this managed site.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/editor/${slug}`}>Editor</Link>
          <Link className="button primary" href={`/sites/${slug}`}>View site</Link>
        </div>
      </header>

      <section className="metric-row">
        <Metric label="Generation" value={status.generation.replace("_", " ")} />
        <Metric label="Publish" value={status.publish.replace("_", " ")} />
        <Metric label="Verified evidence" value={status.evidence.accepted} />
        <Metric label="Confirmations" value={status.evidence.pendingConfirmation} />
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Source confirmations</h2>
          <div className="finding-list">
            {pending.map((item) => (
              <article className="finding-card" key={item.id}>
                <div className="button-row">
                  <span className="badge">{item.kind.replace("_", " ")}</span>
                  {sourceUrl(controlPlane, item.sourceSnapshotId) ? <a className="button secondary" href={sourceUrl(controlPlane, item.sourceSnapshotId)} target="_blank" rel="noreferrer">Source</a> : null}
                </div>
                <h3>Confirm before public use</h3>
                <p>{item.sourceExcerpt ?? item.publicText}</p>
                <EvidenceConfirmationForm siteId={bundle.businessProfile.siteId} evidenceId={item.id} />
              </article>
            ))}
            {pending.length === 0 ? <p className="muted">No source-backed claims are waiting for confirmation.</p> : null}
          </div>
        </section>

        <aside className="panel">
          <h2>Current blockers</h2>
          <div className="finding-list">
            {status.blockers.map((blocker) => <article className="finding-card" key={blocker}><p>{blocker}</p></article>)}
            {status.blockers.length === 0 ? <p className="muted">No canonical generation blockers are open.</p> : null}
          </div>
          <h2>Evidence intake</h2>
          <p>{status.evidence.sourceSparse ? "The retained source was sparse, so the site intentionally uses fewer proof claims." : "The retained source provided enough structured text for normal evidence extraction."}</p>
          <h2>Structural changes</h2>
          <p>Service or page changes create a replacement candidate for operator review. The current site stays unchanged until that candidate is approved.</p>
          <ManagedSiteRegenerateButton siteId={bundle.businessProfile.siteId} />
        </aside>
      </div>
    </main>
  );
}

function sourceUrl(controlPlane: Awaited<ReturnType<typeof repository.getCanonicalControlPlane>>, sourceSnapshotId: string | undefined) {
  return controlPlane?.sourceSnapshots.find((source) => source.id === sourceSnapshotId)?.sourceUrl;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}
