import Link from "next/link";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasValidAdminToken } from "@/lib/auth-policy";
import { AccountMenu, type AccountAction } from "@/components/AccountMenu";
import { AdminNav, type AdminNavItem } from "@/components/admin/AdminNav";
import { resolveOwnerIdentity } from "@/lib/owner-identity";

const primaryNavItems: AdminNavItem[] = [
  { href: "/admin/sites", label: "Manage sites" },
  { href: "/admin/site-queue", label: "Review Queue" }
];

const operationsNavItems: AdminNavItem[] = [
  { href: "/authoring-batches", label: "Authoring batches" },
  { href: "/outbound", label: "Outbound" },
  { href: "/settings", label: "Settings" }
];

const debugNavItems: AdminNavItem[] = [
  { href: "/admin/assessments", label: "Assessments" },
  { href: "/admin/runs", label: "Activity" }
];

export async function AdminShell({ children }: { children: ReactNode }) {
  const tokenAccess = hasValidAdminToken(await headers());
  const auth = tokenAccess ? { configured: true as const, user: null } : await getCurrentUser();
  const accountIdentity = resolveOwnerIdentity(auth.user, tokenAccess ? "Admin token" : "Local admin");
  const sessionLabel = tokenAccess ? "Token session" : auth.user ? "Platform admin" : "Local development";
  const accountActions: AccountAction[] = tokenAccess
    ? [{ id: "session-note", kind: "note", label: "Authenticated by admin token.", section: "session" }]
    : [
        { id: "owner-workspace", kind: "link", label: "Owner workspace", href: "/account", section: "account", icon: "workspace" },
        { id: "account-settings", kind: "link", label: "Account settings", href: "/account/settings", section: "account", icon: "account" },
        ...(auth.user
          ? [{ id: "sign-out", kind: "form", label: "Sign out", action: "/auth/logout", section: "session", icon: "sign-out" } satisfies AccountAction]
          : [{ id: "session-note", kind: "note", label: "Local development access.", section: "session" } satisfies AccountAction])
      ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin/sites">
          <img src="/lodesta-logo.png" alt="Lodesta" />
          <span>Admin</span>
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
        <AccountMenu
          displayName={accountIdentity.displayName}
          email={accountIdentity.email}
          contextLabel={sessionLabel}
          actions={accountActions}
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
