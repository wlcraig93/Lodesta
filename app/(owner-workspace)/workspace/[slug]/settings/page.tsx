import Link from "next/link";
import { BillingPortalButton } from "@/components/BillingPortalButton";
import { DomainConnectForm } from "@/components/DomainConnectForm";
import { RedirectRulesPanel } from "@/components/RedirectRulesPanel";
import { WorkspacePageHeader, WorkspaceStatus, humanize } from "@/components/OwnerWorkspaceUI";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/settings`);
  const [domains, claims, redirects] = await Promise.all([
    platformOperationsRepository.listDomains(context.site.id),
    platformOperationsRepository.listClaims(context.site.id),
    platformOperationsRepository.listRedirects(context.site.id)
  ]);
  const claim = claims.find((candidate) => candidate.status === "claimed");
  const publishedVersion = context.site.publishedVersionId ? await sitePlatformRepository.getSiteVersion(context.site.publishedVersionId) : undefined;
  const publishedArtifact = publishedVersion ? await sitePlatformRepository.getBuildArtifact(publishedVersion.artifactId) : undefined;
  const routes = publishedArtifact?.routes.map((route) => ({ path: route.path, title: route.title })) ?? [];

  return (
    <main className="workspace-page workspace-settings-page">
      <WorkspacePageHeader eyebrow="Settings" title="Site settings" description="Domains, redirects, billing, and access for this managed website." />
      <section className="workspace-settings-section" id="domain">
        <div className="workspace-settings-intro"><span>Domain</span><h2>Connect the address customers know</h2><p>Add a custom hostname after the site is claimed. Lodesta keeps serving the verified published version while DNS activates.</p></div>
        <div className="workspace-settings-content">
          <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Custom hostname</span><h3>Connect domain</h3></div></div><DomainConnectForm siteId={context.site.id} disabled={!claim} disabledReason="The site must be claimed before connecting a domain." /></section>
          <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Registered</span><h3>Hostnames</h3></div><WorkspaceStatus tone={domains.some((domain) => domain.status === "active") ? "success" : "neutral"}>{domains.length}</WorkspaceStatus></div><div className="workspace-domain-list">{domains.map((domain) => <article key={domain.id}><div><strong>{domain.hostname}</strong><span>{humanize(domain.provider)}</span></div><WorkspaceStatus tone={domain.status === "active" ? "success" : "attention"}>{humanize(domain.status)}</WorkspaceStatus>{domain.verification ? <dl><dt>{domain.verification.type.toUpperCase()} verification</dt><dd><code>{domain.verification.value}</code></dd><dd>{domain.verification.note}</dd></dl> : null}</article>)}{!domains.length ? <div className="workspace-empty-state"><strong>No custom domain connected</strong><p>The Lodesta site URL remains available until you add one.</p></div> : null}</div></section>
        </div>
      </section>

      <section className="workspace-settings-section" id="redirects">
        <div className="workspace-settings-intro"><span>Redirects</span><h2>Keep old links useful</h2><p>Send retired paths to a published page so customers and search engines do not reach a dead end.</p></div>
        <div className="workspace-settings-content is-single"><section className="workspace-panel"><RedirectRulesPanel siteId={context.site.id} redirects={redirects} routes={routes} /></section></div>
      </section>

      <section className="workspace-settings-section" id="billing">
        <div className="workspace-settings-intro"><span>Billing and access</span><h2>Manage the relationship</h2><p>Billing belongs to this website. Personal sign-in and security settings remain account-wide.</p></div>
        <div className="workspace-settings-content">
          <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Subscription</span><h3>Site billing</h3></div><WorkspaceStatus tone={claim?.stripeCustomerId ? "success" : "attention"}>{claim?.stripeCustomerId ? "Connected" : "Not connected"}</WorkspaceStatus></div><p className="muted">Open the secure billing portal to review invoices or update the payment method for this site.</p><BillingPortalButton siteId={context.site.id} returnPath={`/workspace/${slug}/settings`} disabled={!claim?.stripeCustomerId} disabledReason="No Stripe customer is attached to this site." /></section>
          <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Account</span><h3>Personal access</h3></div></div><p className="muted">Review the signed-in account or switch among websites you can manage.</p><div className="button-row"><Link className="button secondary" href="/account/settings">Account settings</Link>{context.options.length > 1 ? <Link className="button secondary" href="/account">Switch site</Link> : null}</div></section>
        </div>
      </section>
    </main>
  );
}
