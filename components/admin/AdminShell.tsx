import Link from "next/link";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasValidAdminToken } from "@/lib/auth-policy";
import { AdminAccountMenu } from "@/components/admin/AdminAccountMenu";
import { AdminNav, type AdminNavItem } from "@/components/admin/AdminNav";

const primaryNavItems: AdminNavItem[] = [
  { href: "/admin/site-candidates", label: "Site Candidates" },
  { href: "/admin/sites", label: "Managed Sites" },
  { href: "/admin/benchmark-sites", label: "Evaluations" }
];

const operationsNavItems: AdminNavItem[] = [
  { href: "/outbound", label: "Outbound" },
  { href: "/settings", label: "Settings" }
];

const debugNavItems: AdminNavItem[] = [
  { href: "/admin/runs", label: "Activity" }
];

export async function AdminShell({ children }: { children: ReactNode }) {
  const tokenAccess = hasValidAdminToken(await headers());
  const auth = tokenAccess ? { configured: true as const, user: null } : await getCurrentUser();
  const accountLabel = tokenAccess ? "Admin token" : auth.user?.email ?? "Local admin";

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin/site-candidates">
          <img src="/lodesta-logo.png" alt="Lodesta" />
          <span>Control plane</span>
        </Link>
        <div className="admin-nav-stack">
          <NavGroup label="Build">
            <AdminNav items={primaryNavItems} ariaLabel="Build" />
          </NavGroup>
          <NavGroup label="Operate">
            <AdminNav items={operationsNavItems} ariaLabel="Operate" />
          </NavGroup>
          <NavGroup label="Debug">
            <AdminNav items={debugNavItems} ariaLabel="Debug" />
          </NavGroup>
        </div>
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

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="admin-nav-group" aria-label={`${label} navigation`}>
      <p>{label}</p>
      {children}
    </section>
  );
}
