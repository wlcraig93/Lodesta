import { z } from "zod";
export * from "./platform-manifest";

const isoTimestamp = z.string().datetime({ offset: true });
const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const contentHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const publicUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "Only HTTP(S) URLs are allowed.");
const canonicalHoursKey = z.string().regex(
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:-(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?$/
);
export const canonicalHoursSchema = z.record(canonicalHoursKey, z.string().min(1).max(120));

export const verticalIdSchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/);
export type VerticalId = z.infer<typeof verticalIdSchema>;

export const factSourceRefSchema = z.object({
  factId: identifier,
  sourceSnapshotId: identifier,
  sourceBlockId: identifier.optional(),
  sourceUrl: publicUrl.optional(),
  evidenceClass: z.enum(["first_party", "third_party", "unknown"]).optional(),
  observedAt: isoTimestamp,
  confidence: z.number().min(0).max(1),
  ownerConfirmed: z.boolean()
}).strict();
export type FactSourceRef = z.infer<typeof factSourceRefSchema>;

const factSchema = z.object({
  id: identifier,
  kind: z.enum([
    "business_name",
    "description",
    "phone",
    "email",
    "address",
    "hours",
    "service_area",
    "offering",
    "proof",
    "link",
    "location"
  ]),
  label: z.string().min(1).max(160),
  value: z.unknown(),
  source: factSourceRefSchema
}).strict();

export const businessFactSchema = factSchema.extend({
  publicEligible: z.boolean()
}).strict();
export type BusinessFact = z.infer<typeof businessFactSchema>;

export const publicFactSchema = factSchema.extend({
  publicEligible: z.literal(true)
}).strict();
export type PublicFact = z.infer<typeof publicFactSchema>;

export const sourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  businessId: identifier,
  sourceType: z.enum(["website", "web_research", "owner_input", "operator_input"]),
  sourceUrl: publicUrl.optional(),
  contentHash,
  capturedAt: isoTimestamp,
  payload: z.record(z.string(), z.unknown())
}).strict();
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export const sourceSnapshotResourceRoleSchema = z.enum([
  "robots",
  "sitemap",
  "document",
  "rendered_document",
  "stylesheet",
  "script",
  "image",
  "font",
  "data",
  "other"
]);
export type SourceSnapshotResourceRole = z.infer<typeof sourceSnapshotResourceRoleSchema>;

export const sourceSnapshotResourceSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  sourceSnapshotId: identifier,
  captureKind: z.enum(["http_response", "rendered_dom"]),
  role: sourceSnapshotResourceRoleSchema,
  requestedUrl: publicUrl,
  finalUrl: publicUrl.optional(),
  outcome: z.enum(["fetched", "excluded", "failed", "unfinished"]),
  reason: z.string().min(1).max(160).optional(),
  status: z.number().int().min(100).max(599).optional(),
  contentType: z.string().min(1).max(200).optional(),
  storedEncoding: z.enum(["identity", "gzip"]).optional(),
  rawContentHash: contentHash.optional(),
  blobContentHash: contentHash.optional(),
  storageKey: z.string().min(1).max(1024).optional(),
  rawBytes: z.number().int().nonnegative(),
  storedBytes: z.number().int().nonnegative(),
  headers: z.record(z.string(), z.string()),
  redirectChain: z.array(z.object({
    url: publicUrl,
    status: z.number().int().min(300).max(399),
    location: publicUrl
  }).strict()),
  initiatorUrls: z.array(publicUrl),
  capturedAt: isoTimestamp,
  metadata: z.record(z.string(), z.unknown())
}).strict().superRefine((value, context) => {
  const retainedFields = [value.finalUrl, value.status, value.contentType, value.storedEncoding, value.rawContentHash, value.blobContentHash, value.storageKey];
  if (value.outcome === "fetched" && retainedFields.some((field) => field === undefined)) {
    context.addIssue({ code: "custom", message: "Fetched source resources require complete response and blob provenance." });
  }
  const retainedBodyFields = [value.storedEncoding, value.rawContentHash, value.blobContentHash, value.storageKey];
  if (retainedBodyFields.some((field) => field !== undefined) && retainedBodyFields.some((field) => field === undefined)) {
    context.addIssue({ code: "custom", message: "Retained source response bodies require complete encoding and blob provenance." });
  }
  if ((value.outcome === "excluded" || value.outcome === "unfinished") && (retainedBodyFields.some((field) => field !== undefined) || value.rawBytes || value.storedBytes)) {
    context.addIssue({ code: "custom", message: "Excluded and unfinished source resources cannot claim retained body bytes." });
  }
});
export type SourceSnapshotResource = z.infer<typeof sourceSnapshotResourceSchema>;

export const sourceSnapshotPageSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  sourceSnapshotId: identifier,
  resourceId: identifier,
  renderedResourceId: identifier.optional(),
  requestedUrl: publicUrl,
  finalUrl: publicUrl.optional(),
  path: z.string().startsWith("/").max(2048),
  outcome: z.enum(["fetched", "excluded", "failed", "unfinished"]),
  reason: z.string().min(1).max(160).optional(),
  status: z.number().int().min(100).max(599).optional(),
  contentType: z.string().max(200).optional(),
  canonical: publicUrl.optional(),
  indexability: z.enum(["indexable", "noindex", "unknown"]),
  sitemap: z.object({ url: publicUrl, lastModified: isoTimestamp.optional() }).strict().optional(),
  title: z.string().max(500).optional(),
  headings: z.array(z.string().min(1).max(500)),
  wordCount: z.number().int().nonnegative(),
  internalLinks: z.array(publicUrl),
  externalLinks: z.array(publicUrl),
  rawContentHash: contentHash.optional(),
  exactDuplicateOf: identifier.optional(),
  templateSignature: contentHash.optional(),
  linkProminence: z.number().int().nonnegative(),
  extractedText: z.string(),
  textContentHash: contentHash,
  producer: z.string().min(1).max(200),
  inputHash: contentHash,
  createdAt: isoTimestamp
}).strict();
export type SourceSnapshotPage = z.infer<typeof sourceSnapshotPageSchema>;

export const websiteSourceSnapshotPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("website-mirror"),
  sourceUrl: publicUrl,
  coverage: z.enum(["complete", "restricted", "incomplete"]),
  completionReason: z.enum(["queue_exhausted", "restricted", "deadline", "capture_size_fuse", "cancelled", "failures"]),
  manifestHash: contentHash,
  counts: z.object({
    documentsDiscovered: z.number().int().nonnegative(),
    documentsEligible: z.number().int().nonnegative(),
    documentsFetched: z.number().int().nonnegative(),
    documentsExcluded: z.number().int().nonnegative(),
    documentsFailed: z.number().int().nonnegative(),
    documentsUnfinished: z.number().int().nonnegative(),
    resourcesDiscovered: z.number().int().nonnegative(),
    resourcesFetched: z.number().int().nonnegative(),
    resourcesExcluded: z.number().int().nonnegative(),
    resourcesFailed: z.number().int().nonnegative(),
    resourcesUnfinished: z.number().int().nonnegative(),
    browserRendered: z.number().int().nonnegative(),
    uniqueBlobs: z.number().int().nonnegative(),
    rawBytes: z.number().int().nonnegative(),
    storedBytes: z.number().int().nonnegative()
  }).strict(),
  stages: z.object({
    discoveryMs: z.number().int().nonnegative(),
    documentFetchMs: z.number().int().nonnegative(),
    dependencyFetchMs: z.number().int().nonnegative(),
    browserFallbackMs: z.number().int().nonnegative(),
    blobPersistenceMs: z.number().int().nonnegative(),
    pageIndexMs: z.number().int().nonnegative(),
    factExtractionMs: z.number().int().nonnegative(),
    finalizationMs: z.number().int().nonnegative()
  }).strict(),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp,
  elapsedMs: z.number().int().nonnegative()
}).strict();
export type WebsiteSourceSnapshotPayload = z.infer<typeof websiteSourceSnapshotPayloadSchema>;

export const sourceSearchResultSchema = z.object({
  sourceId: identifier,
  pageId: identifier,
  url: publicUrl,
  path: z.string().startsWith("/"),
  title: z.string().max(500).optional(),
  score: z.number().nonnegative(),
  excerpt: z.string().min(1),
  contentHash
}).strict();
export type SourceSearchResult = z.infer<typeof sourceSearchResultSchema>;

export const assetOriginSchema = z.enum(["source_website", "owner_upload", "platform_generated"]);
export type AssetOrigin = z.infer<typeof assetOriginSchema>;

const assetProvenanceSchema = z.discriminatedUnion("origin", [
  z.object({
    origin: z.literal("source_website"),
    sourceUrl: publicUrl,
    sourcePageUrl: publicUrl,
    sourceSnapshotId: identifier,
    sourceResourceId: identifier.optional(),
    alt: z.string().max(500).optional(),
    preparation: z.object({
      processor: z.literal("sharp"),
      recipe: z.literal("logo-presentation"),
      recipeVersion: z.literal(1),
      sourceContentHash: contentHash,
      operations: z.array(z.enum([
        "trim_transparent_canvas",
        "trim_uniform_canvas",
        "remove_uniform_background"
      ])).max(3),
      sourceWidth: z.number().int().positive(),
      sourceHeight: z.number().int().positive(),
      contentBounds: z.object({
        left: z.number().int().nonnegative(),
        top: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive()
      }).strict(),
      backgroundColor: z.string().regex(/^#[a-f0-9]{6}$/).optional(),
      confidence: z.number().min(0).max(1)
    }).strict().optional()
  }).strict(),
  z.object({
    origin: z.literal("owner_upload"),
    uploadedBy: identifier,
    originalFileName: z.string().min(1).max(500).optional()
  }).strict(),
  z.object({
    origin: z.literal("platform_generated"),
    provider: z.literal("openai"),
    model: z.literal("gpt-image-2"),
    action: z.enum(["generate", "edit"]),
    purpose: z.enum(["hero", "section", "background", "gallery", "logo", "other"]),
    prompt: z.string().min(1).max(8000),
    sourceAssetRevisionIds: z.array(identifier).max(4)
  }).strict()
]);

const assetMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);

export const assetRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  assetId: identifier,
  businessId: identifier,
  contentHash,
  storageKey: z.string().min(1).max(1024),
  publicUrl: publicUrl.optional(),
  mimeType: assetMimeTypeSchema,
  bytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  origin: assetOriginSchema,
  provenance: assetProvenanceSchema,
  createdAt: isoTimestamp
}).strict().superRefine((value, context) => {
  if (value.origin !== value.provenance.origin) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["provenance", "origin"], message: "Asset origin must match provenance origin." });
  }
});
export type AssetRevision = z.infer<typeof assetRevisionSchema>;

export const businessOfferingSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(160),
  description: z.string().max(600).optional(),
  status: z.enum(["confirmed", "inactive"]),
  visibility: z.enum(["public", "hidden"]),
  sourceFactIds: z.array(identifier),
  confirmedAt: isoTimestamp.optional()
}).strict();
export type BusinessOffering = z.infer<typeof businessOfferingSchema>;

export const businessProofSchema = z.object({
  id: identifier,
  kind: z.enum(["testimonial", "credential", "warranty", "award", "offer", "insurance_support", "longevity"]),
  status: z.enum(["observed", "confirmed", "rejected", "inactive"]),
  publicText: z.string().min(1).max(600),
  verbatim: z.boolean(),
  sourceFactIds: z.array(identifier).min(1),
  expiresAt: isoTimestamp.optional(),
  confirmedAt: isoTimestamp.optional()
}).strict();
export type BusinessProof = z.infer<typeof businessProofSchema>;

export const assetRevisionRefSchema = z.object({
  assetId: identifier,
  revisionId: identifier,
  kind: z.enum(["photo", "logo", "icon", "document", "other"]),
  contentHash,
  storageKey: z.string().min(1).max(1024),
  publicUrl: publicUrl.optional(),
  mimeType: assetMimeTypeSchema,
  alt: z.string().max(500),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  origin: assetOriginSchema,
  sourceFactIds: z.array(identifier),
  activeForFutureBuilds: z.boolean()
}).strict();
export type AssetRevisionRef = z.infer<typeof assetRevisionRefSchema>;

export const businessStateSchema = z.object({
  schemaVersion: z.literal(1),
  businessId: identifier,
  siteId: identifier,
  revision: z.number().int().positive(),
  ownerOperationalRevision: z.number().int().positive(),
  stateHash: contentHash,
  updatedAt: isoTimestamp,
  identity: z.object({
    name: z.string().min(1).max(200),
    status: z.enum(["verified", "provisional"]),
    legalName: z.string().max(200).optional(),
    description: z.string().max(1200).optional(),
    categories: z.array(z.string().min(1).max(120)).max(20)
  }).strict(),
  contacts: z.object({
    phone: z.string().max(60).optional(),
    email: z.string().email().optional()
  }).strict(),
  locations: z.array(z.object({
    id: identifier,
    label: z.string().min(1).max(120),
    street: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    region: z.string().max(80).optional(),
    postalCode: z.string().max(24).optional(),
    country: z.string().length(2).default("US"),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    hours: canonicalHoursSchema.optional(),
    sourceFactIds: z.array(identifier)
  }).strict()).max(50),
  serviceAreas: z.array(z.object({
    id: identifier,
    label: z.string().min(1).max(160),
    sourceFactIds: z.array(identifier)
  }).strict()).max(100),
  offerings: z.array(businessOfferingSchema),
  proof: z.array(businessProofSchema),
  assets: z.array(assetRevisionRefSchema),
  links: z.array(z.object({
    id: identifier,
    kind: z.enum(["website", "social", "booking", "directions", "other"]),
    label: z.string().min(1).max(100),
    url: publicUrl,
    publicEligible: z.boolean(),
    sourceFactIds: z.array(identifier)
  }).strict()),
  facts: z.array(businessFactSchema)
}).strict();
export type BusinessState = z.infer<typeof businessStateSchema>;

export const agentAccessPolicySchema = z.object({
  search: z.enum(["allow", "disallow"]),
  aiInput: z.enum(["allow", "disallow"]),
  aiTrain: z.enum(["allow", "disallow"]),
  trainingPermission: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_granted") }).strict(),
    z.object({
      status: z.literal("granted"),
      ownerId: identifier,
      grantedAt: isoTimestamp,
      recordedBy: identifier,
      reason: z.string().min(1).max(1000)
    }).strict()
  ])
}).strict().superRefine((value, context) => {
  if (value.aiTrain === "allow" && value.trainingPermission.status !== "granted") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aiTrain"],
      message: "AI training may be allowed only after owner permission is recorded."
    });
  }
});
export type AgentAccessPolicy = z.infer<typeof agentAccessPolicySchema>;

export const siteIntentSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  revision: z.number().int().positive(),
  ownerIntentRevision: z.number().int().positive(),
  intentHash: contentHash,
  updatedAt: isoTimestamp,
  audience: z.string().max(600).optional(),
  positioning: z.string().max(600).optional(),
  voice: z.array(z.string().min(1).max(80)).max(8),
  primaryConversion: z.enum(["auto", "call", "form", "booking", "visit"]),
  pageRequirements: z.array(z.object({
    id: identifier,
    purpose: z.enum(["home", "service", "about", "contact", "location", "gallery", "custom"]),
    slug: z.string().max(160).regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$|^$/),
    title: z.string().min(1).max(120),
    required: z.boolean()
  }).strict()),
  brandConstraints: z.object({
    preferredColors: z.array(z.string().max(80)).max(8),
    prohibitedColors: z.array(z.string().max(80)).max(8),
    preserveLogo: z.boolean(),
    notes: z.array(z.string().max(300)).max(12)
  }).strict(),
  enabledCapabilities: z.array(z.enum(["forms", "analytics", "maps", "proof", "gallery", "disclosure"])),
  agentAccessPolicy: agentAccessPolicySchema,
  notes: z.array(z.string().max(400)).max(20)
}).strict();
export type SiteIntent = z.infer<typeof siteIntentSchema>;

export const leadFormFieldRoleSchema = z.enum([
  "contact_name",
  "contact_email",
  "contact_phone",
  "message",
  "custom"
]);
export type LeadFormFieldRole = z.infer<typeof leadFormFieldRoleSchema>;
export const leadFormFieldSchema = z.object({
  id: identifier,
  label: z.string().min(1).max(120),
  role: leadFormFieldRoleSchema,
  type: z.enum(["text", "email", "phone", "textarea", "select", "radio", "checkbox"]),
  required: z.boolean(),
  options: z.array(z.string().min(1).max(120)).max(40).optional(),
  placeholder: z.string().max(160).optional(),
  helpText: z.string().max(300).optional()
}).strict();

export const formDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  key: identifier,
  revision: z.number().int().positive(),
  name: z.string().min(1).max(120),
  status: z.enum(["candidate_only", "published", "retired"]),
  destination: z.literal("lead_inbox"),
  fields: z.array(leadFormFieldSchema).min(1).max(30).superRefine((fields, context) => {
    const fieldIds = new Map<string, number>();
    for (const role of ["contact_email", "contact_phone", "message"] as const) {
      if (fields.filter((field) => field.role === role).length > 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A lead form may define at most one ${role} field.`
        });
      }
    }
    for (const [index, field] of fields.entries()) {
      const firstFieldIndex = fieldIds.get(field.id);
      if (firstFieldIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Lead form field IDs must be unique; ${field.id} is also used at index ${firstFieldIndex}.`,
          path: [index, "id"]
        });
      } else {
        fieldIds.set(field.id, index);
      }
      if ((field.type === "select" || field.type === "radio") && !field.options?.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field.type} fields require options.`,
          path: [index, "options"]
        });
      }
      if (field.options && new Set(field.options).size !== field.options.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Field options must be unique.",
          path: [index, "options"]
        });
      }
      if (field.role === "contact_email" && field.type !== "email") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The contact_email role requires an email field.",
          path: [index, "type"]
        });
      }
      if (field.role === "contact_phone" && field.type !== "phone") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The contact_phone role requires a phone field.",
          path: [index, "type"]
        });
      }
    }
  }),
  submitLabel: z.string().min(1).max(80),
  successMessage: z.string().min(1).max(300),
  createdAt: isoTimestamp
}).strict();
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export const leadFormConfigurationSchema = formDefinitionSchema.pick({
  key: true,
  name: true,
  fields: true,
  submitLabel: true,
  successMessage: true
}).strict();
export type LeadFormConfiguration = z.infer<typeof leadFormConfigurationSchema>;

export const sitePublicBuildInputSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  businessId: identifier,
  createdAt: isoTimestamp,
  ownerOperationalRevision: z.number().int().positive(),
  ownerIntentRevision: z.number().int().positive(),
  inputHash: contentHash,
  business: z.object({
    name: z.string().min(1).max(200),
    identityStatus: z.enum(["verified", "provisional"]),
    description: z.string().max(1200).optional(),
    contacts: businessStateSchema.shape.contacts,
    locations: businessStateSchema.shape.locations,
    serviceAreas: businessStateSchema.shape.serviceAreas,
    offerings: z.array(businessOfferingSchema).refine((items) => items.every((item) => item.visibility !== "hidden")),
    proof: z.array(businessProofSchema).refine((items) => items.every((item) => item.status === "confirmed")),
    assets: z.array(assetRevisionRefSchema),
    links: businessStateSchema.shape.links.refine((items) => items.every((item) => item.publicEligible))
  }).strict(),
  publicFacts: z.array(publicFactSchema),
  intent: siteIntentSchema,
  forms: z.array(formDefinitionSchema).superRefine((forms, context) => {
    const formIds = new Map<string, number>();
    const formKeys = new Map<string, number>();
    for (const [index, form] of forms.entries()) {
      const firstIdIndex = formIds.get(form.id);
      if (firstIdIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Form definition IDs must be unique; ${form.id} is also used at index ${firstIdIndex}.`,
          path: [index, "id"]
        });
      } else {
        formIds.set(form.id, index);
      }
      const firstKeyIndex = formKeys.get(form.key);
      if (firstKeyIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Form definition keys must be unique; ${form.key} is also used at index ${firstKeyIndex}.`,
          path: [index, "key"]
        });
      } else {
        formKeys.set(form.key, index);
      }
    }
  }),
  capabilityConfiguration: z.object({
    formsEndpoint: z.string().startsWith("/"),
    analyticsEndpoint: z.string().startsWith("/"),
    mapsMode: z.literal("managed_directions"),
    trustedRuntimeSeries: identifier
  }).strict(),
  sourceSnapshotIds: z.array(identifier),
  assetRevisionIds: z.array(identifier)
}).strict();
export type SitePublicBuildInput = z.infer<typeof sitePublicBuildInputSchema>;

export const workspaceFileSchema = z.object({
  path: z.string().min(1).max(300).regex(/^(?!\/)(?!.*\.\.)(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/),
  contentHash,
  bytes: z.number().int().nonnegative()
}).strict();

export const siteWorkspaceRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  publicBuildInputId: identifier,
  ownerOperationalRevision: z.number().int().positive(),
  ownerIntentRevision: z.number().int().positive(),
  parentRevisionId: identifier.optional(),
  revisionNumber: z.number().int().positive(),
  sourceHash: contentHash,
  sourceArchiveKey: z.string().min(1).max(1024),
  files: z.array(workspaceFileSchema).min(1).max(500),
  createdAt: isoTimestamp,
  createdBy: z.object({ kind: z.enum(["agent", "owner", "operator", "system"]), id: identifier }).strict()
}).strict();
export type SiteWorkspaceRevision = z.infer<typeof siteWorkspaceRevisionSchema>;

export const factBindingSchema = z.object({
  id: identifier,
  route: z.string().startsWith("/"),
  text: z.string().min(1).max(1200),
  origin: z.enum(["sdk", "structured_data"]),
  sourceFactIds: z.array(identifier).min(1),
  span: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive()
  }).strict().optional()
}).strict();
export type FactBinding = z.infer<typeof factBindingSchema>;

export const artifactQaSchema = z.object({
  hardGate: z.enum(["passed", "failed"]),
  checkedAt: isoTimestamp,
  routesChecked: z.number().int().nonnegative(),
  linksChecked: z.number().int().nonnegative(),
  findings: z.array(z.object({
    id: identifier,
    severity: z.enum(["error", "warning", "info"]),
    area: z.enum(["html", "css", "route", "link", "asset", "claim", "capability", "metadata", "accessibility", "render"]),
    message: z.string().min(1).max(1000),
    route: z.string().startsWith("/").optional()
  }).strict()),
  screenshotKeys: z.array(z.string().min(1).max(1024))
}).strict();

export const siteBuildArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  workspaceRevisionId: identifier,
  publicBuildInputId: identifier,
  ownerOperationalRevision: z.number().int().positive(),
  ownerIntentRevision: z.number().int().positive(),
  createdAt: isoTimestamp,
  artifactHash: contentHash,
  storagePrefix: z.string().min(1).max(1024),
  files: z.array(z.object({
    path: z.string().min(1).max(300),
    contentType: z.string().min(1).max(120),
    contentHash,
    bytes: z.number().int().nonnegative(),
    storageKey: z.string().min(1).max(1024)
  }).strict()).min(1),
  routes: z.array(z.object({
    path: z.string().startsWith("/"),
    htmlFile: z.string().min(1).max(300),
    title: z.string().min(1).max(200),
    description: z.string().max(500)
  }).strict()).min(1),
  factBindings: z.array(factBindingSchema),
  capabilityBindings: z.array(z.object({
    id: identifier,
    kind: z.enum(["form", "analytics", "map", "gallery", "disclosure"]),
    route: z.string().startsWith("/"),
    config: z.record(z.string(), z.unknown())
  }).strict()),
  runtimeSeriesId: identifier,
  runtimePatchAtFinalization: identifier,
  toolchainVersion: z.string().min(1).max(120),
  sandboxImageDigest: contentHash,
  qa: artifactQaSchema
}).strict();
export type SiteBuildArtifact = z.infer<typeof siteBuildArtifactSchema>;

export const siteVersionSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  number: z.number().int().positive(),
  status: z.enum(["candidate", "stale", "published", "superseded", "rolled_back", "rejected"]),
  artifactId: identifier,
  artifactHash: contentHash,
  workspaceRevisionId: identifier,
  publicBuildInputId: identifier,
  ownerOperationalRevision: z.number().int().positive(),
  ownerIntentRevision: z.number().int().positive(),
  formDefinitionIds: z.array(identifier),
  sourceSnapshotIds: z.array(identifier),
  assetRevisionIds: z.array(identifier),
  createdAt: isoTimestamp,
  createdBy: z.object({ kind: z.enum(["agent", "owner", "operator", "system"]), id: identifier }).strict(),
  publishedAt: isoTimestamp.optional(),
  replacedVersionId: identifier.optional(),
  staleReason: z.enum(["owner_authority_changed", "managed_dependency_changed"]).optional()
}).strict();
export type SiteVersion = z.infer<typeof siteVersionSchema>;

export const candidateRedirectSchema = z.object({
  sourcePath: z.string().startsWith("/").max(512),
  destinationPath: z.string().startsWith("/").max(512),
  reason: z.string().min(1).max(500).optional()
}).strict();
export type CandidateRedirect = z.infer<typeof candidateRedirectSchema>;

export const siteVersionRedirectSchema = candidateRedirectSchema.extend({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  versionId: identifier,
  createdAt: isoTimestamp
}).strict();
export type SiteVersionRedirect = z.infer<typeof siteVersionRedirectSchema>;

export const retiredSourcePathSchema = z.object({
  sourcePath: z.string().startsWith("/").max(512),
  reason: z.string().min(1).max(500).optional()
}).strict();
export type RetiredSourcePath = z.infer<typeof retiredSourcePathSchema>;

export const siteSourceCoverageEntrySchema = z.object({
  sourcePageId: identifier,
  sourceUrl: publicUrl,
  sourcePath: z.string().startsWith("/").max(2048),
  indexability: z.enum(["indexable", "noindex", "unknown"]),
  disposition: z.enum(["preserved", "redirected", "canonical_duplicate", "retired", "unaccounted"]),
  destinationPath: z.string().startsWith("/").max(512).optional(),
  reason: z.string().max(500).optional()
}).strict();

export const siteSourceCoverageReportSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  siteId: identifier,
  versionId: identifier,
  sourceSnapshotId: identifier,
  sourceContentHash: contentHash,
  artifactHash: contentHash,
  generatedAt: isoTimestamp,
  counts: z.object({
    sourcePages: z.number().int().nonnegative(),
    preserved: z.number().int().nonnegative(),
    redirected: z.number().int().nonnegative(),
    canonicalDuplicates: z.number().int().nonnegative(),
    retired: z.number().int().nonnegative(),
    unaccounted: z.number().int().nonnegative(),
    newRoutes: z.number().int().nonnegative()
  }).strict(),
  entries: z.array(siteSourceCoverageEntrySchema),
  newRoutes: z.array(z.string().startsWith("/"))
}).strict();
export type SiteSourceCoverageReport = z.infer<typeof siteSourceCoverageReportSchema>;

export const siteElementSelectionSchema = z.object({
  route: z.string().startsWith("/"),
  selector: z.string().min(1).max(500).optional(),
  label: z.string().min(1).max(160).optional(),
  workspaceRevisionId: identifier.optional(),
  versionId: identifier.optional()
}).strict();
export type SiteElementSelection = z.infer<typeof siteElementSelectionSchema>;

export const platformSiteRecordSchema = z.object({
  id: identifier,
  ownerUserId: z.string().uuid().optional(),
  sourceUrl: publicUrl.optional(),
  normalizedSource: publicUrl.optional(),
  businessId: identifier,
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(["draft", "active", "paused"]),
  reportingTimezone: z.string().min(1).max(100).default("UTC"),
  publishedVersionId: identifier.optional(),
  currentWorkspaceRevisionId: identifier.optional(),
  currentPublicBuildInputId: identifier.optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp
}).strict();
export type PlatformSiteRecord = z.infer<typeof platformSiteRecordSchema>;

export const operatorQueueItemSchema = z.object({
  schemaVersion: z.literal("operator-queue-item"),
  id: identifier,
  siteId: identifier,
  versionId: identifier.optional(),
  runId: identifier.optional(),
  reason: z.enum(["verification_failure", "authoring_runtime_failure", "subjective_finding", "stale_candidate", "authority_publish_failure", "maintenance_failure"]),
  severity: z.enum(["urgent", "high", "normal", "low"]),
  status: z.enum(["open", "in_review", "resolved", "dismissed"]),
  findings: z.array(z.record(z.string(), z.unknown())),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  resolvedBy: identifier.optional(),
  resolvedAt: isoTimestamp.optional(),
  resolutionNote: z.string().min(1).max(2000).optional()
}).strict().superRefine((value, context) => {
  if (["resolved", "dismissed"].includes(value.status) && (!value.resolvedBy || !value.resolvedAt || !value.resolutionNote)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Terminal queue items require an actor, timestamp, and resolution note." });
  }
});
export type OperatorQueueItem = z.infer<typeof operatorQueueItemSchema>;

export const siteCandidateIntegritySchema = z.object({
  schemaVersion: z.literal(1),
  siteId: identifier,
  versionId: identifier,
  artifactHash: contentHash,
  status: z.enum(["current", "stale_owner_authority", "failed_integrity"]),
  issues: z.array(z.object({
    code: z.enum(["owner_authority_changed", "artifact_integrity", "managed_capability", "stranded_redirect"]),
    message: z.string().min(1).max(2000),
    referenceId: identifier.optional()
  }).strict()),
  checkedAt: isoTimestamp
}).strict();
export type SiteCandidateIntegrity = z.infer<typeof siteCandidateIntegritySchema>;

export const siteAgentPrincipalSchema = z.object({
  kind: z.enum(["owner", "operator"]),
  id: identifier
}).strict();
export type SiteAgentPrincipal = z.infer<typeof siteAgentPrincipalSchema>;

export const siteSandboxSlotSchema = z.enum(["blue", "green"]);
export type SiteSandboxSlot = z.infer<typeof siteSandboxSlotSchema>;

export const siteSandboxManifestSchema = z.object({
  kind: z.literal("site-sandbox-manifest"),
  apiIdentity: z.string().min(1).max(200),
  storageIdentity: z.string().min(1).max(200),
  durableObjectIdentity: z.string().min(1).max(200),
  artifactContractIdentity: z.string().min(1).max(200),
  toolchainIdentity: z.string().min(1).max(200),
  sourcePolicyIdentity: z.string().min(1).max(200)
}).strict();
export type SiteSandboxManifest = z.infer<typeof siteSandboxManifestSchema>;

export const siteSandboxDeploymentSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  slot: siteSandboxSlotSchema,
  workerVersionId: z.string().min(1).max(200),
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/),
  imageDigest: contentHash,
  credentialSlot: siteSandboxSlotSchema,
  manifest: siteSandboxManifestSchema,
  createdAt: isoTimestamp
}).strict().superRefine((value, context) => {
  if (value.credentialSlot !== value.slot) {
    context.addIssue({ code: "custom", path: ["credentialSlot"], message: "Credential slot must match the physical deployment slot." });
  }
});
export type SiteSandboxDeployment = z.infer<typeof siteSandboxDeploymentSchema>;

export const siteSandboxControlSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal("production"),
  blueDeploymentId: identifier,
  greenDeploymentId: identifier.optional(),
  activeDeploymentId: identifier,
  updatedAt: isoTimestamp
}).strict().superRefine((value, context) => {
  if (value.activeDeploymentId !== value.blueDeploymentId && value.activeDeploymentId !== value.greenDeploymentId) {
    context.addIssue({ code: "custom", path: ["activeDeploymentId"], message: "Active deployment must be assigned to blue or green." });
  }
});
export type SiteSandboxControl = z.infer<typeof siteSandboxControlSchema>;

export const siteAgentWorkspaceCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  runId: identifier,
  executionNumber: z.number().int().positive(),
  baseWorkspaceRevisionId: identifier.optional(),
  publicBuildInputId: identifier,
  sandboxDeploymentId: identifier,
  sandboxId: z.string().min(1).max(255),
  sandboxRevision: z.string().min(1).max(200),
  workspaceHash: contentHash,
  continuation: z.object({
    generation: z.number().int().positive(),
    sequence: z.number().int().nonnegative()
  }).strict().optional(),
  backup: z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    key: z.string().regex(/^workspace-backups\/[a-f0-9]{64}\.tar\.gz$/),
    contentHash,
    bytes: z.number().int().nonnegative()
  }).strict(),
  sidecar: z.object({
    key: z.string().regex(/^workspace-sources\/[a-f0-9]{64}\.json$/),
    contentHash,
    bytes: z.number().int().nonnegative()
  }).strict(),
  producer: z.string().min(1).max(200),
  modelId: z.string().min(1).max(120),
  skillIdentity: z.string().min(1).max(200),
  inputHash: contentHash,
  createdAt: isoTimestamp
}).strict().superRefine((value, context) => {
  if (value.backup.key !== `workspace-backups/${value.backup.id}.tar.gz`
    || value.sidecar.key !== `workspace-sources/${value.backup.id}.json`) {
    context.addIssue({ code: "custom", path: ["backup"], message: "Checkpoint object keys must match the backup ID." });
  }
});
export type SiteAgentWorkspaceCheckpoint = z.infer<typeof siteAgentWorkspaceCheckpointSchema>;

export const siteAgentSessionSchema = z.object({
  schemaVersion: z.literal("site-agent-session"),
  id: identifier,
  siteId: identifier,
  principal: siteAgentPrincipalSchema,
  status: z.enum(["active", "checkpointed", "rotating", "closed", "failed"]),
  currentWorkspaceRevisionId: identifier.optional(),
  publicBuildInputId: identifier,
  sandboxProvider: z.literal("cloudflare"),
  sandboxDeploymentId: identifier.optional(),
  sandboxId: z.string().max(255).optional(),
  sandboxLastStartedAt: isoTimestamp.optional(),
  sandboxLastDestroyedAt: isoTimestamp.optional(),
  sandboxProvisionedMs: z.number().int().nonnegative().default(0),
  sandboxDestroyAttempts: z.number().int().nonnegative().default(0),
  leaseTokenHash: contentHash,
  leaseExpiresAt: isoTimestamp,
  rotateAt: isoTimestamp,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp
}).strict();
export type SiteAgentSession = z.infer<typeof siteAgentSessionSchema>;

export const siteAgentMessageSchema = z.object({
  schemaVersion: z.literal("site-agent-message"),
  id: identifier,
  sessionId: identifier,
  runId: identifier.optional(),
  role: z.enum(["owner", "agent", "operator", "system"]),
  content: z.string().min(1),
  selection: siteElementSelectionSchema.optional(),
  createdAt: isoTimestamp
}).strict();
export type SiteAgentMessage = z.infer<typeof siteAgentMessageSchema>;

export const siteAgentApiProviderSchema = z.enum(["openai", "openrouter"]);
export type SiteAgentApiProvider = z.infer<typeof siteAgentApiProviderSchema>;
export const siteAgentCostSourceSchema = z.enum(["provider_reported", "catalog_estimate", "mixed", "unavailable"]);

export const siteAgentRunEventSchema = z.object({
  schemaVersion: z.literal("site-agent-run-event"),
  id: identifier,
  runId: identifier,
  sequence: z.number().int().nonnegative(),
  kind: z.enum(["run", "turn", "model_request", "tool_call", "build", "inspection"]),
  name: z.string().min(1).max(120),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  turnIndex: z.number().int().positive().optional(),
  apiProvider: siteAgentApiProviderSchema.optional(),
  modelId: z.string().min(1).max(120).optional(),
  servedModelId: z.string().min(1).max(160).optional(),
  upstreamProvider: z.string().min(1).max(160).optional(),
  providerRequestId: z.string().min(1).max(255).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costSource: siteAgentCostSourceSchema.optional(),
  upstreamInferenceCostUsd: z.number().nonnegative().optional(),
  modelDurationMs: z.number().int().nonnegative().optional(),
  summary: z.record(z.string(), z.unknown()),
  payloadRef: z.string().min(1).max(1024).optional(),
  payloadHash: contentHash.optional(),
  payloadExpiresAt: isoTimestamp.optional(),
  errorCode: z.string().min(1).max(160).optional(),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp.optional()
}).strict().superRefine((value, context) => {
  if (value.status !== "running" && !value.completedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Terminal run events require a completion timestamp." });
  }
  if ((value.payloadRef && !value.payloadHash) || (!value.payloadRef && value.payloadHash)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Run-event payload references and hashes must be stored together." });
  }
});
export type SiteAgentRunEvent = z.infer<typeof siteAgentRunEventSchema>;

export const siteAgentFailureCodeSchema = z.enum([
  "source_preparation_failed",
  "platform_version_mismatch",
  "model_tool_schema_invalid",
  "artifact_contract_invalid",
  "sandbox_unavailable",
  "provider_quota_exhausted",
  "provider_temporarily_unavailable",
  "input_budget_exhausted",
  "output_budget_exhausted",
  "context_capacity_exhausted",
  "cost_limit_exhausted",
  "cost_telemetry_unavailable",
  "browser_verification_unavailable",
  "deadline_exhausted",
  "execution_deadline_exceeded",
  "worker_interrupted",
  "authoring_stalled",
  "authoring_unresolved",
  "unknown_internal_failure"
]);
export type SiteAgentFailureCode = z.infer<typeof siteAgentFailureCodeSchema>;

export const siteAgentFailureCategorySchema = z.enum(["platform", "provider", "budget", "authoring", "worker"]);
export type SiteAgentFailureCategory = z.infer<typeof siteAgentFailureCategorySchema>;

export const siteArchitectureRouteSchema = z.object({
  path: z.string().startsWith("/").max(512),
  label: z.string().min(1).max(240),
  purpose: z.string().min(12).max(1000),
  pageType: z.string().min(1).max(120),
  parentPath: z.string().startsWith("/").max(512).nullable(),
  navigation: z.enum(["primary", "footer", "contextual", "none"]),
  sourcePaths: z.array(z.string().startsWith("/").max(2048))
}).strict();
export type SiteArchitectureRoute = z.infer<typeof siteArchitectureRouteSchema>;

export const siteArchitectureSourceDispositionSchema = z.object({
  sourcePath: z.string().startsWith("/").max(2048),
  disposition: z.enum(["preserved", "redirected", "canonical_duplicate", "retired"]),
  targetPath: z.string().startsWith("/").max(512).nullable()
}).strict();
export type SiteArchitectureSourceDisposition = z.infer<typeof siteArchitectureSourceDispositionSchema>;

export const siteArchitecturePlanSchema = z.object({
  strategy: z.string().min(1).max(4000),
  primaryNavigation: z.array(z.object({
    label: z.string().min(1).max(120),
    path: z.string().startsWith("/").max(512)
  }).strict()),
  routes: z.array(siteArchitectureRouteSchema).min(1),
  sourceDispositions: z.array(siteArchitectureSourceDispositionSchema),
  authoringGuidance: z.array(z.string().min(1).max(1200))
}).strict();
export type SiteArchitecturePlan = z.infer<typeof siteArchitecturePlanSchema>;

const siteAgentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  reasoningTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  costSource: siteAgentCostSourceSchema,
  upstreamInferenceCostUsd: z.number().nonnegative().default(0),
  durationMs: z.number().int().nonnegative()
}).strict();

export const siteAgentArchitectureSchema = z.object({
  schemaVersion: z.literal(1),
  producer: z.string().min(1).max(200),
  modelId: z.literal("gpt-5.6-luna"),
  reasoningEffort: z.literal("high"),
  publicBuildInputId: identifier,
  sourceInventoryHash: contentHash,
  planHash: contentHash,
  generatedAt: isoTimestamp,
  plan: siteArchitecturePlanSchema,
  usage: siteAgentUsageSchema
}).strict();
export type SiteAgentArchitecture = z.infer<typeof siteAgentArchitectureSchema>;

export const siteAgentRunRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("initial_build"),
    sourceUrl: publicUrl
  }).strict(),
  z.object({
    kind: z.literal("owner_instruction"),
    messageIds: z.array(identifier).min(1).max(200)
  }).strict(),
  z.object({
    kind: z.literal("authority_refresh"),
    changeRequestIds: z.array(identifier).min(1).max(200)
  }).strict(),
  z.object({
    kind: z.literal("restore_design"),
    sourceVersionId: identifier
  }).strict()
]);
export type SiteAgentRunRequest = z.infer<typeof siteAgentRunRequestSchema>;

export const siteAgentContinuationHeadSchema = z.object({
  schemaVersion: z.literal(1),
  runId: identifier,
  generation: z.number().int().positive(),
  executionNumber: z.number().int().positive(),
  apiProvider: siteAgentApiProviderSchema,
  modelId: z.string().min(1).max(120),
  producer: z.string().min(1).max(200),
  skillIdentity: z.string().min(1).max(200),
  inputHash: contentHash,
  stablePrefixHash: contentHash,
  publicBuildInputId: identifier,
  workspaceCheckpoint: z.object({
    sandboxId: z.string().min(1).max(255).optional(),
    workspaceHash: contentHash.optional(),
    parentRevisionId: identifier.optional()
  }).strict(),
  latestSequence: z.number().int().nonnegative(),
  responseCount: z.number().int().nonnegative(),
  status: z.enum(["active", "awaiting_input", "terminal", "stale"]),
  regeneration: z.enum(["fresh", "resumed", "restarted_after_mismatch"]),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  purgeAfter: isoTimestamp.optional()
}).strict();
export type SiteAgentContinuationHead = z.infer<typeof siteAgentContinuationHeadSchema>;

export const siteAgentContinuationSegmentSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  runId: identifier,
  generation: z.number().int().positive(),
  sequence: z.number().int().positive(),
  executionNumber: z.number().int().positive(),
  apiProvider: siteAgentApiProviderSchema,
  modelId: z.string().min(1).max(120),
  producer: z.string().min(1).max(200),
  skillIdentity: z.string().min(1).max(200),
  inputHash: contentHash,
  stablePrefixHash: contentHash,
  responseCount: z.number().int().nonnegative(),
  kind: z.enum(["model_output", "tool_result", "continuation_prompt"]),
  blobRef: z.string().min(1).max(1024),
  contentHash,
  byteCount: z.number().int().nonnegative(),
  workspaceHash: contentHash.optional(),
  providerMetadata: z.record(z.string(), z.unknown()),
  createdAt: isoTimestamp
}).strict();
export type SiteAgentContinuationSegment = z.infer<typeof siteAgentContinuationSegmentSchema>;

export const siteAgentRunSchema = z.object({
  schemaVersion: z.literal("site-agent-run"),
  id: identifier,
  sessionId: identifier,
  siteId: identifier,
  publicBuildInputId: identifier,
  request: siteAgentRunRequestSchema,
  origin: z.enum(["owner_request", "control_plane", "system"]),
  requestedBy: z.string().min(1).max(320),
  kind: z.enum(["initial_build", "edit", "rebase"]),
  status: z.enum(["queued", "running", "needs_input", "succeeded", "failed", "cancelled"]),
  stage: z.enum(["queued", "retrieving_sources", "architecting", "authoring", "building", "fast_preview", "inspecting", "verifying", "needs_input", "candidate_ready", "failed"]),
  sandboxDeploymentId: identifier.optional(),
  resumeCheckpointId: identifier.optional(),
  checkpointRestartedAt: isoTimestamp.optional(),
  exactParentRevisionId: identifier.optional(),
  deferredUntilRunId: identifier.optional(),
  outputRevisionId: identifier.optional(),
  outputArtifactId: identifier.optional(),
  screenshotKeys: z.array(z.string().min(1).max(1024)).optional(),
  fastPreviewPath: z.string().startsWith("/").optional(),
  candidateVersionId: identifier.optional(),
  focusRoute: z.string().startsWith("/").max(300).optional(),
  changedRoutes: z.array(z.string().startsWith("/").max(300)).optional(),
  apiProvider: siteAgentApiProviderSchema,
  modelId: z.string().min(1).max(120),
  // Reader-only provenance may contain a retired experiment label. Live execution accepts only the canonical profile.
  authoringProfileId: z.string().min(1).optional(),
  architecture: siteAgentArchitectureSchema.optional(),
  supersedesRunId: identifier.optional(),
  retryOfRunId: identifier.optional(),
  coalescedIntoRunId: identifier.optional(),
  executionNumber: z.number().int().nonnegative().default(0),
  workerId: z.string().min(1).max(200).optional(),
  heartbeatAt: isoTimestamp.optional(),
  skillVersions: z.record(z.string(), z.string()),
  guardrails: z.object({
    deadlineAt: isoTimestamp,
    maxCostUsd: z.number().positive(),
    maxConsecutiveIdenticalFailures: z.number().int().min(2).max(20)
  }).strict(),
  usage: siteAgentUsageSchema,
  inputQuestion: z.string().min(1).max(600).optional(),
  failureCode: siteAgentFailureCodeSchema.optional(),
  failureCategory: siteAgentFailureCategorySchema.optional(),
  retryableByOwner: z.boolean().default(false),
  failureReason: z.string().max(2000).optional(),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp.optional()
}).strict();
export type SiteAgentRun = z.infer<typeof siteAgentRunSchema>;

export const trustedRuntimePatchSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  seriesId: identifier,
  version: z.string().min(1).max(80),
  contentHash,
  storageKey: z.string().min(1).max(1024),
  createdAt: isoTimestamp,
  provenance: z.object({ sourceRevision: z.string().min(1), builderVersion: z.string().min(1) }).strict(),
  securityStatus: z.enum(["pending", "audited", "revoked"]),
  compatibilityStatus: z.enum(["pending", "passed", "failed"]),
  promotedAt: isoTimestamp.optional(),
  promotedBy: identifier.optional()
}).strict();
export type TrustedRuntimePatch = z.infer<typeof trustedRuntimePatchSchema>;

export const trustedRuntimeSeriesSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  name: z.string().min(1).max(120),
  activePatchId: identifier,
  previousPatchId: identifier.optional(),
  updatedAt: isoTimestamp,
  updatedBy: identifier
}).strict();
export type TrustedRuntimeSeries = z.infer<typeof trustedRuntimeSeriesSchema>;

export const controlPlaneChangePayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm_facts"), factIds: z.array(identifier).min(1).max(200) }).strict(),
  z.object({ kind: z.literal("confirm_identity"), name: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("update_contact"), phone: z.string().max(60).optional(), email: z.string().email().optional() }).strict(),
  z.object({ kind: z.literal("update_hours"), locationId: identifier, hours: canonicalHoursSchema }).strict(),
  z.object({ kind: z.literal("add_offering"), name: z.string().min(2).max(160), description: z.string().max(600).optional() }).strict(),
  z.object({ kind: z.literal("set_offering"), offeringId: identifier, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("set_proof"), proofId: identifier, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("set_asset_active"), assetId: identifier, active: z.boolean() }).strict(),
  z.object({ kind: z.literal("register_asset"), asset: assetRevisionRefSchema, revision: assetRevisionSchema }).strict(),
  z.object({ kind: z.literal("update_external_link"), linkId: identifier, url: publicUrl }).strict(),
  z.object({ kind: z.literal("update_site_intent"), patch: siteIntentSchema.partial().omit({ schemaVersion: true, id: true, siteId: true, revision: true, ownerIntentRevision: true, intentHash: true, updatedAt: true, agentAccessPolicy: true }) }).strict(),
  z.object({ kind: z.literal("update_agent_access_policy"), policy: agentAccessPolicySchema }).strict(),
  z.object({ kind: z.literal("request_site_edit"), instruction: z.string().min(1).max(4000), selection: siteElementSelectionSchema.optional() }).strict()
]);
export type ControlPlaneChangePayload = z.infer<typeof controlPlaneChangePayloadSchema>;

export const controlPlaneChangeRequestSchema = z.object({
  schemaVersion: z.literal("control-plane-change-request"),
  id: identifier,
  siteId: identifier,
  businessId: identifier,
  targetAuthority: z.enum(["business_state", "site_intent", "workspace"]),
  payload: controlPlaneChangePayloadSchema,
  impact: z.enum(["deterministic", "reviewable", "structural"]),
  status: z.enum(["pending", "approved", "rejected", "applied", "failed", "superseded"]),
  expectedBusinessRevision: z.number().int().positive().optional(),
  expectedIntentRevision: z.number().int().positive().optional(),
  requestedBy: identifier,
  requestedAt: isoTimestamp,
  decidedBy: identifier.optional(),
  decidedAt: isoTimestamp.optional(),
  failureReason: z.string().max(2000).optional()
}).strict();
export type ControlPlaneChangeRequest = z.infer<typeof controlPlaneChangeRequestSchema>;
