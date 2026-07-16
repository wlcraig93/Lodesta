import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { SiteRenderer } from "@/lib/site-renderer";
import { applyMediaRightsFallbackV3 } from "@/lib/media-rights-preview";
import { assertSiteVersionV3, findPageBySlugV3, siteVersionV3Issue } from "@/lib/site-version-v3";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Candidate Preview | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

export default async function SiteCandidatePreviewPage({
  params,
  searchParams
}: {
  params: Promise<{ candidateId: string; path?: string[] }>;
  searchParams: Promise<{ rights?: string }>;
}) {
  const { candidateId, path } = await params;
  const { rights } = await searchParams;
  await requireAdminPageAccess(`/site-candidate-previews/${candidateId}`);
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) notFound();

  const bundle = candidate.bundle;
  const previewVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  const schemaIssue = siteVersionV3Issue(previewVersion);
  if (schemaIssue) {
    return (
      <main className="candidate-preview-stale-notice">
        <h1>Stale candidate schema</h1>
        <p className="form-status error-text">
          This candidate was generated under an older stored-version schema and cannot be previewed: {schemaIssue}.
        </p>
        <p>Regenerate the candidate through the canonical pipeline.</p>
      </main>
    );
  }
  let selectedVersion = assertSiteVersionV3(previewVersion, "candidate preview version");

  // ?rights=declined simulates the owner not attesting media rights: scraped
  // photos swap to the backup gallery and reference branding is hidden.
  const rightsDeclined = rights === "declined";
  if (rightsDeclined && selectedVersion.rendererVersion === "layout-v3") {
    selectedVersion = applyMediaRightsFallbackV3(selectedVersion, []);
  }

  const pageSlug = path?.join("/") ?? "";
  const page = findPageBySlugV3(selectedVersion, pageSlug);
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
      referenceBrandingEnabled={!rightsDeclined}
    />
  );
}
