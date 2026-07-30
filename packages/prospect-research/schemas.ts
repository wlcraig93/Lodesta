import { z } from "zod";
import {
  prospectAgencyStatuses,
  prospectAffiliationConfidenceLevels,
  prospectAffiliationTypes,
  prospectContactTypes,
  prospectContactVerificationStatuses,
  prospectLicenseStatuses,
  prospectLocationKinds,
  prospectLocationStatuses,
  prospectOperatingStatuses,
  prospectObservationSourceTypes,
  prospectOwnershipScopes,
  prospectSourceAccessMethods,
  prospectSourceCoverageStatuses,
  prospectSourceRunStatuses,
  prospectStatuses,
  prospectTargetFitStatuses,
  prospectVerificationStatuses,
  prospectWebsiteKinds
} from "./contracts";

const optionalText = z.string().trim().min(1).optional();
const metadataValue = z.union([z.string(), z.number(), z.boolean()]);

export const upsertProspectSchema = z.object({
  id: optionalText,
  canonicalKey: z.string().trim().min(1),
  businessName: z.string().trim().min(1),
  legalBusinessName: optionalText,
  dbaName: optionalText,
  vertical: optionalText,
  industryCode: optionalText,
  ownershipScope: z.enum(prospectOwnershipScopes).default("unknown"),
  status: z.enum(prospectStatuses).default("active"),
  websiteKind: z.enum(prospectWebsiteKinds).default("unknown"),
  websiteUrl: z.string().url().optional(),
  websiteHost: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  locality: optionalText,
  region: z.string().trim().length(2).optional(),
  postalCode: optionalText,
  countryCode: z.string().trim().length(2).default("US"),
  phone: optionalText,
  doNotContact: z.boolean().default(false),
  suppressionReason: optionalText,
  metadata: z.record(metadataValue).optional()
}).superRefine((value, context) => {
  if (value.websiteKind === "owned_website" && !value.websiteUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["websiteUrl"],
      message: "An owned website requires its canonical URL."
    });
  }
  if (value.doNotContact && !value.suppressionReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["suppressionReason"],
      message: "A suppression reason is required when doNotContact is true."
    });
  }
});

export const upsertProspectLocationSchema = z.object({
  id: optionalText,
  prospectId: z.string().trim().min(1),
  canonicalKey: z.string().trim().min(1),
  kind: z.enum(prospectLocationKinds).default("unknown"),
  status: z.enum(prospectLocationStatuses).default("unknown"),
  locationName: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  locality: optionalText,
  region: z.string().trim().length(2).optional(),
  postalCode: optionalText,
  countryCode: z.string().trim().length(2).default("US"),
  county: optionalText,
  phone: optionalText,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isPrimary: z.boolean().default(false),
  sourceId: optionalText,
  sourceRunId: optionalText,
  sourceRecordKey: optionalText,
  observedAt: z.string().datetime()
});

export const upsertProspectLicenseSchema = z.object({
  id: optionalText,
  prospectId: z.string().trim().min(1),
  locationId: optionalText,
  jurisdiction: z.string().trim().min(2),
  regulator: z.string().trim().min(1),
  licenseType: z.string().trim().min(1),
  licenseNumber: z.string().trim().min(1),
  status: z.enum(prospectLicenseStatuses),
  classifications: z.array(z.string().trim().min(1)).default([]),
  issuedAt: z.string().datetime().optional(),
  renewedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  responsiblePersonName: optionalText,
  responsiblePersonTitle: optionalText,
  sourceId: z.string().trim().min(1),
  sourceRunId: optionalText,
  sourceUrl: z.string().url(),
  sourceRecordKey: optionalText,
  observedAt: z.string().datetime(),
  evidence: z.record(z.unknown()).optional()
});

export const upsertProspectAffiliationSchema = z.object({
  id: optionalText,
  prospectId: z.string().trim().min(1),
  relatedProspectId: optionalText,
  relatedOrganizationName: z.string().trim().min(1),
  affiliationType: z.enum(prospectAffiliationTypes),
  confidence: z.enum(prospectAffiliationConfidenceLevels),
  sourceUrl: z.string().url().optional(),
  observedAt: z.string().datetime(),
  evidence: z.record(z.unknown()).optional()
});

export const upsertProspectSourceSchema = z.object({
  id: z.string().trim().min(1),
  vertical: z.string().trim().min(1),
  jurisdiction: z.string().trim().min(2),
  authorityName: z.string().trim().min(1),
  sourceName: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  accessMethod: z.enum(prospectSourceAccessMethods),
  coverageStatus: z.enum(prospectSourceCoverageStatuses),
  recordScope: z.enum(["business", "location", "licensee", "mixed"]),
  refreshCadence: optionalText,
  expectedRecordCount: z.number().int().min(0).optional(),
  accessNotes: optionalText,
  lastCheckedAt: z.string().datetime().optional()
});

export const upsertProspectSourceRunSchema = z.object({
  id: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  status: z.enum(prospectSourceRunStatuses),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  snapshotAt: z.string().datetime().optional(),
  sourceHash: optionalText,
  recordsSeen: z.number().int().min(0),
  organizationsUpserted: z.number().int().min(0),
  locationsUpserted: z.number().int().min(0),
  licensesUpserted: z.number().int().min(0),
  contactsUpserted: z.number().int().min(0),
  rejectedRecords: z.number().int().min(0),
  error: optionalText,
  metadata: z.record(metadataValue).optional()
});

const prospectObservationFieldsSchema = z.object({
  id: optionalText,
  prospectId: z.string().trim().min(1),
  sourceType: z.enum(prospectObservationSourceTypes),
  sourceUrl: z.string().url().optional(),
  observedAt: z.string().datetime(),
  websiteKind: z.enum(prospectWebsiteKinds),
  websiteUrl: z.string().url().optional(),
  reviewRating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  yearsInBusiness: z.number().min(0).optional(),
  cms: optionalText,
  siteBuilder: optionalText,
  managedProvider: optionalText,
  agencyStatus: z.enum(prospectAgencyStatuses).default("unknown"),
  agencyName: optionalText,
  websiteAssessmentId: optionalText,
  prospectReportId: optionalText,
  businessStrengthScore: z.number().min(0).max(100).optional(),
  websiteOpportunityScore: z.number().min(0).max(100).optional(),
  reachabilityScore: z.number().min(0).max(100).optional(),
  priorityScore: z.number().min(0).max(100).optional(),
  scoringModel: optionalText,
  verificationStatus: z.enum(prospectVerificationStatuses).default("unverified"),
  verificationScore: z.number().min(0).max(100).optional(),
  operatingStatus: z.enum(prospectOperatingStatuses).default("unknown"),
  targetFitStatus: z.enum(prospectTargetFitStatuses).default("unknown"),
  targetFitReason: optionalText,
  evidenceCoverage: z.number().min(0).max(1),
  producer: z.string().trim().min(1),
  methodologyIdentity: z.string().trim().min(1),
  inputHash: z.string().trim().min(1),
  notes: optionalText,
  evidence: z.record(z.unknown()).optional()
});

function refineProspectObservation(value: {
  websiteKind: "owned_website" | "no_website" | "social_or_aggregator" | "unknown";
  websiteUrl?: string;
  agencyStatus: "confirmed" | "likely" | "not_observed" | "unknown";
  agencyName?: string;
  targetFitStatus: "unknown" | "target" | "review_required" | "excluded";
  targetFitReason?: string;
}, context: z.RefinementCtx) {
  if (value.websiteKind === "owned_website" && !value.websiteUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["websiteUrl"],
      message: "An owned website observation requires the observed URL."
    });
  }
  if (value.agencyStatus === "confirmed" && !value.agencyName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agencyName"],
      message: "A confirmed agency relationship requires an agency name."
    });
  }
  if (["review_required", "excluded"].includes(value.targetFitStatus) && !value.targetFitReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetFitReason"],
      message: "A review-required or excluded target-fit result requires a reason."
    });
  }
}

export const createProspectObservationSchema = prospectObservationFieldsSchema.superRefine(refineProspectObservation);

const prospectContactFieldsSchema = z.object({
  id: optionalText,
  prospectId: z.string().trim().min(1),
  contactType: z.enum(prospectContactTypes),
  fullName: optionalText,
  roleTitle: optionalText,
  email: z.string().trim().email().optional(),
  phone: optionalText,
  sourceType: z.enum(prospectObservationSourceTypes),
  sourceUrl: z.string().url().optional(),
  verificationStatus: z.enum(prospectContactVerificationStatuses),
  outreachEligible: z.boolean().default(false),
  observedAt: z.string().datetime(),
  suppressedAt: z.string().datetime().optional(),
  suppressionReason: optionalText
});

function refineProspectContact(value: {
  fullName?: string;
  email?: string;
  phone?: string;
  sourceUrl?: string;
  verificationStatus: "public_source" | "owner_verified" | "unverified";
  outreachEligible: boolean;
  suppressedAt?: string;
  suppressionReason?: string;
}, context: z.RefinementCtx) {
  if (!value.fullName && !value.email && !value.phone) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A contact requires a name, email, or phone." });
  }
  if (value.verificationStatus === "public_source" && !value.sourceUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceUrl"],
      message: "A public-source contact requires a source URL."
    });
  }
  if (value.outreachEligible && value.verificationStatus === "unverified") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outreachEligible"],
      message: "Unverified contact data cannot be marked outreach eligible."
    });
  }
  if (value.suppressedAt && !value.suppressionReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["suppressionReason"],
      message: "A suppression reason is required for a suppressed contact."
    });
  }
}

export const upsertProspectContactSchema = prospectContactFieldsSchema.superRefine(refineProspectContact);
const prospectImportContactSchema = prospectContactFieldsSchema
  .omit({ prospectId: true })
  .superRefine(refineProspectContact);

export const prospectImportRecordSchema = z.object({
  prospect: upsertProspectSchema,
  locations: z.array(upsertProspectLocationSchema.omit({ prospectId: true })).optional(),
  licenses: z.array(upsertProspectLicenseSchema.omit({ prospectId: true })).optional(),
  affiliations: z.array(upsertProspectAffiliationSchema.omit({ prospectId: true })).optional(),
  observation: prospectObservationFieldsSchema
    .omit({ prospectId: true })
    .superRefine(refineProspectObservation)
    .optional(),
  contacts: z.array(prospectImportContactSchema).optional()
});

export const prospectImportSchema = z.object({
  records: z.array(prospectImportRecordSchema).min(1).max(1_000)
});
