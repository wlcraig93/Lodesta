import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { SiteRenderer } from "@/lib/site-renderer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Generation Preview | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

export default async function SiteGenerationPreviewPage({
  params
}: {
  params: Promise<{ generationId: string }>;
}) {
  const { generationId } = await params;
  await requireAdminPageAccess(`/site-generation-previews/${generationId}`);
  const generation = await repository.getSiteGeneration(generationId);
  if (!generation) notFound();

  const bundle = generation.bundle;
  const selectedVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  if (!selectedVersion) notFound();

  return (
    <SiteRenderer
      business={bundle.businessProfile}
      site={bundle.siteModel}
      extensions={bundle.extensionModel}
      version={selectedVersion}
      experiments={bundle.experiments}
      tracking={false}
      formsEnabled={false}
    />
  );
}
