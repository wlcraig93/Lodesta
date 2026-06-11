import type { FactCandidate, FactCandidateSourceType } from "./business-evidence";

/**
 * Drift detection (Phase 3): compare freshly observed evidence against the
 * facts currently in force and emit `drift_candidate` rows for the owner's
 * "update or keep" review.
 *
 * Source rules carry through: website/web_search drift rows store the new
 * value + excerpt; google_places drift rows store only comparison metadata
 * (`differs_from_confirmed`) — the differing value is live-resolved in the
 * owner's review session, never persisted.
 */

export type DriftComparison = {
  fieldKey: string;
  sourceType: FactCandidateSourceType;
  currentValue: unknown;
  observedValue: unknown;
  evidenceLabel: string;
  evidenceUrl?: string;
  placeId?: string;
};

export function detectDrift(businessId: string, comparisons: DriftComparison[], now = new Date().toISOString()): FactCandidate[] {
  const drift: FactCandidate[] = [];
  for (const comparison of comparisons) {
    if (!valuesDiffer(comparison.currentValue, comparison.observedValue)) continue;
    const isPlaces = comparison.sourceType === "google_places";
    drift.push({
      id: `factcand_${businessId}_${comparison.fieldKey}_drift_${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
      businessId,
      sourceType: comparison.sourceType,
      fieldKey: comparison.fieldKey,
      // Live-only rule: Places drift rows never persist the differing value.
      proposedValue: isPlaces ? undefined : comparison.observedValue,
      confidence: 0.6,
      status: "drift_candidate",
      evidenceLabel: comparison.evidenceLabel,
      evidenceUrl: isPlaces ? undefined : comparison.evidenceUrl,
      placeId: isPlaces ? comparison.placeId : undefined,
      comparisonResult: isPlaces ? { differs_from_confirmed: true } : undefined,
      observedAt: now,
      createdAt: now
    });
  }
  return drift;
}

export function valuesDiffer(current: unknown, observed: unknown): boolean {
  if (observed === undefined || observed === null || observed === "") return false;
  return normalizeForComparison(current) !== normalizeForComparison(observed);
}

function normalizeForComparison(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim().toLowerCase().replace(/\s+/g, " ");
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}
