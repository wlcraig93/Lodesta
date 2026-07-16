import type { BusinessProfile } from "./models";

const trackedFactKeys = ["phone", "email", "address", "hours", "serviceAreas", "credentials", "offers"] as const;

export function countConfirmedOwnerFacts(profile: BusinessProfile) {
  const present = trackedFactKeys.filter((key) => hasFactValue(profile, key));
  const confirmed = present.filter((key) => profile.provenance[key]?.verified);
  return { confirmed: confirmed.length, total: present.length };
}

function hasFactValue(profile: BusinessProfile, key: (typeof trackedFactKeys)[number]) {
  if (key === "phone") return Boolean(profile.phone);
  if (key === "email") return Boolean(profile.email);
  if (key === "address")
    return Boolean(profile.address?.street || profile.address?.city || profile.address?.region || profile.address?.postalCode);
  if (key === "hours") return Boolean(profile.hours && Object.keys(profile.hours).length > 0);
  if (key === "credentials") return Boolean(profile.credentials?.length);
  if (key === "offers") return Boolean(profile.offers?.length);
  return profile.serviceAreas.length > 0;
}
