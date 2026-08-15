import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { replaySourcePage } from "@/packages/site-platform/source-replay";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ snapshotId: string; path?: string[] }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { snapshotId, path = [] } = await params;
  const url = new URL(request.url);
  const sourcePath = `/${path.join("/")}${url.search}`;
  const response = await replaySourcePage({
    sourceSnapshotId: snapshotId,
    path: sourcePath,
    replayRoot: `${url.origin}/api/admin/source-snapshots`,
    repository: sitePlatformRepository,
    blobStore: configuredArtifactBlobStore()
  });
  if (!response) return NextResponse.json({ error: "Source replay page not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(response.body), {
    status: response.status,
    headers: { ...response.headers, "content-type": response.contentType }
  });
}
