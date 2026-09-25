import type { MetadataRoute } from "next";
import { configuredAppOriginOrDefault } from "@/lib/app-origin";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = configuredAppOriginOrDefault();
  const generatedAt = new Date();
  const platformPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: generatedAt, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/privacy/`, lastModified: generatedAt, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms/`, lastModified: generatedAt, changeFrequency: "yearly", priority: 0.3 }
  ];
  // A site with a live custom domain is indexed there, not under /sites/.
  const liveDomainSiteIds = new Set((await platformOperationsRepository.listDomains()).filter((domain) => domain.status === "active").map((domain) => domain.siteId));
  const sites = (await sitePlatformRepository.listSites()).filter((site) => site.status === "active" && site.publishedVersionId && !liveDomainSiteIds.has(site.id));
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
  return [...platformPages, ...sitePages];
}
