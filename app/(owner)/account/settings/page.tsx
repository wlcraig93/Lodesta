import Link from "next/link";
import { DisplayNameForm } from "@/components/DisplayNameForm";
import { requireOwnerAccess } from "@/lib/page-access";
import { resolveOwnerIdentity } from "@/lib/owner-identity";
import { getOwnerSiteInventory } from "@/lib/owner-workspace";

export default async function AccountSettingsPage() {
  const access = await requireOwnerAccess("/account/settings");
  const inventory = await getOwnerSiteInventory();
  const identity = resolveOwnerIdentity(access.user, "Account");
  return (
    <main className="account-settings-page product-page">
      <section className="account-settings-intro"><span>Account</span><h1>Account settings</h1><p>Manage how your name appears and review the websites connected to your sign-in.</p></section>
      <div className="account-settings-grid">
        <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Identity</span><h2>Your profile</h2></div></div>{access.user ? <DisplayNameForm initialValue={identity.displayName} /> : null}<dl className="account-settings-details"><div><dt>Email</dt><dd>{identity.email ?? (access.configured ? "Signed out" : "Local development session")}</dd></div><div><dt>Websites</dt><dd>{inventory.options.length}</dd></div></dl>{access.user ? <form action="/auth/logout" method="post"><button className="button secondary" type="submit">Sign out</button></form> : null}</section>
        <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Website access</span><h2>Your sites</h2></div></div><div className="account-settings-sites">{inventory.options.map((site) => <Link key={site.id} href={`/workspace/${site.slug}`}><span>{site.name}</span><small>{site.published ? "Live" : site.status}</small><span aria-hidden="true">→</span></Link>)}{!inventory.options.length ? <p className="muted">No websites have been created yet.</p> : null}</div></section>
      </div>
    </main>
  );
}
