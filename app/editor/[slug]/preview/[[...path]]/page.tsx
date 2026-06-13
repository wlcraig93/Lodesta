import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEditingVersion } from "@/lib/sample-data";
import { SiteRenderer } from "@/lib/site-renderer";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { assertSiteVersionV3, findPageBySlugV3 } from "@/lib/site-version-v3";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Draft Preview | SMB Presence Autopilot",
  robots: {
    index: false,
    follow: false
  }
};

export default async function DraftPreviewPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string; path?: string[] }>;
  searchParams: Promise<{ versionId?: string }>;
}) {
  const { slug, path } = await params;
  const { versionId } = await searchParams;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/editor/${slug}`);

  const version = versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === versionId)
    : getEditingVersion(bundle.siteModel);
  if (!version) notFound();
  const v3Version = assertSiteVersionV3(version, "draft preview version");
  const pageSlug = path?.join("/") ?? "";
  const page = findPageBySlugV3(v3Version, pageSlug);
  if (!page) notFound();

  return (
    <SiteRenderer
      business={bundle.businessProfile}
      site={bundle.siteModel}
      extensions={bundle.extensionModel}
      locations={bundle.locations}
      locationBindings={bundle.locationBindings}
      version={v3Version}
      page={page}
      theme={v3Version.theme ?? bundle.siteModel.theme}
      tracking={false}
      formsEnabled={false}
      referenceBrandingEnabled
    />
  );
}
