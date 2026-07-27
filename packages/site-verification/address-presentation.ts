import type { PublicFact, SitePublicBuildInput } from "@/packages/site-contracts";

export type LocalAddressPresentation = {
  fact: PublicFact;
  location: SitePublicBuildInput["business"]["locations"][number];
  value: string;
};

/**
 * Derives the customer-facing address from retained controller truth. Rendered
 * data attributes identify a candidate SDK binding; they are never treated as
 * authority for the expected text.
 */
export function localAddressPresentation(
  buildInput: SitePublicBuildInput,
  locationId: string,
  factId: string
): LocalAddressPresentation | undefined {
  const location = buildInput.business.locations.find((item) => item.id === locationId);
  if (!location || !location.sourceFactIds.includes(factId)) return undefined;
  const fact = buildInput.publicFacts.find((item) => item.id === factId && item.kind === "address");
  if (!fact) return undefined;
  assertUsCountry(location.country);
  const locality = [location.city, location.region].filter(Boolean).join(", ");
  const localityAndPostal = [locality, location.postalCode].filter(Boolean).join(" ");
  return {
    fact,
    location,
    value: [location.street, localityAndPostal].filter(Boolean).join(", ")
  };
}

function assertUsCountry(value: string | undefined) {
  if (!value || value.toUpperCase() === "US") return;
  throw new Error(`BusinessAddress.local supports US locations only; received ${value}.`);
}
