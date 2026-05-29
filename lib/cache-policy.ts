export type CachePolicyKind =
  | "public_site"
  | "public_asset"
  | "no_store"
  | "static_next"
  | "metadata";

export type CachePolicy = {
  kind: CachePolicyKind;
  cacheControl?: string;
  cdnCacheControl?: string;
  vary?: string;
};

const noStore = "no-store, no-cache, must-revalidate, proxy-revalidate";

export function cachePolicyForPathname(pathname: string, options: { customDomain?: boolean } = {}): CachePolicy {
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image")) {
    return { kind: "static_next" };
  }

  if (pathname.startsWith("/api/assets/")) {
    return {
      kind: "public_asset",
      cacheControl: "public, max-age=31536000, immutable",
      cdnCacheControl: "public, s-maxage=31536000, immutable"
    };
  }

  if (pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/favicon.ico") {
    return {
      kind: "metadata",
      cacheControl: "public, max-age=300, s-maxage=300",
      cdnCacheControl: "public, s-maxage=300"
    };
  }

  if (options.customDomain || pathname === "/sites" || pathname.startsWith("/sites/")) {
    return {
      kind: "public_site",
      cacheControl: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
      cdnCacheControl: "public, s-maxage=300, stale-while-revalidate=86400",
      vary: "Host"
    };
  }

  return {
    kind: "no_store",
    cacheControl: noStore,
    cdnCacheControl: noStore,
    vary: "Cookie, Authorization"
  };
}

export function cachePolicyHeaders(policy: CachePolicy) {
  const headers: Record<string, string> = {};
  if (policy.cacheControl) headers["Cache-Control"] = policy.cacheControl;
  if (policy.cdnCacheControl) headers["CDN-Cache-Control"] = policy.cdnCacheControl;
  if (policy.vary) headers.Vary = policy.vary;
  headers["X-Lodesta-Cache-Policy"] = policy.kind;
  return headers;
}
