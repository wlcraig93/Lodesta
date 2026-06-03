import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteVersionsPanel } from "@/components/SiteVersionsPanel";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { claimGateForBundle } from "@/lib/site-publication";

export const dynamic = "force-dynamic";

export default async function VersionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/versions/${slug}`);

  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const claimGate = claimGateForBundle(bundle, claims);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Versions</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>Review generated drafts and rollback safely by making any previous version live again.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/optimization/${bundle.siteModel.slug}`}>
            Optimization
          </Link>
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <section className="panel">
        <h2>Version History</h2>
        <SiteVersionsPanel
          siteId={bundle.businessProfile.siteId}
          versions={bundle.siteModel.versions}
          publishDisabled={!claimGate.ok}
          publishDisabledReason={claimGate.ok ? undefined : claimGate.reason}
        />
      </section>
    </main>
  );
}
