export const prospectWebsiteKinds = ["owned_website", "no_website", "social_or_aggregator", "unknown"] as const;
export type ProspectWebsiteKind = (typeof prospectWebsiteKinds)[number];

export const prospectStatuses = ["active", "suppressed", "converted", "archived"] as const;
export type ProspectStatus = (typeof prospectStatuses)[number];

export const prospectObservationSourceTypes = [
  "manual_research",
  "licensed_dataset",
  "open_dataset",
  "business_website",
  "public_listing",
  "public_registry",
  "owner_verified",
  "import"
] as const;
export type ProspectObservationSourceType = (typeof prospectObservationSourceTypes)[number];

export const prospectVerificationStatuses = ["unverified", "partial", "verified", "conflicted", "rejected"] as const;
export type ProspectVerificationStatus = (typeof prospectVerificationStatuses)[number];

export const prospectOperatingStatuses = ["unknown", "operational", "temporarily_closed", "permanently_closed"] as const;
export type ProspectOperatingStatus = (typeof prospectOperatingStatuses)[number];

export const prospectTargetFitStatuses = ["unknown", "target", "review_required", "excluded"] as const;
export type ProspectTargetFitStatus = (typeof prospectTargetFitStatuses)[number];

export const prospectAgencyStatuses = ["confirmed", "likely", "not_observed", "unknown"] as const;
export type ProspectAgencyStatus = (typeof prospectAgencyStatuses)[number];

export const prospectContactTypes = ["business_general", "owner", "manager", "marketing"] as const;
export type ProspectContactType = (typeof prospectContactTypes)[number];

export const prospectContactVerificationStatuses = ["public_source", "owner_verified", "unverified"] as const;
export type ProspectContactVerificationStatus = (typeof prospectContactVerificationStatuses)[number];

export const prospectOwnershipScopes = [
  "independent_single_location",
  "independent_multi_location",
  "regional_independent",
  "franchisee",
  "corporate_chain",
  "unknown"
] as const;
export type ProspectOwnershipScope = (typeof prospectOwnershipScopes)[number];

export const prospectLocationKinds = ["headquarters", "branch", "service_area", "mailing", "unknown"] as const;
export type ProspectLocationKind = (typeof prospectLocationKinds)[number];

export const prospectLocationStatuses = ["active", "inactive", "unknown"] as const;
export type ProspectLocationStatus = (typeof prospectLocationStatuses)[number];

export const prospectLicenseStatuses = [
  "active",
  "expired",
  "suspended",
  "revoked",
  "pending",
  "unknown"
] as const;
export type ProspectLicenseStatus = (typeof prospectLicenseStatuses)[number];

export const prospectAffiliationTypes = [
  "franchisee_of",
  "subsidiary_of",
  "operates_brand",
  "same_enterprise"
] as const;
export type ProspectAffiliationType = (typeof prospectAffiliationTypes)[number];

export const prospectAffiliationConfidenceLevels = ["confirmed", "likely", "possible"] as const;
export type ProspectAffiliationConfidence = (typeof prospectAffiliationConfidenceLevels)[number];

export const prospectSourceAccessMethods = [
  "csv",
  "xlsx",
  "json",
  "api",
  "pdf",
  "search",
  "manual_request",
  "unavailable"
] as const;
export type ProspectSourceAccessMethod = (typeof prospectSourceAccessMethods)[number];

export const prospectSourceCoverageStatuses = [
  "complete",
  "partial",
  "blocked",
  "unresearched",
  "retired"
] as const;
export type ProspectSourceCoverageStatus = (typeof prospectSourceCoverageStatuses)[number];

export const prospectSourceRunStatuses = ["running", "succeeded", "partial", "failed"] as const;
export type ProspectSourceRunStatus = (typeof prospectSourceRunStatuses)[number];

export type Prospect = {
  id: string;
  canonicalKey: string;
  businessName: string;
  legalBusinessName?: string;
  dbaName?: string;
  vertical?: string;
  industryCode?: string;
  ownershipScope: ProspectOwnershipScope;
  status: ProspectStatus;
  websiteKind: ProspectWebsiteKind;
  websiteUrl?: string;
  websiteHost?: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
  phone?: string;
  doNotContact: boolean;
  suppressionReason?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
};

export type ProspectLocation = {
  id: string;
  prospectId: string;
  canonicalKey: string;
  kind: ProspectLocationKind;
  status: ProspectLocationStatus;
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
  sourceId?: string;
  sourceRunId?: string;
  sourceRecordKey?: string;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ProspectLicense = {
  id: string;
  prospectId: string;
  locationId?: string;
  jurisdiction: string;
  regulator: string;
  licenseType: string;
  licenseNumber: string;
  status: ProspectLicenseStatus;
  classifications: string[];
  issuedAt?: string;
  renewedAt?: string;
  expiresAt?: string;
  responsiblePersonName?: string;
  responsiblePersonTitle?: string;
  sourceId: string;
  sourceRunId?: string;
  sourceUrl: string;
  sourceRecordKey?: string;
  observedAt: string;
  evidence?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProspectAffiliation = {
  id: string;
  prospectId: string;
  relatedProspectId?: string;
  relatedOrganizationName: string;
  affiliationType: ProspectAffiliationType;
  confidence: ProspectAffiliationConfidence;
  sourceUrl?: string;
  observedAt: string;
  evidence?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProspectSource = {
  id: string;
  vertical: string;
  jurisdiction: string;
  authorityName: string;
  sourceName: string;
  sourceUrl: string;
  accessMethod: ProspectSourceAccessMethod;
  coverageStatus: ProspectSourceCoverageStatus;
  recordScope: "business" | "location" | "licensee" | "mixed";
  refreshCadence?: string;
  expectedRecordCount?: number;
  accessNotes?: string;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProspectSourceRun = {
  id: string;
  sourceId: string;
  status: ProspectSourceRunStatus;
  startedAt: string;
  finishedAt?: string;
  snapshotAt?: string;
  sourceHash?: string;
  recordsSeen: number;
  organizationsUpserted: number;
  locationsUpserted: number;
  licensesUpserted: number;
  contactsUpserted: number;
  rejectedRecords: number;
  error?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
};

export type ProspectObservation = {
  schemaVersion: 1;
  id: string;
  prospectId: string;
  sourceType: ProspectObservationSourceType;
  sourceUrl?: string;
  observedAt: string;
  websiteKind: ProspectWebsiteKind;
  websiteUrl?: string;
  reviewRating?: number;
  reviewCount?: number;
  yearsInBusiness?: number;
  cms?: string;
  siteBuilder?: string;
  managedProvider?: string;
  agencyStatus: ProspectAgencyStatus;
  agencyName?: string;
  websiteAssessmentId?: string;
  prospectReportId?: string;
  businessStrengthScore?: number;
  websiteOpportunityScore?: number;
  reachabilityScore?: number;
  priorityScore?: number;
  scoringModel?: string;
  verificationStatus: ProspectVerificationStatus;
  verificationScore?: number;
  operatingStatus: ProspectOperatingStatus;
  targetFitStatus: ProspectTargetFitStatus;
  targetFitReason?: string;
  evidenceCoverage: number;
  producer: string;
  methodologyIdentity: string;
  inputHash: string;
  notes?: string;
  evidence?: Record<string, unknown>;
  createdAt: string;
};

export type ProspectContact = {
  id: string;
  prospectId: string;
  contactType: ProspectContactType;
  fullName?: string;
  roleTitle?: string;
  email?: string;
  phone?: string;
  sourceType: ProspectObservationSourceType;
  sourceUrl?: string;
  verificationStatus: ProspectContactVerificationStatus;
  outreachEligible: boolean;
  observedAt: string;
  suppressedAt?: string;
  suppressionReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProspectCandidate = Prospect & {
  latestObservationId?: string;
  latestObservedAt?: string;
  reviewRating?: number;
  reviewCount?: number;
  yearsInBusiness?: number;
  cms?: string;
  siteBuilder?: string;
  managedProvider?: string;
  agencyStatus?: ProspectAgencyStatus;
  agencyName?: string;
  websiteAssessmentId?: string;
  prospectReportId?: string;
  businessStrengthScore?: number;
  websiteOpportunityScore?: number;
  reachabilityScore?: number;
  priorityScore?: number;
  scoringModel?: string;
  verificationStatus?: ProspectVerificationStatus;
  verificationScore?: number;
  operatingStatus?: ProspectOperatingStatus;
  targetFitStatus?: ProspectTargetFitStatus;
  targetFitReason?: string;
  evidenceCoverage?: number;
  ownerName?: string;
  publicEmail?: string;
  contactCount: number;
  locationCount: number;
  activeLicenseCount: number;
};

export type ProspectCandidateQuery = {
  search?: string;
  vertical?: string;
  industryCode?: string;
  region?: string;
  websiteKind?: ProspectWebsiteKind;
  cms?: string;
  managedProvider?: string;
  agencyStatus?: ProspectAgencyStatus;
  verificationStatus?: ProspectVerificationStatus;
  operatingStatus?: ProspectOperatingStatus;
  targetFitStatus?: ProspectTargetFitStatus;
  ownershipScope?: ProspectOwnershipScope;
  minimumLocationCount?: number;
  minimumActiveLicenseCount?: number;
  minimumReviewCount?: number;
  minimumPriorityScore?: number;
  minimumVerificationScore?: number;
  sortBy?: "priority" | "business_name" | "state" | "reviews" | "verification" | "observed_at";
  sortDirection?: "asc" | "desc";
  offset?: number;
  limit?: number;
};

export type UpsertProspectInput = Omit<Prospect, "id" | "createdAt" | "updatedAt" | "ownershipScope"> & {
  id?: string;
  ownershipScope?: ProspectOwnershipScope;
};

export type UpsertProspectLocationInput = Omit<ProspectLocation, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type UpsertProspectLicenseInput = Omit<ProspectLicense, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type UpsertProspectAffiliationInput = Omit<ProspectAffiliation, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type UpsertProspectSourceInput = Omit<ProspectSource, "createdAt" | "updatedAt">;

export type UpsertProspectSourceRunInput = Omit<ProspectSourceRun, "createdAt" | "updatedAt">;

export type CreateProspectObservationInput = Omit<
  ProspectObservation,
  "schemaVersion" | "id" | "createdAt" | "verificationStatus" | "operatingStatus" | "targetFitStatus"
> & {
  id?: string;
  verificationStatus?: ProspectVerificationStatus;
  operatingStatus?: ProspectOperatingStatus;
  targetFitStatus?: ProspectTargetFitStatus;
};

export type UpsertProspectContactInput = Omit<ProspectContact, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type ProspectImportRecord = {
  prospect: UpsertProspectInput;
  locations?: Array<Omit<UpsertProspectLocationInput, "prospectId"> & { prospectId?: string }>;
  licenses?: Array<Omit<UpsertProspectLicenseInput, "prospectId"> & { prospectId?: string }>;
  affiliations?: Array<Omit<UpsertProspectAffiliationInput, "prospectId"> & { prospectId?: string }>;
  observation?: Omit<CreateProspectObservationInput, "prospectId"> & { prospectId?: string };
  contacts?: Array<Omit<UpsertProspectContactInput, "prospectId"> & { prospectId?: string }>;
};
