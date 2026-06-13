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
  SiteVersionV3,
  VisualQaResult
} from "./models";
import { computeSiteModelHash, summarizeRenderInspection } from "./site-version-metadata";
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
  if (version.rendererVersion === "layout-v3") return blockersFromSiteModelV3(bundle, version);
  throw new Error(`Generated-site QA requires layout-v3; received ${version.rendererVersion}.`);
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
  if (finding.id.startsWith("render.image_oversized")) {
    return blocker("image_oversized", "An image escaped its layout slot", finding, viewport);
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
