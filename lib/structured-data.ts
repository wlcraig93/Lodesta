import type { BusinessLocationRecord, BusinessProfile, SiteLocationBinding, SiteModel } from "./models";

type LocalBusinessJsonLdOptions = {
  url?: string;
};

export function makeLocalBusinessJsonLd(business: BusinessProfile, options: LocalBusinessJsonLdOptions = {}) {
  if (!schemaEligible(business, "name")) return null;

  return compactJsonLd({
    "@context": "https://schema.org",
    "@type": schemaTypeForBusiness(business),
    name: business.name,
    url: options.url,
    telephone: schemaEligible(business, "phone") ? business.phone : undefined,
    email: schemaEligible(business, "email", { requireVerified: true }) ? business.email : undefined,
    image: schemaImageForBusiness(business),
    address: schemaEligible(business, "address") && business.address
      ? {
          "@type": "PostalAddress",
          streetAddress: business.address.street,
          addressLocality: business.address.city,
          addressRegion: business.address.region,
          postalCode: business.address.postalCode,
          addressCountry: business.address.country
        }
      : undefined,
    geo: schemaEligible(business, "geo") && business.geo
      ? {
          "@type": "GeoCoordinates",
          latitude: business.geo.latitude,
          longitude: business.geo.longitude
        }
      : undefined,
    areaServed: schemaEligible(business, "serviceAreas") && business.serviceAreas.length
      ? business.serviceAreas.map((area) => ({ "@type": "Place", name: area }))
      : undefined,
    aggregateRating: verified(business, "reviewsSummary") && schemaSafeReviewSummary(business)
      ? {
          "@type": "AggregateRating",
          ratingValue: business.reviewsSummary.rating,
          reviewCount: business.reviewsSummary.count
        }
      : undefined,
    openingHoursSpecification: schemaEligible(business, "hours") && business.hours ? openingHoursSpecifications(business.hours) : undefined,
    hasOfferCatalog: schemaEligible(business, "services") && business.services.length ? serviceOfferCatalog(business.services) : undefined,
    sameAs: schemaEligible(business, "socialLinks") && business.socialLinks.length ? business.socialLinks : undefined
  });
}

export function makeLocalBusinessJsonLdForBundle(input: {
  business: BusinessProfile;
  site?: Pick<SiteModel, "slug">;
  url?: string;
  locations?: BusinessLocationRecord[];
  locationBindings?: SiteLocationBinding[];
}) {
  const base = makeLocalBusinessJsonLd(input.business, { url: input.url ?? (input.site ? `/sites/${input.site.slug}` : undefined) });
  if (!base) return null;
  const locations = input.locations ?? [];
  if (locations.length <= 1) return base;

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const orderedLocations = (input.locationBindings?.length
    ? input.locationBindings
        .map((binding) => locationById.get(binding.locationId))
        .filter((location): location is BusinessLocationRecord => Boolean(location))
    : locations
  ).filter((location) => verifiedLocation(location, "address") && location.address);

  const locationNodes = orderedLocations
    .map((location, index) => locationJsonLd(input.business, location, index))
    .filter((location): location is Record<string, unknown> => Boolean(location));

  if (!locationNodes.length) return base;
  const baseNode: Record<string, unknown> | undefined = base && typeof base === "object" && !Array.isArray(base)
    ? { ...(base as Record<string, unknown>), "@id": "#business" }
    : undefined;
  if (baseNode) delete baseNode["@context"];
  return compactJsonLd({
    "@context": "https://schema.org",
    "@graph": [baseNode, ...locationNodes]
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

function schemaEligible(business: BusinessProfile, field: string, options: { requireVerified?: boolean } = {}) {
  const provenance = business.provenance[field];
  if (!provenance) return false;
  if (provenance.verified) return provenance.source !== "google" && provenance.source !== "places_api";
  if (options.requireVerified) return false;
  if (provenance.source !== "website") return false;
  return provenance.confidence >= schemaConfidenceFloor(field);
}

function schemaConfidenceFloor(field: string) {
  if (field === "name") return 0.7;
  if (field === "phone" || field === "address" || field === "hours") return 0.65;
  if (field === "geo") return 0.7;
  return 0.75;
}

function verifiedLocation(location: BusinessLocationRecord, field: string) {
  const provenance = location.provenance[field];
  if (!provenance) return false;
  if (provenance.verified) return provenance.source === "owner" || provenance.source === "manual" || provenance.source === "website";
  return provenance.source === "website" && provenance.confidence >= schemaConfidenceFloor(field);
}

function locationJsonLd(business: BusinessProfile, location: BusinessLocationRecord, index: number) {
  if (!verifiedLocation(location, "address") || !location.address) return undefined;
  return compactJsonLd({
    "@type": schemaTypeForBusiness(business),
    "@id": `#location-${index + 1}`,
    name: [business.name, location.label].filter(Boolean).join(" - "),
    parentOrganization: { "@id": "#business" },
    telephone: verifiedLocation(location, "phone") ? location.phone : undefined,
    email: verifiedLocation(location, "email") ? location.email : undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: location.address.street,
      addressLocality: location.address.city,
      addressRegion: location.address.region,
      postalCode: location.address.postalCode,
      addressCountry: location.address.country
    },
    geo: verifiedLocation(location, "geo") && location.geo
      ? {
          "@type": "GeoCoordinates",
          latitude: location.geo.latitude,
          longitude: location.geo.longitude
        }
      : undefined,
    areaServed: verifiedLocation(location, "serviceAreas") && location.serviceAreas.length
      ? location.serviceAreas.map((area) => ({ "@type": "Place", name: area }))
      : undefined,
    openingHoursSpecification: verifiedLocation(location, "hours") && location.hours ? openingHoursSpecifications(location.hours) : undefined
  });
}

function schemaImageForBusiness(business: BusinessProfile) {
  const asset = business.photos.find(isSchemaSafeImage) ?? (business.logo && isSchemaSafeImage(business.logo) ? business.logo : undefined);
  return asset?.url;
}

function isSchemaSafeImage(asset: BusinessProfile["photos"][number]) {
  return asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe";
}

function serviceOfferCatalog(services: string[]) {
  return {
    "@type": "OfferCatalog",
    name: "Services",
    itemListElement: services.slice(0, 12).map((service) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: service
      }
    }))
  };
}

function openingHoursSpecifications(hours: Record<string, string>) {
  const specs = Object.entries(hours)
    .map(([day, value]) => {
      const parsed = parseHoursRange(value);
      const dayOfWeek = schemaDayOfWeek(day);
      if (!parsed || !dayOfWeek) return undefined;
      return {
        "@type": "OpeningHoursSpecification",
        dayOfWeek,
        opens: parsed.opens,
        closes: parsed.closes
      };
    })
    .filter((spec): spec is { "@type": "OpeningHoursSpecification"; dayOfWeek: string | string[]; opens: string; closes: string } => Boolean(spec));
  return specs.length ? specs : undefined;
}

function schemaDayOfWeek(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("-")) {
    const [start, end] = normalized.split(/\s*-\s*/, 2);
    const startDay = schemaDayOfWeek(start);
    const endDay = schemaDayOfWeek(end);
    if (typeof startDay !== "string" || typeof endDay !== "string") return undefined;
    const ordered = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const startIndex = ordered.indexOf(startDay);
    const endIndex = ordered.indexOf(endDay);
    if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return undefined;
    return ordered.slice(startIndex, endIndex + 1);
  }
  const map: Record<string, string> = {
    monday: "Monday",
    mon: "Monday",
    tuesday: "Tuesday",
    tue: "Tuesday",
    tues: "Tuesday",
    wednesday: "Wednesday",
    wed: "Wednesday",
    thursday: "Thursday",
    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",
    friday: "Friday",
    fri: "Friday",
    saturday: "Saturday",
    sat: "Saturday",
    sunday: "Sunday",
    sun: "Sunday"
  };
  return map[normalized];
}

function parseHoursRange(value: string) {
  const normalized = value.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!normalized || /\bclosed\b/i.test(normalized)) return undefined;
  const [openRaw, closeRaw] = normalized.split(/\s*-\s*/, 2);
  if (!openRaw || !closeRaw) return undefined;
  const opens = parseTime(openRaw);
  const closes = parseTime(closeRaw);
  return opens && closes ? { opens, closes } : undefined;
}

function parseTime(value: string) {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.replace(/\./g, "");
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return undefined;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function schemaSafeReviewSummary(
  business: BusinessProfile
): business is BusinessProfile & { reviewsSummary: { rating: number; count?: number; sources: string[] } } {
  return Boolean(
    business.reviewsSummary?.rating &&
      business.reviewsSummary.sources.length > 0 &&
      !business.reviewsSummary.sources.includes("google_places")
  );
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
      return "AutoBodyShop";
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
