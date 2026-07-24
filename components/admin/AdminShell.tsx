import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasValidAdminToken } from "@/lib/auth-policy";
import type { AccountAction } from "@/components/AccountMenu";
import { AdminShellClient } from "@/components/admin/AdminShellClient";
import { resolveOwnerIdentity } from "@/lib/owner-identity";

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
    <AdminShellClient
      displayName={accountIdentity.displayName}
      email={accountIdentity.email}
      sessionLabel={sessionLabel}
      accountActions={accountActions}
    >
      {children}
    </AdminShellClient>
  );
}
