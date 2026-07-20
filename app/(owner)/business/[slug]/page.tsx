import Link from "next/link";
import { notFound } from "next/navigation";
import { BusinessDataControls } from "@/components/BusinessDataControls";
import { requirePlatformSiteOwnerAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function BusinessProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  await requirePlatformSiteOwnerAccess(site.id, `/business/${slug}`);
  const [state, intent] = await Promise.all([
    sitePlatformRepository.getBusinessState(site.businessId),
    sitePlatformRepository.getSiteIntent(site.id)
  ]);
  if (!state || !intent) notFound();
  return <main className="admin-page owner-page"><header className="owner-page-header"><div><p className="owner-page-eyebrow">Business authority</p><h1>{state.identity.name}</h1><p className="owner-page-lede">Verified business facts and intent are the source of truth for every future site version.</p></div><div className="button-row"><Link className="button secondary" href={`/dashboard/${slug}`}>Dashboard</Link><Link className="button primary" href={`/editor/${slug}`}>Website workspace</Link></div></header><BusinessDataControls siteId={site.id} state={state} intent={intent} /></main>;
}
