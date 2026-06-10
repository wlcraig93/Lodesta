import { createHash } from "node:crypto";
import type { SiteArtifactRecord, SiteBundle, SiteVersion } from "./models";
import type { PageOpportunityV2 } from "./page-opportunities-v2";
import { runPageOpportunitiesAuditV2 } from "./page-opportunities-v2";

export type LocalLandingPagesAuditV2Result = {
  skillId: "seo.local-landing-pages";
  skillVersion: "direct-module-v1";
  versionId?: string;
  opportunities: PageOpportunityV2[];
  artifact: SiteArtifactRecord;
  summary: string;
};

export function runLocalLandingPagesAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): LocalLandingPagesAuditV2Result {
  const source = runPageOpportunitiesAuditV2(input);
  const opportunities = source.opportunities.filter((opportunity) => opportunity.kind === "service_page" || opportunity.kind === "location_page");
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: source.versionId,
    vertical: input.bundle.businessProfile.vertical,
    opportunities,
    policy: "Recommendations only; landing pages are generated later through V2 compiler, claim verification, render QA, and admin acceptance."
  };
  const contentHash = hashPayload(payload);
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_local_landing_pages_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "page_opportunity_report",
    artifactVersion: "local-landing-pages-report-v2",
    producerId: "seo.local-landing-pages",
    producerVersion: "direct-module-v1",
    verticalPlaybookVersion: input.version?.rendererVersion === "layout-v2" ? input.version.blueprint.verticalPlaybookVersion : undefined,
    sourceFactIds: Array.from(new Set(opportunities.flatMap((opportunity) => opportunity.evidenceFactIds))),
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  const candidates = opportunities.filter((opportunity) => opportunity.status === "candidate").length;

  return {
    skillId: "seo.local-landing-pages",
    skillVersion: "direct-module-v1",
    versionId: source.versionId,
    opportunities,
    artifact,
    summary: `${candidates} local landing page candidate${candidates === 1 ? "" : "s"} ready for review.`
  };
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
