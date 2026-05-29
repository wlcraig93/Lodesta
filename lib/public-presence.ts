import type { CrawlAssessment, ExtractedBusinessFacts } from "./crawler";
import type { FieldProvenance, PublicPresenceSignal } from "./models";

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
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.regularOpeningHours",
  "places.businessStatus"
].join(",");

export async function gatherPublicPresenceSignals(input: PublicPresenceInput): Promise<PublicPresenceEnrichment | undefined> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return undefined;

  const observedAt = new Date().toISOString();
  const textQuery = buildTextQuery(input);
  if (!textQuery) {
    return {
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
    return placeToEnrichment(place, input, textQuery, observedAt);
  } catch (error) {
    return {
      provider: "google_places",
      observedAt,
      signals: [],
      facts: {},
      provenance: {},
      notes: [`Google Places enrichment unavailable: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

function placeToEnrichment(
  place: Record<string, unknown>,
  input: PublicPresenceInput,
  textQuery: string,
  observedAt: string
): PublicPresenceEnrichment {
  const googleMapsUri = stringValue(place.googleMapsUri);
  const websiteUri = stringValue(place.websiteUri);
  const displayName = localizedText(place.displayName);
  const address = addressFromPlace(place);
  const geo = geoFromPlace(place.location);
  const categories = categoriesFromPlace(place);
  const phone = stringValue(place.nationalPhoneNumber) ?? stringValue(place.internationalPhoneNumber);
  const rating = numberValue(place.rating);
  const userRatingCount = numberValue(place.userRatingCount);
  const hours = hoursFromPlace(place.regularOpeningHours);
  const confidence = matchConfidence(input.url, websiteUri, displayName, input.crawl?.extractedFacts.name);
  const sourceUrl = googleMapsUri;
  const facts: Partial<ExtractedBusinessFacts> = {
    name: displayName,
    phone,
    address,
    geo,
    hours,
    categories,
    reviewsSummary:
      rating || userRatingCount
        ? {
            rating,
            count: userRatingCount,
            sources: ["google_places"]
          }
        : undefined
  };
  const provenance = buildPlacesProvenance({
    sourceUrl,
    observedAt,
    confidence,
    fields: {
      name: displayName,
      phone,
      address,
      geo,
      hours,
      categories: categories.length ? categories : undefined,
      reviewsSummary: facts.reviewsSummary
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
      googleMapsUri,
      address,
      geo,
      categories,
      hours,
      rating,
      userRatingCount
    },
    provenance,
    notes: [
      `Matched from Text Search query "${textQuery}".`,
      "Places facts remain unverified owner-truth until claim."
    ]
  };

  return {
    provider: "google_places",
    observedAt,
    signals: [signal],
    facts,
    provenance,
    notes: [`Google Places candidate captured with ${Math.round(confidence * 100)}% confidence.`]
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

function matchConfidence(sourceUrl: string | undefined, websiteUri: string | undefined, placeName?: string, crawlName?: string) {
  let confidence = 0.72;
  if (sourceUrl && websiteUri && hostName(sourceUrl) === hostName(websiteUri)) confidence += 0.12;
  if (placeName && crawlName && safeId(placeName) === safeId(crawlName)) confidence += 0.08;
  return Math.min(confidence, 0.92);
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
    ...stringArray(place.types).map((type) => type.replace(/_/g, " "))
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
