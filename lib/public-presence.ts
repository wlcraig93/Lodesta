import type { CrawlAssessment, ExtractedBusinessFacts } from "./crawler";
import type { FieldProvenance, PublicPresenceSignal } from "./presence-contracts";

export type PublicPresenceEnrichment = {
  provider: "google_places";
  observedAt: string;
  signals: PublicPresenceSignal[];
  facts: Partial<ExtractedBusinessFacts>;
  provenance: Record<string, FieldProvenance>;
  notes: string[];
};

type PublicPresenceInput = {
  url?: string;
  prompt?: string;
  crawl?: CrawlAssessment;
};

const placesFieldMask = [
  "places.id",
  "places.name",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.regularOpeningHours",
  "places.businessStatus"
].join(",");

export async function gatherPublicPresenceSignals(input: PublicPresenceInput): Promise<PublicPresenceEnrichment | undefined> {
  const observedAt = new Date().toISOString();
  const crawlPlaceId = publicPresenceFromCrawlPlaceId(input, observedAt);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return crawlPlaceId;

  const textQuery = buildTextQuery(input);
  if (!textQuery) {
    return crawlPlaceId ?? {
      provider: "google_places",
      observedAt,
      signals: [],
      facts: {},
      provenance: {},
      notes: ["Google Places enrichment was configured, but no business name, address, URL, or prompt was available for Text Search."]
    };
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": placesFieldMask
      },
      body: JSON.stringify({
        textQuery,
        pageSize: 1,
        regionCode: "US"
      }),
      signal: AbortSignal.timeout(8000)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(googleErrorMessage(payload) ?? `Google Places Text Search failed with status ${response.status}`);
    }

    const place = firstPlace(payload);
    if (!place) {
      return {
        provider: "google_places",
        observedAt,
        signals: [],
        facts: {},
        provenance: {},
        notes: [`Google Places Text Search returned no candidate for "${textQuery}".`]
      };
    }
    const enrichment = placeToPublicPresenceEnrichment(place, input, textQuery, observedAt);
    if (!crawlPlaceId) return enrichment;
    const placeIds = new Set(enrichment.signals.map((signal) => signal.placeId).filter(Boolean));
    return {
      ...enrichment,
      signals: [...enrichment.signals, ...crawlPlaceId.signals.filter((signal) => !signal.placeId || !placeIds.has(signal.placeId))],
      notes: [...enrichment.notes, ...crawlPlaceId.notes]
    };
  } catch (error) {
    const failureNote = `Google Places enrichment unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return crawlPlaceId
      ? {
          ...crawlPlaceId,
          notes: [...crawlPlaceId.notes, failureNote]
        }
      : {
          provider: "google_places",
          observedAt,
          signals: [],
          facts: {},
          provenance: {},
          notes: [failureNote]
        };
  }
}

function publicPresenceFromCrawlPlaceId(input: PublicPresenceInput, observedAt: string): PublicPresenceEnrichment | undefined {
  const placeId = firstCrawlGooglePlaceId(input.crawl);
  if (!placeId) return undefined;
  const confidence = 0.7;
  const signal: PublicPresenceSignal = {
    id: `presence_google_places_${safeId(placeId)}`,
    siteId: input.crawl?.extractedFacts.name ? `site_${safeId(input.crawl.extractedFacts.name)}` : "site_pending",
    provider: "google_places",
    source: "google",
    placeId,
    confidence,
    observedAt,
    fields: {},
    provenance: {
      placeId: {
        source: "website",
        sourceUrl: input.url,
        confidence,
        verified: false,
        observedAt
      }
    },
    notes: [
      "Google place_id discovered from a crawled website link.",
      "Only place_id is retained for compliant live Google link resolution; ratings, review counts, review text, and resolved Maps URLs are not serialized."
    ]
  };
  return {
    provider: "google_places",
    observedAt,
    signals: [signal],
    facts: {},
    provenance: signal.provenance,
    notes: ["Google place_id captured from crawl for live-only proof/link display."]
  };
}

function firstCrawlGooglePlaceId(crawl: CrawlAssessment | undefined) {
  const links = [...(crawl?.linkReferences ?? []), ...(crawl?.pageSummaries ?? []).flatMap((page) => page.linkReferences)];
  for (const link of links) {
    const placeId = googlePlaceIdFromHref(link.href);
    if (placeId) return placeId;
  }
  return undefined;
}

function googlePlaceIdFromHref(href: string) {
  try {
    const url = new URL(href);
    const candidate = url.searchParams.get("query_place_id") ?? url.searchParams.get("placeid") ?? url.searchParams.get("place_id");
    return candidate && /^[A-Za-z0-9:_-]{8,256}$/.test(candidate) ? candidate : undefined;
  } catch {
    const match = href.match(/[?&](?:query_place_id|placeid|place_id)=([A-Za-z0-9:_-]{8,256})/i);
    return match?.[1];
  }
}

export function placeToPublicPresenceEnrichment(
  place: Record<string, unknown>,
  input: PublicPresenceInput,
  textQuery: string,
  observedAt: string
): PublicPresenceEnrichment {
  const websiteUri = stringValue(place.websiteUri);
  const displayName = localizedText(place.displayName);
  const address = addressFromPlace(place);
  const geo = geoFromPlace(place.location);
  const categories = categoriesFromPlace(place);
  const phone = stringValue(place.nationalPhoneNumber) ?? stringValue(place.internationalPhoneNumber);
  const hours = hoursFromPlace(place.regularOpeningHours);
  const match = placeMatchAssessment({
    sourceUrl: input.url,
    websiteUri,
    placeName: displayName,
    crawlName: input.crawl?.extractedFacts.name,
    placePhone: phone,
    crawlPhone: input.crawl?.extractedFacts.phone,
    placeCity: address?.city,
    crawlCity: input.crawl?.extractedFacts.address?.city,
    textQuery
  });
  const confidence = match.confidence;
  const sourceUrl = undefined;
  const acceptedFacts: Partial<ExtractedBusinessFacts> = match.accepted
    ? {
        name: displayName,
        phone,
        address,
        geo,
        hours,
        categories
      }
    : {};
  const provenance = buildPlacesProvenance({
    sourceUrl,
    observedAt,
    confidence,
    fields: {
      name: acceptedFacts.name,
      phone: acceptedFacts.phone,
      address: acceptedFacts.address,
      geo: acceptedFacts.geo,
      hours: acceptedFacts.hours,
      categories: acceptedFacts.categories?.length ? acceptedFacts.categories : undefined
    }
  });
  const signal: PublicPresenceSignal = {
    id: `presence_google_places_${safeId(stringValue(place.id) ?? stringValue(place.name) ?? displayName ?? textQuery)}`,
    siteId: input.crawl?.extractedFacts.name ? `site_${safeId(input.crawl.extractedFacts.name)}` : "site_pending",
    provider: "google_places",
    source: "places_api",
    sourceUrl,
    placeId: stringValue(place.id) ?? stringValue(place.name)?.replace(/^places\//, ""),
    confidence,
    observedAt,
    fields: {
      name: displayName,
      phone,
      websiteUri,
      address,
      geo,
      categories,
      hours
    },
    provenance,
    notes: [
      `Matched from Text Search query "${textQuery}".`,
      ...match.reasons,
      ...(match.accepted ? ["Places candidate accepted for fact merge."] : ["Places candidate retained as evidence but not merged into renderable facts."]),
      "Places facts remain unverified owner-truth until claim."
    ]
  };

  return {
    provider: "google_places",
    observedAt,
    signals: [signal],
    facts: acceptedFacts,
    provenance,
    notes: [
      `Google Places candidate captured with ${Math.round(confidence * 100)}% confidence.`,
      match.accepted
        ? "Google Places candidate accepted for business fact enrichment."
        : "Google Places candidate was not merged because it did not confidently match the source business."
    ]
  };
}

function buildTextQuery(input: PublicPresenceInput) {
  const facts = input.crawl?.extractedFacts;
  const locality = [facts?.address?.city, facts?.address?.region].filter(Boolean).join(", ");
  if (facts?.name && locality) return `${facts.name} ${locality}`;
  if (facts?.name) return facts.name;
  if (input.prompt) return input.prompt.slice(0, 180);
  if (!input.url) return undefined;
  const url = new URL(input.url);
  return url.hostname.replace(/^www\./, "").replace(/\.[a-z]{2,}$/i, "").replace(/[-.]/g, " ");
}

function buildPlacesProvenance({
  sourceUrl,
  observedAt,
  confidence,
  fields
}: {
  sourceUrl?: string;
  observedAt: string;
  confidence: number;
  fields: Record<string, unknown>;
}) {
  const provenance: Record<string, FieldProvenance> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    provenance[field] = {
      source: "places_api",
      sourceUrl,
      confidence,
      verified: false,
      observedAt
    };
  }
  return provenance;
}

function placeMatchAssessment(input: {
  sourceUrl?: string;
  websiteUri?: string;
  placeName?: string;
  crawlName?: string;
  placePhone?: string;
  crawlPhone?: string;
  placeCity?: string;
  crawlCity?: string;
  textQuery: string;
}) {
  const reasons: string[] = [];
  let confidence = input.sourceUrl || input.crawlName || input.crawlPhone ? 0.42 : 0.56;
  const sourceHost = input.sourceUrl ? hostName(input.sourceUrl) : "";
  const placeHost = input.websiteUri ? hostName(input.websiteUri) : "";
  const hostMatches = Boolean(sourceHost && placeHost && sourceHost === placeHost);
  const hostConflicts = Boolean(sourceHost && placeHost && sourceHost !== placeHost);
  const exactNameMatch = Boolean(input.placeName && input.crawlName && safeId(input.placeName) === safeId(input.crawlName));
  const looseNameMatches = namesLooselyMatch(input.placeName, input.crawlName);
  const phoneMatches = Boolean(input.placePhone && input.crawlPhone && phoneDigits(input.placePhone) === phoneDigits(input.crawlPhone));
  const cityMatches = Boolean(input.placeCity && input.crawlCity && safeId(input.placeCity) === safeId(input.crawlCity));
  const promptNameMatches = Boolean(!input.crawlName && input.placeName && safeId(input.textQuery).includes(safeId(input.placeName)));

  if (hostMatches) {
    confidence += 0.3;
    reasons.push("Place website host matches the submitted source URL.");
  } else if (hostConflicts) {
    confidence -= 0.2;
    reasons.push("Place website host differs from the submitted source URL.");
  }
  if (exactNameMatch) {
    confidence += 0.24;
    reasons.push("Place name exactly matches the crawled business name.");
  } else if (looseNameMatches) {
    confidence += 0.16;
    reasons.push("Place name is similar to the crawled business name.");
  } else if (input.placeName && input.crawlName) {
    confidence -= 0.16;
    reasons.push("Place name differs from the crawled business name.");
  }
  if (phoneMatches) {
    confidence += 0.18;
    reasons.push("Place phone matches the crawled phone number.");
  } else if (input.placePhone && input.crawlPhone) {
    confidence -= 0.08;
    reasons.push("Place phone differs from the crawled phone number.");
  }
  if (cityMatches) {
    confidence += 0.06;
    reasons.push("Place city matches the crawled address city.");
  }
  if (promptNameMatches) {
    confidence += 0.16;
    reasons.push("Place name appears in the prompt/query.");
  }

  confidence = Math.max(0.1, Math.min(confidence, 0.94));
  const accepted = confidence >= 0.74 && !(hostConflicts && !exactNameMatch && !looseNameMatches && !phoneMatches);
  return { confidence, accepted, reasons };
}

function hostName(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function firstPlace(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.places)) return undefined;
  return payload.places.find(isRecord);
}

function addressFromPlace(place: Record<string, unknown>): ExtractedBusinessFacts["address"] | undefined {
  const components = arrayOfRecords(place.addressComponents);
  const byType = (type: string) => components.find((component) => stringArray(component.types).includes(type));
  const street = [stringValue(byType("street_number")?.longText), stringValue(byType("route")?.longText)]
    .filter(Boolean)
    .join(" ");
  const formattedAddress = stringValue(place.formattedAddress);
  const address = {
    street: street || formattedAddress,
    city: stringValue(byType("locality")?.longText) ?? stringValue(byType("postal_town")?.longText),
    region: stringValue(byType("administrative_area_level_1")?.shortText),
    postalCode: stringValue(byType("postal_code")?.longText),
    country: stringValue(byType("country")?.shortText)
  };
  return Object.values(address).some(Boolean) ? address : undefined;
}

function geoFromPlace(value: unknown): ExtractedBusinessFacts["geo"] | undefined {
  if (!isRecord(value)) return undefined;
  const latitude = numberValue(value.latitude);
  const longitude = numberValue(value.longitude);
  return latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
}

function categoriesFromPlace(place: Record<string, unknown>) {
  return [
    localizedText(place.primaryTypeDisplayName),
    ...stringArray(place.types)
      .map((type) => type.replace(/_/g, " "))
      .filter((type) => !/^(point of interest|establishment|food)$/i.test(type))
  ]
    .filter((value): value is string => Boolean(value))
    .slice(0, 8);
}

function hoursFromPlace(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.weekdayDescriptions)) return undefined;
  const entries = value.weekdayDescriptions.filter((item): item is string => typeof item === "string");
  return entries.length ? Object.fromEntries(entries.map((entry, index) => [`weekday_${index + 1}`, entry])) : undefined;
}

function localizedText(value: unknown) {
  if (!isRecord(value)) return undefined;
  return stringValue(value.text);
}

function googleErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  return typeof payload.error.message === "string" ? payload.error.message : undefined;
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function namesLooselyMatch(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const leftTerms = significantTerms(left);
  const rightTerms = significantTerms(right);
  if (!leftTerms.size || !rightTerms.size) return false;
  const overlap = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  return overlap >= Math.min(2, leftTerms.size, rightTerms.size);
}

function significantTerms(value: string) {
  const stop = new Set(["the", "and", "of", "llc", "inc", "co", "company", "restaurant", "services", "service", "group"]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((term) => term.replace(/s$/, ""))
      .filter((term) => term.length >= 3 && !stop.has(term))
  );
}

function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function safeId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
