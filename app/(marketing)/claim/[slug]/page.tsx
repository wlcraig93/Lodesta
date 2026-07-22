import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimSiteForm, type ClaimAssetRight, type ClaimFact } from "@/components/ClaimSiteForm";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type { BusinessStateV3 } from "@/packages/site-contracts";
import { claimVerificationTargets } from "@/lib/claim-verification-challenge";

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ previewToken?: string }>;
}) {
  const { slug } = await params;
  const { previewToken: requestedToken } = await searchParams;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  const state = await sitePlatformRepository.getBusinessState(site.businessId);
  if (!state) throw new Error("Claim page requires canonical business state.");

  const tokens = await platformOperationsRepository.listPreviewTokens(site.id);
  const previewToken = tokens.find((item) => item.token === requestedToken) ?? tokens[0];
  const outboundProspect = requestedToken
    ? await platformOperationsRepository.findOutboundProspectByPreviewToken(requestedToken)
    : null;
  if (outboundProspect && requestedToken) {
    await platformOperationsRepository.recordOutboundEvent({
      campaignId: outboundProspect.campaignId,
      prospectId: outboundProspect.id,
      siteId: outboundProspect.siteId ?? site.id,
      type: "claim_started",
      metadata: { source: "claim_page", previewToken: requestedToken }
    });
  }

  const versions = await sitePlatformRepository.listSiteVersions(site.id);
  const published = versions.find((version) => version.status === "published");
  const verificationTargets = claimVerificationTargets(state).map((target) => ({ channel: target.channel, label: target.label }));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Claim</span>
          <h1>{state.identity.name}</h1>
          <p>Verify the business facts and media rights that Lodesta may use on this managed website.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/auth/login?next=/account">Owner login</Link>
          {previewToken ? <Link className="button secondary" href={`/preview/${previewToken.token}`}>Preview</Link> : null}
          {published ? <Link className="button secondary" href={`/sites/${site.slug}`}>Public site</Link> : null}
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>Verify facts</h2>
          <ClaimSiteForm
            siteId={site.id}
            facts={claimFacts(state)}
            assetRights={claimAssetRights(state)}
            verificationTargets={verificationTargets}
            outboundContext={outboundProspect ? { campaignId: outboundProspect.campaignId, prospectId: outboundProspect.id, previewToken: requestedToken } : undefined}
          />
        </section>
        <aside className="panel">
          <h2>Managed website</h2>
          <p>Business facts stay owner-controlled. Site design, SEO, accessibility, and technical checks are managed through the website workspace.</p>
          <h2>Publishing guardrails</h2>
          <p>Unconfirmed facts and unlicensed media stay out of public releases. Every published version remains immutable and auditable.</p>
        </aside>
      </div>
    </main>
  );
}

function claimFacts(state: BusinessStateV3): ClaimFact[] {
  return state.facts.map((fact) => ({
    id: fact.id,
    label: fact.label,
    value: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
    required: fact.publicEligible,
    verified: fact.source.ownerConfirmed
  }));
}

function claimAssetRights(state: BusinessStateV3): ClaimAssetRight[] {
  return state.assets
    .filter((asset) => asset.activeForFutureBuilds && asset.rightsStatus === "reference_only" && asset.publicUrl)
    .map((asset) => ({
      id: asset.revisionId,
      kind: asset.kind === "logo" ? "logo" : "photo",
      url: asset.publicUrl!,
      alt: asset.alt
    }));
}
