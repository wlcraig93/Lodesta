import { existsSync } from "node:fs";
import { normalize, resolve } from "node:path";
import type {
  GenerationQaBlocker,
  GenerationQaMetadata,
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
import type { GeneratedSiteQualitySignalsV3 } from "./generated-site-v3-nav";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import { templateOptionsForBlueprintV1, templateOptionsFromVisualSectionV1 } from "./generated-site-v3-blueprint";
import { scanPlaceholderText } from "./content-safety-scanners";

export function buildGeneratedSiteQaMetadata(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  inspection: RenderInspectionResult;
  qaRunId: string;
  visualQa?: VisualQaResult;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
}): GenerationQaMetadata {
  const siteModelHash = computeSiteModelHash(input.bundle, input.version);
  const { inspectionSummary, artifactRefs } = summarizeRenderInspection(input.inspection);
  const blockers = [
    ...blockersFromInspection(input.inspection),
    ...blockersFromSiteModel(input.bundle, input.version),
    ...blockersFromQualitySignals(input.qualitySignals)
  ];
  const warnings = [
    ...warningsFromInspection(input.inspection),
    ...warningsFromSiteModel(input.version),
    ...warningsFromQualitySignals(input.qualitySignals)
  ];
  const readiness = aggregateReadinessV2({
    blockers,
    warnings,
    checked: true,
    unavailable: Boolean(input.inspection.unavailableReason)
  });
  return {
    schemaVersion: "generation-qa-v4",
    readiness: readiness.readiness,
    siteModelHash,
    qaRunId: input.qaRunId,
    checkedAt: input.inspection.capturedAt,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    inspectionSummary,
    artifactRefs,
    visualQa: input.visualQa,
    generationCostEstimate: input.bundle.presenceAssessment.generationCostEstimate
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
  for (const blocked of scanPlaceholderText(text)) {
    const match = text.match(blocked.pattern);
    if (!match) continue;
    const matchIndex = typeof match.index === "number" ? match.index : 0;
    const excerptStart = Math.max(0, matchIndex - 60);
    const excerptEnd = Math.min(text.length, matchIndex + match[0].length + 60);
    const excerpt = text.slice(excerptStart, excerptEnd).replace(/\s+/g, " ").trim();
    blockers.push({
      id: "v3_placeholder_visible",
      title: "Generic placeholder copy is visible",
      detail: `${blocked.reason} Matched: "${excerpt}"`,
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
  for (const broken of missingPlatformAssetUrls(version)) {
    blockers.push({
      id: "v3_platform_asset_missing",
      title: "Referenced platform asset is missing",
      detail: `The generated site references ${broken}, but the local/platform asset could not be resolved.`,
      category: "render_failed",
      severity: "blocking"
    });
  }
  for (const day of missingKnownHourDays(bundle, version)) {
    blockers.push({
      id: "v3_known_hours_missing",
      title: "Known source hours are missing",
      detail: `Source data includes ${day} hours, but the generated location hours do not include a ${day} row or range.`,
      category: "data_incomplete",
      severity: "blocking"
    });
  }
  return blockers;
}

function blockersFromQualitySignals(qualitySignals: GeneratedSiteQualitySignalsV3 | undefined): GenerationQaBlocker[] {
  const blockers: GenerationQaBlocker[] = [];
  const nav = qualitySignals?.navReconciliation;
  if (nav) {
    blockers.push(...nav.droppedTargets
      .filter((target) => target.kind === "primary_cta")
      .map((target) => ({
      id: "v3_primary_cta_unresolved_after_reconciliation",
      title: "Primary CTA target could not be resolved",
      detail: `CTA "${target.label}" target "${target.target ?? "missing"}" could not be resolved after reconciliation: ${target.reason}.`,
      category: "quality_failed" as const,
      severity: "blocking" as const
      })));
  }
  for (const decision of qualitySignals?.compilerDecisions ?? []) {
    if (decision.kind !== "composition_section_drop") continue;
    if (decision.resolvedValue === "copy_quality_unresolved") {
      blockers.push({
        id: `v3_copy_quality_unresolved_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Required generated copy is unresolved",
        detail: decision.reason,
        category: "claim_unsupported",
        severity: "blocking"
      });
    }
    if (decision.resolvedValue === "media_selection_unavailable") {
      blockers.push({
        id: `v3_media_selection_unavailable_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Required media selection is unavailable",
        detail: decision.reason,
        category: "policy_review_required",
        severity: "blocking"
      });
    }
  }
  return blockers;
}

function warningsFromSiteModel(version: SiteVersion): GenerationQaWarning[] {
  if (version.rendererVersion !== "layout-v3") return [];
  return warningsFromSiteModelV3(version);
}

function warningsFromSiteModelV3(version: SiteVersionV3): GenerationQaWarning[] {
  const warnings: GenerationQaWarning[] = [];
  warnings.push(...duplicateServiceBodyWarningsV3(version));
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = getVisualSectionV3(section.props);
      if (!visual) continue;
      const selectedOptions = templateOptionsFromVisualSectionV1(visual);
      if (!selectedOptions) continue;
      const allowedOptions = templateOptionsForBlueprintV1[visual.templateId as keyof typeof templateOptionsForBlueprintV1] as
        | Record<string, readonly string[]>
        | undefined;
      for (const [optionName, selectedValue] of Object.entries(selectedOptions)) {
        if (selectedValue === undefined) continue;
        const allowedValues = allowedOptions?.[optionName];
        if (allowedValues?.includes(String(selectedValue))) continue;
        warnings.push({
          id: `v3_variant_unbacked_${section.id}_${optionName}`,
          title: "Selected variant is outside the backed option contract",
          detail: `Section "${section.id}" on /${page.slug} selected ${visual.templateId}.${optionName}=${String(selectedValue)}, but that value is not advertised by the SiteDirector manifest and is not covered by the variant contract.`
        });
      }
    }
  }
  return warnings;
}

function duplicateServiceBodyWarningsV3(version: SiteVersionV3): GenerationQaWarning[] {
  const warnings: GenerationQaWarning[] = [];
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = getVisualSectionV3(section.props);
      if (!visual || visual.anchorId !== "services") continue;
      const slots = visual.slots as Record<string, unknown>;
      const items = slots.items;
      if (!items || typeof items !== "object" || !Array.isArray((items as { items?: unknown }).items)) continue;
      const bodyCounts = new Map<string, { body: string; count: number }>();
      for (const item of (items as { items: Array<{ body?: unknown }> }).items) {
        if (typeof item.body !== "string") continue;
        const body = item.body.replace(/\s+/g, " ").trim();
        if (body.length < 24) continue;
        const key = body.toLowerCase();
        const current = bodyCounts.get(key) ?? { body, count: 0 };
        current.count += 1;
        bodyCounts.set(key, current);
      }
      for (const duplicate of bodyCounts.values()) {
        if (duplicate.count < 2) continue;
        warnings.push({
          id: `v3_duplicate_service_body_${section.id}`,
          title: "Rendered service items share duplicate body copy",
          detail: `Section "${section.id}" repeats the same service body ${duplicate.count} times: "${duplicate.body.slice(0, 160)}".`
        });
      }
    }
  }
  return warnings;
}

function warningsFromQualitySignals(qualitySignals: GeneratedSiteQualitySignalsV3 | undefined): GenerationQaWarning[] {
  const nav = qualitySignals?.navReconciliation;
  const warnings: GenerationQaWarning[] = [];
  if (nav) {
    const deltaCount = nav.droppedTargets.length + nav.rewrittenTargets.length;
    if (deltaCount >= 4) {
      warnings.push({
        id: "v3_nav_reconciliation_heavy",
        title: "Director nav needed heavy reconciliation",
        detail: `The director nav required ${deltaCount} repair(s) before rendering: ${nav.droppedTargets.length} dropped, ${nav.rewrittenTargets.length} rewritten.`
      });
    } else if (deltaCount > 0) {
      warnings.push({
        id: "v3_nav_reconciliation_applied",
        title: "Director nav was reconciled",
        detail: `The director nav required ${deltaCount} repair(s) before rendering.`
      });
    }
    if (nav.ctaRewrite) {
      warnings.push({
        id: "v3_primary_cta_rewritten",
        title: "Primary CTA was rewritten",
        detail: `Primary CTA "${nav.ctaRewrite.label}" was rewritten from "${nav.ctaRewrite.from}" to "${nav.ctaRewrite.to}" because ${nav.ctaRewrite.reason}.`
      });
    }
  }
  for (const decision of qualitySignals?.compilerDecisions ?? []) {
    if (decision.kind === "template_option_clamp") {
      warnings.push({
        id: `v3_compiler_option_clamp_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Compiler clamped a selected template option",
        detail: `${decision.sectionId ?? "section"} ${decision.optionName ?? "option"} changed from ${decision.requestedValue ?? "unknown"} to ${decision.resolvedValue ?? "unknown"}: ${decision.reason}.`
      });
    }
    if (decision.kind === "default_heavy_variant_selection") {
      warnings.push({
        id: "v3_default_heavy_variant_selection",
        title: "Director selected mostly default geometry",
        detail: decision.reason
      });
    }
    if (decision.kind === "composition_section_drop") {
      if (decision.resolvedValue === "copy_quality_unresolved" || decision.resolvedValue === "media_selection_unavailable") continue;
      warnings.push({
        id: `v3_composition_section_drop_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Compiler dropped a duplicated section",
        detail: decision.reason
      });
    }
    if (decision.kind === "quality_profile_assignment") {
      warnings.push({
        id: `v3_quality_profile_${decision.resolvedValue ?? "assigned"}`,
        title: "Quality profile assigned",
        detail: decision.reason
      });
    }
    if (decision.kind === "media_suitability_reject") {
      warnings.push({
        id: `v3_media_suitability_reject_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Unsuitable proof media was rejected",
        detail: decision.reason
      });
    }
    if (decision.kind === "proof_section_fallback") {
      warnings.push({
        id: `v3_proof_section_fallback_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Proof section fell back to context media",
        detail: decision.reason
      });
    }
    if (decision.kind === "service_semantic_dedupe") {
      warnings.push({
        id: `v3_service_semantic_dedupe_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Service list was semantically deduplicated",
        detail: decision.reason
      });
    }
    if (decision.kind === "profile_archetype_constraint") {
      warnings.push({
        id: `v3_profile_archetype_constraint_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: "Profile constrained archetype output",
        detail: decision.reason
      });
    }
  }
  for (const decision of qualitySignals?.mediaReuseDecisions ?? []) {
    warnings.push({
      id: `v3_page_media_reuse_${decision.id.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      title: decision.reason === "duplicate_replaced" ? "Repeated media was replaced" : "Repeated media remains",
      detail:
        decision.reason === "duplicate_replaced"
          ? `Section "${decision.sectionId}" reused ${decision.originalUrl}; compiler replaced it with ${decision.replacementUrl}.`
          : `Section "${decision.sectionId}" reused ${decision.originalUrl}, and no alternate media was available.`
    });
  }
  return warnings;
}

function missingPlatformAssetUrls(version: SiteVersionV3) {
  return [...collectStringValues(version)]
    .filter((value) => isPlatformAssetUrl(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter((url) => !platformAssetExists(url));
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  return Object.values(value as Record<string, unknown>).flatMap(collectStringValues);
}

function isPlatformAssetUrl(value: string) {
  return value.startsWith("/generated-site-assets/") || /^\/api\/assets\/[^/]+\/[^/]+$/i.test(value);
}

function platformAssetExists(url: string) {
  const pathOnly = url.split("#")[0]?.split("?")[0] ?? url;
  if (pathOnly.startsWith("/generated-site-assets/")) {
    const normalizedPath = normalize(pathOnly).replace(/^(\.\.[/\\])+/, "");
    const publicRoot = resolve(process.cwd(), "public");
    const filePath = resolve(publicRoot, normalizedPath.replace(/^\/+/, ""));
    return filePath.startsWith(`${publicRoot}/`) && existsSync(filePath);
  }
  const assetMatch = pathOnly.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/i);
  if (!assetMatch) return true;
  const storagePath = `${decodeURIComponent(assetMatch[1] ?? "")}/${decodeURIComponent(assetMatch[2] ?? "")}`;
  if (!/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*\.(png|jpg|jpeg|webp)$/i.test(storagePath)) return false;
  const assetRoot = resolve(process.cwd(), ".data", "assets");
  const filePath = resolve(assetRoot, storagePath);
  return filePath.startsWith(`${assetRoot}/`) && existsSync(filePath);
}

function missingKnownHourDays(bundle: SiteBundle, version: SiteVersionV3) {
  const sourceDays = Object.entries(bundle.businessProfile.hours ?? {})
    .filter(([, value]) => value && !/closed/i.test(value))
    .map(([day]) => normalizedWeekday(day))
    .filter((day): day is QaWeekday => Boolean(day));
  if (!sourceDays.length) return [];
  const renderedLabels = collectLocationHourLabels(version);
  return [...new Set(sourceDays)].filter((day) => !renderedLabels.some((label) => hoursLabelIncludesDay(label, day)));
}

function collectLocationHourLabels(version: SiteVersionV3) {
  const labels: string[] = [];
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = (section.props as { visualSectionV3?: unknown }).visualSectionV3;
      if (!visual || typeof visual !== "object") continue;
      const locations = (visual as { slots?: { locations?: { locations?: Array<{ hours?: Array<{ label?: string }> }> } } }).slots?.locations?.locations ?? [];
      for (const location of locations) {
        for (const entry of location.hours ?? []) {
          if (entry.label) labels.push(entry.label);
        }
      }
    }
  }
  return labels;
}

const qaWeekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type QaWeekday = (typeof qaWeekdays)[number];

function normalizedWeekday(value: string) {
  const normalized = value.trim().toLowerCase();
  return qaWeekdays.find((day) => day === normalized || day.startsWith(normalized.slice(0, 3)));
}

function hoursLabelIncludesDay(label: string, day: QaWeekday) {
  const normalized = label.trim().toLowerCase();
  if (normalizedWeekday(normalized) === day) return true;
  if (!/[–—-]/.test(normalized)) return false;
  const [startRaw, endRaw] = normalized.split(/[–—-]/).map((part) => part.trim());
  const start = normalizedWeekday(startRaw ?? "");
  const end = normalizedWeekday(endRaw ?? "");
  const startIndex = start ? qaWeekdays.indexOf(start) : -1;
  const endIndex = end ? qaWeekdays.indexOf(end) : -1;
  const targetIndex = qaWeekdays.indexOf(day);
  if (startIndex < 0 || endIndex < 0 || targetIndex < 0) return false;
  if (startIndex <= endIndex) return targetIndex >= startIndex && targetIndex <= endIndex;
  return targetIndex >= startIndex || targetIndex <= endIndex;
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
  if (finding.id.startsWith("render.section_media_overflow")) {
    return blocker("section_media_overflow", "Section media overflows its container", finding, viewport);
  }
  if (finding.id.startsWith("render.form_affordance")) {
    return blocker("form_affordance_missing", "Contact form fields lack visible affordances", finding, viewport);
  }
  if (finding.id.startsWith("render.console_errors")) {
    return blocker("browser_console_error", "Rendered site produced browser console errors", finding, viewport);
  }
  if (finding.id.startsWith("render.primary_media_image")) {
    return blocker("primary_media_image_missing", "Primary hero media image did not load", finding, viewport);
  }
  if (finding.id.startsWith("render.section_quality")) {
    return blocker("section_quality_failure", "One or more sections failed deterministic layout QA", finding, viewport);
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
