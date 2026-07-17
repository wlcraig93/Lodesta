import { z } from "zod";
import type { AssetKind, AssetUsageScope, BrandAssessment, BusinessBrandExpressionV1, FieldProvenance, Theme, Vertical } from "./models";
import type { GenerationEvidenceManifestV1 } from "./generation-evidence-manifest";
import type { GenerationPlanSection } from "./generation-contracts";

export const resolvedBusinessSnapshotSchemaVersion = "resolved-business-snapshot-v1" as const;
export const siteIntentSchemaVersion = "site-intent-v1" as const;
export const generationInputSnapshotSchemaVersion = "generation-input-snapshot-v1" as const;
export const assetRevisionSchemaVersion = "asset-revision-v1" as const;
export const formDefinitionSchemaVersion = "form-definition-v1" as const;
export const controlPlaneChangeRequestSchemaVersion = "control-plane-change-request-v1" as const;

export type BusinessAddressV1 = {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export type BusinessGeoV1 = { latitude: number; longitude: number };

export type BusinessOfferingV1 = {
  id: string;
  businessId: string;
  catalogId?: string;
  customName?: string;
  status: "observed" | "confirmed" | "rejected" | "inactive";
  visibility: "preview" | "public" | "hidden";
  pageMode: "none" | "shared" | "dedicated";
  featured: boolean;
  evidenceIds: string[];
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessProofKindV1 =
  | "testimonial"
  | "credential"
  | "warranty"
  | "award"
  | "offer"
  | "insurance_support"
  | "longevity";

export type BusinessProofV1 = {
  id: string;
  businessId: string;
  kind: BusinessProofKindV1;
  status: "observed" | "confirmed" | "rejected" | "inactive";
  publicText?: string;
  sourceExcerpt?: string;
  sourceSnapshotId?: string;
  sourceBlockId?: string;
  evidenceIds: string[];
  expiresAt?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetRevisionV1 = {
  schemaVersion: typeof assetRevisionSchemaVersion;
  id: string;
  assetId: string;
  businessId: string;
  contentHash: string;
  storagePath: string;
  publicUrl?: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  width?: number;
  height?: number;
  provenance?: FieldProvenance;
  rightsStatus: "preclaim_safe" | "customer_granted" | "reference_only" | "unknown";
  attestation?: { attestedBy: string; attestedAt: string; statement: string };
  createdAt: string;
};

export type BusinessAssetV1 = {
  id: string;
  businessId: string;
  kind: AssetKind;
  alt: string;
  source: "generated" | "licensed" | "uploaded" | "website_reference" | "placeholder";
  usageScope: AssetUsageScope;
  ownerApproved: boolean;
  metadata?: Record<string, unknown>;
  active: boolean;
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedAssetV1 = BusinessAssetV1 & { revision: AssetRevisionV1 };

export type ResolvedBusinessSnapshotV1 = {
  schemaVersion: typeof resolvedBusinessSnapshotSchemaVersion;
  businessId: string;
  siteId: string;
  stateRevision: number;
  resolvedAt: string;
  name: string;
  vertical: Vertical;
  categories: string[];
  description?: string;
  phone?: string;
  email?: string;
  address?: BusinessAddressV1;
  geo?: BusinessGeoV1;
  hours?: Record<string, string>;
  serviceAreas: string[];
  offerings: BusinessOfferingV1[];
  proof: BusinessProofV1[];
  socialLinks: string[];
  bookingLinks: string[];
  orderingLinks: string[];
  pressLinks: string[];
  googlePlaceId?: string;
  provenance: Record<string, FieldProvenance>;
};

export type SiteCopyOverrideV1 = {
  slotId: string;
  value: string;
  updatedBy: string;
  updatedAt: string;
};

export type SiteIntentV1 = {
  schemaVersion: typeof siteIntentSchemaVersion;
  id: string;
  siteId: string;
  revision: number;
  audience?: string;
  positioning?: string;
  voice?: string;
  primaryConversion: "call" | "form" | "booking" | "visit";
  formDefinitionId?: string;
  featuredOfferingIds: string[];
  offeringPageModes: Record<string, BusinessOfferingV1["pageMode"]>;
  selectedProofIds: string[];
  brandConstraints?: { preferredPrimaryColor?: string; prohibitedColors?: string[]; notes?: string[] };
  copyOverrides: SiteCopyOverrideV1[];
  createdAt: string;
  updatedAt: string;
};

export type SourceSnapshotV1 = {
  id: string;
  businessId: string;
  sourceType: "website" | "google_places" | "owner_input" | "operator_input";
  sourceUrl?: string;
  contentHash: string;
  capturedAt: string;
  payload: Record<string, unknown>;
};

export type FactObservationV1 = {
  id: string;
  businessId: string;
  sourceSnapshotId: string;
  field: string;
  value: unknown;
  normalizedValue?: unknown;
  confidence: number;
  status: "observed" | "selected_for_preview" | "conflict" | "superseded" | "rejected";
  sourceBlockId?: string;
  observedAt: string;
};

export type FormFieldV1 = {
  id: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "select";
  required: boolean;
  options?: string[];
};

export type FormDefinitionV1 = {
  schemaVersion: typeof formDefinitionSchemaVersion;
  id: string;
  siteId: string;
  name: string;
  fields: FormFieldV1[];
  submitLabel: string;
  createdAt: string;
};

export type GenerationInputSnapshotV1 = {
  schemaVersion: typeof generationInputSnapshotSchemaVersion;
  id: string;
  businessId: string;
  siteId: string;
  businessStateRevision: number;
  siteIntentRevision: number;
  business: ResolvedBusinessSnapshotV1;
  siteIntent: SiteIntentV1;
  assets: ResolvedAssetV1[];
  evidenceManifest: GenerationEvidenceManifestV1;
  formDefinition: FormDefinitionV1;
  brandExpression?: BusinessBrandExpressionV1;
  brandAssessment?: BrandAssessment;
  /** Regenerable model interpretation retained for downstream presentation, never owner truth. */
  businessUnderstanding?: import("./models").BusinessUnderstandingV2;
  sourceSnapshotIds: string[];
  verticalPack: { id: string; version: string };
  eligibilityMode: "protected_preview" | "public";
  inputHash: string;
  createdAt: string;
};

export type ControlPlaneAuthorityV1 = "business_state" | "site_intent";

export type ControlPlaneChangePayloadV1 =
  | { kind: "set_business_identity"; name: string; description?: string; categories?: string[] }
  | { kind: "set_contact"; phone?: string; email?: string }
  | { kind: "set_location"; address?: BusinessAddressV1; geo?: BusinessGeoV1; serviceAreas?: string[] }
  | { kind: "set_hours"; hours: Record<string, string> }
  | { kind: "confirm_business_snapshot"; factIds: Array<"name" | "phone" | "email" | "address" | "hours" | "service_areas" | "services">; publicEligibility: true }
  | { kind: "set_offering"; offeringId?: string; catalogId?: string; customName?: string; enabled: boolean; featured?: boolean; pageMode?: BusinessOfferingV1["pageMode"] }
  | { kind: "set_proof"; proofId: string; decision: "confirm" | "reject"; publicText?: string; expiresAt?: string }
  | { kind: "register_proof"; proofKind: Exclude<BusinessProofKindV1, "testimonial">; publicText: string; expiresAt?: string }
  | { kind: "set_asset"; assetId: string; active: boolean; usageScope?: AssetUsageScope }
  | { kind: "register_asset"; asset: BusinessAssetV1; revision: AssetRevisionV1 }
  | { kind: "set_external_link"; linkType: "social" | "booking" | "ordering" | "press"; url: string; enabled: boolean }
  | { kind: "set_audience"; value?: string }
  | { kind: "set_positioning"; value?: string }
  | { kind: "set_voice"; value?: string }
  | { kind: "set_primary_conversion"; value: SiteIntentV1["primaryConversion"] }
  | { kind: "set_featured_offerings"; offeringIds: string[] }
  | { kind: "set_offering_page_mode"; offeringId: string; pageMode: BusinessOfferingV1["pageMode"] }
  | { kind: "set_proof_selection"; proofIds: string[] }
  | { kind: "set_brand_constraints"; value?: SiteIntentV1["brandConstraints"] }
  | { kind: "set_form_definition"; name: string; fields: FormFieldV1[]; submitLabel: string }
  | { kind: "set_copy_override"; slotId: string; value: string }
  | { kind: "set_copy_overrides"; overrides: Array<{ slotId: string; value: string }> }
  | { kind: "remove_copy_override"; slotId: string };

export type ControlPlaneChangeRequestV1 = {
  schemaVersion: typeof controlPlaneChangeRequestSchemaVersion;
  id: string;
  businessId: string;
  siteId: string;
  targetAuthority: ControlPlaneAuthorityV1;
  payload: ControlPlaneChangePayloadV1;
  status: "pending" | "approved" | "rejected" | "applied" | "failed";
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  failureReason?: string;
};

export type ChangeImpactV1 = "deterministic" | "structural";

const businessAddressSchema = z.object({
  street: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(80).optional(),
  postalCode: z.string().max(24).optional(),
  country: z.string().max(80).optional()
});

const changePayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_business_identity"), name: z.string().trim().min(1).max(180), description: z.string().trim().max(1200).optional(), categories: z.array(z.string().trim().min(1).max(120)).max(20).optional() }),
  z.object({ kind: z.literal("set_contact"), phone: z.string().max(80).optional(), email: z.string().email().max(320).optional() }),
  z.object({ kind: z.literal("set_location"), address: businessAddressSchema.optional(), geo: z.object({ latitude: z.number(), longitude: z.number() }).optional(), serviceAreas: z.array(z.string().trim().min(1).max(160)).max(80).optional() }),
  z.object({ kind: z.literal("set_hours"), hours: z.record(z.string().max(160)) }),
  z.object({ kind: z.literal("confirm_business_snapshot"), factIds: z.array(z.enum(["name", "phone", "email", "address", "hours", "service_areas", "services"])).min(1).max(7), publicEligibility: z.literal(true) }),
  z.object({ kind: z.literal("set_offering"), offeringId: z.string().min(1).optional(), catalogId: z.string().min(1).optional(), customName: z.string().trim().min(1).max(180).optional(), enabled: z.boolean(), featured: z.boolean().optional(), pageMode: z.enum(["none", "shared", "dedicated"]).optional() }),
  z.object({ kind: z.literal("set_proof"), proofId: z.string().min(1), decision: z.enum(["confirm", "reject"]), publicText: z.string().trim().min(1).max(600).optional(), expiresAt: z.string().datetime().optional() }),
  z.object({ kind: z.literal("register_proof"), proofKind: z.enum(["credential", "warranty", "award", "offer", "insurance_support", "longevity"]), publicText: z.string().trim().min(1).max(600), expiresAt: z.string().datetime().optional() }),
  z.object({ kind: z.literal("set_asset"), assetId: z.string().min(1), active: z.boolean(), usageScope: z.enum(["preclaim_preview", "published_site", "owner_dashboard", "internal_planning", "reference_only"]).optional() }),
  z.object({
    kind: z.literal("register_asset"),
    asset: z.object({
      id: z.string().min(1), businessId: z.string().min(1), kind: z.enum(["photo", "logo", "mockup", "screenshot", "icon", "document", "other"]),
      alt: z.string().trim().min(1).max(180), source: z.enum(["generated", "licensed", "uploaded", "website_reference", "placeholder"]),
      usageScope: z.enum(["preclaim_preview", "published_site", "owner_dashboard", "internal_planning", "reference_only"]), ownerApproved: z.boolean(),
      metadata: z.record(z.unknown()).optional(), active: z.boolean(), currentRevisionId: z.string().min(1), createdAt: z.string().datetime(), updatedAt: z.string().datetime()
    }),
    revision: z.object({
      schemaVersion: z.literal(assetRevisionSchemaVersion), id: z.string().min(1), assetId: z.string().min(1), businessId: z.string().min(1),
      contentHash: z.string().min(16), storagePath: z.string().min(1), publicUrl: z.string().optional(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      bytes: z.number().int().positive(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
      provenance: z.record(z.unknown()).optional(), rightsStatus: z.enum(["preclaim_safe", "customer_granted", "reference_only", "unknown"]),
      attestation: z.object({ attestedBy: z.string().min(1), attestedAt: z.string().datetime(), statement: z.string().min(1) }).optional(), createdAt: z.string().datetime()
    })
  }),
  z.object({ kind: z.literal("set_external_link"), linkType: z.enum(["social", "booking", "ordering", "press"]), url: z.string().url().max(2048), enabled: z.boolean() }),
  z.object({ kind: z.literal("set_audience"), value: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal("set_positioning"), value: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal("set_voice"), value: z.string().trim().max(240).optional() }),
  z.object({ kind: z.literal("set_primary_conversion"), value: z.enum(["call", "form", "booking", "visit"]) }),
  z.object({ kind: z.literal("set_featured_offerings"), offeringIds: z.array(z.string().min(1)).max(20) }),
  z.object({ kind: z.literal("set_offering_page_mode"), offeringId: z.string().min(1), pageMode: z.enum(["none", "shared", "dedicated"]) }),
  z.object({ kind: z.literal("set_proof_selection"), proofIds: z.array(z.string().min(1)).max(30) }),
  z.object({ kind: z.literal("set_brand_constraints"), value: z.object({ preferredPrimaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), prohibitedColors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(20).optional(), notes: z.array(z.string().max(300)).max(20).optional() }).optional() }),
  z.object({ kind: z.literal("set_form_definition"), name: z.string().trim().min(1).max(120), fields: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(120), type: z.enum(["text", "email", "phone", "textarea", "select"]), required: z.boolean(), options: z.array(z.string().max(80)).optional() })).min(1).max(12), submitLabel: z.string().trim().min(1).max(80) }),
  z.object({ kind: z.literal("set_copy_override"), slotId: z.string().min(1).max(160), value: z.string().trim().min(1).max(900) }),
  z.object({ kind: z.literal("set_copy_overrides"), overrides: z.array(z.object({ slotId: z.string().min(1).max(160), value: z.string().trim().min(1).max(900) })).min(1).max(20) }),
  z.object({ kind: z.literal("remove_copy_override"), slotId: z.string().min(1).max(160) })
]);

export const createControlPlaneChangeSchema = z.object({
  siteId: z.string().min(1),
  payload: changePayloadSchema
});

export const decideControlPlaneChangeSchema = z.object({ decision: z.enum(["approve", "reject"]) });

const siteIntentKinds = new Set<ControlPlaneChangePayloadV1["kind"]>([
  "set_audience",
  "set_positioning",
  "set_voice",
  "set_primary_conversion",
  "set_featured_offerings",
  "set_offering_page_mode",
  "set_proof_selection",
  "set_brand_constraints",
  "set_form_definition",
  "set_copy_override",
  "set_copy_overrides",
  "remove_copy_override"
]);

export function authorityForChange(payload: ControlPlaneChangePayloadV1): ControlPlaneAuthorityV1 {
  return siteIntentKinds.has(payload.kind) ? "site_intent" : "business_state";
}

export function impactForChange(payload: ControlPlaneChangePayloadV1): ChangeImpactV1 {
  if (payload.kind === "set_contact" || payload.kind === "set_hours" || payload.kind === "set_form_definition" || payload.kind === "set_copy_override" || payload.kind === "set_copy_overrides" || payload.kind === "remove_copy_override") {
    return "deterministic";
  }
  return "structural";
}

export type VerticalPackV1 = {
  id: string;
  version: string;
  vertical: Vertical;
  businessCategory: string;
  serviceCatalog: Array<{ id: string; name: string; aliases: string[]; retired: boolean }>;
  primaryCtaLabel: string;
  defaultProcessSteps: Array<{ title: string; body: string }>;
  servicePageLimit: number;
  formBlueprint: Omit<FormDefinitionV1, "id" | "siteId" | "createdAt">;
  pageRecipe: {
    compactServicesTemplate: GenerationPlanSection["templateId"];
    expandedServicesTemplate: GenerationPlanSection["templateId"];
    expandedServicesThreshold: number;
    processTemplate: GenerationPlanSection["templateId"];
    serviceDetailTemplate: GenerationPlanSection["templateId"];
    faqTemplate: GenerationPlanSection["templateId"];
    contactTemplate: GenerationPlanSection["templateId"];
  };
  pageArchetypes: string[];
  seoVocabulary: string[];
  structuredDataType: "AutoRepair";
  copyBrief: string;
  proofPolicy: Partial<Record<BusinessProofKindV1, "owner_confirmation" | "verified_source_span">>;
  defaultTheme?: Theme;
};
