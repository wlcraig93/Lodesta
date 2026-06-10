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
  | "service_area"
  | "photo"
  | "logo"
  | "review_summary"
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

export type SourceAwareFactPolicy = "durable_render" | "live_only" | "internal_only" | "blocked";

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

export type RendererVersion = "layout-v1" | "layout-v2" | "layout-v3";

export type DesignSchemaVersion = "design-v1" | "design-v2" | "design-v3";

export type GeneratedSiteV3Mode = "off" | "fixture_only" | "operator_allowlist" | "all_new_generations";

export type SiteStylePack = "local_modern" | "premium_editorial" | "urgent_service" | "warm_neighborhood" | "clinical_trust";

export type TypographyPack =
  | "clean_sans"
  | "editorial_serif"
  | "rounded_friendly"
  | "utility_sans"
  | "premium_sans";

export type ButtonStyle = "solid" | "outline_heavy" | "pill" | "understated";

export type RadiusStyle = "sharp" | "soft" | "rounded";

export type ImageTreatment = "natural" | "full_bleed" | "framed" | "soft_crop" | "collage";

export type MotionPolicy = "none" | "subtle";

export type DesignPlan = {
  stylePack: SiteStylePack;
  typographyPack: TypographyPack;
  colorSystem: "warm" | "premium" | "bold" | "clinical";
  spacingDensity: "compact" | "standard" | "spacious";
  buttonStyle: ButtonStyle;
  radiusStyle: RadiusStyle;
  imageTreatment: ImageTreatment;
  motionPolicy: MotionPolicy;
  hostedFontAssetId?: string;
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

export type LayoutSectionKind =
  | "hero"
  | "trust"
  | "services"
  | "gallery"
  | "proof"
  | "faq"
  | "cta"
  | "contact"
  | "map"
  | "menu"
  | "team"
  | "press"
  | "before_after"
  | "footer";

export type LayoutSectionPreset =
  | "hero.full_bleed_media"
  | "hero.split_media"
  | "hero.centered_editorial"
  | "hero.collage"
  | "hero.service_first"
  | "hero.proof_first"
  | "services.card_grid"
  | "services.compact_list"
  | "services.media_feature"
  | "gallery.masonry"
  | "gallery.proof_grid"
  | "proof.review_band"
  | "proof.before_after_grid"
  | "contact.form_split"
  | "contact.contact_card"
  | "cta.overlay_media"
  | "cta.simple_band"
  | "faq.conversion_list"
  | "map.service_area"
  | "team.profile_grid"
  | "press.link_strip"
  | "footer.standard";

export type LayoutComponentType =
  | "header"
  | "hero_copy"
  | "text"
  | "image"
  | "image_collage"
  | "services"
  | "gallery"
  | "proof"
  | "cta"
  | "form"
  | "contact_facts"
  | "map_area"
  | "faq"
  | "team"
  | "before_after"
  | "footer";

export type LayoutComponentInstance = {
  id: string;
  type: LayoutComponentType;
  props: Record<string, unknown>;
  bindings?: Record<string, string>;
  fieldPolicies?: Record<string, FieldPolicy>;
};

export type LayoutSection = {
  id: string;
  kind: LayoutSectionKind;
  preset: LayoutSectionPreset;
  slots: Record<string, LayoutComponentInstance[]>;
  background: "default" | "surface" | "primary" | "accent" | "image" | "split";
  width: "contained" | "wide" | "full_bleed";
  spacing: "compact" | "standard" | "spacious";
  mobileBehavior: "stack" | "media_first" | "content_first" | "hide_media";
  visibility: "all" | "desktop_only" | "mobile_only";
  designOverrides?: Partial<Pick<DesignPlan, "buttonStyle" | "imageTreatment" | "radiusStyle" | "spacingDensity">>;
};

export type SectionModel = {
  id: string;
  type: SectionType;
  variant: string;
  props: Record<string, unknown>;
  bindings: Record<string, string>;
  responsiveOverrides?: SectionResponsiveOverrides;
  fieldPolicies: Record<string, FieldPolicy>;
};

export type SectionResponsiveOverrides = {
  heroScale?: "standard" | "compact";
  compactAboveFold?: boolean;
  heroMediaMaxHeight?: {
    desktop?: number;
    mobile?: number;
  };
} & Record<string, unknown>;

export type PageModel = {
  id: string;
  slug: string;
  title: string;
  seo: SeoMetadata;
  layoutSections: LayoutSection[];
  /**
   * Deprecated projection used only by legacy operational code during the pre-launch
   * renderer cutover. Public generated-site rendering uses layoutSections.
   */
  sections: SectionModel[];
};

export type SiteDesignSystemV2 = {
  version: "site-design-system-v2";
  recipeId: string;
  typography: {
    headingFamily: string;
    bodyFamily: string;
    headingWeight: number;
    bodyWeight: number;
    scale: "compact" | "standard" | "editorial";
  };
  color: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    primaryText: string;
    accent: string;
    border: string;
  };
  buttons: {
    radius: "sharp" | "soft" | "pill";
    height: "compact" | "standard" | "large";
    weight: "medium" | "bold";
    variants: Array<"primary" | "secondary" | "subtle" | "high_emphasis">;
  };
  header: {
    mode: "transparent_overlay" | "adaptive_overlay" | "solid_sticky" | "shrinking_sticky";
    mobileBehavior: "drawer" | "compact_links";
  };
  cards: {
    radius: "sharp" | "soft" | "rounded";
    border: "none" | "subtle" | "strong";
    shadow: "none" | "subtle";
  };
  media: {
    treatment: "natural" | "full_bleed" | "framed" | "editorial_crop";
    cropRule: "center" | "subject" | "wide";
  };
  rhythm: {
    sectionSpacing: "compact" | "standard" | "spacious";
    contentWidth: "contained" | "wide";
  };
  motion: "none" | "subtle";
};

export type SectionFamilyV2 =
  | "hero.estimate_intake"
  | "hero.order_path"
  | "hero.service_request"
  | "hero.local_action"
  | "services.matrix"
  | "menu.highlights"
  | "media.service_gallery"
  | "proof.trust_band"
  | "process.repair_steps"
  | "process.order_steps"
  | "process.service_steps"
  | "guidance.insurance_estimate"
  | "faq.repair_questions"
  | "faq.local_questions"
  | "coverage.service_area"
  | "contact.location_hours"
  | "cta.final_band"
  | "footer.standard";

export type ClaimCategoryV2 =
  | "business_identity"
  | "service"
  | "location"
  | "contact"
  | "hours"
  | "reviews"
  | "credentials"
  | "insurance"
  | "pricing"
  | "warranty"
  | "emergency"
  | "regulated";

export type ClaimSpanV2 = {
  id: string;
  sourceFactIds: string[];
  category: ClaimCategoryV2;
  normalizedClaimValue: string;
  textHash: string;
  renderPolicy: SourceAwareFactPolicy;
  sourcePolicy: SourceAwareFactPolicy;
};

export type CopyArtifactV2 = {
  id: string;
  artifactVersion: "copy-artifact-v2";
  producerId: string;
  producerVersion: string;
  verticalPlaybookVersion: string;
  sectionContractVersion: string;
  slotId: string;
  text: string;
  claimSpans: ClaimSpanV2[];
  scorecard?: Record<string, unknown>;
  status: "selected" | "rejected" | "candidate";
};

export type CompiledSectionV2 = {
  id: string;
  family: SectionFamilyV2;
  variant: string;
  props: Record<string, unknown>;
  sourceFactIds: string[];
  copyArtifactIds: string[];
  assetArtifactIds: string[];
  claimSpanIds: string[];
};

export type CompiledPageV2 = {
  id: string;
  slug: string;
  title: string;
  seo: SeoMetadata;
  sections: CompiledSectionV2[];
};

export type BlueprintSectionV2 = {
  id: string;
  family: SectionFamilyV2;
  variant: string;
  requiredFactKinds: BusinessFactKind[];
  optionalFactKinds: BusinessFactKind[];
  conversionRole: "primary" | "supporting" | "proof" | "contact" | "navigation";
};

export type BlueprintPageV2 = {
  id: string;
  slug: string;
  title: string;
  sections: BlueprintSectionV2[];
};

export type BlueprintV2 = {
  id: string;
  version: "blueprint-v2";
  vertical: Vertical;
  verticalPlaybookVersion: string;
  primaryGoal: ConversionGoal;
  pages: BlueprintPageV2[];
  headerMode: SiteDesignSystemV2["header"]["mode"];
  requiredFactIds: string[];
  optionalFactIds: string[];
  assetNeeds: string[];
};

export type SiteVersionArtifactRefV2 = {
  artifactId: string;
  artifactType: SiteArtifactType;
  artifactVersion: string;
  contentHash: string;
  affectedPageId?: string;
  affectedSectionId?: string;
  affectedSlotId?: string;
};

export type SiteArtDirectionFontPairingIdV3 =
  | "editorial_serif_clean_sans"
  | "display_sans_humanist"
  | "condensed_service_sans"
  | "warm_editorial_sans"
  | "precision_grotesk"
  | "friendly_rounded"
  | "magazine_grotesk"
  | "quiet_serif";

export type SiteHeaderModeV3 =
  | "transparent_overlay"
  | "solid_editorial"
  | "compact_sticky"
  | "split_brand_rail"
  | "utility_call_bar"
  | "minimal_wordmark";

export type SiteArtDirectionRecipeV3 = {
  id: string;
  version: "site-art-direction-recipe-v1";
  fontPairingId: SiteArtDirectionFontPairingIdV3;
  colorSystem: "light_editorial" | "media_neutral" | "warm_neighborhood" | "high_contrast_neutral" | "quiet_boutique";
  spacingRhythm: "compact" | "standard" | "spacious" | "cinematic";
  headerModes: SiteHeaderModeV3[];
  mediaTreatment: "natural_crop" | "subject_crop" | "editorial_crop" | "full_bleed_story" | "text_first_fallback";
  buttonSystem: "solid_with_quiet_secondary" | "high_contrast_primary" | "rounded_primary" | "understated";
  cardTreatment: "borderless" | "minimal_surface" | "soft_surface" | "hairline_surface";
  density: "open" | "balanced" | "dense";
};

export type SiteArtDirectionV3 = {
  version: "site-art-direction-v3";
  recipeId: string;
  fontPairingId: SiteArtDirectionFontPairingIdV3;
  colorSystem: SiteArtDirectionRecipeV3["colorSystem"];
  spacingRhythm: SiteArtDirectionRecipeV3["spacingRhythm"];
  headerMode: SiteHeaderModeV3;
  mediaTreatment: SiteArtDirectionRecipeV3["mediaTreatment"];
  buttonSystem: SiteArtDirectionRecipeV3["buttonSystem"];
  cardTreatment: SiteArtDirectionRecipeV3["cardTreatment"];
  density: SiteArtDirectionRecipeV3["density"];
};

export type ArtDirectionDecisionV3 = {
  id: string;
  version: "art-direction-decision-v3";
  selectedRecipeId: string;
  rejectedRecipeIds: string[];
  inputSignals: string[];
  rationale: string;
  validation: {
    status: "passed" | "failed";
    issues: string[];
  };
  tokenVersions: {
    fontPool: string;
    recipeCatalog: string;
    componentControls: string;
  };
};

export type SlotKindV3 = "text" | "image" | "button" | "list" | "proof" | "contact_fact" | "map_link" | "form" | "nav";

export type SlotV3 = {
  id: string;
  kind: SlotKindV3;
  required: boolean;
  sourceFactIds: string[];
  artifactRefs: SiteVersionArtifactRefV2[];
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
  rightsStatus: "approved" | "restricted" | "unknown";
  usageScope: "hero" | "section" | "background" | "thumbnail" | "not_public";
  sourceUrl?: string;
  artifactRef?: string;
  policyNotes: string[];
  mayImplyRealBusinessWork: boolean;
};

export type VisualQaReportV3 = {
  id: string;
  version: "visual-qa-report-v3";
  readiness: GenerationQaReadiness;
  screenshotArtifactIds: string[];
  deterministicFindings: GenerationQaBlocker[];
  rubricScores: Record<string, number>;
  reviewer?: {
    id: string;
    reviewedAt: string;
    notes: string;
  };
};

export type SiteVersionBase = {
  id: string;
  status: "draft" | "published";
  rendererVersion: RendererVersion;
  designSchemaVersion: DesignSchemaVersion;
  /**
   * Transitional projection for pre-cutover admin, SEO, and QA surfaces that still
   * read the legacy page model. Canonical layout-v2 rendering uses compiledPages.
   */
  pages: PageModel[];
  /**
   * Transitional projection for pre-cutover surfaces. Canonical layout-v2 rendering
   * uses siteDesignSystem.
   */
  designPlan: DesignPlan;
  createdAt: string;
  theme?: Theme;
  presentation?: SiteVersionPresentation;
  ownerTouched?: boolean;
  ownerApprovedAt?: string;
  generationQa?: GenerationQaMetadata;
};

export type SiteVersionV1 = SiteVersionBase & {
  rendererVersion: "layout-v1";
  designSchemaVersion: "design-v1";
};

export type SiteVersionV2 = SiteVersionBase & {
  rendererVersion: "layout-v2";
  designSchemaVersion: "design-v2";
  blueprint: BlueprintV2;
  siteDesignSystem: SiteDesignSystemV2;
  compiledPages: CompiledPageV2[];
  artifactRefs: SiteVersionArtifactRefV2[];
};

export type SiteVersionV3 = SiteVersionBase & {
  rendererVersion: "layout-v3";
  designSchemaVersion: "design-v3";
  artDirection: SiteArtDirectionV3;
  artDirectionDecision?: ArtDirectionDecisionV3;
  pageComposition: PageCompositionV3;
  mediaDecisions: MediaAssetDecisionV3[];
  visualQa?: VisualQaReportV3;
  artifactRefs: SiteVersionArtifactRefV2[];
};

export type SiteVersion = SiteVersionV1 | SiteVersionV2 | SiteVersionV3;

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
  | "performance_failed";

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

export type GenerationQaRepairLog = {
  attempted: boolean;
  applied: boolean;
  attemptedAt?: string;
  mutationSummaries: string[];
  unresolvedBlockerIds: string[];
};

export type GenerationQaMetadata = {
  readiness: GenerationQaReadiness;
  siteModelHash?: string;
  qaRunId?: string;
  checkedAt?: string;
  blockers: GenerationQaBlocker[];
  warnings: GenerationQaWarning[];
  inspectionSummary?: RenderInspectionSummary;
  artifactRefs?: RenderInspectionArtifactRef[];
  visualQa?: VisualQaResult;
  generationCostEstimate?: GenerationCostEstimate;
  repair?: GenerationQaRepairLog;
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

export type RenderViewportName = "desktop" | "tablet" | "mobile";

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

export type RenderInspectionTarget = "source_site" | "generated_site";

export type RenderElementRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
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
  crampedTextCount?: number;
  crampedTextSamples?: string[];
  heroMediaEdgeClipCount?: number;
  heroMediaEdgeClipSamples?: string[];
  headingFontFamily?: string;
  bodyFontFamily?: string;
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
    crampedTextCount?: number;
    crampedTextSamples?: string[];
    heroMediaEdgeClipCount?: number;
    heroMediaEdgeClipSamples?: string[];
    headingFontFamily?: string;
    bodyFontFamily?: string;
  };
  metricsByViewport?: Partial<Record<RenderViewportName, RenderViewportMetrics>>;
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
  target: "source_site" | "generated_site" | "generated_site_model";
  versionId?: string;
  siteModelHash?: string;
  qaRunId?: string;
  evaluatedAt: string;
  screenshotCount: number;
  selectedDesignDirectionId?: string;
  summary: string;
  score?: {
    overall: number;
    brand: number;
    layout: number;
    copy: number;
    conversion: number;
    media: number;
    mobile: number;
  };
  findings: VisualQaFinding[];
  limitations: string[];
};

export type GenerationCostBudgetMode = "normal_generation" | "operator_premium_generation";

export type GenerationCostLineItem = {
  id: string;
  label: string;
  quantity: number;
  unitWeight: number;
  units: number;
  required: boolean;
};

export type GenerationCostGateState = "allowed" | "skipped" | "required";

export type GenerationCostEstimate = {
  id: string;
  policyVersion: "generation-cost-v1";
  mode: GenerationCostBudgetMode;
  status: "within_budget" | "over_budget";
  estimatedUnits: number;
  budgetUnits: number;
  computedAt: string;
  lineItems: GenerationCostLineItem[];
  gates: {
    generatedRenderQa: "required";
    deterministicVisualQa: "required";
    sourceModelVisualQa: GenerationCostGateState;
    generatedModelVisualQa: GenerationCostGateState;
    mockupImageGeneration: GenerationCostGateState;
  };
  minimums: {
    generatedRenderQa: "required_before_ready";
    deterministicVisualQa: "required_for_every_generation";
    modelVisualQa: "run_for_final_generated_site_when_budget_credentials_and_screenshots_allow";
  };
  reasons: string[];
};

export type SiteArtDirection =
  | "precision_service"
  | "warm_local"
  | "clinical_trust"
  | "premium_professional"
  | "visual_craft";

export type SiteDirectorClaimCategory =
  | "business_identity"
  | "service"
  | "location"
  | "contact"
  | "hours"
  | "reviews"
  | "credentials"
  | "insurance"
  | "pricing"
  | "warranty"
  | "emergency"
  | "regulated";

export type SiteDirectorCopyPolicy = {
  grounding: "fact_ids_only";
  allowedClaimCategories: SiteDirectorClaimCategory[];
  forbiddenClaimCategories: SiteDirectorClaimCategory[];
  missingFactBehavior: "omit_section" | "render_without_claim" | "block_generation";
};

export type SiteDirectorSectionDecision = {
  action: "keep" | "revise" | "omit";
  priority: number;
  rationale: string;
  factIds: string[];
  allowedClaimCategories: SiteDirectorClaimCategory[];
  headlineBrief?: string;
  bodyBrief?: string;
  riskNotes: string[];
};

export type GenerationPlanV2Section = {
  id: string;
  kind: LayoutSectionKind;
  catalogSection: string;
  pageId: string;
  intent: string;
  supportStatus: "supported" | "missing_required_facts";
  rejectionBehavior: SiteDirectorCopyPolicy["missingFactBehavior"];
  missingFactKinds: BusinessFactKind[];
  requiredFactIds: string[];
  optionalFactIds: string[];
  requiredFactKinds: BusinessFactKind[];
  requiredAnyFactKinds: BusinessFactKind[];
  optionalFactKinds: BusinessFactKind[];
  copyPolicy: SiteDirectorCopyPolicy;
  directorDecision?: SiteDirectorSectionDecision;
  omittedReason?: string;
};

export type SiteDirectorStructuralRejection = {
  id: string;
  pageId: string;
  sectionId: string;
  catalogSection: string;
  action: SiteDirectorCopyPolicy["missingFactBehavior"];
  missingFactKinds: BusinessFactKind[];
  reason: string;
};

export type GenerationPlanV2 = {
  id: string;
  siteId: string;
  source: "deterministic_contract_seed" | "ai_site_director";
  createdAt: string;
  vertical: Vertical;
  primaryGoal: ConversionGoal;
  artDirection: SiteArtDirection;
  director: {
    contractVersion: "site-director-v1";
    promptVersion: "site-director-prompt-v1";
    planningMode: "deterministic_seed" | "model_backed";
    model?: string;
    structuralRules: string[];
    repairContract: {
      deterministicPasses: number;
      aiRetries: number;
    };
    rejectionContract: {
      unsupportedSection: "omit_or_block_before_ready";
      unsupportedClaim: "block_ready_until_removed_or_verified";
      structuralHallucination: "reject_section_not_backed_by_fact_contract";
    };
  };
  directorRun?: {
    status: "not_run" | "applied" | "rejected" | "failed";
    source: "deterministic" | "openai";
    model?: string;
    summary?: string;
    issues?: string[];
    appliedAt?: string;
  };
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    sections: GenerationPlanV2Section[];
  }>;
  omittedSections: Array<{
    catalogSection: string;
    reason: string;
    missingFactKinds: BusinessFactKind[];
  }>;
  structuralRejections: SiteDirectorStructuralRejection[];
  verification: {
    status: "pending" | "passed" | "failed";
    unsupportedClaimCount: number;
  };
};

export type PresenceAssessment = {
  siteId: string;
  sourceUrl?: string;
  businessFactGraph?: BusinessFactGraph;
  generationPlanV2?: GenerationPlanV2;
  normalizedBusinessFacts?: NormalizedBusinessFacts;
  standardEvaluation?: StandardEvaluation;
  renderInspection?: RenderInspectionResult;
  visualQa?: VisualQaResult;
  generationCostEstimate?: GenerationCostEstimate;
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
  generationBrief?: GenerationBrief;
};

export type SiteArtifactScope =
  | "candidate_selected"
  | "candidate_alternative"
  | "site_selected"
  | "site_alternative"
  | "evaluation_candidate"
  | "qa_evidence";

export type SiteArtifactType =
  | "copy_artifact"
  | "copy_diff"
  | "business_context_report"
  | "change_impact_report"
  | "identity_reconcile_report"
  | "service_catalog_report"
  | "vertical_classification_report"
  | "conversion_path_report"
  | "information_architecture_report"
  | "brand_cue_report"
  | "brand_direction_report"
  | "brand_mark_generation_report"
  | "asset_selection_report"
  | "seo_metadata_report"
  | "performance_audit_report"
  | "social_proof_report"
  | "conversion_insights_report"
  | "local_seo_refresh_report"
  | "page_gap_analysis_report"
  | "experiment_recommendation_report"
  | "design_section_audit_report"
  | "design_system"
  | "blueprint"
  | "compiled_section"
  | "compiled_page"
  | "claim_report"
  | "policy_report"
  | "page_opportunity_report"
  | "visual_benchmark"
  | "art_direction_decision"
  | "media_asset_decision"
  | "copy_evaluation_report"
  | "v3_review_packet"
  | "generation_cost_report";

export type SiteArtifactRecord = {
  id: string;
  siteCandidateId?: string;
  siteId?: string;
  scope: SiteArtifactScope;
  artifactType: SiteArtifactType;
  artifactVersion: string;
  producerId: string;
  producerVersion: string;
  verticalPlaybookVersion?: string;
  sectionContractVersion?: string;
  siteDesignSystemVersion?: string;
  sourceFactIds: string[];
  affectedPageId?: string;
  affectedSectionId?: string;
  affectedSlotId?: string;
  contentHash: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CreativeBrief = {
  designIntent: string;
  mockupPrompt: string;
  visualInspectionChecklist: string[];
  assetStrategy: string[];
  brandCuesToPreserve: string[];
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

export type GenerationBrief = {
  siteId: string;
  businessName: string;
  vertical: Vertical;
  primaryGoal: ConversionGoal;
  headline: string;
  subheadline: string;
  proofSignals: string[];
  renderableFacts: RenderableFact[];
  blockedClaims: BlockedClaim[];
  imageStrategy: {
    vertical: Vertical;
    preferredAssetId?: string;
    fallbackAssetId: string;
    notes: string[];
  };
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
  business?: BusinessRecord;
  locations?: BusinessLocationRecord[];
  locationBindings?: SiteLocationBinding[];
  renderProfile?: BusinessProfile;
  siteModel: SiteModel;
  extensionModel: ExtensionModel;
  optimizationFindings: OptimizationFinding[];
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
  | "audit_site"
  | "generate_site"
  | "agent_telemetry_cleanup"
  | "monthly_action_list"
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
