import { z } from "zod";
export * from "./platform-versions";

const isoTimestamp = z.string().datetime({ offset: true });
const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const contentHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const publicUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "Only HTTP(S) URLs are allowed.");

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
export type FactSourceRefV1 = z.infer<typeof factSourceRefSchema>;

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

export const businessFactV2Schema = factSchema.extend({
  publicEligible: z.boolean()
}).strict();
export type BusinessFactV2 = z.infer<typeof businessFactV2Schema>;

export const publicFactSchema = factSchema.extend({
  publicEligible: z.literal(true)
}).strict();
export type PublicFactV1 = z.infer<typeof publicFactSchema>;

export const sourceSnapshotV1Schema = z.object({
  schemaVersion: z.literal("source-snapshot-v1"),
  id: identifier,
  businessId: identifier,
  sourceType: z.enum(["website", "google_places", "owner_input", "operator_input"]),
  sourceUrl: publicUrl.optional(),
  contentHash,
  capturedAt: isoTimestamp,
  payload: z.record(z.string(), z.unknown())
}).strict();
export type SourceSnapshotV1 = z.infer<typeof sourceSnapshotV1Schema>;

export const assetRevisionV1Schema = z.object({
  schemaVersion: z.literal("asset-revision-v1"),
  id: identifier,
  assetId: identifier,
  businessId: identifier,
  contentHash,
  storageKey: z.string().min(1).max(1024),
  publicUrl: publicUrl.optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  rightsStatus: z.enum(["preclaim_safe", "customer_granted", "reference_only", "unknown"]),
  attestation: z.object({
    attestedBy: identifier,
    attestedAt: isoTimestamp,
    statement: z.string().min(1).max(1000)
  }).strict().optional(),
  createdAt: isoTimestamp
}).strict();
export type AssetRevisionV1 = z.infer<typeof assetRevisionV1Schema>;

export const businessOfferingSchema = z.object({
  id: identifier,
  catalogId: identifier.optional(),
  customName: z.string().min(1).max(160).optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(600).optional(),
  status: z.enum(["observed", "confirmed", "rejected", "inactive"]),
  visibility: z.enum(["preview", "public", "hidden"]),
  pageMode: z.enum(["none", "shared", "dedicated"]),
  featured: z.boolean(),
  sourceFactIds: z.array(identifier),
  confirmedAt: isoTimestamp.optional()
}).strict().refine((value) => value.catalogId || value.customName, {
  message: "An offering must use a catalog ID or a custom name."
});
export type BusinessOfferingV2 = z.infer<typeof businessOfferingSchema>;

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
export type BusinessProofV2 = z.infer<typeof businessProofSchema>;

export const assetRevisionRefSchema = z.object({
  assetId: identifier,
  revisionId: identifier,
  kind: z.enum(["photo", "logo", "icon", "document", "other"]),
  contentHash,
  storageKey: z.string().min(1).max(1024),
  publicUrl: publicUrl.optional(),
  mimeType: assetRevisionV1Schema.shape.mimeType,
  alt: z.string().max(500),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  rightsStatus: z.enum(["preclaim_safe", "customer_granted", "reference_only"]),
  sourceFactIds: z.array(identifier),
  activeForFutureBuilds: z.boolean()
}).strict();
export type AssetRevisionRefV1 = z.infer<typeof assetRevisionRefSchema>;

export const businessStateV3Schema = z.object({
  schemaVersion: z.literal("business-state-v3"),
  businessId: identifier,
  siteId: identifier,
  revision: z.number().int().positive(),
  stateHash: contentHash,
  updatedAt: isoTimestamp,
  identity: z.object({
    name: z.string().min(1).max(200),
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
    googlePlaceId: z.string().max(255).optional(),
    hours: z.record(z.string(), z.string().max(120)).optional(),
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
  facts: z.array(businessFactV2Schema)
}).strict();
export type BusinessStateV3 = z.infer<typeof businessStateV3Schema>;

export const agentAccessPolicyV1Schema = z.object({
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
export type AgentAccessPolicyV1 = z.infer<typeof agentAccessPolicyV1Schema>;

export const siteIntentV3Schema = z.object({
  schemaVersion: z.literal("site-intent-v3"),
  id: identifier,
  siteId: identifier,
  revision: z.number().int().positive(),
  intentHash: contentHash,
  updatedAt: isoTimestamp,
  audience: z.string().max(600).optional(),
  positioning: z.string().max(600).optional(),
  voice: z.array(z.string().min(1).max(80)).max(8),
  primaryConversion: z.enum(["call", "form", "booking", "visit"]),
  pageRequirements: z.array(z.object({
    id: identifier,
    purpose: z.enum(["home", "service", "about", "contact", "location", "gallery", "custom"]),
    slug: z.string().max(160).regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$|^$/),
    title: z.string().min(1).max(120),
    required: z.boolean(),
    offeringId: identifier.optional()
  }).strict()).min(1).max(40),
  brandConstraints: z.object({
    preferredColors: z.array(z.string().max(80)).max(8),
    prohibitedColors: z.array(z.string().max(80)).max(8),
    preserveLogo: z.boolean(),
    notes: z.array(z.string().max(300)).max(12)
  }).strict(),
  enabledCapabilities: z.array(z.enum(["forms", "analytics", "maps", "proof", "gallery", "disclosure"])),
  agentAccessPolicy: agentAccessPolicyV1Schema,
  notes: z.array(z.string().max(400)).max(20)
}).strict();
export type SiteIntentV3 = z.infer<typeof siteIntentV3Schema>;

export const verticalContextModuleV1Schema = z.object({
  schemaVersion: z.literal("vertical-context-module-v1"),
  id: z.string().min(1).max(80),
  version: z.string().min(1).max(80),
  status: z.enum(["active", "test_only", "tombstoned"]),
  aliases: z.array(z.string().min(1).max(120)),
  classificationSignals: z.array(z.string().min(1).max(240)),
  terminology: z.record(z.string(), z.array(z.string().min(1).max(160))),
  offeringCatalog: z.array(z.object({
    id: identifier,
    name: z.string().min(1).max(160),
    aliases: z.array(z.string().min(1).max(160)),
    status: z.enum(["active", "tombstoned"])
  }).strict()),
  customerJourneys: z.array(z.string().min(1).max(500)),
  conversionRecommendations: z.array(z.string().min(1).max(500)),
  proofCautions: z.array(z.string().min(1).max(500)),
  contentOpportunities: z.array(z.string().min(1).max(500)),
  faqOpportunities: z.array(z.string().min(1).max(500)),
  seoAeoOpportunities: z.array(z.string().min(1).max(500)),
  structuredDataType: z.string().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9]*$/),
  skillRef: z.string().min(1).max(255),
  evaluationRef: z.string().min(1).max(255)
}).strict();
export type VerticalContextModuleV1 = z.infer<typeof verticalContextModuleV1Schema>;

export const formDefinitionV2Schema = z.object({
  schemaVersion: z.literal("form-definition-v2"),
  id: identifier,
  siteId: identifier,
  revision: z.number().int().positive(),
  name: z.string().min(1).max(120),
  status: z.enum(["candidate_only", "published", "retired"]),
  fields: z.array(z.object({
    id: identifier,
    label: z.string().min(1).max(120),
    type: z.enum(["text", "email", "phone", "textarea", "select"]),
    required: z.boolean(),
    options: z.array(z.string().max(120)).max(40).optional()
  }).strict()).min(1).max(30),
  submitLabel: z.string().min(1).max(80),
  successMessage: z.string().min(1).max(300),
  createdAt: isoTimestamp
}).strict();
export type FormDefinitionV2 = z.infer<typeof formDefinitionV2Schema>;

export const sitePublicBuildInputV3Schema = z.object({
  schemaVersion: z.literal("site-public-build-input-v3"),
  id: identifier,
  siteId: identifier,
  businessId: identifier,
  createdAt: isoTimestamp,
  businessStateRevision: z.number().int().positive(),
  siteIntentRevision: z.number().int().positive(),
  inputHash: contentHash,
  domainContext: verticalContextModuleV1Schema.optional(),
  business: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1200).optional(),
    contacts: businessStateV3Schema.shape.contacts,
    locations: businessStateV3Schema.shape.locations,
    serviceAreas: businessStateV3Schema.shape.serviceAreas,
    offerings: z.array(businessOfferingSchema).refine((items) => items.every((item) => item.visibility !== "hidden")),
    proof: z.array(businessProofSchema).refine((items) => items.every((item) => item.status === "confirmed")),
    assets: z.array(assetRevisionRefSchema).refine((items) => items.every((item) => item.rightsStatus !== undefined)),
    links: businessStateV3Schema.shape.links.refine((items) => items.every((item) => item.publicEligible))
  }).strict(),
  publicFacts: z.array(publicFactSchema),
  intent: siteIntentV3Schema,
  forms: z.array(formDefinitionV2Schema),
  capabilityConfiguration: z.object({
    formsEndpoint: z.string().startsWith("/"),
    analyticsEndpoint: z.string().startsWith("/"),
    mapsMode: z.literal("managed_directions"),
    trustedRuntimeSeries: identifier
  }).strict(),
  sourceSnapshotIds: z.array(identifier),
  assetRevisionIds: z.array(identifier)
}).strict();
export type SitePublicBuildInputV3 = z.infer<typeof sitePublicBuildInputV3Schema>;

export const workspaceFileSchema = z.object({
  path: z.string().min(1).max(300).regex(/^(?!\/)(?!.*\.\.)(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/),
  contentHash,
  bytes: z.number().int().nonnegative()
}).strict();

export const siteWorkspaceRevisionV1Schema = z.object({
  schemaVersion: z.literal("site-workspace-revision-v1"),
  id: identifier,
  siteId: identifier,
  parentRevisionId: identifier.optional(),
  revisionNumber: z.number().int().positive(),
  sourceHash: contentHash,
  sourceArchiveKey: z.string().min(1).max(1024),
  files: z.array(workspaceFileSchema).min(1).max(500),
  createdAt: isoTimestamp,
  createdBy: z.object({ kind: z.enum(["agent", "owner", "operator", "system"]), id: identifier }).strict()
}).strict();
export type SiteWorkspaceRevisionV1 = z.infer<typeof siteWorkspaceRevisionV1Schema>;

export const claimDeclarationV1Schema = z.object({
  id: identifier,
  route: z.string().startsWith("/"),
  selector: z.string().min(1).max(500).optional(),
  text: z.string().min(1).max(1200),
  kind: z.enum(["sdk_bound", "free_text", "structured_data"]),
  sourceFactIds: z.array(identifier).min(1),
  autoDeclared: z.boolean()
}).strict();
export type ClaimDeclarationV1 = z.infer<typeof claimDeclarationV1Schema>;

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

export const siteBuildArtifactV1Schema = z.object({
  schemaVersion: z.literal("site-build-artifact-v1"),
  id: identifier,
  siteId: identifier,
  workspaceRevisionId: identifier,
  publicBuildInputId: identifier,
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
  claims: z.array(claimDeclarationV1Schema),
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
export type SiteBuildArtifactV1 = z.infer<typeof siteBuildArtifactV1Schema>;

export const siteVersionV4Schema = z.object({
  schemaVersion: z.literal("site-version-v4"),
  id: identifier,
  siteId: identifier,
  number: z.number().int().positive(),
  status: z.enum(["candidate", "published", "superseded", "rolled_back", "rejected"]),
  artifactId: identifier,
  artifactHash: contentHash,
  workspaceRevisionId: identifier,
  publicBuildInputId: identifier,
  formDefinitionIds: z.array(identifier),
  sourceSnapshotIds: z.array(identifier),
  assetRevisionIds: z.array(identifier),
  createdAt: isoTimestamp,
  createdBy: z.object({ kind: z.enum(["agent", "owner", "operator", "system"]), id: identifier }).strict(),
  publishedAt: isoTimestamp.optional(),
  replacedVersionId: identifier.optional(),
  staleReason: z.string().max(1000).optional()
}).strict();
export type SiteVersionV4 = z.infer<typeof siteVersionV4Schema>;

export const siteElementSelectionV1Schema = z.object({
  route: z.string().startsWith("/"),
  selector: z.string().min(1).max(500).optional(),
  workspaceRevisionId: identifier.optional(),
  versionId: identifier.optional()
}).strict();
export type SiteElementSelectionV1 = z.infer<typeof siteElementSelectionV1Schema>;

export const platformSiteRecordSchema = z.object({
  id: identifier,
  workspaceId: identifier.optional(),
  businessId: identifier,
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(["draft", "experimental", "active", "paused"]),
  publishedVersionId: identifier.optional(),
  currentWorkspaceRevisionId: identifier.optional(),
  currentPublicBuildInputId: identifier.optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp
}).strict();
export type PlatformSiteRecord = z.infer<typeof platformSiteRecordSchema>;

export const verticalDemandEventSchema = z.object({
  schemaVersion: z.literal("vertical-demand-event"),
  id: identifier,
  sourceUrl: publicUrl,
  observedVertical: z.string().min(1).max(80).optional(),
  requestedBy: z.string().min(1).max(320),
  status: z.enum(["open", "reviewed", "dismissed"]),
  createdAt: isoTimestamp,
  reviewedAt: isoTimestamp.optional(),
  reviewedBy: identifier.optional()
}).strict();
export type VerticalDemandEvent = z.infer<typeof verticalDemandEventSchema>;

export const operatorQueueItemSchema = z.object({
  schemaVersion: z.literal("operator-queue-item"),
  id: identifier,
  siteId: identifier,
  versionId: identifier.optional(),
  runId: identifier.optional(),
  reason: z.enum(["verification_failure", "subjective_finding", "stale_candidate", "authority_publish_failure", "maintenance_failure"]),
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

export const siteVersionApprovalV1Schema = z.object({
  schemaVersion: z.literal("site-version-approval-v1"),
  id: identifier,
  siteId: identifier,
  versionId: identifier,
  artifactHash: contentHash,
  status: z.enum(["pending", "approved", "rejected"]),
  actorId: identifier,
  note: z.string().min(1).max(2000),
  createdAt: isoTimestamp
}).strict();
export type SiteVersionApprovalV1 = z.infer<typeof siteVersionApprovalV1Schema>;

export const sitePublicationReadinessV1Schema = z.object({
  schemaVersion: z.literal("site-publication-readiness-v1"),
  siteId: identifier,
  versionId: identifier,
  artifactHash: contentHash,
  status: z.enum(["ready", "blocked"]),
  blockers: z.array(z.object({
    code: z.enum(["experimental_site", "stale_input", "objective_qa", "asset_rights", "operator_approval", "unsafe_form", "stranded_redirect"]),
    message: z.string().min(1).max(2000),
    referenceId: identifier.optional()
  }).strict()),
  checkedAt: isoTimestamp
}).strict();
export type SitePublicationReadinessV1 = z.infer<typeof sitePublicationReadinessV1Schema>;

export const siteAgentSessionSchema = z.object({
  schemaVersion: z.literal("site-agent-session"),
  id: identifier,
  siteId: identifier,
  ownerId: identifier,
  status: z.enum(["active", "checkpointed", "rotating", "closed", "failed"]),
  currentWorkspaceRevisionId: identifier.optional(),
  publicBuildInputId: identifier,
  sandboxProvider: z.literal("cloudflare"),
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
  selection: siteElementSelectionV1Schema.optional(),
  createdAt: isoTimestamp
}).strict();
export type SiteAgentMessage = z.infer<typeof siteAgentMessageSchema>;

export const siteAgentRunEventSchema = z.object({
  schemaVersion: z.literal("site-agent-run-event"),
  id: identifier,
  runId: identifier,
  sequence: z.number().int().nonnegative(),
  kind: z.enum(["run", "turn", "model_request", "tool_call", "build", "inspection"]),
  name: z.string().min(1).max(120),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  turnIndex: z.number().int().positive().optional(),
  modelId: z.string().min(1).max(120).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
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

export const siteAgentRunSchema = z.object({
  schemaVersion: z.literal("site-agent-run"),
  id: identifier,
  sessionId: identifier,
  siteId: identifier,
  publicBuildInputId: identifier,
  origin: z.enum(["owner_request", "control_plane", "system"]),
  requestedBy: z.string().min(1).max(320),
  publishAfterSuccess: z.boolean(),
  kind: z.enum(["initial_build", "edit", "rebase"]),
  status: z.enum(["queued", "running", "needs_input", "succeeded", "failed", "cancelled"]),
  stage: z.enum(["queued", "authoring", "building", "fast_preview", "verifying", "needs_input", "candidate_ready", "failed"]),
  exactParentRevisionId: identifier.optional(),
  deferredUntilRunId: identifier.optional(),
  outputRevisionId: identifier.optional(),
  outputArtifactId: identifier.optional(),
  screenshotKeys: z.array(z.string().min(1).max(1024)).max(100).optional(),
  fastPreviewPath: z.string().startsWith("/").optional(),
  candidateVersionId: identifier.optional(),
  modelId: z.string().min(1).max(120),
  executionNumber: z.number().int().nonnegative().default(0),
  heartbeatAt: isoTimestamp.optional(),
  skillVersions: z.record(z.string(), z.string()),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    costEstimateStatus: z.enum(["configured", "unavailable"]),
    durationMs: z.number().int().nonnegative()
  }).strict(),
  inputQuestion: z.string().min(1).max(600).optional(),
  inputExpiresAt: isoTimestamp.optional(),
  failureReason: z.string().max(2000).optional(),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp.optional()
}).strict();
export type SiteAgentRun = z.infer<typeof siteAgentRunSchema>;

export const trustedRuntimePatchV1Schema = z.object({
  schemaVersion: z.literal("trusted-runtime-patch-v1"),
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
export type TrustedRuntimePatchV1 = z.infer<typeof trustedRuntimePatchV1Schema>;

export const trustedRuntimeSeriesV1Schema = z.object({
  schemaVersion: z.literal("trusted-runtime-series-v1"),
  id: identifier,
  name: z.string().min(1).max(120),
  activePatchId: identifier,
  previousPatchId: identifier.optional(),
  updatedAt: isoTimestamp,
  updatedBy: identifier
}).strict();
export type TrustedRuntimeSeriesV1 = z.infer<typeof trustedRuntimeSeriesV1Schema>;

export const controlPlaneChangePayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm_facts"), factIds: z.array(identifier).min(1).max(200) }).strict(),
  z.object({ kind: z.literal("update_contact"), phone: z.string().max(60).optional(), email: z.string().email().optional() }).strict(),
  z.object({ kind: z.literal("update_hours"), locationId: identifier, hours: z.record(z.string(), z.string().max(120)) }).strict(),
  z.object({ kind: z.literal("add_offering"), name: z.string().min(2).max(160), pageMode: z.enum(["none", "shared", "dedicated"]) }).strict(),
  z.object({ kind: z.literal("set_offering"), offeringId: identifier, enabled: z.boolean(), pageMode: z.enum(["none", "shared", "dedicated"]) }).strict(),
  z.object({ kind: z.literal("set_proof"), proofId: identifier, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("set_asset_active"), assetId: identifier, active: z.boolean() }).strict(),
  z.object({ kind: z.literal("register_asset"), asset: assetRevisionRefSchema, revision: assetRevisionV1Schema }).strict(),
  z.object({ kind: z.literal("attest_asset_rights"), assetRevisionId: identifier, statement: z.string().min(20).max(1000) }).strict(),
  z.object({ kind: z.literal("update_external_link"), linkId: identifier, url: publicUrl }).strict(),
  z.object({ kind: z.literal("update_site_intent"), patch: siteIntentV3Schema.partial().omit({ schemaVersion: true, id: true, siteId: true, revision: true, intentHash: true, updatedAt: true, agentAccessPolicy: true }) }).strict(),
  z.object({ kind: z.literal("update_agent_access_policy"), policy: agentAccessPolicyV1Schema }).strict(),
  z.object({ kind: z.literal("request_site_edit"), instruction: z.string().min(1).max(4000), selection: siteElementSelectionV1Schema.optional() }).strict()
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
