import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/supabase/server";
import { isAdminUserId } from "@/lib/auth-policy";

export async function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-shell">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}

async function MarketingHeader() {
  const auth = await getCurrentUser();
  const user = auth.user;
  const appHref = user ? (isAdminUserId(user.id) ? "/admin/sites" : "/account") : "/auth/login";
  const appLabel = user ? "Open app" : "Sign in";

  return (
    <header className="app-header marketing-header">
      <Link className="app-brand" href="/" aria-label="Lodesta home">
        <img src="/lodesta-logo.png" alt="Lodesta" />
      </Link>
      <nav className="app-nav" aria-label="Primary navigation">
        <Link className="app-nav-primary" href={appHref}>
          {appLabel}
        </Link>
      </nav>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <Link className="app-brand marketing-footer-brand" href="/" aria-label="Lodesta home">
        <img src="/lodesta-logo.png" alt="Lodesta" />
      </Link>
      <p>Managed website optimization for local businesses.</p>
    </footer>
  );
}
