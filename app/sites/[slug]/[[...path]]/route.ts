import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "@/packages/site-artifacts";
import { generatedSiteContentSecurityPolicy } from "@/lib/generated-site-security";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { loadPublishedSiteContext, markdownForArtifactRoute, requestAcceptsMarkdown, robotsTextForSite, sitemapXmlForSite } from "@/packages/site-platform/public-site";
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
    const versionRedirect = await sitePlatformRepository.resolveSiteVersionRedirect(version.id, requestedRoute);
    const ownerRedirect = versionRedirect ? undefined : await platformOperationsRepository.resolveRedirect(site.id, requestedRoute);
    const redirect = versionRedirect ?? ownerRedirect;
    if (!redirect || !artifact.routes.some((route) => route.path === redirect.destinationPath)) return new Response(null, { status: 404 });
    return new Response(null, {
      status: 308,
      headers: {
        location: `${siteBasePath(request, slug)}${redirect.destinationPath === "/" ? "" : redirect.destinationPath}` || "/",
        "cache-control": "public, max-age=60, s-maxage=300",
        "x-lodesta-site-version": version.id,
        "x-lodesta-redirect-id": redirect.id,
        "x-lodesta-redirect-owner": versionRedirect ? "site-version" : "owner"
      }
    });
  }
  const blob = await readVerifiedArtifactFile({ artifact, path: artifactPath, store: configuredArtifactBlobStore() });
  if (!blob) return new Response(null, { status: 404 });
  const htmlLinks = blob.contentType.startsWith("text/html")
    ? [
        `<${publicRouteUrl(request, slug, requestedRoute)}>; rel="canonical"`,
        `<${markdownRouteUrl(request, slug, requestedRoute)}>; rel="alternate"; type="text/markdown"`
      ].join(", ")
    : undefined;
  return new Response(new Uint8Array(blob.bytes), {
    headers: siteHeaders(
      blob.contentType,
      artifact.artifactHash,
      version.id,
      policy,
      htmlLinks
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
  return new Response(sitemapXmlForSite({ origin, basePath, routes, lastModified }), {
    headers: siteHeaders("application/xml; charset=utf-8", artifactHash, versionId, policy)
  });
}

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
    headers.set("content-security-policy", generatedSiteContentSecurityPolicy("self"));
  }
  return headers;
}
