import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { SiteRenderer } from "@/lib/site-renderer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Candidate Preview | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

export default async function SiteCandidatePreviewPage({
  params
}: {
  params: Promise<{ candidateId: string; path?: string[] }>;
}) {
  const { candidateId, path } = await params;
  await requireAdminPageAccess(`/site-candidate-previews/${candidateId}`);
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) notFound();

  const bundle = candidate.bundle;
  const selectedVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  if (!selectedVersion) notFound();
  const pageSlug = path?.join("/") ?? "";
  const page = selectedVersion.pages.find((candidatePage) => candidatePage.slug === pageSlug);
  if (!page) notFound();

  return (
    <SiteRenderer
      business={bundle.businessProfile}
      site={bundle.siteModel}
      extensions={bundle.extensionModel}
      locations={bundle.locations}
      locationBindings={bundle.locationBindings}
      version={selectedVersion}
      page={page}
      experiments={bundle.experiments}
      tracking={false}
      formsEnabled={false}
      basePath={`/site-candidate-previews/${candidateId}`}
    />
  );
}
