import { BusinessDataControls } from "@/components/BusinessDataControls";
import { WorkspacePageHeader } from "@/components/OwnerWorkspaceUI";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { sitePlatformRepository } from "@/packages/platform-data";
import { notFound } from "next/navigation";

export default async function WorkspaceBusinessDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/business-details`);
  const [intent, buildInput] = await Promise.all([
    sitePlatformRepository.getSiteIntent(context.site.id),
    context.site.currentPublicBuildInputId ? sitePlatformRepository.getPublicBuildInput(context.site.currentPublicBuildInputId) : undefined
  ]);
  if (!intent) notFound();
  const snapshots = await Promise.all((buildInput?.sourceSnapshotIds ?? []).map((id) => sitePlatformRepository.getSourceSnapshot(id)));
  const sourceSnapshotId = snapshots.find((snapshot) => snapshot?.sourceType === "website")?.id;
  return <main className="workspace-page workspace-business-page"><WorkspacePageHeader eyebrow="Business" title="Business information" description="The verified facts, services, proof, and media Lodesta uses for every future website version." /><BusinessDataControls siteId={context.site.id} state={context.state} intent={intent} sourceSnapshotId={sourceSnapshotId} /></main>;
}
