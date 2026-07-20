import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { authRequired, isAdminUserId } from "@/lib/auth-policy";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const [{ configured, user }, sites, claims] = await Promise.all([
    getCurrentUser(), sitePlatformRepository.listSites(), repository.listClaims()
  ]);
  const localOpenMode = !configured && !authRequired();
  const email = user?.email?.toLowerCase();
  const visibleSites = localOpenMode || isAdminUserId(user?.id)
    ? sites
    : sites.filter((site) => claims.some((claim) => claim.siteId === site.id && claim.status === "claimed" &&
      ((user?.id && claim.ownerUserId === user.id) || (email && claim.ownerEmail?.toLowerCase() === email))));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div><span className="badge">Account</span><h1>{user?.email ?? "Owner access"}</h1><p>Manage websites, leads, and performance from one account.</p></div>
        <div className="button-row">{user ? <form action="/auth/logout" method="post"><button className="button secondary" type="submit">Sign out</button></form>
          : <Link className="button primary" href="/auth/login?next=/account">Sign in</Link>}</div>
      </header>
      {!configured ? <section className="panel"><h2>Auth not configured</h2><p>Local development is open. Configure Supabase Auth before external access.</p></section> : null}
      {configured && !user ? <section className="panel"><h2>Sign in required</h2><p>Use your owner email to access managed websites.</p></section> : null}
      {(user || localOpenMode) ? <section className="panel"><h2>Managed sites</h2><div className="finding-list">
        {visibleSites.map((site) => <article key={site.id} className="finding-card">
          <div className="button-row"><span className="badge">{site.status}</span>{site.publishedVersionId ? <span className="badge">published</span> : null}</div>
          <h3>{site.slug.replaceAll("-", " ")}</h3>
          <div className="button-row">
            <Link className="button primary" href={`/editor/${site.slug}`}>Open workspace</Link>
            <Link className="button secondary" href={`/leads/${site.slug}`}>Inbox</Link>
            <Link className="button secondary" href={`/analytics/${site.slug}`}>Analytics</Link>
            {site.publishedVersionId ? <Link className="button secondary" href={`/sites/${site.slug}`} target="_blank">View site</Link> : null}
          </div>
        </article>)}
        {visibleSites.length === 0 ? <p className="muted">No managed sites are connected to this account.</p> : null}
      </div></section> : null}
    </main>
  );
}
