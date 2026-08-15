import { prospectAddressFromGoogleComponents, type GoogleAddressComponent } from "./address";

export type ProspectPlaceSeed = {
  names: string[];
  websiteUrl?: string | null;
  addressLine1?: string | null;
  locality?: string | null;
  region?: string | null;
  county?: string | null;
  postalCode?: string | null;
  phone?: string | null;
};

export type ProspectPlaceCandidate = {
  displayName?: { text?: string };
  primaryType?: string;
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  businessStatus?: string;
};

export type ProspectPlaceEvaluation = {
  plausible: boolean;
  score: number;
  verifiedPestBusiness: boolean;
  compatibleName: boolean;
  geographyCompatible: boolean;
  strongIdentityAgreement: boolean;
  reasons: string[];
};

const pestTerms = /\b(pest|termite|exterminat(?:e|ing|or|ors|ion)?|fumigat(?:e|ing|ion)?|mosquito|bed\s*bug|wildlife\s+control)\b/i;
const genericNameTokens = new Set([
  "and", "the", "to", "pest", "pests", "control", "termite", "termites", "service", "services",
  "solution", "solutions", "management", "exterminating", "exterminator", "exterminators", "extermination",
  "fumigation", "tree", "company", "co", "inc", "incorporated", "llc", "ltd", "corp", "corporation"
]);

export function evaluateProspectPlace(seed: ProspectPlaceSeed, place: ProspectPlaceCandidate): ProspectPlaceEvaluation {
  const reasons: string[] = [];
  const placeName = place.displayName?.text?.trim() ?? "";
  const placeAddress = prospectAddressFromGoogleComponents(place.addressComponents);
  const sourceRegion = seed.region?.trim().toUpperCase();
  const candidateRegion = placeAddress.region ?? regionFromFormattedAddress(place.formattedAddress);
  const sameRegion = Boolean(sourceRegion && candidateRegion && sourceRegion === candidateRegion);
  const regionConflict = Boolean(sourceRegion && candidateRegion && sourceRegion !== candidateRegion);
  const sourceCounty = normalizedCounty(seed.county);
  const candidateCounty = normalizedCounty(placeAddress.county);
  const sameCounty = Boolean(sourceCounty && candidateCounty && sourceCounty === candidateCounty);
  const countyConflict = Boolean(sourceCounty && candidateCounty && sourceCounty !== candidateCounty);
  const samePhone = Boolean(normalizedPhone(seed.phone) && normalizedPhone(seed.phone) === normalizedPhone(place.nationalPhoneNumber));
  const sameWebsite = Boolean(seed.websiteUrl && place.websiteUri && hostname(seed.websiteUrl) === hostname(place.websiteUri));
  const samePostal = Boolean(seed.postalCode && placeAddress.postal_code && normalizedPostal(seed.postalCode) === normalizedPostal(placeAddress.postal_code));
  const sameLocality = Boolean(seed.locality && placeAddress.locality && normalizedText(seed.locality) === normalizedText(placeAddress.locality));
  const sourceStreetNumber = seed.addressLine1?.match(/^\s*(\d+)/)?.[1];
  const candidateStreetNumber = placeAddress.address_line_1?.match(/^\s*(\d+)/)?.[1];
  const sameStreet = Boolean(sourceStreetNumber && candidateStreetNumber && sourceStreetNumber === candidateStreetNumber && samePostal);
  const name = nameAgreement(seed.names, placeName);
  const primaryType = place.primaryType?.toLowerCase();
  const types = new Set([primaryType, ...(place.types ?? []).map((type) => type.toLowerCase())].filter(Boolean));
  const categoryText = `${place.primaryTypeDisplayName?.text ?? ""} ${placeName}`;
  const verifiedPestBusiness = types.has("pest_control_service") || pestTerms.test(categoryText);
  const strongIdentityAgreement = samePhone || sameWebsite || sameStreet;
  const operational = place.businessStatus !== "CLOSED_PERMANENTLY";
  // The source roster is a discovery seed, not an identity authority. A county
  // mismatch lowers confidence and is retained for review, but a verified pest
  // business with a compatible name in the same state is still a valid Place-led
  // prospect. State conflicts remain disqualifying.
  const geographyCompatible = !regionConflict;

  let score = 0;
  if (verifiedPestBusiness) { score += 4; reasons.push("verified_pest_business"); }
  if (place.businessStatus === "OPERATIONAL") { score += 1; reasons.push("operational"); }
  if (name.exact) { score += 8; reasons.push("exact_normalized_name"); }
  else if (name.brandExact) { score += 6; reasons.push("same_distinctive_name"); }
  else if (name.compatible) { score += 4; reasons.push("compatible_name"); }
  if (sameRegion) { score += 3; reasons.push("same_state"); }
  if (sameLocality) { score += 2; reasons.push("same_city"); }
  if (sameCounty) { score += 2; reasons.push("same_county"); }
  if (countyConflict) score -= 2;
  if (samePostal) { score += 4; reasons.push("same_postal_code"); }
  if (sameStreet) { score += 2; reasons.push("same_street_number"); }
  if (samePhone) { score += 6; reasons.push("same_phone"); }
  if (sameWebsite) { score += 6; reasons.push("same_website"); }
  if (regionConflict) reasons.push("conflicting_state");
  if (countyConflict) reasons.push("conflicting_county");
  if (!operational) reasons.push("permanently_closed");
  if (!verifiedPestBusiness) reasons.push("not_verified_as_pest_business");
  if (!name.compatible && !strongIdentityAgreement) reasons.push("name_not_compatible");

  return {
    plausible: operational
      && verifiedPestBusiness
      && geographyCompatible
      && (name.compatible || strongIdentityAgreement),
    score,
    verifiedPestBusiness,
    compatibleName: name.compatible,
    geographyCompatible,
    strongIdentityAgreement,
    reasons
  };
}

function nameAgreement(sourceNames: string[], candidateName: string) {
  const candidate = normalizedBusinessName(candidateName);
  const candidateBrand = distinctiveName(candidate);
  let compatible = false;
  let exact = false;
  let brandExact = false;
  for (const sourceName of sourceNames) {
    const source = normalizedBusinessName(sourceName);
    if (!source || !candidate) continue;
    const sourceBrand = distinctiveName(source);
    const sourceCompact = source.replaceAll(" ", "");
    const candidateCompact = candidate.replaceAll(" ", "");
    const exactForName = source === candidate || sourceCompact === candidateCompact;
    const brandForName = Boolean(sourceBrand && candidateBrand && sourceBrand === candidateBrand);
    const sourceBrandTokens = sourceBrand.split(" ").filter(Boolean);
    const candidateBrandTokens = candidateBrand.split(" ").filter(Boolean);
    const optionalLeadingA = optionalLeadingAAgreement(sourceBrandTokens, candidateBrandTokens);
    const sourceTokens = new Set(sourceBrandTokens);
    const candidateTokens = new Set(candidateBrandTokens);
    const overlap = [...sourceTokens].filter((token) => candidateTokens.has(token)).length;
    const tokenAgreement = overlap >= 2 && overlap / Math.max(sourceTokens.size, candidateTokens.size) >= 0.75;
    const containedBrand = sourceTokens.size >= 2 && isSubset(sourceTokens, candidateTokens);
    exact ||= exactForName;
    brandExact ||= brandForName;
    compatible ||= exactForName || brandForName || optionalLeadingA || tokenAgreement || containedBrand;
  }
  return { compatible, exact, brandExact };
}

function optionalLeadingAAgreement(left: string[], right: string[]) {
  if (!left.length || !right.length) return false;

  // State registries often prefix a name with a standalone "A" for alphabetic
  // placement (for example, "A Aardvark" versus "Aardvark"). Treat only that
  // exact prefix as optional; arbitrary numeric or brand prefixes remain material.
  if (left[0] === "a" && arraysEqual(left.slice(1), right)) return true;
  if (right[0] === "a" && arraysEqual(right.slice(1), left)) return true;
  return false;
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSubset(left: Set<string>, right: Set<string>) {
  return [...left].every((value) => right.has(value));
}

function normalizedBusinessName(value: string) {
  return value.toLowerCase()
    .replaceAll("&", " and ")
    .replaceAll("+", " plus ")
    .replace(/\b1st\b/g, "first")
    .replace(/\b2nd\b/g, "second")
    .replace(/\b3rd\b/g, "third")
    .replace(/\bmgmnt\b|\bmgmt\b/g, "management")
    .replace(/\bctl\b/g, "control")
    .replace(/\btx\b/g, "texas")
    .replace(/\ba\s+2\s+z\b/g, "a to z")
    .replace(/\b(llc|inc|incorporated|corp|corporation|company|co|ltd|pllc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distinctiveName(value: string) {
  return value.split(" ").filter((token) => token && !genericNameTokens.has(token)).join(" ");
}

function regionFromFormattedAddress(value?: string) {
  return value?.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?:,|\s)/)?.[1];
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedPostal(value: string) {
  return value.replace(/\D/g, "").slice(0, 5);
}

function normalizedCounty(value?: string | null) {
  return value?.toLowerCase().replace(/\b(county|parish|borough|census area|municipality)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim() || undefined;
}

function normalizedPhone(value?: string | null) {
  return value?.replace(/\D/g, "").slice(-10) || undefined;
}

function hostname(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}
