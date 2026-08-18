import { randomUUID } from "node:crypto";
import { preferBusinessNameCandidate } from "@/lib/business-fact-normalization";
import { type CrawlAssessment, type CrawlPageSummary, type ExtractedBusinessFacts } from "@/lib/crawler";
import { assertPublicFetchUrl } from "@/lib/url-safety";
import type { SourceTextBlock } from "@/lib/source-text-blocks";
import {
  assetRevisionSchema,
  businessStateSchema,
  formDefinitionSchema,
  platformSiteRecordSchema,
  siteIntentSchema,
  sourceSnapshotSchema,
  isCustomerPortalLink,
  type BusinessOffering,
  type BusinessState,
  type FormDefinition,
  type PlatformSiteRecord,
  type BusinessFact,
  type SiteIntent,
  type SourceSnapshot
} from "@/packages/site-contracts";
export { isCustomerPortalLink } from "@/packages/site-contracts";
import { WebsiteCrawlError } from "./crawl-errors";
import { sha256, stableJson } from "./hash";
import { crawlWebsiteForGeneration, type EvidenceClass, type WebsiteGenerationIngestion } from "./generation-crawler";
import { buildWebsiteSourceMirror, websiteMirrorManifestHash, type RetainedSourceResource } from "./source-mirror";
import type { SourceSnapshotPage } from "@/packages/site-contracts";
import { classifySourcePagePath } from "./source-page-classification";

export type WebsiteIngestionResult = {
  site: PlatformSiteRecord;
  state: BusinessState;
  intent: SiteIntent;
  forms: FormDefinition[];
  sourceSnapshots: SourceSnapshot[];
  retainedSourceResources: RetainedSourceResource[];
  sourceSnapshotPages: SourceSnapshotPage[];
  sourceUrl: string;
  crawl: CrawlAssessment;
  generationIngestion: WebsiteGenerationIngestion;
  validationEligibility: "frozen_validation" | "private_review_only";
};

export type SourcePreparationFactDiagnostic = {
  kind: "hours" | "service_area";
  value: unknown;
  disposition:
    | "accepted"
    | "deduplication"
    | "invalid_value_filtering"
    | "conflict_suppression"
    | "changed_public_eligibility"
    | "unexplained_loss";
  reason: string;
  sourceUrls: string[];
  evidenceClasses: EvidenceClass[];
};

export type SourcePreparationDiagnostics = {
  schemaVersion: 1;
  facts: SourcePreparationFactDiagnostic[];
};

/**
 * Creates the durable private project authority before crawling. The submitted
 * URL is retained on the site record until the first exact website mirror is
 * finalized. A submitted URL alone is not a source snapshot or owner fact.
 */
export async function createLooseWebsiteBootstrap(input: {
  url: string;
  slug?: string;
  siteId?: string;
  businessId?: string;
  now?: string;
}) {
  let sourceUrl: string;
  try {
    sourceUrl = await assertPublicFetchUrl(input.url, { resolveDns: false });
  } catch (error) {
    throw new WebsiteCrawlError(
      "source_invalid",
      error instanceof Error ? error.message : String(error)
    );
  }
  const now = input.now ?? new Date().toISOString();
  const siteId = input.siteId ?? `site_${idPart(randomUUID())}`;
  const businessId = input.businessId ?? `business_${idPart(randomUUID())}`;
  const hostname = new URL(sourceUrl).hostname;
  const name = hostnameBusinessName(sourceUrl);
  const stateWithoutHash = {
    schemaVersion: 1 as const,
    businessId,
    siteId,
    revision: 1,
    ownerOperationalRevision: 1,
    updatedAt: now,
    identity: {
      name,
      status: "provisional" as const,
      categories: [] as string[]
    },
    contacts: {},
    locations: [],
    serviceAreas: [],
    offerings: [],
    proof: [],
    assets: [],
    links: [],
    facts: []
  };
  const state = businessStateSchema.parse({
    ...stateWithoutHash,
    stateHash: sha256(stableJson(stateWithoutHash))
  });
  const intentWithoutHash = {
    schemaVersion: 1 as const,
    id: `intent_${idPart(randomUUID())}`,
    siteId,
    revision: 1,
    ownerIntentRevision: 1,
    updatedAt: now,
    voice: ["clear", "capable"],
    primaryConversion: "auto" as const,
    pageRequirements: [],
    brandConstraints: {
      preferredColors: [],
      prohibitedColors: [],
      preserveLogo: true,
      notes: []
    },
    enabledCapabilities: ["forms", "analytics", "maps"] as const,
    agentAccessPolicy: {
      search: "allow" as const,
      aiInput: "allow" as const,
      aiTrain: "disallow" as const,
      trainingPermission: { status: "not_granted" as const }
    },
    notes: []
  };
  const intent = siteIntentSchema.parse({
    ...intentWithoutHash,
    intentHash: sha256(stableJson(intentWithoutHash))
  });
  const form = formDefinitionSchema.parse({
    schemaVersion: 1,
    id: `form_contact_${idPart(randomUUID())}`,
    siteId,
    key: "primary_lead",
    revision: 1,
    name: "Contact request",
    status: "candidate_only",
    destination: "lead_inbox",
    fields: [
      { id: "name", label: "Name", role: "contact_name", type: "text", required: true },
      { id: "phone", label: "Phone", role: "contact_phone", type: "phone", required: false },
      { id: "email", label: "Email", role: "contact_email", type: "email", required: true },
      { id: "message", label: "How can we help?", role: "message", type: "textarea", required: false }
    ],
    submitLabel: "Send request",
    successMessage: "Thanks. The business will follow up soon.",
    createdAt: now
  });
  const site = platformSiteRecordSchema.parse({
    id: siteId,
    businessId,
    slug: input.slug ?? safeSlug(name || hostname),
    sourceUrl,
    normalizedSource: sourceUrl,
    status: "draft",
    createdAt: now,
    updatedAt: now
  });
  return {
    site,
    state,
    intent,
    forms: [form],
    sourceSnapshots: [] as SourceSnapshot[],
    sourceUrl
  };
}

export async function ingestWebsite(input: {
  url: string;
  slug?: string;
  siteId?: string;
  businessId?: string;
  now?: string;
  signal?: AbortSignal;
}): Promise<WebsiteIngestionResult> {
  let sourceUrl: string;
  try {
    sourceUrl = await assertPublicFetchUrl(input.url);
  } catch (error) {
    throw new WebsiteCrawlError(
      "source_invalid",
      error instanceof Error ? error.message : String(error)
    );
  }
  const now = input.now ?? new Date().toISOString();
  const siteId = input.siteId ?? `site_${idPart(randomUUID())}`;
  const businessId = input.businessId ?? `business_${idPart(randomUUID())}`;
  const { ingestion: generationIngestion, crawl, captures, documents, timings } = await crawlWebsiteForGeneration({ url: sourceUrl, signal: input.signal });
  assertSourceSuitableForGeneration(crawl, generationIngestion);

  const retainedContacts = retainedContactConsensus(documents);
  const facts = {
    ...crawl.extractedFacts,
    phone: crawl.extractedFacts.phone ?? retainedContacts.phone,
    email: crawl.extractedFacts.email ?? retainedContacts.email
  };
  const crawlName = clean(crawl.extractedFacts.name) ?? clean(crawl.title)?.replace(/\s*[|\-–].*$/, "").trim();
  const sourceBackedName = preferBusinessNameCandidate(crawlName, undefined, new URL(sourceUrl).hostname);
  const identityStatus = clean(sourceBackedName) ? "verified" as const : "provisional" as const;
  const name = clean(sourceBackedName) ?? hostnameBusinessName(sourceUrl);
  const sourceContentHash = websiteMirrorManifestHash({ ingestion: generationIngestion, captures });
  const sourceSnapshotId = sourceSnapshotIdForBusiness(businessId, sourceContentHash);
  const mirror = buildWebsiteSourceMirror({
    sourceSnapshotId,
    sourceUrl,
    ingestion: generationIngestion,
    captures,
    documents,
    capturedAt: now,
    timings
  });
  const factExtractionStarted = Date.now();
  const sourceSnapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: sourceSnapshotId,
    businessId,
    sourceType: "website",
    sourceUrl,
    contentHash: sourceContentHash,
    capturedAt: now,
    payload: mirror.payload
  });

  const blockIndex = crawl.pageSummaries.flatMap((page) => page.sourceTextBlocks);
  const evidenceClassByUrl = new Map(generationIngestion.pages.flatMap((page) => [
    [page.url, page.evidenceClass] as const,
    [(page.summary as CrawlPageSummary).url, page.evidenceClass] as const
  ]));
  const publicFacts: BusinessFact[] = [];
  const addFact = (
    kind: BusinessFact["kind"],
    label: string,
    value: unknown,
    confidence = 0.78,
    publicEligible = true,
    evidence?: { sourceBlockId?: string; sourceUrl: string; evidenceClass: EvidenceClass }
  ) => {
    if (value === undefined || value === null || value === "") return undefined;
    const text = displayValue(value);
    const id = `fact_${kind}_${sha256(text).slice(7, 19)}`;
    const block = evidence?.sourceBlockId
      ? blockIndex.find((candidate) => candidate.id === evidence.sourceBlockId && candidate.sourceUrl === evidence.sourceUrl)
      : evidence
        ? undefined
        : selectSupportingSourceBlock(blockIndex, text, evidenceClassByUrl);
    const evidenceClass: EvidenceClass = evidence?.evidenceClass ?? (block ? evidenceClassByUrl.get(block.sourceUrl) ?? "unknown" : "first_party");
    const automaticallyEligible = publicEligible && evidenceClass === "first_party";
    publicFacts.push({
      id,
      kind,
      label,
      value,
      source: {
        factId: id,
        sourceSnapshotId,
        ...(block
          ? { sourceBlockId: block.id, sourceUrl: block.sourceUrl }
          : evidence
            ? { sourceUrl: evidence.sourceUrl }
            : publicEligible
              ? { sourceUrl }
              : {}),
        evidenceClass,
        observedAt: now,
        confidence,
        ownerConfirmed: false
      },
      publicEligible: automaticallyEligible
    });
    return id;
  };

  const nameFactId = identityStatus === "verified"
    ? addFact("business_name", "Business name", name, 0.9, sameValue(name, crawlName))
    : undefined;
  const sourceWebsiteFactId = addFact("link", "Source website", sourceUrl, 1, true, {
    sourceUrl,
    evidenceClass: "first_party"
  })!;
  addFact("description", "Business description", clean(facts.description), 0.7, sameValue(facts.description, crawl.extractedFacts.description));
  const phoneFactId = addFact(
    "phone",
    "Phone",
    clean(facts.phone),
    0.82,
    sameValue(facts.phone, crawl.extractedFacts.phone) || sameValue(facts.phone, retainedContacts.phone)
  );
  addFact(
    "email",
    "Email",
    clean(facts.email),
    0.78,
    sameValue(facts.email, crawl.extractedFacts.email) || sameValue(facts.email, retainedContacts.email)
  );
  const addressText = formatAddress(facts.address);
  const addressFactId = addFact("address", "Address", addressText, 0.8, sameValue(addressText, formatAddress(crawl.extractedFacts.address)));
  const hoursFactId = addFact(
    "hours",
    "Hours",
    facts.hours && Object.keys(facts.hours).length ? facts.hours : undefined,
    0.75,
    sameValue(facts.hours, crawl.extractedFacts.hours)
  );

  const crawlServiceAreas = verifiedServiceAreas(crawl, generationIngestion);
  for (const service of selectSourceOfferingFacts(crawl, generationIngestion, crawlServiceAreas.map((area) => area.label))) {
    addFact("offering", "Observed source service language", service.name, service.confidence, true, service.evidence);
  }
  const offerings: BusinessOffering[] = [];
  const eligibleAddress = addressFactId ? publicFacts.some((fact) => fact.id === addressFactId && fact.publicEligible) : false;
  const serviceAreas = crawlServiceAreas.slice(0, 50).map(({ label, evidence }, index) => {
    const factId = addFact("service_area", "Service area", label, 0.78, true, evidence)!;
    return { id: `service_area_${index + 1}`, label, sourceFactIds: [factId] };
  });
  void eligibleAddress;

  const assets: [] = [];

  const links = selectSourceLinksForGeneration(sourceUrl, crawl).map((link, index) => {
    const factId = link.kind === "website" && link.url === sourceUrl
      ? sourceWebsiteFactId
      : addFact("link", link.label, link.url, 0.75, true, {
          sourceUrl: sourcePageForFunctionalLink(crawl, link.url) ?? sourceUrl,
          evidenceClass: "first_party"
        })!;
    return { id: `link_${index + 1}`, ...link, publicEligible: true, sourceFactIds: [factId] };
  });
  const locationSourceIds = [addressFactId, hoursFactId].filter((value): value is string => Boolean(value));
  const locations = facts.address || facts.hours || facts.geo ? [{
    id: "location_primary",
    label: "Business location",
    street: clean(facts.address?.street),
    city: clean(facts.address?.city),
    region: clean(facts.address?.region),
    postalCode: clean(facts.address?.postalCode),
    country: normalizeCountryCode(facts.address?.country),
    latitude: facts.geo?.latitude,
    longitude: facts.geo?.longitude,
    hours: facts.hours,
    sourceFactIds: locationSourceIds
  }] : [];

  const proof = observedProof(crawl, sourceSnapshotId, publicFacts, now);
  const factExtractionCompleted = Date.now();
  const stateWithoutHash = {
    schemaVersion: 1 as const,
    businessId,
    siteId,
    revision: 1,
    ownerOperationalRevision: 1,
    updatedAt: now,
    identity: {
      name,
      status: identityStatus,
      description: clean(facts.description),
      categories: selectBusinessCategories(facts.categories, [name, ...facts.services])
    },
    contacts: { phone: clean(facts.phone), email: clean(facts.email) },
    locations,
    serviceAreas,
    offerings,
    proof,
    assets,
    links,
    facts: publicFacts
  };
  const state = businessStateSchema.parse({ ...stateWithoutHash, stateHash: sha256(stableJson(stateWithoutHash)) });
  const slug = input.slug ?? safeSlug(name);
  const form = formDefinitionSchema.parse({
    schemaVersion: 1,
    id: `form_estimate_${idPart(randomUUID())}`,
    siteId,
    key: "primary_lead",
    revision: 1,
    name: "Estimate request",
    status: "candidate_only",
    destination: "lead_inbox",
    fields: [
      { id: "name", label: "Name", role: "contact_name", type: "text", required: true },
      { id: "phone", label: "Phone", role: "contact_phone", type: "phone", required: true },
      { id: "email", label: "Email", role: "contact_email", type: "email", required: false },
      { id: "message", label: "How can we help?", role: "message", type: "textarea", required: false }
    ],
    submitLabel: "Request an estimate",
    successMessage: "Thanks. The business will follow up soon.",
    createdAt: now
  });
  const intentWithoutHash = {
    schemaVersion: 1 as const,
    id: `intent_${idPart(randomUUID())}`,
    siteId,
    revision: 1,
    ownerIntentRevision: 1,
    updatedAt: now,
    positioning: clean(facts.description),
    voice: ["clear", "capable"],
    primaryConversion: "auto" as const,
    pageRequirements: [],
    brandConstraints: {
      preferredColors: [],
      prohibitedColors: [],
      preserveLogo: true,
      notes: []
    },
    enabledCapabilities: ["forms", "analytics", "maps"] as const,
    agentAccessPolicy: {
      search: "allow" as const,
      aiInput: "allow" as const,
      aiTrain: "disallow" as const,
      trainingPermission: { status: "not_granted" as const }
    },
    notes: []
  };
  const intent = siteIntentSchema.parse({ ...intentWithoutHash, intentHash: sha256(stableJson(intentWithoutHash)) });
  const site = platformSiteRecordSchema.parse({
    id: siteId,
    businessId,
    slug,
    status: "draft",
    createdAt: now,
    updatedAt: now
  });
  const finalizationCompleted = Date.now();
  const timedSourceSnapshot = sourceSnapshotSchema.parse({
    ...sourceSnapshot,
    payload: {
      ...mirror.payload,
      stages: {
        ...mirror.payload.stages,
        factExtractionMs: Math.max(0, factExtractionCompleted - factExtractionStarted),
        finalizationMs: Math.max(0, finalizationCompleted - factExtractionCompleted)
      },
      completedAt: new Date(finalizationCompleted).toISOString(),
      elapsedMs: Math.max(mirror.payload.elapsedMs, finalizationCompleted - Date.parse(mirror.payload.startedAt))
    }
  });
  void phoneFactId;
  return {
    site,
    state,
    intent,
    forms: [form],
    sourceSnapshots: [timedSourceSnapshot],
    retainedSourceResources: mirror.resources,
    sourceSnapshotPages: mirror.pages,
    sourceUrl,
    crawl,
    generationIngestion,
    validationEligibility: generationIngestion.coverage === "incomplete" ? "private_review_only" : "frozen_validation"
  };
}

export function sourceSnapshotIdForBusiness(businessId: string, contentHash: string) {
  return `source_${sha256(stableJson({ businessId, contentHash })).slice(7, 31)}`;
}


export function selectBusinessCategories(values: string[], sourceHints: string[] = []) {
  const specific = unique(values.map((value) => clean(value)).filter((value): value is string => Boolean(value)))
    .filter((value) => !/^(?:web ?page|profile ?page|collection ?page|item ?page|web ?site|breadcrumb ?list|thing|creative ?work|professional service|organization|local business)$/i.test(value));
  const hintText = normalizedText(sourceHints.join(" "));
  return unique([
    ...specific,
    ...(specific.some((value) => /pest|exterminat/i.test(value)) || /\b(?:pest control|exterminat(?:or|ion))\b/.test(hintText)
      ? ["Pest Control Service"]
      : [])
  ]).slice(0, 20);
}

export function selectSourceOfferingFacts(
  crawl: CrawlAssessment,
  ingestion: WebsiteGenerationIngestion,
  serviceAreaLabels: string[] = verifiedServiceAreas(crawl, ingestion).map((area) => area.label)
) {
  const serviceAreaIdentities = unique(serviceAreaLabels.flatMap((label) => [
    normalizedText(label),
    serviceAreaIdentity(label)
  ]).filter(Boolean));
  const evidenceClassByUrl = new Map(ingestion.pages.flatMap((page) => [
    [page.url, page.evidenceClass] as const,
    [(page.summary as CrawlPageSummary).url, page.evidenceClass] as const
  ]));
  const candidates = new Map<string, {
    name: string;
    score: number;
    pageUrls: Set<string>;
    evidence: { sourceBlockId?: string; sourceUrl: string; evidenceClass: EvidenceClass };
  }>();
  for (const page of crawl.pageSummaries) {
    const evidenceClass = evidenceClassByUrl.get(page.url) ?? "unknown";
    if (evidenceClass !== "first_party") continue;
    if (classifySourcePagePath(new URL(page.url).pathname) !== "customer_content") continue;
    for (const rawName of page.extractedFacts.services) {
      const name = canonicalOfferingName(clean(rawName), serviceAreaIdentities);
      if (!name || !isPlausibleOfferingName(name)) continue;
      const identity = offeringIdentity(name);
      const supporting = page.sourceTextBlocks.find((block) => normalizedText(block.displayText).includes(normalizedText(name)));
      const purposeScore = page.purposeTags.includes("service_detail")
        ? 5
        : page.purposeTags.includes("services")
          ? 4
          : page.purposeTags.includes("home")
            ? 2
            : page.purposeTags.includes("location")
              ? -4
              : 0;
      const existing = candidates.get(identity);
      if (existing) {
        if (!existing.pageUrls.has(page.url)) existing.score += 1;
        existing.pageUrls.add(page.url);
        if (purposeScore > existing.score) {
          existing.name = name;
          existing.evidence = {
            ...(supporting ? { sourceBlockId: supporting.id } : {}),
            sourceUrl: page.url,
            evidenceClass
          };
        }
        existing.score += purposeScore;
        continue;
      }
      candidates.set(identity, {
        name,
        score: purposeScore + 1,
        pageUrls: new Set([page.url]),
        evidence: {
          ...(supporting ? { sourceBlockId: supporting.id } : {}),
          sourceUrl: page.url,
          evidenceClass
        }
      });
    }
  }
  return [...candidates.values()]
    .filter((candidate) => candidate.score >= 2)
    .sort((left, right) => right.score - left.score || right.pageUrls.size - left.pageUrls.size || left.name.localeCompare(right.name))
    .slice(0, 24)
    .map((candidate) => ({
      name: candidate.name,
      confidence: Math.min(0.9, 0.68 + Math.min(candidate.score, 11) * 0.02),
      evidence: candidate.evidence
    }));
}

function isPlausibleOfferingName(value: string) {
  const normalized = normalizedText(value);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 8 || value.length > 100) return false;
  if (/\b(?:header|footer|slider?|slide|megamenu|option panel|tab content|portfolio|archive|category|infosurgepest|faq|blog|cost|price|pricing|online|20\d{2})\b/.test(normalized)) return false;
  if (/^(?:areas?|explore|more frequent|start consultation|get your quote|consultations?|residential|commercial)$/i.test(value)) return false;
  if (/\b(?:family owned|locally owned|local and loved|environmentally friendly|safe for pets?|response times?|treatment around|foundation)\b/.test(normalized)) return false;
  return !/\b(?:artificial grass|gardening|hardscaping|landscaping|lawn care|lawn fertilization|tree surgery|waste removal|softscaping|mulching|lawn maintenance|plant health|gardens? and ponds|pruning|lawn aeration|hvac)\b/.test(normalized);
}

function canonicalOfferingName(value: string | undefined, serviceAreaIdentities: string[]) {
  if (!value) return undefined;
  let normalized = normalizedText(value).replace(/^(?:your|our)\s+/, "").trim();
  if (/\b(?:cost|price|pricing|online|20\d{2})\b/.test(normalized)) return undefined;
  const sortedAreas = [...serviceAreaIdentities].sort((left, right) => right.length - left.length);
  for (const area of sortedAreas) {
    const escaped = escapeRegExp(area);
    normalized = normalized
      .replace(new RegExp(`^(?:${escaped})(?:\\s+(?:nc|tx|fl|ga|va))?\\s+`, "i"), "")
      .replace(new RegExp(`\\s+(?:in\\s+)?(?:${escaped})(?:\\s+(?:nc|tx|fl|ga|va))?$`, "i"), "")
      .trim();
  }
  normalized = normalized.replace(/\s+(?:nc|tx|fl|ga|va)$/i, "").trim();
  if (!normalized) return undefined;
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function offeringIdentity(value: string) {
  return normalizedText(value)
    .replace(/\b(?:services?|exterminator|extermination|treatment)\b/g, "control")
    .replace(/\b(?:pests?|bugs?)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourcePreparationDiagnosticsFor(
  crawl: CrawlAssessment,
  ingestion: WebsiteGenerationIngestion
): SourcePreparationDiagnostics {
  const evidenceClassByUrl = new Map(ingestion.pages.flatMap((page) => [
    [page.url, page.evidenceClass] as const,
    [(page.summary as CrawlPageSummary).url, page.evidenceClass] as const
  ]));
  const facts: SourcePreparationFactDiagnostic[] = [];
  const acceptedServiceAreas = new Map(
    verifiedServiceAreas(crawl, ingestion).map((item) => [serviceAreaIdentity(item.label), item.label])
  );
  const serviceAreaOccurrences = new Map<string, number>();
  for (const page of crawl.pageSummaries) {
    for (const rawValue of page.extractedFacts.serviceAreas) {
      const value = clean(rawValue) ?? rawValue;
      const identity = serviceAreaIdentity(value);
      const occurrence = (serviceAreaOccurrences.get(identity) ?? 0) + 1;
      serviceAreaOccurrences.set(identity, occurrence);
      const evidenceClass = evidenceClassByUrl.get(page.url) ?? "unknown";
      const supporting = page.sourceTextBlocks.find((block) =>
        normalizedText(block.displayText).includes(identity)
      );
      const accepted = acceptedServiceAreas.has(identity);
      const disposition = accepted && occurrence === 1
        ? "accepted" as const
        : accepted
          ? "deduplication" as const
          : evidenceClass !== "first_party"
            ? "changed_public_eligibility" as const
            : !isExplicitNamedServiceArea(value)
              || !serviceAreaHasGeographicEvidence(value, page, supporting?.displayText)
              ? "invalid_value_filtering" as const
              : "unexplained_loss" as const;
      facts.push({
        kind: "service_area",
        value,
        disposition,
        reason: disposition === "accepted"
          ? "A unique, named market had first-party geographic evidence."
          : disposition === "deduplication"
            ? "The same normalized market was already retained."
            : disposition === "changed_public_eligibility"
              ? "The candidate lacked first-party publication eligibility."
              : disposition === "invalid_value_filtering"
                ? "The candidate was generic, audience-like, composite, or lacked geographic service-area evidence."
                : "The candidate was not retained and no deterministic exclusion rule explained the loss.",
        sourceUrls: [page.url],
        evidenceClasses: [evidenceClass]
      });
    }
  }

  const hoursByValue = new Map<string, { value: Record<string, string>; urls: Set<string>; classes: Set<EvidenceClass> }>();
  for (const page of crawl.pageSummaries) {
    const hours = page.extractedFacts.hours;
    if (!hours || !Object.keys(hours).length) continue;
    const identity = stableJson(hours);
    const candidate = hoursByValue.get(identity) ?? {
      value: hours,
      urls: new Set<string>(),
      classes: new Set<EvidenceClass>()
    };
    candidate.urls.add(page.url);
    candidate.classes.add(evidenceClassByUrl.get(page.url) ?? "unknown");
    hoursByValue.set(identity, candidate);
  }
  const acceptedHoursIdentity = crawl.extractedFacts.hours
    ? stableJson(crawl.extractedFacts.hours)
    : undefined;
  const visibleHourSignals = new Set(crawl.pageSummaries.flatMap((page) =>
    page.sourceTextBlocks.flatMap((block) => {
      const matches = block.displayText.match(/\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b[^\n]{0,80}\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi);
      return (matches ?? []).map(normalizedText);
    })
  ));
  for (const [identity, candidate] of hoursByValue) {
    const accepted = identity === acceptedHoursIdentity;
    const conflicting = hoursByValue.size > 1 || visibleHourSignals.size > 1;
    const eligible = candidate.classes.has("first_party");
    const disposition = accepted
      ? "accepted" as const
      : !eligible
        ? "changed_public_eligibility" as const
        : conflicting
          ? "conflict_suppression" as const
          : "unexplained_loss" as const;
    facts.push({
      kind: "hours",
      value: candidate.value,
      disposition,
      reason: disposition === "accepted"
        ? "One publish-eligible hours value survived consensus."
        : disposition === "changed_public_eligibility"
          ? "The candidate lacked first-party publication eligibility."
          : disposition === "conflict_suppression"
            ? "Distinct extracted or visible hours signals prevented a single reliable value."
            : "The candidate was not retained and no conflict or eligibility rule explained the loss.",
      sourceUrls: [...candidate.urls].sort(),
      evidenceClasses: [...candidate.classes].sort()
    });
  }
  return { schemaVersion: 1, facts };
}

function verifiedServiceAreas(crawl: CrawlAssessment, ingestion: WebsiteGenerationIngestion) {
  const evidenceClassByUrl = new Map(ingestion.pages.flatMap((page) => [
    [page.url, page.evidenceClass] as const,
    [(page.summary as CrawlPageSummary).url, page.evidenceClass] as const
  ]));
  const candidates = new Map<string, {
    label: string;
    evidence: { sourceBlockId?: string; sourceUrl: string; evidenceClass: EvidenceClass };
    pageUrls: Set<string>;
  }>();
  for (const page of crawl.pageSummaries) {
    for (const rawLabel of page.extractedFacts.serviceAreas) {
      const label = normalizeServiceAreaCandidate(clean(rawLabel));
      if (!label || !isExplicitNamedServiceArea(label)) continue;
      const identity = serviceAreaIdentity(label);
      const supporting = page.sourceTextBlocks.find((block) => normalizedText(block.displayText).includes(identity));
      if (!serviceAreaHasGeographicEvidence(label, page, supporting?.displayText)) continue;
      const evidenceClass = evidenceClassByUrl.get(page.url) ?? "first_party";
      if (evidenceClass !== "first_party") continue;
      const existing = candidates.get(identity);
      if (existing) {
        existing.pageUrls.add(page.url);
        if (serviceAreaSpecificity(label) > serviceAreaSpecificity(existing.label)) {
          existing.label = label;
          existing.evidence = {
            ...(supporting ? { sourceBlockId: supporting.id, sourceUrl: supporting.sourceUrl } : { sourceUrl: page.url }),
            evidenceClass
          };
        }
        continue;
      }
      candidates.set(identity, {
        label,
        evidence: {
          ...(supporting ? { sourceBlockId: supporting.id, sourceUrl: supporting.sourceUrl } : { sourceUrl: page.url }),
          evidenceClass
        },
        pageUrls: new Set([page.url])
      });
    }
  }
  return [...candidates.values()]
    .sort((left, right) => right.pageUrls.size - left.pageUrls.size || left.label.localeCompare(right.label))
    .map(({ label, evidence }) => ({ label, evidence }));
}

export function isExplicitNamedServiceArea(value: string) {
  const normalized = normalizedText(value);
  const words = normalized.split(" ").filter(Boolean);
  return normalized.length >= 2
    && normalized.length <= 100
    && words.length <= 5
    && !/\d|[:;!?]/.test(value)
    && /(?:^|[\s-])[A-Z][A-Za-z'-]*/.test(value)
    && !/\b(?:surrounding|greater|metro(?:politan)?|radius|miles?|nearby)\b/.test(normalized)
    && !/\b(?:homeowners?|customers?|clients?|residents?|restaurants?|businesses?|properties|communities|families|people|you|your|our|we|team|technicians?|including|anthem|climate|challenges?|solutions?|response|times?|insight|concerns?|activity|provides?|bring|understand|common|unique|housing|precise|fast|local|reviews?|reviewers?|apartments?|offices?|pets?|environment|more|include|microhab|corridors?|every|days?|across|not|bugs?|ants?|termites?|mosquitoes?|rodents?|cockroaches?)\b/.test(normalized)
    && !/&|\band\b/.test(normalized)
    && (!value.includes(",") || /,\s*[A-Z]{2}\s*$/i.test(value))
    && !/^(?:united states|usa|nationwide|everywhere|local area|surrounding areas?)$/.test(normalized);
}

export function normalizeServiceAreaCandidate(value: string | undefined) {
  if (!value) return undefined;
  const stripped = value
    .replace(/^\s*(?:(?:serving|throughout|across|near|in)\s+(?:the\s+)?|(?:all|rest)\s+of\s+(?:the\s+)?|(?:entire|wider)\s+)/i, "")
    .trim();
  return isExplicitNamedServiceArea(stripped) ? stripped : undefined;
}

function serviceAreaIdentity(value: string) {
  return normalizedText(value)
    .replace(/\s+(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)$/, "")
    .trim();
}

function serviceAreaSpecificity(value: string) {
  return /(?:,\s*|\s)[A-Z]{2}\s*$/i.test(value) ? 2 : 1;
}

function serviceAreaHasGeographicEvidence(
  label: string,
  page: CrawlPageSummary,
  supportingText?: string
) {
  if (/(?:,\s*|\s)[A-Z]{2}\s*$/i.test(label)) return true;
  const identity = serviceAreaIdentity(label);
  const path = new URL(page.url).pathname.toLocaleLowerCase();
  const slug = identity.replace(/[^a-z0-9]+/g, "-");
  if (new RegExp(`/(?:locations?|service-areas?)/${escapeRegExp(slug)}(?:-|/|$)`).test(path)) return true;
  const context = normalizedText(supportingText ?? "");
  return Boolean(context)
    && context.includes(identity)
    && /\b(?:service areas?|areas? we serve|we (?:proudly )?serve|serving)\b/.test(context);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function observedProof(
  crawl: CrawlAssessment,
  sourceSnapshotId: string,
  facts: BusinessFact[],
  now: string
): BusinessState["proof"] {
  const testimonialCandidates = crawl.pageSummaries
    .filter((page) => page.purposeTags.includes("reviews"))
    .flatMap((page) => page.sourceTextBlocks)
    .filter((block) => /^(?:blockquote|figcaption|li|p)(?:[#.:]|$)/.test(block.containerId))
    .filter((block) => canonicalWordCount(block.displayText) >= 6 && block.displayText.length >= 30 && block.displayText.length <= 240)
    .slice(0, 8);
  const testimonials = testimonialCandidates.map((block, index) => {
    const factId = `fact_proof_${index + 1}_${sha256(block.displayText).slice(7, 17)}`;
    facts.push({
      id: factId,
      kind: "proof",
      label: "Observed testimonial",
      value: block.displayText,
      source: {
        factId,
        sourceSnapshotId,
        sourceBlockId: block.id,
        sourceUrl: block.sourceUrl,
        evidenceClass: "third_party",
        observedAt: now,
        confidence: 0.65,
        ownerConfirmed: false
      },
      publicEligible: false
    });
    return {
      id: `proof_${index + 1}`,
      kind: "testimonial" as const,
      status: "observed" as const,
      publicText: block.displayText,
      verbatim: true,
      sourceFactIds: [factId]
    };
  });

  const warranties = selectObservedFirstPartyWarrantyBlocks(crawl.pageSummaries, crawl.url).map((block) => {
    const suffix = sha256(`${block.sourceUrl}\n${block.displayText}`).slice(7, 19);
    const factId = `fact_proof_warranty_${suffix}`;
    facts.push({
      id: factId,
      kind: "proof",
      label: "Observed service guarantee",
      value: block.displayText,
      source: {
        factId,
        sourceSnapshotId,
        sourceBlockId: block.id,
        sourceUrl: block.sourceUrl,
        evidenceClass: "first_party",
        observedAt: now,
        confidence: 0.88,
        ownerConfirmed: false
      },
      publicEligible: false
    });
    return {
      id: `proof_warranty_${suffix}`,
      kind: "warranty" as const,
      status: "observed" as const,
      publicText: block.displayText,
      verbatim: true,
      sourceFactIds: [factId]
    };
  });

  return [...testimonials, ...warranties];
}

const freeReturnServicePattern = /\b(?:re[-\s]?(?:treat|service)|come back|we(?:'|’)ll return)\b.{0,180}\b(?:free of charge|at no (?:additional|extra) cost|at no additional charge|for free)\b/i;
const guaranteedReturnServicePattern = /\bguarantee\b.{0,220}\b(?:re[-\s]?(?:treat|service)|come back|return)\b/i;

export function selectObservedFirstPartyWarrantyBlocks(
  pages: Array<Pick<CrawlPageSummary, "url" | "sourceTextBlocks">>,
  sourceUrl: string
): SourceTextBlock[] {
  const sourceOrigin = new URL(sourceUrl).origin;
  const seen = new Set<string>();
  return pages
    .filter((page) => {
      try {
        return new URL(page.url).origin === sourceOrigin;
      } catch {
        return false;
      }
    })
    .flatMap((page) => page.sourceTextBlocks)
    .filter((block) => /^(?:blockquote|dd|div|figcaption|li|p)(?:[#.:]|$)/.test(block.containerId))
    .filter((block) => canonicalWordCount(block.displayText) >= 8 && block.displayText.length >= 40 && block.displayText.length <= 600)
    .filter((block) => freeReturnServicePattern.test(block.displayText) || guaranteedReturnServicePattern.test(block.displayText))
    .filter((block) => {
      const identity = block.displayText.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, 4);
}

export function selectSourceLinksForGeneration(sourceUrl: string, crawl: CrawlAssessment) {
  const socialProfile = crawl.extractedFacts.socialLinks.find(isAccountLevelSocialProfile);
  const customerPortalLinks = uniqueBy(crawl.pageSummaries
    .flatMap((page) => page.linkReferences)
    .filter((link) => isCustomerPortalLink(link.href, link.text))
    .map((link) => ({ kind: "other" as const, label: "Customer Login", url: link.href })), (item) => item.url);
  const values = [
    { kind: "website" as const, label: "Source website", url: sourceUrl },
    ...(socialProfile ? [{ kind: "social" as const, label: "Social profile", url: socialProfile }] : []),
    ...crawl.extractedFacts.bookingLinks.map((url) => ({ kind: "booking" as const, label: "Booking", url })),
    ...customerPortalLinks
  ];
  return uniqueBy(values.filter((item) => safeHttpUrl(item.url)), (item) => item.url).slice(0, 20);
}

export function sourcePageForFunctionalLink(crawl: CrawlAssessment, destinationUrl: string) {
  return crawl.pageSummaries.find((page) => page.linkReferences.some((link) => link.href === destinationUrl))?.url;
}

export function assertSourceSuitableForGeneration(
  crawl: CrawlAssessment,
  ingestion: WebsiteGenerationIngestion
) {
  const firstPartyUrls = new Set(ingestion.pages
    .filter((page) => page.evidenceClass === "first_party")
    .flatMap((page) => [page.url, (page.summary as CrawlPageSummary).url]));
  const firstPartyText = crawl.pageSummaries
    .filter((page) => firstPartyUrls.has(page.url))
    .flatMap((page) => [page.title ?? "", page.metaDescription ?? "", ...page.sourceTextBlocks.map((block) => block.displayText)])
    .join("\n");
  const closed = /\b(?:permanently closed|temporarily closed until further notice|no longer (?:open|operating|in business)|ceased operations|closed (?:our|its) doors|business has closed|location is permanently closed)\b/i.test(firstPartyText);
  const parked = /\b(?:this domain is for sale|buy this domain|domain may be for sale|website is coming soon)\b/i.test(firstPartyText);
  const contradictory = hasContradictoryFirstPartyLocationHours(crawl, firstPartyUrls);
  if (closed || parked || contradictory) {
    throw new WebsiteCrawlError(
      "source_unsuitable",
      closed
        ? "The first-party source indicates that the business or location is closed."
        : parked
          ? "The supplied address is a parked or placeholder website rather than an active first-party business source."
          : "The first-party source gives contradictory hours for the same named street address."
    );
  }
}

export function hasContradictoryFirstPartyLocationHours(
  crawl: CrawlAssessment,
  firstPartyUrls = new Set(crawl.pageSummaries.map((page) => page.url))
) {
  const hoursByAddress = new Map<string, Set<string>>();
  for (const page of crawl.pageSummaries) {
    if (!firstPartyUrls.has(page.url)) continue;
    const address = normalizedText(formatAddress(page.extractedFacts.address) ?? "");
    const hours = page.extractedFacts.hours;
    if (!address || !hours || !Object.keys(hours).length) continue;
    const signature = stableJson(Object.fromEntries(
      Object.entries(hours)
        .map(([day, value]) => [normalizedText(day), normalizedText(value)] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    ));
    const values = hoursByAddress.get(address) ?? new Set<string>();
    values.add(signature);
    hoursByAddress.set(address, values);
  }
  return [...hoursByAddress.values()].some((values) => values.size > 1);
}

function isAccountLevelSocialProfile(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    if (/\b(?:posts?|status|reels?|videos?|shorts?|watch|stories|photos?)\b/i.test(path)) return false;
    if (host === "instagram.com") return /^\/[a-zA-Z0-9._-]+$/.test(path);
    if (host === "facebook.com" || host === "fb.com") return /^\/[a-zA-Z0-9._-]+$/.test(path);
    if (host === "x.com" || host === "twitter.com" || host === "tiktok.com") return /^\/@?[a-zA-Z0-9._-]+$/.test(path);
    if (host === "linkedin.com") return /^\/(?:company|in)\/[a-zA-Z0-9._-]+$/.test(path);
    if (host === "youtube.com") return /^\/(?:@|channel\/|c\/|user\/)[a-zA-Z0-9._-]+$/.test(path);
    return path.length > 1;
  } catch {
    return false;
  }
}

export function selectSupportingSourceBlock(
  blocks: SourceTextBlock[],
  value: string,
  evidenceClassByUrl: ReadonlyMap<string, EvidenceClass> = new Map()
) {
  const target = normalizedText(value);
  if (target.length < 3) return undefined;
  const matches = blocks.filter((block) => {
    const text = normalizedText(block.displayText);
    return text.includes(target) || target.includes(text);
  });
  const rank = (block: SourceTextBlock) => {
    const evidenceClass = evidenceClassByUrl.get(block.sourceUrl) ?? "unknown";
    return evidenceClass === "first_party" ? 0 : evidenceClass === "unknown" ? 1 : 2;
  };
  return matches.sort((left, right) => rank(left) - rank(right))[0];
}

export function retainedContactConsensus(
  documents: Array<{ url: string; extractedText: string }>
) {
  const phone = rankedDocumentConsensus(documents, (text) =>
    [...text.matchAll(/(?:\+?1[\s.(\-]*)?(?:\d{3}|\(\d{3}\))[\s.)\-]*\d{3}[\s.\-]*\d{4}\b/g)]
      .map((match) => normalizedUsPhone(match[0]))
      .filter((value): value is string => Boolean(value)));
  const email = rankedDocumentConsensus(documents, (text) =>
    [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
      .map((match) => match[0].toLowerCase())
      .filter((value) => !/^(?:no-?reply|donotreply)@/i.test(value))
      .filter((value) => !/@(?:example\.(?:com|org|net)|localhost)$/i.test(value)));
  return { phone, email };
}

function rankedDocumentConsensus(
  documents: Array<{ url: string; extractedText: string }>,
  candidatesFor: (text: string) => string[]
) {
  const support = new Map<string, Set<string>>();
  for (const document of documents) {
    for (const candidate of new Set(candidatesFor(document.extractedText))) {
      support.set(candidate, new Set([...(support.get(candidate) ?? []), document.url]));
    }
  }
  const ranked = [...support.entries()].sort(([leftValue, leftUrls], [rightValue, rightUrls]) =>
    rightUrls.size - leftUrls.size || leftValue.localeCompare(rightValue));
  const winner = ranked[0];
  if (!winner || winner[1].size < 2) return undefined;
  if (ranked[1] && winner[1].size <= ranked[1][1].size) return undefined;
  return winner[0];
}

function normalizedUsPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

function formatAddress(address: ExtractedBusinessFacts["address"]) {
  if (!address) return undefined;
  const value = [address.street, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ");
  return value || undefined;
}

function displayValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  return stableJson(value);
}

function sameValue(left: unknown, right: unknown) {
  if (left === undefined || left === null || left === "" || right === undefined || right === null || right === "") return false;
  return normalizedText(displayValue(left)) === normalizedText(displayValue(right));
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;
}

function normalizeCountryCode(value: unknown) {
  const normalized = clean(value)?.toUpperCase().replace(/[^A-Z]+/g, " ");
  if (!normalized || ["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(normalized)) return "US";
  if (["CA", "CANADA"].includes(normalized)) return "CA";
  if (["MX", "MEXICO"].includes(normalized)) return "MX";
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  throw new Error(`Unsupported country value ${JSON.stringify(value)}.`);
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeSlug(value: string) {
  return normalizedText(value).replace(/\s+/g, "-").slice(0, 100) || "business";
}

function hostnameBusinessName(sourceUrl: string) {
  const hostname = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const label = hostname.split(".")[0] ?? "business";
  return label
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim() || "Business";
}

function canonicalWordCount(value: string) {
  return value.normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function idPart(value: string) {
  return value.replace(/-/g, "").slice(0, 24);
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.map(clean).filter((value): value is string => Boolean(value)))];
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
