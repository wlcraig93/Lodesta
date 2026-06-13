import type { SiteBundle, SiteVersion } from "./models";

/**
 * Information utilization Phase A (next-level plan, Part 4).
 *
 * Taxonomy + source policy + coverage report over the CURRENT crawl output —
 * proving what is missed before paying for deeper crawling. Every fact
 * records its source class and renderability; `inferred` facts are
 * non-renderable by default (they feed recommendations and design-brief
 * hints, never public rendering, absent a named policy exception).
 *
 * Coverage uses the ELIGIBLE denominator: restraint is never punished.
 * States: surfaced | eligible_unsurfaced | intentionally_suppressed |
 * blocked_by_policy | needs_owner_confirmation.
 */

export type FactCategory =
  | "services"
  | "hours"
  | "phone"
  | "address"
  | "story"
  | "social_links"
  | "service_areas"
  | "financing"
  | "languages"
  | "certifications"
  | "years_in_business"
  | "brands_carried"
  | "email";

export type FactSourceClass = "owner" | "website_crawl" | "places" | "inferred";

export type FactState =
  | "surfaced"
  | "eligible_unsurfaced"
  | "intentionally_suppressed"
  | "blocked_by_policy"
  | "needs_owner_confirmation";

export type CoverageFact = {
  category: FactCategory;
  /** Compact value summary for the operator report — never the full payload. */
  summary: string;
  sourceClass: FactSourceClass;
  renderable: boolean;
  state: FactState;
  /** Why the fact is in its state (policy name, suppression reason, surface id). */
  note: string;
};

export type FactCoverageReport = {
  version: "fact-coverage-v1";
  facts: CoverageFact[];
  surfacedCount: number;
  eligibleCount: number;
  /** surfaced / eligible, 0-1; undefined when nothing is eligible. */
  coverageRatio?: number;
  evaluatedAt: string;
};

/**
 * Designated surfaces per category — a fact category with no surface mapping
 * is a plan gap, not a silent drop. Mappings list where the category renders
 * when its surfacing requirements are met.
 */
export const factSurfaceMap: Record<FactCategory, { surfaces: string[]; requirement?: string }> = {
  services: { surfaces: ["services_section", "service_pages", "footer"] },
  hours: { surfaces: ["location_showcase", "location_directory", "footer", "hero_facts"] },
  phone: { surfaces: ["header_cta", "hero_cta", "contact", "footer"] },
  address: { surfaces: ["location_showcase", "location_directory", "footer", "schema_org"] },
  story: { surfaces: ["about_section"] },
  social_links: { surfaces: ["footer"] },
  service_areas: { surfaces: ["service_area_showcase", "location_showcase", "location_directory"] },
  financing: { surfaces: ["offer_band", "hero_facts"], requirement: "clear source text for the terms" },
  languages: { surfaces: ["owner_recommendation"], requirement: "actual bilingual copy exists (inferred market is a recommendation only)" },
  certifications: { surfaces: ["trust_facts"], requirement: "source proof" },
  years_in_business: { surfaces: ["trust_facts"], requirement: "stated by source, never derived" },
  brands_carried: { surfaces: ["credibility_strip"], requirement: "stated by source" },
  email: { surfaces: ["contact", "footer"] }
};

function pageText(version: SiteVersion): string {
  return JSON.stringify((version as { pageComposition?: unknown }).pageComposition ?? {}).toLowerCase();
}

export function buildFactCoverageReport(input: { bundle: SiteBundle; version: SiteVersion }): FactCoverageReport {
  const business = input.bundle.businessProfile;
  const composed = pageText(input.version);
  const facts: CoverageFact[] = [];

  const surfacedCheck = (needle: string | undefined) => Boolean(needle && composed.includes(needle.toLowerCase().slice(0, 40)));

  const add = (
    category: FactCategory,
    summary: string,
    sourceClass: FactSourceClass,
    options: { surfaced?: boolean; suppressed?: string; policyBlocked?: string; needsOwner?: string }
  ) => {
    // Source policy: inferred facts are non-renderable by default.
    const renderable = sourceClass !== "inferred" && !options.policyBlocked;
    let state: FactState;
    let note: string;
    if (options.policyBlocked) {
      state = "blocked_by_policy";
      note = options.policyBlocked;
    } else if (sourceClass === "inferred") {
      state = "blocked_by_policy";
      note = "Inferred facts are non-renderable by default; available as owner recommendation only.";
    } else if (options.needsOwner) {
      state = "needs_owner_confirmation";
      note = options.needsOwner;
    } else if (options.suppressed) {
      state = "intentionally_suppressed";
      note = options.suppressed;
    } else if (options.surfaced) {
      state = "surfaced";
      note = `Rendered on: ${factSurfaceMap[category].surfaces.join(", ")}.`;
    } else {
      state = "eligible_unsurfaced";
      note = `Eligible but absent from designated surfaces (${factSurfaceMap[category].surfaces.join(", ")}).`;
    }
    facts.push({ category, summary, sourceClass, renderable, state, note });
  };

  // Core identity facts (website crawl / structured intake).
  if (business.services.length) {
    add("services", `${business.services.length} services`, "website_crawl", {
      surfaced: business.services.some((service) => surfacedCheck(service))
    });
  }
  if (business.hours && Object.keys(business.hours).length) {
    add("hours", `${Object.keys(business.hours).length}-day schedule`, "website_crawl", {
      surfaced: composed.includes("hours") || Object.values(business.hours).some((value) => surfacedCheck(value))
    });
  }
  if (business.phone) add("phone", business.phone, "website_crawl", { surfaced: surfacedCheck(business.phone.replace(/[^\d]/g, "").slice(-7)) || surfacedCheck(business.phone) });
  const firstLocationAddress = input.bundle.locations?.find((location) => location.address)?.address;
  const address = business.address ?? firstLocationAddress;
  const addressLine = [address?.street, address?.city].filter(Boolean).join(", ");
  if (addressLine) add("address", addressLine.slice(0, 40), "website_crawl", { surfaced: surfacedCheck(address?.street ?? address?.city) });
  if (business.email) add("email", business.email, "website_crawl", { surfaced: surfacedCheck(business.email) });

  const story = input.bundle.presenceAssessment.businessUnderstanding?.businessStory;
  if (story) {
    add("story", story.summary.slice(0, 60), "website_crawl", {
      surfaced: composed.includes("about") && story.distinctives.some((distinctive) => surfacedCheck(distinctive.split(" ").slice(0, 3).join(" ")))
    });
  }

  if (business.socialLinks?.length) {
    add("social_links", `${business.socialLinks.length} links`, "website_crawl", {
      surfaced: business.socialLinks.some((link) => surfacedCheck(link))
    });
  }

  const serviceAreas = [
    ...((business as { serviceAreas?: string[] }).serviceAreas ?? []),
    ...(input.bundle.locations?.flatMap((location) => location.serviceAreas) ?? [])
  ].filter((area, index, areas) => area && areas.findIndex((candidate) => candidate.toLowerCase() === area.toLowerCase()) === index);
  if (serviceAreas?.length) {
    add("service_areas", `${serviceAreas.length} areas`, "website_crawl", {
      surfaced: serviceAreas.some((area) => surfacedCheck(area))
    });
  }

  // Categories whose surfacing requirements are not yet met by extraction
  // depth: recorded as needs_owner_confirmation when signals exist, so the
  // report shows the GAP without inventing renderable facts.
  const crawlText = JSON.stringify(input.bundle.presenceAssessment.businessUnderstanding ?? {}).toLowerCase();
  if (/financ/i.test(crawlText)) {
    add("financing", "financing signal detected", "website_crawl", {
      needsOwner: "Financing surfaces only with clear source text for the terms; extraction has a signal but not terms."
    });
  }

  const surfaced = facts.filter((fact) => fact.state === "surfaced").length;
  const eligible = facts.filter((fact) => fact.state === "surfaced" || fact.state === "eligible_unsurfaced").length;

  return {
    version: "fact-coverage-v1",
    facts,
    surfacedCount: surfaced,
    eligibleCount: eligible,
    ...(eligible ? { coverageRatio: surfaced / eligible } : {}),
    evaluatedAt: new Date().toISOString()
  };
}
