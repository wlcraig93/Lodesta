import { NextResponse } from "next/server";
import {
  ASSET_LIBRARY_STATUS_VALUES,
  listAssetLibraryAssets,
  listAssetLibraryBatches,
  type AssetLibraryStatus
} from "@/lib/asset-library";
import { requireAdmin } from "@/lib/security";
import type { Vertical } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set<string>(ASSET_LIBRARY_STATUS_VALUES);

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const params = new URL(request.url).searchParams;
  const status = params.get("status")?.trim();
  const vertical = params.get("vertical")?.trim();
  const statusFilter = status && status !== "all" && statuses.has(status) ? (status as AssetLibraryStatus) : undefined;
  const assets = await listAssetLibraryAssets({
    vertical: vertical ? (vertical as Vertical) : undefined,
    status: statusFilter,
    excludeStatuses: status ? undefined : ["rejected", "archived"],
    tag: params.get("tag")?.trim() || undefined,
    intendedUse: params.get("use")?.trim() || undefined,
    batchId: params.get("batch")?.trim() || undefined,
    limit: numberParam(params, "limit") ?? 100,
    offset: numberParam(params, "offset")
  });
  const batches = await listAssetLibraryBatches(50);

  return NextResponse.json({ assets, batches });
}

function numberParam(params: URLSearchParams, key: string) {
  const value = params.get(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
