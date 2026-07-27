import Link from "next/link";
import type { ReactNode } from "react";
import { lodestaBrandSans } from "@/app/fonts";
import { getCurrentUser } from "@/lib/supabase/server";

export async function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={`${lodestaBrandSans.variable} marketing-shell`} data-theme="light">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}

async function MarketingHeader() {
  const auth = await getCurrentUser();
  const user = auth.user;
  const appHref = user ? "/account" : "/auth/login";
  const appLabel = user ? "Open app" : "Sign in";

  return (
    <header className="app-header marketing-header">
      <Link className="app-brand" href="/" aria-label="Lodesta home">
        <img src="/brand/lodesta-wordmark-boxed.svg" alt="Lodesta" />
      </Link>
      <nav className="app-nav" aria-label="Primary navigation">
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/#what-we-check">What Lodesta checks</Link>
        <Link className="app-nav-primary" href={appHref}>
          {appLabel}
        </Link>
        <Link className="button primary marketing-nav-cta" href="/#health-report">
          Check my website
        </Link>
      </nav>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <Link className="app-brand marketing-footer-brand" href="/" aria-label="Lodesta home">
        <img src="/brand/lodesta-wordmark-boxed.svg" alt="Lodesta" />
      </Link>
      <p>The AI website manager for local businesses.</p>
      <nav aria-label="Legal and support">
        <Link href="/privacy/">Privacy Policy</Link>
        <Link href="/terms/">Terms of Service</Link>
        <a href="mailto:willie@lodesta.com">willie@lodesta.com</a>
      </nav>
    </footer>
  );
}
