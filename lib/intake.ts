import type { CrawlAssessment, ExtractedBusinessFacts } from "./crawler";
import type {
  BrandAssessment,
  BusinessProfile,
  BusinessUnderstandingV2,
  FieldProvenance,
  PresenceAssessment,
  RenderInspectionResult,
  SiteAsset,
  SiteBundle,
  Theme
} from "./models";
import type { PublicPresenceEnrichment } from "./public-presence";
import { normalizeServiceList } from "./business-understanding-v2";
import { composeGenerationEvidenceManifestV1 } from "./generation-evidence-manifest";
import { withBusinessBundleFields } from "./business-model";
import { slugify } from "./slug";
import { inferVertical } from "./vertical-classification";

export { inferVertical } from "./vertical-classification";

export type IntakeInput = {
  url?: string;
  prompt?: string;
  identity?: {
    siteId?: string;
    slug?: string;
    businessProfileId?: string;
  };
  crawl?: CrawlAssessment;
  renderInspection?: RenderInspectionResult;
  understanding?: BusinessUnderstandingV2;
  publicPresence?: PublicPresenceEnrichment;
  /** Deterministic fixture clock; production intake always omits this. */
  createdAt?: string;
};

export function createSiteBundleFromInput(input: IntakeInput): SiteBundle {
  const now = input.createdAt ?? new Date().toISOString();
  const facts = mergeFacts(input.crawl?.extractedFacts, input.publicPresence?.facts);
  const vertical = input.understanding?.vertical ?? inferVertical({
    url: input.url,
    prompt: input.prompt,
    title: input.crawl?.title,
    description: input.crawl?.metaDescription,
    name: facts?.name,
    categories: facts?.categories,
    services: facts?.services
  });
  const hostname = safeHostname(input.url);
  const name = cleanBusinessName(facts?.name) ?? promptBusinessName(input.prompt) ?? titleCaseHostname(hostname) ?? "Local Business";
  const slug = slugify(input.identity?.slug ?? name) || `site-${Date.now()}`;
  const siteId = input.identity?.siteId?.trim() || `site_${slug}`;
  const services = canonicalServices(input.understanding, facts);
  const serviceAreas = unique([
    ...(facts?.serviceAreas ?? []),
    ...(facts?.address?.city ? [facts.address.city] : [])
  ]).slice(0, 12);
  const profile: BusinessProfile = {
    id: input.identity?.businessProfileId?.trim() || `bp_${slugify(siteId) || slug}`,
    siteId,
    name,
    vertical,
    categories: unique(facts?.categories ?? []).slice(0, 8),
    description: facts?.description ?? input.understanding?.businessStory?.summary,
    phone: facts?.phone,
    email: facts?.email,
    address: facts?.address,
    geo: facts?.geo,
    hours: input.understanding?.hours?.length
      ? Object.fromEntries(input.understanding.hours.map(({ label, value }) => [label, value]))
      : facts?.hours,
    services,
    serviceHighlights: unique(facts?.serviceHighlights ?? []).slice(0, 8),
    serviceAreas,
    socialLinks: unique(facts?.socialLinks ?? []).slice(0, 10),
    bookingLinks: unique(facts?.bookingLinks ?? []).slice(0, 6),
    orderingLinks: unique(facts?.orderingLinks ?? []).slice(0, 6),
    photos: sourcePhotos(input.crawl, siteId),
    ...sourceLogo(input.crawl, siteId, name),
    reviewsSummary: facts?.reviewsSummary,
    pressLinks: unique(facts?.pressLinks ?? []).slice(0, 8),
    provenance: profileProvenance(input, facts, now)
  };
  const evidenceManifest = composeGenerationEvidenceManifestV1({
    crawl: input.crawl,
    proposals: input.understanding?.evidenceProposals ?? [],
    createdAt: now
  });
  const publicPresenceSignals = input.publicPresence?.signals.map((signal) => ({ ...signal, siteId }));
  const presenceAssessment: PresenceAssessment = {
    siteId,
    sourceUrl: input.url,
    evidenceManifest,
    renderInspection: input.renderInspection,
    publicPresenceSignals,
    brandAssessment: brandAssessment(profile, input, now),
    businessUnderstanding: input.understanding,
    assetInventory: sourceAssets(profile, input, now),
    technicalNotes: intakeNotes(input),
    visualNotes: input.renderInspection ? [`Source render inspected with ${input.renderInspection.adapter}.`] : [],
    brandNotes: ["Brand expression is bounded by the selected shipping design system."],
    publicPresenceNotes: input.publicPresence?.notes ?? []
  };
  const bundle = withBusinessBundleFields({
    businessProfile: profile,
    siteModel: {
      id: siteId,
      slug,
      theme: bootstrapTheme(),
      versions: [],
      pinList: []
    },
    extensionModel: estimateExtension(siteId),
    experiments: [],
    presenceAssessment
  });
  return bundle;
}

function mergeFacts(
  website: ExtractedBusinessFacts | undefined,
  presence: PublicPresenceEnrichment["facts"] | undefined
): ExtractedBusinessFacts | undefined {
  if (!website && !presence) return undefined;
  return {
    name: cleanBusinessName(website?.name) ?? cleanBusinessName(presence?.name),
    description: website?.description ?? presence?.description,
    phone: website?.phone ?? presence?.phone,
    email: website?.email ?? presence?.email,
    address: website?.address ?? presence?.address,
    geo: website?.geo ?? presence?.geo,
    hours: website?.hours ?? presence?.hours,
    categories: unique([...(presence?.categories ?? []), ...(website?.categories ?? [])]),
    services: unique([...(website?.services ?? []), ...(presence?.services ?? [])]),
    serviceHighlights: unique([...(website?.serviceHighlights ?? []), ...(presence?.serviceHighlights ?? [])]),
    serviceAreas: unique([...(website?.serviceAreas ?? []), ...(presence?.serviceAreas ?? [])]),
    socialLinks: unique([...(website?.socialLinks ?? []), ...(presence?.socialLinks ?? [])]),
    bookingLinks: unique([...(website?.bookingLinks ?? []), ...(presence?.bookingLinks ?? [])]),
    orderingLinks: unique([...(website?.orderingLinks ?? []), ...(presence?.orderingLinks ?? [])]),
    pressLinks: unique([...(website?.pressLinks ?? []), ...(presence?.pressLinks ?? [])]),
    reviewsSummary: website?.reviewsSummary ?? presence?.reviewsSummary
  };
}

function canonicalServices(understanding: BusinessUnderstandingV2 | undefined, facts: ExtractedBusinessFacts | undefined) {
  const model = understanding?.cleanedServices.map((service) => service.name) ?? [];
  const source = normalizeServiceList(facts?.services ?? []).map((service) => service.name);
  return unique(model.length ? model : source).slice(0, 8);
}

function sourcePhotos(crawl: CrawlAssessment | undefined, siteId: string): BusinessProfile["photos"] {
  return (crawl?.assetReferences ?? [])
    .filter((asset) => asset.kind === "image")
    .slice(0, 8)
    .map((asset, index) => ({
      id: `${siteId}_source_photo_${index + 1}`,
      url: asset.url,
      alt: asset.alt ?? "Source business photo",
      source: "website_reference" as const,
      rightsStatus: "reference_only" as const
    }));
}

function sourceLogo(crawl: CrawlAssessment | undefined, siteId: string, name: string) {
  const logos = (crawl?.assetReferences ?? []).filter((asset) => asset.kind === "logo").slice(0, 4);
  if (!logos.length) return {};
  const candidates = logos.map((asset, index) => ({
    id: `${siteId}_source_logo_${index + 1}`,
    url: asset.url,
    alt: asset.alt ?? `${name} logo`,
    source: "website_reference" as const,
    rightsStatus: "reference_only" as const
  }));
  return { logo: candidates[0], ...(candidates.length > 1 ? { logoCandidates: candidates } : {}) };
}

function sourceAssets(profile: BusinessProfile, input: IntakeInput, now: string): SiteAsset[] {
  const provenance = input.url ? fieldProvenance("website", input.url, 0.7, now) : undefined;
  return [
    ...profile.photos.map((photo, index): SiteAsset => ({
      id: `${profile.siteId}_source_asset_photo_${index + 1}`,
      siteId: profile.siteId,
      kind: "photo",
      url: photo.url,
      alt: photo.alt,
      source: photo.source,
      rightsStatus: photo.rightsStatus,
      usageScope: "reference_only",
      ownerApproved: false,
      provenance,
      createdAt: now
    })),
    ...(profile.logo ? [{
      id: `${profile.siteId}_source_asset_logo`,
      siteId: profile.siteId,
      kind: "logo" as const,
      url: profile.logo.url,
      alt: profile.logo.alt,
      source: profile.logo.source,
      rightsStatus: profile.logo.rightsStatus,
      usageScope: "reference_only" as const,
      ownerApproved: false,
      provenance,
      createdAt: now
    }] : []),
    ...(input.renderInspection?.screenshots ?? []).map((screenshot): SiteAsset => ({
      id: `${profile.siteId}_source_render_${screenshot.viewport}`,
      siteId: profile.siteId,
      kind: "screenshot",
      url: screenshot.path,
      alt: `Source website ${screenshot.viewport} capture`,
      source: "website_reference",
      rightsStatus: "reference_only",
      usageScope: "internal_planning",
      ownerApproved: false,
      provenance,
      createdAt: now
    }))
  ];
}

function profileProvenance(input: IntakeInput, facts: ExtractedBusinessFacts | undefined, now: string) {
  const source = input.url ? "website" : "manual";
  const base: Record<string, FieldProvenance> = {
    name: fieldProvenance(source, input.url, facts?.name ? 0.85 : 0.55, now),
    services: fieldProvenance(source, input.url, facts?.services.length ? 0.78 : 0.5, now)
  };
  for (const field of ["phone", "email", "address", "hours", "geo", "reviewsSummary"] as const) {
    if (facts?.[field]) base[field] = fieldProvenance(source, input.url, 0.75, now);
  }
  return { ...base, ...(input.publicPresence?.provenance ?? {}) };
}

function fieldProvenance(
  source: FieldProvenance["source"],
  sourceUrl: string | undefined,
  confidence: number,
  observedAt: string
): FieldProvenance {
  return { source, sourceUrl, confidence, verified: false, observedAt };
}

function brandAssessment(profile: BusinessProfile, input: IntakeInput, now: string): BrandAssessment {
  const hasLogo = Boolean(profile.logo);
  const hasPhotos = profile.photos.length > 0;
  return {
    id: `brand_${profile.siteId}`,
    siteId: profile.siteId,
    confidence: Math.min(0.9, 0.5 + (hasLogo ? 0.2 : 0) + (hasPhotos ? 0.15 : 0)),
    cues: unique([profile.name, ...profile.categories, input.understanding?.businessStory?.summary].filter(Boolean) as string[]).slice(0, 8),
    colorSignals: [],
    typographySignals: input.understanding?.brandExpression ? [input.understanding.brandExpression.fontPosture] : [],
    imageStyleSignals: hasPhotos ? ["retained first-party source media"] : [],
    toneSignals: input.understanding?.brandExpression ? [input.understanding.brandExpression.voiceRegister] : [],
    preservationRules: ["Preserve source-backed identity and owner-confirmed claims."],
    sourceNotes: [input.url ? `Source captured ${now} from ${input.url}.` : "Prompt-only intake requires verification."]
  };
}

function estimateExtension(siteId: string): SiteBundle["extensionModel"] {
  return {
    forms: [{
      id: `form_${siteId}_estimate`,
      siteId,
      name: "Estimate request",
      fields: [
        { id: "name", label: "Name", type: "text", required: true },
        { id: "phone", label: "Phone", type: "phone", required: true },
        { id: "details", label: "Damage details", type: "textarea", required: true }
      ],
      submitLabel: "Request an estimate"
    }],
    workflows: [],
    inboundSettings: { captureMode: "form_only", aiHandlingMode: "classify_only", notificationMode: "all_inquiries" },
    customBlocks: []
  };
}

function bootstrapTheme(): Theme {
  return {
    paletteName: "canonical-bootstrap",
    colors: {
      background: "#f7f7f4",
      surface: "#ffffff",
      text: "#1c1c1a",
      muted: "#62625d",
      primary: "#174c3c",
      primaryText: "#ffffff",
      accent: "#c84a2f",
      border: "#d8d8d1"
    },
    typography: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
    radius: "sm",
    density: "standard",
    mood: "utilitarian"
  };
}

function intakeNotes(input: IntakeInput) {
  if (!input.crawl) return ["No source crawl was available."];
  return [
    `Fetched ${input.crawl.finalUrl ?? input.crawl.url} with status ${input.crawl.status ?? "unknown"}.`,
    `${input.crawl.pageSummaries.length} source page(s) retained for fact and evidence provenance.`
  ];
}

function cleanBusinessName(value: string | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned || /^(home|about|contact|services)$/i.test(cleaned)) return undefined;
  return cleaned.split(/\s+[|\u2013\u2014]\s+/).find((part) => part.trim().length > 1)?.trim() ?? cleaned;
}

function promptBusinessName(prompt: string | undefined) {
  return prompt?.match(/\b(?:called|named|for)\s+(?:a\s+|an\s+|the\s+)?([A-Z][A-Za-z0-9'&. -]{2,80}?)(?:[.,]|\s+in\s+|\s+with\s+|$)/)?.[1]?.trim();
}

function safeHostname(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function titleCaseHostname(value: string | undefined) {
  return value?.split(".")[0]?.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}
