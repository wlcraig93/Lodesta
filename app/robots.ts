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
          "/workspace/",
          "/adopt/",
          "/outbound",
          "/admin"
        ]
      }
    ],
    sitemap: `${baseUrl}/sitemap.xml`
  };
}
