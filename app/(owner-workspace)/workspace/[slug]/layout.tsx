import type { ReactNode } from "react";
import { ProductAppShell } from "@/components/ProductAppShell";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";

export const dynamic = "force-dynamic";

export default async function SiteWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}`);
  const selected = context.options.find((site) => site.id === context.site.id) ?? {
    id: context.site.id,
    slug: context.site.slug,
    name: context.state.identity.name,
    status: context.site.status,
    published: Boolean(context.site.publishedVersionId)
  };
  return (
    <ProductAppShell
      context={{ kind: "site", site: selected }}
      sites={context.options}
      accessMode={context.accessMode}
      canAccessAdmin={context.canAccessAdmin}
      tokenAccess={context.tokenAccess}
      accountIdentity={context.accountIdentity}
      authConfigured={context.authConfigured}
    >
      {children}
    </ProductAppShell>
  );
}
