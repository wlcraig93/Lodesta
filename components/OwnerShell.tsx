import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/supabase/server";
import { AdminAccountMenu } from "@/components/admin/AdminAccountMenu";
import { AdminNav, type AdminNavItem } from "@/components/admin/AdminNav";

const ownerNavItems: AdminNavItem[] = [
  { href: "/account", label: "Managed sites" }
];

export async function OwnerShell({ children }: { children: ReactNode }) {
  const auth = await getCurrentUser();
  const accountLabel = auth.user?.email ?? "Owner access";
  const sessionLabel = auth.user ? "Owner account" : auth.configured ? "Signed out" : "Local session";

  return (
    <div className="owner-shell">
      <aside className="owner-sidebar">
        <Link className="admin-brand owner-brand" href="/account">
          <img src="/lodesta-logo.png" alt="Lodesta" />
        </Link>
        <AdminNav items={ownerNavItems} ariaLabel="Owner" />
        <AdminAccountMenu
          label={accountLabel}
          email={auth.user?.email ?? undefined}
          tokenAccess={false}
          authConfigured={auth.configured}
          sessionLabel={sessionLabel}
          settingsHref="/account"
          settingsLabel="Account"
          signInHref="/auth/login?next=/account"
        />
      </aside>
      <div className="owner-shell-main">{children}</div>
    </div>
  );
}
