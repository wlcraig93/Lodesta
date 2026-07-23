import Link from "next/link";
import { DomainConnectForm } from "@/components/DomainConnectForm";
import { DomainRefreshButton } from "@/components/DomainRefreshButton";
import { RedirectRulesPanel } from "@/components/RedirectRulesPanel";
import { WorkspacePageHeader, WorkspaceStatus, humanize } from "@/components/OwnerWorkspaceUI";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/settings`);
  const [domains, redirects] = await Promise.all([
    platformOperationsRepository.listDomains(context.site.id),
    platformOperationsRepository.listRedirects(context.site.id)
  ]);
  const publishedVersion = context.site.publishedVersionId ? await sitePlatformRepository.getSiteVersion(context.site.publishedVersionId) : undefined;
  const publishedArtifact = publishedVersion ? await sitePlatformRepository.getBuildArtifact(publishedVersion.artifactId) : undefined;
  const routes = publishedArtifact?.routes.map((route) => ({ path: route.path, title: route.title })) ?? [];

  return (
    <main className="workspace-page workspace-settings-page">
      <WorkspacePageHeader eyebrow="Settings" title="Site settings" description="Domains, redirects, and account access for this website." />
      <section className="workspace-settings-section" id="domain">
        <div className="workspace-settings-intro"><span>Domain</span><h2>Connect the address customers know</h2><p>Prove control with DNS, then point the hostname to Lodesta. Your Lodesta URL stays available throughout setup.</p></div>
        <div className="workspace-settings-content">
          <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Custom hostname</span><h3>Connect domain</h3></div></div><DomainConnectForm siteId={context.site.id} /></section>
          <section className="workspace-panel">
            <div className="workspace-panel-heading"><div><span>Registered</span><h3>Hostnames</h3></div><WorkspaceStatus tone={domains.some((domain) => domain.status === "active") ? "success" : "neutral"}>{domains.length}</WorkspaceStatus></div>
            <div className="workspace-domain-list">
              {domains.map((domain) => (
                <article key={domain.id}>
                  <div><strong>{domain.hostname}</strong><span>Custom hostname</span></div>
                  <WorkspaceStatus tone={domain.status === "active" ? "success" : "attention"}>{humanize(domain.status)}</WorkspaceStatus>
                  {domain.status === "attention_required" ? <p className="form-status">This hostname is no longer routing safely. Recheck DNS to restore it.</p> : null}
                  <dl>
                    <dt>TXT ownership record</dt>
                    <dd><code>{domain.verificationName}</code></dd>
                    <dd><code>{domain.verificationValue}</code></dd>
                    <dt>CNAME or ALIAS routing record</dt>
                    <dd><code>{domain.routingName}</code></dd>
                    <dd><code>{domain.routingTarget}</code></dd>
                    <dt>Progress</dt>
                    <dd>Ownership: {humanize(domain.ownershipProofStatus)} · Routing: {humanize(domain.routingStatus)} · Cloudflare: {humanize(domain.providerStatus)} · Certificate: {humanize(domain.certificateStatus)}</dd>
                  </dl>
                  <DomainRefreshButton domainId={domain.id} />
                </article>
              ))}
              {!domains.length ? <div className="workspace-empty-state"><strong>No custom domain connected</strong><p>The Lodesta site URL remains available until you add one.</p></div> : null}
            </div>
          </section>
        </div>
      </section>

      <section className="workspace-settings-section" id="redirects">
        <div className="workspace-settings-intro"><span>Redirects</span><h2>Keep old links useful</h2><p>Send retired paths to a published page so customers and search engines do not reach a dead end.</p></div>
        <div className="workspace-settings-content is-single"><section className="workspace-panel"><RedirectRulesPanel siteId={context.site.id} redirects={redirects} routes={routes} /></section></div>
      </section>

      <section className="workspace-settings-section" id="access">
        <div className="workspace-settings-intro"><span>Access</span><h2>Manage your account</h2><p>Personal sign-in and security settings apply across every website you own.</p></div>
        <div className="workspace-settings-content is-single">
          <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Account</span><h3>Personal access</h3></div></div><p className="muted">Review the signed-in account or switch among websites you can manage.</p><div className="button-row"><Link className="button secondary" href="/account/settings">Account settings</Link>{context.options.length > 1 ? <Link className="button secondary" href="/account">Switch site</Link> : null}</div></section>
        </div>
      </section>
    </main>
  );
}
