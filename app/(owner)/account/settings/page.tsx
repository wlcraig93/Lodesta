import Link from "next/link";
import { requireOwnerAccess } from "@/lib/page-access";
import { getOwnerSiteInventory } from "@/lib/owner-workspace";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const access = await requireOwnerAccess("/account/settings");
  const inventory = await getOwnerSiteInventory();
  return (
    <main className="account-settings-page product-page">
      <section className="account-settings-intro"><span>Account</span><h1>Personal access</h1><p>Your sign-in controls access to every Lodesta website owned by this account.</p></section>
      <div className="account-settings-grid">
        <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Identity</span><h2>Signed-in account</h2></div></div><dl className="account-settings-details"><div><dt>Email</dt><dd>{access.user?.email ?? (access.configured ? "Signed out" : "Local development session")}</dd></div><div><dt>Websites</dt><dd>{inventory.options.length}</dd></div><div><dt>Authentication</dt><dd>{access.configured ? "Supabase Auth" : "Not configured"}</dd></div></dl>{access.user ? <form action="/auth/logout" method="post"><button className="button secondary" type="submit">Sign out</button></form> : null}</section>
        <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Website access</span><h2>Your sites</h2></div></div><div className="account-settings-sites">{inventory.options.map((site) => <Link key={site.id} href={`/workspace/${site.slug}`}><span>{site.name}</span><small>{site.published ? "Live" : site.status}</small><span aria-hidden="true">→</span></Link>)}{!inventory.options.length ? <p className="muted">No websites have been created yet.</p> : null}</div></section>
      </div>
    </main>
  );
}
