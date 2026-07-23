import type { ReactNode } from "react";
import { ProductAppShell } from "@/components/ProductAppShell";
import { getOwnerSiteInventory } from "@/lib/owner-workspace";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const inventory = await getOwnerSiteInventory();
  return (
    <ProductAppShell
      sites={inventory.options}
      accessMode={inventory.localOpenMode ? "local_open" : "owner"}
      canAccessAdmin={inventory.canAccessAdmin}
      accountLabel={inventory.auth.user?.email ?? (inventory.localOpenMode ? "Local access" : "Account")}
      accountEmail={inventory.auth.user?.email}
      authConfigured={inventory.auth.configured}
    >
      {children}
    </ProductAppShell>
  );
}
