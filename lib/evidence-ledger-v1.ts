import { createHash } from "node:crypto";
import type { CrawlAssessment } from "./crawler";
import type { PublicPresenceSignal, RenderInspectionResult } from "./models";

export const siteEvidenceLedgerVersionV1 = "site-evidence-ledger-v1" as const;

export type SiteEvidenceDomainV1 = "business_proof" | "brand";

export type SiteEvidenceKindV1 =
  | "testimonial"
  | "credential"
  | "warranty"
  | "insurance_support"
  | "award"
  | "years_in_business"
  | "offer"
  | "review_presence"
  | "brand_logo"
  | "brand_color"
  | "brand_typography"
  | "brand_imagery";

export type SiteEvidenceRenderPolicyV1 =
  | "durable_render"
  | "live_only"
  | "owner_review_required"
  | "internal_only"
  | "blocked";

export type SiteEvidenceVerificationV1 = "source_backed" | "owner_verified" | "unverified";

export type SiteEvidenceSourceTypeV1 =
  | "website_json_ld"
  | "website_visible_text"
  | "website_asset"
  | "render_inspection"
  | "places_identity"
  | "owner";

export type SiteEvidenceValueV1 = {
  text: string;
  displayText?: string;
  quote?: string;
  attribution?: string;
  url?: string;
  color?: string;
  fontFamily?: string;
  placeId?: string;
};

export type SiteEvidenceCandidateV1 = {
  domain: SiteEvidenceDomainV1;
  kind: SiteEvidenceKindV1;
  label: string;
  value: SiteEvidenceValueV1;
  source: {
    type: SiteEvidenceSourceTypeV1;
    url?: string;
    pageTitle?: string;
    extractionMethod: string;
    snippet?: string;
    screenshotPath?: string;
  };
  confidence: number;
  renderPolicy: SiteEvidenceRenderPolicyV1;
  verification: SiteEvidenceVerificationV1;
  notes?: string[];
};

export type SiteEvidenceItemV1 = SiteEvidenceCandidateV1 & {
  id: string;
  observedAt: string;
  sourceHash: string;
};

export type SiteEvidenceConflictV1 = {
  id: string;
  kind: "years_in_business";
  values: string[];
  sourceUrls: string[];
  resolution: "owner_review_required";
  note: string;
};

export type SiteEvidenceLedgerV1 = {
  version: typeof siteEvidenceLedgerVersionV1;
  producerId: "compose-site-evidence-ledger-v1";
  producerVersion: typeof siteEvidenceLedgerVersionV1;
  modelId: "deterministic";
  siteId: string;
  createdAt: string;
  stale: boolean;
  inputHashes: {
    crawl?: string;
    renderInspection?: string;
    publicPresence?: string;
  };
  items: SiteEvidenceItemV1[];
  conflicts?: SiteEvidenceConflictV1[];
  summary: {
    businessProofItems: number;
    brandItems: number;
    durableRenderItems: number;
    liveOnlyItems: number;
    ownerReviewItems: number;
    conflictCount?: number;
  };
};

export function composeSiteEvidenceLedgerV1(input: {
  siteId: string;
  crawl?: CrawlAssessment;
  renderInspection?: RenderInspectionResult;
  publicPresenceSignals?: PublicPresenceSignal[];
  conflictNotes?: string[];
  createdAt?: string;
}): SiteEvidenceLedgerV1 {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const candidates = [
    ...crawlEvidenceCandidates(input.crawl),
    ...brandAssetCandidates(input.crawl),
    ...brandRenderCandidates(input.renderInspection),
    ...publicPresenceCandidates(input.publicPresenceSignals ?? [])
  ];
  const deduped = dedupeCandidates(candidates).slice(0, 80);
  const reconciled = reconcileEvidenceConflictsV1(deduped, input.conflictNotes);
  const items = reconciled.candidates.map((candidate) => evidenceItem(candidate, createdAt));

  return {
    version: siteEvidenceLedgerVersionV1,
    producerId: "compose-site-evidence-ledger-v1",
    producerVersion: siteEvidenceLedgerVersionV1,
    modelId: "deterministic",
    siteId: input.siteId,
    createdAt,
    stale: false,
    inputHashes: {
      ...(input.crawl ? { crawl: hashStable(input.crawl.pageSummaries) } : {}),
      ...(input.renderInspection ? { renderInspection: hashStable(renderEvidenceInput(input.renderInspection)) } : {}),
      ...(input.publicPresenceSignals?.length ? { publicPresence: hashStable(input.publicPresenceSignals) } : {})
    },
    items,
    conflicts: reconciled.conflicts,
    summary: {
      businessProofItems: items.filter((item) => item.domain === "business_proof").length,
      brandItems: items.filter((item) => item.domain === "brand").length,
      durableRenderItems: items.filter((item) => item.renderPolicy === "durable_render").length,
      liveOnlyItems: items.filter((item) => item.renderPolicy === "live_only").length,
      ownerReviewItems: items.filter((item) => item.renderPolicy === "owner_review_required").length,
      conflictCount: reconciled.conflicts.length
    }
  };
}

export function reconcileEvidenceConflictsV1(candidates: SiteEvidenceCandidateV1[], conflictNotes: string[] = []) {
  const longevityClaims = candidates
    .filter((candidate) => candidate.kind === "years_in_business")
    .map((candidate) => ({ candidate, year: exactLongevityYearV1(candidate.value.text) }))
    .filter((entry): entry is { candidate: SiteEvidenceCandidateV1; year: string } => Boolean(entry.year));
  const noteYears = conflictNotes
    .filter((note) => /\b(conflict|inconsistent|disagree|while|whereas)\b/i.test(note))
    .flatMap((note) => [...note.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => match[0]));
  const years = [...new Set([...longevityClaims.map((entry) => entry.year), ...noteYears])].sort();
  if (years.length < 2) return { candidates, conflicts: [] as SiteEvidenceConflictV1[] };

  const conflict: SiteEvidenceConflictV1 = {
    id: `conflict_years_in_business_${hashStable(years)}`,
    kind: "years_in_business",
    values: years,
    sourceUrls: [...new Set(longevityClaims.map((entry) => entry.candidate.source.url).filter((url): url is string => Boolean(url)))],
    resolution: "owner_review_required",
    note: `Conflicting exact business-history years (${years.join(", ")}) were found in source material; exact dates require owner review before public rendering.`
  };
  const blockedYears = new Set(years);
  return {
    candidates: candidates.map((candidate) => {
      if (candidate.kind !== "years_in_business") return candidate;
      const year = exactLongevityYearV1(candidate.value.text);
      if (!year || !blockedYears.has(year)) return candidate;
      return {
        ...candidate,
        renderPolicy: "owner_review_required" as const,
        notes: [...(candidate.notes ?? []), conflict.note]
      };
    }),
    conflicts: [conflict]
  };
}

function exactLongevityYearV1(value: string) {
  return value.match(/\b(?:since|established|founded|opened|started)\b[^.]{0,80}?\b((?:19|20)\d{2})\b/i)?.[1];
}

export function evidenceItemsForKindsV1(
  ledger: SiteEvidenceLedgerV1 | undefined,
  kinds: readonly SiteEvidenceKindV1[],
  policies: readonly SiteEvidenceRenderPolicyV1[] = ["durable_render"]
) {
  const kindSet = new Set(kinds);
  const policySet = new Set(policies);
  return (ledger?.items ?? []).filter((item) => kindSet.has(item.kind) && policySet.has(item.renderPolicy));
}

export function testimonialEvidenceItemsV1(ledger: SiteEvidenceLedgerV1 | undefined) {
  return evidenceItemsForKindsV1(ledger, ["testimonial"])
    .filter((item) => Boolean(item.value.quote))
    .filter(isDurableTestimonialEvidenceV1)
    .slice(0, 4);
}

export function trustEvidenceItemsV1(ledger: SiteEvidenceLedgerV1 | undefined) {
  const seen = new Set<string>();
  return evidenceItemsForKindsV1(ledger, ["credential", "warranty", "insurance_support", "award", "years_in_business", "offer"])
    .filter((item) => {
      const key = trustEvidenceSemanticKeyV1(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function isDurableTestimonialEvidenceV1(item: SiteEvidenceItemV1) {
  const quote = item.value.quote?.trim();
  if (!quote) return false;
  if (/\b(get started with a (?:free )?estimate|please call our|location nearest you|thank you for contacting us|we will get back to you|form (?:was )?submitted)\b/i.test(quote)) return false;
  if (/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i.test(quote)) return false;
  if (/(?:\.{3}|…)[\s"']*$/.test(quote) || /^[\s"']*(?:\.{3}|…)/.test(quote)) return false;
  if (item.source.type === "website_json_ld") return item.source.extractionMethod === "json_ld_review";
  if (item.source.type !== "website_visible_text") return false;
  return /\b(reviews?|testimonials?|customers?|feedback)\b/i.test(`${item.source.url ?? ""} ${item.source.pageTitle ?? ""}`);
}

function trustEvidenceSemanticKeyV1(item: SiteEvidenceItemV1) {
  const display = normalize(item.value.displayText ?? item.value.text);
  if (item.kind === "years_in_business") return item.kind;
  if (item.kind === "credential") {
    return `${item.kind}:${display.replace(/\b(certified|certification)\b/g, "").replace(/\s+/g, " ").trim()}`;
  }
  return `${item.kind}:${display}`;
}

function crawlEvidenceCandidates(crawl: CrawlAssessment | undefined) {
  return crawl?.pageSummaries.flatMap((page) => page.evidenceCandidates ?? []) ?? [];
}

function brandAssetCandidates(crawl: CrawlAssessment | undefined): SiteEvidenceCandidateV1[] {
  if (!crawl) return [];
  return crawl.assetReferences.slice(0, 12).map((asset) => ({
    domain: "brand",
    kind: asset.kind === "logo" ? "brand_logo" : "brand_imagery",
    label: asset.kind === "logo" ? "Source logo reference" : "Source image reference",
    value: {
      text: asset.alt || (asset.kind === "logo" ? "Logo reference" : "Image reference"),
      url: asset.url
    },
    source: {
      type: "website_asset",
      url: asset.url,
      extractionMethod: "html_asset_reference",
      snippet: asset.alt
    },
    confidence: asset.kind === "logo" ? 0.82 : 0.7,
    renderPolicy: "internal_only",
    verification: "source_backed"
  }));
}

function brandRenderCandidates(renderInspection: RenderInspectionResult | undefined): SiteEvidenceCandidateV1[] {
  if (!renderInspection) return [];
  const sourceUrl = renderInspection.finalUrl ?? renderInspection.sourceUrl;
  const screenshotPath = renderInspection.screenshots.find((screenshot) => screenshot.viewport === "desktop")?.path;
  const colors = renderInspection.metrics.brandColorSamples ?? [];
  const fonts = [renderInspection.metrics.headingFontFamily, renderInspection.metrics.bodyFontFamily].filter(
    (font, index, values): font is string => Boolean(font && values.indexOf(font) === index)
  );
  return [
    ...colors.slice(0, 8).map((color): SiteEvidenceCandidateV1 => ({
      domain: "brand",
      kind: "brand_color",
      label: "Computed source-site color",
      value: { text: color, color },
      source: {
        type: "render_inspection",
        url: sourceUrl,
        extractionMethod: "computed_style_color_sample",
        snippet: color,
        screenshotPath
      },
      confidence: 0.82,
      renderPolicy: "internal_only",
      verification: "source_backed"
    })),
    ...fonts.map((fontFamily): SiteEvidenceCandidateV1 => ({
      domain: "brand",
      kind: "brand_typography",
      label: "Computed source-site font",
      value: { text: fontFamily, fontFamily },
      source: {
        type: "render_inspection",
        url: sourceUrl,
        extractionMethod: "computed_style_font_sample",
        snippet: fontFamily,
        screenshotPath
      },
      confidence: 0.86,
      renderPolicy: "internal_only",
      verification: "source_backed"
    }))
  ];
}

function publicPresenceCandidates(signals: PublicPresenceSignal[]): SiteEvidenceCandidateV1[] {
  return signals
    .filter((signal) => Boolean(signal.placeId))
    .map((signal) => ({
      domain: "business_proof",
      kind: "review_presence",
      label: "Google Business Profile available for live proof",
      value: {
        text: "Google Business Profile",
        placeId: signal.placeId
      },
      source: {
        type: "places_identity",
        url: signal.sourceUrl,
        extractionMethod: "google_places_identity"
      },
      confidence: signal.confidence,
      renderPolicy: "live_only",
      verification: "source_backed",
      notes: ["Only place identity is retained; ratings, counts, and review text remain live-only."]
    }));
}

function evidenceItem(candidate: SiteEvidenceCandidateV1, observedAt: string): SiteEvidenceItemV1 {
  const sourceHash = hashStable({
    kind: candidate.kind,
    value: candidate.value,
    source: candidate.source
  });
  return {
    ...candidate,
    id: `evidence_${candidate.kind}_${sourceHash}`,
    observedAt,
    sourceHash
  };
}

function dedupeCandidates(candidates: SiteEvidenceCandidateV1[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      candidate.kind,
      normalize(candidate.value.quote ?? candidate.value.text),
      normalize(candidate.source.url ?? "")
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderEvidenceInput(inspection: RenderInspectionResult) {
  return {
    sourceUrl: inspection.sourceUrl,
    finalUrl: inspection.finalUrl,
    capturedAt: inspection.capturedAt,
    headingFontFamily: inspection.metrics.headingFontFamily,
    bodyFontFamily: inspection.metrics.bodyFontFamily,
    brandColorSamples: inspection.metrics.brandColorSamples,
    screenshots: inspection.screenshots.map((screenshot) => ({ viewport: screenshot.viewport, path: screenshot.path }))
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function hashStable(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
