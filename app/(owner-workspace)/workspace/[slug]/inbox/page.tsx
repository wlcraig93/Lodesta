import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerInbox } from "@/components/OwnerInbox";
import { WorkspacePageHeader } from "@/components/OwnerWorkspaceUI";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { siteCapabilityRepository } from "@/packages/site-capabilities";

export const dynamic = "force-dynamic";

export default async function WorkspaceInboxPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ inquiry?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}/inbox`);
  if (query.inquiry && !(await siteCapabilityRepository.getInquiry(context.site.id, query.inquiry))) notFound();
  const inquiries = await siteCapabilityRepository.listInquiries(context.site.id);
  const prioritized = [...inquiries].sort((left, right) => inquiryPriority(left.status) - inquiryPriority(right.status) || right.updatedAt.localeCompare(left.updatedAt));
  const eventPairs = await Promise.all(prioritized.map(async (inquiry) => [inquiry.id, await siteCapabilityRepository.listInquiryEvents(inquiry.id)] as const));
  return (
    <main className="workspace-page workspace-inbox-page">
      <WorkspacePageHeader eyebrow="Inbox" title="Customer inquiries" description="See who reached out, understand what they need, and keep each opportunity moving." actions={<a className="button secondary" href={`/api/inquiries/export?siteId=${context.site.id}`}>Export CSV</a>} />
      <OwnerInbox siteId={context.site.id} slug={slug} initialInquiries={prioritized} eventsByInquiry={Object.fromEntries(eventPairs)} requestedInquiryId={query.inquiry} />
      {!inquiries.length ? <p className="workspace-inbox-footnote">Need to verify the form? <Link href={`/workspace/${slug}/website`}>Open the website preview.</Link></p> : null}
    </main>
  );
}

function inquiryPriority(status: string) { if (status === "new" || status === "needs_reply") return 0; if (status === "replied" || status === "booked") return 1; if (status === "won") return 2; return 3; }
