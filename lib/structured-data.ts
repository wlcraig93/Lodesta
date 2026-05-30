import type { BusinessProfile } from "./models";

export function makeLocalBusinessJsonLd(business: BusinessProfile) {
  if (!verified(business, "name")) return null;

  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": schemaTypeForBusiness(business),
    name: business.name,
    telephone: verified(business, "phone") ? business.phone : undefined,
    email: verified(business, "email") ? business.email : undefined,
    address: verified(business, "address") && business.address
      ? {
          "@type": "PostalAddress",
          streetAddress: business.address.street,
          addressLocality: business.address.city,
          addressRegion: business.address.region,
          postalCode: business.address.postalCode,
          addressCountry: business.address.country
        }
      : undefined,
    geo: verified(business, "geo") && business.geo
      ? {
          "@type": "GeoCoordinates",
          latitude: business.geo.latitude,
          longitude: business.geo.longitude
        }
      : undefined,
    areaServed: verified(business, "serviceAreas") && business.serviceAreas.length
      ? business.serviceAreas.map((area) => ({ "@type": "Place", name: area }))
      : undefined,
    aggregateRating: verified(business, "reviewsSummary") && business.reviewsSummary?.rating
      ? {
          "@type": "AggregateRating",
          ratingValue: business.reviewsSummary.rating,
          reviewCount: business.reviewsSummary.count
        }
      : undefined,
    openingHours: verified(business, "hours") && business.hours
      ? Object.entries(business.hours).map(([day, hours]) => `${day} ${hours}`)
      : undefined,
    sameAs: verified(business, "socialLinks") && business.socialLinks.length ? business.socialLinks : undefined
  });
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function verified(business: BusinessProfile, field: string) {
  return business.provenance[field]?.verified === true;
}

function schemaTypeForBusiness(business: BusinessProfile) {
  switch (business.vertical) {
    case "restaurant":
      return "Restaurant";
    case "dental":
      return "Dentist";
    case "law_firm":
      return "LegalService";
    case "home_services":
    case "landscaping":
      return "HomeAndConstructionBusiness";
    case "auto_body":
      return "AutoRepair";
    case "beauty_salon":
      return "BeautySalon";
    case "veterinary":
      return "VeterinaryCare";
    default:
      return "LocalBusiness";
  }
}

function compactJsonLd(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compactJsonLd).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, child]) => [key, compactJsonLd(child)] as const)
      .filter(([, child]) => child !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === undefined || value === "" ? undefined : value;
}
