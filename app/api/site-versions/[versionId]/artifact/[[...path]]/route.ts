import { sitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "@/packages/site-artifacts";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { generatedSiteContentSecurityPolicy } from "@/lib/generated-site-security";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string; path?: string[] }> }
) {
  const { versionId, path } = await params;
  const version = await sitePlatformRepository.getSiteVersion(versionId);
  if (!version) return new Response(null, { status: 404 });
  const unauthorized = await requireAdminOrSiteOwner(request, version.siteId);
  if (unauthorized) return unauthorized;
  const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
  if (!artifact || artifact.artifactHash !== version.artifactHash) return new Response(null, { status: 503 });
  const requested = path?.join("/") ?? "";
  const artifactPath = requested === "site.css"
    ? "site.css"
    : artifact.routes.find((route) => normalizeRoute(requested) === route.path)?.htmlFile;
  if (!artifactPath) return new Response(null, { status: 404 });
  const blob = await readVerifiedArtifactFile({ artifact, path: artifactPath, store: configuredArtifactBlobStore() });
  if (!blob) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": blob.contentType,
      "cache-control": "private, no-store",
      "content-security-policy": generatedSiteContentSecurityPolicy("none"),
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

function normalizeRoute(value: string) {
  const clean = value.replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}` : "/";
}
