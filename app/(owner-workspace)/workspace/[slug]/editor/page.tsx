import { notFound } from "next/navigation";
import { SiteAgentWorkspace } from "@/components/SiteAgentWorkspace";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { sitePlatformRepository } from "@/packages/platform-data";
import { SourceCoveragePanel } from "@/components/SourceCoveragePanel";

export default async function WorkspaceWebsitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/editor`);
  const input = context.site.currentPublicBuildInputId
    ? await sitePlatformRepository.getPublicBuildInput(context.site.currentPublicBuildInputId)
    : undefined;
  if (!input) notFound();
  const versions = await sitePlatformRepository.listSiteVersions(context.site.id);
  const candidate = versions.find((version) => version.status === "candidate");
  const coverage = candidate
    ? await sitePlatformRepository.getSiteVersionSourceCoverage(candidate.id)
    : undefined;
  return <><SiteAgentWorkspace initialSite={context.site} initialInput={input} initialVersions={versions} isAdmin={context.canAccessAdmin} />{coverage ? <SourceCoveragePanel report={coverage} /> : null}</>;
}
