import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import { readVerifiedManifestPreviewFile } from "@/packages/site-artifacts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; path?: string[] }> }) {
  const { token, path } = await params;
  const preview = await platformOperationsRepository.resolvePreviewToken(token);
  if (!preview) return new Response(null, { status: 404 });
  const version = await sitePlatformRepository.getSiteVersion(preview.siteVersionId);
  if (!version || version.siteId !== preview.siteId || version.status === "rejected") return new Response(null, { status: 404 });
  const site = await sitePlatformRepository.getSite(version.siteId);
  if (!site) return new Response(null, { status: 404 });
  const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
  if (!artifact || artifact.qa.hardGate !== "passed" || artifact.artifactHash !== version.artifactHash) return new Response(null, { status: 503 });

  const blob = await readVerifiedManifestPreviewFile({ artifact, path, requestUrl: request.url });
  if (!blob) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": blob.contentType,
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "x-lodesta-artifact-hash": artifact.artifactHash,
      "x-lodesta-site-version": version.id,
      "x-lodesta-preview": "1"
    }
  });
}
