import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerSiteInventory } from "@/lib/owner-workspace";
import { WorkspaceStatus, humanize } from "@/components/OwnerWorkspaceUI";

export const dynamic = "force-dynamic";

export default async function AccountEntryPage() {
  const inventory = await getOwnerSiteInventory();
  if ((inventory.auth.user || inventory.localOpenMode) && inventory.options.length === 1) redirect(`/workspace/${inventory.options[0].slug}`);

  return (
    <main className="account-entry-page">
      <header className="account-entry-header">
        <Link href="/" className="account-entry-brand"><img src="/brand/lodesta-mark.svg" alt="" /><span>Lodesta</span></Link>
        {inventory.auth.user ? <Link className="button secondary" href="/account/settings">Account settings</Link> : null}
      </header>
      <section className="account-entry-intro"><span>Your websites</span><h1>{inventory.options.length > 1 ? "Choose a website" : "Your Lodesta workspace"}</h1><p>{inventory.options.length > 1 ? "Each website has its own inbox, results, business information, and managed website workspace." : "Sign in or connect a managed website to continue."}</p></section>

      {!inventory.auth.configured ? <div className="account-entry-notice"><strong>Local development access</strong><p>Authentication is not configured, so available sites are shown without sign-in.</p></div> : null}
      {inventory.auth.configured && !inventory.auth.user ? <div className="account-entry-notice"><strong>Owner sign-in required</strong><p>Use the email connected to the claimed business.</p><Link className="button primary" href="/auth/login?next=/account">Sign in</Link></div> : null}

      {(inventory.auth.user || inventory.localOpenMode) && inventory.options.length > 1 ? <section className="account-site-grid">{inventory.options.map((site) => <Link href={`/workspace/${site.slug}`} key={site.id}><span className="account-site-avatar" aria-hidden="true">{initials(site.name)}</span><div><strong>{site.name}</strong><p>{site.published ? "Published website" : `${humanize(site.status)} website`}</p></div><WorkspaceStatus tone={site.published ? "success" : "neutral"}>{site.published ? "Live" : humanize(site.status)}</WorkspaceStatus><span aria-hidden="true">→</span></Link>)}</section> : null}
      {(inventory.auth.user || inventory.localOpenMode) && inventory.options.length === 0 ? <div className="account-entry-empty"><span>0 sites</span><h2>No managed website is connected yet</h2><p>Once a website claim is approved, it will appear here automatically.</p><Link className="button secondary" href="/">Return to Lodesta</Link></div> : null}
    </main>
  );
}

function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WS"; }
