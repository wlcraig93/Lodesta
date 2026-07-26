import type {
  SiteElementSelection,
  SitePublicBuildInput,
  SourceSnapshot
} from "@/packages/site-contracts";
import { continuousAvailabilitySummary } from "@/packages/business-data/availability";
import { sha256 } from "@/packages/business-data/hash";
import { SiteAuthoringTerminalError } from "./failures";
import type { WorkspaceSourceFile } from "./contracts";

export const targetAuthoringBriefCharacters = 60_000;
export const authoringBriefAlertCharacters = 80_000;
export const maximumAuthoringBriefCharacters = 160_000;

type BriefEvidenceBlock = {
  id: string;
  sourceUrl: string;
  displayText: string;
  evidenceClass: "first_party" | "third_party" | "unknown";
  purposeTags: string[];
};

export type SiteAuthoringBrief = {
  schemaVersion: 1;
  kind: "site-authoring-brief";
  experience: {
    audience?: string;
    positioning?: string;
    voice: string[];
    primaryConversion: SitePublicBuildInput["intent"]["primaryConversion"];
    pages: Array<{
      purpose: string;
      path: string;
      title: string;
      required: boolean;
      offeringId?: string;
    }>;
    brand: SitePublicBuildInput["intent"]["brandConstraints"];
    notes: string[];
  };
  business: {
    name: string;
    identityStatus: SitePublicBuildInput["business"]["identityStatus"];
    description?: string;
    contacts: SitePublicBuildInput["business"]["contacts"];
    locations: Array<{
      id: string;
      label: string;
      street?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country: string;
      hours?: Record<string, string>;
      availabilitySummary?: string;
      sourceFactIds: string[];
    }>;
    serviceAreas: SitePublicBuildInput["business"]["serviceAreas"];
    proof: SitePublicBuildInput["business"]["proof"];
  };
  facts: Array<{
    id: string;
    kind: SitePublicBuildInput["publicFacts"][number]["kind"];
    label: string;
    value: unknown;
    source: {
      evidenceClass?: "first_party" | "third_party" | "unknown";
      ownerConfirmed: boolean;
      confidence: number;
    };
  }>;
  services: Array<{
    offeringId: string;
    catalogId?: string;
    name: string;
    pageMode: "dedicated" | "shared";
    featured: boolean;
    sourceFactIds: string[];
    sourceWording: string[];
    evidence: BriefEvidenceBlock[];
  }>;
  capabilities: {
    enabled: SitePublicBuildInput["intent"]["enabledCapabilities"];
    assets: Array<{
      assetId: string;
      revisionId: string;
      kind: string;
      alt: string;
      width?: number;
      height?: number;
      origin: string;
    }>;
    links: Array<{ id: string; kind: string; label: string; url: string }>;
    forms: Array<{
      id: string;
      name: string;
      fields: SitePublicBuildInput["forms"][number]["fields"];
      submitLabel: string;
      successMessage: string;
    }>;
    maps: Array<{ locationId: string; label: string }>;
  };
  guidance?: {
    id: string;
    version: string;
    terminology: Record<string, string[]>;
    customerJourneys: string[];
    conversionRecommendations: string[];
    proofCautions: string[];
    contentOpportunities: string[];
    faqOpportunities: string[];
    seoAeoOpportunities: string[];
    structuredDataType: string;
    skillRef: string;
  };
  evidence: {
    crawlCoverage?: string;
    supplementalBlocks: BriefEvidenceBlock[];
    research?: {
      report?: string;
      sources: string[];
      coverage?: string;
    };
  };
  evidenceGaps: {
    missing: Array<"verified_proof" | "service_areas" | "source_media" | "business_description" | "service_detail">;
    cautions: string[];
  };
  truncated: boolean;
};

export type ManagerDiscussionBrief = {
  schemaVersion: 1;
  kind: "manager-discussion-brief";
  instruction: string;
  message: string;
  selection?: SiteElementSelection;
  site: {
    name: string;
    identityStatus: SitePublicBuildInput["business"]["identityStatus"];
    description?: string;
    contacts: SitePublicBuildInput["business"]["contacts"];
    locations: Array<{ id: string; label: string; city?: string; region?: string }>;
    serviceAreas: string[];
    services: Array<{ id: string; name: string; pageMode: string }>;
    primaryConversion: SitePublicBuildInput["intent"]["primaryConversion"];
    voice: string[];
    enabledCapabilities: SitePublicBuildInput["intent"]["enabledCapabilities"];
  };
  routes: {
    intended: Array<{ path: string; title: string; purpose: string }>;
    current: string[];
  };
  workspace?: {
    files: Array<{
      path: string;
      contentType: "text/typescript" | "text/tsx" | "text/css";
      bytes: number;
      lines: number;
      contentHash: `sha256:${string}`;
    }>;
  };
};

export function createSiteAuthoringBrief(input: {
  buildInput: SitePublicBuildInput;
  snapshots: SourceSnapshot[];
}): SiteAuthoringBrief {
  const website = input.snapshots.find((snapshot) => snapshot.sourceType === "website");
  const research = input.snapshots.find((snapshot) => snapshot.sourceType === "web_research");
  const ingestion = objectValue(website?.payload.ingestion);
  const rawBlocks = Array.isArray(ingestion?.modelBlocks) ? ingestion.modelBlocks : [];
  const purposeTagsByUrl = ingestionPurposeTagsByUrl(ingestion);
  const blocks = rawBlocks.flatMap((value): BriefEvidenceBlock[] => {
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
      displayText: block.displayText.slice(0, 1_600),
      evidenceClass: block.evidenceClass as BriefEvidenceBlock["evidenceClass"],
      purposeTags: purposeTagsByUrl.get(block.sourceUrl) ?? []
    }];
  });
  const publicFactById = new Map(input.buildInput.publicFacts.map((fact) => [fact.id, fact]));
  const services: SiteAuthoringBrief["services"] = input.buildInput.business.offerings
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
        .slice(0, 4);
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
  const retainedServiceBlockIds = new Set(services.flatMap((service) => service.evidence.map((block) => block.id)));
  const researchPayload = objectValue(research?.payload);
  const researchSources = Array.isArray(researchPayload?.sources)
    ? researchPayload.sources.filter((source): source is string => typeof source === "string").slice(0, 20)
    : [];
  const brief: SiteAuthoringBrief = {
    schemaVersion: 1,
    kind: "site-authoring-brief",
    experience: {
      audience: input.buildInput.intent.audience,
      positioning: input.buildInput.intent.positioning,
      voice: input.buildInput.intent.voice,
      primaryConversion: input.buildInput.intent.primaryConversion,
      pages: input.buildInput.intent.pageRequirements.map((page) => ({
        purpose: page.purpose,
        path: page.slug ? `/${page.slug}` : "/",
        title: page.title,
        required: page.required,
        offeringId: page.offeringId
      })),
      brand: input.buildInput.intent.brandConstraints,
      notes: input.buildInput.intent.notes
    },
    business: {
      name: input.buildInput.business.name,
      identityStatus: input.buildInput.business.identityStatus,
      description: input.buildInput.business.description,
      contacts: input.buildInput.business.contacts,
      locations: input.buildInput.business.locations.map((location) => ({
        id: location.id,
        label: location.label,
        street: location.street,
        city: location.city,
        region: location.region,
        postalCode: location.postalCode,
        country: location.country,
        hours: location.hours,
        availabilitySummary: continuousAvailabilitySummary(location.hours),
        sourceFactIds: location.sourceFactIds
      })),
      serviceAreas: input.buildInput.business.serviceAreas,
      proof: input.buildInput.business.proof
    },
    facts: input.buildInput.publicFacts.map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      label: fact.label,
      value: fact.value,
      source: {
        evidenceClass: fact.source.evidenceClass,
        ownerConfirmed: fact.source.ownerConfirmed,
        confidence: fact.source.confidence
      }
    })),
    services,
    capabilities: {
      enabled: input.buildInput.intent.enabledCapabilities,
      assets: input.buildInput.business.assets.map((asset) => ({
        assetId: asset.assetId,
        revisionId: asset.revisionId,
        kind: asset.kind,
        alt: asset.alt,
        width: asset.width,
        height: asset.height,
        origin: asset.origin
      })),
      links: input.buildInput.business.links.map((link) => ({
        id: link.id,
        kind: link.kind,
        label: link.label,
        url: link.url
      })),
      forms: input.buildInput.forms.map((form) => ({
        id: form.id,
        name: form.name,
        fields: form.fields,
        submitLabel: form.submitLabel,
        successMessage: form.successMessage
      })),
      maps: input.buildInput.business.locations.map((location) => ({
        locationId: location.id,
        label: location.label
      }))
    },
    guidance: input.buildInput.domainContext ? {
      id: input.buildInput.domainContext.id,
      version: input.buildInput.domainContext.version,
      terminology: input.buildInput.domainContext.terminology,
      customerJourneys: input.buildInput.domainContext.customerJourneys,
      conversionRecommendations: input.buildInput.domainContext.conversionRecommendations,
      proofCautions: input.buildInput.domainContext.proofCautions,
      contentOpportunities: input.buildInput.domainContext.contentOpportunities,
      faqOpportunities: input.buildInput.domainContext.faqOpportunities,
      seoAeoOpportunities: input.buildInput.domainContext.seoAeoOpportunities,
      structuredDataType: input.buildInput.domainContext.structuredDataType,
      skillRef: input.buildInput.domainContext.skillRef
    } : undefined,
    evidence: {
      crawlCoverage: typeof ingestion?.coverage === "string" ? ingestion.coverage : undefined,
      supplementalBlocks: [],
      research: researchPayload ? {
        sources: researchSources,
        coverage: typeof researchPayload.coverage === "string" ? researchPayload.coverage : undefined
      } : undefined
    },
    evidenceGaps: evidenceGapsFor(input.buildInput, services),
    truncated: false
  };
  assertBriefFits(brief);

  const supplementalBlocks = blocks
    .filter((block) => !retainedServiceBlockIds.has(block.id))
    .sort((left, right) => supplementalBlockRank(right) - supplementalBlockRank(left) || left.id.localeCompare(right.id));
  for (const block of supplementalBlocks) {
    brief.evidence.supplementalBlocks.push(block);
    if (authoringBriefCharacters(brief) > targetAuthoringBriefCharacters) {
      brief.evidence.supplementalBlocks.pop();
      brief.truncated = true;
      break;
    }
  }
  if (researchPayload && typeof researchPayload.report === "string") {
    brief.evidence.research = {
      ...brief.evidence.research!,
      report: researchPayload.report.slice(0, 12_000)
    };
    if (authoringBriefCharacters(brief) > targetAuthoringBriefCharacters) {
      delete brief.evidence.research.report;
      brief.truncated = true;
    }
  }
  assertBriefFits(brief);
  return brief;
}

export function createManagerDiscussionBrief(input: {
  buildInput: SitePublicBuildInput;
  message: string;
  currentFiles?: WorkspaceSourceFile[];
  selection?: SiteElementSelection;
}): ManagerDiscussionBrief {
  const files = input.currentFiles ?? [];
  return {
    schemaVersion: 1,
    kind: "manager-discussion-brief",
    instruction: "Discuss the requested change without modifying source. Be concise, state what would change, and identify unsupported capability requests. Speak in owner-facing page and section terms. Do not mention source paths, filenames, selectors, framework internals, internal error codes, or raw run telemetry.",
    message: input.message,
    selection: input.selection,
    site: {
      name: input.buildInput.business.name,
      identityStatus: input.buildInput.business.identityStatus,
      description: input.buildInput.business.description,
      contacts: input.buildInput.business.contacts,
      locations: input.buildInput.business.locations.map((location) => ({
        id: location.id,
        label: location.label,
        city: location.city,
        region: location.region
      })),
      serviceAreas: input.buildInput.business.serviceAreas.map((area) => area.label),
      services: input.buildInput.business.offerings.map((offering) => ({
        id: offering.id,
        name: offering.name,
        pageMode: offering.pageMode
      })),
      primaryConversion: input.buildInput.intent.primaryConversion,
      voice: input.buildInput.intent.voice,
      enabledCapabilities: input.buildInput.intent.enabledCapabilities
    },
    routes: {
      intended: input.buildInput.intent.pageRequirements.map((page) => ({
        path: page.slug ? `/${page.slug}` : "/",
        title: page.title,
        purpose: page.purpose
      })),
      current: currentWorkspaceRoutes(files)
    },
    workspace: files.length ? {
      files: files.map((file) => ({
        path: file.path,
        contentType: file.path.endsWith(".css")
          ? "text/css" as const
          : file.path.endsWith(".tsx")
            ? "text/tsx" as const
            : "text/typescript" as const,
        bytes: Buffer.byteLength(file.content),
        lines: file.content.split("\n").length,
        contentHash: sha256(file.content)
      }))
    } : undefined
  };
}

export function authoringBriefCharacters(brief: SiteAuthoringBrief) {
  return JSON.stringify(brief).length;
}

function assertBriefFits(brief: SiteAuthoringBrief) {
  if (authoringBriefCharacters(brief) <= maximumAuthoringBriefCharacters) return;
  throw new SiteAuthoringTerminalError(
    "artifact_contract_invalid",
    "platform",
    false,
    "site_authoring_brief_exceeds_160000_characters"
  );
}

function evidenceGapsFor(
  buildInput: SitePublicBuildInput,
  services: SiteAuthoringBrief["services"]
): SiteAuthoringBrief["evidenceGaps"] {
  const missing: SiteAuthoringBrief["evidenceGaps"]["missing"] = [];
  if (!buildInput.business.proof.length) missing.push("verified_proof");
  if (!buildInput.business.serviceAreas.length) missing.push("service_areas");
  if (!buildInput.business.assets.some((asset) => asset.kind === "photo" || asset.kind === "logo")) missing.push("source_media");
  if (!buildInput.business.description) missing.push("business_description");
  if (services.some((service) => service.evidence.length < 2)) missing.push("service_detail");
  return {
    missing: unique(missing),
    cautions: [
      "Treat missing evidence as an omission constraint, not an invitation to infer or invent.",
      "Paths, page titles, filenames, and image alt text are inspection clues, not proof of public facts.",
      "Emergency or phone-line availability does not establish continuous location hours."
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

function currentWorkspaceRoutes(files: WorkspaceSourceFile[]) {
  return unique(files
    .filter((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx"))
    .flatMap((file) => [...file.content.matchAll(/\bpath\s*:\s*["'](\/[^"'?#\s]*)["']/g)].map((match) => match[1]))
    .filter((path) => /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)*$/.test(path)))
    .sort();
}

function evidenceBlockRank(block: BriefEvidenceBlock, exactBlockIds: Set<string>) {
  return (exactBlockIds.has(block.id) ? 1_000 : 0)
    + (block.evidenceClass === "first_party" ? 200 : block.evidenceClass === "unknown" ? 50 : 0)
    + (block.purposeTags.some((tag) => tag === "services" || tag === "service_detail") ? 100 : 0)
    + Math.min(80, block.displayText.length / 20);
}

function supplementalBlockRank(block: BriefEvidenceBlock) {
  return (block.evidenceClass === "first_party" ? 100 : block.evidenceClass === "unknown" ? 20 : 0)
    + (block.purposeTags.some((tag) => ["home", "about", "contact", "location"].includes(tag)) ? 40 : 0)
    + Math.min(30, block.displayText.length / 40);
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
