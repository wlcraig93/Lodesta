import { randomBytes } from "node:crypto";
import { readStoredAsset } from "@/lib/asset-storage";
import { generatedSiteContentSecurityPolicy } from "@/lib/generated-site-security";
import { resolveManagedPreviewAsset, rewritePreviewAssetUrls } from "@/lib/private-preview-assets";
import {
  hasValidPreviewSession,
  platformOperationsRepository
} from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import {
  configuredArtifactBlobStore,
  readVerifiedManifestPreviewFile,
  resolveSafeManifestPreviewRoute
} from "@/packages/site-artifacts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ previewId: string; path?: string[] }> }) {
  const { previewId, path } = await params;
  const preview = await platformOperationsRepository.getPreviewGrant(previewId);
  if (!preview) return notFound();
  if (!hasValidPreviewSession(request, preview)) return exchangeShell(previewId);
  const version = await sitePlatformRepository.getSiteVersion(preview.siteVersionId);
  if (!version || version.siteId !== preview.siteId || version.status === "rejected") return notFound();
  const site = await sitePlatformRepository.getSite(version.siteId);
  if (!site) return notFound();
  const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
  if (!artifact || artifact.qa.hardGate !== "passed" || artifact.artifactHash !== version.artifactHash) return new Response(null, { status: 503 });

  if (path?.[0] === "__asset") {
    const assetSiteId = path[1];
    const file = path.slice(2).join("/");
    if (assetSiteId !== site.id || !file) return notFound();
    const managed = await resolveManagedPreviewAsset({
      revisionId: file,
      businessId: site.businessId,
      allowedRevisionIds: version.assetRevisionIds,
      repository: sitePlatformRepository,
      blobStore: configuredArtifactBlobStore()
    });
    if (managed) {
      return new Response(new Uint8Array(managed.bytes), {
        headers: previewHeaders({
          contentType: managed.mimeType,
          artifactHash: artifact.artifactHash,
          versionId: version.id
        })
      });
    }
    const revision = await sitePlatformRepository.getAssetRevisionByStorageKey(`${site.id}/${file}`);
    if (!revision || !version.assetRevisionIds.includes(revision.id)) return notFound();
    const asset = await readStoredAsset(`${site.id}/${file}`);
    if (!asset) return notFound();
    return new Response(new Uint8Array(asset.bytes), {
      headers: previewHeaders({
        contentType: asset.mimeType,
        artifactHash: artifact.artifactHash,
        versionId: version.id
      })
    });
  }

  const blob = await readVerifiedManifestPreviewFile({ artifact, path, requestUrl: request.url });
  if (!blob) {
    const requestedRoute = resolveSafeManifestPreviewRoute({ path, requestUrl: request.url });
    if (!requestedRoute) return notFound();
    const versionRedirect = await sitePlatformRepository.resolveSiteVersionRedirect(version.id, requestedRoute);
    const ownerRedirect = versionRedirect ? undefined : await platformOperationsRepository.resolveRedirect(site.id, requestedRoute);
    const redirect = versionRedirect ?? ownerRedirect;
    if (!redirect || !artifact.routes.some((route) => route.path === redirect.destinationPath)) return notFound();
    return new Response(null, {
      status: 308,
      headers: {
        location: previewRoutePath(preview.id, redirect.destinationPath),
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex, nofollow",
        "x-lodesta-site-version": version.id,
        "x-lodesta-preview": "1",
        "x-lodesta-redirect-id": redirect.id,
        "x-lodesta-redirect-owner": versionRedirect ? "site-version" : "owner"
      }
    });
  }
  const bytes = rewritePreviewAssetUrls(blob.bytes, blob.contentType, preview.id, site.id);
  return new Response(new Uint8Array(bytes), {
    headers: previewHeaders({
      contentType: blob.contentType,
      artifactHash: artifact.artifactHash,
      versionId: version.id
    })
  });
}

function previewRoutePath(previewId: string, route: string) {
  const base = `/preview/${encodeURIComponent(previewId)}`;
  return route === "/" ? `${base}/` : `${base}${route}`;
}

function exchangeShell(previewId: string) {
  const nonce = randomBytes(18).toString("base64");
  const id = JSON.stringify(previewId);
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Private Lodesta preview</title>
<style>html{color-scheme:light}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f1ea;color:#1d241f;font:16px/1.5 system-ui,sans-serif}.card{width:min(28rem,calc(100% - 3rem));padding:2rem;border:1px solid #d7d2c7;border-radius:1rem;background:#fff;box-shadow:0 1rem 3rem #27302612}h1{font:600 1.5rem/1.2 Georgia,serif}p{color:#5d655f}.error{color:#9a3324}</style>
</head>
<body><main class="card"><h1>Opening your private preview</h1><p id="status">Verifying this preview link…</p><noscript><p class="error">JavaScript is required to exchange this private preview link.</p></noscript></main>
<script nonce="${nonce}">(()=>{const status=document.getElementById("status");const secret=location.hash.slice(1);history.replaceState(null,"",location.pathname+location.search);if(!secret){status.textContent="This preview link is incomplete or has expired.";status.className="error";return}fetch("/api/previews/"+encodeURIComponent(${id})+"/session",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({secret})}).then(async response=>{if(!response.ok)throw new Error("invalid");location.reload()}).catch(()=>{status.textContent="This preview link is invalid, expired, or revoked.";status.className="error"})})();</script>
</body></html>`;
  return new Response(body, {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

function previewHeaders(input: { contentType: string; artifactHash: string; versionId: string }) {
  return {
    "content-type": input.contentType,
    "cache-control": "private, no-store",
    "content-security-policy": generatedSiteContentSecurityPolicy("self"),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
    "x-lodesta-artifact-hash": input.artifactHash,
    "x-lodesta-site-version": input.versionId,
    "x-lodesta-preview": "1"
  };
}

function notFound() {
  return new Response(null, {
    status: 404,
    headers: {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}
