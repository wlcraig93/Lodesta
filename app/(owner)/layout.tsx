import type { ReactNode } from "react";
import { ProductAppShell } from "@/components/ProductAppShell";
import { resolveOwnerIdentity } from "@/lib/owner-identity";
import { getOwnerSiteInventory } from "@/lib/owner-workspace";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const inventory = await getOwnerSiteInventory();
  return (
    <ProductAppShell
      context={{ kind: "account" }}
      sites={inventory.options}
      accessMode={inventory.localOpenMode ? "local_open" : "owner"}
      canAccessAdmin={inventory.canAccessAdmin}
      accountIdentity={resolveOwnerIdentity(inventory.auth.user, inventory.localOpenMode ? "Local access" : "Account")}
      authConfigured={inventory.auth.configured}
    >
      {children}
    </ProductAppShell>
  );
}
