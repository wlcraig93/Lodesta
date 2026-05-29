import { NextResponse, type NextRequest } from "next/server";
import { cachePolicyForPathname, cachePolicyHeaders } from "./lib/cache-policy";

const skippedPrefixes = [
  "/api/",
  "/_next/",
  "/auth/",
  "/preview/",
  "/editor/",
  "/analytics/",
  "/optimization/",
  "/experiments/",
  "/domains/",
  "/leads/",
  "/outbound",
  "/claim/",
  "/account",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico"
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = normalizeHostname(request.headers.get("host") ?? "");
  if (skippedPrefixes.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) {
    return withCachePolicy(NextResponse.next(), pathname, false);
  }

  if (!hostname || isPlatformHost(hostname)) return withCachePolicy(NextResponse.next(), pathname, false);

  const resolveUrl = new URL("/api/domains/resolve", domainResolveOrigin(request));
  resolveUrl.searchParams.set("hostname", hostname);

  try {
    const response = await fetch(resolveUrl);
    if (!response.ok) return withCachePolicy(NextResponse.next(), pathname, false);
    const payload = (await response.json()) as { resolved?: boolean; slug?: string };
    if (!payload.resolved || !payload.slug) return withCachePolicy(NextResponse.next(), pathname, false);

    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/sites/${payload.slug}${pathname === "/" ? "" : pathname}`;
    return withCachePolicy(NextResponse.rewrite(rewriteUrl), rewriteUrl.pathname, true);
  } catch {
    return withCachePolicy(NextResponse.next(), pathname, false);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().split(":")[0].replace(/\.$/, "");
}

function isPlatformHost(hostname: string) {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  const appHost = process.env.NEXT_PUBLIC_APP_URL ? normalizeHostname(new URL(process.env.NEXT_PUBLIC_APP_URL).host) : "";
  if (appHost && hostname === appHost) return true;
  const configuredHosts = (process.env.LODESTA_PLATFORM_HOSTS ?? "")
    .split(",")
    .map((host) => normalizeHostname(host.trim()))
    .filter(Boolean);
  if (configuredHosts.includes(hostname)) return true;
  return hostname.endsWith(".railway.app") || hostname.endsWith(".up.railway.app");
}

function domainResolveOrigin(request: NextRequest) {
  const configuredOrigin = process.env.LODESTA_INTERNAL_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // Fall back to the request origin so malformed config does not break public rendering.
    }
  }
  return request.nextUrl.origin;
}

function withCachePolicy(response: NextResponse, pathname: string, customDomain: boolean) {
  const headers = cachePolicyHeaders(cachePolicyForPathname(pathname, { customDomain }));
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  return response;
}
