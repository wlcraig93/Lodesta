import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedVersion } from "@/lib/sample-data";
import { SiteRenderer } from "@/lib/site-renderer";
import { repository } from "@/lib/repository";
import { isIndexableSite } from "@/lib/site-publication";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}): Promise<Metadata> {
  const { slug, path } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) return {};
  const version = getPublishedVersion(bundle.siteModel);
  const pageSlug = path?.join("/") ?? "";
  const page = version.pages.find((candidate) => candidate.slug === pageSlug);
  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const indexable = isIndexableSite(bundle, claims);
  return {
    title: page?.seo.title,
    description: page?.seo.description,
    robots: {
      index: indexable,
      follow: indexable
    },
    alternates: {
      canonical: page?.seo.canonicalPath
    },
    openGraph: {
      title: page?.seo.title,
      description: page?.seo.description,
      type: "website"
    }
  };
}

export default async function PublicSitePage({
  params
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  const { slug, path } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();

  const version = getPublishedVersion(bundle.siteModel);
  const pageSlug = path?.join("/") ?? "";
  const page = version.pages.find((candidate) => candidate.slug === pageSlug);
  if (!page) notFound();
  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const claimedForPublicRuntime = isIndexableSite(bundle, claims);

  return (
    <SiteRenderer
      business={bundle.businessProfile}
      site={bundle.siteModel}
      extensions={bundle.extensionModel}
      page={page}
      theme={version.theme ?? bundle.siteModel.theme}
      experiments={bundle.experiments}
      tracking={claimedForPublicRuntime}
      formsEnabled={claimedForPublicRuntime}
    />
  );
}
