import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainConnectForm } from "@/components/DomainConnectForm";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function DomainsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/domains/${slug}`);

  const domains = await repository.listDomains(bundle.businessProfile.siteId);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Domains</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>
            Register custom hostnames for claimed sites. In production this path creates Cloudflare for SaaS custom
            hostnames and returns the verification record the owner needs to add.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>Connect domain</h2>
          <DomainConnectForm siteId={bundle.businessProfile.siteId} />
        </section>

        <aside className="panel">
          <h2>Registered hostnames</h2>
          <div className="finding-list">
            {domains.map((domain) => (
              <article key={domain.id} className="finding-card">
                <span className="badge">{domain.status}</span>
                <h3>{domain.hostname}</h3>
                <p>{domain.provider.replaceAll("_", " ")}</p>
                {domain.verification ? (
                  <div className="dns-instruction">
                    <strong>{domain.verification.type.toUpperCase()} verification</strong>
                    <code>{domain.verification.value}</code>
                    <p>{domain.verification.note}</p>
                  </div>
                ) : null}
                {domain.providerHostnameId ? <p>Provider ID: {domain.providerHostnameId}</p> : null}
              </article>
            ))}
            {domains.length === 0 ? <p className="muted">No custom domains registered yet.</p> : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
