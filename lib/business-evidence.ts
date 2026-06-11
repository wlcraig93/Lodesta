import type { BusinessProfile, SiteBundle, Vertical } from "./models";
import { matchServiceDefinition } from "./service-catalog";

/**
 * Evidence layer (Phase 1): fact candidates derived from intake, owner
 * confirmation converting evidence to typed truth.
 *
 * Statuses distinguish machine selection from owner judgment: pre-claim
 * previews compile from `system_selected_for_preview` — nothing is "accepted"
 * until an owner accepts it.
 *
 * Source rules (source policy matrix):
 * - website/web_search/owner_input candidates may store values + excerpts.
 * - google_places candidates store place_id, field_key, observed_at, and
 *   comparison metadata only — never durable raw values.
 */

export type FactCandidateStatus =
  | "discovered"
  | "system_selected_for_preview"
  | "owner_confirmed"
  | "owner_rejected"
  | "superseded"
  | "drift_candidate";

export type FactCandidateSourceType = "website" | "web_search" | "google_places" | "owner_input";

export type FactCandidate = {
  id: string;
  businessId: string;
  sourceType: FactCandidateSourceType;
  fieldKey: string;
  /** Absent for google_places rows by policy. */
  proposedValue?: unknown;
  confidence: number;
  status: FactCandidateStatus;
  evidenceLabel: string;
  evidenceUrl?: string;
  placeId?: string;
  comparisonResult?: Record<string, unknown>;
  observedAt: string;
  createdAt: string;
};

export type BusinessServiceRecord = {
  id: string;
  businessId: string;
  serviceDefinitionId?: string;
  customName?: string;
  status: "proposed" | "active" | "hidden" | "rejected";
  confirmationSource?: "owner" | "website" | "web_search" | "import";
  featured: boolean;
  publishLandingPage?: boolean;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
};

function candidateId(businessId: string, fieldKey: string, suffix: string) {
  return `factcand_${businessId}_${fieldKey}_${suffix}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120);
}

/**
 * Derive fact candidates from an intake bundle. Field-level provenance on the
 * profile decides the source type and confidence; everything starts
 * `discovered` and the per-field winner is promoted by
 * selectCandidatesForPreview.
 */
export function factCandidatesFromBundle(bundle: SiteBundle, businessId: string, now = new Date().toISOString()): FactCandidate[] {
  const profile = bundle.businessProfile;
  const candidates: FactCandidate[] = [];
  const sourceUrl = bundle.presenceAssessment.sourceUrl ?? undefined;

  const push = (fieldKey: string, value: unknown, confidence: number, sourceType: FactCandidateSourceType, label: string) => {
    if (value === undefined || value === null || value === "") return;
    candidates.push({
      id: candidateId(businessId, fieldKey, `${sourceType}`),
      businessId,
      sourceType,
      fieldKey,
      proposedValue: value,
      confidence,
      status: "discovered",
      evidenceLabel: label,
      evidenceUrl: sourceType === "website" ? sourceUrl : undefined,
      observedAt: now,
      createdAt: now
    });
  };

  const provenanceFor = (field: string) => profile.provenance[field as keyof typeof profile.provenance];
  const sourceTypeFor = (field: string): { type: FactCandidateSourceType; label: string; confidence: number } => {
    const provenance = provenanceFor(field);
    if (provenance?.source === "owner") return { type: "owner_input", label: "Provided by the owner", confidence: 1 };
    if (provenance?.source === "website") return { type: "website", label: "Found on your website", confidence: provenance?.confidence ?? 0.7 };
    return { type: "website", label: "Derived during intake", confidence: provenance?.confidence ?? 0.5 };
  };

  for (const field of ["name", "phone", "email"] as const) {
    const value = profile[field];
    if (!value) continue;
    const source = sourceTypeFor(field);
    push(field, value, source.confidence, source.type, source.label);
  }
  if (profile.address) {
    const source = sourceTypeFor("address");
    push("address", profile.address, source.confidence, source.type, source.label);
  }
  if (profile.hours && Object.keys(profile.hours).length) {
    const source = sourceTypeFor("hours");
    push("hours", profile.hours, source.confidence, source.type, source.label);
  }
  for (const [index, service] of profile.services.entries()) {
    const source = sourceTypeFor("services");
    candidates.push({
      id: candidateId(businessId, "service", `${index}_${source.type}`),
      businessId,
      sourceType: source.type,
      fieldKey: "service",
      proposedValue: service,
      confidence: source.confidence,
      status: "discovered",
      evidenceLabel: source.label,
      evidenceUrl: source.type === "website" ? sourceUrl : undefined,
      observedAt: now,
      createdAt: now
    });
  }

  // Places contributes identity only: place_id + comparison metadata, no values.
  const presencePlaceId = bundle.presenceAssessment.publicPresenceSignals?.find((signal) => signal.placeId)?.placeId;
  if (presencePlaceId) {
    candidates.push({
      id: candidateId(businessId, "place_id", "google_places"),
      businessId,
      sourceType: "google_places",
      fieldKey: "place_id",
      confidence: 0.8,
      status: "discovered",
      evidenceLabel: "Matched to a Google listing",
      placeId: presencePlaceId,
      observedAt: now,
      createdAt: now
    });
  }

  return candidates;
}

/** Promote the highest-confidence candidate per field for preview compilation. */
export function selectCandidatesForPreview(candidates: FactCandidate[]): FactCandidate[] {
  const byField = new Map<string, FactCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.fieldKey === "service" ? `service:${JSON.stringify(candidate.proposedValue)}` : candidate.fieldKey;
    const list = byField.get(key) ?? [];
    list.push(candidate);
    byField.set(key, list);
  }
  const selected: FactCandidate[] = [];
  for (const list of byField.values()) {
    const winner = [...list].sort((left, right) => right.confidence - left.confidence)[0];
    selected.push(
      ...list.map((candidate) =>
        candidate === winner && candidate.proposedValue !== undefined
          ? { ...candidate, status: "system_selected_for_preview" as const }
          : candidate
      )
    );
  }
  return selected;
}

/** Map discovered services onto the catalog as proposed business_services rows. */
export function proposedBusinessServices(
  businessId: string,
  vertical: Vertical,
  profile: Pick<BusinessProfile, "services">,
  now = new Date().toISOString()
): BusinessServiceRecord[] {
  const seen = new Set<string>();
  const records: BusinessServiceRecord[] = [];
  for (const service of profile.services) {
    const definition = matchServiceDefinition(vertical, service);
    const dedupeKey = definition?.id ?? `custom:${service.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    records.push({
      id: `bizsvc_${businessId}_${(definition?.slug ?? service).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
      businessId,
      serviceDefinitionId: definition?.id,
      customName: definition ? undefined : service,
      status: "proposed",
      confirmationSource: "website",
      featured: false,
      createdAt: now,
      updatedAt: now
    });
  }
  return records;
}
