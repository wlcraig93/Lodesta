import Link from "next/link";
import { AuthLoginForm } from "@/components/AuthLoginForm";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const env = getSupabasePublicEnv();

  return (
    <main className="admin-page auth-page">
      <header className="admin-header">
        <div>
          <span className="badge">Login</span>
          <h1>Access your site</h1>
          <p>Owners sign in with a secure email link before editing, connecting domains, or managing leads.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/">
            Dashboard
          </Link>
        </div>
      </header>

      <section className="panel auth-panel">
        <h2>Email link</h2>
        <AuthLoginForm configured={env.configured} nextPath={params.next ?? "/account"} />
      </section>
    </main>
  );
}
