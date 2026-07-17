import { createHash } from "node:crypto";
import { businessIdForProfile } from "./business-model";
import { createDefaultSiteIntent, createGenerationInputSnapshot } from "./control-plane";
import type { CanonicalBusinessStateV1 } from "./control-plane";
import type {
  AssetRevisionV1,
  BusinessOfferingV1,
  BusinessProofV1,
  FactObservationV1,
  GenerationInputSnapshotV1,
  ResolvedAssetV1,
  ResolvedBusinessSnapshotV1,
  SiteIntentV1,
  SourceSnapshotV1
} from "./control-plane-contracts";
import type { CrawlAssessment, ExtractedBusinessFacts } from "./crawler";
import type { BusinessLocationRecord, BusinessUnderstandingV2, FieldProvenance, SiteAsset, SiteBundle } from "./models";
import type { PublicPresenceEnrichment } from "./public-presence";
import { slugify } from "./slug";
import { inferVertical } from "./vertical-classification";
import { canonicalOfferingSeeds, verticalPackFor } from "./vertical-packs";

export type CanonicalGenerationInputV1 = {
  state: CanonicalBusinessStateV1;
  siteIntent: SiteIntentV1;
  sourceSnapshots: SourceSnapshotV1[];
  observations: FactObservationV1[];
  snapshot: GenerationInputSnapshotV1;
};

export function generationSnapshotFromIntakeBundle(input: {
  bundle: SiteBundle;
  assets: SiteAsset[];
  crawl?: CrawlAssessment;
  publicPresence?: PublicPresenceEnrichment;
  eligibilityMode?: GenerationInputSnapshotV1["eligibilityMode"];
  createdAt?: string;
}): CanonicalGenerationInputV1 {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const profile = input.bundle.businessProfile;
  const businessId = input.bundle.business?.id ?? businessIdForProfile(profile);
  const evidenceManifest = input.bundle.presenceAssessment.evidenceManifest;
  if (!evidenceManifest) throw new Error("Canonical intake did not produce a generation evidence manifest.");
  const sourceSnapshots = sourceSnapshotsForIntake({
    businessId,
    sourceUrl: input.bundle.presenceAssessment.sourceUrl,
    crawl: input.crawl,
    publicPresence: input.publicPresence,
    capturedAt: createdAt
  });
  const observations = observationsForIntake({
    businessId,
    crawl: input.crawl,
    publicPresence: input.publicPresence,
    understanding: input.bundle.presenceAssessment.businessUnderstanding,
    sourceSnapshots,
    observedAt: createdAt
  });
  const resolved = resolveObservedFacts(observations, sourceSnapshots);
  const name = stringValue(resolved.facts.name);
  if (!name) throw new Error("Canonical intake requires a source-observed business name.");
  const services = stringList(resolved.facts.services);
  const vertical = inferVertical({
    url: input.bundle.presenceAssessment.sourceUrl,
    title: input.crawl?.title,
    description: stringValue(resolved.facts.description) ?? input.crawl?.metaDescription,
    name,
    categories: stringList(resolved.facts.categories),
    services
  });
  const verticalPack = verticalPackFor(vertical);
  const offerings = canonicalOfferingSeeds(vertical, services).map((service, index): BusinessOfferingV1 => {
    return {
      id: `offering_${businessId}_${slugify(service.catalogId ?? service.customName ?? service.name)}_${index + 1}`,
      businessId,
      catalogId: service.catalogId,
      customName: service.customName,
      status: input.eligibilityMode === "public" ? "confirmed" : "observed",
      visibility: input.eligibilityMode === "public" ? "public" : "preview",
      pageMode: index < verticalPack.servicePageLimit ? "dedicated" : "shared",
      featured: index < 3,
      evidenceIds: [],
      createdAt,
      updatedAt: createdAt
    };
  });
  const proof = evidenceManifest.items.map((item): BusinessProofV1 => ({
    id: item.id,
    businessId,
    kind: item.kind === "years_in_business" ? "longevity" : item.kind,
    status: item.kind === "testimonial" && item.renderPolicy === "durable_render" ? "confirmed" : "observed",
    publicText: item.publicText,
    sourceExcerpt: item.sourceExcerpt,
    sourceSnapshotId: undefined,
    sourceBlockId: item.source.blockId,
    evidenceIds: [item.id],
    createdAt,
    updatedAt: createdAt
  }));
  const websiteSource = sourceSnapshots.find((source) => source.sourceType === "website");
  const business: ResolvedBusinessSnapshotV1 = {
    schemaVersion: "resolved-business-snapshot-v1",
    businessId,
    siteId: profile.siteId,
    stateRevision: 1,
    resolvedAt: createdAt,
    name,
    vertical,
    categories: stringList(resolved.facts.categories),
    description: stringValue(resolved.facts.description),
    phone: stringValue(resolved.facts.phone),
    email: stringValue(resolved.facts.email),
    address: addressValue(resolved.facts.address),
    geo: geoValue(resolved.facts.geo),
    hours: hoursValue(resolved.facts.hours),
    serviceAreas: stringList(resolved.facts.serviceAreas),
    offerings,
    proof,
    socialLinks: stringList(resolved.facts.socialLinks),
    bookingLinks: stringList(resolved.facts.bookingLinks),
    orderingLinks: stringList(resolved.facts.orderingLinks),
    pressLinks: stringList(resolved.facts.pressLinks),
    googlePlaceId: input.publicPresence?.signals.find((signal) => signal.placeId)?.placeId,
    provenance: resolved.provenance
  };
  const assets = input.assets.map((asset) => resolvedAsset(asset, businessId, createdAt));
  const siteIntent = createDefaultSiteIntent({ siteId: profile.siteId, now: createdAt });
  siteIntent.primaryConversion = conversionGoal(input.bundle.presenceAssessment.businessUnderstanding?.primaryConversionGoal);
  for (const item of proof) item.sourceSnapshotId = websiteSource?.id;
  const snapshot = createGenerationInputSnapshot({
    business,
    siteIntent,
    assets,
    evidenceManifest,
    formDefinition: {
      ...verticalPack.formBlueprint,
      id: `form_${profile.siteId}_${slugify(verticalPack.formBlueprint.name) || "inquiry"}`,
      siteId: profile.siteId,
      createdAt
    },
    brandExpression: input.bundle.presenceAssessment.businessUnderstanding?.brandExpression,
    brandAssessment: input.bundle.presenceAssessment.brandAssessment,
    businessUnderstanding: input.bundle.presenceAssessment.businessUnderstanding,
    sourceSnapshotIds: sourceSnapshots.map((source) => source.id),
    verticalPack: { id: verticalPack.id, version: verticalPack.version },
    eligibilityMode: input.eligibilityMode ?? "protected_preview",
    createdAt
  });
  const assetRevisions = assets.map((asset) => asset.revision);
  const state: CanonicalBusinessStateV1 = {
    business: {
      id: businessId,
      name,
      vertical,
      provenance: structuredClone(resolved.provenance),
      createdAt,
      updatedAt: createdAt,
      stateRevision: business.stateRevision,
      description: business.description,
      categories: [...business.categories]
    },
    locations: locationsFromResolvedBusiness(business, createdAt),
    offerings,
    proof,
    assets: assets.map(({ revision: _revision, ...asset }) => asset),
    assetRevisions,
    socialLinks: [...business.socialLinks],
    bookingLinks: [...business.bookingLinks],
    orderingLinks: [...business.orderingLinks],
    pressLinks: [...business.pressLinks]
  };
  return {
    state,
    siteIntent,
    sourceSnapshots,
    observations,
    snapshot
  };
}

const listFactFields = new Set([
  "categories",
  "services",
  "serviceHighlights",
  "serviceAreas",
  "socialLinks",
  "bookingLinks",
  "orderingLinks",
  "pressLinks"
]);

function sourceSnapshotsForIntake(input: {
  businessId: string;
  sourceUrl?: string;
  crawl?: CrawlAssessment;
  publicPresence?: PublicPresenceEnrichment;
  capturedAt: string;
}): SourceSnapshotV1[] {
  const websitePayload = input.crawl
    ? {
        url: input.crawl.url,
        finalUrl: input.crawl.finalUrl,
        extractedFacts: sourceWebsiteFacts(input.crawl),
        pages: input.crawl.pageSummaries.map((page) => ({
          url: page.url,
          source: page.source,
          purposeTags: page.purposeTags,
          title: page.title,
          sourceTextBlocks: page.sourceTextBlocks
        }))
      }
    : { url: input.sourceUrl, extractedFacts: emptyExtractedFacts(), pages: [] };
  const website = sourceSnapshot({
    businessId: input.businessId,
    sourceType: "website",
    sourceUrl: input.sourceUrl,
    payload: websitePayload,
    capturedAt: input.capturedAt
  });
  if (!input.publicPresence) return [website];
  const placesPayload = {
    provider: "google_places",
    observedAt: input.publicPresence.observedAt,
    acceptedFacts: sanitizedFacts(input.publicPresence.facts),
    signals: input.publicPresence.signals.map((signal) => ({
      id: signal.id,
      source: signal.source,
      placeId: signal.placeId,
      confidence: signal.confidence,
      observedAt: signal.observedAt,
      fields: {
        name: signal.fields.name,
        phone: signal.fields.phone,
        websiteUri: signal.fields.websiteUri,
        googleMapsUri: signal.fields.googleMapsUri,
        address: signal.fields.address,
        geo: signal.fields.geo,
        categories: signal.fields.categories,
        hours: signal.fields.hours
      },
      notes: signal.notes
    })),
    notes: input.publicPresence.notes
  };
  return [
    website,
    sourceSnapshot({
      businessId: input.businessId,
      sourceType: "google_places",
      payload: placesPayload,
      capturedAt: input.publicPresence.observedAt
    })
  ];
}

function sourceSnapshot(input: {
  businessId: string;
  sourceType: SourceSnapshotV1["sourceType"];
  sourceUrl?: string;
  payload: Record<string, unknown>;
  capturedAt: string;
}): SourceSnapshotV1 {
  const contentHash = hash(JSON.stringify(input.payload));
  return {
    id: `source_${input.businessId}_${input.sourceType}_${contentHash.slice(0, 16)}`,
    businessId: input.businessId,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    contentHash,
    capturedAt: input.capturedAt,
    payload: input.payload
  };
}

function observationsForIntake(input: {
  businessId: string;
  crawl?: CrawlAssessment;
  publicPresence?: PublicPresenceEnrichment;
  understanding?: BusinessUnderstandingV2;
  sourceSnapshots: SourceSnapshotV1[];
  observedAt: string;
}): FactObservationV1[] {
  const website = requiredSource(input.sourceSnapshots, "website");
  const observations = observationsFromFacts({
    businessId: input.businessId,
    sourceSnapshot: website,
    facts: input.crawl ? sourceWebsiteFacts(input.crawl) : emptyExtractedFacts(),
    observedAt: input.observedAt,
    confidenceFor: websiteObservationConfidence
  });
  const places = input.sourceSnapshots.find((source) => source.sourceType === "google_places");
  if (places && input.publicPresence) {
    observations.push(...observationsFromFacts({
      businessId: input.businessId,
      sourceSnapshot: places,
      facts: input.publicPresence.facts,
      observedAt: input.publicPresence.observedAt,
      confidenceFor: (field) => input.publicPresence?.provenance[field]?.confidence
        ?? input.publicPresence?.signals[0]?.confidence
        ?? 0.5
    }));
  }
  observations.push(...groundedServiceObservations({
    businessId: input.businessId,
    sourceSnapshot: website,
    crawl: input.crawl,
    understanding: input.understanding,
    observedAt: input.observedAt
  }));
  return selectPreviewObservations(observations, input.sourceSnapshots);
}

function observationsFromFacts(input: {
  businessId: string;
  sourceSnapshot: SourceSnapshotV1;
  facts: Partial<ExtractedBusinessFacts>;
  observedAt: string;
  confidenceFor: (field: string, value: unknown) => number;
}) {
  const observations: FactObservationV1[] = [];
  for (const [field, rawValue] of Object.entries(input.facts)) {
    if (!present(rawValue)) continue;
    const values = listFactFields.has(field) && Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (!present(value)) continue;
      const normalizedValue = normalizeObservationValue(value);
      observations.push({
        id: observationId(input.businessId, input.sourceSnapshot.id, field, normalizedValue),
        businessId: input.businessId,
        sourceSnapshotId: input.sourceSnapshot.id,
        field,
        value: structuredClone(value),
        normalizedValue,
        confidence: clampConfidence(input.confidenceFor(field, value)),
        status: "observed",
        observedAt: input.observedAt
      });
    }
  }
  return observations;
}

function groundedServiceObservations(input: {
  businessId: string;
  sourceSnapshot: SourceSnapshotV1;
  crawl?: CrawlAssessment;
  understanding?: BusinessUnderstandingV2;
  observedAt: string;
}) {
  if (!input.crawl || !input.understanding?.cleanedServices.length) return [];
  const blocks = input.crawl.pageSummaries.flatMap((page) => page.sourceTextBlocks);
  const rawServices = input.crawl.extractedFacts.services.map(canonicalText);
  return input.understanding.cleanedServices.flatMap((service): FactObservationV1[] => {
    const sourceText = canonicalText(service.sourceText);
    const serviceName = canonicalText(service.name);
    if (!sourceText || !serviceName) return [];
    const block = blocks.find((candidate) => canonicalText(candidate.displayText).includes(sourceText));
    const directlyObserved = rawServices.some((candidate) =>
      candidate === sourceText || candidate === serviceName || candidate.includes(sourceText) || sourceText.includes(candidate)
    );
    if (!block && !directlyObserved) return [];
    return [{
      id: `observation_${input.businessId}_grounded_service_${hash(`${input.sourceSnapshot.id}:${service.name}:${service.sourceText}`).slice(0, 20)}`,
      businessId: input.businessId,
      sourceSnapshotId: input.sourceSnapshot.id,
      field: "services",
      value: service.name,
      normalizedValue: { name: serviceName, sourceText },
      confidence: clampConfidence(service.confidence),
      status: "observed",
      sourceBlockId: block?.id,
      observedAt: input.observedAt
    }];
  });
}

function selectPreviewObservations(observations: FactObservationV1[], sources: SourceSnapshotV1[]) {
  const sourceTypes = new Map(sources.map((source) => [source.id, source.sourceType]));
  const grouped = groupObservationsByField(observations);
  for (const [field, candidates] of grouped) {
    candidates.sort((left, right) => {
      const sourceDelta = sourcePriority(sourceTypes.get(left.sourceSnapshotId)) - sourcePriority(sourceTypes.get(right.sourceSnapshotId));
      if (sourceDelta !== 0) return sourceDelta;
      if (field === "services") return Number(right.id.includes("_grounded_service_")) - Number(left.id.includes("_grounded_service_"));
      return 0;
    });
    if (listFactFields.has(field)) {
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const key = canonicalJson(candidate.normalizedValue);
        if (seen.has(key)) {
          candidate.status = "superseded";
          continue;
        }
        seen.add(key);
        candidate.status = "selected_for_preview";
      }
      if (field === "services") supersedeRawServicesCoveredByCleaned(candidates);
      continue;
    }
    const selected = candidates[0];
    if (!selected) continue;
    selected.status = "selected_for_preview";
    const selectedValue = canonicalJson(selected.normalizedValue);
    for (const candidate of candidates.slice(1)) {
      candidate.status = canonicalJson(candidate.normalizedValue) === selectedValue ? "superseded" : "conflict";
    }
  }
  return observations;
}

function supersedeRawServicesCoveredByCleaned(candidates: FactObservationV1[]) {
  const cleaned = candidates.filter((candidate) => candidate.id.includes("_grounded_service_"));
  if (!cleaned.length) return;
  for (const candidate of candidates) {
    if (candidate.id.includes("_grounded_service_")) continue;
    const raw = canonicalText(String(candidate.value));
    if (cleaned.some((item) => {
      const normalized = item.normalizedValue;
      if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
        return raw === canonicalText(String(item.value));
      }
      const sourceText = String((normalized as Record<string, unknown>).sourceText ?? "");
      const name = String((normalized as Record<string, unknown>).name ?? "");
      return raw === sourceText || raw === name || raw.includes(sourceText) || sourceText.includes(raw);
    })) candidate.status = "superseded";
  }
}

function resolveObservedFacts(observations: FactObservationV1[], sources: SourceSnapshotV1[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const selected = observations.filter((observation) => observation.status === "selected_for_preview");
  const grouped = groupObservationsByField(selected);
  const facts: Record<string, unknown> = {};
  const provenance: Record<string, FieldProvenance> = {};
  for (const [field, candidates] of grouped) {
    facts[field] = listFactFields.has(field)
      ? uniqueUnknown(candidates.map((candidate) => candidate.value))
      : structuredClone(candidates[0]?.value);
    const primary = candidates[0];
    const source = primary ? sourceById.get(primary.sourceSnapshotId) : undefined;
    if (primary && source) {
      provenance[field] = {
        source: source.sourceType === "google_places" ? "places_api" : "website",
        sourceUrl: source.sourceUrl,
        confidence: primary.confidence,
        verified: false,
        observedAt: primary.observedAt
      };
    }
  }
  return { facts, provenance };
}

function sourceWebsiteFacts(crawl: CrawlAssessment): ExtractedBusinessFacts {
  const facts = structuredClone(crawl.extractedFacts);
  if (!facts.name) {
    facts.name = cleanSourceName(crawl.pageSummaries[0]?.title ?? crawl.title);
  }
  if (!facts.description && crawl.metaDescription) facts.description = crawl.metaDescription;
  return facts;
}

function cleanSourceName(value: string | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.split(/\s+[|\u2013\u2014]\s+/)[0]?.trim() || undefined;
}

function sanitizedFacts(facts: Partial<ExtractedBusinessFacts>) {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => present(value)));
}

function emptyExtractedFacts(): ExtractedBusinessFacts {
  return {
    categories: [],
    services: [],
    serviceAreas: [],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    pressLinks: []
  };
}

function locationsFromResolvedBusiness(business: ResolvedBusinessSnapshotV1, createdAt: string): BusinessLocationRecord[] {
  const hasLocationRecord = Boolean(
    business.address
    || business.geo
    || business.phone
    || business.email
    || business.hours
    || business.serviceAreas.length
    || business.googlePlaceId
  );
  if (!hasLocationRecord) return [];
  return [{
    id: `loc_${business.businessId}_${hash(JSON.stringify({ address: business.address, serviceAreas: business.serviceAreas })).slice(0, 12)}`,
    businessId: business.businessId,
    label: business.address?.city ?? business.serviceAreas[0] ?? business.name,
    address: business.address,
    serviceAreas: [...business.serviceAreas],
    phone: business.phone,
    email: business.email,
    hours: business.hours,
    geo: business.geo,
    googlePlaceId: business.googlePlaceId,
    provenance: structuredClone(business.provenance),
    createdAt,
    updatedAt: createdAt
  }];
}

function observationId(businessId: string, sourceSnapshotId: string, field: string, value: unknown) {
  return `observation_${businessId}_${hash(`${sourceSnapshotId}:${field}:${canonicalJson(value)}`).slice(0, 20)}`;
}

function requiredSource(sources: SourceSnapshotV1[], type: SourceSnapshotV1["sourceType"]) {
  const source = sources.find((candidate) => candidate.sourceType === type);
  if (!source) throw new Error(`Canonical intake is missing its ${type} source snapshot.`);
  return source;
}

function websiteObservationConfidence(field: string) {
  if (field === "name") return 0.85;
  if (field === "services") return 0.78;
  if (listFactFields.has(field)) return 0.7;
  return 0.75;
}

function sourcePriority(type: SourceSnapshotV1["sourceType"] | undefined) {
  if (type === "website") return 0;
  if (type === "google_places") return 1;
  return 2;
}

function present(value: unknown) {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function normalizeObservationValue(value: unknown): unknown {
  if (typeof value === "string") return canonicalText(value);
  if (Array.isArray(value)) return value.map(normalizeObservationValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalizeObservationValue(item)]));
  }
  return value;
}

function canonicalText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function canonicalJson(value: unknown) {
  return JSON.stringify(normalizeObservationValue(value));
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function uniqueUnknown(values: unknown[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = canonicalJson(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((value) => structuredClone(value));
}

function groupObservationsByField(observations: FactObservationV1[]) {
  const grouped = new Map<string, FactObservationV1[]>();
  for (const observation of observations) {
    const candidates = grouped.get(observation.field) ?? [];
    candidates.push(observation);
    grouped.set(observation.field, candidates);
  }
  return grouped;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function addressValue(value: unknown): ResolvedBusinessSnapshotV1["address"] {
  return value && typeof value === "object" ? structuredClone(value as NonNullable<ResolvedBusinessSnapshotV1["address"]>) : undefined;
}

function geoValue(value: unknown): ResolvedBusinessSnapshotV1["geo"] {
  return value && typeof value === "object" ? structuredClone(value as NonNullable<ResolvedBusinessSnapshotV1["geo"]>) : undefined;
}

function hoursValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value as Record<string, string>) : undefined;
}

function resolvedAsset(asset: SiteAsset, businessId: string, createdAt: string): ResolvedAssetV1 {
  const contentHash = requiredStringMetadata(asset, "contentHash");
  const storagePath = requiredStringMetadata(asset, "storagePath");
  const assetMimeType = requiredMimeType(asset);
  const bytes = requiredPositiveNumberMetadata(asset, "bytes");
  const revisionId = typeof asset.metadata?.assetRevisionId === "string"
    ? asset.metadata.assetRevisionId
    : `assetrev_${hash(`${asset.id}:${contentHash}`).slice(0, 24)}`;
  const revision: AssetRevisionV1 = {
    schemaVersion: "asset-revision-v1",
    id: revisionId,
    assetId: asset.id,
    businessId,
    contentHash,
    storagePath,
    publicUrl: asset.url,
    mimeType: assetMimeType,
    bytes,
    width: numberValue(asset.metadata?.width),
    height: numberValue(asset.metadata?.height),
    provenance: asset.provenance,
    rightsStatus: asset.rightsStatus,
    createdAt: asset.createdAt || createdAt
  };
  return {
    id: asset.id,
    businessId,
    kind: asset.kind,
    alt: asset.alt,
    source: asset.source,
    usageScope: asset.usageScope,
    ownerApproved: asset.ownerApproved,
    metadata: structuredClone(asset.metadata),
    active: true,
    currentRevisionId: revision.id,
    revision,
    createdAt: asset.createdAt || createdAt,
    updatedAt: createdAt
  };
}

function requiredStringMetadata(asset: SiteAsset, field: "contentHash" | "storagePath") {
  const value = asset.metadata?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Asset ${asset.id} is missing required ${field} revision metadata.`);
  }
  return value;
}

function requiredMimeType(asset: SiteAsset): AssetRevisionV1["mimeType"] {
  const value = asset.metadata?.mimeType;
  if (value === "image/png" || value === "image/jpeg" || value === "image/webp") return value;
  throw new Error(`Asset ${asset.id} is missing required MIME type revision metadata.`);
}

function requiredPositiveNumberMetadata(asset: SiteAsset, field: "bytes") {
  const value = asset.metadata?.[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Asset ${asset.id} is missing required positive ${field} revision metadata.`);
  }
  return value;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function conversionGoal(value: string | undefined): GenerationInputSnapshotV1["siteIntent"]["primaryConversion"] {
  if (value === "call_first") return "call";
  if (value === "booking_first") return "booking";
  if (value === "visit_first") return "visit";
  return "form";
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
