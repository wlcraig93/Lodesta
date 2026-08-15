import type { ProspectCandidate } from "./contracts";
import { prospectResearchStates } from "./contracts";

export const prospectExplorerFieldKeys = [
  "business_name",
  "vertical",
  "research_state",
  "website_url",
  "website_platform",
  "website_agency_provider",
  "business_email",
  "address_line_1",
  "address_line_2",
  "locality",
  "region",
  "postal_code",
  "country_code",
  "county",
  "location_phone",
  "google_business_name",
  "google_category",
  "google_address",
  "google_phone",
  "google_website_url",
  "google_maps_url",
  "google_rating",
  "google_review_count",
  "google_place_id",
  "primary_contact_name",
  "primary_contact_role",
  "primary_contact_email",
  "primary_contact_phone",
  "outreach_email",
  "outreach_phone",
  "created_at",
  "updated_at",
  "id",
  "canonical_key"
] as const;

export type ProspectExplorerFieldKey = (typeof prospectExplorerFieldKeys)[number];
export type ProspectExplorerFieldKind = "text" | "option" | "number" | "date";
export type ProspectExplorerFieldCategory = "Business" | "Location" | "Google" | "Website" | "Contacts" | "System";
export type ProspectExplorerFieldWidth = "compact" | "standard" | "wide";

export const prospectFilterOperators = [
  "contains", "equals", "not_equals", "greater_than", "greater_than_or_equal",
  "less_than", "less_than_or_equal", "is_empty", "is_not_empty"
] as const;
export type ProspectFilterOperator = (typeof prospectFilterOperators)[number];

export type ProspectCandidateFilter = { field: ProspectExplorerFieldKey; operator: ProspectFilterOperator; value?: string };
export type ProspectCandidateQuery = {
  search?: string;
  filters?: ProspectCandidateFilter[];
  sortBy?: ProspectExplorerFieldKey;
  sortDirection?: "asc" | "desc";
  offset?: number;
  limit?: number;
};
export type ProspectExplorerField = {
  key: ProspectExplorerFieldKey;
  label: string;
  category: ProspectExplorerFieldCategory;
  kind: ProspectExplorerFieldKind;
  width: ProspectExplorerFieldWidth;
  options?: Array<{ value: string; label: string }>;
};

const option = (value: string, label = humanizeExplorerValue(value)) => ({ value, label });
const states = prospectResearchStates.map((value) => option(value));

export const prospectExplorerFields: Record<ProspectExplorerFieldKey, ProspectExplorerField> = {
  business_name: field("business_name", "Business name", "Business", "text", "wide"),
  vertical: field("vertical", "Industry", "Business", "text", "standard"),
  research_state: field("research_state", "Research state", "Business", "option", "standard", states),
  website_url: field("website_url", "Website URL", "Website", "text", "wide"),
  website_platform: field("website_platform", "Website platform", "Website", "text", "standard"),
  website_agency_provider: field("website_agency_provider", "Website agency provider", "Website", "text", "wide"),
  business_email: field("business_email", "Business email", "Business", "text", "wide"),
  address_line_1: field("address_line_1", "Address", "Location", "text", "wide"),
  address_line_2: field("address_line_2", "Address line 2", "Location", "text", "standard"),
  locality: field("locality", "City", "Location", "text", "standard"),
  region: field("region", "State", "Location", "text", "compact"),
  postal_code: field("postal_code", "Postal code", "Location", "text", "standard"),
  country_code: field("country_code", "Country", "Location", "text", "compact"),
  county: field("county", "County", "Location", "text", "standard"),
  location_phone: field("location_phone", "Location phone", "Location", "text", "standard"),
  google_business_name: field("google_business_name", "Google business name", "Google", "text", "wide"),
  google_category: field("google_category", "Google category", "Google", "text", "standard"),
  google_address: field("google_address", "Google address", "Google", "text", "wide"),
  google_phone: field("google_phone", "Google phone", "Google", "text", "standard"),
  google_website_url: field("google_website_url", "Google website", "Google", "text", "wide"),
  google_maps_url: field("google_maps_url", "Google Maps URL", "Google", "text", "wide"),
  google_rating: field("google_rating", "Google rating", "Google", "number", "compact"),
  google_review_count: field("google_review_count", "Google reviews", "Google", "number", "compact"),
  google_place_id: field("google_place_id", "Google Place ID", "Google", "text", "wide"),
  primary_contact_name: field("primary_contact_name", "Primary contact", "Contacts", "text", "wide"),
  primary_contact_role: field("primary_contact_role", "Primary contact role", "Contacts", "text", "standard"),
  primary_contact_email: field("primary_contact_email", "Primary contact email", "Contacts", "text", "wide"),
  primary_contact_phone: field("primary_contact_phone", "Primary contact phone", "Contacts", "text", "standard"),
  outreach_email: field("outreach_email", "Outreach email", "Contacts", "text", "wide"),
  outreach_phone: field("outreach_phone", "Outreach phone", "Contacts", "text", "standard"),
  created_at: field("created_at", "Created", "System", "date", "standard"),
  updated_at: field("updated_at", "Updated", "System", "date", "standard"),
  id: field("id", "Prospect ID", "System", "text", "wide"),
  canonical_key: field("canonical_key", "Canonical key", "System", "text", "wide")
};

export const prospectExplorerFieldList = prospectExplorerFieldKeys.map((key) => prospectExplorerFields[key]);
export const defaultProspectExplorerColumns: ProspectExplorerFieldKey[] = [
  "business_name", "research_state", "region", "locality", "google_place_id",
  "google_review_count", "google_rating", "website_url", "website_platform",
  "website_agency_provider", "primary_contact_name", "primary_contact_role", "outreach_email", "outreach_phone"
];

export const prospectExplorerViews = {
  pending: { label: "Pending", filters: [{ field: "research_state", operator: "equals", value: "pending" }] },
  matched: { label: "Matched", filters: [{ field: "research_state", operator: "equals", value: "matched" }] },
  ambiguous: { label: "Ambiguous", filters: [{ field: "research_state", operator: "equals", value: "ambiguous" }] },
  no_result: { label: "No Places result", filters: [{ field: "research_state", operator: "equals", value: "no_result" }] },
  not_found: { label: "Not found", filters: [{ field: "research_state", operator: "equals", value: "not_found" }] },
  all: { label: "All prospects", filters: [] }
} as const satisfies Record<string, { label: string; filters: readonly ProspectCandidateFilter[] }>;

export type ProspectExplorerView = keyof typeof prospectExplorerViews | "custom";
export function defaultProspectCandidateFilters(): ProspectCandidateFilter[] {
  return prospectExplorerViews.pending.filters.map((filter) => ({ ...filter }));
}
export function prospectExplorerOperatorsFor(fieldKey: ProspectExplorerFieldKey): ProspectFilterOperator[] {
  const kind = prospectExplorerFields[fieldKey].kind;
  if (kind === "text") return ["contains", "equals", "not_equals", "is_empty", "is_not_empty"];
  if (kind === "option") return ["equals", "not_equals", "is_empty", "is_not_empty"];
  if (kind === "date") return ["greater_than_or_equal", "less_than_or_equal", "greater_than", "less_than", "is_empty", "is_not_empty"];
  return ["equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "is_empty", "is_not_empty"];
}
export function defaultProspectFilterOperator(fieldKey: ProspectExplorerFieldKey): ProspectFilterOperator {
  const kind = prospectExplorerFields[fieldKey].kind;
  if (kind === "text") return "contains";
  if (kind === "date") return "greater_than_or_equal";
  return "equals";
}
export function prospectFilterNeedsValue(operator: ProspectFilterOperator) {
  return operator !== "is_empty" && operator !== "is_not_empty";
}
export function prospectFilterOperatorLabel(operator: ProspectFilterOperator, fieldKind?: ProspectExplorerFieldKind) {
  if (operator === "contains") return "contains";
  if (operator === "equals") return "is";
  if (operator === "not_equals") return "is not";
  if (operator === "greater_than") return fieldKind === "date" ? "is after" : "is greater than";
  if (operator === "greater_than_or_equal") return fieldKind === "date" ? "is on or after" : "is at least";
  if (operator === "less_than") return fieldKind === "date" ? "is before" : "is less than";
  if (operator === "less_than_or_equal") return fieldKind === "date" ? "is on or before" : "is at most";
  return operator === "is_empty" ? "is empty" : "is not empty";
}
export function prospectExplorerViewForFilters(filters: ProspectCandidateFilter[]): ProspectExplorerView {
  for (const [key, view] of Object.entries(prospectExplorerViews) as Array<[keyof typeof prospectExplorerViews, (typeof prospectExplorerViews)[keyof typeof prospectExplorerViews]]>) {
    if (sameFilters(filters, view.filters)) return key;
  }
  return "custom";
}
export function prospectExplorerValue(candidate: ProspectCandidate, key: ProspectExplorerFieldKey): string | number | undefined {
  const values: Record<ProspectExplorerFieldKey, string | number | undefined> = {
    business_name: candidate.businessName,
    vertical: candidate.vertical,
    research_state: candidate.researchState,
    website_url: candidate.websiteUrl,
    website_platform: candidate.websitePlatform,
    website_agency_provider: candidate.websiteAgencyProvider,
    business_email: candidate.businessEmail,
    address_line_1: candidate.primaryAddressLine1,
    address_line_2: candidate.primaryAddressLine2,
    locality: candidate.primaryLocality,
    region: candidate.primaryRegion,
    postal_code: candidate.primaryPostalCode,
    country_code: candidate.primaryCountryCode,
    county: candidate.county,
    location_phone: candidate.locationPhone,
    google_business_name: candidate.googleBusinessName,
    google_category: candidate.googleCategory,
    google_address: candidate.googleAddress,
    google_phone: candidate.googlePhone,
    google_website_url: candidate.googleWebsiteUrl,
    google_maps_url: candidate.googleMapsUrl,
    google_rating: candidate.googleRating,
    google_review_count: candidate.googleReviewCount,
    google_place_id: candidate.googlePlaceId,
    primary_contact_name: candidate.primaryContactName,
    primary_contact_role: candidate.primaryContactRole,
    primary_contact_email: candidate.primaryContactEmail,
    primary_contact_phone: candidate.primaryContactPhone,
    outreach_email: candidate.outreachEmail,
    outreach_phone: candidate.outreachPhone,
    created_at: candidate.createdAt,
    updated_at: candidate.updatedAt,
    id: candidate.id,
    canonical_key: candidate.canonicalKey
  };
  return values[key];
}
export function humanizeExplorerValue(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function field(key: ProspectExplorerFieldKey, label: string, category: ProspectExplorerFieldCategory, kind: ProspectExplorerFieldKind, width: ProspectExplorerFieldWidth, options?: Array<{ value: string; label: string }>): ProspectExplorerField {
  return { key, label, category, kind, width, options };
}
function sameFilters(left: ProspectCandidateFilter[], right: readonly ProspectCandidateFilter[]) {
  return left.length === right.length && left.every((filter, index) => {
    const other = right[index];
    return filter.field === other?.field && filter.operator === other.operator && (filter.value ?? "") === (other.value ?? "");
  });
}
