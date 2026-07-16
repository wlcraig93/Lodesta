import type {
  BusinessFact,
  BusinessFactConfidence,
  BusinessFactGraph,
  BusinessFactKind,
  BusinessFactRenderSafety,
  BusinessProfile,
  FieldProvenance,
  PresenceAssessment,
  PublicPresenceSignal
} from "./models";
import type { VerifiedEvidence } from "./evidence-ledger";

type CreateBusinessFactGraphInput = {
  business: BusinessProfile;
  presence: Pick<PresenceAssessment, "sourceUrl" | "publicPresenceSignals" | "normalizedBusinessFacts" | "evidenceLedger">;
  observedAt?: string;
};

export function createBusinessFactGraph(input: CreateBusinessFactGraphInput): BusinessFactGraph {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const facts: BusinessFact[] = [];
  const omittedFacts: BusinessFactGraph["omittedFacts"] = [];

  const addFact = (kind: BusinessFactKind, label: string, value: BusinessFact["value"] | undefined | null, options: Partial<BusinessFact> = {}) => {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return;
    const provenance = provenanceFor(input.business, input.presence.publicPresenceSignals, kind, observedAt);
    facts.push({
      id: `fact_${safeId(kind)}_${facts.length + 1}`,
      kind,
      label,
      value,
      provenance,
      confidence: options.confidence ?? confidenceFor(provenance),
      renderSafety: options.renderSafety ?? renderSafetyFor(kind, provenance),
      sourceUrl: options.sourceUrl ?? provenance.sourceUrl,
      notes: options.notes
    });
  };

  addFact("name", "Business name", input.business.name);
  addFact("description", "Description", input.business.description ?? "", { renderSafety: "review_required" });
  addFact("phone", "Phone", input.business.phone ?? "");
  addFact("email", "Email", input.business.email ?? "");
  addFact("address", "Address", pruneRecord(input.business.address), { renderSafety: input.business.address ? undefined : "blocked" });
  addFact("geo", "Coordinates", pruneRecord(input.business.geo), { renderSafety: "internal_only" });
  addFact("hours", "Hours", pruneRecord(input.business.hours));
  for (const category of input.business.categories) addFact("category", "Category", category);
  for (const service of input.business.services) addFact("service", "Service", service);
  for (const credential of input.business.credentials ?? []) addFact("credential", "Credential", credential);
  for (const offer of input.business.offers ?? []) addFact("offer", "Offer", offer);
  for (const area of input.business.serviceAreas) addFact("service_area", "Service area", area);
  for (const link of input.business.socialLinks) addFact("social_link", "Social link", link, { renderSafety: "review_required" });
  for (const link of input.business.bookingLinks) addFact("booking_link", "Booking link", link);
  for (const link of input.business.orderingLinks) addFact("ordering_link", "Ordering link", link);
  for (const link of input.business.pressLinks) addFact("press_link", "Press/proof link", link, { renderSafety: "review_required" });
  for (const photo of input.business.photos) {
    addFact("photo", photo.alt || "Photo reference", { url: photo.url, alt: photo.alt, rightsStatus: photo.rightsStatus }, {
      renderSafety: photo.rightsStatus === "preclaim_safe" || photo.rightsStatus === "customer_granted" ? "render_safe" : "internal_only"
    });
  }
  if (input.business.logo) {
    addFact("logo", input.business.logo.alt || "Logo reference", {
      url: input.business.logo.url,
      alt: input.business.logo.alt,
      rightsStatus: input.business.logo.rightsStatus
    }, {
      renderSafety:
        input.business.logo.rightsStatus === "preclaim_safe" || input.business.logo.rightsStatus === "customer_granted"
          ? "render_safe"
          : "internal_only"
    });
  }
  if (input.business.reviewsSummary?.rating || input.business.reviewsSummary?.count) {
    addFact("review_summary", "Review summary", input.business.reviewsSummary, {
      renderSafety: input.business.reviewsSummary.sources.includes("google_places") ? "internal_only" : "review_required"
    });
  }

  const existingProfileEvidence = new Set(
    [...(input.business.credentials ?? []), ...(input.business.offers ?? [])].map(normalizeEvidenceValue)
  );
  for (const evidence of input.presence.evidenceLedger?.items ?? []) {
    const kind = businessFactKindForEvidence(evidence);
    const evidenceValue = evidence.publicText ?? evidence.sourceExcerpt;
    if ((kind === "credential" || kind === "offer") && existingProfileEvidence.has(normalizeEvidenceValue(evidenceValue))) continue;
    const provenance = evidenceProvenance(evidence, observedAt);
    facts.push({
      id: `fact_${safeId(evidence.id)}`,
      kind,
      label: evidenceLabel(evidence.kind),
      value: evidenceValue,
      provenance,
      confidence: confidenceFor(provenance),
      renderSafety: renderSafetyForEvidence(evidence),
      sourceUrl: evidence.source.url,
      notes: [
        `Verified source block: ${evidence.source.blockId}`,
        `Verified token span: ${evidence.source.startToken}-${evidence.source.endToken}`
      ]
    });
  }

  for (const fact of input.presence.normalizedBusinessFacts?.blockedPlaceholders ?? []) {
    omittedFacts.push({
      id: `omitted_${safeId(fact.text)}`,
      kind: "proof_signal",
      label: fact.text,
      reason: fact.reason
    });
  }

  return {
    id: `factgraph_${input.business.siteId}`,
    siteId: input.business.siteId,
    createdAt: observedAt,
    sources: sourceSummaries(input.presence, observedAt),
    facts,
    omittedFacts,
    sourceFactsV2: facts.map((fact) => sourceAwareFactFor(fact))
  };
}

export function factsByKind(graph: BusinessFactGraph, kind: BusinessFactKind) {
  return graph.facts.filter((fact) => fact.kind === kind && fact.renderSafety !== "blocked" && fact.renderSafety !== "internal_only");
}

function provenanceFor(
  business: BusinessProfile,
  signals: PublicPresenceSignal[] | undefined,
  kind: BusinessFactKind,
  observedAt: string
): FieldProvenance {
  const profileField = profileFieldForFactKind(kind);
  const direct = profileField ? business.provenance[profileField] : undefined;
  if (direct) return direct;
  const signal = signals?.find((candidate) => candidate.confidence >= 0.7);
  if (signal) {
    return {
      source: "places_api",
      sourceUrl: signal.sourceUrl,
      confidence: signal.confidence,
      verified: false,
      observedAt: signal.observedAt
    };
  }
  return {
    source: "other",
    sourceUrl: undefined,
    confidence: 0.35,
    verified: false,
    observedAt
  };
}

function confidenceFor(provenance: FieldProvenance): BusinessFactConfidence {
  if (provenance.verified || provenance.confidence >= 0.78) return "high";
  if (provenance.confidence >= 0.5) return "medium";
  return "low";
}

function renderSafetyFor(kind: BusinessFactKind, provenance: FieldProvenance): BusinessFactRenderSafety {
  if (provenance.confidence < 0.35) return "blocked";
  if (kind === "review_summary" && provenance.source !== "places_api" && provenance.source !== "owner") return "review_required";
  if (["description", "press_link", "social_link"].includes(kind)) return provenance.confidence >= 0.55 ? "review_required" : "blocked";
  return provenance.confidence >= 0.45 || provenance.verified ? "render_safe" : "review_required";
}

function sourceAwareFactFor(fact: BusinessFact) {
  const placesFact = fact.provenance.source === "places_api";
  const blocked = fact.renderSafety === "blocked";
  const internalOnly = fact.renderSafety === "internal_only";
  const reviewRequired = fact.renderSafety === "review_required";
  return {
    id: fact.id,
    kind: fact.kind,
    label: fact.label,
    value: fact.value,
    sourceType: placesFact ? "places_identity" : fact.provenance.source === "owner" ? "owner_admin" : fact.provenance.source === "website" ? "first_party" : "crawl",
    sourceUrl: placesFact ? undefined : fact.sourceUrl,
    observedAt: fact.provenance.observedAt,
    confidence: fact.provenance.confidence,
    renderPolicy: blocked ? "blocked" : reviewRequired ? "owner_review_required" : internalOnly || placesFact ? "internal_only" : "durable_render",
    sourcePolicy: placesFact ? "live_only" : blocked ? "blocked" : reviewRequired ? "owner_review_required" : internalOnly ? "internal_only" : "durable_render",
    notes: placesFact
      ? [...(fact.notes ?? []), "Google Places facts are match/validation/live-display evidence only; do not serialize as durable generated-site copy."]
      : fact.notes
  } as const;
}

function sourceSummaries(
  presence: Pick<PresenceAssessment, "sourceUrl" | "publicPresenceSignals" | "evidenceLedger">,
  observedAt: string
): BusinessFactGraph["sources"] {
  const sources: BusinessFactGraph["sources"] = [];
  if (presence.sourceUrl) {
    sources.push({
      id: `source_${safeId(presence.sourceUrl)}`,
      type: "website",
      url: presence.sourceUrl,
      confidence: 0.7,
      observedAt
    });
  }
  for (const signal of presence.publicPresenceSignals ?? []) {
    sources.push({
      id: signal.id,
      type: "places_api",
      url: signal.sourceUrl,
      confidence: signal.confidence,
      observedAt: signal.observedAt
    });
  }
  const sourceUrls = new Set(sources.map((source) => source.url).filter(Boolean));
  for (const evidence of presence.evidenceLedger?.items ?? []) {
    const url = evidence.source.url;
    if (!url || sourceUrls.has(url)) continue;
    sourceUrls.add(url);
    sources.push({
      id: `source_${safeId(evidence.source.pageHash)}`,
      type: "website",
      url,
      confidence: 0.9,
      observedAt
    });
  }
  if (!sources.length) {
    sources.push({ id: "source_system", type: "system", confidence: 0.25, observedAt });
  }
  return sources;
}

function businessFactKindForEvidence(evidence: VerifiedEvidence): BusinessFactKind {
  const kinds: Record<VerifiedEvidence["kind"], BusinessFactKind> = {
    testimonial: "testimonial",
    credential: "credential",
    warranty: "warranty",
    insurance_support: "insurance_support",
    award: "award",
    years_in_business: "years_in_business",
    offer: "offer"
  };
  return kinds[evidence.kind];
}

function evidenceProvenance(evidence: VerifiedEvidence, fallbackObservedAt: string): FieldProvenance {
  return {
    source: evidence.confirmation?.status === "confirmed" ? "owner" : "website",
    sourceUrl: evidence.source.url,
    confidence: evidence.confirmation?.status === "confirmed" ? 1 : 0.9,
    verified: evidence.confirmation?.status === "confirmed",
    observedAt: evidence.confirmation?.decidedAt ?? fallbackObservedAt
  };
}

function renderSafetyForEvidence(evidence: VerifiedEvidence): BusinessFactRenderSafety {
  return evidence.renderPolicy === "durable_render" ? "render_safe" : "review_required";
}

function evidenceLabel(kind: VerifiedEvidence["kind"]) {
  const labels: Record<VerifiedEvidence["kind"], string> = {
    testimonial: "Customer testimonial",
    credential: "Credential",
    warranty: "Warranty",
    insurance_support: "Insurance support",
    award: "Award",
    years_in_business: "Years in business",
    offer: "Offer"
  };
  return labels[kind];
}

function normalizeEvidenceValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function profileFieldForFactKind(kind: BusinessFactKind) {
  const fields: Partial<Record<BusinessFactKind, string>> = {
    name: "name",
    description: "description",
    phone: "phone",
    email: "email",
    address: "address",
    geo: "geo",
    hours: "hours",
    service: "services",
    credential: "credentials",
    offer: "offers",
    service_area: "serviceAreas",
    review_summary: "reviewsSummary"
  };
  return fields[kind];
}

function pruneRecord(value: object | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const next = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
  return Object.keys(next).length ? next : undefined;
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72) || "value";
}
