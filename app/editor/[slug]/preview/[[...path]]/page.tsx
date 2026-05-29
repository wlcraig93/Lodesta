import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEditingVersion } from "@/lib/sample-data";
import { SiteRenderer } from "@/lib/site-renderer";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Draft Preview | SMB Presence Autopilot",
  robots: {
    index: false,
    follow: false
  }
};

export default async function DraftPreviewPage({
  params
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  const { slug, path } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/editor/${slug}`);

  const version = getEditingVersion(bundle.siteModel);
  const pageSlug = path?.join("/") ?? "";
  const page = version.pages.find((candidate) => candidate.slug === pageSlug);
  if (!page) notFound();

  return (
    <SiteRenderer
      business={bundle.businessProfile}
      site={bundle.siteModel}
      extensions={bundle.extensionModel}
      page={page}
      theme={version.theme ?? bundle.siteModel.theme}
      tracking={false}
    />
  );
}
