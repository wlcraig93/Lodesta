import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingPortalButton } from "@/components/BillingPortalButton";
import { requirePlatformSiteOwnerAccess } from "@/lib/page-access";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function OwnerDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  await requirePlatformSiteOwnerAccess(site.id, `/dashboard/${slug}`);
  const [state, versions, runs, queue, analytics, inquiries, domains, claims] = await Promise.all([
    sitePlatformRepository.getBusinessState(site.businessId), sitePlatformRepository.listSiteVersions(site.id),
    sitePlatformRepository.listRecentAgentRuns({ siteId: site.id, limit: 5 }), sitePlatformRepository.listOperatorQueue(),
    siteCapabilityRepository.analyticsSummary(site.id), siteCapabilityRepository.listInquiries(site.id),
    repository.listDomains(site.id), repository.listClaims(site.id)
  ]);
  if (!state) notFound();
  const published = versions.find((version) => version.status === "published");
  const candidate = versions.find((version) => version.status === "candidate");
  const openQueue = queue.filter((item) => item.siteId === site.id && (item.status === "open" || item.status === "in_review"));
  const claim = claims.find((item) => item.status === "claimed");
  return <main className="admin-page owner-page"><header className="owner-page-header"><div><p className="owner-page-eyebrow">Site dashboard</p><h1>{state.identity.name}</h1><p className="owner-page-lede">Website releases, customer activity, business data, domains, and billing.</p></div><div className="button-row"><Link className="button secondary" href={`/business/${slug}`}>Business data</Link><Link className="button primary" href={`/editor/${slug}`}>Website workspace</Link></div></header>
    <section className="metric-row"><Metric label="Published" value={published ? `V${published.number}` : "No"} /><Metric label="Candidate" value={candidate ? `V${candidate.number}` : "None"} /><Metric label="Leads" value={inquiries.length} /><Metric label="Open review" value={openQueue.length} /></section>
    <div className="admin-grid"><section className="panel"><h2>Website</h2><div className="finding-list"><Card badge={site.status} title={published ? "Website is live" : candidate ? "Candidate ready" : runs[0] ? `Build ${runs[0].status}` : "Build not started"} body={openQueue[0] && typeof openQueue[0].findings[0]?.message === "string" ? openQueue[0].findings[0].message : "Use the workspace to review the exact candidate, make AI changes, and publish."} href={`/editor/${slug}`} action="Open workspace" /><Card badge={`revision ${state.revision}`} title="Business source of truth" body={`${state.offerings.length} services, ${state.proof.filter((item) => item.status === "confirmed").length} confirmed proof items, and ${state.assets.length} retained assets.`} href={`/business/${slug}`} action="Review data" /><Card badge="history" title={`${versions.length} retained version${versions.length === 1 ? "" : "s"}`} body="Preview or restore any immutable release without rewriting prior artifacts." href={`/versions/${slug}`} action="Versions" /></div></section>
      <section className="panel"><h2>Activity</h2><div className="metric-row compact"><Metric label="Sessions" value={analytics.sessions} /><Metric label="Actions" value={analytics.primaryActions} /><Metric label="Leads" value={inquiries.length} /></div><div className="finding-list">{inquiries.slice(0, 3).map((inquiry) => <Card key={inquiry.id} badge={inquiry.status} title={inquiry.contactName || inquiry.contactEmail || inquiry.contactPhone || "New inquiry"} body={`Received ${new Date(inquiry.createdAt).toLocaleDateString()}.`} href={`/leads/${slug}`} action="Inbox" />)}{!inquiries.length ? <p className="muted">No inquiries yet.</p> : null}</div></section>
      <aside className="panel"><h2>Domain and billing</h2><Card badge={domains.find((domain) => domain.status === "active") ? "active" : "setup"} title={domains[0]?.hostname ?? "Custom domain"} body={domains.length ? "Review DNS and activation status." : "Connect a custom hostname when the site is ready."} href={`/domains/${slug}`} action="Domains" /><article className="finding-card"><span className="badge">{claim?.stripeCustomerId ? "connected" : "setup"}</span><h3>Billing</h3><p>{claim?.stripeCustomerId ? "Manage the subscription and invoices in Stripe." : "Billing activates with the claimed site account."}</p><BillingPortalButton siteId={site.id} returnPath={`/dashboard/${slug}`} disabled={!claim?.stripeCustomerId} disabledReason="No Stripe customer is attached to this site." /></article></aside></div>
  </main>;
}

function Card({ badge, title, body, href, action }: { badge: string; title: string; body: string; href: string; action: string }) { return <article className="finding-card"><div className="button-row"><span className="badge">{badge}</span><Link className="button secondary" href={href}>{action}</Link></div><h3>{title}</h3><p>{body}</p></article>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>; }
