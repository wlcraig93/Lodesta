import { factsByKind } from "./business-fact-graph";
import { propsForLayoutSection, syncVersionLegacySections } from "./layout-registry";
import type {
  BusinessFactGraph,
  BusinessFactKind,
  ConversionGoal,
  GenerationPlanV2Section,
  LayoutSection,
  SiteBundle,
  SiteVersion
} from "./models";

export type SectionMissingFactBehavior = GenerationPlanV2Section["copyPolicy"]["missingFactBehavior"];

export type SectionFactContract = {
  requiredFactKinds: BusinessFactKind[];
  requiredAnyFactKinds: BusinessFactKind[];
  optionalFactKinds: BusinessFactKind[];
  missingFactBehavior: SectionMissingFactBehavior;
};

export type UnsupportedCatalogSection = {
  pageId: string;
  sectionId: string;
  preset: string;
  missingFactKinds: BusinessFactKind[];
  missingFactBehavior: SectionMissingFactBehavior;
};

export function sectionFactContractForSection(section: LayoutSection, primaryGoal: ConversionGoal): SectionFactContract {
  switch (section.kind) {
    case "hero":
      return {
        requiredFactKinds: primaryGoal === "calls" ? ["name", "service", "phone"] : ["name", "service"],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["photo", "review_summary", "hours", "address", "service_area"],
        missingFactBehavior: "block_generation"
      };
    case "services":
    case "menu":
      return {
        requiredFactKinds: ["service"],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["photo", "review_summary", "ordering_link"],
        missingFactBehavior: "block_generation"
      };
    case "contact":
      return {
        requiredFactKinds: ["name"],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["phone", "email", "address", "hours", "booking_link", "ordering_link"],
        missingFactBehavior: "block_generation"
      };
    case "proof":
      return proofContractForSection(section);
    case "gallery":
      return {
        requiredFactKinds: [],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["photo", "logo"],
        missingFactBehavior: "render_without_claim"
      };
    case "before_after":
      return {
        requiredFactKinds: ["service"],
        requiredAnyFactKinds: ["photo", "review_summary", "proof_signal"],
        optionalFactKinds: [],
        missingFactBehavior: "omit_section"
      };
    case "faq":
      return {
        requiredFactKinds: ["name"],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["service", "service_area", "phone", "hours"],
        missingFactBehavior: "render_without_claim"
      };
    case "map":
      return {
        requiredFactKinds: [],
        requiredAnyFactKinds: ["address", "service_area"],
        optionalFactKinds: ["hours", "geo", "phone"],
        missingFactBehavior: "omit_section"
      };
    case "team":
      return {
        requiredFactKinds: ["team_member"],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["photo", "proof_signal"],
        missingFactBehavior: "omit_section"
      };
    case "press":
      return {
        requiredFactKinds: [],
        requiredAnyFactKinds: ["press_link", "social_link"],
        optionalFactKinds: ["photo"],
        missingFactBehavior: "omit_section"
      };
    case "cta":
      return {
        requiredFactKinds: ["name"],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["phone", "booking_link", "ordering_link", "service"],
        missingFactBehavior: "render_without_claim"
      };
    case "trust":
    case "footer":
      return {
        requiredFactKinds: ["name"],
        requiredAnyFactKinds: [],
        optionalFactKinds: ["phone", "address", "hours", "service"],
        missingFactBehavior: "render_without_claim"
      };
  }
}

export function missingRequiredFactKinds(graph: BusinessFactGraph, contract: SectionFactContract): BusinessFactKind[] {
  const missing = contract.requiredFactKinds.filter((kind) => factsByKind(graph, kind).length === 0);
  if (contract.requiredAnyFactKinds.length && !contract.requiredAnyFactKinds.some((kind) => factsByKind(graph, kind).length > 0)) {
    missing.push(...contract.requiredAnyFactKinds);
  }
  return Array.from(new Set(missing));
}

export function findUnsupportedCatalogSections(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  factGraph: BusinessFactGraph;
  primaryGoal: ConversionGoal;
}): UnsupportedCatalogSection[] {
  const issues: UnsupportedCatalogSection[] = [];
  for (const page of input.version.pages) {
    for (const section of page.layoutSections) {
      const contract = sectionFactContractForSection(section, input.primaryGoal);
      const missingFactKinds = missingRequiredFactKinds(input.factGraph, contract);
      if (!missingFactKinds.length) continue;
      issues.push({
        pageId: page.id,
        sectionId: section.id,
        preset: section.preset,
        missingFactKinds,
        missingFactBehavior: contract.missingFactBehavior
      });
    }
  }
  return issues;
}

export function pruneUnsupportedCatalogSections(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  factGraph: BusinessFactGraph;
  primaryGoal: ConversionGoal;
}) {
  const removedSections: UnsupportedCatalogSection[] = [];
  for (const page of input.version.pages) {
    const nextSections = page.layoutSections.filter((section) => {
      const contract = sectionFactContractForSection(section, input.primaryGoal);
      const missingFactKinds = missingRequiredFactKinds(input.factGraph, contract);
      if (!missingFactKinds.length || contract.missingFactBehavior !== "omit_section") return true;
      removedSections.push({
        pageId: page.id,
        sectionId: section.id,
        preset: section.preset,
        missingFactKinds,
        missingFactBehavior: contract.missingFactBehavior
      });
      return false;
    });
    if (nextSections.length) page.layoutSections = nextSections;
  }
  if (removedSections.length) syncVersionLegacySections(input.version);
  return { removedSections };
}

function proofContractForSection(section: LayoutSection): SectionFactContract {
  const props = propsForLayoutSection(section);
  const items = Array.isArray(props.items) ? props.items : [];
  const hasQuoteItems = items.some((item) => isRecord(item) && typeof item.quote === "string");
  if (hasQuoteItems || typeof props.body === "string") {
    return {
      requiredFactKinds: [],
      requiredAnyFactKinds: ["review_summary", "proof_signal", "press_link"],
      optionalFactKinds: ["photo", "social_link"],
      missingFactBehavior: "omit_section"
    };
  }
  return {
    requiredFactKinds: [],
    requiredAnyFactKinds: ["review_summary", "service_area", "phone"],
    optionalFactKinds: ["hours", "address"],
    missingFactBehavior: "omit_section"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
