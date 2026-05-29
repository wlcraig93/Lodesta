import type { BusinessProfile, FieldProvenance } from "./models";

const factKeyAliases: Record<string, string> = {
  service_areas: "serviceAreas"
};

export function requiredClaimFactIds(profile: BusinessProfile) {
  const required = ["name"];
  if (profile.phone) {
    required.push("phone");
  } else if (profile.email) {
    required.push("email");
  }
  if (hasAddress(profile)) {
    required.push("address");
  } else if (profile.serviceAreas.length) {
    required.push("service_areas");
  }
  if (profile.services.length) required.push("services");
  return required;
}

export function missingRequiredClaimFacts(profile: BusinessProfile, verifiedFacts: string[]) {
  const verified = new Set(verifiedFacts.map((fact) => factKeyAliases[fact] ?? fact));
  return requiredClaimFactIds(profile).filter((factId) => !verified.has(factKeyAliases[factId] ?? factId));
}

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

function hasAddress(profile: BusinessProfile) {
  return Boolean(profile.address?.street || profile.address?.city || profile.address?.region || profile.address?.postalCode);
}
