import { notFound } from "next/navigation";
import { requirePlatformSiteOwnerAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";
import { SiteAgentWorkspace } from "@/components/SiteAgentWorkspace";

export const dynamic = "force-dynamic";

export default async function SiteAgentEditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  await requirePlatformSiteOwnerAccess(site.id, `/editor/${slug}`);
  const input = site.currentPublicBuildInputId
    ? await sitePlatformRepository.getPublicBuildInput(site.currentPublicBuildInputId)
    : undefined;
  if (!input) notFound();
  const versions = await sitePlatformRepository.listSiteVersions(site.id);
  return <SiteAgentWorkspace initialSite={site} initialInput={input} initialVersions={versions} />;
}
