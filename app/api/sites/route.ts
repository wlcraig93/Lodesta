import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { assertSiteVersionV3, pageCountForVersionV3 } from "@/lib/site-version-v3";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const sites = await repository.listSiteBundles();
  const previewEntries = await Promise.all(
    sites.map(async (bundle) => [
      bundle.businessProfile.siteId,
      await repository.listPreviewTokens(bundle.businessProfile.siteId)
    ] as const)
  );
  const previewsBySite = new Map(previewEntries);
  return NextResponse.json({
    sites: sites.map((bundle) => ({
      siteId: bundle.businessProfile.siteId,
      slug: bundle.siteModel.slug,
      name: bundle.businessProfile.name,
      vertical: bundle.businessProfile.vertical,
      previewToken: previewsBySite.get(bundle.businessProfile.siteId)?.[0]?.token,
      versions: bundle.siteModel.versions.map((version) => ({
        id: version.id,
        status: version.status,
        createdAt: version.createdAt,
        pages: pageCountForVersionV3(assertSiteVersionV3(version, "site API version"))
      })),
      evidenceItems: bundle.presenceAssessment.evidenceManifest?.items.length ?? 0,
      experiments: bundle.experiments.length
    }))
  });
}
