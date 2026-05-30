import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { repository } from "@/lib/repository";
import { authRequired } from "@/lib/auth-policy";
import { filterSiteBundlesForOwner } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const [{ configured, user }, bundles, claims] = await Promise.all([
    getCurrentUser(),
    repository.listSiteBundles(),
    repository.listClaims()
  ]);
  const localOpenMode = !configured && !authRequired();
  const visibleBundles = filterSiteBundlesForOwner({
    bundles,
    claims,
    authConfigured: !localOpenMode,
    userId: user?.id,
    userEmail: user?.email
  });

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Account</span>
          <h1>{user?.email ?? "Owner access"}</h1>
          <p>
            Claimed customers authenticate through Supabase Auth. Local mode shows setup status without requiring a live
            Supabase project.
          </p>
        </div>
        <div className="button-row">
          {user ? (
            <form action="/auth/logout" method="post">
              <button className="button secondary" type="submit">
                Sign out
              </button>
            </form>
          ) : (
            <Link className="button primary" href="/auth/login?next=/account">
              Sign in
            </Link>
          )}
        </div>
      </header>

      {!configured ? (
        <section className="panel">
          <h2>Auth not configured</h2>
          <p>
            Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and Supabase auth redirect URLs to enable
            owner login.
          </p>
        </section>
      ) : null}

      {configured && !user ? (
        <section className="panel">
          <h2>Sign in required</h2>
          <p>Use the email link flow before managing claimed sites, leads, domains, and billing.</p>
        </section>
      ) : null}

      {user ? (
        <section className="panel">
          <h2>Managed sites</h2>
          <div className="finding-list">
            {visibleBundles.map((bundle) => (
              <article key={bundle.businessProfile.siteId} className="finding-card">
                <span className="badge">{bundle.businessProfile.vertical.replace("_", " ")}</span>
                <h3>{bundle.businessProfile.name}</h3>
                <div className="button-row">
                  <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
                    Editor
                  </Link>
                  <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
                    Analytics
                  </Link>
                  <Link className="button secondary" href={`/optimization/${bundle.siteModel.slug}`}>
                    Optimization
                  </Link>
                  <Link className="button secondary" href={`/experiments/${bundle.siteModel.slug}`}>
                    Experiments
                  </Link>
                  <Link className="button secondary" href={`/domains/${bundle.siteModel.slug}`}>
                    Domains
                  </Link>
                  <Link className="button secondary" href={`/leads/${bundle.siteModel.slug}`}>
                    Leads
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
