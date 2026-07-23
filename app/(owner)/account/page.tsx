import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/account-context";
import { requireOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function AccountEntryPage() {
  await requireOwnerAccess("/account");
  const context = await getAccountContext();
  if (context.auth.user && context.relationships.length === 0) redirect("/account/onboarding");
  if (context.auth.user && context.relationships.length === 1) redirect(context.relationships[0].nextHref);

  return (
    <main className="account-entry-page product-page">
      <section className="account-entry-intro product-page-heading"><span>Account overview</span><h1>Your websites</h1><p>Continue a build, review a draft, or open one of your websites.</p></section>
      {context.localOpenMode ? <div className="account-entry-notice"><strong>Website setup is unavailable in local-open mode</strong><p>Configure authentication and sign in with a real user to create a private website draft.</p></div> : null}
      {context.localOpenMode && context.options.length ? <section className="account-site-grid">{context.options.map((site) => <Link href={`/workspace/${site.slug}`} key={site.id}><span className="account-site-avatar" aria-hidden="true">{initials(site.name)}</span><div><strong>{site.name}</strong><p>Local development website</p></div><span className="workspace-status" data-tone="neutral">{site.published ? "Live" : "Draft"}</span><span aria-hidden="true">→</span></Link>)}</section> : null}
      {context.relationships.length > 1 ? <section className="account-relationship-list">{context.relationships.map((item) => <article key={item.id}><span className="account-site-avatar" aria-hidden="true">{initials(item.name)}</span><div><div className="account-relationship-title"><h2>{item.name}</h2><span>{item.statusLabel}</span></div><p>{item.detail}</p></div><Link className="button secondary" href={item.nextHref}>{item.nextLabel}</Link></article>)}</section> : null}
      {context.auth.user ? <div className="account-add-row"><Link className="button primary" href="/account/onboarding">Add website</Link></div> : null}
    </main>
  );
}

function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WS"; }
