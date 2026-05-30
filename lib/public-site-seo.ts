import type { ClaimRecord, PageModel, SiteBundle } from "./models";
import { getPublishedVersion } from "./sample-data";
import { isIndexableSite } from "./site-publication";
import { isCustomDomainRequest, requestOrigin, type HeaderReader } from "./host-routing";

export function canonicalUrlForPage(bundle: SiteBundle, page: PageModel, headers: HeaderReader) {
  const canonicalPath = normalizeCanonicalPath(page.seo.canonicalPath || page.slug);
  if (isCustomDomainRequest(headers)) return `${requestOrigin(headers)}${canonicalPath}`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? requestOrigin(headers).replace(/\/$/, "");
  return `${baseUrl}/sites/${bundle.siteModel.slug}${canonicalPath === "/" ? "" : canonicalPath}`;
}

export function siteRobotsTxt(bundle: SiteBundle, claims: ClaimRecord[], headers: HeaderReader) {
  if (!isIndexableSite(bundle, claims)) {
    return ["User-agent: *", "Disallow: /"].join("\n") + "\n";
  }

  return ["User-agent: *", "Allow: /", `Sitemap: ${siteSitemapUrl(bundle, headers)}`].join("\n") + "\n";
}

export function siteSitemapXml(bundle: SiteBundle, claims: ClaimRecord[], headers: HeaderReader) {
  const version = getPublishedVersion(bundle.siteModel);
  const urls = isIndexableSite(bundle, claims)
    ? version.pages.map((page) => ({
        loc: canonicalUrlForPage(bundle, page, headers),
        lastmod: version.createdAt,
        changefreq: "weekly",
        priority: page.slug ? "0.7" : "1.0"
      }))
    : [];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.flatMap((url) => [
      "  <url>",
      `    <loc>${escapeXml(url.loc)}</loc>`,
      `    <lastmod>${escapeXml(new Date(url.lastmod).toISOString())}</lastmod>`,
      `    <changefreq>${url.changefreq}</changefreq>`,
      `    <priority>${url.priority}</priority>`,
      "  </url>"
    ]),
    "</urlset>"
  ].join("\n");
}

function siteSitemapUrl(bundle: SiteBundle, headers: HeaderReader) {
  if (isCustomDomainRequest(headers)) return `${requestOrigin(headers)}/sitemap.xml`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? requestOrigin(headers).replace(/\/$/, "");
  return `${baseUrl}/sites/${bundle.siteModel.slug}/sitemap.xml`;
}

function normalizeCanonicalPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
