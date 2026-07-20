import { sitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "@/packages/site-artifacts";
import { platformOperationsRepository } from "@/packages/platform-operations";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
) {
  const { slug, path } = await params;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site?.publishedVersionId || site.status !== "active") return new Response(null, { status: 404 });
  const version = await sitePlatformRepository.getSiteVersion(site.publishedVersionId);
  if (!version || version.status !== "published") return new Response(null, { status: 404 });
  const artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
  if (!artifact || artifact.artifactHash !== version.artifactHash || artifact.qa.hardGate !== "passed") {
    return new Response(null, { status: 503 });
  }
  const requested = path?.join("/") ?? "";
  if (requested === "robots.txt") return siteRobots(request, slug, artifact.artifactHash, version.id);
  if (requested === "sitemap.xml") return siteSitemap(request, slug, artifact.routes.map((route) => route.path), version.publishedAt ?? version.createdAt, artifact.artifactHash, version.id);
  const requestedRoute = normalizeRoute(requested);
  const artifactPath = requested === "site.css"
    ? "site.css"
    : artifact.routes.find((route) => requestedRoute === route.path)?.htmlFile;
  if (!artifactPath) {
    const redirect = await platformOperationsRepository.resolveRedirect(site.id, requestedRoute);
    if (!redirect || !artifact.routes.some((route) => route.path === redirect.destinationPath)) return new Response(null, { status: 404 });
    return new Response(null, {
      status: 308,
      headers: {
        location: `${siteBasePath(request, slug)}${redirect.destinationPath === "/" ? "" : redirect.destinationPath}` || "/",
        "cache-control": "public, max-age=60, s-maxage=300",
        "x-lodesta-site-version": version.id,
        "x-lodesta-redirect-id": redirect.id
      }
    });
  }
  const blob = await readVerifiedArtifactFile({ artifact, path: artifactPath, store: configuredArtifactBlobStore() });
  if (!blob) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(blob.bytes), {
    headers: siteHeaders(blob.contentType, artifact.artifactHash, version.id)
  });
}

function siteRobots(request: Request, slug: string, artifactHash: string, versionId: string) {
  const origin = new URL(request.url).origin;
  const basePath = siteBasePath(request, slug);
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${origin}${basePath}/sitemap.xml\n`, {
    headers: siteHeaders("text/plain; charset=utf-8", artifactHash, versionId)
  });
}

function siteSitemap(request: Request, slug: string, routes: string[], lastModified: string, artifactHash: string, versionId: string) {
  const origin = new URL(request.url).origin;
  const basePath = siteBasePath(request, slug);
  const urls = routes.map((route) => `<url><loc>${escapeXml(`${origin}${basePath}${route === "/" ? "" : route}`)}</loc><lastmod>${escapeXml(lastModified)}</lastmod></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: siteHeaders("application/xml; charset=utf-8", artifactHash, versionId)
  });
}

function escapeXml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

function siteBasePath(request: Request, slug: string) {
  return request.headers.get("x-lodesta-custom-domain-routed") === "1" ? "" : `/sites/${encodeURIComponent(slug)}`;
}

function normalizeRoute(value: string) {
  const clean = value.replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}` : "/";
}

function siteHeaders(contentType: string, artifactHash: string, versionId: string) {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-lodesta-artifact-hash": artifactHash,
    "x-lodesta-site-version": versionId
  });
  if (contentType.startsWith("text/html")) {
    headers.set("content-security-policy", "default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'");
  }
  return headers;
}
