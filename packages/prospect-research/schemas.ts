import { z } from "zod";
import {
  prospectLocationKinds,
  prospectResearchStates
} from "./contracts";

const optionalText = z.string().trim().min(1).optional();

export const upsertProspectSchema = z.object({
  id: optionalText,
  canonicalKey: z.string().trim().min(1),
  businessName: z.string().trim().min(1),
  vertical: optionalText,
  researchState: z.enum(prospectResearchStates).default("pending"),
  websiteUrl: z.string().url().optional(),
  websitePlatform: optionalText,
  websiteAgencyProvider: optionalText,
  businessEmail: z.string().trim().email().optional()
});

export const upsertProspectLocationSchema = z.object({
  id: optionalText,
  prospectId: z.string().trim().min(1),
  canonicalKey: z.string().trim().min(1),
  kind: z.enum(prospectLocationKinds).default("unknown"),
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
  googlePlaceId: z.string().trim().min(10).max(255).optional(),
  googleBusinessName: optionalText,
  googleCategory: optionalText,
  googleAddress: optionalText,
  googlePhone: optionalText,
  googleWebsiteUrl: z.string().url().optional(),
  googleMapsUrl: z.string().url().optional(),
  googleRating: z.number().min(0).max(5).optional(),
  googleReviewCount: z.number().int().min(0).optional()
});

const prospectContactFieldsSchema = z.object({
  id: optionalText,
  prospectId: z.string().trim().min(1),
  fullName: z.string().trim().min(1),
  roleTitle: optionalText,
  email: z.string().trim().email().optional(),
  phone: optionalText,
  isPrimary: z.boolean().default(false)
});
export const upsertProspectContactSchema = prospectContactFieldsSchema;

export const prospectImportRecordSchema = z.object({
  prospect: upsertProspectSchema,
  locations: z.array(upsertProspectLocationSchema.omit({ prospectId: true })).optional(),
  contacts: z.array(prospectContactFieldsSchema.omit({ prospectId: true })).optional()
});

export const prospectImportSchema = z.object({
  records: z.array(prospectImportRecordSchema).min(1).max(1_000)
});
