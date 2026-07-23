import type { Metadata } from "next";
import { AuthLoginForm } from "@/components/AuthLoginForm";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in | Lodesta", description: "Sign in to your Lodesta account." };

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ next?: string | string[] }> }) {
  const env = getSupabasePublicEnv();
  const params = await searchParams;
  const nextPath = safeNextPath(params?.next);
  const supabase = env.url && env.anonKey ? { url: env.url, anonKey: env.anonKey } : null;
  return (
    <main className="auth-page minimal-auth-page">
      <section className="panel auth-panel" aria-labelledby="auth-panel-title">
        <span>Account access</span>
        <h1 id="auth-panel-title">Welcome back</h1>
        <p>Sign in with Google or use a secure email link.</p>
        <AuthLoginForm supabase={supabase} nextPath={nextPath} />
      </section>
    </main>
  );
}

function safeNextPath(value: string | string[] | undefined) { const next = Array.isArray(value) ? value[0] : value; return !next?.startsWith("/") || next.startsWith("//") ? "/account" : next; }
