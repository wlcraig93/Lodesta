import { NextResponse, type NextRequest } from "next/server";
import { cachePolicyForPathname, cachePolicyHeaders } from "./lib/cache-policy";
import { isPlatformHost, normalizeHostname, requestHostname } from "./lib/host-routing";

const skippedPrefixes = [
  "/api/",
  "/_next/",
  "/auth/",
  "/preview/",
  "/editor/",
  "/analytics/",
  "/optimization/",
  "/experiments/",
  "/business/",
  "/domains/",
  "/leads/",
  "/versions/",
  "/outbound",
  "/claim/",
  "/account",
  "/favicon.ico"
];
const siteSeoPaths = new Set(["/robots.txt", "/sitemap.xml", "/llms.txt"]);
const forwardedHostRewriteParam = "__lodesta_forwarded_host";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const directHostname = normalizeHostname(request.headers.get("host") ?? "");
  const hostname = requestHostname(request.headers);
  const forwardedHostRouted =
    request.nextUrl.searchParams.get(forwardedHostRewriteParam) === "1" ||
    request.headers.get("x-lodesta-forwarded-host-routed") === "1" ||
    (Boolean(request.headers.get("x-forwarded-host")) && hostname !== directHostname);
  if (siteSeoPaths.has(pathname) && (!hostname || isPlatformHost(hostname))) {
    return withCachePolicy(NextResponse.next(), pathname, false, forwardedHostRouted);
  }
  if (skippedPrefixes.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) {
    return withCachePolicy(NextResponse.next(), pathname, false, forwardedHostRouted);
  }

  if (!hostname || isPlatformHost(hostname)) return withCachePolicy(NextResponse.next(), pathname, false, forwardedHostRouted);

  const resolveUrl = new URL("/api/domains/resolve", domainResolveOrigin(request));
  resolveUrl.searchParams.set("hostname", hostname);

  try {
    const response = await fetch(resolveUrl);
    if (!response.ok) return withCachePolicy(NextResponse.next(), pathname, false);
    const payload = (await response.json()) as { resolved?: boolean; slug?: string };
    if (!payload.resolved || !payload.slug) return withCachePolicy(NextResponse.next(), pathname, false);

    const rewrittenSitePrefix = `/sites/${payload.slug}`;
    if (pathname === rewrittenSitePrefix || pathname.startsWith(`${rewrittenSitePrefix}/`)) {
      return withCachePolicy(NextResponse.next(), pathname, true, forwardedHostRouted);
    }

    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/sites/${payload.slug}${pathname === "/" ? "" : pathname}`;
    if (forwardedHostRouted) rewriteUrl.searchParams.set(forwardedHostRewriteParam, "1");
    const rewriteHeaders = new Headers(request.headers);
    if (forwardedHostRouted) rewriteHeaders.set("x-lodesta-forwarded-host-routed", "1");
    return withCachePolicy(
      NextResponse.rewrite(rewriteUrl, {
        request: {
          headers: rewriteHeaders
        }
      }),
      rewriteUrl.pathname,
      true,
      forwardedHostRouted
    );
  } catch {
    return withCachePolicy(NextResponse.next(), pathname, false);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};

function domainResolveOrigin(request: NextRequest) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // Fall back to the request origin so malformed config does not break public rendering.
    }
  }
  return request.nextUrl.origin;
}

function withCachePolicy(response: NextResponse, pathname: string, customDomain: boolean, forwardedHostRouted = false) {
  const headers = cachePolicyHeaders(cachePolicyForPathname(pathname, { customDomain }));
  if (forwardedHostRouted) {
    Object.assign(headers, cachePolicyHeaders(cachePolicyForPathname("/__forwarded-host-no-store")));
    headers["Cloudflare-CDN-Cache-Control"] = "no-store";
    headers["X-Lodesta-Forwarded-Host-Cache"] = "no-store";
  }
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  return response;
}
