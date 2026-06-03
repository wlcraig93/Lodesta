import Link from "next/link";
import { notFound } from "next/navigation";
import { BusinessProfileForm } from "@/components/BusinessProfileForm";
import { OwnerAssetsForm } from "@/components/OwnerAssetsForm";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function BusinessProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/business/${slug}`);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Business facts</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>Owner-confirmed facts power schema, contact paths, generated copy, forms, and future presence sync.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button secondary" href={`/claim/${bundle.siteModel.slug}`}>
            Claim
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>Edit owner-truth fields</h2>
          <BusinessProfileForm profile={bundle.businessProfile} />
        </section>

        <aside className="panel">
          <h2>Owner-approved assets</h2>
          <OwnerAssetsForm profile={bundle.businessProfile} />

          <h2>Verification state</h2>
          <div className="finding-list">
            {Object.entries(bundle.businessProfile.provenance).map(([key, provenance]) => (
              <article key={key} className="finding-card">
                <span className={`badge ${provenance.verified ? "severity-pass" : "severity-warning"}`}>
                  {provenance.verified ? "verified" : "pending"}
                </span>
                <h3>{key}</h3>
                <p>
                  Source: {provenance.source}. Confidence: {Math.round(provenance.confidence * 100)}%.
                </p>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
