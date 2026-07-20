import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainConnectForm } from "@/components/DomainConnectForm";
import { RedirectRulesPanel } from "@/components/RedirectRulesPanel";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { requirePlatformSiteOwnerAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function DomainsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  await requirePlatformSiteOwnerAccess(site.id, `/domains/${slug}`);

  const siteId = site.id;
  const [domains, claims, state, redirects] = await Promise.all([
    repository.listDomains(siteId),
    repository.listClaims(siteId),
    sitePlatformRepository.getBusinessState(site.businessId),
    repository.listRedirects(siteId)
  ]);
  const claimed = claims.some((claim) => claim.status === "claimed");
  const publishedVersion = site.publishedVersionId ? await sitePlatformRepository.getSiteVersion(site.publishedVersionId) : undefined;
  const publishedArtifact = publishedVersion ? await sitePlatformRepository.getBuildArtifact(publishedVersion.artifactId) : undefined;
  const publishedRoutes = publishedArtifact?.routes.map((route) => ({ path: route.path, title: route.title })) ?? [];

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Domains</span>
          <h1>{state?.identity.name ?? slug}</h1>
          <p>
            Register custom hostnames for claimed sites. In production this path creates Cloudflare for SaaS custom
            hostnames and returns the verification record the owner needs to add. Activation may take up to 30 seconds
            to apply across all servers.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/editor/${site.slug}`}>
            Editor
          </Link>
          <Link className="button primary" href={`/sites/${site.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>Connect domain</h2>
          <DomainConnectForm
            siteId={siteId}
            disabled={!claimed}
            disabledReason={claimed ? undefined : "The site must be claimed before connecting a domain."}
          />
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

      <section className="panel admin-section">
        <h2>Redirects</h2>
        <RedirectRulesPanel siteId={siteId} redirects={redirects} routes={publishedRoutes} />
      </section>
    </main>
  );
}
