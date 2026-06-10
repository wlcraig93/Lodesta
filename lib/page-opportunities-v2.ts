import { createHash } from "node:crypto";
import type { BusinessFactKind, SiteArtifactRecord, SiteBundle, SiteVersion } from "./models";

export type PageOpportunityKindV2 = "service_page" | "location_page" | "faq_page";

export type PageOpportunityV2 = {
  id: string;
  kind: PageOpportunityKindV2;
  slug: string;
  title: string;
  rationale: string;
  evidenceFactIds: string[];
  risk: "low" | "medium" | "high";
  status: "candidate" | "defer";
};

export type PageOpportunityAuditV2Result = {
  skillId: "strategy.page-opportunities";
  skillVersion: "direct-module-v1";
  versionId?: string;
  opportunities: PageOpportunityV2[];
  artifact: SiteArtifactRecord;
  summary: string;
};

export function runPageOpportunitiesAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): PageOpportunityAuditV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const sourceFacts = input.bundle.presenceAssessment.businessFactGraph?.sourceFactsV2 ?? [];
  const opportunities = [
    ...servicePageOpportunities(input.bundle, sourceFacts),
    ...locationPageOpportunities(input.bundle, sourceFacts),
    ...faqPageOpportunities(input.bundle, sourceFacts)
  ];
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const contentHash = hashOpportunityPayload({ siteId, versionId: version?.id, opportunities });
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_page_opportunities_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "page_opportunity_report",
    artifactVersion: "page-opportunity-report-v2",
    producerId: "strategy.page-opportunities",
    producerVersion: "direct-module-v1",
    verticalPlaybookVersion: version?.rendererVersion === "layout-v2" ? version.blueprint.verticalPlaybookVersion : undefined,
    sourceFactIds: Array.from(new Set(opportunities.flatMap((opportunity) => opportunity.evidenceFactIds))),
    contentHash,
    payload: {
      versionId: version?.id,
      vertical: input.bundle.businessProfile.vertical,
      opportunities
    },
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  const candidates = opportunities.filter((opportunity) => opportunity.status === "candidate").length;
  const deferred = opportunities.length - candidates;
  return {
    skillId: "strategy.page-opportunities",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    opportunities,
    artifact,
    summary: `${candidates} page opportunit${candidates === 1 ? "y" : "ies"} ready for review${deferred ? `; ${deferred} deferred` : ""}.`
  };
}

function servicePageOpportunities(bundle: SiteBundle, sourceFacts: NonNullable<SiteBundle["presenceAssessment"]["businessFactGraph"]>["sourceFactsV2"] = []) {
  const serviceFacts = factsByKind(sourceFacts, "service");
  const services = bundle.businessProfile.services.slice(0, 4);
  return services.map((service, index): PageOpportunityV2 => {
    const fact = serviceFacts.find((candidate) => String(candidate.value).toLowerCase() === service.toLowerCase()) ?? serviceFacts[index];
    const hasEvidence = Boolean(fact);
    return {
      id: `page_opp_service_${slugify(service)}`,
      kind: "service_page",
      slug: `/services/${slugify(service)}`,
      title: `${service} page`,
      rationale: hasEvidence
        ? `A service page can expand ${service} with source-backed scope, contact path, and local proof.`
        : `Defer ${service} until a durable source fact supports enough detail for a standalone page.`,
      evidenceFactIds: fact ? [fact.id] : [],
      risk: hasEvidence ? "medium" : "high",
      status: hasEvidence ? "candidate" : "defer"
    };
  });
}

function locationPageOpportunities(bundle: SiteBundle, sourceFacts: NonNullable<SiteBundle["presenceAssessment"]["businessFactGraph"]>["sourceFactsV2"] = []) {
  const areaFacts = factsByKind(sourceFacts, "service_area");
  const areas = bundle.businessProfile.serviceAreas.slice(0, 4);
  if (areas.length < 2) return [];
  return areas.map((area, index): PageOpportunityV2 => {
    const fact = areaFacts.find((candidate) => String(candidate.value).toLowerCase() === area.toLowerCase()) ?? areaFacts[index];
    return {
      id: `page_opp_location_${slugify(area)}`,
      kind: "location_page",
      slug: `/areas/${slugify(area)}`,
      title: `${area} service area page`,
      rationale: "Location pages should be created only when they can include useful, differentiated service and contact context.",
      evidenceFactIds: fact ? [fact.id] : [],
      risk: fact ? "medium" : "high",
      status: fact ? "candidate" : "defer"
    };
  });
}

function faqPageOpportunities(bundle: SiteBundle, sourceFacts: NonNullable<SiteBundle["presenceAssessment"]["businessFactGraph"]>["sourceFactsV2"] = []): PageOpportunityV2[] {
  const serviceFacts = factsByKind(sourceFacts, "service");
  if (bundle.businessProfile.services.length < 2) return [];
  return [
    {
      id: "page_opp_faq",
      kind: "faq_page",
      slug: "/faq",
      title: "FAQ page",
      rationale: "A short FAQ page can answer service-fit, timing, prep, and contact questions without inventing pricing or credentials.",
      evidenceFactIds: serviceFacts.slice(0, 4).map((fact) => fact.id),
      risk: serviceFacts.length >= 2 ? "low" : "medium",
      status: serviceFacts.length >= 2 ? "candidate" : "defer"
    }
  ];
}

function factsByKind(
  facts: NonNullable<SiteBundle["presenceAssessment"]["businessFactGraph"]>["sourceFactsV2"] = [],
  kind: BusinessFactKind
) {
  return facts.filter((fact) => fact.kind === kind && fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render");
}

function hashOpportunityPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
