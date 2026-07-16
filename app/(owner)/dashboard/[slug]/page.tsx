import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingPortalButton } from "@/components/BillingPortalButton";
import { countConfirmedOwnerFacts } from "@/lib/owner-facts";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { claimGateForBundle } from "@/lib/site-publication";

export const dynamic = "force-dynamic";

export default async function OwnerDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/dashboard/${slug}`);

  const siteId = bundle.businessProfile.siteId;
  const [analytics, inquiries, domains, claims] = await Promise.all([
    repository.analyticsSummary(siteId),
    repository.listInquiries(siteId),
    repository.listDomains(siteId),
    repository.listClaims(siteId)
  ]);
  const claimGate = claimGateForBundle(bundle, claims);
  const qa = runSiteQa(bundle, { versionStatus: "draft" });
  const openFindings = bundle.optimizationFindings.filter((finding) => finding.status === "open");
  const activeDomains = domains.filter((domain) => domain.status === "active");
  const pendingDomains = domains.filter((domain) => domain.status !== "active");
  const recentInquiries = inquiries.slice(0, 3);
  const confirmedFacts = countConfirmedOwnerFacts(bundle.businessProfile);
  const readyClaim = claimGate.ok && "claim" in claimGate ? claimGate.claim : undefined;

  return (
    <main className="admin-page owner-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-page-eyebrow">Site dashboard</p>
          <h1>{bundle.businessProfile.name}</h1>
          <p className="owner-page-lede">
            Site status, pending improvements, customer activity, domain setup, and billing for this managed site.
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

      <section className="metric-row">
        <Metric label="Publish gate" value={claimGate.ok ? "Ready" : "Needs review"} />
        <Metric label="Pending proposals" value={openFindings.length} />
        <Metric label="Recent leads" value={inquiries.length} />
        <Metric label="Active domains" value={activeDomains.length} />
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Status</h2>
          <div className="finding-list">
            <DashboardCard
              badge={claimGate.ok ? "ready" : "blocked"}
              title={claimGate.ok ? "Claim and publish gate is ready" : "Claim gate needs attention"}
              body={claimGate.ok ? "Billing, required facts, and rights confirmations are ready for publish actions." : claimGate.reason}
              href={`/claim/${bundle.siteModel.slug}`}
              action="Review claim"
            />
            <DashboardCard
              badge={qa.passed ? "passed" : "review"}
              title={qa.passed ? "Draft QA passed" : "Draft QA needs review"}
              body={`${qa.checks.filter((check) => check.severity === "fail").length} blocking QA check${
                qa.checks.filter((check) => check.severity === "fail").length === 1 ? "" : "s"
              } on the current draft.`}
              href={`/versions/${bundle.siteModel.slug}`}
              action="Versions"
            />
            <DashboardCard
              badge={confirmedFacts.confirmed ? "confirmed" : "pending"}
              title="Business profile"
              body={`${confirmedFacts.confirmed} of ${confirmedFacts.total} owner fact${confirmedFacts.total === 1 ? "" : "s"} confirmed for this site.`}
              href={`/business/${bundle.siteModel.slug}`}
              action="Business"
            />
          </div>
        </section>

        <section className="panel">
          <h2>Pending Proposals</h2>
          <div className="finding-list">
            {openFindings.slice(0, 4).map((finding) => (
              <DashboardCard
                key={finding.id}
                badge={finding.severity}
                title={finding.title}
                body={finding.recommendedAction}
                href={`/optimization/${bundle.siteModel.slug}`}
                action="Review"
              />
            ))}
            {openFindings.length === 0 ? (
              <p className="muted">No optimization proposals are waiting for review.</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <h2>Activity</h2>
          <div className="metric-row compact">
            <Metric label="Sessions" value={analytics.sessions} />
            <Metric label="Actions" value={analytics.primaryActions} />
            <Metric label="Leads" value={inquiries.length} />
          </div>
          <div className="finding-list">
            {recentInquiries.map((inquiry) => (
              <DashboardCard
                key={inquiry.id}
                badge={inquiry.status.replace("_", " ")}
                title={inquiry.contactName || inquiry.contactEmail || inquiry.contactPhone || "New inquiry"}
                body={`Received ${new Date(inquiry.createdAt).toLocaleDateString()}.`}
                href={`/leads/${bundle.siteModel.slug}`}
                action="Leads"
              />
            ))}
            {recentInquiries.length === 0 ? <p className="muted">No recent inquiries yet.</p> : null}
          </div>
        </section>

        <aside className="panel">
          <h2>Domain And Billing</h2>
          <div className="finding-list">
            <DashboardCard
              badge={activeDomains.length ? "active" : pendingDomains.length ? "pending" : "not set"}
              title={activeDomains[0]?.hostname ?? pendingDomains[0]?.hostname ?? "Custom domain"}
              body={
                activeDomains.length
                  ? "A custom domain is active for this site."
                  : pendingDomains.length
                    ? "Domain verification is pending."
                    : "Connect a custom domain when the owner is ready."
              }
              href={`/domains/${bundle.siteModel.slug}`}
              action="Domains"
            />
            <article className="finding-card">
              <span className="badge">{readyClaim?.stripeCustomerId ? "connected" : "setup"}</span>
              <h3>Billing</h3>
              <p>
                {readyClaim?.stripeCustomerId
                  ? "Manage subscription, payment method, invoices, and cancellation in Stripe."
                  : claimGate.ok
                    ? "Checkout is complete, but no Stripe customer id is available yet."
                    : claimGate.reason}
              </p>
              <BillingPortalButton
                siteId={siteId}
                returnPath={`/dashboard/${bundle.siteModel.slug}`}
                disabled={!claimGate.ok}
                disabledReason={claimGate.ok ? undefined : claimGate.reason}
              />
            </article>
          </div>
        </aside>
      </div>
    </main>
  );
}

function DashboardCard({
  badge,
  title,
  body,
  href,
  action
}: {
  badge: string;
  title: string;
  body: string;
  href: string;
  action: string;
}) {
  return (
    <article className="finding-card">
      <div className="button-row">
        <span className="badge">{badge}</span>
        <Link className="button secondary" href={href}>
          {action}
        </Link>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
