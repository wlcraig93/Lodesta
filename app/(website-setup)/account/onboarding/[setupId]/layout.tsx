import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ProductAppShell } from "@/components/ProductAppShell";
import { resolveOwnerIdentity } from "@/lib/owner-identity";
import { requireOwnerAccess } from "@/lib/page-access";
import { getOwnerSiteInventory } from "@/lib/owner-workspace";
import { websiteSetupHostname } from "@/lib/website-setup-copy";
import { getWebsiteSetupRecord } from "@/lib/website-setups";

export const dynamic = "force-dynamic";

export default async function WebsiteSetupLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ setupId: string }>;
}) {
  const { setupId } = await params;
  const nextPath = `/account/onboarding/${setupId}`;
  const access = await requireOwnerAccess(nextPath);
  if (!access.user) redirect("/account/onboarding");
  const [setup, inventory] = await Promise.all([
    getWebsiteSetupRecord(setupId),
    getOwnerSiteInventory()
  ]);
  if (!setup) redirect("/account/onboarding");
  if (setup.ownerUserId !== access.user.id) notFound();

  return (
    <ProductAppShell
      context={{
        kind: "setup",
        setupId,
        name: websiteSetupHostname(setup.sourceUrl),
        statusLabel: "Creating website"
      }}
      sites={inventory.options}
      accessMode={inventory.localOpenMode ? "local_open" : "owner"}
      canAccessAdmin={inventory.canAccessAdmin}
      accountIdentity={resolveOwnerIdentity(access.user)}
      authConfigured={access.configured}
    >
      {children}
    </ProductAppShell>
  );
}
