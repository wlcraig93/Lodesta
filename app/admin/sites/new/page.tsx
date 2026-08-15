import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CreateSiteForm } from "@/components/admin/CreateSiteForm";
import { requireAdminPageAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewAdminSitePage() {
  await requireAdminPageAccess("/admin/sites/new");
  return <main className="admin-page">
    <AdminPageHeader eyebrow="New site" title="Create private canary" description="Run the canonical generator from a retained mirror through the real site lifecycle without publishing it." actions={<Link className="button secondary" href="/admin/sites">Manage sites</Link>} />
    <div className="create-site-shell">
      <CreateSiteForm canaryMode />
    </div>
  </main>;
}
