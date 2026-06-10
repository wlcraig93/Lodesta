import type { MetadataRoute } from "next";
import { configuredAppOriginOrDefault } from "@/lib/app-origin";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = configuredAppOriginOrDefault();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/sites/"],
        disallow: [
          "/api/",
          "/auth/",
          "/account",
          "/crawl-fixtures/",
          "/preview/",
          "/editor/",
          "/analytics/",
          "/optimization/",
          "/experiments/",
          "/business/",
          "/leads/",
          "/versions/",
          "/claim/",
          "/domains/",
          "/outbound",
          "/dashboard",
          "/admin"
        ]
      }
    ],
    sitemap: `${baseUrl}/sitemap.xml`
  };
}
