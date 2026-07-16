import type { ClaimVerificationLevel } from "./owner-access";

export type Vertical =
  | "restaurant"
  | "auto_body"
  | "auto_services"
  | "beauty_salon"
  | "med_spa"
  | "law_firm"
  | "dental"
  | "home_services"
  | "fitness"
  | "real_estate"
  | "landscaping"
  | "veterinary"
  | "creative_studio"
  | "general_local";

export type FieldProvenanceSource =
  | "website"
  | "google"
  | "places_api"
  | "owner"
  | "manual"
  | "other";

export type FieldProvenance = {
  source: FieldProvenanceSource;
  sourceUrl?: string;
  confidence: number;
  verified: boolean;
  observedAt: string;
};

export type RegenerableArtifactProvenanceV1 = {
  version: "regenerable-artifact-provenance-v1";
  producerId: string;
  producerVersion: string;
  modelId: string;
  createdAt: string;
  inputHashes: Record<string, string>;
  stale: boolean;
  staleReason?: string;
};

export type AssetReference = {
  id: string;
  url: string;
  alt: string;
  source: "generated" | "licensed" | "uploaded" | "website_reference" | "placeholder";
  rightsStatus: "preclaim_safe" | "customer_granted" | "reference_only" | "unknown";
  /** Natural pixel dimensions, when measured. Render surfaces must not display an asset above its natural size. */
  width?: number;
  height?: number;
  /** Model vision analysis for source/customer assets; generated/library assets may omit it. */
  analysisV1?: AssetAnalysisV1;
};

export type AssetAnalysisImageKindV1 =
  | "logo"
  | "storefront"
  | "team"
  | "person"
  | "vehicle"
  | "repair_detail"
  | "before_after"
  | "interior"
  | "equipment"
  | "product"
  | "food"
  | "space"
  | "generic_graphic"
  | "text_heavy_graphic"
  | "low_quality"
  | "unknown";

export type AssetAnalysisFocalPointV1 = "center" | "top" | "bottom" | "left" | "right";
export type AssetAnalysisWarningV1 =
  | "low_resolution"
  | "blurry"
  | "text_overlay"
  | "logo_like"
  | "collage_or_composite"
  | "awkward_empty_space"
  | "poor_lighting"
  | "not_business_relevant"
  | "rights_review_required";

export type AssetAnalysisV1 = {
  version: "asset-analysis-v1";
  source: "openai";
  model: string;
  analyzedAt: string;
  imageKind: AssetAnalysisImageKindV1;
  focalPoint: AssetAnalysisFocalPointV1;
  subjectPlacement: "centered" | "left" | "right" | "top" | "bottom" | "full_frame" | "unclear";
  warnings: AssetAnalysisWarningV1[];
  contentTags: string[];
  summary: string;
  limitations: string[];
};

export type AssetKind = "photo" | "logo" | "screenshot" | "icon" | "document" | "other";

export type AssetUsageScope =
  | "preclaim_preview"
  | "published_site"
  | "owner_dashboard"
  | "internal_planning"
  | "reference_only";

export type SiteAsset = {
  id: string;
  siteId: string;
  kind: AssetKind;
  url?: string;
  alt: string;
  source: AssetReference["source"];
  rightsStatus: AssetReference["rightsStatus"];
  usageScope: AssetUsageScope;
  ownerApproved: boolean;
  provenance?: FieldProvenance;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type PublicPresenceSignal = {
  id: string;
  siteId: string;
  provider: "google_places";
  source: "places_api" | "google";
  sourceUrl?: string;
  placeId?: string;
  confidence: number;
  observedAt: string;
  fields: {
    name?: string;
    phone?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    address?: BusinessProfile["address"];
    geo?: BusinessProfile["geo"];
    categories?: string[];
    hours?: Record<string, string>;
    rating?: number;
    userRatingCount?: number;
  };
  provenance: Record<string, FieldProvenance>;
  notes: string[];
};

export type BusinessFactRenderSafety = "render_safe" | "review_required" | "internal_only" | "blocked";

export type BusinessFactConfidence = "high" | "medium" | "low";

export type BusinessFactKind =
  | "name"
  | "description"
  | "phone"
  | "email"
  | "address"
  | "geo"
  | "hours"
  | "category"
  | "service"
  | "credential"
  | "offer"
  | "service_area"
  | "photo"
  | "logo"
  | "review_summary"
  | "testimonial"
  | "warranty"
  | "insurance_support"
  | "award"
  | "years_in_business"
  | "team_member"
  | "social_link"
  | "booking_link"
  | "ordering_link"
  | "press_link"
  | "proof_signal";

export type BusinessFact = {
  id: string;
  kind: BusinessFactKind;
  label: string;
  value: string | number | boolean | string[] | Record<string, unknown>;
  provenance: FieldProvenance;
  confidence: BusinessFactConfidence;
  renderSafety: BusinessFactRenderSafety;
  sourceUrl?: string;
  notes?: string[];
};

export type BusinessFactGraph = {
  id: string;
  siteId: string;
  createdAt: string;
  sources: Array<{
    id: string;
    type: "website" | "places_api" | "prompt" | "system";
    url?: string;
    confidence: number;
    observedAt: string;
  }>;
  facts: BusinessFact[];
  omittedFacts: Array<{
    id: string;
    kind: BusinessFactKind;
    label: string;
    reason: string;
  }>;
  sourceFactsV2?: SourceAwareFactV2[];
};

export type SourceAwareFactSourceType =
  | "crawl"
  | "schema"
  | "owner_admin"
  | "first_party"
  | "places_identity"
  | "manual"
  | "system";

export type SourceAwareFactPolicy = "durable_render" | "owner_review_required" | "live_only" | "internal_only" | "blocked";

export type SourceAwareFactV2 = {
  id: string;
  kind: BusinessFactKind;
  label: string;
  value: string | number | boolean | string[] | Record<string, unknown>;
  sourceType: SourceAwareFactSourceType;
  sourceId?: string;
  sourceUrl?: string;
  observedAt: string;
  confidence: number;
  renderPolicy: SourceAwareFactPolicy;
  sourcePolicy: SourceAwareFactPolicy;
  notes?: string[];
};

export type BusinessProfile = {
  id: string;
  siteId: string;
  name: string;
  vertical: Vertical;
  categories: string[];
  description?: string;
  phone?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  geo?: {
    latitude: number;
    longitude: number;
  };
  hours?: Record<string, string>;
  services: string[];
  serviceHighlights?: string[];
  credentials?: string[];
  offers?: string[];
  serviceAreas: string[];
  socialLinks: string[];
  bookingLinks: string[];
  orderingLinks: string[];
  photos: AssetReference[];
  logo?: AssetReference;
  /** Ranked crawl logo candidates; scraped-media picks the best by measured dimensions and clears this. */
  logoCandidates?: AssetReference[];
  reviewsSummary?: {
    rating?: number;
    count?: number;
    sources: string[];
  };
  pressLinks: string[];
  provenance: Record<string, FieldProvenance>;
};

export type SeoMetadata = {
  title: string;
  description: string;
  canonicalPath: string;
  noIndex?: boolean;
  openGraphImage?: string;
};

export type Theme = {
  paletteName: string;
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    primaryText: string;
    accent: string;
    border: string;
  };
  typography: {
    heading: string;
    body: string;
  };
  radius: "none" | "sm" | "md";
  density: "compact" | "standard" | "spacious";
  mood: "warm" | "premium" | "clinical" | "bold" | "utilitarian" | "editorial";
};

export type RendererVersion = "layout-v3";

export type DesignSchemaVersion = "design-v3";

export type SiteVersionArtifactRef = {
  artifactId: string;
  artifactType: SiteArtifactType;
  artifactVersion: string;
  contentHash: string;
  affectedPageId?: string;
  affectedSectionId?: string;
  affectedSlotId?: string;
};

export type SiteArtDirectionFontPairingIdV3 =
  | "display_sans_humanist"
  | "precision_grotesk";

export type SiteHeaderModeV3 =
  | "solid_editorial"
  | "compact_sticky";

export type SiteArtDirectionNavPlanV3 = {
  source: "generation_plan";
  items: Array<{
    label: string;
    kind: "anchor" | "page" | "dropdown";
    target?: string;
    children?: Array<{ label: string; target: string }>;
  }>;
  primaryCta: { label: string; target: string };
};

export type SiteArtDirectionV3 = {
  version: "site-art-direction-v3";
  recipeId: "precision_shop_editorial" | "trusted_local_service";
  fontPairingId: SiteArtDirectionFontPairingIdV3;
  colorSystem: "light_editorial" | "warm_neighborhood";
  spacingRhythm: "standard" | "spacious";
  headerMode: SiteHeaderModeV3;
  mediaTreatment: "editorial_crop" | "media_independent";
  buttonSystem: "solid_with_quiet_secondary" | "understated";
  cardTreatment: "minimal_surface" | "hairline_surface";
  density: "balanced";
  navPlan?: SiteArtDirectionNavPlanV3;
};

export type SlotKindV3 = "text" | "image" | "button" | "list" | "proof" | "contact_fact" | "map_link" | "form" | "nav";

export type SlotV3 = {
  id: string;
  kind: SlotKindV3;
  required: boolean;
  sourceFactIds: string[];
  artifactRefs: SiteVersionArtifactRef[];
};

export type ResponsiveRuleV3 = {
  breakpoint: "mobile" | "tablet" | "desktop";
  behavior: "stack" | "reorder" | "compress" | "hide_optional" | "preserve_crop";
  notes: string[];
};

export type ComponentControlSchemaV3 = {
  layout:
    | "single_column"
    | "two_column"
    | "overlay"
    | "asymmetric_grid"
    | "editorial_rows"
    | "card_grid"
    | "media_masthead"
    | "architectural_split"
    | "gallery_wall"
    | "mosaic_grid"
    | "story_panel"
    | "contact_panel";
  alignment: "start" | "center" | "end" | "split";
  width: "contained" | "wide" | "full_bleed";
  padding: "compact" | "standard" | "spacious";
  background: "site_bg" | "surface" | "brand" | "media" | "contrast";
  mediaCrop: "none" | "center" | "subject" | "wide" | "portrait";
  density: "open" | "balanced" | "dense";
};

export type SectionInstanceV3 = {
  id: string;
  family: string;
  variant: string;
  props: Record<string, unknown>;
  controls: ComponentControlSchemaV3;
  slots: SlotV3[];
  responsiveRules: ResponsiveRuleV3[];
  requiredFactKinds: BusinessFactKind[];
  optionalFactKinds: BusinessFactKind[];
  sparseBehavior: {
    minimumValidSlots: string[];
    omitWhenMissingFactKinds: BusinessFactKind[];
    blockWhenMissingFactKinds: BusinessFactKind[];
    gracefulDegradation: string;
  };
};

export type PageCompositionV3 = {
  id: string;
  version: "page-composition-v3";
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    seo: SeoMetadata;
    purpose: "homepage" | "service_landing" | "location_landing" | "supporting";
    sections: SectionInstanceV3[];
  }>;
};

export type MediaAssetDecisionV3 = {
  id: string;
  version: "media-asset-decision-v3";
  slotId: string;
  source: "first_party" | "curated_stock" | "generated_ai" | "text_layout_fallback";
  rightsStatus: "approved" | "preclaim_safe" | "restricted" | "unknown" | "owner_attestation_required";
  usageScope: "hero" | "section" | "background" | "thumbnail" | "not_public";
  sourceUrl?: string;
  artifactRef?: string;
  policyNotes: string[];
  mayImplyRealBusinessWork: boolean;
};

export type SiteVersionBase = {
  id: string;
  status: "draft" | "published";
  rendererVersion: RendererVersion;
  designSchemaVersion: DesignSchemaVersion;
  createdAt: string;
  theme?: Theme;
  presentation?: SiteVersionPresentation;
  ownerTouched?: boolean;
  ownerApprovedAt?: string;
  generationQa?: GenerationQaMetadata;
};

export type SiteVersionV3 = SiteVersionBase & {
  rendererVersion: "layout-v3";
  designSchemaVersion: "design-v3";
  artDirection: SiteArtDirectionV3;
  pageComposition: PageCompositionV3;
  mediaDecisions: MediaAssetDecisionV3[];
  artifactRefs: SiteVersionArtifactRef[];
};

export type SiteVersion = SiteVersionV3;

export type SiteModel = {
  id: string;
  slug: string;
  theme: Theme;
  versions: SiteVersion[];
  pinList: string[];
};

export type SiteVersionPresentation = {
  mobileActionBehavior: "always" | "after_hero" | "disabled";
  reservedMobileActionSpace: boolean;
};

export type GenerationQaReadiness = "pending" | "ready" | "blocked" | "unavailable";

export type GenerationQaBlockerCategory =
  | "data_incomplete"
  | "quality_failed"
  | "policy_review_required"
  | "render_failed"
  | "claim_unsupported"
  | "performance_failed"
  | "needs_operator_review";

export type GenerationQaBlocker = {
  id: string;
  title: string;
  detail: string;
  category?: GenerationQaBlockerCategory;
  severity?: "blocking" | "warning";
  viewport?: RenderViewportName;
};

export type GenerationQaWarning = {
  id: string;
  title: string;
  detail: string;
  viewport?: RenderViewportName;
};

export type GenerationQaPrimaryScreenshot = {
  storagePath: string;
  viewport: RenderViewportName;
  width: number;
  height: number;
  capturedAt: string;
};

export type GenerationQaMetadata = {
  schemaVersion: "canonical-generation-qa-v1";
  readiness: GenerationQaReadiness;
  siteModelHash?: string;
  qaRunId?: string;
  checkedAt?: string;
  blockers: GenerationQaBlocker[];
  warnings: GenerationQaWarning[];
  inspectionSummary?: RenderInspectionSummary;
  artifactRefs?: RenderInspectionArtifactRef[];
  /** Durable copy of the lead QA screenshot, stored in asset storage so admin surfaces can render thumbnails without re-rendering the site. */
  primaryScreenshot?: GenerationQaPrimaryScreenshot;
};

/**
 * Per-image rights attestation. One record per asset, stored on the asset's
 * metadata under `attestation` — blanket rights acceptance does not exist.
 */
export type AssetAttestationV2 = {
  attestedBy: string;
  attestedAt: string;
  imageHash: string;
  statement: string;
};

export type CleanedServiceV2 = {
  name: string;
  price?: string;
  sourceText: string;
  confidence: number;
};

export type BusinessUnderstandingConversionGoal = "call_first" | "form_first" | "booking_first" | "visit_first";

export type BusinessUnderstandingFactConfidenceV2 = {
  field: "name" | "phone" | "address" | "hours" | "services" | "service_areas" | "reviews";
  confidence: number;
  sourceBacked: boolean;
};

export type BrandExpressionMoodV1 = "clinical" | "warm" | "premium" | "technical" | "neighborhood" | "bold" | "quiet";
export type BrandExpressionFontPostureV1 = "utility" | "editorial" | "condensed" | "rounded" | "premium";
export type BrandExpressionVoiceRegisterV1 = "direct" | "warm" | "premium" | "technical" | "plainspoken";

export type BusinessBrandExpressionV1 = {
  version: "brand-expression-v1";
  mood: BrandExpressionMoodV1;
  fontPosture: BrandExpressionFontPostureV1;
  voiceRegister: BrandExpressionVoiceRegisterV1;
  paletteSeed: {
    strategy: "logo_color" | "photo_color" | "category_default" | "neutral";
    preferredHex?: string;
    candidateRank?: number;
  };
  rationale: string;
};

export type BusinessUnderstandingV2 = {
  version: "business-understanding-v2";
  source: "openai" | "deterministic_fallback";
  provenance?: RegenerableArtifactProvenanceV1;
  vertical: Vertical;
  verticalConfidence: number;
  detectedSubverticals: string[];
  cleanedServices: CleanedServiceV2[];
  hours?: Array<{ label: string; value: string }>;
  primaryConversionGoal: BusinessUnderstandingConversionGoal;
  urgentServiceSignals: string[];
  /** What makes this business memorable: founders, family, history, mascots. */
  businessStory?: { summary: string; distinctives: string[] };
  brandExpression?: BusinessBrandExpressionV1;
  /** Exact source-block proposals; deterministic verification decides what is renderable. */
  evidenceProposals: import("./evidence-ledger").EvidenceProposal[];
  factConfidence: BusinessUnderstandingFactConfidenceV2[];
  notes: string[];
};

export type ExtensionModel = {
  forms: FormDefinition[];
  workflows: WorkflowDefinition[];
  inboundSettings?: InboundSettings;
  customBlocks: CustomBlockDefinition[];
};

export type InboundSettings = {
  captureMode: "form_only" | "form_and_chat";
  aiHandlingMode: "off" | "classify_only";
  notificationMode: "all_inquiries" | "real_leads_only" | "urgent_only" | "digest";
};

export type FormDefinition = {
  id: string;
  siteId: string;
  name: string;
  fields: Array<{
    id: string;
    label: string;
    type: "text" | "email" | "phone" | "textarea" | "select";
    required: boolean;
    options?: string[];
  }>;
  submitLabel: string;
};

export type WorkflowDefinition = {
  id: string;
  trigger: "inquiry_created";
  destination: "email" | "crm_placeholder" | "webhook";
  config: Record<string, unknown>;
};

export type InquirySourceChannel = "form" | "chat" | "email" | "phone" | "sms" | "booking";
export type InquiryStatus = "new" | "needs_reply" | "replied" | "booked" | "won" | "lost" | "spam" | "archived";
export type InquiryNotificationState = "queued" | "processing" | "completed" | "partial" | "failed" | "skipped";
export type InquiryAiEnrichmentState = "queued" | "processing" | "succeeded" | "retrying" | "rate_limited" | "failed" | "skipped";
export type InquiryEventType =
  | "form_submission"
  | "chat_message"
  | "email_received"
  | "email_sent"
  | "owner_note"
  | "ai_note"
  | "booking_created";
export type InquiryActor = "visitor" | "owner" | "ai" | "system";

export type InquiryAiEnrichment = {
  schemaVersion: string;
  promptVersion: string;
  provider: "groq";
  model: string;
  intent: string;
  urgency: string;
  spamLikelihood: "low" | "medium" | "high" | "unknown";
  serviceInterest?: string | null;
  contactPreference?: "email" | "phone" | "unknown" | null;
  summary: string;
  missingInfo: string[];
  suggestedNextAction: string;
  recommendedStatus: Extract<InquiryStatus, "needs_reply" | "spam" | "archived">;
  confidence: number;
  safetyFlags: string[];
  createdAt: string;
};

export type Inquiry = {
  id: string;
  siteId: string;
  sourceChannel: InquirySourceChannel;
  contactName?: string;
  contactEmail?: string;
  contactEmailNormalized?: string;
  contactPhone?: string;
  contactPhoneNormalized?: string;
  status: InquiryStatus;
  notificationState: InquiryNotificationState;
  aiEnrichmentState: InquiryAiEnrichmentState;
  aiEnrichment?: InquiryAiEnrichment;
  aiEnrichedAt?: string;
  aiEnrichmentError?: string;
  createdAt: string;
  updatedAt: string;
};

export type InquiryEvent = {
  id: string;
  siteId: string;
  inquiryId: string;
  type: InquiryEventType;
  actor: InquiryActor;
  messageText?: string;
  payload?: Record<string, unknown>;
  sourceUrl?: string;
  pageId?: string;
  formId?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
  createdAt: string;
};

export type InquiryDelivery = {
  id: string;
  siteId: string;
  inquiryId: string;
  eventId?: string;
  workflowId: string;
  destination: WorkflowDefinition["destination"];
  target?: string;
  status: "sent" | "skipped" | "failed";
  message: string;
  responseStatus?: number;
  error?: string;
  providerMessageId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type CustomBlockDefinition = {
  name: string;
  propsSchema: Record<string, unknown>;
  editableFields: string[];
  dataRequirements: string[];
  permissions: string[];
  author: "platform";
};

export type Experiment = {
  id: string;
  cohort: string;
  hypothesis: string;
  surface: "sticky_cta" | "cta_placement" | "form_length" | "hero_layout";
  variants: Array<Record<string, unknown>>;
  holdoutPercent?: number;
  primaryMetric: "tel_clicks" | "form_submits" | "booking_clicks" | "order_clicks";
  status: "draft" | "running" | "concluded" | "rolled_back";
  startedAt?: string;
  concludedAt?: string;
  rolledBackAt?: string;
  updatedAt?: string;
};

export type ExperimentVariantOutcome = {
  variantId: string;
  label: string;
  sessions: number;
  assignments: number;
  metricActions: number;
  allPrimaryActions: number;
  actionRate: number;
  liftVsControl: number;
  avgEngagedSeconds: number;
};

export type ExperimentAnalysis = {
  experimentId: string;
  hypothesis: string;
  status: "collecting" | "no_signal" | "leader_detected";
  primaryMetric: Experiment["primaryMetric"];
  totalAssignments: number;
  controlVariantId: string;
  leaderVariantId?: string;
  leaderLabel?: string;
  confidence: "insufficient_data" | "directional" | "strong";
  variants: ExperimentVariantOutcome[];
};

export type ExperimentLearning = {
  id: string;
  siteId: string;
  experimentId: string;
  cohort: string;
  surface: Experiment["surface"];
  primaryMetric: Experiment["primaryMetric"];
  winnerVariantId: string;
  winnerLabel: string;
  controlVariantId: string;
  confidence: ExperimentAnalysis["confidence"];
  observedLift: number;
  winnerActionRate: number;
  controlActionRate: number;
  totalAssignments: number;
  metricActions: number;
  standardCriterionId: string;
  generationRule: string;
  status: "active" | "rolled_back";
  createdAt: string;
  rolledBackAt?: string;
};

export type AnalyticsEvent = {
  siteId: string;
  sessionId: string;
  visitorId?: string;
  pageId?: string;
  eventType:
    | "pageview"
    | "click"
    | "section_view"
    | "form_start"
    | "form_submit"
    | "tel_click"
    | "outbound_click"
    | "engagement"
    | "scroll_depth"
    | "web_vital"
    | "experiment_assignment"
    | "agent_readable_request"
    | "places_ui";
  timestamp: string;
  sectionId?: string;
  elementRole?: string;
  elementType?: string;
  hrefType?: "internal" | "tel" | "mailto" | "booking" | "ordering" | "external";
  normalizedX?: number;
  normalizedY?: number;
  viewport?: {
    width: number;
    height: number;
  };
  deviceType?: "mobile" | "tablet" | "desktop";
  value?: number;
  metadata?: Record<string, string | number | boolean>;
};

export type AnalyticsSummary = {
  siteId: string;
  events: number;
  sessions: number;
  pageviews: number;
  clicks: number;
  telClicks: number;
  formStarts: number;
  formSubmits: number;
  outboundClicks: number;
  primaryActions: number;
  actionRate: number;
  engagedMs: number;
  avgEngagedSeconds: number;
  avgTimeToActionMs?: number;
  medianTimeToActionMs?: number;
  avgScrollDepth: number;
  webVitals: Array<{
    metric?: string | number | boolean;
    value?: number;
    timestamp: string;
  }>;
  agentReadableRequests: number;
  agentReadableByResource: AnalyticsAgentReadableResource[];
  placesUi: {
    loads: number;
    failures: number;
    fallbacks: number;
    fallbackRate: number;
    estimatedCostUsd: number;
  };
  outcomesByPage: AnalyticsOutcomeRow[];
  outcomesByCtaRole: AnalyticsOutcomeRow[];
  outcomesBySection: AnalyticsOutcomeRow[];
  funnelDropoffs: AnalyticsFunnelDropoff[];
  sectionConversionPaths: AnalyticsSectionConversionPath[];
  outcomesByExperimentVariant: AnalyticsOutcomeRow[];
  outcomesBySource: AnalyticsOutcomeRow[];
  clickMap: AnalyticsClickMapPoint[];
  standardCorrelations: AnalyticsStandardCorrelation[];
  baselineComparison: AnalyticsBaselineComparison;
};

export type AnalyticsAgentReadableResource = {
  key: string;
  label: string;
  requests: number;
  sessions: number;
  latestAt?: string;
};

export type AnalyticsFunnelDropoff = {
  key: string;
  from: string;
  to: string;
  fromCount: number;
  toCount: number;
  dropoffCount: number;
  conversionRate: number;
  dropoffRate: number;
};

export type AnalyticsSectionConversionPath = {
  key: string;
  sectionId: string;
  exposedSessions: number;
  exposures: number;
  actionSessions: number;
  primaryActions: number;
  telClicks: number;
  formSubmits: number;
  outboundClicks: number;
  actionRate: number;
  avgTimeToActionMs?: number;
  medianTimeToActionMs?: number;
};

export type AnalyticsClickMapPoint = {
  key: string;
  label: string;
  count: number;
  primaryActions: number;
  pageId?: string;
  sectionId?: string;
  elementRole?: string;
  hrefType?: AnalyticsEvent["hrefType"];
  deviceType?: AnalyticsEvent["deviceType"];
  normalizedX: number;
  normalizedY: number;
};

export type AnalyticsStandardCorrelation = {
  criterionId: string;
  title: string;
  layer: StandardCriterion["layer"];
  metric: string;
  events: number;
  primaryActions: number;
  rate: number;
  signal: "collecting" | "positive" | "watch" | "weak";
  insight: string;
};

export type AnalyticsOutcomeRow = {
  key: string;
  label: string;
  sessions: number;
  events: number;
  pageviews: number;
  telClicks: number;
  formStarts: number;
  formSubmits: number;
  outboundClicks: number;
  primaryActions: number;
  actionRate: number;
  engagedMs: number;
  avgEngagedSeconds: number;
  avgTimeToActionMs?: number;
  medianTimeToActionMs?: number;
  avgScrollDepth: number;
};

export type AnalyticsBaselineComparison = {
  status: "collecting" | "ready";
  baselineStart?: string;
  baselineEnd?: string;
  currentStart?: string;
  currentEnd?: string;
  baseline: AnalyticsOutcomeTotals;
  current: AnalyticsOutcomeTotals;
  delta: {
    sessions: number;
    primaryActions: number;
    actionRate: number;
  };
};

export type AnalyticsOutcomeTotals = {
  sessions: number;
  pageviews: number;
  telClicks: number;
  formStarts: number;
  formSubmits: number;
  outboundClicks: number;
  primaryActions: number;
  actionRate: number;
  engagedMs: number;
  avgEngagedSeconds: number;
  avgTimeToActionMs?: number;
  medianTimeToActionMs?: number;
  avgScrollDepth: number;
};

export type PreviewToken = {
  token: string;
  siteId: string;
  versionId?: string;
  expiresAt?: string;
  createdAt: string;
};

export type ClaimRecord = {
  id: string;
  siteId: string;
  status: "preview" | "checkout_required" | "claimed";
  ownerUserId?: string;
  ownerEmail?: string;
  verificationLevel?: ClaimVerificationLevel;
  verificationMethod?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  outboundCampaignId?: string;
  outboundProspectId?: string;
  verifiedFacts: string[];
  acceptedTermsAt?: string;
  acceptedManagementAt?: string;
  assetRightsAcceptedAt?: string;
  attestedAssetIds?: string[];
  claimedAt?: string;
  createdAt: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeCheckoutSessionId?: string;
};

export type DomainRecord = {
  id: string;
  siteId: string;
  hostname: string;
  kind: "preview" | "platform_slug" | "custom";
  status: "pending" | "active" | "failed";
  provider: "railway" | "cloudflare_for_saas";
  createdAt: string;
  providerHostnameId?: string;
  verification?: {
    type: "cname" | "txt" | "http";
    value: string;
    note: string;
    configured: boolean;
    providerHostnameId?: string;
  };
};

export type OutboundCampaign = {
  id: string;
  name: string;
  channel: "direct_mail" | "email" | "phone" | "manual";
  status: "draft" | "running" | "paused" | "completed";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type OutboundProspect = {
  id: string;
  campaignId: string;
  siteId?: string;
  businessName: string;
  vertical?: Vertical;
  sourceUrl?: string;
  previewToken?: string;
  mailingCode?: string;
  status: "queued" | "mailed" | "preview_viewed" | "claim_started" | "claimed" | "published" | "disqualified";
  createdAt: string;
  mailedAt?: string;
  firstPreviewViewedAt?: string;
  claimStartedAt?: string;
  claimedAt?: string;
  publishedAt?: string;
  disqualifiedAt?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type OutboundEvent = {
  id: string;
  campaignId: string;
  prospectId?: string;
  siteId?: string;
  type:
    | "mailer_sent"
    | "claim_link_opened"
    | "preview_viewed"
    | "picker_interaction"
    | "claim_started"
    | "checkout_started"
    | "claim_completed"
    | "paid"
    | "published"
    | "support_contact"
    | "disqualified"
    | "credibility_feedback";
  occurredAt: string;
  value?: number;
  metadata?: Record<string, string | number | boolean>;
};

export type OutboundSummary = {
  campaignId?: string;
  campaigns: number;
  prospects: number;
  mailed: number;
  claimLinkOpened: number;
  previewViewed: number;
  pickerInteractions: number;
  claimsStarted: number;
  checkoutStarted: number;
  claimed: number;
  paid: number;
  published: number;
  disqualified: number;
  supportContacts: number;
  credibilityFeedbackCount: number;
  avgCredibilityScore?: number;
  mailerToPreviewRate: number;
  mailerToClaimRate: number;
  claimLinkToCheckoutRate: number;
  checkoutToPaidRate: number;
  claimLinkToPaidRate: number;
  claimToPublishRate: number;
  supportBurdenRate: number;
  verticalBreakdown: Array<{
    vertical: Vertical | "unknown";
    prospects: number;
    claimLinkOpened: number;
    checkoutStarted: number;
    claimed: number;
    paid: number;
    published: number;
    claimLinkToCheckoutRate: number;
    checkoutToPaidRate: number;
    mailerToClaimRate: number;
  }>;
};

export type ProspectReportStatus = "queued" | "running" | "completed" | "failed";

export type ProspectWebsiteKind = "owned_website" | "no_website" | "social_or_aggregator";

export type ProspectReportBucketId =
  | "search_visibility"
  | "website_conversion"
  | "local_content_coverage"
  | "trust_mobile_readiness";

export type ProspectReportSignal = {
  id: string;
  label: string;
  passed: boolean;
  points: number;
  maxPoints: number;
  source: "crawl" | "render";
  evidence: string;
};

export type ProspectReportBucket = {
  id: ProspectReportBucketId;
  label: string;
  score?: number;
  scoredSignals: number;
  maxPoints: number;
  points: number;
  status: "scored" | "not_enough_signal";
  signals: ProspectReportSignal[];
};

export type ProspectReportFinding = {
  id: string;
  bucketId: ProspectReportBucketId;
  bucketLabel: string;
  severity: "fail" | "warning";
  title: string;
  consequence: string;
  evidence: string;
  lodestaFix: string;
};

export type ProspectReportStage = {
  id: string;
  label: string;
  status: "queued" | "running" | "completed" | "skipped" | "failed";
};

export type ProspectReportGatedPlan = {
  summary: string;
  priorities: Array<{
    title: string;
    detail: string;
  }>;
};

export type ProspectPresenceReportResult = {
  version: "prospect-presence-report-v1";
  generatedAt: string;
  websiteKind: ProspectWebsiteKind;
  sourceUrl?: string;
  sourceHost?: string;
  overallScore: number;
  overallLabel: string;
  scoreSource: "crawl_standard" | "no_owned_website";
  buckets: ProspectReportBucket[];
  findings: ProspectReportFinding[];
  stages: ProspectReportStage[];
  gatedPlan: ProspectReportGatedPlan;
};

export type ProspectReportRecord = {
  id: string;
  placeId: string;
  status: ProspectReportStatus;
  jobId?: string;
  sourceUrl?: string;
  sourceHost?: string;
  websiteKind: ProspectWebsiteKind;
  result?: ProspectPresenceReportResult;
  unlockedAt?: string;
  leadId?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type ProspectReportLead = {
  id: string;
  reportId: string;
  email: string;
  contactName?: string;
  phone?: string;
  ipHash?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
};

export type StandardCriterion = {
  id: string;
  layer: "technical_seo" | "conversion" | "trust" | "content_structure";
  vertical: "universal" | Vertical;
  title: string;
  checkMethod: "crawl" | "dom" | "render" | "vision" | "analytics" | "manual";
  threshold: Record<string, unknown>;
  businessConsequence: string;
  generationRule: string;
  auditEligible: boolean;
  experimentEligible: boolean;
};

export type StandardCheckResult = {
  criterionId: string;
  title: string;
  layer: StandardCriterion["layer"];
  vertical: StandardCriterion["vertical"];
  checkMethod: StandardCriterion["checkMethod"];
  passed: boolean;
  severity: "pass" | "warning" | "fail";
  evidence: string;
  businessConsequence: string;
};

export type StandardEvaluation = {
  source: "crawl" | "site_model";
  siteId?: string;
  sourceUrl?: string;
  score: {
    overall: number;
    max: number;
    percent: number;
    grade: "excellent" | "good" | "needs_work" | "poor";
  };
  checks: StandardCheckResult[];
};

export type RenderViewportName = "desktop" | "tablet" | "mobile";

export type RenderScreenshotArtifact = {
  viewport: RenderViewportName;
  width: number;
  height: number;
  path?: string;
  bytes?: number;
  capturedAt: string;
};

export type RenderSectionScreenshotArtifact = RenderScreenshotArtifact & {
  sectionIndex: number;
  sectionId?: string;
  templateId?: string;
  label: string;
  sectionTop: number;
  sectionHeight: number;
  clipped?: boolean;
};

export type RenderInspectionFinding = {
  id: string;
  severity: "pass" | "warning" | "fail";
  title: string;
  evidence: string;
  viewport?: RenderViewportName;
  sectionId?: string;
  templateId?: string;
  slotRole?: string;
  slotKind?: string;
  copyPart?: string;
  itemIndex?: number;
  mediaIndex?: number;
  factIndex?: number;
  actionIndex?: number;
};

export type RenderInspectionTarget = "source_site" | "generated_site";

export type RenderElementRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type RenderSectionInspection = {
  viewport: RenderViewportName;
  sectionIndex: number;
  sectionId?: string;
  templateId?: string;
  label: string;
  rect: RenderElementRect;
  textChars: number;
  fillRatio: number;
  imageCount: number;
  brokenImageCount: number;
  minTextContrastRatio?: number;
  headingOverflowPx: number;
  blockOverlapMaxRatio: number;
  figureOverlapMaxRatio: number;
  crampedTextCount: number;
  findings: RenderInspectionFinding[];
  screenshotPath?: string;
  screenshotBytes?: number;
};

export type RenderViewportMetrics = {
  viewport: {
    name: RenderViewportName;
    width: number;
    height: number;
  };
  htmlBytes?: number;
  title?: string;
  bodyTextChars?: number;
  sectionCount?: number;
  ctaCount?: number;
  formCount?: number;
  telLinkCount?: number;
  imageCount?: number;
  loadedImageCount?: number;
  brokenImageCount?: number;
  aboveFoldCtaDetected?: boolean;
  primaryHeroCtaDetected?: boolean;
  primaryHeroCtaAboveFold?: boolean;
  primaryMediaImageLoaded?: boolean;
  siteHeaderDetected?: boolean;
  siteFooterDetected?: boolean;
  horizontalOverflowPx?: number;
  bodyFontSizePx?: number;
  minReadableTextFontSizePx?: number;
  minTextContrastRatio?: number;
  minTextContrastSample?: string;
  headerContrastRatio?: number;
  headerContrastSample?: string;
  headerVisualMode?: string;
  heroH1LineCount?: number;
  heroH1MaxLineWidthPx?: number;
  visualOverlapCount?: number;
  visualOverlapSamples?: string[];
  headingOverflowCount?: number;
  headingOverflowSamples?: string[];
  blockOverlapCount?: number;
  blockOverlapSamples?: string[];
  figureOverlapCount?: number;
  figureOverlapSamples?: string[];
  upscaledImageCount?: number;
  upscaledImageSamples?: string[];
  /** Images that escaped their layout slot (full-page-logo class); geometric. */
  oversizedImageCount?: number;
  oversizedImageSamples?: string[];
  /** Header brand-mark resolution check: "ok: ..." or "low-res: ...". */
  headerLogoSample?: string;
  a11yStructureIssues?: string[];
  sectionLowFillCount?: number;
  sectionLowFillSamples?: string[];
  crampedTextCount?: number;
  crampedTextSamples?: string[];
  heroMediaEdgeClipCount?: number;
  heroMediaEdgeClipSamples?: string[];
  sectionMediaOverflowCount?: number;
  sectionMediaOverflowSamples?: string[];
  formAffordanceIssueCount?: number;
  formAffordanceIssueSamples?: string[];
  contactFactWrapIssueCount?: number;
  contactFactWrapIssueSamples?: string[];
  consoleErrorCount?: number;
  consoleErrorSamples?: string[];
  headingFontFamily?: string;
  bodyFontFamily?: string;
  /** Computed colors sampled from the page (header/buttons/links) for brand derivation. */
  brandColorSamples?: string[];
  sectionInspections?: RenderSectionInspection[];
  rects?: {
    hero?: RenderElementRect;
    h1?: RenderElementRect;
    primaryHeroCta?: RenderElementRect;
    stickyCta?: RenderElementRect;
    primaryMedia?: RenderElementRect;
  };
};

export type RenderInspectionSummary = {
  target: RenderInspectionTarget;
  sourceUrl: string;
  finalUrl?: string;
  adapter: RenderInspectionResult["adapter"];
  capturedAt: string;
  unavailableReason?: string;
  findingCount: number;
  failingFindingCount: number;
  warningFindingCount: number;
  sectionInspectionCount?: number;
  sectionFailingFindingCount?: number;
  sectionWarningFindingCount?: number;
  sectionScreenshotCount?: number;
  metricsByViewport?: Partial<Record<RenderViewportName, RenderViewportMetrics>>;
};

export type RenderInspectionArtifactRef = {
  viewport: RenderViewportName;
  width: number;
  height: number;
  path?: string;
  bytes?: number;
  capturedAt: string;
};

export type RenderInspectionResult = {
  target: RenderInspectionTarget;
  siteId?: string;
  versionId?: string;
  siteModelHash?: string;
  qaRunId?: string;
  sourceUrl: string;
  finalUrl?: string;
  adapter: "playwright" | "fetch_fallback";
  capturedAt: string;
  screenshots: RenderScreenshotArtifact[];
  /**
   * Viewport-only thumbnail captures (e.g. desktop above-the-fold JPEG) kept
   * separate from `screenshots` so final visual-judgment inputs stay unchanged.
   */
  aboveFoldScreenshots?: RenderScreenshotArtifact[];
  sectionScreenshots?: RenderSectionScreenshotArtifact[];
  sectionInspections?: RenderSectionInspection[];
  findings: RenderInspectionFinding[];
  metrics: {
    htmlBytes?: number;
    bodyTextChars?: number;
    sectionCount?: number;
    ctaCount?: number;
    formCount?: number;
    telLinkCount?: number;
    imageCount?: number;
    loadedImageCount?: number;
    brokenImageCount?: number;
    aboveFoldCtaDetected?: boolean;
    primaryHeroCtaDetected?: boolean;
    primaryHeroCtaAboveFold?: boolean;
    primaryMediaImageLoaded?: boolean;
    siteHeaderDetected?: boolean;
    siteFooterDetected?: boolean;
    horizontalOverflowPx?: number;
    bodyFontSizePx?: number;
    minReadableTextFontSizePx?: number;
    minTextContrastRatio?: number;
    minTextContrastSample?: string;
    headerContrastRatio?: number;
    headerContrastSample?: string;
    headerVisualMode?: string;
    heroH1LineCount?: number;
    heroH1MaxLineWidthPx?: number;
    visualOverlapCount?: number;
    visualOverlapSamples?: string[];
    headingOverflowCount?: number;
    headingOverflowSamples?: string[];
    blockOverlapCount?: number;
    blockOverlapSamples?: string[];
    figureOverlapCount?: number;
    figureOverlapSamples?: string[];
    upscaledImageCount?: number;
    upscaledImageSamples?: string[];
    oversizedImageCount?: number;
    oversizedImageSamples?: string[];
    headerLogoSample?: string;
    sectionLowFillCount?: number;
    sectionLowFillSamples?: string[];
    crampedTextCount?: number;
    crampedTextSamples?: string[];
    heroMediaEdgeClipCount?: number;
    heroMediaEdgeClipSamples?: string[];
    sectionMediaOverflowCount?: number;
    sectionMediaOverflowSamples?: string[];
    formAffordanceIssueCount?: number;
    formAffordanceIssueSamples?: string[];
    contactFactWrapIssueCount?: number;
    contactFactWrapIssueSamples?: string[];
    consoleErrorCount?: number;
    consoleErrorSamples?: string[];
    headingFontFamily?: string;
    bodyFontFamily?: string;
    brandColorSamples?: string[];
  };
  metricsByViewport?: Partial<Record<RenderViewportName, RenderViewportMetrics>>;
  unavailableReason?: string;
};

export type PresenceAssessment = {
  siteId: string;
  sourceUrl?: string;
  businessFactGraph?: BusinessFactGraph;
  /** Canonical fail-closed evidence used by generation and owner confirmation. */
  evidenceLedger?: import("./evidence-ledger").EvidenceLedger;
  generationPlan?: import("./generation-contracts").GenerationPlan;
  siteCopy?: import("./generation-contracts").SiteCopy;
  generationTrace?: import("./generation-pipeline").GenerationPipelineTrace;
  generationJudge?: import("./generation-judge").GenerationJudgeResult;
  normalizedBusinessFacts?: NormalizedBusinessFacts;
  standardEvaluation?: StandardEvaluation;
  renderInspection?: RenderInspectionResult;
  assetInventory?: SiteAsset[];
  publicPresenceSignals?: PublicPresenceSignal[];
  brandAssessment?: BrandAssessment;
  businessUnderstanding?: BusinessUnderstandingV2;
  /** Privately stored scraped media (reference_only until owner attestation). */
  scrapedMediaManifest?: Array<{
    assetId: string;
    kind: "photo" | "logo";
    originalUrl: string;
    storedUrl: string;
    contentHash: string;
    bytes: number;
    scrapedAt: string;
    width?: number;
    height?: number;
  }>;
  technicalNotes: string[];
  visualNotes: string[];
  brandNotes: string[];
  publicPresenceNotes: string[];
};

export type SiteArtifactScope =
  | "candidate_selected"
  | "site_selected"
  | "qa_evidence";

export type SiteArtifactType =
  | "evidence_ledger"
  | "generation_plan"
  | "site_copy"
  | "generation_review"
  | "generation_failure"
  | "operator_decision";

export type SiteArtifactRecord = {
  id: string;
  siteCandidateId?: string;
  siteId?: string;
  scope: SiteArtifactScope;
  artifactType: SiteArtifactType;
  artifactVersion: string;
  provenance: RegenerableArtifactProvenanceV1;
  contentHash: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type NormalizedBusinessFactSource = "crawl" | "schema" | "prompt" | "public_presence" | "system_default";

export type RenderableFact = {
  field: string;
  value: string | string[];
  source: NormalizedBusinessFactSource;
  confidence?: "high" | "medium" | "low";
};

export type BlockedClaim = {
  text: string;
  sourceField?: string;
  reason: string;
};

export type NormalizedBusinessFacts = {
  name: RenderableFact;
  vertical: RenderableFact;
  categories: RenderableFact[];
  description?: RenderableFact;
  phone?: RenderableFact;
  email?: RenderableFact;
  address?: RenderableFact;
  hours?: RenderableFact;
  services: RenderableFact[];
  serviceAreas: RenderableFact[];
  proofSignals: RenderableFact[];
  uncertainFacts: RenderableFact[];
  blockedPlaceholders: BlockedClaim[];
};

export type BrandAssessment = {
  id: string;
  siteId: string;
  confidence: number;
  cues: string[];
  colorSignals: string[];
  typographySignals: string[];
  imageStyleSignals: string[];
  toneSignals: string[];
  preservationRules: string[];
  sourceNotes: string[];
};

export type SiteBundle = {
  businessProfile: BusinessProfile;
  business?: BusinessRecord;
  locations?: BusinessLocationRecord[];
  locationBindings?: SiteLocationBinding[];
  renderProfile?: BusinessProfile;
  siteModel: SiteModel;
  extensionModel: ExtensionModel;
  experiments: Experiment[];
  experimentLearnings?: ExperimentLearning[];
  presenceAssessment: PresenceAssessment;
};

export type SiteLocationBinding = {
  locationId: string;
  role: "primary" | "covered";
  orderIndex: number;
};

export type BusinessRecord = {
  id: string;
  workspaceId?: string;
  name: string;
  vertical: Vertical;
  profile: BusinessProfile;
  provenance: Record<string, FieldProvenance>;
  createdAt: string;
  updatedAt: string;
};

export type BusinessLocationRecord = {
  id: string;
  businessId: string;
  label?: string;
  address?: BusinessProfile["address"];
  serviceAreas: string[];
  phone?: string;
  email?: string;
  hours?: BusinessProfile["hours"];
  geo?: BusinessProfile["geo"];
  googlePlaceId?: string;
  provenance: Record<string, FieldProvenance>;
  createdAt: string;
  updatedAt: string;
};

export type SiteCandidateStatus = "ready" | "blocked" | "accepted" | "archived";
export type SiteCandidatePurpose = "customer_prospect" | "test_generation";

export type SiteCandidateRecord = {
  id: string;
  businessId: string;
  agentRunId?: string;
  sourceUrl?: string;
  sourceHost?: string;
  businessName: string;
  vertical: Vertical;
  candidateSlug: string;
  bundle: SiteBundle;
  status: SiteCandidateStatus;
  candidatePurpose: SiteCandidatePurpose;
  intendedSiteId?: string;
  acceptedSiteId?: string;
  acceptedVersionId?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type AgentRunSource = "admin_console" | "api" | "job";

export type AgentRunRecord = {
  id: string;
  runType: string;
  agentType: string;
  status: AgentRunStatus;
  actorType?: string;
  actorId?: string;
  source: AgentRunSource;
  sourceUrl?: string;
  sourceHost?: string;
  targetType?: string;
  targetId?: string;
  inputSummary?: string;
  outputSummary?: string;
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags: string[];
  notes?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  tokenTotals?: AgentRunTokenTotals;
  modelCallCount?: number;
  latestError?: string;
  targetName?: string;
  targetSlug?: string;
};

export type AgentRunSpanRecord = {
  id: string;
  runId: string;
  parentSpanId?: string;
  spanType: string;
  name: string;
  status: AgentRunStatus;
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  artifactRefs?: Record<string, unknown>;
  errorMessage?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
};

export type AgentModelCallRecord = {
  id: string;
  runId: string;
  spanId?: string;
  provider: string;
  model: string;
  endpoint: string;
  operation: string;
  status: AgentRunStatus;
  requestJson?: Record<string, unknown>;
  responseJson?: Record<string, unknown>;
  usageJson?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  errorMessage?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
};

export type AgentRunTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};

export type AgentRunDetail = {
  run: AgentRunRecord;
  spans: AgentRunSpanRecord[];
  modelCalls: AgentModelCallRecord[];
  tokenTotals: AgentRunTokenTotals;
};

export type JobKind =
  | "presence_assessment"
  | "prospect_presence_report"
  | "generate_site"
  | "agent_telemetry_cleanup"
  | "import_batch"
  | "inquiry_notification"
  | "inquiry_ai_enrichment";

export type JobRecord = {
  id: string;
  kind: JobKind;
  status: "queued" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedBy?: string;
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type RepositoryMode = "local" | "supabase";

export type WorkerHeartbeatRecord = {
  workerId: string;
  pid: number;
  host: string;
  repositoryMode: RepositoryMode;
  startedAt: string;
  lastSeenAt: string;
  currentJobId?: string;
  currentJobKind?: JobKind;
};

export type WorkerQueueStatus = {
  now: string;
  repositoryMode: RepositoryMode;
  staleAfterSeconds: number;
  activeWorkerCount: number;
  activeWorkers: WorkerHeartbeatRecord[];
  staleWorkers: WorkerHeartbeatRecord[];
  queueDepthByKindStatus: Record<string, Partial<Record<JobRecord["status"], number>>>;
  oldestQueuedAgeSeconds?: number;
  runningJobs: Array<{
    id: string;
    kind: JobKind;
    lockedBy?: string;
    lockedAt?: string;
    currentSpan?: string;
    elapsedSeconds?: number;
  }>;
};
