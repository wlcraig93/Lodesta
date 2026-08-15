import Link from "next/link";
import type { ReactNode } from "react";
import { lodestaBrandSans } from "@/app/fonts";
import { getCurrentUser } from "@/lib/supabase/server";
import styles from "./MarketingShell.module.css";

export async function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={`${lodestaBrandSans.variable} marketing-shell ${styles.shell}`} data-theme="light">
      <a className={styles.skipLink} href="#marketing-content">
        Skip to content
      </a>
      <MarketingHeader />
      <div className={styles.content} id="marketing-content" tabIndex={-1}>
        {children}
      </div>
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
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Lodesta home">
        <img src="/brand/lodesta-wordmark-boxed.svg" alt="Lodesta" />
      </Link>
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link className={styles.sectionLink} href="/#how-it-works">How it works</Link>
        <Link className={styles.sectionLink} href="/#what-lodesta-manages">What Lodesta manages</Link>
        <Link className={styles.account} href={appHref}>
          {appLabel}
        </Link>
        <Link className={styles.cta} href="/#health-report">
          Get my free website report
        </Link>
      </nav>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <Link className={`${styles.brand} ${styles.footerBrand}`} href="/" aria-label="Lodesta home">
        <img src="/brand/lodesta-wordmark-boxed.svg" alt="Lodesta" />
      </Link>
      <p>The AI website manager built for local-business growth.</p>
      <nav aria-label="Legal and support">
        <Link href="/privacy/">Privacy Policy</Link>
        <Link href="/terms/">Terms of Service</Link>
        <a href="mailto:willie@lodesta.com">willie@lodesta.com</a>
      </nav>
    </footer>
  );
}
