import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "@/packages/site-artifacts";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { loadPublishedSiteContext, markdownForArtifactRoute, requestAcceptsMarkdown, robotsTextForSite } from "@/packages/site-platform";
import type { AgentAccessPolicy } from "@/packages/site-contracts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
) {
  const { slug, path } = await params;
  const context = await loadPublishedSiteContext(slug);
  if (!context) return new Response(null, { status: 404 });
  const { site, version, artifact } = context;
  const policy = context.intent.agentAccessPolicy;
  const requested = path?.join("/") ?? "";
  if (requested === "robots.txt") return siteRobots(request, slug, artifact.artifactHash, version.id, policy);
  if (requested === "sitemap.xml") return siteSitemap(request, slug, artifact.routes.map((route) => route.path), version.publishedAt ?? version.createdAt, artifact.artifactHash, version.id, policy);
  const markdownRoute = markdownRouteForRequest(requested);
  const requestedRoute = markdownRoute ?? normalizeRoute(requested);
  if (markdownRoute !== undefined || requestAcceptsMarkdown(request)) {
    const output = await markdownForArtifactRoute(context, requestedRoute);
    if (!output) return new Response(null, { status: 404 });
    const canonical = publicRouteUrl(request, slug, output.route.path);
    return new Response(output.markdown, {
      headers: siteHeaders("text/markdown; charset=utf-8", artifact.artifactHash, version.id, policy, `<${canonical}>; rel="canonical"`)
    });
  }
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
    headers: siteHeaders(
      blob.contentType,
      artifact.artifactHash,
      version.id,
      policy,
      blob.contentType.startsWith("text/html") ? `<${markdownRouteUrl(request, slug, requestedRoute)}>; rel="alternate"; type="text/markdown"` : undefined
    )
  });
}

function siteRobots(request: Request, slug: string, artifactHash: string, versionId: string, policy: AgentAccessPolicy) {
  const origin = new URL(request.url).origin;
  const basePath = siteBasePath(request, slug);
  return new Response(robotsTextForSite(policy, `${origin}${basePath}/sitemap.xml`), {
    headers: siteHeaders("text/plain; charset=utf-8", artifactHash, versionId, policy)
  });
}

function siteSitemap(request: Request, slug: string, routes: string[], lastModified: string, artifactHash: string, versionId: string, policy: AgentAccessPolicy) {
  const origin = new URL(request.url).origin;
  const basePath = siteBasePath(request, slug);
  const urls = routes.map((route) => `<url><loc>${escapeXml(`${origin}${basePath}${route === "/" ? "" : route}`)}</loc><lastmod>${escapeXml(lastModified)}</lastmod></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: siteHeaders("application/xml; charset=utf-8", artifactHash, versionId, policy)
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

function markdownRouteForRequest(value: string) {
  if (value === "index.md") return "/";
  if (!value.endsWith("/index.md")) return undefined;
  return normalizeRoute(value.slice(0, -"/index.md".length));
}

function publicRouteUrl(request: Request, slug: string, route: string) {
  return `${new URL(request.url).origin}${siteBasePath(request, slug)}${route === "/" ? "" : route}`;
}

function markdownRouteUrl(request: Request, slug: string, route: string) {
  const base = `${new URL(request.url).origin}${siteBasePath(request, slug)}`;
  return route === "/" ? `${base}/index.md` : `${base}${route}/index.md`;
}

function siteHeaders(contentType: string, artifactHash: string, versionId: string, policy: AgentAccessPolicy, link?: string) {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-robots-tag": policy.search === "allow" ? "index, follow" : "noindex, nofollow",
    "x-lodesta-artifact-hash": artifactHash,
    "x-lodesta-site-version": versionId,
    "vary": "Accept, Host, X-Forwarded-Host"
  });
  if (link) headers.set("link", link);
  if (contentType.startsWith("text/html")) {
    headers.set("content-security-policy", "default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'");
  }
  return headers;
}
