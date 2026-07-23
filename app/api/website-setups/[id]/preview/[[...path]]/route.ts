import { readVerifiedManifestPreviewFile } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { requireOwnedWebsiteSetup } from "../../../auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; path?: string[] }> }) {
  const { id, path } = await context.params;
  const access = await requireOwnedWebsiteSetup(id);
  if (!access.ok || access.setup.status !== "linked" || !access.setup.siteId || !access.setup.sessionId || !access.setup.runId) return notFound();

  const [site, session, run] = await Promise.all([
    sitePlatformRepository.getSite(access.setup.siteId),
    sitePlatformRepository.getAgentSession(access.setup.sessionId),
    sitePlatformRepository.getAgentRun(access.setup.runId)
  ]);
  if (!site || site.ownerUserId !== access.user.id || !session || !run
    || session.id !== access.setup.sessionId
    || session.siteId !== site.id
    || session.ownerId !== access.setup.ownerUserId
    || run.id !== access.setup.runId
    || run.siteId !== site.id
    || run.sessionId !== session.id
    || run.status !== "succeeded"
    || !run.candidateVersionId) return notFound();

  const version = await sitePlatformRepository.getSiteVersion(run.candidateVersionId);
  if (!version || version.siteId !== site.id || version.status !== "candidate") return notFound();
  const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
  if (!artifact || artifact.siteId !== site.id || artifact.qa.hardGate !== "passed" || artifact.artifactHash !== version.artifactHash) {
    return new Response(null, { status: 503 });
  }

  const blob = await readVerifiedManifestPreviewFile({ artifact, path, requestUrl: request.url });
  if (!blob) return notFound();
  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": blob.contentType,
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'; sandbox allow-same-origin",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "x-lodesta-artifact-hash": artifact.artifactHash,
      "x-lodesta-site-version": version.id,
      "x-lodesta-setup-preview": "1"
    }
  });
}

function notFound() { return new Response(null, { status: 404 }); }
