import { randomUUID } from "node:crypto";
import { crawlUrl, type CrawlAssessment, type ExtractedBusinessFacts } from "@/lib/crawler";
import { gatherPublicPresenceSignals, type PublicPresenceEnrichment } from "@/lib/public-presence";
import { assertPublicFetchUrl } from "@/lib/url-safety";
import type { SourceTextBlock } from "@/lib/source-text-blocks";
import {
  assetRevisionV1Schema,
  businessStateV2Schema,
  formDefinitionV2Schema,
  platformSiteRecordSchema,
  siteIntentV2Schema,
  sourceSnapshotV1Schema,
  type AssetRevisionRefV1,
  type AssetRevisionV1,
  type BusinessOfferingV2,
  type BusinessStateV2,
  type FormDefinitionV2,
  type PlatformSiteRecord,
  type BusinessFactV2,
  type SiteIntentV2,
  type SourceSnapshotV1,
  type VerticalContextModuleV1
} from "@/packages/site-contracts";
import { listProductionVerticalContexts, resolveProductionVerticalContext } from "@/packages/vertical-context";
import { sha256, stableJson } from "./hash";
import { understandWebsite } from "./understanding";

export type RetainedAssetBinaryV1 = {
  revision: AssetRevisionV1;
  bytes: Buffer;
};

export type WebsiteIngestionResultV1 = {
  site: PlatformSiteRecord;
  state: BusinessStateV2;
  intent: SiteIntentV2;
  forms: FormDefinitionV2[];
  sourceSnapshots: SourceSnapshotV1[];
  retainedAssets: RetainedAssetBinaryV1[];
  sourceUrl: string;
  crawl: CrawlAssessment;
};

export class UnsupportedWebsiteVerticalError extends Error {
  readonly code = "unsupported_vertical";
  constructor(readonly observedVertical: string | undefined) {
    super(`Lodesta V1 does not support ${observedVertical ?? "this unclassified business vertical"}.`);
  }
}

export async function ingestWebsite(input: {
  url: string;
  slug?: string;
  siteId?: string;
  businessId?: string;
  workspaceId?: string;
  now?: string;
  signal?: AbortSignal;
}): Promise<WebsiteIngestionResultV1> {
  const sourceUrl = await assertPublicFetchUrl(input.url);
  const now = input.now ?? new Date().toISOString();
  const siteId = input.siteId ?? `site_${idPart(randomUUID())}`;
  const businessId = input.businessId ?? `business_${idPart(randomUUID())}`;
  const crawl = await crawlUrl(sourceUrl, { maxInternalPages: 12 });
  if (!crawl.fetched) throw new Error(crawl.error ?? "The source website could not be crawled.");

  const presence = await gatherPublicPresenceSignals({ url: sourceUrl, crawl });
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for production website ingestion; deterministic understanding is test-only.");
  }
  const supportedVerticals = listProductionVerticalContexts();
  const understanding = await understandWebsite({
    sourceUrl,
    crawl,
    supportedVerticals,
    publicPresence: presence,
    signal: input.signal
  });

  const facts = mergeFacts(crawl.extractedFacts, presence);
  const verticalModule = resolveVerticalModule(understanding.vertical, crawl.extractedFacts);
  if (!verticalModule) throw new UnsupportedWebsiteVerticalError(understanding.vertical);
  const name = clean(facts.name) ?? clean(crawl.title)?.replace(/\s*[|\-–].*$/, "").trim();
  if (!name) throw new Error("The source website did not expose a business name.");
  const sourceContentHash = sha256(stableJson(crawl));
  const sourceSnapshotId = sourceSnapshotIdForBusiness(businessId, sourceContentHash);
  const sourceSnapshot = sourceSnapshotV1Schema.parse({
    schemaVersion: "source-snapshot-v1",
    id: sourceSnapshotId,
    businessId,
    sourceType: "website",
    sourceUrl,
    contentHash: sourceContentHash,
    capturedAt: now,
    payload: {
      crawl,
      publicPresence: presence,
      understanding: {
        vertical: understanding.vertical,
        verticalConfidence: understanding.verticalConfidence,
        cleanedServices: understanding.cleanedServices,
        primaryConversionGoal: understanding.primaryConversionGoal,
        brandExpression: understanding.brandExpression
      }
    }
  });

  const blockIndex = crawl.pageSummaries.flatMap((page) => page.sourceTextBlocks);
  const publicFacts: BusinessFactV2[] = [];
  const addFact = (
    kind: BusinessFactV2["kind"],
    label: string,
    value: unknown,
    confidence = 0.78,
    publicEligible = true
  ) => {
    if (value === undefined || value === null || value === "") return undefined;
    const text = displayValue(value);
    const id = `fact_${kind}_${sha256(text).slice(7, 19)}`;
    const block = supportingBlock(blockIndex, text);
    publicFacts.push({
      id,
      kind,
      label,
      value,
      source: {
        factId: id,
        sourceSnapshotId,
        ...(block ? { sourceBlockId: block.id, sourceUrl: block.sourceUrl } : publicEligible ? { sourceUrl } : {}),
        observedAt: now,
        confidence,
        ownerConfirmed: false
      },
      publicEligible
    });
    return id;
  };

  const crawlName = clean(crawl.extractedFacts.name) ?? clean(crawl.title)?.replace(/\s*[|\-–].*$/, "").trim();
  const nameFactId = addFact("business_name", "Business name", name, 0.9, sameValue(name, crawlName))!;
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
    ...understanding.cleanedServices.map((service) => service.name),
    ...facts.services
  ]).filter((service) => serviceIsSourceBacked(service, crawl)).slice(0, 24);
  const offerings = serviceNames.map((service, index) => offeringFromService(service, index, verticalModule, addFact));
  const serviceAreas = unique(facts.serviceAreas).slice(0, 50).map((label, index) => {
    const factId = addFact("service_area", "Service area", label, 0.7)!;
    return { id: `service_area_${index + 1}`, label, sourceFactIds: [factId] };
  });

  const retainedAssets = await retainReferenceAssets({
    businessId,
    crawl,
    sourceSnapshotId,
    now,
    signal: input.signal
  });
  const assets: AssetRevisionRefV1[] = retainedAssets.map(({ revision }, index) => ({
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
    schemaVersion: "business-state-v2" as const,
    businessId,
    siteId,
    revision: 1,
    updatedAt: now,
    vertical: { id: verticalModule.id, moduleVersion: verticalModule.version, status: "reviewed" as const },
    identity: {
      name,
      description: clean(facts.description),
      categories: unique([preferredBusinessTerm(verticalModule), ...facts.categories]).slice(0, 20)
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
  const state = businessStateV2Schema.parse({ ...stateWithoutHash, stateHash: sha256(stableJson(stateWithoutHash)) });
  const slug = input.slug ?? safeSlug(name);
  const form = formDefinitionV2Schema.parse({
    schemaVersion: "form-definition-v2",
    id: `form_estimate_${idPart(randomUUID())}`,
    siteId,
    revision: 1,
    name: "Estimate request",
    status: "candidate_only",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "phone", label: "Phone", type: "phone", required: true },
      { id: "email", label: "Email", type: "email", required: false },
      { id: "message", label: `How can the ${preferredBusinessTerm(verticalModule)} help?`, type: "textarea", required: false }
    ],
    submitLabel: "Request an estimate",
    successMessage: `Thanks. The ${preferredBusinessTerm(verticalModule)} will follow up soon.`,
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
    schemaVersion: "site-intent-v2" as const,
    id: `intent_${idPart(randomUUID())}`,
    siteId,
    revision: 1,
    updatedAt: now,
    audience: verticalModule.customerJourneys[0],
    positioning: understanding.businessStory?.summary ?? clean(facts.description),
    voice: unique([understanding.brandExpression.voiceRegister, "clear", "capable"]).filter(Boolean) as string[],
    primaryConversion: conversionGoal(understanding.primaryConversionGoal),
    pageRequirements,
    brandConstraints: {
      preferredColors: understanding.brandExpression.paletteSeed.preferredHex ? [understanding.brandExpression.paletteSeed.preferredHex] : [],
      prohibitedColors: [],
      preserveLogo: true,
      notes: []
    },
    enabledCapabilities: ["forms", "analytics", "maps", "gallery", "disclosure"] as const,
    notes: []
  };
  const intent = siteIntentV2Schema.parse({ ...intentWithoutHash, intentHash: sha256(stableJson(intentWithoutHash)) });
  const site = platformSiteRecordSchema.parse({
    id: siteId,
    workspaceId: input.workspaceId,
    businessId,
    slug,
    status: "draft",
    createdAt: now,
    updatedAt: now
  });
  void phoneFactId;
  return { site, state, intent, forms: [form], sourceSnapshots: [sourceSnapshot], retainedAssets, sourceUrl, crawl };
}

async function retainReferenceAssets(input: {
  businessId: string;
  crawl: CrawlAssessment;
  sourceSnapshotId: string;
  now: string;
  signal?: AbortSignal;
}) {
  const candidates = uniqueBy(input.crawl.assetReferences, (asset) => asset.url).slice(0, 8);
  const results: RetainedAssetBinaryV1[] = [];
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
      const revision = assetRevisionV1Schema.parse({
        schemaVersion: "asset-revision-v1",
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
  return results;
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

function mergeFacts(crawl: ExtractedBusinessFacts, presence: PublicPresenceEnrichment | undefined): ExtractedBusinessFacts {
  const enriched = presence?.facts ?? {};
  return {
    ...enriched,
    ...crawl,
    name: crawl.name ?? enriched.name,
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
  service: string,
  index: number,
  verticalModule: VerticalContextModuleV1,
  addFact: (kind: BusinessFactV2["kind"], label: string, value: unknown, confidence?: number) => string | undefined
): BusinessOfferingV2 {
  const normalized = normalizedText(service);
  const catalog = verticalModule.offeringCatalog.find((entry) =>
    [entry.name, ...entry.aliases].some((value) => normalized.includes(normalizedText(value)) || normalizedText(value).includes(normalized))
  );
  const factId = addFact("offering", "Service", service, 0.72)!;
  return {
    id: `offering_${index + 1}_${safeSlug(service).slice(0, 60)}`,
    ...(catalog ? { catalogId: catalog.id } : { customName: service }),
    name: catalog?.name ?? service,
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
  facts: BusinessFactV2[],
  now: string
): BusinessStateV2["proof"] {
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

function resolveVerticalModule(observedVertical: string, facts: ExtractedBusinessFacts) {
  return resolveProductionVerticalContext({
    observedVertical,
    evidenceText: [
      ...facts.categories,
      ...facts.services,
      facts.description ?? ""
    ].join(" ")
  });
}

function preferredBusinessTerm(verticalModule: VerticalContextModuleV1) {
  return verticalModule.terminology.business?.[0] ?? "business";
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

function normalizedImageMime(value: string | null): AssetRevisionV1["mimeType"] | undefined {
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
