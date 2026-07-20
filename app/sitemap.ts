import type { MetadataRoute } from "next";
import { configuredAppOriginOrDefault } from "@/lib/app-origin";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = configuredAppOriginOrDefault();
  const sites = (await sitePlatformRepository.listSites()).filter((site) => site.status === "active" && site.publishedVersionId);
  const sitePages = (await Promise.all(sites.map(async (site) => {
    const version = site.publishedVersionId ? await sitePlatformRepository.getSiteVersion(site.publishedVersionId) : undefined;
    const artifact = version ? await sitePlatformRepository.getBuildArtifact(version.artifactId) : undefined;
    if (!version || version.status !== "published" || !artifact || artifact.qa.hardGate !== "passed") return [];
    return artifact.routes.map((route) => ({
      url: `${baseUrl}/sites/${site.slug}${route.path === "/" ? "" : route.path}`,
      lastModified: new Date(version.publishedAt ?? version.createdAt),
      changeFrequency: "weekly" as const,
      priority: route.path === "/" ? 1 : 0.7
    }));
  }))).flat();
  return [{ url: baseUrl, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 }, ...sitePages];
}
