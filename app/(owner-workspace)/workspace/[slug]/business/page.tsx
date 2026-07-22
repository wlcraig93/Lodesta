import { BusinessDataControls } from "@/components/BusinessDataControls";
import { WorkspacePageHeader } from "@/components/OwnerWorkspaceUI";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { sitePlatformRepository } from "@/packages/platform-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function WorkspaceBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/business`);
  const intent = await sitePlatformRepository.getSiteIntent(context.site.id);
  if (!intent) notFound();
  return <main className="workspace-page workspace-business-page"><WorkspacePageHeader eyebrow="Business" title="Business information" description="The verified facts, services, proof, and media Lodesta uses for every future website version." /><BusinessDataControls siteId={context.site.id} state={context.state} intent={intent} /></main>;
}
