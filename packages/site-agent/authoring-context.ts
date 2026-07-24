import type {
  SitePublicBuildInput,
  SourceSnapshot
} from "@/packages/site-contracts";
import { SiteAuthoringTerminalError } from "./failures";

export const maximumAuthoringContextCharacters = 160_000;

type AuthoringEvidenceBlock = {
  id: string;
  sourceUrl: string;
  displayText: string;
  evidenceClass: "first_party" | "third_party" | "unknown";
  purposeTags: string[];
};

export type AuthoringContextPacket = {
  kind: "authoring-context-packet";
  authorities: {
    publicBuildInputId: string;
    businessStateRevision: number;
    siteIntentRevision: number;
    sourceSnapshotIds: string[];
  };
  siteContext: {
    businessName: string;
    identityStatus: "verified" | "provisional";
    description?: string;
    contacts: SitePublicBuildInput["business"]["contacts"];
    primaryLocation?: {
      id: string;
      label: string;
      street?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country: string;
    };
    verifiedHours?: Record<string, string>;
    availabilitySummary?: string;
    serviceAreas: string[];
    pageRequirements: Array<{
      purpose: string;
      path: string;
      title: string;
      offeringId?: string;
    }>;
    metadataExpectations: string[];
  };
  serviceBriefs: Array<{
    offeringId: string;
    catalogId?: string;
    name: string;
    pageMode: "dedicated" | "shared";
    featured: boolean;
    sourceFactIds: string[];
    sourceWording: string[];
    evidence: AuthoringEvidenceBlock[];
  }>;
  supplementalContext: {
    crawlCoverage?: string;
    blocks: AuthoringEvidenceBlock[];
    research?: {
      report?: string;
      sources: string[];
      coverage?: string;
      provenance?: Record<string, unknown>;
    };
  };
  evidenceGaps: {
    missing: Array<"verified_proof" | "service_areas" | "source_media" | "business_description" | "service_detail">;
    cautions: string[];
  };
  truncated: boolean;
};

export function createAuthoringContextPacket(input: {
  buildInput: SitePublicBuildInput;
  snapshots: SourceSnapshot[];
}): AuthoringContextPacket {
  const website = input.snapshots.find((snapshot) => snapshot.sourceType === "website");
  const research = input.snapshots.find((snapshot) => snapshot.sourceType === "web_research");
  const ingestion = objectValue(website?.payload.ingestion);
  const rawBlocks = Array.isArray(ingestion?.modelBlocks) ? ingestion.modelBlocks : [];
  const purposeTagsByUrl = ingestionPurposeTagsByUrl(ingestion);
  const blocks = rawBlocks.flatMap((value): AuthoringEvidenceBlock[] => {
    const block = objectValue(value);
    if (
      !block
      || typeof block.id !== "string"
      || typeof block.sourceUrl !== "string"
      || typeof block.displayText !== "string"
      || !["first_party", "third_party", "unknown"].includes(String(block.evidenceClass))
    ) return [];
    return [{
      id: block.id,
      sourceUrl: block.sourceUrl,
      displayText: block.displayText,
      evidenceClass: block.evidenceClass as AuthoringEvidenceBlock["evidenceClass"],
      purposeTags: purposeTagsByUrl.get(block.sourceUrl) ?? []
    }];
  });
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const publicFactById = new Map(input.buildInput.publicFacts.map((fact) => [fact.id, fact]));
  const serviceBriefs: AuthoringContextPacket["serviceBriefs"] = input.buildInput.business.offerings
    .filter((offering) => offering.pageMode !== "none")
    .map((offering) => {
      const facts = offering.sourceFactIds
        .map((factId) => publicFactById.get(factId))
        .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
      const sourceWording = unique(facts.map((fact) => displayValue(fact.value)).filter(Boolean));
      const exactBlockIds = new Set(facts.map((fact) => fact.source.sourceBlockId).filter((id): id is string => Boolean(id)));
      const searchTerms = unique([offering.name, ...sourceWording]).map(normalizedText).filter((value) => value.length >= 3);
      const evidence = blocks
        .filter((block) => {
          if (exactBlockIds.has(block.id)) return true;
          const matchesService = searchTerms.some((term) => normalizedText(block.displayText).includes(term));
          const servicePurpose = block.purposeTags.some((tag) => tag === "services" || tag === "service_detail");
          return matchesService && (servicePurpose || wordCount(block.displayText) >= 8);
        })
        .sort((left, right) =>
          evidenceBlockRank(right, exactBlockIds) - evidenceBlockRank(left, exactBlockIds)
          || left.id.localeCompare(right.id))
        .slice(0, 6);
      return {
        offeringId: offering.id,
        ...(offering.catalogId ? { catalogId: offering.catalogId } : {}),
        name: offering.name,
        pageMode: offering.pageMode as "dedicated" | "shared",
        featured: offering.featured,
        sourceFactIds: offering.sourceFactIds,
        sourceWording,
        evidence
      };
    });
  const retainedServiceBlockIds = new Set(serviceBriefs.flatMap((brief) => brief.evidence.map((block) => block.id)));
  const researchPayload = objectValue(research?.payload);
  const researchSources = Array.isArray(researchPayload?.sources)
    ? researchPayload.sources.filter((source): source is string => typeof source === "string")
    : [];
  const location = input.buildInput.business.locations[0];
  const hours = location?.hours;
  const evidenceGaps = evidenceGapsFor(input.buildInput, serviceBriefs);
  const required: AuthoringContextPacket = {
    kind: "authoring-context-packet",
    authorities: {
      publicBuildInputId: input.buildInput.id,
      businessStateRevision: input.buildInput.businessStateRevision,
      siteIntentRevision: input.buildInput.siteIntentRevision,
      sourceSnapshotIds: input.buildInput.sourceSnapshotIds
    },
    siteContext: {
      businessName: input.buildInput.business.name,
      identityStatus: input.buildInput.business.identityStatus,
      description: input.buildInput.business.description,
      contacts: input.buildInput.business.contacts,
      primaryLocation: location ? {
        id: location.id,
        label: location.label,
        street: location.street,
        city: location.city,
        region: location.region,
        postalCode: location.postalCode,
        country: location.country
      } : undefined,
      verifiedHours: hours,
      availabilitySummary: continuousAvailabilitySummary(hours),
      serviceAreas: input.buildInput.business.serviceAreas.map((area) => area.label),
      pageRequirements: input.buildInput.intent.pageRequirements.map((page) => ({
        purpose: page.purpose,
        path: page.slug ? `/${page.slug}` : "/",
        title: page.title,
        offeringId: page.offeringId
      })),
      metadataExpectations: [
        "Use a descriptive route title that includes the business name.",
        "Use the verified locality on high-intent home and service routes when it reads naturally.",
        "Give every route a distinct description that accurately summarizes its content."
      ]
    },
    serviceBriefs,
    supplementalContext: {
      crawlCoverage: typeof ingestion?.coverage === "string" ? ingestion.coverage : undefined,
      blocks: [],
      research: researchPayload ? {
        sources: researchSources,
        coverage: typeof researchPayload.coverage === "string" ? researchPayload.coverage : undefined,
        provenance: objectValue(researchPayload.provenance)
      } : undefined
    },
    evidenceGaps,
    truncated: false
  };
  assertRequiredContextFits(input.buildInput, required);

  const packet = structuredClone(required);
  const supplementalBlocks = blocks
    .filter((block) => !retainedServiceBlockIds.has(block.id) && blockById.has(block.id))
    .sort((left, right) => supplementalBlockRank(right) - supplementalBlockRank(left) || left.id.localeCompare(right.id));
  for (const block of supplementalBlocks) {
    packet.supplementalContext.blocks.push(block);
    if (contextLength(input.buildInput, packet) > maximumAuthoringContextCharacters) {
      packet.supplementalContext.blocks.pop();
      packet.truncated = true;
      break;
    }
  }
  if (researchPayload && typeof researchPayload.report === "string") {
    packet.supplementalContext.research = {
      ...packet.supplementalContext.research!,
      report: researchPayload.report
    };
    if (contextLength(input.buildInput, packet) > maximumAuthoringContextCharacters) {
      delete packet.supplementalContext.research.report;
      packet.truncated = true;
    }
  }
  return packet;
}

function assertRequiredContextFits(buildInput: SitePublicBuildInput, packet: AuthoringContextPacket) {
  if (contextLength(buildInput, packet) <= maximumAuthoringContextCharacters) return;
  throw new SiteAuthoringTerminalError(
    "artifact_contract_invalid",
    "platform",
    false,
    "authoring_required_context_exceeds_160000_characters"
  );
}

function evidenceGapsFor(
  buildInput: SitePublicBuildInput,
  serviceBriefs: AuthoringContextPacket["serviceBriefs"]
): AuthoringContextPacket["evidenceGaps"] {
  const missing: AuthoringContextPacket["evidenceGaps"]["missing"] = [];
  if (!buildInput.business.proof.length) missing.push("verified_proof");
  if (!buildInput.business.serviceAreas.length) missing.push("service_areas");
  if (!buildInput.business.assets.some((asset) => asset.kind === "photo" || asset.kind === "logo")) missing.push("source_media");
  if (!buildInput.business.description) missing.push("business_description");
  if (serviceBriefs.some((brief) => brief.evidence.length < 2)) missing.push("service_detail");
  return {
    missing: unique(missing),
    cautions: [
      "Treat every missing evidence category as an omission constraint, not an invitation to infer or invent.",
      "URL paths, page titles, filenames, and image alt text may suggest what to inspect but are not sufficient proof for public local facts."
    ]
  };
}

function ingestionPurposeTagsByUrl(ingestion: Record<string, unknown> | undefined) {
  const result = new Map<string, string[]>();
  if (!Array.isArray(ingestion?.pages)) return result;
  for (const value of ingestion.pages) {
    const page = objectValue(value);
    const summary = objectValue(page?.summary);
    const url = typeof summary?.url === "string" ? summary.url : typeof page?.url === "string" ? page.url : undefined;
    const tags = Array.isArray(summary?.purposeTags)
      ? summary.purposeTags.filter((tag): tag is string => typeof tag === "string")
      : [];
    if (url) result.set(url, tags);
  }
  return result;
}

function evidenceBlockRank(block: AuthoringEvidenceBlock, exactBlockIds: Set<string>) {
  return (exactBlockIds.has(block.id) ? 1_000 : 0)
    + (block.evidenceClass === "first_party" ? 200 : block.evidenceClass === "unknown" ? 50 : 0)
    + (block.purposeTags.some((tag) => tag === "services" || tag === "service_detail") ? 100 : 0)
    + Math.min(80, block.displayText.length / 20);
}

function supplementalBlockRank(block: AuthoringEvidenceBlock) {
  return (block.evidenceClass === "first_party" ? 100 : block.evidenceClass === "unknown" ? 20 : 0)
    + (block.purposeTags.some((tag) => ["home", "about", "contact", "location"].includes(tag)) ? 40 : 0)
    + Math.min(30, block.displayText.length / 40);
}

function continuousAvailabilitySummary(hours: Record<string, string> | undefined) {
  const values = Object.values(hours ?? {});
  if (!values.length || !values.every((value) => /\b(?:open )?24 hours?\b/i.test(value))) return undefined;
  return "Open 24 hours daily";
}

function contextLength(buildInput: SitePublicBuildInput, packet: AuthoringContextPacket) {
  return JSON.stringify({ buildInput, packet }).length;
}

function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(displayValue).filter(Boolean).join(", ");
  return "";
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
