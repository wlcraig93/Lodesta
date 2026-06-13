import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { getPublishedVersion } from "@/lib/sample-data";
import { SiteRenderer } from "@/lib/site-renderer";
import { repository } from "@/lib/repository";
import { isIndexableSite } from "@/lib/site-publication";
import { canonicalUrlForPage } from "@/lib/public-site-seo";
import { markdownUrlForPage } from "@/lib/public-site-markdown";
import { isCustomDomainRequest } from "@/lib/host-routing";
import { assertSiteVersionV3, findPageBySlugV3 } from "@/lib/site-version-v3";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}): Promise<Metadata> {
  const { slug, path } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) return {};
  const version = assertSiteVersionV3(getPublishedVersion(bundle.siteModel), "published public site version");
  const pageSlug = path?.join("/") ?? "";
  const page = findPageBySlugV3(version, pageSlug);
  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const indexable = isIndexableSite(bundle, claims);
  const requestHeaders = await headers();
  const canonical = page ? canonicalUrlForPage(bundle, page, requestHeaders) : undefined;
  const markdown = page && indexable ? markdownUrlForPage(bundle, page, requestHeaders) : undefined;
  return {
    title: page?.seo.title,
    description: page?.seo.description,
    robots: {
      index: indexable,
      follow: indexable
    },
    alternates: {
      canonical,
      types: markdown ? { "text/markdown": markdown } : undefined
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

  const version = assertSiteVersionV3(getPublishedVersion(bundle.siteModel), "published public site version");
  const pageSlug = path?.join("/") ?? "";
  const page = findPageBySlugV3(version, pageSlug);
  if (!page) notFound();
  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const claimedForPublicRuntime = isIndexableSite(bundle, claims);
  // Versions composed with scraped reference media are protected-preview only:
  // the public route never renders them. Owner attestation converts the media
  // and recompiles before anything publishes.
  const v3Version = version as typeof version & { mediaDecisions?: Array<{ rightsStatus: string }> };
  if (v3Version.mediaDecisions?.some((decision) => decision.rightsStatus === "owner_attestation_required")) {
    notFound();
  }
  // Custom-domain requests are internally rewritten to /sites/{slug}; rendered
  // navigation must stay on the customer's domain, never the platform path.
  const customDomain = isCustomDomainRequest(await headers());

  return (
    <>
      <SiteRenderer
        business={bundle.businessProfile}
        site={bundle.siteModel}
        extensions={bundle.extensionModel}
        locations={bundle.locations}
        locationBindings={bundle.locationBindings}
        page={page}
        theme={version.theme ?? bundle.siteModel.theme}
        experiments={bundle.experiments}
        tracking={claimedForPublicRuntime}
        formsEnabled={claimedForPublicRuntime}
        basePath={customDomain ? "" : `/sites/${bundle.siteModel.slug}`}
        proofMode={claimedForPublicRuntime ? "ui_kit" : "link_only"}
      />
    </>
  );
}
