import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { repository } from "@/lib/repository";
import { SiteRenderer } from "@/lib/site-renderer";
import { assertSiteVersionV3, findPageBySlugV3, siteVersionV3Issue } from "@/lib/site-version-v3";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Development Candidate Preview | Lodesta",
  robots: { index: false, follow: false }
};

export default async function DevelopmentSiteCandidatePreviewPage({
  params
}: {
  params: Promise<{ candidateId: string; path?: string[] }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { candidateId, path } = await params;
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate || candidate.candidatePurpose !== "test_generation") notFound();

  const bundle = candidate.bundle;
  const rawVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  if (siteVersionV3Issue(rawVersion)) notFound();

  const version = assertSiteVersionV3(rawVersion, "development candidate preview version");
  const page = findPageBySlugV3(version, path?.join("/") ?? "");
  if (!page) notFound();

  return (
    <SiteRenderer
      business={bundle.businessProfile}
      site={bundle.siteModel}
      extensions={bundle.extensionModel}
      locations={bundle.locations}
      locationBindings={bundle.locationBindings}
      version={version}
      page={page}
      experiments={bundle.experiments}
      tracking={false}
      formsEnabled={false}
      basePath={`/dev/site-candidate-previews/${candidateId}`}
      referenceBrandingEnabled
    />
  );
}
