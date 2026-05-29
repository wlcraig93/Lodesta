import { NextResponse, type NextRequest } from "next/server";

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
  "/claim/",
  "/account",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico"
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (skippedPrefixes.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const hostname = normalizeHostname(request.headers.get("host") ?? "");
  if (!hostname || isPlatformHost(hostname)) return NextResponse.next();

  const resolveUrl = new URL("/api/domains/resolve", request.url);
  resolveUrl.searchParams.set("hostname", hostname);

  try {
    const response = await fetch(resolveUrl);
    if (!response.ok) return NextResponse.next();
    const payload = (await response.json()) as { resolved?: boolean; slug?: string };
    if (!payload.resolved || !payload.slug) return NextResponse.next();

    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/sites/${payload.slug}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  } catch {
    return NextResponse.next();
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
