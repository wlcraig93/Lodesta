import { randomUUID } from "node:crypto";
import sharp from "sharp";
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
import { WebsiteCrawlError } from "./crawl-errors";
import { sha256, stableJson } from "./hash";
import { crawlWebsiteForGeneration, type EvidenceClass, type WebsiteGenerationIngestion } from "./generation-crawler";
import {
  canonicalOfferingCandidates,
  type CanonicalOfferingCandidate,
  type OfferingEvidence
} from "./offering-normalization";
import { researchBusiness, type WebResearchUsage } from "./web-research";

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
  researchUsage?: WebResearchUsage;
  validationEligibility: "frozen_validation" | "private_review_only";
  domainContext?: VerticalContextModule;
};

export async function ingestWebsite(input: {
  url: string;
  slug?: string;
  siteId?: string;
  businessId?: string;
  now?: string;
  signal?: AbortSignal;
  researchMode?: "auto" | "disabled";
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
  const { ingestion: generationIngestion, crawl } = await crawlWebsiteForGeneration({ url: sourceUrl, signal: input.signal });
  const research = input.researchMode === "disabled"
    ? undefined
    : await researchBusiness({
      businessId,
      sourceUrl,
      businessName: clean(crawl.extractedFacts.name) ?? clean(crawl.title),
      locality: crawl.extractedFacts.address
        ? [crawl.extractedFacts.address.city, crawl.extractedFacts.address.region].filter(Boolean).join(", ")
        : undefined,
      capturedAt: now,
      signal: input.signal
    });

  const facts = crawl.extractedFacts;
  const domainContext = resolveDomainContext(crawl.extractedFacts);
  const crawlName = clean(crawl.extractedFacts.name) ?? clean(crawl.title)?.replace(/\s*[|\-–].*$/, "").trim();
  const sourceBackedName = preferBusinessNameCandidate(crawlName, undefined, new URL(sourceUrl).hostname);
  const identityStatus = clean(sourceBackedName) ? "verified" as const : "provisional" as const;
  const name = clean(sourceBackedName) ?? hostnameBusinessName(sourceUrl);
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
      ingestion: generationIngestion
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
    evidence?: { sourceBlockId?: string; sourceUrl: string; evidenceClass: EvidenceClass }
  ) => {
    if (value === undefined || value === null || value === "") return undefined;
    const text = displayValue(value);
    const id = `fact_${kind}_${sha256(text).slice(7, 19)}`;
    const block = evidence?.sourceBlockId
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
  const sourceWebsiteFactId = addFact("link", "Source website", sourceUrl, 1)!;
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

  const emergencyService = domainContext?.id === "plumbing" && supportsEmergencyPlumbing(crawl, facts.hours)
    ? "Emergency Plumbing"
    : undefined;
  const serviceNames = unique([
    ...facts.services,
    ...(emergencyService ? [emergencyService] : [])
  ]).filter((service) => service === emergencyService || serviceIsSourceBacked(service, crawl)).slice(0, 48);
  const offerings = canonicalOfferingCandidates(serviceNames, domainContext, {
    evidenceFor: (service) => offeringEvidenceFor(service, crawl, generationIngestion),
    scoreBoostFor: (service) => service.catalogId === "emergency_plumbing" && emergencyService ? 40 : 0
  })
    .slice(0, 24)
    .map((service, index) => offeringFromService(service, index, addFact));
  const eligibleAddress = addressFactId ? publicFacts.some((fact) => fact.id === addressFactId && fact.publicEligible) : false;
  const crawlServiceAreas = verifiedServiceAreas(crawl, generationIngestion);
  const serviceAreas = crawlServiceAreas.slice(0, 50).map(({ label, evidence }, index) => {
    const factId = addFact("service_area", "Service area", label, 0.78, true, evidence)!;
    return { id: `service_area_${index + 1}`, label, sourceFactIds: [factId] };
  });
  void eligibleAddress;

  const retainedAssets = await retainReferenceAssets({
    businessId,
    crawl,
    sourceSnapshotId,
    now,
    signal: input.signal
  });
  const assets: AssetRevisionRef[] = retainedAssets.map(({ revision }) => ({
    assetId: revision.assetId,
    revisionId: revision.id,
    kind: retainedAssetKind(revision, crawl),
    contentHash: revision.contentHash,
    storageKey: revision.storageKey,
    mimeType: revision.mimeType,
    alt: revision.provenance.origin === "source_website"
      ? revision.provenance.alt ?? ""
      : "",
    width: revision.width,
    height: revision.height,
    origin: "source_website",
    sourceFactIds: [nameFactId ?? sourceWebsiteFactId],
    activeForFutureBuilds: true
  }));

  const links = safeSourceLinks(sourceUrl, crawl).map((link, index) => {
    const factId = addFact("link", link.label, link.url, 0.75)!;
    return { id: `link_${index + 1}`, ...link, publicEligible: true, sourceFactIds: [factId] };
  });
  const locationSourceIds = [addressFactId, hoursFactId].filter((value): value is string => Boolean(value));
  const locations = facts.address || facts.hours || facts.geo ? [{
    id: "location_primary",
    label: "Main shop",
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

  const stateWithoutHash = {
    schemaVersion: 1 as const,
    businessId,
    siteId,
    revision: 1,
    updatedAt: now,
    identity: {
      name,
      status: identityStatus,
      description: clean(facts.description),
      categories: unique([preferredBusinessTerm(domainContext), ...facts.categories]).slice(0, 20)
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
    positioning: clean(facts.description),
    voice: ["clear", "capable"],
    primaryConversion: "auto" as const,
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
  return {
    site,
    state,
    intent,
    forms: [form],
    sourceSnapshots: [sourceSnapshot, ...(research ? [research.snapshot] : [])],
    retainedAssets,
    sourceUrl,
    crawl,
    generationIngestion,
    researchUsage: research?.usage,
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
  const candidates = uniqueBy(rankSourceAssetCandidates(input.crawl.assetReferences), (asset) => asset.url);
  const results: Array<RetainedAssetBinary & {
    perceptualHash: string;
    sourceKind: "photo" | "logo" | "icon";
    rank: number;
  }> = [];
  for (const [index, candidate] of candidates.entries()) {
    try {
      const url = await assertPublicFetchUrl(candidate.url);
      const response = await fetch(url, { signal: combinedSignal(input.signal, 10_000) });
      if (!response.ok) continue;
      const declaredBytes = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredBytes) && declaredBytes > 8_000_000) continue;
      const bytes = await readBodyWithLimit(response, 8_000_000);
      if (!bytes?.length) continue;
      const metadata = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false }).metadata();
      const mimeType = decodedImageMime(metadata.format);
      if (!mimeType || !metadata.width || !metadata.height) continue;
      const perceptualHash = await imageDifferenceHash(bytes);
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
        width: metadata.width,
        height: metadata.height,
        origin: "source_website",
        provenance: {
          origin: "source_website",
          sourceUrl: url,
          sourcePageUrl: candidate.sourcePageUrl,
          sourceSnapshotId: input.sourceSnapshotId,
          ...(candidate.alt ? { alt: candidate.alt } : {})
        },
        createdAt: input.now
      });
      results.push({
        revision,
        bytes,
        perceptualHash,
        sourceKind: candidate.kind === "image" ? "photo" : candidate.kind,
        rank: sourceAssetRank(candidate, metadata.width, metadata.height)
      });
    } catch {
      // Individual media failures do not invalidate otherwise usable business evidence.
    }
  }
  return selectPerceptuallyDistinctRetainedAssets(results);
}

export function selectPerceptuallyDistinctRetainedAssets(candidates: Array<RetainedAssetBinary & {
  perceptualHash: string;
  sourceKind: "photo" | "logo" | "icon";
  rank: number;
}>) {
  const ranked = [...candidates].sort((left, right) => right.rank - left.rank || left.revision.id.localeCompare(right.revision.id));
  const selected: RetainedAssetBinary[] = [];
  const retainedHashes: Array<{ kind: string; hash: string }> = [];
  for (const candidate of ranked) {
    if (selected.some((asset) => asset.revision.contentHash === candidate.revision.contentHash)) continue;
    if (retainedHashes.some((retained) => retained.kind === candidate.sourceKind && hammingDistance(retained.hash, candidate.perceptualHash) <= 6)) continue;
    selected.push({ revision: candidate.revision, bytes: candidate.bytes });
    retainedHashes.push({ kind: candidate.sourceKind, hash: candidate.perceptualHash });
    if (selected.length >= 24) break;
  }
  return deduplicateRetainedAssets(selected);
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

function rankSourceAssetCandidates<T extends {
  url: string;
  alt?: string;
  kind: "photo" | "image" | "logo" | "icon";
  sourcePageUrl: string;
}>(candidates: T[]) {
  return [...candidates].sort((left, right) =>
    sourceAssetCandidateRank(right) - sourceAssetCandidateRank(left)
    || left.url.localeCompare(right.url));
}

function sourceAssetCandidateRank(candidate: {
  alt?: string;
  kind: "photo" | "image" | "logo" | "icon";
  sourcePageUrl: string;
}) {
  return (candidate.kind === "logo" ? 500 : candidate.kind === "photo" || candidate.kind === "image" ? 350 : 100)
    + (usefulSourceAlt(candidate.alt) ? 60 : 0)
    + (new URL(candidate.sourcePageUrl).pathname === "/" ? 30 : 0);
}

function sourceAssetRank(
  candidate: { alt?: string; kind: "photo" | "image" | "logo" | "icon"; sourcePageUrl: string },
  width: number,
  height: number
) {
  const areaScore = Math.min(300, Math.round((width * height) / 10_000));
  const tooSmall = width < 240 || height < 160 ? -250 : 0;
  return sourceAssetCandidateRank(candidate) + areaScore + tooSmall;
}

function usefulSourceAlt(value: string | undefined) {
  const alt = value?.replace(/\s+/g, " ").trim() ?? "";
  return alt.length >= 8
    && alt.length <= 180
    && !/\.(?:jpe?g|png|webp|gif|svg)\b|https?:\/\/|(?:^|[\s_-])(?:img|image|photo|dsc|screenshot)[\s_-]*\d*/i.test(alt);
}

async function imageDifferenceHash(bytes: Buffer) {
  const { data } = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false })
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += data[row * 9 + column] > data[row * 9 + column + 1] ? "1" : "0";
    }
  }
  return bits;
}

function hammingDistance(left: string, right: string) {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
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
  addFact: (
    kind: BusinessFact["kind"],
    label: string,
    value: unknown,
    confidence?: number,
    publicEligible?: boolean,
    evidence?: { sourceBlockId?: string; sourceUrl: string; evidenceClass: EvidenceClass }
  ) => string | undefined
): BusinessOffering {
  const primaryEvidence = service.evidence?.blocks.find((block) => block.evidenceClass === "first_party")
    ?? service.evidence?.blocks[0];
  const directPageUrl = service.evidence?.directPageUrls[0];
  const factId = addFact(
    "offering",
    "Service",
    service.sourceName,
    0.82,
    true,
    primaryEvidence ?? (directPageUrl ? { sourceUrl: directPageUrl, evidenceClass: "first_party" } : undefined)
  )!;
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

function offeringEvidenceFor(
  service: string,
  crawl: CrawlAssessment,
  ingestion: WebsiteGenerationIngestion
): OfferingEvidence {
  const normalized = normalizedText(service);
  const meaningfulTokens = normalized.split(" ").filter((token) => token.length >= 3 && !offeringStopWords.has(token));
  const evidenceClassByUrl = new Map(ingestion.pages.flatMap((page) => [
    [page.url, page.evidenceClass] as const,
    [(page.summary as CrawlPageSummary).url, page.evidenceClass] as const
  ]));
  const blocks = crawl.pageSummaries.flatMap((page) => page.sourceTextBlocks.flatMap((block) => {
    const text = normalizedText(block.displayText);
    const exactPhrase = normalized.length >= 3 && text.includes(normalized);
    const emergencyAlias = normalized === "emergency plumbing"
      && /\bemergency (?:plumb(?:er|ing)|service)|24[ -]?hour plumber\b/i.test(block.displayText);
    const tokenCoverage = meaningfulTokens.length
      ? meaningfulTokens.filter((token) => text.includes(token)).length / meaningfulTokens.length
      : 0;
    if (!exactPhrase && !emergencyAlias && tokenCoverage < 0.8) return [];
    return [{
      id: block.id,
      sourceUrl: block.sourceUrl,
      evidenceClass: evidenceClassByUrl.get(block.sourceUrl) ?? "unknown" as EvidenceClass
    }];
  }));
  const directPageUrls = crawl.pageSummaries.flatMap((page) => {
    const pageSignal = normalizedText(`${page.title ?? ""} ${new URL(page.url).pathname}`);
    const exactPhrase = pageSignal.includes(normalized);
    const tokenCoverage = meaningfulTokens.length
      ? meaningfulTokens.filter((token) => pageSignal.includes(token)).length / meaningfulTokens.length
      : 0;
    return (exactPhrase || tokenCoverage >= 0.8) && page.purposeTags.some((tag) => tag === "services" || tag === "service_detail")
      ? [page.url]
      : [];
  });
  const uniqueBlocks = uniqueBy(blocks, (block) => block.id);
  const uniquePages = unique(directPageUrls);
  const firstPartyBlocks = uniqueBlocks.filter((block) => block.evidenceClass === "first_party");
  return {
    blocks: uniqueBlocks,
    directPageUrls: uniquePages,
    score: uniquePages.length * 24
      + new Set(firstPartyBlocks.map((block) => block.sourceUrl)).size * 12
      + Math.min(firstPartyBlocks.length, 6) * 6
  };
}

function supportsEmergencyPlumbing(crawl: CrawlAssessment, hours: ExtractedBusinessFacts["hours"]) {
  const sourceText = crawl.pageSummaries
    .flatMap((page) => page.sourceTextBlocks.map((block) => block.displayText))
    .join("\n");
  const emergency = /\bemergency (?:plumb(?:er|ing)|service)|24[ -]?hour plumber\b/i.test(sourceText);
  const continuous = /\b24\s*\/\s*7\b|\b24[ -]?hours?(?: a day)?\b/i.test(sourceText)
    || Boolean(hours && Object.keys(hours).length && Object.values(hours).every((value) => /\b(?:open )?24 hours?\b/i.test(value)));
  return emergency && continuous;
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
      const label = clean(rawLabel);
      if (!label || !plausibleServiceArea(label)) continue;
      const identity = normalizedText(label);
      const supporting = page.sourceTextBlocks.find((block) => normalizedText(block.displayText).includes(identity));
      const evidenceClass = evidenceClassByUrl.get(page.url) ?? "first_party";
      if (evidenceClass !== "first_party") continue;
      const existing = candidates.get(identity);
      if (existing) {
        existing.pageUrls.add(page.url);
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

function plausibleServiceArea(value: string) {
  const normalized = normalizedText(value);
  return normalized.length >= 2
    && normalized.length <= 100
    && !/^(?:united states|usa|nationwide|everywhere|local area|surrounding areas?)$/.test(normalized);
}

const offeringStopWords = new Set([
  "and", "the", "for", "with", "near", "company", "services", "service", "austin", "texas"
]);

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
    .filter((block) => canonicalWordCount(block.displayText) >= 6 && block.displayText.length >= 30 && block.displayText.length <= 240)
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

function decodedImageMime(format: string | undefined): AssetRevision["mimeType"] | undefined {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return undefined;
}

function retainedAssetKind(revision: AssetRevision, crawl: CrawlAssessment): AssetRevisionRef["kind"] {
  if (revision.provenance.origin !== "source_website") return "other";
  const sourceUrl = revision.provenance.sourceUrl;
  const source = crawl.assetReferences.find((candidate) => candidate.url === sourceUrl);
  return source?.kind === "logo" ? "logo" : source?.kind === "icon" ? "icon" : "photo";
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
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
