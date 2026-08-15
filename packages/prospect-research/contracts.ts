export const prospectResearchStates = ["pending", "matched", "ambiguous", "no_result", "not_found"] as const;
export type ProspectResearchState = (typeof prospectResearchStates)[number];

export const prospectLocationKinds = ["headquarters", "branch", "service_area", "mailing", "unknown"] as const;
export type ProspectLocationKind = (typeof prospectLocationKinds)[number];

export type Prospect = {
  id: string;
  canonicalKey: string;
  businessName: string;
  vertical?: string;
  researchState: ProspectResearchState;
  websiteUrl?: string;
  websitePlatform?: string;
  websiteAgencyProvider?: string;
  businessEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProspectLocation = {
  id: string;
  prospectId: string;
  canonicalKey: string;
  kind: ProspectLocationKind;
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
  county?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  isPrimary: boolean;
  googlePlaceId?: string;
  googleBusinessName?: string;
  googleCategory?: string;
  googleAddress?: string;
  googlePhone?: string;
  googleWebsiteUrl?: string;
  googleMapsUrl?: string;
  googleRating?: number;
  googleReviewCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type ProspectContact = {
  id: string;
  prospectId: string;
  fullName: string;
  roleTitle?: string;
  email?: string;
  phone?: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProspectCandidateContact = Pick<ProspectContact,
  "id" | "fullName" | "roleTitle" | "email" | "phone" | "isPrimary"
>;

export type ProspectCandidate = Prospect & {
  primaryAddressLine1?: string;
  primaryAddressLine2?: string;
  primaryLocality?: string;
  primaryRegion?: string;
  primaryPostalCode?: string;
  primaryCountryCode?: string;
  county?: string;
  locationPhone?: string;
  googleBusinessName?: string;
  googleCategory?: string;
  googleAddress?: string;
  googlePhone?: string;
  googleWebsiteUrl?: string;
  googleMapsUrl?: string;
  googlePlaceId?: string;
  googleRating?: number;
  googleReviewCount?: number;
  primaryContactName?: string;
  primaryContactRole?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  outreachEmail?: string;
  outreachPhone?: string;
  contacts: ProspectCandidateContact[];
};

export type UpsertProspectInput = Omit<Prospect, "id" | "createdAt" | "updatedAt" | "researchState"> & {
  id?: string;
  researchState?: ProspectResearchState;
};

export type UpsertProspectLocationInput = Omit<ProspectLocation, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type UpsertProspectContactInput = Omit<ProspectContact, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type ProspectImportRecord = {
  prospect: UpsertProspectInput;
  locations?: Array<Omit<UpsertProspectLocationInput, "prospectId"> & { prospectId?: string }>;
  contacts?: Array<Omit<UpsertProspectContactInput, "prospectId"> & { prospectId?: string }>;
};
