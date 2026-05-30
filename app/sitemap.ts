import type { MetadataRoute } from "next";
import { repository } from "@/lib/repository";
import { getPublishedVersion } from "@/lib/sample-data";
import { isIndexableSite } from "@/lib/site-publication";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4330";
  const bundles = await repository.listSiteBundles();
  const claims = await repository.listClaims();
  const now = new Date();
  const platformPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8
    }
  ];

  const sitePages = bundles.filter((bundle) => isIndexableSite(bundle, claims)).flatMap((bundle) => {
    const version = getPublishedVersion(bundle.siteModel);
    return version.pages.map((page) => ({
      url: `${baseUrl}/sites/${bundle.siteModel.slug}${page.slug ? `/${page.slug}` : ""}`,
      lastModified: version.createdAt ? new Date(version.createdAt) : now,
      changeFrequency: "weekly" as const,
      priority: page.slug ? 0.7 : 1
    }));
  });

  return [...platformPages, ...sitePages];
}
