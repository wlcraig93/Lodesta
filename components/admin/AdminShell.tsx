import Link from "next/link";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasValidAdminToken } from "@/lib/auth-policy";
import { AdminAccountMenu } from "@/components/admin/AdminAccountMenu";
import { AdminNav, type AdminNavItem } from "@/components/admin/AdminNav";

const navItems: AdminNavItem[] = [
  { href: "/admin/sites", label: "Sites" },
  { href: "/admin/site-generations", label: "Site generations" },
  { href: "/admin/generate", label: "Generate" },
  { href: "/admin/runs", label: "Runs" },
  { href: "/settings", label: "Settings" },
  { href: "/outbound", label: "Outbound" }
];

export async function AdminShell({ children }: { children: ReactNode }) {
  const tokenAccess = hasValidAdminToken(await headers());
  const auth = tokenAccess ? { configured: true as const, user: null } : await getCurrentUser();
  const accountLabel = tokenAccess ? "Admin token" : auth.user?.email ?? "Local admin";

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin/generate">
          <img src="/lodesta-logo.png" alt="Lodesta" />
          <span>Admin</span>
        </Link>
        <AdminNav items={navItems} />
        <AdminAccountMenu
          label={accountLabel}
          email={auth.user?.email ?? undefined}
          tokenAccess={tokenAccess}
          authConfigured={auth.configured}
        />
      </aside>
      <div className="admin-shell-main">{children}</div>
    </div>
  );
}
