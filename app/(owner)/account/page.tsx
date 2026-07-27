import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountWebsiteCard } from "@/components/AccountWebsiteCard";
import { getAccountContext } from "@/lib/account-context";
import { requireOwnerAccess } from "@/lib/page-access";

export default async function AccountEntryPage() {
  await requireOwnerAccess("/account");
  const context = await getAccountContext();
  if (context.auth.user && context.relationships.length === 0) redirect("/account/onboarding");
  if (context.auth.user && context.relationships.length === 1 && context.relationships[0].kind === "setup") {
    redirect(context.relationships[0].nextHref);
  }

  return (
    <main className="account-entry-page product-page">
      <header className="account-entry-intro product-page-heading">
        <div><span>Websites</span><h1>Your websites</h1><p>Continue a build, review an update, or open a live website.</p></div>
        {context.auth.user ? <Link className="button primary" href="/account/onboarding">Add website</Link> : null}
      </header>
      {context.localOpenMode ? <div className="account-entry-notice"><strong>Website setup is unavailable in local-open mode</strong><p>Configure authentication and sign in with a real user to create a private website draft.</p></div> : null}
      {context.localOpenMode && context.options.length ? (
        <section className="account-website-grid">
          {context.options.map((site) => (
            <AccountWebsiteCard
              key={site.id}
              name={site.name}
              recentLabel="Local development"
              href={`/workspace/${site.slug}`}
              lifecycle={{
                state: site.published ? "live" : "building",
                tone: site.published ? "success" : "neutral",
                label: site.published ? "Live" : "Building",
                title: site.published ? "Your website is live and current" : "Your website is being prepared",
                detail: "Local development website",
                nextAction: { href: `/workspace/${site.slug}`, label: "Open website" }
              }}
              targetKind="site"
              removable={false}
            />
          ))}
        </section>
      ) : null}
      {context.relationships.length ? (
        <section className="account-website-grid">
          {context.relationships.map((item) => (
            <AccountWebsiteCard
              key={item.id}
              name={item.name}
              hostname={item.hostname}
              recentLabel={item.recentLabel}
              href={item.nextHref}
              thumbnailUrl={item.thumbnailUrl}
              lifecycle={item.lifecycle}
              targetId={item.siteId ?? item.setupId}
              targetKind={item.kind}
              removable={item.kind === "site" || Boolean(item.setupView?.canCancel)}
            />
          ))}
          <Link className="account-add-website-card" href="/account/onboarding">
            <span aria-hidden="true">+</span>
            <strong>Add another website</strong>
            <small>Create a private draft from an existing site</small>
          </Link>
        </section>
      ) : null}
    </main>
  );
}
