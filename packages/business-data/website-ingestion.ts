import { randomUUID } from "node:crypto";
import { explicitServiceAreaListEvidence, type CrawlAssessment, type CrawlPageSummary, type ExtractedBusinessFacts } from "@/lib/crawler";
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
import {
  classifySourcePagePath,
  isLikelyCmsTemplateOrSystemSourcePage
} from "./source-page-classification";

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
  /** Replays retained captures instead of the network (operator regeneration and tests). */
  crawlTransport?: Pick<Parameters<typeof crawlWebsiteForGeneration>[0], "fetchImpl" | "browserFetch" | "validateUrl" | "sleep">;
}): Promise<WebsiteIngestionResult> {
  let sourceUrl: string;
  try {
    sourceUrl = await (input.crawlTransport?.validateUrl ?? assertPublicFetchUrl)(input.url);
  } catch (error) {
    throw new WebsiteCrawlError(
      "source_invalid",
      error instanceof Error ? error.message : String(error)
    );
  }
  const now = input.now ?? new Date().toISOString();
  const siteId = input.siteId ?? `site_${idPart(randomUUID())}`;
  const businessId = input.businessId ?? `business_${idPart(randomUUID())}`;
  const { ingestion: generationIngestion, crawl, captures, documents, timings } = await crawlWebsiteForGeneration({ ...input.crawlTransport, url: sourceUrl, signal: input.signal });
  assertSourceSuitableForGeneration(crawl, generationIngestion);

  const retainedContacts = retainedContactConsensus(documents);
  const firstPartyPageUrls = new Set(generationIngestion.pages
    .filter((page) => page.evidenceClass === "first_party")
    .flatMap((page) => [page.url, (page.summary as CrawlPageSummary).url]));
  const scopedContactAndLocation = selectSourceContactAndLocation(crawl, retainedContacts);
  const displayedPhones = selectDisplayedFirstPartyPhones(
    crawl.pageSummaries.filter((page) => firstPartyPageUrls.has(page.url) && sourceFactPageEligible(page, sourceUrl))
  );
  const facts = {
    ...crawl.extractedFacts,
    ...scopedContactAndLocation
  };
  // An unselected page title or hostname is not an observed business name.
  const crawlName = clean(crawl.extractedFacts.name);
  const identityStatus = crawlName ? "verified" as const : "provisional" as const;
  const name = crawlName ?? hostnameBusinessName(sourceUrl);
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
        : selectSupportingSourceBlock(blockIndex, text, evidenceClassByUrl, kind);
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
    sameValue(facts.phone, crawl.extractedFacts.phone)
      || sameValue(facts.phone, retainedContacts.phone)
      || displayedPhones.some((candidate) => samePhone(candidate.phone, facts.phone))
  );
  // Every number the site itself displays or links on at least two pages is
  // a real way to reach the business, so each stays its own public fact.
  for (const displayed of displayedPhones) {
    if (samePhone(displayed.phone, facts.phone)) continue;
    addFact("phone", "Additional phone", displayed.phone, 0.8, true, {
      ...(displayed.sourceBlockId ? { sourceBlockId: displayed.sourceBlockId } : {}),
      sourceUrl: displayed.sourceUrl,
      evidenceClass: "first_party"
    });
  }
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
  const offerings: BusinessOffering[] = selectSourceOfferingFacts(
    crawl,
    generationIngestion,
    crawlServiceAreas.map((area) => area.label)
  ).flatMap((service) => {
    const factId = addFact(
      "offering",
      "Canonical business offering",
      service.name,
      service.confidence,
      true,
      service.evidence
    );
    if (!factId) return [];
    return [{
      id: `offering_${sha256(service.name).slice(7, 19)}`,
      name: service.name,
      status: "confirmed" as const,
      visibility: "public" as const,
      sourceFactIds: [factId]
    }];
  });
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

  const proof = observedProof(crawl, sourceSnapshotId, publicFacts, now, firstPartyPageUrls);
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
    .filter((value) => !/^(?:web ?page|profile ?page|collection ?page|item ?page|web ?site|breadcrumb ?list|site navigation element|thing|creative ?work|professional ?service|organization|local ?business)$/i.test(value));
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
    serviceAreaIdentity(label),
    // "Midland County" also names the city pages that market to it.
    serviceAreaIdentity(label).replace(/\s+(?:county|parish|borough)$/, "")
  ]).filter(Boolean));
  const evidenceClassByUrl = new Map(ingestion.pages.flatMap((page) => [
    [page.url, page.evidenceClass] as const,
    [(page.summary as CrawlPageSummary).url, page.evidenceClass] as const
  ]));
  const routedOfferings = uniqueBy(crawl.pageSummaries.flatMap((page) => {
    if (!sourceFactPageEligible(page, crawl.url)) return [];
    const evidenceClass = evidenceClassByUrl.get(page.url) ?? "unknown";
    if (evidenceClass !== "first_party") return [];
    const path = new URL(page.url).pathname;
    const explicitServicePath = /\/(?:services?|solutions?)\//i.test(path);
    const projectEvidencePath = /\/(?:portfolio|gallery|projects?|work|case-stud(?:y|ies))(?:\/|$)/i.test(path);
    const projectEvidencePurpose = page.purposeTags.includes("gallery") || page.purposeTags.includes("case_study");
    if (
      page.purposeTags.includes("blog")
      || (page.purposeTags.includes("location") && !explicitServicePath)
      || ((projectEvidencePath || projectEvidencePurpose) && !explicitServicePath)
      || /\/(?:locations?|service-areas?|areas-we-serve|blog|news|articles?|resources?)(?:\/|$)/i.test(path)
    ) return [];
    const segment = path.split("/").filter(Boolean).at(-1)
      ?.replace(/\.(?:html?|php|aspx?)$/i, "");
    if (!segment || isUtilityOfferingRouteSegment(segment)) return [];
    // A city landing page ("/midland-mi-pest-control") markets a place, not a
    // distinct offering; the offerings themselves come from service pages.
    if (!explicitServicePath && isLocationLandingOfferingSegment(segment, serviceAreaIdentities)) return [];
    const name = canonicalOfferingName(segment.replace(/[-_]+/g, " "), serviceAreaIdentities);
    if (!name || !isPlausibleOfferingName(name)) return [];
    const serviceShapedPath = explicitServicePath
      || /\b(?:control|removal|extermination|exclusion|fumigation|inspection|management|repair|installation|replacement|testing|treatment|filtration|sanitizing|abandonment|trenching|drilling|service)s?\b/i.test(name);
    if (!page.purposeTags.includes("service_detail") && !serviceShapedPath) return [];
    const supporting = page.sourceTextBlocks.find((block) => normalizedText(block.displayText).includes(normalizedText(name)));
    return [{
      name,
      confidence: 0.88,
      evidence: {
        ...(supporting ? { sourceBlockId: supporting.id } : {}),
        sourceUrl: page.url,
        evidenceClass
      }
    }];
  }), (candidate) => offeringIdentity(candidate.name));
  const explicitSectionOfferings = uniqueBy(crawl.pageSummaries.flatMap((page) => {
    if (!sourceFactPageEligible(page, crawl.url)) return [];
    const evidenceClass = evidenceClassByUrl.get(page.url) ?? "unknown";
    if (evidenceClass !== "first_party") return [];
    return explicitServiceSectionCandidates(page.sourceTextBlocks).flatMap(({ value, block }) => {
      const name = canonicalOfferingName(value, serviceAreaIdentities);
      if (!name || !isPlausibleOfferingName(name)) return [];
      return [{
        name,
        confidence: 0.9,
        evidence: {
          sourceBlockId: block.id,
          sourceUrl: page.url,
          evidenceClass
        }
      }];
    });
  }), (candidate) => offeringIdentity(candidate.name));
  const directlySupportedOfferings = uniqueBy(
    [...routedOfferings, ...explicitSectionOfferings],
    (candidate) => offeringIdentity(candidate.name)
  );
  if (directlySupportedOfferings.length) return directlySupportedOfferings.slice(0, 24);

  const candidates = new Map<string, {
    name: string;
    score: number;
    pageUrls: Set<string>;
    evidence: { sourceBlockId?: string; sourceUrl: string; evidenceClass: EvidenceClass };
  }>();
  for (const page of crawl.pageSummaries) {
    if (!sourceFactPageEligible(page, crawl.url)) continue;
    const evidenceClass = evidenceClassByUrl.get(page.url) ?? "unknown";
    if (evidenceClass !== "first_party") continue;
    if (classifySourcePagePath(new URL(page.url).pathname) !== "customer_content") continue;
    if (/\/(?:blog|news|articles?|resources?)(?:\/|$)/i.test(new URL(page.url).pathname)) continue;
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

function explicitServiceSectionCandidates(blocks: SourceTextBlock[]) {
  const ordered = [...blocks].sort((left, right) => left.order - right.order);
  const candidates: Array<{ value: string; block: SourceTextBlock }> = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const heading = ordered[index];
    const headingLevel = sourceBlockHeadingLevel(heading);
    if (!headingLevel || !isExplicitServiceSectionHeading(heading.displayText)) continue;
    for (let nextIndex = index + 1; nextIndex < ordered.length && nextIndex <= index + 24; nextIndex += 1) {
      const block = ordered[nextIndex];
      const blockHeadingLevel = sourceBlockHeadingLevel(block);
      if (blockHeadingLevel && blockHeadingLevel <= headingLevel) break;
      for (const value of splitExplicitServiceSectionValue(block.displayText)) {
        candidates.push({ value, block });
      }
    }
  }
  return candidates;
}

function sourceBlockHeadingLevel(block: SourceTextBlock) {
  const match = block.containerId.match(/(?:^|\s*>\s*)h([1-6])(?:[#.:]|$)/i);
  return match ? Number(match[1]) : undefined;
}

function isExplicitServiceSectionHeading(value: string) {
  return /^(?:(?:our|professional|commercial|residential)\s+)?(?:services|treatments|solutions|capabilities)|what we (?:do|offer|install|handle|help with)$/i.test(value.trim());
}

function splitExplicitServiceSectionValue(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return [];
  const delimiter = (compact.match(/\*/g)?.length ?? 0) >= 2
    ? /\s*\*\s*/
    : (compact.match(/[•·|]/g)?.length ?? 0) >= 2
      ? /\s*[•·|]\s*/
      : undefined;
  return (delimiter ? compact.split(delimiter) : [compact])
    .map((candidate) => candidate.replace(/^[-–—:]\s*/, "").trim())
    .filter(Boolean)
    .filter((candidate) => !/^(?:commercial\s*(?:&|and)\s*residential|residential\s*(?:&|and)\s*commercial)$/i.test(candidate));
}

function isPlausibleOfferingName(value: string) {
  const normalized = normalizedText(value);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 8 || value.length > 100) return false;
  if (/^(?:\d+\s+)?(?:questions?|advantages?|benefits?|signs?|ways?|tips?|reasons?|things?)\b/.test(normalized)) return false;
  if (/^(?:how|why|when|what|where|can|should|guide to|complete guide|difference between)\b/.test(normalized)) return false;
  if (/\b(?:header|footer|slider?|slide|mega(?:menu)?|builder|off canvas|bootstrap|font awesome|index php|option panel|tab content|portfolio|archive|category|infosurgepest|faq|blog|cost|price|pricing|online|20\d{2})\b/.test(normalized)) return false;
  if (/^(?:our\s+)?(?:services?|solutions?|offerings?)$/.test(normalized)) return false;
  if (/\b(?:gallery|specials?|discounts?|coupons?|covid(?:-?19)?|coronavirus)\b/.test(normalized)) return false;
  if (/^(?:other|additional|more)\b.*\b(?:services?|things?|products?)\b/.test(normalized)) return false;
  if (/^(?:areas?|explore|more frequent|start consultation|get your quote|consultations?|residential|commercial|request(?: service)?|contact(?: us)?|call(?: now)?|email(?: us)?|submit|send|schedule|book|quote|get started|learn more|read more|view more)$/i.test(value)) return false;
  if (/^(?:commercial and residential|residential and commercial)$/.test(normalized)) return false;
  if (/^(?:schedule|call|book|request|get|contact|text|email)\b/.test(normalized) || /\d{3}\s?\d{3}\s?\d{4}/.test(normalized)) return false;
  if (looksLikeLocationLandingName(normalized)) return false;
  if (/\b(?:family owned|locally owned|local and loved|environmentally friendly|safe for pets?|response times?|treatment around|foundation)\b/.test(normalized)) return false;
  return true;
}

function canonicalOfferingName(value: string | undefined, serviceAreaIdentities: string[]) {
  if (!value) return undefined;
  const possessiveMarker = "xqzpossessivexqz";
  let normalized = normalizedText(value.normalize("NFKC").replace(/([A-Za-z])['’]s\b/g, `$1${possessiveMarker}`))
    .replaceAll(possessiveMarker, "'s")
    .replace(/\.(?:html?|php|aspx?)$/i, "")
    .replace(/^(?:your|our)\s+/, "")
    .trim();
  if (/\b(?:cost|price|pricing|online|20\d{2})\b/.test(normalized)) return undefined;
  const sortedAreas = [...serviceAreaIdentities].sort((left, right) => right.length - left.length);
  for (const area of sortedAreas) {
    const escaped = escapeRegExp(area);
    normalized = normalized
      .replace(new RegExp(`^(?:${escaped})(?:\\s+(?:${usStateCodePatternSource}))?\\s+`, "i"), "")
      .replace(new RegExp(`\\s+(?:in\\s+)?(?:${escaped})(?:\\s+(?:${usStateCodePatternSource}))?$`, "i"), "")
      .trim();
  }
  normalized = normalized.replace(/\s+(?:nc|tx|fl|ga|va)$/i, "").trim();
  if (isUtilityOfferingRouteSegment(normalized.replace(/\s+/g, "-"))) return undefined;
  if (normalized === "animal wildlife trapping") normalized = "animal and wildlife trapping";
  else if (normalized === "insect control") normalized = "insect and pest control";
  else if (/^insect control\s+/.test(normalized)) {
    const subject = canonicalPestSubject(normalized.replace(/^insect control\s+/, ""));
    normalized = `${subject} control`;
  } else if (/\s+control trapping removal$/.test(normalized)) {
    normalized = `${normalized.replace(/\s+control trapping removal$/, "")} trapping and removal`;
  }
  if (!normalized) return undefined;
  return normalized
    .split(" ")
    .map((word, index) => index > 0 && /^(?:and|or|of|the)$/.test(word)
      ? word
      : word.replace(/^\w/, (character) => character.toUpperCase()))
    .join(" ");
}

const usStateCodePatternSource = "al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc";

/**
 * "midland-mi-pest-control", "saginaw-pest-control", "pest-control-in-midland":
 * a known service area, or a leading place followed by a state code, marks a
 * location landing page. State codes that are also English words ("in", "or",
 * "me") only count after a known area, so "mice-in-walls" stays a service.
 */
function isLocationLandingOfferingSegment(segment: string, serviceAreaIdentities: string[]) {
  const words = normalizedText(segment.replace(/[-_]+/g, " "));
  if (serviceAreaIdentities.some((area) => area && (
    new RegExp(`^${escapeRegExp(area)}\\s`, "i").test(words)
    || new RegExp(`\\s(?:in\\s+)?${escapeRegExp(area)}(?:\\s+(?:${usStateCodePatternSource}))?$`, "i").test(words)
  ))) return true;
  return looksLikeLocationLandingName(words);
}

const unambiguousStateCodes = "al|ak|az|ar|ca|ct|fl|ga|ia|il|ks|ky|md|mi|mn|ms|mt|nc|nd|nh|nj|nm|nv|ny|ri|sc|sd|tn|tx|ut|vt|va|wa|wi|wv|wy|dc";
const usStateNames = "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
const serviceNoun = "control|services?|exterminators?|extermination|removal|inspections?|treatments?|management|company";
const nonPlaceTargets = "homes?|houses?|attics?|walls?|kitchens?|hotels?|restaurants?|schools?|offices?|businesses|apartments?|crawl ?spaces?|yards?|gardens?|lawns?|basements?|garages?|warehouses?|the home|your home|winter|summer|spring|fall";

/**
 * Offering names that are really city landing pages: "Midland Mi Pest
 * Control", "Pest Control Brooklyn Ny", "Termite Control Avon Park Florida",
 * "Pest Control In Frostproof". A state after the place, or "<service> in
 * <Place>", marks a location; "Rodent Control In Attics" stays a service.
 */
function looksLikeLocationLandingName(normalized: string) {
  const state = `(?:${unambiguousStateCodes}|${usStateNames})`;
  return new RegExp(`^[a-z]+(?:\\s[a-z]+){0,2}\\s${state}\\s(?:[a-z]+\\s){0,3}(?:${serviceNoun})$`).test(normalized)
    || new RegExp(`\\b(?:${serviceNoun})\\s(?:in\\s|near\\s)?[a-z]+(?:\\s[a-z]+){0,2}\\s${state}$`).test(normalized)
    || (new RegExp(`\\b(?:${serviceNoun})\\s(?:in|near)\\s[a-z]+(?:\\s[a-z]+){0,2}$`).test(normalized)
      && !new RegExp(`\\s(?:in|near)\\s(?:${nonPlaceTargets})$`).test(normalized));
}

function isUtilityOfferingRouteSegment(value: string) {
  return /^(?:index|home|default|about(?:-us)?|contact(?:-us)?|image-credit|privacy(?:-policy)?|terms(?:-of-(?:use|service))?|cookies?|accessibility|sitemap|search|login|account)$/i.test(value.trim());
}

function canonicalPestSubject(value: string) {
  const subjects: Record<string, string> = {
    ants: "ant",
    "bed bugs": "bed bug",
    "bees and wasps": "bee and wasp",
    fleas: "flea",
    flies: "fly",
    mosquitos: "mosquito",
    mosquitoes: "mosquito",
    roach: "cockroach",
    roaches: "cockroach",
    spiders: "spider"
  };
  return subjects[value] ?? value;
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
              || ((!serviceAreaCandidateMatchesAddressCity(value, crawl.extractedFacts.address?.city))
                && serviceAreaCandidateMatchesOffering(value, [
                  ...page.extractedFacts.services,
                  ...crawl.extractedFacts.services
                ]))
              || serviceAreaCandidateIsTrailingOffering(value, supporting?.displayText ?? "")
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
    strongGeographicEvidence: boolean;
  }>();
  for (const page of crawl.pageSummaries) {
    if (!sourceFactPageEligible(page, crawl.url)) continue;
    const ingestionPage = ingestion.pages.find((candidate) => candidate.url === page.url || candidate.finalUrl === page.url);
    const explicitList = explicitServiceAreaListEvidence(page.url, page.sourceTextBlocks);
    for (const rawLabel of page.extractedFacts.serviceAreas) {
      const label = normalizeServiceAreaCandidate(clean(rawLabel));
      if (!label || !isExplicitNamedServiceArea(label)) continue;
      if ((!serviceAreaCandidateMatchesAddressCity(label, crawl.extractedFacts.address?.city))
        && serviceAreaCandidateMatchesOffering(label, [
          ...page.extractedFacts.services,
          ...crawl.extractedFacts.services
        ])) continue;
      const identity = serviceAreaIdentity(label);
      const matchingBlocks = page.sourceTextBlocks.filter((block) => textMentionsServiceArea(block.displayText, label));
      const listed = explicitList.find((entry) => serviceAreaIdentity(entry.label) === identity);
      const supporting = listed?.block ?? matchingBlocks.find((block) =>
        /\b(?:service areas?|areas? we serve|we (?:proudly )?serve|serving|services? in)\b/.test(normalizedText(block.displayText))
      ) ?? matchingBlocks[0];
      const evidenceClass = evidenceClassByUrl.get(page.url) ?? "first_party";
      if (evidenceClass !== "first_party") continue;
      if (!supporting) continue;
      if (serviceAreaCandidateIsTrailingOffering(label, supporting.displayText)) continue;
      const strongGeographicEvidence = Boolean(listed) || serviceAreaHasGeographicEvidence(
        label,
        page,
        supporting.displayText,
        ingestionPage?.internalLinks
      );
      const existing = candidates.get(identity);
      if (existing) {
        existing.pageUrls.add(page.url);
        existing.strongGeographicEvidence ||= strongGeographicEvidence;
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
        pageUrls: new Set([page.url]),
        strongGeographicEvidence
      });
    }
  }
  return [...candidates.values()]
    .filter((candidate) => candidate.strongGeographicEvidence
      || (candidate.pageUrls.size >= 2
        && isBroadServiceAreaLabel(candidate.label)
        && !isBareUsStateName(candidate.label)))
    .sort((left, right) => right.pageUrls.size - left.pageUrls.size || left.label.localeCompare(right.label))
    .map(({ label, evidence }) => ({ label, evidence }));
}

function serviceAreaCandidateIsTrailingOffering(label: string, supportingText: string) {
  const identity = serviceAreaIdentity(label);
  const text = normalizedText(supportingText);
  let occurrence = text.indexOf(identity);
  if (occurrence < 0) return false;
  let foundOutsideOfferingTail = false;
  while (occurrence >= 0) {
    const prefix = text.slice(Math.max(0, occurrence - 240), occurrence);
    if (!/\b(?:serving|service areas?|areas? we serve|we (?:proudly )?serve)\b[^.;:]{0,220}\b(?:with|including|offering)\b[^.;:]*$/.test(prefix)) {
      foundOutsideOfferingTail = true;
      break;
    }
    occurrence = text.indexOf(identity, occurrence + identity.length);
  }
  return !foundOutsideOfferingTail;
}

function serviceAreaCandidateMatchesOffering(label: string, services: string[]) {
  const identity = normalizedText(label);
  const words = identity.split(" ").filter(Boolean);
  return services.some((service) => {
    const serviceWords = normalizedText(service)
      .replace(/\b(?:services?|solutions?|treatments?)\b/g, " ")
      .split(" ")
      .filter(Boolean);
    if (!serviceWords.length) return false;
    const serviceIdentity = serviceWords.join(" ");
    return serviceIdentity === identity
      || (words.length === 1 && serviceWords.includes(identity));
  });
}

function serviceAreaCandidateMatchesAddressCity(label: string, city: string | undefined) {
  const normalizedCity = clean(city);
  return Boolean(normalizedCity && serviceAreaIdentity(label) === serviceAreaIdentity(normalizedCity));
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
    && !/\b(?:homeowners?|customers?|clients?|residents?|restaurants?|businesses?|properties|communities|families|people|you|your|our|we|team|technicians?|including|anthem|climate|challenges?|solutions?|response|times?|insight|concerns?|activity|provides?|bring|understand|common|unique|housing|precise|fast|local|reviews?|reviewers?|apartments?|offices?|pets?|environment|more|include|microhab|corridors?|every|days?|across|not|services?|removal|trapping|control|exterminat(?:or|ion)|wildlife|pests?|bugs?|ants?|termites?|mosquitoes?|rodents?|cockroaches?|well|drilling)\b/.test(normalized)
    && !/&|\band\b/.test(normalized)
    && (!value.includes(",") || /,\s*[A-Z]{2}\s*$/i.test(value))
    && !/^(?:united states|usa|nationwide|everywhere|local area|surrounding areas?)$/.test(normalized);
}

function isBareUsStateName(value: string) {
  return /^(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)$/i.test(value.trim());
}

function isBroadServiceAreaLabel(value: string) {
  return /\b(?:county|parish|borough|region|valley|metro|metropolitan|area)\b/i.test(value)
    || /^(?:central|north|south|east|west|northeast|northwest|southeast|southwest)\s+[A-Z][A-Za-z'-]+$/i.test(value.trim());
}

export function normalizeServiceAreaCandidate(value: string | undefined) {
  if (!value) return undefined;
  const stripped = value
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/^\s*(?:(?:serving|throughout|across|near|in)\s+(?:the\s+)?|(?:all|rest)\s+of\s+(?:the\s+)?|(?:entire|wider|broader)\s+)/i, "")
    .replace(/\s+region\s*$/i, "")
    .trim();
  return isExplicitNamedServiceArea(stripped) ? stripped : undefined;
}

function serviceAreaIdentity(value: string) {
  return normalizedText(value)
    .replace(/\s+(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)$/, "")
    .trim();
}

/**
 * "Bay County" is supported by "serving Bay, Saginaw and Midland counties":
 * the shared plural type noun applies to each listed place.
 */
function textMentionsServiceArea(text: string, label: string) {
  const normalized = normalizedText(text);
  const identity = serviceAreaIdentity(label);
  if (normalized.includes(identity)) return true;
  const typed = identity.match(/^(.+)\s+(county|parish|borough)$/);
  if (!typed) return false;
  const plural = { county: "counties", parish: "parishes", borough: "boroughs" }[typed[2] as "county" | "parish" | "borough"];
  return new RegExp(`\\b${escapeRegExp(typed[1]!)}\\b[^.;:]{0,120}\\b${plural}\\b`).test(normalized);
}

function serviceAreaSpecificity(value: string) {
  return /(?:,\s*|\s)[A-Z]{2}\s*$/i.test(value) ? 2 : 1;
}

function serviceAreaHasGeographicEvidence(
  label: string,
  page: CrawlPageSummary,
  supportingText?: string,
  internalLinks: string[] = []
) {
  const identity = serviceAreaIdentity(label);
  const path = new URL(page.url).pathname.toLocaleLowerCase();
  const slug = identity.replace(/[^a-z0-9]+/g, "-");
  const escapedSlug = escapeRegExp(slug);
  const context = normalizedText(supportingText ?? "");
  if (isBareUsStateName(label)) {
    const state = escapeRegExp(normalizedText(label));
    const narrowerRegionalClaim = new RegExp(
      `\\b(?:central|north|south|east|west|northeast|northwest|southeast|southwest)\\s+${state}\\b`
    );
    if (narrowerRegionalClaim.test(context)) return false;
  }
  const stateQualifiedLegacyPath = new RegExp(
    `(?:^|[-/])${escapedSlug}-(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new-hampshire|new-jersey|new-mexico|new-york|north-carolina|north-dakota|ohio|oklahoma|oregon|pennsylvania|rhode-island|south-carolina|south-dakota|tennessee|texas|utah|vermont|virginia|washington|west-virginia|wisconsin|wyoming|district-of-columbia|al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)(?:\\.(?:html?|php|aspx?))?/?$`
  );
  if (stateQualifiedLegacyPath.test(path)
    && context.includes(identity)
    && /\bservices?\s+in\b/.test(context)) {
    return true;
  }
  if (new RegExp(`/(?:local-pest-control|locations?|service-areas?|areas-we-serve)/${escapedSlug}(?:-(?:pest-control|exterminators?|services?))?(?:/|$)`).test(path)) {
    return true;
  }
  if (new RegExp(`/${escapedSlug}-(?:pest-control|exterminators?|service-area)(?:/|$)`).test(path)) {
    return true;
  }
  if (/^\/(?:locations?|service-areas?|areas-we-serve)\/?$/.test(path)) {
    const hasMatchingChildLocation = internalLinks.some((href) => {
      const linkedPath = new URL(href).pathname.toLocaleLowerCase();
      return new RegExp(`^/(?:locations?|service-areas?|areas-we-serve)/${escapedSlug}(?:-(?:pest-control|exterminators?|services?))?/?$`).test(linkedPath);
    });
    if (!hasMatchingChildLocation) return false;
  }
  if (!context
    || !textMentionsServiceArea(context, label)
    || !/\b(?:service areas?|areas? we serve|we (?:proudly )?serve|serving|services? in|(?:install(?:s|ed|ing)?|provid(?:e|es|ed|ing)|offer(?:s|ed|ing)?|perform(?:s|ed|ing)?|work(?:s|ed|ing)?)\b.{0,180}\bin)\b/.test(context)) {
    return false;
  }
  if (page.source === "primary") return true;
  // Company-story pages may use legacy filenames rather than /about. Their
  // explicit first-party coverage statement is the evidence, not the filename.
  if (page.purposeTags.includes("about") && !page.purposeTags.includes("blog")) return true;
  return /^\/(?:about(?:-us)?|contact(?:-us)?|locations?|service-areas?|areas-we-serve)(?:\/|$)/.test(path);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function observedProof(
  crawl: CrawlAssessment,
  sourceSnapshotId: string,
  facts: BusinessFact[],
  now: string,
  firstPartyPageUrls?: ReadonlySet<string>
): BusinessState["proof"] {
  const pages = firstPartyPageUrls
    ? crawl.pageSummaries.filter((page) => firstPartyPageUrls.has(page.url))
    : crawl.pageSummaries;
  const observedFact = (
    factId: string,
    label: string,
    value: string,
    evidence: { sourceUrl: string; sourceBlockId?: string },
    confidence: number,
    publicEligible: boolean
  ) => {
    facts.push({
      id: factId,
      kind: "proof",
      label,
      value,
      source: {
        factId,
        sourceSnapshotId,
        ...(evidence.sourceBlockId ? { sourceBlockId: evidence.sourceBlockId } : {}),
        sourceUrl: evidence.sourceUrl,
        evidenceClass: "first_party",
        observedAt: now,
        confidence,
        ownerConfirmed: false
      },
      publicEligible
    });
  };

  const testimonials = selectObservedFirstPartyTestimonials(pages, crawl.url).map((testimonial, index) => {
    const factId = `fact_proof_${index + 1}_${sha256(testimonial.text).slice(7, 17)}`;
    observedFact(
      factId,
      (testimonial.author ? `Observed testimonial from ${testimonial.author}` : "Observed testimonial").slice(0, 160),
      testimonial.text,
      testimonial,
      0.65,
      true
    );
    return {
      id: `proof_${index + 1}`,
      kind: "testimonial" as const,
      status: "confirmed" as const,
      publicText: testimonial.text,
      verbatim: true,
      sourceFactIds: [factId]
    };
  });

  const warranties = selectObservedFirstPartyWarrantyBlocks(pages, crawl.url).map((block) => {
    const suffix = sha256(`${block.sourceUrl}\n${block.displayText}`).slice(7, 19);
    const factId = `fact_proof_warranty_${suffix}`;
    observedFact(factId, "Observed service guarantee", block.displayText, { sourceUrl: block.sourceUrl, sourceBlockId: block.id }, 0.88, false);
    return {
      id: `proof_warranty_${suffix}`,
      kind: "warranty" as const,
      status: "observed" as const,
      publicText: block.displayText,
      verbatim: true,
      sourceFactIds: [factId]
    };
  });

  const credentialLabels = {
    credential: "Observed license or certification",
    longevity: "Observed founding year",
    ownership: "Observed ownership"
  } as const;
  const credentials = selectObservedFirstPartyCredentials(pages, crawl.url, now).map((credential) => {
    const suffix = sha256(`${credential.kind}\n${normalizedText(credential.text)}`).slice(7, 19);
    const factId = `fact_proof_${credential.kind}_${suffix}`;
    observedFact(factId, credentialLabels[credential.kind], credential.text, credential, 0.85, true);
    return {
      id: `proof_${credential.kind}_${suffix}`,
      kind: credential.kind,
      status: "confirmed" as const,
      publicText: credential.text,
      verbatim: true,
      sourceFactIds: [factId]
    };
  });

  return [...testimonials, ...warranties, ...credentials];
}

export type ObservedTestimonial = {
  text: string;
  sourceUrl: string;
  sourceBlockId?: string;
  author?: string;
};

type TestimonialSourcePage = Pick<CrawlPageSummary, "url" | "purposeTags" | "sourceTextBlocks"> & {
  title?: string;
  thirdPartyReviewBlockIds?: string[];
  extractedFacts?: Pick<ExtractedBusinessFacts, "structuredReviews">;
};

/**
 * Customer quotations the business publishes on its own site, kept verbatim:
 * quoted or blockquoted text and attributed review cards on review pages, and
 * the business's own structured-data reviews. Blocks rendered inside embedded
 * review-platform widgets are that platform's content and are never used.
 */
export function selectObservedFirstPartyTestimonials(
  pages: TestimonialSourcePage[],
  sourceUrl: string
): ObservedTestimonial[] {
  const sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const seen = new Set<string>();
  const testimonials: ObservedTestimonial[] = [];
  const accept = (candidate: ObservedTestimonial) => {
    const text = candidate.text.replace(/\s+/g, " ").trim();
    if (canonicalWordCount(text) < 6 || text.length < 30 || text.length > 600) return;
    if (isPlaceholderOrTemplateCopy(text)) return;
    const identity = normalizedText(text);
    if (seen.has(identity)) return;
    seen.add(identity);
    testimonials.push({ ...candidate, text });
  };
  for (const page of pages) {
    if (!sameSourceHost(page.url, sourceHost) || !sourceFactPageEligible(page, sourceUrl)) continue;
    const widgetBlocks = new Set(page.thirdPartyReviewBlockIds ?? []);
    const pageBlocks = page.sourceTextBlocks
      .filter((block) => !widgetBlocks.has(block.id) && block.displayText.replace(/[\s​-‍⁠﻿]/g, ""))
      .sort((left, right) => left.order - right.order);
    // A review page is all review content; elsewhere only a section the
    // business itself labels "Testimonials"/"Reviews" (a heading or a tab
    // label) is, e.g. a homepage testimonial strip or an About-page tab.
    const reviewSections = page.purposeTags.includes("reviews")
      ? [pageBlocks]
      : labeledTestimonialSections(pageBlocks);
    for (const blocks of reviewSections) {
      for (const [index, block] of blocks.entries()) {
        const blockquote = /^blockquote(?:[#.:]|$)/.test(block.containerId.split(" > ").at(-1) ?? "");
        const visiblyQuoted = /(?:^|\s)[“"][^”"]{20,}[”"](?:\s|$)/u.test(block.displayText);
        const author = blocks[index + 1] ? reviewAttributionName(blocks[index + 1]!.displayText) : undefined;
        if (blockquote || visiblyQuoted) accept({ text: block.displayText, sourceUrl: block.sourceUrl, sourceBlockId: block.id, ...(author ? { author } : {}) });
      }
      for (const card of attributedReviewCards(blocks)) accept(card);
    }
    for (const review of page.extractedFacts?.structuredReviews ?? []) {
      accept({ text: review.text, sourceUrl: page.url, ...(review.author ? { author: review.author } : {}) });
    }
  }
  return testimonials.slice(0, 8);
}

const testimonialSectionLabel = /^(?:(?:our|client|customer)\s+)?(?:testimonials?|reviews?)\s*:?$|^what\s+(?:our\s+)?(?:customers|clients|neighbors|homeowners)\s+(?:are\s+)?say(?:ing)?(?:\s+about\s+us)?\s*:?$/i;
const reviewPlatformMarker = /\b(?:posted on (?:google|yelp|facebook)|based on \d[\d,]* reviews|powered by|verified by)\b/i;

/**
 * Blocks following a first-party "Testimonials" label, up to the next heading
 * or other short section label. A review-platform widget marker ends the
 * section: widget content is the platform's, not the business's.
 */
function labeledTestimonialSections(blocks: SourceTextBlock[]) {
  const sections: SourceTextBlock[][] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    if (!testimonialSectionLabel.test(blocks[index]!.displayText.trim())) continue;
    const section: SourceTextBlock[] = [];
    for (let next = index + 1; next < blocks.length && section.length < 40; next += 1) {
      const block = blocks[next]!;
      const text = block.displayText.trim();
      if (reviewPlatformMarker.test(text)) break;
      if (sourceBlockHeadingLevel(block) && !reviewAttributionName(text)) break;
      if (testimonialSectionLabel.test(text)) break;
      section.push(block);
    }
    if (section.length) sections.push(section);
    index += section.length;
  }
  return sections;
}

function sameSourceHost(url: string, sourceHost: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === sourceHost;
  } catch {
    return false;
  }
}

/**
 * A review card is a run of prose blocks followed by a short person-name
 * attribution inside the same card container, where that container holds no
 * other attribution.
 */
function attributedReviewCards(blocks: SourceTextBlock[]): ObservedTestimonial[] {
  const attributions = blocks.map((block) => reviewAttributionName(block.displayText));
  const cards: ObservedTestimonial[] = [];
  for (let index = 1; index < blocks.length; index += 1) {
    const author = attributions[index];
    if (!author) continue;
    const attribution = blocks[index];
    const card = sharedContainerPath(attribution.containerId, blocks[index - 1].containerId);
    // A single shared ancestor is a card only when it is a specific element
    // (an id), not a generic page-level wrapper.
    if (!card || (card.split(" > ").length < 2 && !/#/.test(card))) continue;
    const inCard = (block: SourceTextBlock) => block.containerId.startsWith(`${card} > `);
    if (blocks.some((block, other) => other !== index && attributions[other] && inCard(block))) continue;
    const quote: SourceTextBlock[] = [];
    for (let previous = index - 1; previous >= 0 && quote.length < 4; previous -= 1) {
      const block = blocks[previous];
      if (!inCard(block) || sourceBlockHeadingLevel(block)) break;
      quote.unshift(block);
    }
    if (!quote.length) continue;
    cards.push({
      text: quote.map((block) => block.displayText).join(" "),
      sourceUrl: quote[0].sourceUrl,
      sourceBlockId: quote[0].id,
      author
    });
  }
  return cards;
}

function sharedContainerPath(left: string, right: string) {
  const leftSegments = left.split(" > ");
  const rightSegments = right.split(" > ");
  const shared: string[] = [];
  for (let index = 0; index < Math.min(leftSegments.length, rightSegments.length) - 1; index += 1) {
    if (leftSegments[index] !== rightSegments[index]) break;
    shared.push(leftSegments[index]);
  }
  return shared.join(" > ");
}

function reviewAttributionName(value: string) {
  const text = value.replace(/^[\s\-–—~]+/, "").replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 60) return undefined;
  const name = text.split(/\s*[,|–—]\s*|\s+-\s+/, 1)[0] ?? "";
  if (!/^(?:(?:Dr|Mr|Mrs|Ms)\.?\s+)?[A-Z][a-zA-Z'’-]*\.?(?:\s+(?:[A-Z][a-zA-Z'’-]*\.?|&|and)){0,3}$/.test(name)) return undefined;
  if (/^(?:testimonials?|reviews?|read more|more|home|contact(?: us)?|about(?: us)?|call(?: now)?|submit|send|learn more|leave a review|write a review|customer reviews?|our reviews?|happy customers?)$/i.test(name)) return undefined;
  if (/\b(?:services?|removal|repair|installation|trimming|pruning|control|company|llc|inc|team|pump|well|electric|roofing|detailing|tree|google|yelp|facebook|reviews?|testimonials?)\b/i.test(name)) return undefined;
  return name;
}

type ObservedCredential = {
  kind: "credential" | "longevity" | "ownership";
  text: string;
  sourceUrl: string;
  sourceBlockId: string;
};

// Registry acronyms immediately before a number are licenses ("TECL #28122",
// "ROC #123456"); these common non-license labels are not.
const nonLicenseLabel = /^(?:apt|ste|suite|unit|bldg|box|room|floor|lot|page|item|sku|job|ticket|case|order|invoice|inv|ref|call|tel|fax|ext|zip|tax|ein|model|part|serial|account|acct|claim|policy|member|route|hwy|store|exit|gate|dock|pin|code|step|phase|year|week|day|num|number)$/i;
const registryLicensePattern = /\b([A-Za-z]{3,6})\s*(?:#|No\.?)\s*:?\s*\d{3,}[A-Za-z0-9-]*/g;
const labeledLicensePattern = /\b(?:(?:[A-Z]{2,6}|[A-Z][a-z]+)\s+){0,3}(?:[Ll]icen[cs]e|LICEN[CS]E|Lic\.|[Rr]egistration|REGISTRATION|Reg\.)\s*(?:[Nn]o\.?|[Nn]umber|NUMBER|#)\s*:?\s*#?\s*[A-Z]{0,4}[-\s]?\d[\dA-Z-]{2,}/g;
const certificationIdPattern = /\b(?:[A-Z]{2,6}\s+)?Certified\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?[^.!?\n]{0,48}?\b[A-Z]{2}-\d{3,}[A-Z]?\b/g;
const foundingPattern = /\b(?:(?:[Ss]erving|[Ii]n business|[Oo]perating|[Pp]roviding|[Pp]roudly)[^.!?\n]{0,60}?\s)?(?:[Ss]ince|SINCE|[Ee]stablished(?:\s+in)?|ESTABLISHED|[Ff]ounded(?:\s+in)?|FOUNDED|Est\.|EST\.)\s+((?:18|19|20)\d{2})\b/g;
const ownershipPattern = /\bfamily[- ]owned(?:\s+(?:and|&)\s+operated)?\b/gi;

/**
 * Licenses, founding year, and family ownership the business states on its
 * own pages, each kept as the exact phrase with its source block.
 */
export function selectObservedFirstPartyCredentials(
  pages: Array<Pick<CrawlPageSummary, "url" | "title" | "purposeTags" | "sourceTextBlocks"> & { thirdPartyReviewBlockIds?: string[] }>,
  sourceUrl: string,
  now: string
): ObservedCredential[] {
  const sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const currentYear = new Date(now).getUTCFullYear();
  const licenses = new Map<string, ObservedCredential>();
  const foundingYears = new Map<string, ObservedCredential>();
  let ownership: ObservedCredential | undefined;
  for (const page of pages) {
    if (!sameSourceHost(page.url, sourceHost) || !sourceFactPageEligible(page, sourceUrl)) continue;
    if (page.purposeTags.includes("blog") || page.purposeTags.includes("legal")) continue;
    const widgetBlocks = new Set(page.thirdPartyReviewBlockIds ?? []);
    for (const block of page.sourceTextBlocks) {
      if (widgetBlocks.has(block.id)) continue;
      const text = block.displayText;
      const evidence = { sourceUrl: block.sourceUrl, sourceBlockId: block.id };
      const license = (value: string) => {
        const phrase = value.trim();
        if (phrase.replace(/\D/g, "").length >= 10) return;
        // One credential per license number, however it is labeled.
        const identity = phrase.match(/[A-Za-z]{0,4}-?\d[\dA-Za-z-]{2,}\s*$/)?.[0]?.replace(/[^A-Za-z0-9]/g, "").toLocaleLowerCase("en-US") ?? normalizedText(phrase);
        if (!licenses.has(identity)) licenses.set(identity, { kind: "credential", text: phrase, ...evidence });
      };
      for (const match of text.matchAll(labeledLicensePattern)) license(match[0]);
      for (const match of text.matchAll(certificationIdPattern)) license(match[0]);
      for (const match of text.matchAll(registryLicensePattern)) {
        if (!nonLicenseLabel.test(match[1] ?? "")) license(match[0]);
      }
      for (const match of text.matchAll(foundingPattern)) {
        const year = Number(match[1]);
        if (year < 1850 || year > currentYear) continue;
        const qualified = /^(?:serving|in business|operating|providing|proudly|established|founded|est)/i.test(match[0])
          || text.length <= 40
          || /\b(?:we|we've|our|family|business|company)\b/i.test(text);
        if (!qualified || foundingYears.has(match[1]!)) continue;
        foundingYears.set(match[1]!, { kind: "longevity", text: match[0].trim(), ...evidence });
      }
      for (const match of text.matchAll(ownershipPattern)) {
        const after = text.slice((match.index ?? 0) + match[0].length);
        const before = text.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
        if (/^\s+(?:businesses|companies|farms)\b/i.test(after) || /\bnot\s+(?:a\s+)?$/i.test(before)) continue;
        if (!ownership || match[0].length > ownership.text.length) ownership = { kind: "ownership", text: match[0], ...evidence };
      }
    }
  }
  // Different founding years are a factual conflict; state none of them.
  const founding = foundingYears.size === 1 ? [...foundingYears.values()] : [];
  return [...[...licenses.values()].slice(0, 4), ...founding, ...(ownership ? [ownership] : [])];
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
    .filter((page) => sourceFactPageEligible(page, sourceUrl))
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
  const eligiblePages = crawl.pageSummaries.filter((page) => sourceFactPageEligible(page, sourceUrl));
  const socialProfile = unique(eligiblePages.flatMap((page) => page.extractedFacts.socialLinks))
    .find((value) => isAccountLevelSocialProfile(value)
      && isPlausiblyOwnedSocialProfile(value, crawl.extractedFacts.name, sourceUrl));
  const customerPortalLinks = uniqueBy(eligiblePages
    .flatMap((page) => page.linkReferences)
    .filter((link) => isCustomerPortalLink(link.href, link.text))
    .map((link) => ({ kind: "other" as const, label: "Customer Login", url: link.href })), (item) => item.url);
  const values = [
    { kind: "website" as const, label: "Source website", url: sourceUrl },
    ...(socialProfile ? [{ kind: "social" as const, label: "Social profile", url: socialProfile }] : []),
    ...unique(eligiblePages.flatMap((page) => page.extractedFacts.bookingLinks))
      .map((url) => ({ kind: "booking" as const, label: "Booking", url })),
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
  const primaryFirstPartyText = crawl.pageSummaries
    .filter((page) => page.source === "primary" && firstPartyUrls.has(page.url))
    .flatMap((page) => [page.title ?? "", page.metaDescription ?? "", ...page.sourceTextBlocks.map((block) => block.displayText)])
    .join("\n");
  const closed = /\b(?:permanently closed|temporarily closed until further notice|no longer (?:open|operating|in business)|ceased operations|closed (?:our|its) doors|business has closed|location is permanently closed)\b/i.test(primaryFirstPartyText);
  const parked = /\b(?:this domain is for sale|buy this domain|domain may be for sale|website is coming soon)\b/i.test(primaryFirstPartyText);
  const contradictory = hasContradictoryFirstPartyLocationHours(crawl, firstPartyUrls);
  const ambiguousLocationIndex = isAmbiguousLocationIndex(crawl, ingestion);
  if (closed || parked || contradictory || ambiguousLocationIndex) {
    throw new WebsiteCrawlError(
      "source_unsuitable",
      closed
        ? "The first-party source indicates that the business or location is closed."
        : parked
          ? "The supplied address is a parked or placeholder website rather than an active first-party business source."
          : contradictory
            ? "The first-party source gives contradictory hours for the same named street address."
            : "The supplied URL is a multi-location directory. Use a specific first-party location URL or explicitly create a corporate multi-location project."
    );
  }
}

function isAmbiguousLocationIndex(crawl: CrawlAssessment, ingestion: WebsiteGenerationIngestion) {
  let source: URL;
  try {
    source = new URL(crawl.finalUrl ?? crawl.url);
  } catch {
    return false;
  }
  const sourcePath = source.pathname.replace(/\/+$/, "") || "/";
  if (!/(?:^|\/)(?:locations?|stores?|branches?|find-a-location|our-locations)$/.test(sourcePath.toLowerCase())) return false;
  const prefix = sourcePath === "/" ? "/" : `${sourcePath}/`;
  const childLocations = new Set(ingestion.pages.flatMap((page) => {
    if (page.evidenceClass !== "first_party") return [];
    try {
      const candidate = new URL(page.finalUrl || page.url);
      if (candidate.origin !== source.origin) return [];
      const path = candidate.pathname.replace(/\/+$/, "") || "/";
      if (!path.startsWith(prefix) || path === sourcePath) return [];
      if (/\/(?:feed|page\/\d+)$/.test(path)) return [];
      return [path];
    } catch {
      return [];
    }
  }));
  return childLocations.size >= 2;
}

export function hasContradictoryFirstPartyLocationHours(
  crawl: CrawlAssessment,
  firstPartyUrls = new Set(crawl.pageSummaries.map((page) => page.url))
) {
  // Compare canonical per-day schedules, not display strings: "Mon-Fri 8am-5pm"
  // and "Monday: 8:00 AM - 5:00 PM" are the same hours. Only a day that two
  // pages give different canonical times (or open vs closed) is contradictory;
  // a page that omits a day is incomplete, not contradictory.
  const scheduleByAddress = new Map<string, Map<string, string>>();
  for (const page of crawl.pageSummaries) {
    if (!firstPartyUrls.has(page.url)) continue;
    const address = normalizedText(formatAddress(page.extractedFacts.address) ?? "");
    const hours = page.extractedFacts.hours;
    if (!address || !hours || !Object.keys(hours).length) continue;
    const schedule = canonicalWeeklySchedule(hours);
    if (!schedule) continue;
    const known = scheduleByAddress.get(address) ?? new Map<string, string>();
    for (const [day, value] of schedule) {
      const existing = known.get(day);
      if (existing !== undefined && existing !== value) return true;
      known.set(day, value);
    }
    scheduleByAddress.set(address, known);
  }
  return false;
}

const canonicalWeekDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/**
 * Expands extracted hour labels ("Monday-Friday", "Saturday") to single days
 * and each value to sorted 24-hour ranges. Returns undefined when any label or
 * value cannot be understood, so unknown formats never manufacture a conflict.
 */
export function canonicalWeeklySchedule(hours: Record<string, string>) {
  const schedule = new Map<string, string>();
  for (const [label, value] of Object.entries(hours)) {
    const days = expandHoursDayLabel(label);
    const canonical = canonicalHoursValue(value);
    if (!days || !canonical) return undefined;
    for (const day of days) {
      const existing = schedule.get(day);
      schedule.set(day, existing && existing !== canonical
        ? [...new Set([...existing.split(","), ...canonical.split(",")])].sort().join(",")
        : canonical);
    }
  }
  return schedule;
}

function expandHoursDayLabel(label: string) {
  const parts = label.toLowerCase().split(/\s*[-–—]\s*/).map((part) => part.trim());
  const indexOf = (part: string | undefined) => part
    ? canonicalWeekDays.findIndex((day) => day === part || (part.length >= 2 && day.startsWith(part)))
    : -1;
  const start = indexOf(parts[0]);
  if (start < 0 || parts.length > 2) return undefined;
  if (parts.length === 1) return [canonicalWeekDays[start]];
  const end = indexOf(parts[1]);
  if (end < 0) return undefined;
  const days: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const index = (start + offset) % 7;
    days.push(canonicalWeekDays[index]);
    if (index === end) break;
  }
  return days;
}

function canonicalHoursValue(value: string) {
  const compact = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(?:closed)$/.test(compact)) return "closed";
  if (/^(?:open 24 hours?|24 hours?)$/.test(compact)) return "00:00-24:00";
  if (/^by appointment$/.test(compact)) return "appointment";
  const ranges = compact.split(/\s*[,;]\s*/).filter(Boolean).map((range) => {
    const match = range.match(/^(.+?)\s*(?:-|–|—|to)\s*(.+)$/);
    if (!match) return undefined;
    const start = canonicalClockTime(match[1]!, match[2]!);
    const end = canonicalClockTime(match[2]!);
    return start && end ? `${start}-${end}` : undefined;
  });
  if (!ranges.length || ranges.some((range) => !range)) return undefined;
  return [...new Set(ranges as string[])].sort().join(",");
}

/** Normalizes 8am, 8:00 AM, 8 a.m., and 08:00 to "08:00". An opening time
 * without a meridiem borrows the closing time's ("8-5pm" is 8:00-17:00 only
 * when that ordering is plausible). */
function canonicalClockTime(value: string, pairedClosing?: string): string | undefined {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  let meridiem: string | undefined = match[3]?.replace(/\./g, "");
  if (!meridiem && pairedClosing) {
    const closing = pairedClosing.trim().match(/(a\.?m\.?|p\.?m\.?)$/)?.[1]?.replace(/\./g, "");
    // "8-5pm": an unlabeled opening hour greater than the closing hour is AM.
    const closingHour = Number(pairedClosing.trim().match(/^(\d{1,2})/)?.[1] ?? NaN);
    if (closing === "pm" && hour > closingHour && hour <= 12) meridiem = "am";
    else meridiem = closing;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (meridiem === "pm" && hour !== 12) hour += 12;
  } else if (!match[2]) {
    return undefined;
  }
  if (hour > 24 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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

function sourceFactPageEligible(
  page: Pick<CrawlPageSummary, "url" | "title" | "sourceTextBlocks">,
  sourceUrl: string
) {
  return !isLikelyCmsTemplateOrSystemSourcePage({
    url: page.url,
    sourceUrl,
    title: page.title,
    text: page.sourceTextBlocks.map((block) => block.displayText).join("\n")
  });
}

function isPlaceholderOrTemplateCopy(value: string) {
  return /\b(?:lorem ipsum|contrary to popular belief,? lorem ipsum|de finibus bonorum et malorum|richard mcclintock|astroid framework|joomdev)\b/i.test(value);
}

function isPlausiblyOwnedSocialProfile(value: string, businessName: string | undefined, sourceUrl: string) {
  let profile: URL;
  let source: URL;
  try {
    profile = new URL(value);
    source = new URL(sourceUrl);
  } catch {
    return false;
  }
  const handle = profile.pathname.split("/").filter(Boolean).at(-1)?.replace(/^@/, "") ?? "";
  const normalizedHandle = handle.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalizedHandle) return false;
  const businessWords = `${businessName ?? ""} ${source.hostname.replace(/^www\./, "").split(".")[0] ?? ""}`
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .filter((word) => !/^(?:and|company|corp|corporation|inc|llc|service|services|official|the)$/.test(word));
  return businessWords.some((word) => normalizedHandle.includes(word));
}

export function selectSupportingSourceBlock(
  blocks: SourceTextBlock[],
  value: string,
  evidenceClassByUrl: ReadonlyMap<string, EvidenceClass> = new Map(),
  factKind?: BusinessFact["kind"]
) {
  const target = normalizedText(value);
  if (target.length < 3) return undefined;
  const matches = blocks.filter((block) => {
    const text = normalizedText(block.displayText);
    if (text.length < 3) return false;
    // Identity citations must contain the entire name, not e.g. Dev in device
    // or a shorter block that happens to be part of a longer business name.
    if (factKind === "business_name") return ` ${text} `.includes(` ${target} `);
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

/**
 * Keeps physical-location fields from one first-party page. The crawl-wide
 * aggregate is useful for broad service/category discovery, but combining its
 * first phone, address fragments, and hours can create a fictional branch on a
 * multi-location site.
 */
export function selectSourceContactAndLocation(
  crawl: CrawlAssessment,
  retainedContacts: { phone?: string; email?: string }
) {
  const primary = crawl.pageSummaries.find((page) => page.source === "primary");
  const pagesByAddress = new Map<string, CrawlPageSummary[]>();
  for (const page of crawl.pageSummaries) {
    const formatted = formatAddress(page.extractedFacts.address);
    if (!formatted) continue;
    const key = normalizedText(formatted);
    pagesByAddress.set(key, [...(pagesByAddress.get(key) ?? []), page]);
  }
  const primaryHasLocation = Boolean(
    formatAddress(primary?.extractedFacts.address)
    || primary?.extractedFacts.geo
  );
  const onlyAddressPages = pagesByAddress.size === 1 ? [...pagesByAddress.values()][0] : undefined;
  const locationPage = primaryHasLocation
    ? primary
    : onlyAddressPages?.slice().sort((left, right) =>
      locationEvidenceCompleteness(right) - locationEvidenceCompleteness(left))[0];
  // The number the source page displays and links is the business's phone.
  // Homepage structured data alone never overrides it: prefer the site-wide
  // displayed consensus when this page shows it, then this page's own link.
  const primaryDisplayed = primary ? displayedPagePhones(primary) : { tel: [], visible: [] };
  const consensus = clean(crawl.extractedFacts.phone);
  const displayedPhone = consensus && [...primaryDisplayed.tel, ...primaryDisplayed.visible].some((phone) => samePhone(phone, consensus))
    ? consensus
    : primaryDisplayed.tel[0] ?? consensus ?? primaryDisplayed.visible[0];
  return {
    phone: displayedPhone ?? clean(primary?.extractedFacts.phone) ?? clean(locationPage?.extractedFacts.phone) ?? clean(retainedContacts.phone),
    email: clean(primary?.extractedFacts.email) ?? clean(locationPage?.extractedFacts.email) ?? clean(retainedContacts.email),
    address: locationPage?.extractedFacts.address,
    geo: locationPage?.extractedFacts.geo,
    hours: locationPage?.extractedFacts.hours
  };
}

function displayedPagePhones(page: Pick<CrawlPageSummary, "linkReferences" | "sourceTextBlocks">) {
  const tel = unique(page.linkReferences
    .filter((reference) => reference.kind === "tel")
    .map((reference) => normalizedUsPhone(reference.href.replace(/^tel:/i, "").split(/[?;]/, 1)[0] ?? "")));
  const visible = unique(page.sourceTextBlocks.flatMap((block) => visiblePhoneMatches(block.displayText)));
  return { tel, visible };
}

function visiblePhoneMatches(text: string) {
  return [...text.matchAll(/(?:\+?1[\s.(\-]*)?(?:\d{3}|\(\d{3}\))[\s.)\-]*\d{3}[\s.\-]*\d{4}\b/g)]
    // A labeled fax line is not a number to call.
    .filter((match) => !/\bfax\b[\s:#.-]*$/i.test(text.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0)))
    .map((match) => normalizedUsPhone(match[0]))
    .filter((value): value is string => Boolean(value));
}

/**
 * Phones shown in first-party tel: links or visible text on at least two
 * pages, one of them the homepage or a contact page, with the page (and
 * visible block, when there is one) that shows it. A number that only lingers
 * in articles or templated side pages is not presented as current contact.
 */
export function selectDisplayedFirstPartyPhones(
  pages: Array<Pick<CrawlPageSummary, "url" | "source" | "purposeTags" | "linkReferences" | "sourceTextBlocks">>
) {
  const candidates = new Map<string, { phone: string; pageUrls: Set<string>; linked: boolean; onContactPage: boolean; sourceUrl: string; sourceBlockId?: string }>();
  for (const page of pages) {
    const { tel, visible } = displayedPagePhones(page);
    const contactPage = page.source === "primary"
      || (!page.purposeTags.includes("blog") && /^\/contact(?:[-_]?us)?(?:\.html?)?\/?$/i.test(safePathname(page.url)));
    for (const phone of unique([...tel, ...visible])) {
      const candidate = candidates.get(phone) ?? { phone, pageUrls: new Set<string>(), linked: false, onContactPage: false, sourceUrl: page.url };
      candidate.pageUrls.add(page.url);
      candidate.linked ||= tel.includes(phone);
      candidate.onContactPage ||= contactPage;
      if (!candidate.sourceBlockId) {
        const block = page.sourceTextBlocks.find((entry) => visiblePhoneMatches(entry.displayText).includes(phone));
        if (block) {
          candidate.sourceBlockId = block.id;
          candidate.sourceUrl = page.url;
        }
      }
      candidates.set(phone, candidate);
    }
  }
  return [...candidates.values()]
    .filter((candidate) => candidate.pageUrls.size >= 2 && candidate.onContactPage)
    .sort((left, right) => right.pageUrls.size - left.pageUrls.size
      || Number(right.linked) - Number(left.linked)
      || left.phone.localeCompare(right.phone))
    .slice(0, 4)
    .map(({ phone, sourceUrl, sourceBlockId, pageUrls }) => ({ phone, sourceUrl, sourceBlockId, pageCount: pageUrls.size }));
}

function safePathname(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return "";
  }
}

function samePhone(left: unknown, right: unknown) {
  const digits = (value: unknown) => typeof value === "string" ? value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : "";
  const leftDigits = digits(left);
  return leftDigits.length >= 10 && leftDigits === digits(right);
}

function locationEvidenceCompleteness(page: CrawlPageSummary) {
  const address = page.extractedFacts.address;
  return [address?.street, address?.city, address?.region, address?.postalCode, address?.country].filter(Boolean).length
    + (page.extractedFacts.geo ? 2 : 0)
    + (page.extractedFacts.hours ? Object.keys(page.extractedFacts.hours).length : 0);
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
