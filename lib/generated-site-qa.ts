import type {
  GenerationQaBlocker,
  GenerationQaMetadata,
  GenerationQaRepairLog,
  GenerationQaWarning,
  RenderInspectionFinding,
  RenderInspectionResult,
  RenderViewportName,
  SiteBundle,
  SiteVersion,
  SiteVersionV2,
  SiteVersionV3,
  VisualQaResult
} from "./models";
import { registryAssetByUrl } from "./image-registry";
import { computeSiteModelHash, summarizeRenderInspection } from "./site-version-metadata";
import { propsForLayoutSection, validateLayoutDocument } from "./layout-registry";
import { verifyGenerationClaims } from "./claim-verification";
import { findUnsupportedCatalogSections } from "./section-catalog";
import { validateGenerationPlanV2AgainstVersion } from "./generation-plan-v2";
import { aggregateReadinessV2 } from "./readiness-aggregator-v2";

const blockedPlaceholderPatterns = [
  { pattern: /\bLocal area\b/i, reason: "Generic local-area fallback is visible." },
  { pattern: /\bCore service\b/i, reason: "Generic service fallback is visible." },
  { pattern: /\bLocal support\b/i, reason: "Generic support fallback is visible." },
  { pattern: /\bSample Local Business\b/i, reason: "Sample business fallback is visible." },
  { pattern: /\bVisual proof slot ready\b/i, reason: "Internal proof placeholder is visible." },
  { pattern: /\bCredential details can be verified\b/i, reason: "Internal credential placeholder is visible." },
  { pattern: /\bowner-approved\b/i, reason: "Internal owner-review language is visible." },
  { pattern: /\bowner-truth\b/i, reason: "Internal owner-truth language is visible." },
  { pattern: /\bcan be verified\b/i, reason: "Internal verification language is visible." },
  { pattern: /\b(claimed and published|after claim|owner verification needed)\b/i, reason: "Internal claim-state language is visible." },
  { pattern: /\bnearby customers\?/i, reason: "Broken generic service-area copy is visible." },
  { pattern: /\b(this page|service page|search engines?|local search intent)\b/i, reason: "Website-production planning language is visible." },
  { pattern: /\b(primary action|conversion path|conversion actions?|ready visitors|proof sections?|trust proof)\b/i, reason: "Internal conversion-planning language is visible." },
  { pattern: /\bhelp visitors\b/i, reason: "Generic visitor-planning copy is visible instead of customer-facing copy." },
  { pattern: /\bEasy next step\b/i, reason: "Generic trust-bar filler is visible instead of a specific business signal." },
  { pattern: /\b(Customer decision path|Conversion standard|Review summary detected)\b/i, reason: "Internal quality-calibration copy is visible." },
  { pattern: /\b(general visuals?|visual context|source-backed next steps?|site source|extracted service list|profile details)\b/i, reason: "Internal source/template language is visible." },
  // "starting point" removed: it appears in legitimate price copy ("starts at
  // $25, so you know the starting point"). The remaining phrases are distinctly
  // internal process-planning language.
  { pattern: /\b(repair conversation|estimate conversation|repair paths?|estimate path|call-first path|agreed next step)\b/i, reason: "Generic process-planning copy is visible instead of customer-facing copy." },
  { pattern: /\b(customers should describe|specific without assuming|not a photo of this specific shop)\b/i, reason: "Meta commentary about generated-site safety is visible." },
  { pattern: /\b(Call-first|listed repair service available|listed service customers can ask)\b/i, reason: "Filler proof or service copy is visible." }
];

const oldGenericImageUrls = [
  "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1600&q=80"
];

export function buildGeneratedSiteQaMetadata(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  inspection: RenderInspectionResult;
  qaRunId: string;
  visualQa?: VisualQaResult;
  repair?: GenerationQaRepairLog;
}): GenerationQaMetadata {
  const siteModelHash = computeSiteModelHash(input.bundle, input.version);
  const { inspectionSummary, artifactRefs } = summarizeRenderInspection(input.inspection);
  const blockers = [
    ...blockersFromInspection(input.inspection),
    ...blockersFromSiteModel(input.bundle, input.version)
  ];
  const warnings = [...warningsFromInspection(input.inspection), ...warningsFromVisualQa(input.visualQa)];
  const readiness = aggregateReadinessV2({
    blockers,
    warnings,
    checked: true,
    unavailable: Boolean(input.inspection.unavailableReason)
  });
  return {
    readiness: readiness.readiness,
    siteModelHash,
    qaRunId: input.qaRunId,
    checkedAt: input.inspection.capturedAt,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    inspectionSummary,
    artifactRefs,
    visualQa: input.visualQa,
    generationCostEstimate: input.bundle.presenceAssessment.generationCostEstimate,
    repair: input.repair
  };
}

export function blockersFromInspection(inspection: RenderInspectionResult): GenerationQaBlocker[] {
  const blockers: GenerationQaBlocker[] = [];
  if (inspection.target !== "generated_site") return blockers;
  if (inspection.unavailableReason || inspection.adapter === "fetch_fallback") {
    blockers.push({
      id: "render_browser_unavailable",
      title: "Generated preview was not browser-inspected",
      detail: inspection.unavailableReason ?? "Generated preview QA used fetch fallback instead of browser geometry."
    });
  }
  if (inspection.metrics.siteHeaderDetected === false) {
    blockers.push({
      id: "site_header_missing",
      title: "Generated site header is missing",
      detail: "Generated public pages must render the production site header with navigation and a primary contact path."
    });
  }
  if (inspection.metrics.siteFooterDetected === false) {
    blockers.push({
      id: "site_footer_missing",
      title: "Generated site footer is missing",
      detail: "Generated public pages must render the production site footer with business facts and contact context."
    });
  }
  for (const finding of inspection.findings) {
    if (finding.severity !== "fail") continue;
    const mapped = blockerForRenderFinding(finding);
    if (mapped) blockers.push(mapped);
  }
  return blockers;
}

export function blockersFromSiteModel(bundle: SiteBundle, version: SiteVersion): GenerationQaBlocker[] {
  if (version.rendererVersion === "layout-v2") return blockersFromSiteModelV2(bundle, version);
  if (version.rendererVersion === "layout-v3") return blockersFromSiteModelV3(bundle, version);

  const blockers: GenerationQaBlocker[] = [];
  const text = version.pages.map((page) => page.layoutSections.map((section) => JSON.stringify(propsForLayoutSection(section))).join(" ")).join(" ");
  for (const issue of validateLayoutDocument(version)) {
    if (issue.repairMode !== "deterministic_repair" && issue.repairMode !== "ai_repair") continue;
    blockers.push({
      id: `layout_${issue.id}`,
      title: "Generated section contract is incomplete",
      detail: issue.message,
      viewport: undefined
    });
  }

  for (const blocked of blockedPlaceholderPatterns) {
    if (!blocked.pattern.test(text)) continue;
    blockers.push({
      id: "placeholder_visible",
      title: "Generic placeholder copy is visible",
      detail: blocked.reason
    });
  }

  const imageUrls = version.pages.flatMap((page) =>
    page.layoutSections.flatMap((section) =>
      collectImageUrls(propsForLayoutSection(section)).map((url) => ({
        url,
        sectionKind: section.kind,
        preset: section.preset
      }))
    )
  );
  for (const image of imageUrls) {
    const registryAsset = registryAssetByUrl(image.url);
    if (
      oldGenericImageUrls.includes(image.url) ||
      (registryAsset?.vertical === "general_local" && bundle.businessProfile.vertical !== "general_local")
    ) {
      blockers.push({
        id: "generic_image",
        title: "Image is too generic for the vertical",
        detail: `The generated ${image.sectionKind} section (${image.preset}) uses a generic local-business image instead of a relevant ${bundle.businessProfile.vertical} asset.`
      });
    }
  }

  if (bundle.presenceAssessment.businessFactGraph) {
    if (bundle.presenceAssessment.generationPlanV2) {
      const planIssues = validateGenerationPlanV2AgainstVersion({
        plan: bundle.presenceAssessment.generationPlanV2,
        version,
        factGraph: bundle.presenceAssessment.businessFactGraph
      });
      for (const issue of planIssues) {
        blockers.push({
          id: `director_plan_${issue.id}`,
          title: "Site Director plan is inconsistent with the generated site",
          detail: issue.reason,
          viewport: undefined
        });
      }
    }
    for (const rejection of bundle.presenceAssessment.generationPlanV2?.structuralRejections ?? []) {
      blockers.push({
        id: `director_${rejection.id}`,
        title: "Site Director rejected an unsupported section",
        detail: `${rejection.catalogSection} cannot render safely: ${rejection.reason}`,
        viewport: undefined
      });
    }
    const unsupportedSections = findUnsupportedCatalogSections({
      bundle,
      version,
      factGraph: bundle.presenceAssessment.businessFactGraph,
      primaryGoal: bundle.presenceAssessment.generationPlanV2?.primaryGoal ?? "forms"
    });
    for (const issue of unsupportedSections) {
      blockers.push({
        id: `catalog_${issue.sectionId}`,
        title: issue.missingFactBehavior === "omit_section" ? "Unsupported optional section is still rendered" : "Required section is missing source facts",
        detail: `${issue.preset} is missing safe facts: ${issue.missingFactKinds.join(", ")}.`,
        viewport: undefined
      });
    }
    const verification = verifyGenerationClaims({
      version,
      factGraph: bundle.presenceAssessment.businessFactGraph
    });
    for (const issue of verification.issues) {
      blockers.push({
        id: `claim_${issue.id}`,
        title: "Generated copy includes an unsupported claim",
        detail: `${issue.reason} Text: "${issue.text.slice(0, 160)}"`,
        viewport: undefined
      });
    }
  }

  return blockers;
}

function blockersFromSiteModelV3(bundle: SiteBundle, version: SiteVersionV3): GenerationQaBlocker[] {
  const blockers: GenerationQaBlocker[] = [];
  const home = version.pageComposition.pages.find((page) => page.slug === "") ?? version.pageComposition.pages[0];
  if (!home) {
    return [
      {
        id: "v3_home_missing",
        title: "V3 homepage is missing",
        detail: "A layout-v3 generated site must include a canonical homepage composition.",
        category: "render_failed",
        severity: "blocking"
      }
    ];
  }
  const families = new Set(home.sections.map((section) => section.family));
  const variants = new Set(home.sections.map((section) => section.variant));
  const layouts = new Set(home.sections.map((section) => section.controls.layout));
  if (home.sections.length < 5) {
    blockers.push({
      id: "v3_too_few_sections",
      title: "V3 site is too thin",
      detail: "A layout-v3 homepage needs at least five meaningful sections unless a sparse-data blocker explicitly explains why a smaller site is acceptable.",
      category: "quality_failed",
      severity: "blocking"
    });
  }
  if (![...families].some((family) => family.startsWith("hero."))) {
    blockers.push({
      id: "v3_hero_missing",
      title: "V3 hero is missing",
      detail: "A layout-v3 homepage must include a hero section with the primary conversion path.",
      category: "quality_failed",
      severity: "blocking"
    });
  }
  if (![...families].some((family) => family.startsWith("services."))) {
    blockers.push({
      id: "v3_services_missing",
      title: "V3 services section is missing",
      detail: "A local-business homepage must clearly describe the core services or offer.",
      category: "data_incomplete",
      severity: "blocking"
    });
  }
  if (![...families].some((family) => family.startsWith("contact."))) {
    blockers.push({
      id: "v3_contact_missing",
      title: "V3 contact section is missing",
      detail: "A local-business homepage must provide a contact path near the end of the page.",
      category: "quality_failed",
      severity: "blocking"
    });
  }
  if (variants.size < Math.min(5, home.sections.length)) {
    blockers.push({
      id: "v3_repeated_section_rhythm",
      title: "V3 section rhythm is too repetitive",
      detail: "A layout-v3 homepage must use distinct section variants instead of repeating the same visual structure with different copy.",
      category: "quality_failed",
      severity: "blocking"
    });
  }
  if (layouts.size < 4 && home.sections.length >= 6) {
    blockers.push({
      id: "v3_layout_diversity_low",
      title: "V3 layout diversity is too low",
      detail: "A layout-v3 homepage with six or more sections must use at least four distinct layout controls.",
      category: "quality_failed",
      severity: "blocking"
    });
  }
  // Placeholder scanning covers every composed page, not just the homepage.
  const text = version.pageComposition.pages
    .flatMap((page) => page.sections)
    .map((section) => JSON.stringify(section.props))
    .join(" ");
  for (const blocked of blockedPlaceholderPatterns) {
    if (!blocked.pattern.test(text)) continue;
    blockers.push({
      id: "v3_placeholder_visible",
      title: "Generic placeholder copy is visible",
      detail: blocked.reason,
      category: "claim_unsupported",
      severity: "blocking"
    });
  }
  for (const decision of version.mediaDecisions) {
    // owner_attestation_required is the protected-preview state: real scraped
    // photos render on owner/admin surfaces only. It does not block candidate
    // readiness — the public route refuses these versions, and publishing
    // requires per-photo attestation which recompiles with customer_granted.
    if (decision.rightsStatus === "owner_attestation_required") continue;
    if (decision.rightsStatus !== "approved" && decision.rightsStatus !== "preclaim_safe") {
      blockers.push({
        id: "v3_media_rights_unapproved",
        title: "V3 media rights are not approved",
        detail: `Media decision ${decision.id} has rights status ${decision.rightsStatus}.`,
        category: "policy_review_required",
        severity: "blocking"
      });
    }
    if (decision.source === "generated_ai" && decision.mayImplyRealBusinessWork) {
      blockers.push({
        id: "v3_generated_media_implies_real_work",
        title: "Generated media implies real business work",
        detail: `Media decision ${decision.id} uses AI-generated imagery in a way that may imply documented business-specific work.`,
        category: "policy_review_required",
        severity: "blocking"
      });
    }
  }
  if (!bundle.businessProfile.phone && !bundle.businessProfile.email && !bundle.businessProfile.bookingLinks.length) {
    blockers.push({
      id: "v3_contact_fact_missing",
      title: "No durable contact path is available",
      detail: "A generated local-business site needs a phone, email, booking link, or another durable contact path before it can be ready.",
      category: "data_incomplete",
      severity: "blocking"
    });
  }
  return blockers;
}

function blockersFromSiteModelV2(bundle: SiteBundle, version: SiteVersionV2): GenerationQaBlocker[] {
  const blockers: GenerationQaBlocker[] = [];
  const compiledSections = version.compiledPages.flatMap((page) => page.sections);
  const families = new Set(compiledSections.map((section) => section.family));
  const compiledText = JSON.stringify(version.compiledPages);
  const vertical = bundle.businessProfile.vertical;
  const qualityVertical = vertical === "restaurant" || vertical === "home_services" || vertical === "auto_body" ? vertical : "general_local";

  const minimumFamilies =
    qualityVertical === "restaurant"
      ? (["hero.order_path", "menu.highlights", "contact.location_hours"] as const)
      : qualityVertical === "home_services"
        ? (["hero.service_request", "services.matrix", "coverage.service_area", "contact.location_hours"] as const)
        : qualityVertical === "auto_body"
          ? (["hero.estimate_intake", "services.matrix", "contact.location_hours"] as const)
          : (["hero.local_action", "services.matrix", "contact.location_hours"] as const);

  for (const family of minimumFamilies) {
    if (families.has(family)) continue;
    blockers.push({
      id: `v2_${vertical}_floor_${family.replace(/[^a-z0-9]+/g, "_")}`,
      title: "Generated V2 site is below the honest minimum",
      detail: `The ${vertical} V2 slice requires a ${family} section before it can be ready.`,
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  if (!bundle.businessProfile.phone) {
    blockers.push({
      id: `v2_${vertical}_phone_missing`,
      title: "Generated V2 site is missing a phone number",
      detail: "The V2 site requires a phone number for the primary contact path.",
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  if ((vertical === "auto_body" || vertical === "restaurant") && bundle.presenceAssessment.sourceUrl && !bundle.businessProfile.address) {
    blockers.push({
      id: `v2_${vertical}_address_missing`,
      title: "Generated V2 site is missing a physical address",
      detail: "This V2 slice requires a physical address for the location/contact section.",
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  if ((vertical === "auto_body" || vertical === "home_services") && !bundle.businessProfile.services.length) {
    blockers.push({
      id: `v2_${vertical}_services_missing`,
      title: "Generated V2 site is missing supported services",
      detail: "This V2 slice needs at least one source-backed service before it can render a production-quality service section.",
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  if (vertical === "restaurant" && !bundle.businessProfile.services.length && !bundle.businessProfile.categories.length) {
    blockers.push({
      id: "v2_restaurant_menu_context_missing",
      title: "Restaurant V2 site is missing menu or category context",
      detail: "Restaurant V2 needs source-backed menu, service, or category context before it can render production-quality highlights.",
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  const contactSection = compiledSections.find((section) => section.family === "contact.location_hours");
  const minimumSectionCount = vertical === "general_local" ? 3 : 5;

  for (const blocked of blockedPlaceholderPatterns) {
    if (!blocked.pattern.test(compiledText)) continue;
    blockers.push({
      id: "v2_placeholder_visible",
      title: "Generic or internal generated-site copy is visible",
      detail: blocked.reason,
      category: "quality_failed",
      severity: "blocking"
    });
  }

  if (compiledSections.length < minimumSectionCount) {
    blockers.push({
      id: `v2_${vertical}_section_depth`,
      title: "Generated V2 site is too thin",
      detail: `The compiled site has ${compiledSections.length} meaningful section(s); ${minimumSectionCount} are required for this slice.`,
      category: "quality_failed",
      severity: "blocking"
    });
  }

  const minimumLayoutFamilies = qualityVertical === "general_local" ? 3 : 4;
  if (families.size < minimumLayoutFamilies) {
    blockers.push({
      id: `v2_${vertical}_layout_diversity`,
      title: "Generated V2 site lacks layout diversity",
      detail: `The compiled site uses ${families.size} distinct section family/families; ${minimumLayoutFamilies} are required to avoid repeated shallow layouts.`,
      category: "quality_failed",
      severity: "blocking"
    });
  }

  const heroSection = compiledSections.find((section) => section.family.startsWith("hero."));
  if (heroSection && !(heroSection.props as Record<string, unknown>).mediaUrl) {
    blockers.push({
      id: `v2_${vertical}_hero_media_missing`,
      title: "Generated V2 hero is missing usable media",
      detail: "V2 sites must render a rights-safe hero image or curated preclaim-safe registry image.",
      category: "quality_failed",
      severity: "blocking"
    });
  }

  const servicesSection = compiledSections.find((section) => section.family === "services.matrix");
  if (servicesSection && qualityVertical !== "general_local") {
    const serviceItems = (servicesSection.props as { services?: unknown[] }).services ?? [];
    if (serviceItems.length < 3) {
      blockers.push({
        id: `v2_${vertical}_service_matrix_shallow`,
        title: "Generated V2 services section is too shallow",
        detail: `The service matrix has ${serviceItems.length} item(s). Source-backed service sections need at least 3 distinct items or should block for better source resolution.`,
        category: "quality_failed",
        severity: "blocking"
      });
    }
  }

  if (vertical === "auto_body" && bundle.businessProfile.serviceHighlights?.length) {
    const renderedHighlights = bundle.businessProfile.serviceHighlights.filter((highlight) => compiledText.includes(highlight));
    if (!renderedHighlights.length) {
      blockers.push({
        id: "v2_auto_body_source_highlights_missing",
        title: "Generated V2 site drops source-backed repair highlights",
        detail: "Source-backed auto-body highlights are available but none appear in compiled homepage copy.",
        category: "quality_failed",
        severity: "blocking"
      });
    }
  }

  if (contactSection) {
    const props = contactSection.props as Record<string, unknown>;
    if (typeof props.hoursFallback === "string" && /current hours/i.test(props.hoursFallback)) {
      blockers.push({
        id: `v2_${vertical}_weak_hours_fallback`,
        title: "Missing hours fallback reads like a site deficiency",
        detail: "If hours are not source-backed, omit the hours row from the public page and keep the missing fact in readiness/admin metadata.",
        category: "quality_failed",
        severity: "blocking"
      });
    }
  }

  for (const signal of bundle.presenceAssessment.publicPresenceSignals ?? []) {
    if (signal.fields.rating !== undefined || signal.fields.userRatingCount !== undefined || signal.fields.googleMapsUri) {
      blockers.push({
        id: "v2_google_places_static_proof_signal",
        title: "Google Places proof is stored in generated-site data",
        detail: "V2 stores place_id only; Google rating, review count, and Maps URLs must be resolved live or omitted.",
        category: "policy_review_required",
        severity: "blocking"
      });
      break;
    }
  }

  const googleReviewSummary = bundle.businessProfile.reviewsSummary?.sources.includes("google_places");
  if (googleReviewSummary) {
    const rating = bundle.businessProfile.reviewsSummary?.rating?.toString();
    const count = bundle.businessProfile.reviewsSummary?.count?.toString();
    if ((rating && compiledText.includes(rating)) || (count && compiledText.includes(count))) {
      blockers.push({
        id: "v2_google_review_summary_rendered",
        title: "Google review summary is rendered statically",
        detail: "Google-derived rating and review count cannot appear in compiled V2 props or static output.",
        category: "policy_review_required",
        severity: "blocking"
      });
    }
  }

  return blockers;
}

function warningsFromInspection(inspection: RenderInspectionResult): GenerationQaWarning[] {
  return inspection.findings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => ({
      id: finding.id,
      title: finding.title,
      detail: finding.evidence,
      viewport: finding.viewport
    }));
}

function collectImageUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectImageUrls(item));
  if (typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (/^(imageUrl|url|src)$/i.test(key)) return collectImageUrls(item);
    if (/images?|photos?|media|asset/i.test(key)) return collectImageUrls(item);
    return typeof item === "object" ? collectImageUrls(item) : [];
  });
}

function warningsFromVisualQa(visualQa: VisualQaResult | undefined): GenerationQaWarning[] {
  return (
    visualQa?.findings
      .filter((finding) => finding.severity === "warning" || finding.severity === "fail")
      .map((finding) => ({
        id: `visual_${finding.id}`,
        title: finding.title,
        detail: finding.severity === "fail" ? `Model QA flagged this as a launch concern: ${finding.evidence}` : finding.evidence,
        viewport: finding.viewport
      })) ?? []
  );
}

function blockerForRenderFinding(finding: RenderInspectionFinding): GenerationQaBlocker | undefined {
  const viewport = finding.viewport;
  if (finding.id.startsWith("render.above_fold_cta")) {
    return blocker("cta_below_fold", "Primary hero CTA is not above the fold", finding, viewport);
  }
  if (finding.id.startsWith("render.hero_h1_fit")) {
    return blocker("hero_h1_oversized", "Hero headline is oversized", finding, viewport);
  }
  if (finding.id.startsWith("render.sticky_cta_overlap")) {
    return blocker("sticky_cta_overlap", "Sticky CTA overlaps hero media", finding, viewport);
  }
  if (finding.id.startsWith("render.horizontal_overflow")) {
    return blocker("horizontal_overflow", "Generated page has horizontal overflow", finding, viewport);
  }
  if (finding.id.startsWith("render.body_font_size")) {
    return blocker("body_font_too_small", "Generated page body text is too small", finding, viewport);
  }
  if (finding.id.startsWith("render.readable_text_size")) {
    return blocker("readable_text_too_small", "Generated page includes undersized readable text", finding, viewport);
  }
  if (finding.id.startsWith("render.text_contrast")) {
    return blocker("text_contrast_failure", "Generated page has insufficient text contrast", finding, viewport);
  }
  if (finding.id.startsWith("render.images_loaded")) {
    return blocker("image_load_failure", "Generated page has unloaded or broken images", finding, viewport);
  }
  if (finding.id.startsWith("render.primary_media_image")) {
    return blocker("primary_media_image_missing", "Primary hero media image did not load", finding, viewport);
  }
  if (finding.id.startsWith("render.body_text")) {
    return blocker("rendered_blank", "Generated preview rendered too little content", finding, viewport);
  }
  if (finding.id.startsWith("render.primary_cta")) {
    return blocker("primary_cta_missing", "Generated preview has no conversion action", finding, viewport);
  }
  return undefined;
}

function blocker(id: string, title: string, finding: RenderInspectionFinding, viewport?: RenderViewportName): GenerationQaBlocker {
  return {
    id: viewport ? `${viewport}_${id}` : id,
    title,
    detail: finding.evidence,
    viewport
  };
}
