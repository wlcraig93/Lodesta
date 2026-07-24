import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const auth = await getCurrentUser();
  if (!auth.configured || !auth.user) return notFound();

  const { siteId } = await params;
  const site = await sitePlatformRepository.getSite(siteId);
  if (!site || site.ownerUserId !== auth.user.id) return notFound();

  const [versions, runs] = await Promise.all([
    sitePlatformRepository.listSiteVersions(siteId),
    sitePlatformRepository.listRecentAgentRuns({ siteId, limit: 12 })
  ]);
  const published = site.publishedVersionId
    ? versions.find((version) => version.id === site.publishedVersionId)
    : versions.find((version) => version.status === "published");
  const active = runs.find((run) => run.status === "queued" || run.status === "running");
  const candidate = versions.find((version) => version.status === "candidate");
  const latestSuccessful = runs.find((run) => run.status === "succeeded" && run.outputArtifactId);
  const artifactId = active && published
    ? published.artifactId
    : candidate?.artifactId ?? published?.artifactId ?? latestSuccessful?.outputArtifactId;
  if (!artifactId) return notFound();

  const key = `site-captures/${siteId}/${artifactId}/thumbnail.webp`;
  const blob = await configuredArtifactBlobStore().get(key).catch(() => undefined);
  if (!blob || blob.contentType !== "image/webp") return notFound();

  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, max-age=300",
      etag: `"${blob.contentHash}"`
    }
  });
}

function notFound() {
  return NextResponse.json({ error: "Thumbnail not found." }, {
    status: 404,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
