import type { BusinessProfile, FieldProvenance } from "./models";

const factKeyAliases: Record<string, string> = {
  service_areas: "serviceAreas"
};

export function applyVerifiedFacts(profile: BusinessProfile, verifiedFacts: string[]) {
  const observedAt = new Date().toISOString();
  for (const factId of verifiedFacts) {
    const key = factKeyAliases[factId] ?? factId;
    const existing = profile.provenance[key];
    profile.provenance[key] = verifiedProvenance(existing, observedAt);
  }
}

function verifiedProvenance(existing: FieldProvenance | undefined, observedAt: string): FieldProvenance {
  return {
    source: "owner",
    sourceUrl: existing?.sourceUrl,
    confidence: 1,
    verified: true,
    observedAt
  };
}
