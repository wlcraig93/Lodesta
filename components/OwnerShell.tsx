import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/supabase/server";

const ownerNavItems = [
  { href: "/account", label: "Managed sites" }
];

export async function OwnerShell({ children }: { children: ReactNode }) {
  const auth = await getCurrentUser();
  const accountLabel = auth.user?.email ?? "Owner access";

  return (
    <div className="owner-shell">
      <aside className="owner-sidebar">
        <Link className="admin-brand owner-brand" href="/account">
          <img src="/lodesta-logo.png" alt="Lodesta" />
        </Link>
        <nav className="admin-nav owner-nav" aria-label="Owner">
          {ownerNavItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="admin-profile owner-profile">
          <span>{auth.user ? "Signed in" : "Account"}</span>
          <strong>{accountLabel}</strong>
          {auth.user ? (
            <form action="/auth/logout" method="post">
              <button type="submit">Sign out</button>
            </form>
          ) : (
            <Link href="/auth/login?next=/account">Sign in</Link>
          )}
        </div>
      </aside>
      <div className="owner-shell-main">{children}</div>
    </div>
  );
}
