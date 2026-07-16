import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerAssetsForm } from "@/components/OwnerAssetsForm";
import { OwnerFactsReview } from "@/components/OwnerFactsReview";
import { OwnerServicesPanel } from "@/components/OwnerServicesPanel";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { countConfirmedOwnerFacts } from "@/lib/owner-facts";

export const dynamic = "force-dynamic";

export default async function BusinessProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/business/${slug}`);

  const profile = bundle.businessProfile;
  const factCount = countConfirmedOwnerFacts(profile);

  return (
    <main className="admin-page owner-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-page-eyebrow">Your business</p>
          <h1>{profile.name}</h1>
          <p className="owner-page-lede">
            We pulled these facts together while building your site. Confirm what&apos;s right and fix what isn&apos;t — confirmed
            facts power your site&apos;s contact info, hours, and local search presence.
            {factCount.total > 0 ? ` ${factCount.confirmed} of ${factCount.total} confirmed so far.` : ""}
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Edit site
          </Link>
          <Link className="button primary" href={`/business/${slug}/site-review`}>
            Review your site
          </Link>
        </div>
      </header>

      <OwnerFactsReview
        profile={{
          siteId: profile.siteId,
          phone: profile.phone,
          email: profile.email,
          address: profile.address,
          hours: profile.hours,
          serviceAreas: profile.serviceAreas,
          credentials: profile.credentials ?? [],
          offers: profile.offers ?? [],
          bookingLinks: profile.bookingLinks,
          orderingLinks: profile.orderingLinks,
          socialLinks: profile.socialLinks,
          pressLinks: profile.pressLinks,
          provenance: profile.provenance
        }}
      />

      <div className="owner-page-panels">
        <section className="panel">
          <OwnerServicesPanel siteId={profile.siteId} />
        </section>
        <section className="panel">
          <h2>Your photos and logo</h2>
          <OwnerAssetsForm profile={profile} />
        </section>
      </div>
    </main>
  );
}
