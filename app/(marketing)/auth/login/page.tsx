import { AuthLoginForm } from "@/components/AuthLoginForm";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | Lodesta",
  description: "Sign in to Lodesta with Google or a secure email link."
};

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const env = getSupabasePublicEnv();
  const params = await searchParams;
  const nextPath = safeNextPath(params?.next);
  const supabase = env.url && env.anonKey ? { url: env.url, anonKey: env.anonKey } : null;

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <header className="auth-copy">
          <span className="badge">Login</span>
          <h1>Sign in to manage your site.</h1>
          <p>Use Google for the fastest path, or get a secure email link when that is easier.</p>
          <div className="auth-assurance-list" aria-label="Access protections">
            <span>No password required</span>
            <span>Owner-only workspace</span>
            <span>Returns you to the right page</span>
          </div>
        </header>

        <section className="panel auth-panel" aria-labelledby="auth-panel-title">
          <h2 id="auth-panel-title">Continue to Lodesta</h2>
          <AuthLoginForm supabase={supabase} nextPath={nextPath} />
        </section>
      </div>
    </main>
  );
}

function safeNextPath(value: string | string[] | undefined) {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next?.startsWith("/") || next.startsWith("//")) return "/account";
  return next;
}
