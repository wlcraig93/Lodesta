import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimSiteForm, type ClaimAssetRight, type ClaimFact } from "@/components/ClaimSiteForm";
import { repository } from "@/lib/repository";
import type { BusinessProfile } from "@/lib/models";
import { requiredAssetRightsForBundle } from "@/lib/asset-rights";
import { requiredPublicEligibilityFactIds } from "@/lib/control-plane";
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
  const { previewToken: previewTokenParam } = await searchParams;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();

  const controlPlane = await repository.getCanonicalControlPlane(bundle.businessProfile.siteId);
  if (!controlPlane) throw new Error("Claim page requires canonical business state.");
  const facts = claimFacts(bundle.businessProfile, requiredPublicEligibilityFactIds(controlPlane.state));
  const previewTokens = await repository.listPreviewTokens(bundle.businessProfile.siteId);
  const linkedPreviewToken = previewTokens.find((token) => token.token === previewTokenParam);
  const linkedPreviewTokenValue = linkedPreviewToken?.token;
  const previewToken = linkedPreviewToken ?? previewTokens[0];
  const outboundProspect = linkedPreviewTokenValue ? await repository.findOutboundProspectByPreviewToken(linkedPreviewTokenValue) : null;
  if (outboundProspect && linkedPreviewTokenValue) {
    await repository.recordOutboundEvent({
      campaignId: outboundProspect.campaignId,
      prospectId: outboundProspect.id,
      siteId: outboundProspect.siteId ?? bundle.businessProfile.siteId,
      type: "claim_started",
      metadata: { source: "claim_page", previewToken: linkedPreviewTokenValue }
    });
  }
  const assetRights = claimAssetRights(requiredAssetRightsForBundle(bundle), previewToken?.token);
  const verificationTargets = claimVerificationTargets(bundle.businessProfile).map((target) => ({
    channel: target.channel,
    label: target.label
  }));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Claim</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>
            Confirm the owner-held facts before this preview becomes a managed site. These fields power schema, forms,
            domains, and future presence sync, so the system treats them as verified only after claim.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/auth/login?next=/account`}>
            Owner login
          </Link>
          {previewToken ? (
            <Link className="button secondary" href={`/preview/${previewToken.token}`}>
              Preview
            </Link>
          ) : null}
          <Link className="button secondary" href={`/sites/${bundle.siteModel.slug}`}>
            Public site
          </Link>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>Verify facts</h2>
          <ClaimSiteForm
            siteId={bundle.businessProfile.siteId}
            facts={facts}
            assetRights={assetRights}
            verificationTargets={verificationTargets}
            outboundContext={
              outboundProspect
                ? {
                    campaignId: outboundProspect.campaignId,
                    prospectId: outboundProspect.id,
                    previewToken: linkedPreviewTokenValue
                  }
                : undefined
            }
          />
        </section>

        <aside className="panel">
          <h2>Management contract</h2>
          <p>
            Customers can edit content, photos, CTAs, and business facts. Layout, responsive behavior, and conversion
            scaffolding stay system-owned so the site can be audited and improved.
          </p>
          <h2>Guardrails</h2>
          <p>
            Unchecked facts remain unverified. The agent may suggest changes around them, but it should not publish or
            sync those facts as canonical until they are confirmed.
          </p>
        </aside>
      </div>
    </main>
  );
}

function claimAssetRights(assets: ClaimAssetRight[], previewToken: string | undefined): ClaimAssetRight[] {
  return assets.map((asset) => ({
    ...asset,
    url: previewToken ? previewAssetUrl(asset.url, previewToken) : asset.url
  }));
}

function previewAssetUrl(value: string, previewToken: string) {
  const [pathAndQuery, hash = ""] = value.split("#", 2);
  const [path, query = ""] = pathAndQuery.split("?", 2);
  if (!/^\/api\/assets\/[^/?#]+\/scraped-[^/?#]+$/i.test(path)) return value;
  const params = new URLSearchParams(query);
  params.set("previewToken", previewToken);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

function claimFacts(profile: BusinessProfile, requiredFactIds: string[]): ClaimFact[] {
  const requiredFacts = new Set(requiredFactIds);
  const facts: ClaimFact[] = [claimFact(profile, "name", "Business name", profile.name, requiredFacts)];
  if (profile.phone) facts.push(claimFact(profile, "phone", "Phone", profile.phone, requiredFacts));
  if (profile.email) facts.push(claimFact(profile, "email", "Email", profile.email, requiredFacts));
  const address = [profile.address?.street, profile.address?.city, profile.address?.region, profile.address?.postalCode]
    .filter(Boolean)
    .join(", ");
  if (address) facts.push(claimFact(profile, "address", "Address", address, requiredFacts));
  if (profile.services.length) {
    facts.push(claimFact(profile, "services", "Services", profile.services.join(", "), requiredFacts));
  }
  if (profile.serviceAreas.length) {
    facts.push(claimFact(profile, "service_areas", "Service areas", profile.serviceAreas.join(", "), requiredFacts));
  }
  if (profile.hours && Object.keys(profile.hours).length) {
    facts.push(
      claimFact(
        profile,
        "hours",
        "Hours",
        Object.entries(profile.hours).map(([day, value]) => `${day}: ${value}`).join("; "),
        requiredFacts
      )
    );
  }
  return facts;
}

function claimFact(profile: BusinessProfile, id: string, label: string, value: string, requiredFacts: Set<string>): ClaimFact {
  const provenanceKey = id === "service_areas" ? "serviceAreas" : id;
  return {
    id,
    label,
    value,
    required: requiredFacts.has(id),
    verified: profile.provenance[provenanceKey]?.verified ?? false
  };
}
