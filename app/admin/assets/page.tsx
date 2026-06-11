import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssetLibraryReviewPanel } from "@/components/admin/AssetLibraryReviewPanel";
import { listAssetLibraryAssets, listAssetLibraryBatches, type AssetLibraryStatus } from "@/lib/asset-library";
import { requireAdminPageAccess } from "@/lib/page-access";
import type { Vertical } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function AdminAssetLibraryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPageAccess("/admin/assets");
  const params = await searchParams;
  const requestedStatus = stringParam(params.status);
  const filters = {
    vertical: stringParam(params.vertical) ?? "auto_services",
    status: requestedStatus,
    tag: stringParam(params.tag),
    use: stringParam(params.use),
    batch: stringParam(params.batch)
  };
  const statusFilter = requestedStatus && requestedStatus !== "all" ? (requestedStatus as AssetLibraryStatus) : undefined;
  const [assets, batches] = await Promise.all([
    listAssetLibraryAssets({
      vertical: filters.vertical as Vertical,
      status: statusFilter,
      excludeStatuses: requestedStatus ? undefined : ["rejected", "archived"],
      tag: filters.tag,
      intendedUse: filters.use,
      batchId: filters.batch,
      limit: 120
    }),
    listAssetLibraryBatches(50)
  ]);

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow={<span className="badge">Asset library</span>}
        title="Generated image review"
        description="Review generated category images, approve reusable assets, and keep raw candidates out of public site rendering."
      />
      <AssetLibraryReviewPanel initialAssets={assets} batches={batches} filters={filters} />
    </main>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
