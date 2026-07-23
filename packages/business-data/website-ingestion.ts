import { randomUUID } from "node:crypto";
import { preferBusinessNameCandidate } from "@/lib/business-fact-normalization";
import { type CrawlAssessment, type CrawlPageSummary, type ExtractedBusinessFacts } from "@/lib/crawler";
import { gatherPublicPresenceSignals, type PublicPresenceEnrichment } from "@/packages/acquisition/public-presence";
import { assertPublicFetchUrl } from "@/lib/url-safety";
import type { SourceTextBlock } from "@/lib/source-text-blocks";
import {
  assetRevisionSchema,
  businessStateSchema,
  formDefinitionSchema,
  platformSiteRecordSchema,
  siteIntentSchema,
  sourceSnapshotSchema,
  type AssetRevisionRef,
  type AssetRevision,
  type BusinessOffering,
  type BusinessState,
  type FormDefinition,
  type PlatformSiteRecord,
  type BusinessFact,
  type SiteIntent,
  type SourceSnapshot,
  type VerticalContextModule
} from "@/packages/site-contracts";
import { matchVerticalContext } from "@/packages/vertical-context";
import { sha256, stableJson } from "./hash";
import { crawlWebsiteForGeneration, type EvidenceClass, type WebsiteGenerationIngestion } from "./generation-crawler";
import { understandWebsite } from "./understanding";
import { canonicalOfferingCandidates, type CanonicalOfferingCandidate } from "./offering-normalization";

export type RetainedAssetBinary = {
  revision: AssetRevision;
  bytes: Buffer;
};

export type WebsiteIngestionResult = {
  site: PlatformSiteRecord;
  state: BusinessState;
  intent: SiteIntent;
  forms: FormDefinition[];
  sourceSnapshots: SourceSnapshot[];
  retainedAssets: RetainedAssetBinary[];
  sourceUrl: string;
  crawl: CrawlAssessment;
  generationIngestion: WebsiteGenerationIngestion;
  validationEligibility: "frozen_validation" | "private_review_only";
  domainContext?: VerticalContextModule;
};

export class WebsiteCrawlError extends Error {
  readonly code = "website_crawl_failed";
  constructor(message: string, readonly replacementEligible = false) {
    super(message);
  }
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
    throw new WebsiteCrawlError(error instanceof Error ? error.message : String(error), true);
  }
  const now = input.now ?? new Date().toISOString();
  const siteId = input.siteId ?? `site_${idPart(randomUUID())}`;
  const businessId = input.businessId ?? `business_${idPart(randomUUID())}`;
  const { ingestion: generationIngestion, crawl } = await crawlWebsiteForGeneration({ url: sourceUrl, signal: input.signal });
  if (!crawl.fetched) throw new WebsiteCrawlError(crawl.error ?? "The source website could not be crawled.", true);

  const presence = await gatherPublicPresenceSignals({ url: sourceUrl, crawl });
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for production website ingestion; deterministic understanding is test-only.");
  }
  const understanding = await understandWebsite({
    sourceUrl,
    ingestion: generationIngestion,
    publicPresence: presence,
    signal: input.signal
  });

  const facts = mergeFacts(crawl.extractedFacts, presence, sourceUrl);
  const domainContext = resolveDomainContext(crawl.extractedFacts);
  const crawlName = clean(crawl.extractedFacts.name) ?? clean(crawl.title)?.replace(/\s*[|\-–].*$/, "").trim();
  const understoodName = clean(understanding.businessName.value);
  const sourceBackedName = preferBusinessNameCandidate(crawlName, understoodName, new URL(sourceUrl).hostname);
  const name = clean(sourceBackedName) ?? clean(facts.name);
  if (!name) throw new Error("The source website did not expose a business name.");
  const sourceContentHash = sha256(stableJson({ generationIngestion, crawl }));
  const sourceSnapshotId = sourceSnapshotIdForBusiness(businessId, sourceContentHash);
  const sourceSnapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: sourceSnapshotId,
    businessId,
    sourceType: "website",
    sourceUrl,
    contentHash: sourceContentHash,
    capturedAt: now,
    payload: {
      ingestion: generationIngestion,
      publicPresence: presence,
      understanding
    }
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
    evidence?: { sourceBlockId: string; sourceUrl: string; evidenceClass: EvidenceClass }
  ) => {
    if (value === undefined || value === null || value === "") return undefined;
    const text = displayValue(value);
    const id = `fact_${kind}_${sha256(text).slice(7, 19)}`;
    const block = evidence
      ? blockIndex.find((candidate) => candidate.id === evidence.sourceBlockId && candidate.sourceUrl === evidence.sourceUrl)
      : supportingBlock(blockIndex, text);
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
        ...(block ? { sourceBlockId: block.id, sourceUrl: block.sourceUrl } : publicEligible ? { sourceUrl } : {}),
        evidenceClass,
        observedAt: now,
        confidence,
        ownerConfirmed: false
      },
      publicEligible: automaticallyEligible
    });
    return id;
  };

  const understoodNameEvidence = sameValue(name, understoodName)
    ? understanding.businessName.evidence.find((reference) => reference.evidenceClass === "first_party")
    : undefined;
  const nameFactId = addFact("business_name", "Business name", name, 0.9, sameValue(name, crawlName) || Boolean(understoodNameEvidence), understoodNameEvidence)!;
  addFact("description", "Business description", clean(facts.description), 0.7, sameValue(facts.description, crawl.extractedFacts.description));
  const phoneFactId = addFact("phone", "Phone", clean(facts.phone), 0.82, sameValue(facts.phone, crawl.extractedFacts.phone));
  addFact("email", "Email", clean(facts.email), 0.78, sameValue(facts.email, crawl.extractedFacts.email));
  const addressText = formatAddress(facts.address);
  const addressFactId = addFact("address", "Address", addressText, 0.8, sameValue(addressText, formatAddress(crawl.extractedFacts.address)));
  const hoursFactId = addFact(
    "hours",
    "Hours",
    facts.hours && Object.keys(facts.hours).length ? facts.hours : undefined,
    0.75,
    sameValue(facts.hours, crawl.extractedFacts.hours)
  );

  const serviceNames = unique([
    ...understanding.cleanedServices.filter((service) => service.evidence.some((reference) => reference.evidenceClass === "first_party")).map((service) => service.value),
    ...facts.services
  ]).filter((service) => serviceIsSourceBacked(service, crawl)).slice(0, 24);
  const offerings = canonicalOfferingCandidates(serviceNames, domainContext)
    .slice(0, 24)
    .map((service, index) => offeringFromService(service, index, addFact));
  const eligibleAddress = addressFactId ? publicFacts.some((fact) => fact.id === addressFactId && fact.publicEligible) : false;
  const crawlServiceAreas = unique(crawl.extractedFacts.serviceAreas);
  const modelLocationFallback = !eligibleAddress && !crawlServiceAreas.length ? understanding.locationOrServiceArea : undefined;
  const observedServiceAreas = unique([...crawlServiceAreas, ...(modelLocationFallback ? [modelLocationFallback.value] : [])]);
  const serviceAreas = observedServiceAreas.slice(0, 50).map((label, index) => {
    const reference = modelLocationFallback && label === modelLocationFallback.value
      ? modelLocationFallback.evidence.find((candidate) => candidate.evidenceClass === "first_party")
      : undefined;
    const factId = addFact("service_area", "Service area", label, 0.7, true, reference)!;
    return { id: `service_area_${index + 1}`, label, sourceFactIds: [factId] };
  });

  const retainedAssets = await retainReferenceAssets({
    businessId,
    crawl,
    sourceSnapshotId,
    now,
    signal: input.signal
  });
  const assets: AssetRevisionRef[] = retainedAssets.map(({ revision }, index) => ({
    assetId: revision.assetId,
    revisionId: revision.id,
    kind: index === 0 && crawl.assetReferences.find((candidate) => candidate.url === revision.provenance?.sourceUrl)?.kind === "logo" ? "logo" : "photo",
    contentHash: revision.contentHash,
    storageKey: revision.storageKey,
    mimeType: revision.mimeType,
    alt: String(revision.provenance?.alt ?? `${name} source photograph`),
    width: revision.width,
    height: revision.height,
    rightsStatus: "reference_only",
    sourceFactIds: [nameFactId],
    activeForFutureBuilds: true
  }));

  const links = safeSourceLinks(sourceUrl, crawl).map((link, index) => {
    const factId = addFact("link", link.label, link.url, 0.75)!;
    return { id: `link_${index + 1}`, ...link, publicEligible: true, sourceFactIds: [factId] };
  });
  const locationSourceIds = [addressFactId, hoursFactId].filter((value): value is string => Boolean(value));
  const placeId = presence?.signals.find((signal) => signal.placeId)?.placeId;
  const locations = facts.address || facts.hours || facts.geo || placeId ? [{
    id: "location_primary",
    label: "Main shop",
    street: clean(facts.address?.street),
    city: clean(facts.address?.city),
    region: clean(facts.address?.region),
    postalCode: clean(facts.address?.postalCode),
    country: clean(facts.address?.country)?.slice(0, 2).toUpperCase() || "US",
    latitude: facts.geo?.latitude,
    longitude: facts.geo?.longitude,
    googlePlaceId: placeId,
    hours: facts.hours,
    sourceFactIds: locationSourceIds
  }] : [];

  const stateWithoutHash = {
    schemaVersion: 1 as const,
    businessId,
    siteId,
    revision: 1,
    updatedAt: now,
    identity: {
      name,
      description: clean(facts.description),
      categories: unique([understanding.observedCategory.value, preferredBusinessTerm(domainContext), ...facts.categories]).slice(0, 20)
    },
    contacts: { phone: clean(facts.phone), email: clean(facts.email) },
    locations,
    serviceAreas,
    offerings,
    proof: observedProof(crawl, sourceSnapshotId, publicFacts, now),
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
    revision: 1,
    name: "Estimate request",
    status: "candidate_only",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "phone", label: "Phone", type: "phone", required: true },
      { id: "email", label: "Email", type: "email", required: false },
      { id: "message", label: `How can this ${preferredBusinessTerm(domainContext)} help?`, type: "textarea", required: false }
    ],
    submitLabel: "Request an estimate",
    successMessage: "Thanks. The business will follow up soon.",
    createdAt: now
  });
  const pageRequirements = [
    { id: "page_home", purpose: "home" as const, slug: "", title: "Home", required: true },
    ...offerings.filter((offering) => offering.pageMode === "dedicated").slice(0, 6).map((offering) => ({
      id: `page_${offering.id}`,
      purpose: "service" as const,
      slug: `services/${safeSlug(offering.name)}`,
      title: offering.name,
      required: false,
      offeringId: offering.id
    })),
    { id: "page_contact", purpose: "contact" as const, slug: "contact", title: "Contact", required: true }
  ];
  const intentWithoutHash = {
    schemaVersion: 1 as const,
    id: `intent_${idPart(randomUUID())}`,
    siteId,
    revision: 1,
    updatedAt: now,
    audience: domainContext?.customerJourneys[0],
    positioning: understanding.businessStory?.summary ?? clean(facts.description),
    voice: unique([understanding.brandExpression.voiceRegister, "clear", "capable"]).filter(Boolean) as string[],
    primaryConversion: conversionGoal(understanding.primaryConversion.goal),
    pageRequirements,
    brandConstraints: {
      preferredColors: [],
      prohibitedColors: [],
      preserveLogo: true,
      notes: []
    },
    enabledCapabilities: ["forms", "analytics", "maps", "gallery", "disclosure"] as const,
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
  void phoneFactId;
  const minimumKnowledgeFailures = [
    !state.identity.name ? "business_name" : undefined,
    !state.offerings.length && !state.identity.categories.length ? "offering_or_category" : undefined,
    !understanding.primaryConversion ? "conversion_path" : undefined,
    !state.serviceAreas.some((area) => area.sourceFactIds.some((factId) => state.facts.some((fact) => fact.id === factId && fact.publicEligible)))
      && !state.locations.some((location) => location.sourceFactIds.some((factId) => state.facts.some((fact) => fact.id === factId && fact.publicEligible)))
      ? "location_or_service_area" : undefined
  ].filter(Boolean);
  if (minimumKnowledgeFailures.length) {
    throw new WebsiteCrawlError(`Minimum business knowledge was not established: ${minimumKnowledgeFailures.join(", ")}.`);
  }
  return {
    site,
    state,
    intent,
    forms: [form],
    sourceSnapshots: [sourceSnapshot],
    retainedAssets,
    sourceUrl,
    crawl,
    generationIngestion,
    validationEligibility: generationIngestion.coverage === "incomplete" ? "private_review_only" : "frozen_validation",
    domainContext
  };
}

async function retainReferenceAssets(input: {
  businessId: string;
  crawl: CrawlAssessment;
  sourceSnapshotId: string;
  now: string;
  signal?: AbortSignal;
}) {
  const candidates = uniqueBy(input.crawl.assetReferences, (asset) => asset.url).slice(0, 8);
  const results: RetainedAssetBinary[] = [];
  for (const [index, candidate] of candidates.entries()) {
    try {
      const url = await assertPublicFetchUrl(candidate.url);
      const response = await fetch(url, { signal: combinedSignal(input.signal, 10_000) });
      if (!response.ok) continue;
      const mimeType = normalizedImageMime(response.headers.get("content-type"));
      if (!mimeType) continue;
      const declaredBytes = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredBytes) && declaredBytes > 8_000_000) continue;
      const bytes = await readBodyWithLimit(response, 8_000_000);
      if (!bytes?.length) continue;
      const contentHash = sha256(bytes);
      const scopedAssetHash = sha256(stableJson({ businessId: input.businessId, contentHash }));
      const assetId = `asset_source_${index + 1}_${scopedAssetHash.slice(7, 17)}`;
      const revision = assetRevisionSchema.parse({
        schemaVersion: 1,
        id: assetRevisionIdForBusiness(input.businessId, contentHash),
        assetId,
        businessId: input.businessId,
        contentHash,
        storageKey: `site-assets/${input.businessId}/${contentHash.slice(7)}`,
        mimeType,
        bytes: bytes.length,
        provenance: {
          source: "website_reference",
          sourceUrl: url,
          sourceSnapshotId: input.sourceSnapshotId,
          alt: candidate.alt ?? "Source business image"
        },
        rightsStatus: "reference_only",
        createdAt: input.now
      });
      results.push({ revision, bytes });
    } catch {
      // Individual media failures do not invalidate otherwise usable business evidence.
    }
  }
  return deduplicateRetainedAssets(results);
}

export function deduplicateRetainedAssets(assets: RetainedAssetBinary[]) {
  const retained = new Map<string, RetainedAssetBinary>();
  for (const asset of assets) {
    const existing = retained.get(asset.revision.id);
    if (!existing) {
      retained.set(asset.revision.id, asset);
      continue;
    }
    if (
      existing.revision.businessId !== asset.revision.businessId ||
      existing.revision.contentHash !== asset.revision.contentHash
    ) {
      throw new Error(`Immutable asset revision collision for ${asset.revision.id}.`);
    }
  }
  return [...retained.values()];
}

export function sourceSnapshotIdForBusiness(businessId: string, contentHash: string) {
  return `source_${sha256(stableJson({ businessId, contentHash })).slice(7, 31)}`;
}

export function assetRevisionIdForBusiness(businessId: string, contentHash: string) {
  return `asset_revision_${sha256(stableJson({ businessId, contentHash })).slice(7, 31)}`;
}

async function readBodyWithLimit(response: Response, maximumBytes: number) {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel("asset_size_limit");
        return undefined;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

function mergeFacts(crawl: ExtractedBusinessFacts, presence: PublicPresenceEnrichment | undefined, sourceUrl: string): ExtractedBusinessFacts {
  const enriched = presence?.facts ?? {};
  return {
    ...enriched,
    ...crawl,
    name: preferBusinessNameCandidate(crawl.name, enriched.name, new URL(sourceUrl).hostname),
    description: crawl.description ?? enriched.description,
    phone: crawl.phone ?? enriched.phone,
    email: crawl.email ?? enriched.email,
    address: crawl.address ?? enriched.address,
    geo: crawl.geo ?? enriched.geo,
    hours: crawl.hours ?? enriched.hours,
    reviewsSummary: crawl.reviewsSummary ?? enriched.reviewsSummary,
    categories: unique([...(enriched.categories ?? []), ...crawl.categories]),
    services: unique([...(enriched.services ?? []), ...crawl.services]),
    serviceAreas: unique([...(enriched.serviceAreas ?? []), ...crawl.serviceAreas]),
    socialLinks: unique([...(enriched.socialLinks ?? []), ...crawl.socialLinks]),
    bookingLinks: unique([...(enriched.bookingLinks ?? []), ...crawl.bookingLinks]),
    orderingLinks: unique([...(enriched.orderingLinks ?? []), ...crawl.orderingLinks]),
    pressLinks: unique([...(enriched.pressLinks ?? []), ...crawl.pressLinks])
  };
}

function serviceIsSourceBacked(service: string, crawl: CrawlAssessment) {
  const normalized = normalizedText(service);
  const extracted = crawl.extractedFacts.services.some((value) => {
    const candidate = normalizedText(value);
    return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
  });
  return extracted || crawl.pageSummaries.some((page) => page.sourceTextBlocks.some((block) => normalizedText(block.displayText).includes(normalized)));
}

function offeringFromService(
  service: CanonicalOfferingCandidate,
  index: number,
  addFact: (kind: BusinessFact["kind"], label: string, value: unknown, confidence?: number) => string | undefined
): BusinessOffering {
  const factId = addFact("offering", "Service", service.sourceName, 0.72)!;
  return {
    id: `offering_${index + 1}_${safeSlug(service.name).slice(0, 60)}`,
    ...(service.catalogId ? { catalogId: service.catalogId } : { customName: service.name }),
    name: service.name,
    status: "observed",
    visibility: "preview",
    pageMode: index < 6 ? "dedicated" : "shared",
    featured: index < 3,
    sourceFactIds: [factId]
  };
}

function observedProof(
  crawl: CrawlAssessment,
  sourceSnapshotId: string,
  facts: BusinessFact[],
  now: string
): BusinessState["proof"] {
  const candidates = crawl.pageSummaries
    .filter((page) => page.purposeTags.includes("reviews"))
    .flatMap((page) => page.sourceTextBlocks)
    .filter((block) => /^(?:blockquote|figcaption|li|p)(?:[#.:]|$)/.test(block.containerId))
    .filter((block) => block.canonicalTokens.length >= 6 && block.displayText.length >= 30 && block.displayText.length <= 240)
    .slice(0, 8);
  return candidates.map((block, index) => {
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
}

function safeSourceLinks(sourceUrl: string, crawl: CrawlAssessment) {
  const values = [
    { kind: "website" as const, label: "Source website", url: sourceUrl },
    ...crawl.extractedFacts.socialLinks.map((url) => ({ kind: "social" as const, label: "Social profile", url })),
    ...crawl.extractedFacts.bookingLinks.map((url) => ({ kind: "booking" as const, label: "Booking", url }))
  ];
  return uniqueBy(values.filter((item) => safeHttpUrl(item.url)), (item) => item.url).slice(0, 20);
}

function supportingBlock(blocks: SourceTextBlock[], value: string) {
  const target = normalizedText(value);
  if (target.length < 3) return undefined;
  return blocks.find((block) => {
    const text = normalizedText(block.displayText);
    return text.includes(target) || target.includes(text);
  });
}

function resolveDomainContext(facts: ExtractedBusinessFacts) {
  return matchVerticalContext([...facts.categories, ...facts.services, facts.description ?? ""].join(" "));
}

function preferredBusinessTerm(domainContext?: VerticalContextModule) {
  return domainContext?.terminology.business?.[0] ?? "business";
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

function normalizedImageMime(value: string | null): AssetRevision["mimeType"] | undefined {
  const mime = value?.split(";")[0].trim().toLowerCase();
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" ? mime : undefined;
}

function conversionGoal(value: "call_first" | "form_first" | "booking_first" | "visit_first" | undefined) {
  if (value === "call_first") return "call" as const;
  if (value === "booking_first") return "booking" as const;
  if (value === "visit_first") return "visit" as const;
  return "form" as const;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;
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
