import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/sites/"],
        disallow: ["/api/", "/auth/", "/account", "/preview/", "/editor/", "/claim/", "/domains/"]
      }
    ],
    sitemap: `${baseUrl}/sitemap.xml`
  };
}
