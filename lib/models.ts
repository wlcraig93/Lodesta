export type Vertical =
  | "restaurant"
  | "auto_body"
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

export type ConversionGoal =
  | "calls"
  | "forms"
  | "booking_clicks"
  | "order_clicks"
  | "directions"
  | "store_visits";

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

export type AssetReference = {
  id: string;
  url: string;
  alt: string;
  source: "generated" | "licensed" | "uploaded" | "website_reference" | "placeholder";
  rightsStatus: "preclaim_safe" | "customer_granted" | "reference_only" | "unknown";
};

export type AssetKind = "photo" | "logo" | "mockup" | "screenshot" | "icon" | "document" | "other";

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
  serviceAreas: string[];
  socialLinks: string[];
  bookingLinks: string[];
  orderingLinks: string[];
  photos: AssetReference[];
  logo?: AssetReference;
  reviewsSummary?: {
    rating?: number;
    count?: number;
    sources: string[];
  };
  pressLinks: string[];
  provenance: Record<string, FieldProvenance>;
};

export type FieldPolicy = {
  editScope: "system_only" | "owner_choice" | "owner_freetext" | "pinned";
  experimentEligible: boolean;
  factField: boolean;
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

export type SectionType =
  | "hero"
  | "trust_bar"
  | "services"
  | "gallery"
  | "testimonials"
  | "faq"
  | "cta"
  | "contact"
  | "map"
  | "menu_deals"
  | "team"
  | "press_video"
  | "before_after";

export type SectionModel = {
  id: string;
  type: SectionType;
  variant: string;
  props: Record<string, unknown>;
  bindings: Record<string, string>;
  responsiveOverrides?: Record<string, unknown>;
  fieldPolicies: Record<string, FieldPolicy>;
};

export type PageModel = {
  id: string;
  slug: string;
  title: string;
  seo: SeoMetadata;
  sections: SectionModel[];
};

export type SiteVersion = {
  id: string;
  status: "draft" | "published";
  pages: PageModel[];
  createdAt: string;
  theme?: Theme;
};

export type SiteModel = {
  id: string;
  slug: string;
  theme: Theme;
  versions: SiteVersion[];
  pinList: string[];
};

export type ExtensionModel = {
  forms: FormDefinition[];
  workflows: WorkflowDefinition[];
  customBlocks: CustomBlockDefinition[];
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
  trigger: "form_submission" | "lead_created";
  destination: "email" | "crm_placeholder" | "webhook";
  config: Record<string, unknown>;
};

export type WorkflowDelivery = {
  id: string;
  siteId: string;
  workflowId: string;
  submissionId?: string;
  destination: WorkflowDefinition["destination"];
  target?: string;
  status: "sent" | "skipped" | "failed";
  message: string;
  responseStatus?: number;
  error?: string;
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

export type OptimizationFinding = {
  id: string;
  siteId: string;
  standardCriterionId?: string;
  category:
    | "seo"
    | "conversion"
    | "accessibility"
    | "content"
    | "performance"
    | "trust"
    | "technical";
  severity: "critical" | "recommended" | "nice_to_have";
  title: string;
  rationale: string;
  recommendedAction: string;
  status: "open" | "dismissed" | "applied";
  applyMode: "auto_fix" | "one_click" | "manual_service";
  suggestedEditPayload?: Record<string, unknown>;
  expectedOutcomeMetric?: ConversionGoal | "engaged_sessions";
};

export type QACheck = {
  id: string;
  siteId: string;
  standardCriterionId?: string;
  category: "seo" | "conversion" | "accessibility" | "forms" | "technical" | "trust" | "content";
  severity: "pass" | "warning" | "fail";
  title: string;
  detail: string;
  pageId?: string;
  sectionId?: string;
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
    | "agent_readable_request";
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

export type LeadSubmission = {
  id: string;
  siteId: string;
  formId: string;
  pageId?: string;
  visitorId?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, string | number | boolean>;
  submittedAt: string;
  sourceUrl?: string;
  userAgent?: string;
  ipHash?: string;
  status: "new" | "reviewed" | "spam";
};

export type PreviewToken = {
  token: string;
  siteId: string;
  expiresAt?: string;
  createdAt: string;
};

export type ClaimRecord = {
  id: string;
  siteId: string;
  status: "preview" | "checkout_required" | "claimed";
  ownerUserId?: string;
  ownerEmail?: string;
  verifiedFacts: string[];
  acceptedTermsAt?: string;
  acceptedManagementAt?: string;
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
    | "preview_viewed"
    | "claim_started"
    | "claim_completed"
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
  previewViewed: number;
  claimsStarted: number;
  claimed: number;
  published: number;
  disqualified: number;
  supportContacts: number;
  credibilityFeedbackCount: number;
  avgCredibilityScore?: number;
  mailerToPreviewRate: number;
  mailerToClaimRate: number;
  claimToPublishRate: number;
  supportBurdenRate: number;
  verticalBreakdown: Array<{
    vertical: Vertical | "unknown";
    prospects: number;
    claimed: number;
    published: number;
    mailerToClaimRate: number;
  }>;
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

export type RenderViewportName = "desktop" | "mobile";

export type RenderScreenshotArtifact = {
  viewport: RenderViewportName;
  width: number;
  height: number;
  path?: string;
  bytes?: number;
  capturedAt: string;
};

export type RenderInspectionFinding = {
  id: string;
  severity: "pass" | "warning" | "fail";
  title: string;
  evidence: string;
  viewport?: RenderViewportName;
};

export type RenderInspectionResult = {
  sourceUrl: string;
  finalUrl?: string;
  adapter: "playwright" | "fetch_fallback";
  capturedAt: string;
  screenshots: RenderScreenshotArtifact[];
  findings: RenderInspectionFinding[];
  metrics: {
    htmlBytes?: number;
    bodyTextChars?: number;
    sectionCount?: number;
    ctaCount?: number;
    formCount?: number;
    telLinkCount?: number;
    aboveFoldCtaDetected?: boolean;
  };
  unavailableReason?: string;
};

export type VisualQaFinding = {
  id: string;
  category: "hierarchy" | "responsive" | "conversion" | "brand" | "trust" | "accessibility" | "content";
  severity: "pass" | "warning" | "fail";
  title: string;
  evidence: string;
  recommendation?: string;
  viewport?: RenderViewportName;
};

export type VisualQaResult = {
  siteId: string;
  source: "openai" | "deterministic_fallback";
  model?: string;
  target: "source_site" | "generated_site_model";
  evaluatedAt: string;
  screenshotCount: number;
  selectedDesignDirectionId?: string;
  summary: string;
  findings: VisualQaFinding[];
  limitations: string[];
};

export type PresenceAssessment = {
  siteId: string;
  sourceUrl?: string;
  standardEvaluation?: StandardEvaluation;
  renderInspection?: RenderInspectionResult;
  visualQa?: VisualQaResult;
  assetInventory?: SiteAsset[];
  publicPresenceSignals?: PublicPresenceSignal[];
  brandAssessment?: BrandAssessment;
  qualityScore?: PresenceQualityScore;
  designDirections?: DesignDirection[];
  selectedDesignDirectionId?: string;
  mockupArtifacts?: CreativeMockupArtifact[];
  generationPlanningSource?: "openai" | "deterministic_fallback";
  technicalNotes: string[];
  visualNotes: string[];
  brandNotes: string[];
  publicPresenceNotes: string[];
  creativeBrief?: CreativeBrief;
};

export type CreativeBrief = {
  designIntent: string;
  mockupPrompt: string;
  visualInspectionChecklist: string[];
  assetStrategy: string[];
  brandCuesToPreserve: string[];
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

export type DesignDirection = {
  id: string;
  siteId: string;
  strategy: "modernized_brand" | "conversion_optimized" | "premium_redesign";
  label: string;
  rationale: string;
  themePreset: "warm" | "premium" | "bold" | "clinical";
  sectionEmphasis: SectionType[];
  mockupPrompt: string;
  generationRules: string[];
  riskNotes: string[];
  selected: boolean;
};

export type CreativeMockupArtifact = {
  id: string;
  siteId: string;
  designDirectionId: string;
  strategy: DesignDirection["strategy"];
  status: "prompt_only" | "generated" | "failed";
  provider: "openai" | "deterministic_fallback";
  model?: string;
  prompt: string;
  revisedPrompt?: string;
  image?: AssetReference;
  assetId?: string;
  storageProvider?: "local" | "supabase";
  storagePath?: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  outputFormat?: "png" | "jpeg" | "webp";
  planningOnly: true;
  generatedAt: string;
  notes: string[];
};

export type PresenceQualityScore = {
  siteId: string;
  current?: StandardEvaluation["score"];
  generated?: StandardEvaluation["score"];
  measuredCriteria: number;
  generatedCriteria: number;
  coldUrlCheckableFailures: string[];
  summary: string;
};

export type SiteBundle = {
  businessProfile: BusinessProfile;
  siteModel: SiteModel;
  extensionModel: ExtensionModel;
  optimizationFindings: OptimizationFinding[];
  experiments: Experiment[];
  experimentLearnings?: ExperimentLearning[];
  presenceAssessment: PresenceAssessment;
};

export type JobKind =
  | "presence_assessment"
  | "audit_site"
  | "generate_site"
  | "monthly_action_list"
  | "import_batch";

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
