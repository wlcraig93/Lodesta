import type { MetadataRoute } from "next";
import { configuredAppOriginOrDefault } from "@/lib/app-origin";
import { generationCrawlerProductToken } from "@/packages/business-data/robots-policy";

const privatePaths = ["/api/", "/auth/", "/account", "/preview/", "/workspace/", "/adopt/", "/outbound", "/admin"];

export default function robots(): MetadataRoute.Robots {
  const baseUrl = configuredAppOriginOrDefault();

  return {
    rules: [
      { userAgent: "*", allow: ["/sites/"], disallow: [...privatePaths, "/crawl-fixtures/"] },
      // Lodesta's own crawler may read the token-gated, noindex crawl fixture
      // that the owner-journey canary builds from; search engines may not.
      { userAgent: generationCrawlerProductToken, allow: ["/sites/", "/crawl-fixtures/"], disallow: privatePaths }
    ],
    sitemap: `${baseUrl}/sitemap.xml`
  };
}
