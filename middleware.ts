import { NextResponse, type NextRequest } from "next/server";
import { configuredAppOrigin } from "./lib/app-origin";
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
  "/editor/",
  "/analytics/",
  "/optimization/",
  "/experiments/",
  "/business/",
  "/domains/",
  "/leads/",
  "/versions/",
  "/outbound",
  "/dashboard",
  "/admin/",
  "/claim/",
  "/account",
  "/favicon.ico"
];
const forwardedHostRewriteParam = "__lodesta_forwarded_host";
const domainResolveBypassHeader = "x-lodesta-domain-resolve";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/domains/resolve" && request.headers.get(domainResolveBypassHeader) === "1") {
    return NextResponse.next();
  }

  const directHostname = normalizeHostname(request.headers.get("host") ?? "");
  const hostname = requestHostname(request.headers);
  const platformHost = !hostname || isPlatformHost(hostname);
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

function isPublicRuntimeSkippedPath(pathname: string) {
  return pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/_lodesta/") || pathname === "/favicon.ico";
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
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  return response;
}
