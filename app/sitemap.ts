import type { MetadataRoute } from "next";
import { repository } from "@/lib/repository";
import { getPublishedVersion } from "@/lib/sample-data";
import { isIndexableSite } from "@/lib/site-publication";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const bundles = await repository.listSiteBundles();
  const claims = await repository.listClaims();
  const now = new Date();

  return bundles.filter((bundle) => isIndexableSite(bundle, claims)).flatMap((bundle) => {
    const version = getPublishedVersion(bundle.siteModel);
    return version.pages.map((page) => ({
      url: `${baseUrl}/sites/${bundle.siteModel.slug}${page.slug ? `/${page.slug}` : ""}`,
      lastModified: version.createdAt ? new Date(version.createdAt) : now,
      changeFrequency: "weekly" as const,
      priority: page.slug ? 0.7 : 1
    }));
  });
}
