import type {
  BusinessProfile,
  GenerationQaBlocker,
  GenerationQaMetadata,
  GenerationQualityFinding,
  GenerationQualityReport,
  GenerationQualityRubricScores,
  SiteBundle,
  SiteVersion,
  SiteVersionV3,
  Vertical,
  VisualQaResult
} from "./models";
import { getVisualSectionV3, type VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { isDynamicHoursStatus } from "./business-understanding-v2";
import { defaultServicesForVertical } from "./recipes";
import { detectMetaInstructionalCopy } from "./generated-copy-v2";

/** Candidate readiness requires at least this overall quality score. */
export const qualityReadyThreshold = 75;
/** Scores in [qualityOperatorReviewThreshold, qualityReadyThreshold) block for operator review. */
export const qualityOperatorReviewThreshold = 60;

/** Verticals where customers expect imagery; text-only candidates block for these. */
export const visualTradeVerticals: readonly Vertical[] = [
  "auto_body",
  "auto_services",
  "restaurant",
  "beauty_salon",
  "med_spa",
  "landscaping",
  "creative_studio"
];

const genericHeroPatterns = [
  /^start with .{1,60}\.?$/i,
  /^a direct way to work with .{1,60}\.?$/i,
  /^a composed first step/i,
  /^welcome to /i,
  /^your local .{1,40}\.?$/i
];

const internalStatePatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgeneral[ _]local\b/i, reason: "Internal vertical slug is visible in customer copy." },
  { pattern: /\b(auto_services|auto_body|home_services|med_spa|law_firm|real_estate|beauty_salon|creative_studio)\b/, reason: "Internal vertical slug is visible in customer copy." },
  { pattern: /\bhours?[_\s]?\d\b/i, reason: "Raw scraped hours label is visible in customer copy." }
];

/**
 * Filler facts pretend to be business proof without carrying information
 * ("Services: 3", "Start: Call directly"). Real values under the same label
 * (e.g. "Services: Flat repair, brakes") are fine.
 */
export function isFillerFact(label: string, value: string) {
  const key = label.toLowerCase().trim();
  if (key === "services") return /^\d+$/.test(value.trim());
  if (key === "start") return /^(call directly|send details|call or send details)$/i.test(value.trim());
  if (key === "fit") return /confirmed by the team/i.test(value);
  if (key === "area") return /^local$/i.test(value.trim());
  return false;
}

const verticalCopyExpectations: Partial<Record<Vertical, RegExp>> = {
  auto_services: /\b(tire|tires|wheel|flat|brake|auto|vehicle|car|oil)\b/i,
  auto_body: /\b(collision|dent|paint|body|glass|vehicle|auto|car)\b/i,
  restaurant: /\b(menu|food|dish|dining|dine|order|kitchen|table|takeout|catering)\b/i,
  home_services: /\b(repair|home|emergency|estimate|technician|maintenance|plumb|hvac|electric)\b/i,
  beauty_salon: /\b(hair|cut|color|stylist|salon|treatment|appointment|book)\b/i,
  landscaping: /\b(lawn|yard|landscape|garden|tree|mow)\b/i,
  dental: /\b(dental|teeth|tooth|smile|patient)\b/i,
  veterinary: /\b(pet|animal|vet|veterinary)\b/i
};

export function detectGenericHeroHeading(heading: string) {
  return genericHeroPatterns.some((pattern) => pattern.test(heading.trim()));
}

export function detectMalformedServiceTitle(title: string) {
  const text = title.trim();
  if (!text) return true;
  if (/\s\d{1,3}(?:\s\d{1,3})+$/.test(text)) return true;
  if (/\$\s*\d/.test(text)) return true;
  if (text.length > 70) return true;
  if (!/[a-z]/i.test(text)) return true;
  return false;
}

export function detectInternalStateCopy(text: string): string | undefined {
  for (const entry of internalStatePatterns) {
    if (entry.pattern.test(text)) return entry.reason;
  }
  if (isDynamicHoursStatus(text)) return "Live open/closed status string is stored as permanent copy.";
  return undefined;
}

/** True when the profile's services are exactly the synthesized vertical defaults. */
export function areServicesVerticalDefaults(services: string[], vertical: Vertical) {
  const defaults = defaultServicesForVertical(vertical);
  if (!services.length || !defaults.length) return false;
  if (services.length !== defaults.length) return false;
  return services.every((service, index) => service === defaults[index]);
}

/**
 * Deterministic anti-doorway measure: the share of `left` sentences that also
 * appear in `right` (normalized). Service pages must stay under 0.4 against
 * the homepage and against sibling pages.
 */
export const servicePageMaxOverlapRatio = 0.4;

export function sentenceOverlapRatio(left: string[], right: string[]): number {
  const sentences = (texts: string[]) =>
    texts
      .flatMap((text) => text.split(/(?<=[.!?])\s+/))
      .map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
      .filter((sentence) => sentence.split(" ").length >= 4);
  const leftSentences = sentences(left);
  if (!leftSentences.length) return 0;
  const rightSet = new Set(sentences(right));
  const overlapping = leftSentences.filter((sentence) => rightSet.has(sentence)).length;
  return overlapping / leftSentences.length;
}

export function findDuplicateTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const title of titles) {
    const key = title.toLowerCase().trim();
    if (!key) continue;
    if (seen.has(key)) duplicates.add(title);
    seen.add(key);
  }
  return [...duplicates];
}

export function evaluateGenerationQualityV2(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  mobileIssueCount?: number;
  visualQa?: VisualQaResult;
}): GenerationQualityReport {
  const business = input.bundle.businessProfile;
  const understanding = input.bundle.presenceAssessment.businessUnderstanding;
  const deck = input.bundle.presenceAssessment.generatedCopyDeck;
  const findings: GenerationQualityFinding[] = [];
  const evaluatedAt = new Date().toISOString();

  if (input.version.rendererVersion !== "layout-v3") {
    return {
      version: "generation-quality-v2",
      overallScore: 0,
      rubric: zeroRubric(),
      findings: [
        {
          id: "quality_unsupported_renderer",
          severity: "blocking",
          category: "section_quality",
          detail: `Generation quality V2 evaluates layout-v3 versions; got ${input.version.rendererVersion}.`
        }
      ],
      evaluatedAt
    };
  }

  const sections = v3Sections(input.version);
  const heroSection = sections.find((entry) => entry.sectionId === "hero");
  const allTexts = sections.flatMap((entry) => collectSectionTexts(entry.visual));

  // --- multi-page anti-doorway backstop ---
  const pageTexts = v3PageTexts(input.version);
  for (let index = 1; index < pageTexts.length; index += 1) {
    for (let other = 0; other < index; other += 1) {
      const overlap = sentenceOverlapRatio(pageTexts[index].texts, pageTexts[other].texts);
      if (overlap >= servicePageMaxOverlapRatio) {
        findings.push({
          id: `service_page_duplicate_copy_${pageTexts[index].slug || "home"}`,
          severity: "blocking",
          category: "section_quality",
          detail: `Page "/${pageTexts[index].slug}" repeats ${(overlap * 100).toFixed(0)}% of its sentences from "/${pageTexts[other].slug || ""}"; near-duplicate doorway pages must be dropped, not shipped.`
        });
      }
    }
  }

  // --- vertical fit ---
  let verticalFit = 80;
  if (business.vertical === "general_local") {
    const hasServiceSignals = business.services.length > 0 || (understanding?.cleanedServices.length ?? 0) > 0;
    verticalFit = hasServiceSignals ? 25 : 55;
    if (hasServiceSignals) {
      findings.push({
        id: "vertical_unresolved_service_business",
        severity: "blocking",
        category: "vertical_fit",
        detail: "A business with extracted services was classified general_local; the generic recipe cannot represent its trade."
      });
    }
  } else if (understanding && understanding.vertical === business.vertical) {
    verticalFit = Math.round(60 + understanding.verticalConfidence * 40);
  }
  const expectation = verticalCopyExpectations[business.vertical];
  if (expectation && !allTexts.some((text) => expectation.test(text))) {
    verticalFit = Math.min(verticalFit, 30);
    findings.push({
      id: "copy_vertical_mismatch",
      severity: "blocking",
      category: "vertical_fit",
      detail: `Customer copy never mentions ${business.vertical} trade language; the page reads as generic.`
    });
  }

  // --- source grounding ---
  // Vertical-default services are synthesized, not source-backed; they must not
  // count as grounding and are unverified claims on a public preview.
  const servicesAreVerticalDefaults = areServicesVerticalDefaults(business.services, business.vertical);
  const hasSourceBackedServices = business.services.length > 0 && !servicesAreVerticalDefaults;
  const groundedSignals = [
    Boolean(business.phone),
    Boolean(business.address),
    Boolean(business.hours && Object.keys(business.hours).length),
    hasSourceBackedServices
  ].filter(Boolean).length;
  const sourceGrounding = Math.round((groundedSignals / 4) * 100);
  if (groundedSignals <= 1) {
    findings.push({
      id: "source_grounding_sparse",
      severity: "advisory",
      category: "source_grounding",
      detail: "Fewer than two durable business facts (phone, address, hours, services) are available to ground the page."
    });
  }
  if (servicesAreVerticalDefaults && business.vertical !== "general_local") {
    findings.push({
      id: "services_not_source_backed",
      severity: "blocking",
      category: "source_grounding",
      sectionId: "services",
      detail: `The rendered services are vertical defaults (${business.services.join(", ")}), not source-backed names. The business may not offer them; an operator must verify before the candidate can ship.`
    });
  }

  // --- service clarity ---
  let serviceClarity = 90;
  const serviceTitles = sections
    .filter((entry) => entry.sectionId === "services")
    .flatMap((entry) => itemTitles(entry.visual));
  const malformedTitles = serviceTitles.filter((title) => detectMalformedServiceTitle(title));
  if (malformedTitles.length) {
    serviceClarity = 20;
    findings.push({
      id: "service_titles_malformed",
      severity: "blocking",
      category: "service_clarity",
      sectionId: "services",
      detail: `Service titles are malformed or contain scrape artifacts: ${malformedTitles.slice(0, 3).join("; ")}.`
    });
  }
  const duplicateServices = findDuplicateTitles(serviceTitles);
  if (duplicateServices.length) {
    serviceClarity = Math.min(serviceClarity, 30);
    findings.push({
      id: "service_titles_duplicated",
      severity: "blocking",
      category: "service_clarity",
      sectionId: "services",
      detail: `Duplicate service titles rendered: ${duplicateServices.join("; ")}.`
    });
  }
  if (!serviceTitles.length) serviceClarity = 30;

  // --- hero specificity ---
  let heroSpecificity = deck ? 90 : 75;
  const heroHeading = heroSection ? headingForSection(heroSection.visual) : undefined;
  if (!heroHeading) {
    heroSpecificity = 20;
  } else if (detectGenericHeroHeading(heroHeading)) {
    heroSpecificity = 20;
    findings.push({
      id: "hero_heading_generic",
      severity: "blocking",
      category: "hero_specificity",
      sectionId: "hero",
      detail: `Hero headline is template filler: "${heroHeading}".`
    });
  }

  // --- section quality ---
  let sectionQuality = 90;
  for (const entry of sections) {
    const duplicates = findDuplicateTitles(itemTitles(entry.visual));
    if (duplicates.length) {
      sectionQuality = Math.min(sectionQuality, 30);
      findings.push({
        id: `duplicate_items_${entry.sectionId}`,
        severity: "blocking",
        category: "section_quality",
        sectionId: entry.sectionId,
        detail: `Section repeats identical items: ${duplicates.join("; ")}.`
      });
    }
  }
  for (const text of allTexts) {
    const reason = detectInternalStateCopy(text);
    if (reason) {
      sectionQuality = Math.min(sectionQuality, 20);
      findings.push({
        id: "internal_state_visible",
        severity: "blocking",
        category: "section_quality",
        detail: `${reason} Text: "${text.slice(0, 80)}"`
      });
      break;
    }
  }
  for (const text of allTexts) {
    const reason = detectMetaInstructionalCopy(text);
    if (reason) {
      sectionQuality = Math.min(sectionQuality, 30);
      findings.push({
        id: "meta_copy_visible",
        severity: "blocking",
        category: "section_quality",
        detail: `${reason} Text: "${text.slice(0, 80)}"`
      });
      break;
    }
  }
  const fillerFacts = sections
    .flatMap((entry) => factEntries(entry.visual))
    .filter((fact) => isFillerFact(fact.label, fact.value));
  if (fillerFacts.length) {
    sectionQuality = Math.min(sectionQuality, 40);
    findings.push({
      id: "filler_facts_visible",
      severity: "blocking",
      category: "section_quality",
      detail: `Filler facts rendered instead of real business facts: ${[...new Set(fillerFacts.map((fact) => `${fact.label}: ${fact.value}`))].join("; ")}.`
    });
  }

  // --- CTA fit ---
  const ctaResult = evaluateCtaFit(business, heroSection?.visual, understanding?.primaryConversionGoal);
  if (ctaResult.finding) findings.push(ctaResult.finding);

  // --- media completeness ---
  const mediaResult = evaluateMediaCompleteness(business, input.version, input.bundle.presenceAssessment.textFirstFallbackApproval);
  if (mediaResult.finding) findings.push(mediaResult.finding);

  // --- mobile credibility ---
  const mobileIssues = input.mobileIssueCount ?? 0;
  let mobileCredibility = mobileIssues === 0 ? 85 : Math.max(10, 85 - mobileIssues * 25);

  // --- model visual QA (Phase A: typed taxonomy, advisory only) ---
  // Only taxonomy-typed findings with confidence >= 0.5 influence anything;
  // model findings never block readiness in Phase A.
  const modelDefects = (input.visualQa?.source === "openai" ? input.visualQa.findings : []).filter(
    (finding) =>
      finding.defectCategory &&
      finding.defectCategory !== "none" &&
      (finding.confidence ?? 0) >= 0.5 &&
      (finding.severity === "fail" || finding.severity === "warning")
  );
  // Phase B promotion (calibrated against the template matrix): objective
  // defect categories at high confidence become blocking; subjective
  // categories (repetition, cramped_layout) stay advisory with score caps.
  const objectiveDefectCategories = new Set(["overflow", "unreadable_text", "broken_media", "blank_layout"]);
  for (const defect of modelDefects) {
    const promoted =
      defect.severity === "fail" &&
      (defect.confidence ?? 0) >= 0.8 &&
      objectiveDefectCategories.has(defect.defectCategory ?? "");
    findings.push({
      id: `model_visual_${defect.defectCategory}${defect.viewport ? `_${defect.viewport}` : ""}`,
      severity: promoted ? "blocking" : "advisory",
      category: defect.viewport === "mobile" ? "mobile_credibility" : "section_quality",
      detail: `Model visual QA (${defect.defectCategory}, confidence ${(defect.confidence ?? 0).toFixed(2)}): ${defect.evidence.slice(0, 200)}`
    });
  }
  const severeModelDefects = modelDefects.filter((defect) => defect.severity === "fail" && (defect.confidence ?? 0) >= 0.7);
  if (severeModelDefects.length) {
    sectionQuality = Math.min(sectionQuality, 70);
    if (severeModelDefects.some((defect) => defect.viewport === "mobile")) {
      mobileCredibility = Math.min(mobileCredibility, 70);
    }
  }

  const rubric: GenerationQualityRubricScores = {
    verticalFit,
    sourceGrounding,
    serviceClarity,
    heroSpecificity,
    sectionQuality,
    ctaFit: ctaResult.score,
    mediaCompleteness: mediaResult.score,
    mobileCredibility
  };

  return {
    version: "generation-quality-v2",
    overallScore: overallScoreForRubric(rubric),
    craft: input.visualQa?.source === "openai" ? (input.visualQa.score?.craft ?? input.visualQa.score?.overall) : undefined,
    rubric,
    findings,
    evaluatedAt
  };
}

const rubricWeights: Record<keyof GenerationQualityRubricScores, number> = {
  verticalFit: 15,
  sourceGrounding: 15,
  serviceClarity: 15,
  heroSpecificity: 15,
  sectionQuality: 15,
  ctaFit: 10,
  mediaCompleteness: 10,
  mobileCredibility: 5
};

export function overallScoreForRubric(rubric: GenerationQualityRubricScores) {
  const totalWeight = Object.values(rubricWeights).reduce((sum, weight) => sum + weight, 0);
  const weighted = (Object.keys(rubricWeights) as Array<keyof GenerationQualityRubricScores>).reduce(
    (sum, key) => sum + rubric[key] * rubricWeights[key],
    0
  );
  return Math.round(weighted / totalWeight);
}

function evaluateCtaFit(
  business: BusinessProfile,
  hero: VisualSectionV3 | undefined,
  conversionGoal: string | undefined
): { score: number; finding?: GenerationQualityFinding } {
  const heroActions = heroActionsForVisual(hero);
  const primary = heroActions.find((action) => action.style === "primary") ?? heroActions[0];

  const callFirst =
    Boolean(business.phone) &&
    (conversionGoal === "call_first" || business.vertical === "auto_services" || business.vertical === "auto_body" || business.vertical === "home_services");
  if (callFirst) {
    if (primary?.href?.startsWith("tel:")) return { score: 100 };
    return {
      score: 30,
      finding: {
        id: "cta_not_call_first",
        severity: "blocking",
        category: "cta_fit",
        sectionId: "hero",
        detail: "This is an urgent phone-first business with a phone number, but the hero's primary action is not a call link."
      }
    };
  }

  // Order/booking goals are advisory: the deterministic CTA builder already
  // prefers the right link; a mismatch signals stale composition, not danger.
  if (business.vertical === "restaurant" && business.orderingLinks.length) {
    if (primary?.href && business.orderingLinks.includes(primary.href)) return { score: 100 };
    return {
      score: 60,
      finding: {
        id: "cta_not_order_first",
        severity: "advisory",
        category: "cta_fit",
        sectionId: "hero",
        detail: "An ordering link exists but the hero's primary action does not use it."
      }
    };
  }
  if (
    (business.vertical === "beauty_salon" || business.vertical === "med_spa" || business.vertical === "dental" || business.vertical === "fitness" || business.vertical === "veterinary") &&
    business.bookingLinks.length
  ) {
    if (primary?.href && business.bookingLinks.includes(primary.href)) return { score: 100 };
    return {
      score: 60,
      finding: {
        id: "cta_not_booking_first",
        severity: "advisory",
        category: "cta_fit",
        sectionId: "hero",
        detail: "A booking link exists but the hero's primary action does not use it."
      }
    };
  }

  return { score: 80 };
}

function evaluateMediaCompleteness(
  business: BusinessProfile,
  version: SiteVersionV3,
  textFirstApproval?: { approvedBy: string; reason: string; approvedAt: string }
): { score: number; finding?: GenerationQualityFinding } {
  const textFallback = version.mediaDecisions.some((decision) => decision.source === "text_layout_fallback");
  const hasRenderableMedia = version.mediaDecisions.some((decision) => decision.source !== "text_layout_fallback");
  if (hasRenderableMedia && !textFallback) return { score: 90 };
  if (visualTradeVerticals.includes(business.vertical) && !textFirstApproval) {
    return {
      score: 10,
      finding: {
        id: "media_plan_missing_visual_trade",
        severity: "blocking",
        category: "media_completeness",
        detail: `No credible media plan exists for a ${business.vertical} business; a text-only page is not commercially credible for this trade. Provide rights-safe media or an explicit approved text-first exception.`
      }
    };
  }
  return {
    score: 55,
    finding: {
      id: textFirstApproval ? "media_plan_text_fallback_approved" : "media_plan_text_fallback",
      severity: "advisory",
      category: "media_completeness",
      detail: textFirstApproval
        ? `Text-first fallback explicitly approved by ${textFirstApproval.approvedBy}: ${textFirstApproval.reason}`
        : "Text-first fallback selected because no approved public-safe media is available."
    }
  };
}

/**
 * Applies the Generation Quality V2 gate on top of existing render/readiness QA.
 * ready requires: existing QA ready AND overallScore >= 75 AND no blocking findings.
 * 60-74 persists blocked with needs_operator_review; below 60 blocks as quality_failed.
 */
export function applyQualityGateV2(qa: GenerationQaMetadata, report: GenerationQualityReport): GenerationQaMetadata {
  const blockingFindings = report.findings.filter((finding) => finding.severity === "blocking");
  const thresholdBlockers: GenerationQaBlocker[] = [];

  if (blockingFindings.length || report.overallScore < qualityOperatorReviewThreshold) {
    thresholdBlockers.push({
      id: "quality_below_threshold",
      title: "Generated site failed the quality bar",
      detail: `Generation quality score is ${report.overallScore}/100 with ${blockingFindings.length} blocking finding(s); candidates need ${qualityReadyThreshold}+ and no blocking findings.`,
      category: "quality_failed",
      severity: "blocking"
    });
  } else if (report.overallScore < qualityReadyThreshold) {
    thresholdBlockers.push({
      id: "quality_needs_operator_review",
      title: "Generated site needs operator review",
      detail: `Generation quality score is ${report.overallScore}/100, inside the operator-review band (${qualityOperatorReviewThreshold}-${qualityReadyThreshold - 1}).`,
      category: "needs_operator_review",
      severity: "blocking"
    });
  }

  const mappedBlockers: GenerationQaBlocker[] = blockingFindings.map((finding) => ({
    id: `quality_${finding.id}`,
    title: "Generated site failed a quality check",
    detail: finding.detail,
    category: "quality_failed",
    severity: "blocking"
  }));

  // Threshold/band blockers attach regardless of prior readiness so operators
  // always see the quality categorization, even when render QA already blocked.
  const blockers = dedupeById([...qa.blockers, ...thresholdBlockers, ...mappedBlockers]);
  const readiness = qa.readiness === "ready" && thresholdBlockers.length ? "blocked" : qa.readiness;
  return { ...qa, readiness, blockers, qualityReport: report };
}

function dedupeById(blockers: GenerationQaBlocker[]) {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    if (seen.has(blocker.id)) return false;
    seen.add(blocker.id);
    return true;
  });
}

function heroActionsForVisual(hero: VisualSectionV3 | undefined): Array<{ style?: string; href?: string }> {
  if (!hero) return [];
  const slots = hero.slots as Record<string, unknown>;
  const copy = slots.copy;
  if (!copy || typeof copy !== "object" || !("actions" in copy)) return [];
  const actions = (copy as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];
  return actions.filter((action): action is { style?: string; href?: string } => Boolean(action) && typeof action === "object");
}

type V3SectionEntry = { sectionId: string; visual: VisualSectionV3 };

function v3Sections(version: SiteVersionV3): V3SectionEntry[] {
  // All pages are evaluated; section ids keep their page-scoped prefixes.
  return version.pageComposition.pages
    .flatMap((page) => page.sections)
    .map((section) => {
      const visual = getVisualSectionV3(section.props);
      return visual ? { sectionId: section.id, visual } : undefined;
    })
    .filter((entry): entry is V3SectionEntry => Boolean(entry));
}

/** Shared chrome (contact/facts/location) is intentionally identical across pages and excluded from overlap. */
const sharedChromeTemplates = new Set(["contact_split", "facts_strip", "location_panel", "facts_cta"]);

function v3PageTexts(version: SiteVersionV3): Array<{ slug: string; texts: string[] }> {
  return version.pageComposition.pages.map((page) => ({
    slug: page.slug,
    texts: page.sections
      .map((section) => getVisualSectionV3(section.props))
      .filter((visual): visual is VisualSectionV3 => Boolean(visual && !sharedChromeTemplates.has(visual.templateId)))
      .flatMap((visual) => collectSectionTexts(visual))
  }));
}

function headingForSection(visual: VisualSectionV3): string | undefined {
  const slots = visual.slots as Record<string, unknown>;
  for (const key of ["copy", "intro"]) {
    const slot = slots[key];
    if (slot && typeof slot === "object" && "heading" in slot && typeof (slot as { heading?: unknown }).heading === "string") {
      return (slot as { heading: string }).heading;
    }
  }
  return undefined;
}

function itemTitles(visual: VisualSectionV3): string[] {
  const slots = visual.slots as Record<string, unknown>;
  const items = slots.items;
  if (!items || typeof items !== "object" || !("items" in items)) return [];
  const list = (items as { items: unknown }).items;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      if ("title" in item && typeof (item as { title?: unknown }).title === "string") return (item as { title: string }).title;
      if ("question" in item && typeof (item as { question?: unknown }).question === "string") return (item as { question: string }).question;
      return undefined;
    })
    .filter((title): title is string => Boolean(title));
}

function factEntries(visual: VisualSectionV3): Array<{ label: string; value: string }> {
  const slots = visual.slots as Record<string, unknown>;
  const entries: Array<{ label: string; value: string }> = [];
  for (const key of ["facts", "contact"]) {
    const slot = slots[key];
    if (!slot || typeof slot !== "object") continue;
    const list = "items" in slot ? (slot as { items: unknown }).items : "facts" in slot ? (slot as { facts: unknown }).facts : undefined;
    if (!Array.isArray(list)) continue;
    for (const fact of list) {
      if (!fact || typeof fact !== "object") continue;
      const label = (fact as { label?: unknown }).label;
      const value = (fact as { value?: unknown }).value;
      if (typeof label === "string" && typeof value === "string") entries.push({ label, value });
    }
  }
  return entries;
}

function collectSectionTexts(visual: VisualSectionV3): string[] {
  const texts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (value.trim()) texts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key === "url" || key === "href" || key === "id" || key === "mediaUrl") continue;
        visit(item);
      }
    }
  };
  visit(visual.slots);
  return texts;
}

function zeroRubric(): GenerationQualityRubricScores {
  return {
    verticalFit: 0,
    sourceGrounding: 0,
    serviceClarity: 0,
    heroSpecificity: 0,
    sectionQuality: 0,
    ctaFit: 0,
    mediaCompleteness: 0,
    mobileCredibility: 0
  };
}
