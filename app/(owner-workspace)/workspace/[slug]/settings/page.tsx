import Link from "next/link";
import { DomainConnectForm } from "@/components/DomainConnectForm";
import { DomainRefreshButton } from "@/components/DomainRefreshButton";
import { AnalyticsTimezoneForm } from "@/components/AnalyticsTimezoneForm";
import { RedirectRulesPanel } from "@/components/RedirectRulesPanel";
import { SiteOnlineToggle } from "@/components/SiteOnlineToggle";
import { WorkspacePageHeader, WorkspaceStatus } from "@/components/OwnerWorkspaceUI";
import { isApexHostname, registrarHostField } from "@/lib/domains";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";

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
      {context.site.publishedVersionId && (context.site.status === "active" || context.site.status === "offline") ? (
        <section className="workspace-settings-section" id="visibility">
          <div className="workspace-settings-intro"><span>Visibility</span><h2>{context.site.status === "offline" ? "Your site is offline" : "Your site is live"}</h2><p>{context.site.status === "offline" ? "Visitors see a “temporarily unavailable” page. Put the same version back online whenever you’re ready." : "Take the site down temporarily without deleting anything. It can take a few minutes for every visitor to see the change."}</p></div>
          <div className="workspace-settings-content is-single"><section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Status</span><h3>{context.site.status === "offline" ? "Offline" : "Live"}</h3></div><WorkspaceStatus tone={context.site.status === "offline" ? "attention" : "success"}>{context.site.status === "offline" ? "Offline" : "Live"}</WorkspaceStatus></div><SiteOnlineToggle siteId={context.site.id} online={context.site.status === "active"} /></section></div>
        </section>
      ) : null}

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
                  <WorkspaceStatus tone={domain.status === "active" ? "success" : "attention"}>{domainStatusLabel(domain.status)}</WorkspaceStatus>
                  {domain.status === "attention_required" ? <p className="form-status">This domain has stopped pointing to Lodesta. Your site is still being served, but visitors may not reach it. Check the records below with your domain provider.</p> : null}
                  {domain.status === "expired" ? <p className="form-status">The DNS records weren’t added in time. Remove this domain and connect it again to get fresh records.</p> : null}
                  {domain.status === "conflict" ? <p className="form-status">Another Lodesta website has already proved this domain. Remove it here, or contact support if the domain is yours.</p> : null}
                  {domain.ownershipProofStatus === "pending" && isApexHostname(domain.hostname) ? <p className="form-status">Most domain providers can’t point a bare domain like {domain.hostname} with a CNAME. If yours can’t, connect www.{domain.hostname} instead and turn on your provider’s domain forwarding from {domain.hostname} to https://www.{domain.hostname}.</p> : null}
                  <dl>
                    <dt>Add a TXT record</dt>
                    <dd>Host: <code>{registrarHostField(domain.verificationName, domain.hostname)}</code></dd>
                    <dd>Value: <code>{domain.verificationValue}</code></dd>
                    <dt>Add a CNAME record (or ALIAS if your provider offers it)</dt>
                    <dd>Host: <code>{registrarHostField(domain.routingName, domain.hostname)}</code></dd>
                    <dd>Points to: <code>{domain.routingTarget}</code></dd>
                    <dt>Progress</dt>
                    <dd>Ownership {domain.ownershipProofStatus === "verified" ? "confirmed" : "not confirmed yet"} · Routing {domain.routingStatus === "active" ? "confirmed" : "not confirmed yet"} · Security certificate {domain.certificateStatus === "active" ? "ready" : domain.certificateStatus === "invalid" ? "needs attention" : "in progress"}</dd>
                    {domain.ownershipProofStatus === "pending" && domain.status === "pending_verification" ? <dd>Add both records by {new Date(domain.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. DNS changes can take up to an hour to appear.</dd> : null}
                  </dl>
                  <DomainRefreshButton domainId={domain.id} hostname={domain.hostname} />
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

      <section className="workspace-settings-section" id="analytics">
        <div className="workspace-settings-intro"><span>Analytics</span><h2>Set reporting day boundaries</h2><p>Dates, comparisons, and exports use this timezone. Use the business’s primary local timezone.</p></div>
        <div className="workspace-settings-content is-single"><section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Reporting timezone</span><h3>{context.site.reportingTimezone}</h3></div></div><AnalyticsTimezoneForm siteId={context.site.id} initialTimezone={context.site.reportingTimezone} /></section></div>
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

function domainStatusLabel(status: string) {
  return ({
    pending_verification: "Waiting for DNS records",
    provisioning: "Setting up",
    active: "Connected",
    attention_required: "Needs attention",
    expired: "Expired",
    conflict: "In use elsewhere"
  } as Record<string, string>)[status] ?? "Checking";
}
