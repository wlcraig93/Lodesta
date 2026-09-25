import { NextResponse, type NextRequest } from "next/server";
import { configuredAppOrigin } from "./lib/app-origin";
import { pilotRestricted, restrictedPilotHeaders } from "./lib/pilot-access";
import { cachePolicyForPathname, cachePolicyHeaders } from "./lib/cache-policy";
import {
  customDomainRoutedHeader,
  isPlatformHost,
  normalizeHostname,
  requestHostname
} from "./lib/host-routing";
import {
  getCachedDomainResolution,
  rememberDomainResolution,
  type DomainResolutionCacheValue
} from "./lib/domain-resolution-cache";

const skippedPrefixes = [
  "/api/",
  "/_next/",
  "/_lodesta/",
  "/auth/",
  "/preview/",
  "/crawl-fixtures/",
  "/workspace/",
  "/outbound",
  "/admin/",
  "/account",
  "/favicon.ico"
];
const forwardedHostRewriteParam = "__lodesta_forwarded_host";
const domainResolveBypassHeader = "x-lodesta-domain-resolve";

export async function middleware(request: NextRequest) {
  const response = await routeRequest(request);
  // Restricted pilot responses must never be stored by a browser or CDN,
  // including after a successful sign-in.
  if (pilotRestricted(requestHostname(request.headers), request.nextUrl.pathname)) {
    for (const [name, value] of Object.entries(restrictedPilotHeaders(response.headers.get("vary")))) response.headers.set(name, value);
  }
  return response;
}

async function routeRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Deployment health checks may use an internal Host header that is neither
  // a Lodesta platform hostname nor a customer domain. Liveness must reach the
  // health route before custom-domain resolution is considered.
  if (pathname === "/api/health") {
    return withCachePolicy(NextResponse.next(), pathname, false, false);
  }
  if (pathname === "/api/domains/resolve" && request.headers.get(domainResolveBypassHeader) === "1") {
    return NextResponse.next();
  }

  const directHostname = normalizeHostname(request.headers.get("host") ?? "");
  const hostname = requestHostname(request.headers);
  const platformHost = !hostname || isPlatformHost(hostname);
  const accessDenied = pilotAccessDenied(request, hostname, pathname);
  if (accessDenied) return accessDenied;
  const hasForwardedHostSignal = Boolean(request.headers.get("x-forwarded-host") || request.headers.get("forwarded"));
  const forwardedHostRouted =
    request.nextUrl.searchParams.get(forwardedHostRewriteParam) === "1" ||
    request.headers.get(customDomainRoutedHeader) === "1" ||
    (hasForwardedHostSignal && hostname !== directHostname);
  if (skippedPrefixes.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) {
    if (platformHost) return withCachePolicy(NextResponse.next(), pathname, false, forwardedHostRouted);
    if (!isPublicRuntimeSkippedPath(pathname)) return notFound();

    const payload = await resolveCustomerDomain(request, hostname);
    if (!payload.resolved || !payload.slug) return notFound();
    return withCachePolicy(
      NextResponse.next({
        request: {
          headers: routedRequestHeaders(request)
        }
      }),
      pathname,
      !pathname.startsWith("/api/"),
      forwardedHostRouted
    );
  }

  if (platformHost) return withCachePolicy(NextResponse.next(), pathname, false, forwardedHostRouted);

  const payload = await resolveCustomerDomain(request, hostname);
  if (!payload.resolved || !payload.slug) return notFound();

  const rewrittenSitePrefix = `/sites/${payload.slug}`;
  const rewriteHeaders = routedRequestHeaders(request);
  if (pathname === rewrittenSitePrefix || pathname.startsWith(`${rewrittenSitePrefix}/`)) {
    return withCachePolicy(
      NextResponse.next({
        request: {
          headers: rewriteHeaders
        }
      }),
      pathname,
      true,
      forwardedHostRouted
    );
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/sites/${payload.slug}${pathname === "/" ? "" : pathname}`;
  if (forwardedHostRouted) rewriteUrl.searchParams.set(forwardedHostRewriteParam, "1");
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
}

/**
 * Internal pilot sites are access-restricted, not merely unlisted: listed
 * hostnames and /sites/ slugs require the team credential (HTTP Basic).
 * Monitoring sends the same credential. Unset variables restrict nothing.
 */
function pilotAccessDenied(request: NextRequest, hostname: string, pathname: string) {
  const credential = process.env.LODESTA_PILOT_ACCESS_CREDENTIAL?.trim();
  if (!credential || !pilotRestricted(hostname, pathname)) return undefined;
  const supplied = request.headers.get("authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
  if (supplied && constantTimeEqual(supplied, btoa(credential))) return undefined;
  return new NextResponse("Sign in to view this pilot site.", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Lodesta pilot", charset="UTF-8"', "cache-control": "no-store", "x-robots-tag": "noindex" }
  });
}

function constantTimeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};

function domainResolveOrigin(request: NextRequest) {
  const configuredOrigin = configuredAppOrigin();
  if (configuredOrigin) return configuredOrigin;
  return request.nextUrl.origin;
}

async function resolveCustomerDomain(request: NextRequest, hostname: string): Promise<DomainResolutionCacheValue> {
  const cached = getCachedDomainResolution(hostname);
  if (cached) return cached;

  const resolveUrl = new URL("/api/domains/resolve", domainResolveOrigin(request));
  resolveUrl.searchParams.set("hostname", hostname);

  try {
    const response = await fetch(resolveUrl, { headers: { [domainResolveBypassHeader]: "1" } });
    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        return rememberDomainResolution(hostname, { resolved: false });
      }
      return { resolved: false };
    }
    const payload = (await response.json()) as {
      resolved?: boolean;
      slug?: string;
      siteId?: string;
      domainStatus?: string;
    };
    if (!payload.resolved || !payload.slug) {
      return rememberDomainResolution(hostname, { resolved: false });
    }
    return rememberDomainResolution(hostname, {
      resolved: true,
      slug: payload.slug,
      siteId: payload.siteId,
      domainStatus: payload.domainStatus
    });
  } catch {
    return { resolved: false };
  }
}

function routedRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(customDomainRoutedHeader, "1");
  return headers;
}

// Customer hostnames expose only what a published site calls: form
// submission, analytics, public assets and the trusted runtime.
function isPublicRuntimeSkippedPath(pathname: string) {
  // trailingSlash: true redirects API calls to their slashed form, so accept both.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path === "/api/forms/submit"
    || path === "/api/analytics"
    || (pathname.startsWith("/api/assets/") && !pathname.startsWith("/api/assets/owner"))
    || pathname.startsWith("/_next/")
    || pathname.startsWith("/_lodesta/")
    || pathname === "/favicon.ico";
}

function notFound() {
  return new NextResponse(null, { status: 404 });
}

function withCachePolicy(response: NextResponse, pathname: string, customDomain: boolean, forwardedHostRouted = false) {
  const headers = cachePolicyHeaders(cachePolicyForPathname(pathname, { customDomain }));
  if (forwardedHostRouted) {
    Object.assign(headers, cachePolicyHeaders(cachePolicyForPathname("/__forwarded-host-no-store")));
    headers["Cloudflare-CDN-Cache-Control"] = "no-store";
    headers["X-Lodesta-Forwarded-Host-Cache"] = "no-store";
  }
  for (const [name, value] of Object.entries({ ...headers, ...baselineSecurityHeaders })) {
    response.headers.set(name, value);
  }
  return response;
}

// HSTS omits includeSubDomains: a customer's other subdomains are not ours.
const baselineSecurityHeaders = {
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin"
};
