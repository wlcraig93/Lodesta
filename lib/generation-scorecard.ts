import type {
  GenerationQaBlocker,
  GenerationQaWarning,
  GenerationQualityReport,
  GenerationQualityVerdict,
  GenerationScorecard,
  RenderInspectionFinding,
  RenderInspectionSummary,
  RenderSectionInspection,
  ScorecardDimension,
  ScorecardDimensionFinding,
  ScorecardDimensionId,
  SiteBundle,
  SiteVersion,
  VisualQaResult
} from "./models";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";

export type ScorecardInput = {
  qualityReport?: GenerationQualityReport;
  visualQa?: VisualQaResult;
  bundle?: SiteBundle;
  version?: SiteVersion;
  blockers: GenerationQaBlocker[];
  warnings: GenerationQaWarning[];
  inspectionSummary?: RenderInspectionSummary;
  brandCueApplied?: boolean;
  aboveFoldCta?: boolean;
  telLinkCount?: number;
  seoScore?: number;
  factCoverageRatio?: number;
};

type DimensionRequirement = ScorecardDimension["requirement"];
type FindingSeverity = ScorecardDimensionFinding["severity"];
type DimensionDraft = {
  id: ScorecardDimensionId;
  requirement: DimensionRequirement;
  rawScore?: number;
  signals: string[];
  findings: ScorecardDimensionFinding[];
};

const readinessGates: Record<ScorecardDimensionId, number> = {
  correctness_grounding: 90,
  visual_design: 75,
  mobile_experience: 75,
  conversion_readiness: 85,
  seo_structure: 80,
  content_quality: 75,
  brand_identity: 70,
  accessibility: 85
};

const premiumTargets: Record<ScorecardDimensionId, number> = {
  correctness_grounding: 90,
  visual_design: 90,
  mobile_experience: 90,
  conversion_readiness: 90,
  seo_structure: 90,
  content_quality: 90,
  brand_identity: 90,
  accessibility: 90
};

const requiredDimensions = new Set<ScorecardDimensionId>([
  "correctness_grounding",
  "visual_design",
  "mobile_experience",
  "conversion_readiness",
  "content_quality",
  "accessibility"
]);

const dimensionIds: ScorecardDimensionId[] = [
  "correctness_grounding",
  "visual_design",
  "mobile_experience",
  "conversion_readiness",
  "seo_structure",
  "content_quality",
  "brand_identity",
  "accessibility"
];

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const accessibilityPattern = /contrast|a11y|focus|landmark|alt_text|tap_target|font_size|text_size|readable_text/i;
const mobilePattern = /mobile|sticky_cta|horizontal_overflow|tap_target|hero_h1_fit|readable_text|body_font_size/i;
const conversionPattern = /cta|primary_action|contact_path|tel|form|conversion|nav|navigation|reconciliation|route/i;
const contentPattern = /placeholder|generic|copy|heading|hero_h1|section_quality|source\/template|planning language|visitor|template|internal|nav_reconciliation|director nav/i;
const visualPattern = /image|media|overlap|low_fill|cramped|clip|heading_overflow|section_quality|layout|visual|figure/i;

export function buildGenerationScorecard(input: ScorecardInput): GenerationScorecard {
  const rubric = input.qualityReport?.rubric;
  const sectionInspections = sectionInspectionsFromSummary(input.inspectionSummary);
  const sectionFindings = sectionInspections.flatMap((section) =>
    section.findings
      .filter((finding) => finding.severity !== "pass")
      .map((finding) => ({ section, finding }))
  );

  const drafts = new Map<ScorecardDimensionId, DimensionDraft>();
  const draft = (id: ScorecardDimensionId, rawScore: number | undefined, signals: string[]): DimensionDraft => {
    const next: DimensionDraft = {
      id,
      requirement: requiredDimensions.has(id) ? "required" : "tracked",
      rawScore,
      signals,
      findings: []
    };
    drafts.set(id, next);
    return next;
  };

  draft(
    "correctness_grounding",
    rubric ? rubric.sourceGrounding * 0.45 + rubric.verticalFit * 0.25 + rubric.serviceClarity * 0.3 : undefined,
    ["rubric.sourceGrounding", "rubric.verticalFit", "rubric.serviceClarity"]
  );
  draft(
    "visual_design",
    visualDesignScore(input),
    ["visualQa.score.craft", "visualQa.score.layout", "visualQa.score.media", "rubric.mediaCompleteness"]
  );
  draft(
    "mobile_experience",
    mobileScore(input, rubric?.mobileCredibility),
    ["render.mobileFindings", "visualQa.score.mobile", "rubric.mobileCredibility"]
  );
  draft(
    "conversion_readiness",
    rubric ? conversionScore(input, rubric.ctaFit) : undefined,
    ["rubric.ctaFit", "render.aboveFoldCta", "render.telLinks"]
  );
  draft("seo_structure", typeof input.seoScore === "number" ? input.seoScore : undefined, ["seo.structureChecks"]);
  draft(
    "content_quality",
    rubric ? contentScore(input, rubric.heroSpecificity * 0.5 + rubric.sectionQuality * 0.5) : undefined,
    ["rubric.heroSpecificity", "rubric.sectionQuality", "factCoverage.surfacedOverEligible", "visualQa.score.copy"]
  );
  draft("brand_identity", brandScore(input), ["brandCueReport.applied", "visualQa.score.brand"]);
  draft("accessibility", 100 - findingCount(input.blockers, accessibilityPattern) * 25 - findingCount(input.warnings, accessibilityPattern) * 8, [
    "render.accessibilityFindings"
  ]);

  for (const blocker of input.blockers) {
    for (const id of dimensionsForFinding(blocker.id, blocker.title, blocker.detail, blocker.viewport)) {
      addFinding(drafts.get(id), "blocking", blocker.id, blocker.title, blocker.detail, blocker.viewport);
    }
  }
  for (const warning of input.warnings) {
    for (const id of dimensionsForFinding(warning.id, warning.title, warning.detail, warning.viewport)) {
      addFinding(
        drafts.get(id),
        warning.id === "v3_nav_reconciliation_heavy" ? "major" : "warning",
        warning.id,
        warning.title,
        warning.detail,
        warning.viewport
      );
    }
  }
  for (const finding of input.qualityReport?.findings ?? []) {
    const severity: FindingSeverity = finding.severity === "blocking" ? "blocking" : /copy_taste|generic|placeholder/i.test(finding.id) ? "major" : "warning";
    for (const id of dimensionsForQualityCategory(finding.category)) {
      addFinding(drafts.get(id), severity, `quality_${finding.id}`, finding.category, finding.detail);
    }
  }
  for (const finding of siteQualityFindings(input)) {
    addFinding(drafts.get(finding.dimension), finding.severity, finding.id, finding.title, finding.detail);
  }
  for (const finding of input.visualQa?.findings ?? []) {
    if (finding.severity === "pass") continue;
    const severity: FindingSeverity = finding.severity === "fail" ? "major" : "warning";
    for (const id of dimensionsForFinding(finding.id, finding.title, finding.evidence, finding.viewport)) {
      addFinding(drafts.get(id), severity, `visual_${finding.id}`, finding.title, finding.evidence, finding.viewport);
    }
  }
  for (const { section, finding } of sectionFindings) {
    const severity: FindingSeverity = finding.severity === "fail" ? "major" : "warning";
    for (const id of dimensionsForFinding(finding.id, finding.title, finding.evidence, section.viewport)) {
      addFinding(
        drafts.get(id),
        severity,
        `section_${section.sectionIndex}_${finding.id}`,
        `${section.label}: ${finding.title}`,
        finding.evidence,
        section.viewport
      );
    }
  }

  const dimensions = dimensionIds.map((id) => finalizeDimension(drafts.get(id) ?? draft(id, undefined, [])));
  return {
    version: "scorecard-v2",
    dimensions,
    verdict: verdictForDimensions(dimensions, input.blockers),
    evaluatedAt: new Date().toISOString()
  };
}

export function scorecardEnforcementBlockers(scorecard: GenerationScorecard): GenerationQaBlocker[] {
  return scorecard.dimensions
    .filter((dimension) => dimension.requirement === "required" && dimension.passes === false)
    .map((dimension) => ({
      id: `scorecard_${dimension.id}_below_gate`,
      title: `Quality dimension below gate: ${dimension.id}`,
      detail: `Dimension ${dimension.id} scored ${dimension.score} against readiness gate ${dimension.gate}. Top signals: ${dimension.signals.join(", ")}.`
    }));
}

function finalizeDimension(draft: DimensionDraft): ScorecardDimension {
  const gate = readinessGates[draft.id];
  const premiumTarget = premiumTargets[draft.id];
  const scored = typeof draft.rawScore === "number";
  const severityLimit = scoreLimitForFindings(draft.findings, gate, premiumTarget);
  const score = scored ? clamp(Math.min(draft.rawScore ?? 0, severityLimit)) : undefined;
  const state = scored ? (draft.requirement === "required" ? "enforcing" : "shadow") : "unscored";
  return {
    id: draft.id,
    state,
    requirement: draft.requirement,
    gate,
    premiumTarget,
    signals: draft.signals,
    findings: draft.findings.slice(0, 8),
    ...(score !== undefined ? { score } : {}),
    ...(score !== undefined ? { premiumPasses: score >= premiumTarget } : {}),
    ...(score !== undefined && draft.requirement === "required" ? { passes: score >= gate } : {})
  };
}

function verdictForDimensions(dimensions: ScorecardDimension[], blockers: GenerationQaBlocker[]): GenerationQualityVerdict {
  const required = dimensions.filter((dimension) => dimension.requirement === "required");
  if (blockers.length || required.some((dimension) => dimension.passes === false || dimension.score === undefined)) return "blocked";
  if (dimensions.some((dimension) => dimension.score === undefined || dimension.premiumPasses === false)) return "needs_review";
  return "premium";
}

function scoreLimitForFindings(findings: ScorecardDimensionFinding[], gate: number, premiumTarget: number) {
  if (findings.some((finding) => finding.severity === "blocking")) return Math.min(gate - 1, 59);
  if (findings.filter((finding) => finding.severity === "major").length >= 2) return Math.min(gate - 1, 64);
  if (findings.some((finding) => finding.severity === "major")) return Math.min(gate - 1, premiumTarget - 1);
  if (findings.filter((finding) => finding.severity === "warning").length >= 4) return premiumTarget - 1;
  if (findings.some((finding) => finding.severity === "warning")) return 94;
  return 100;
}

function addFinding(
  draft: DimensionDraft | undefined,
  severity: FindingSeverity,
  id: string,
  title: string,
  detail: string,
  viewport?: string
) {
  if (!draft) return;
  if (draft.findings.some((finding) => finding.id === id && finding.viewport === viewport)) return;
  draft.findings.push({ id, severity, title, detail, viewport: viewport as ScorecardDimensionFinding["viewport"] });
}

function dimensionsForQualityCategory(category: GenerationQualityReport["findings"][number]["category"]): ScorecardDimensionId[] {
  switch (category) {
    case "vertical_fit":
    case "source_grounding":
    case "service_clarity":
      return ["correctness_grounding", "content_quality"];
    case "hero_specificity":
    case "section_quality":
      return ["content_quality", "visual_design"];
    case "cta_fit":
      return ["conversion_readiness"];
    case "media_completeness":
      return ["visual_design"];
    case "mobile_credibility":
      return ["mobile_experience"];
  }
}

function dimensionsForFinding(id: string, title: string, detail: string, viewport?: string): ScorecardDimensionId[] {
  const text = `${id} ${title} ${detail}`;
  const dimensions = new Set<ScorecardDimensionId>();
  if (viewport === "mobile" || mobilePattern.test(text)) dimensions.add("mobile_experience");
  if (conversionPattern.test(text)) dimensions.add("conversion_readiness");
  if (accessibilityPattern.test(text)) dimensions.add("accessibility");
  if (contentPattern.test(text)) dimensions.add("content_quality");
  if (visualPattern.test(text)) dimensions.add("visual_design");
  if (/claim|unsupported|grounding|source|hallucination|rights|policy/i.test(text)) dimensions.add("correctness_grounding");
  if (!dimensions.size && /seo|metadata|schema|jsonld|title|description/i.test(text)) dimensions.add("seo_structure");
  if (!dimensions.size) dimensions.add("visual_design");
  return [...dimensions];
}

function siteQualityFindings(input: ScorecardInput): Array<ScorecardDimensionFinding & { dimension: ScorecardDimensionId }> {
  if (!input.version || input.version.rendererVersion !== "layout-v3") return [];
  const sections = input.version.pageComposition.pages
    .flatMap((page) => page.sections)
    .map((section) => getVisualSectionV3(section.props))
    .filter((section): section is NonNullable<ReturnType<typeof getVisualSectionV3>> => Boolean(section));
  const findings: Array<ScorecardDimensionFinding & { dimension: ScorecardDimensionId }> = [];

  const headings = sections.flatMap(sectionHeadings);
  const genericHeadings = headings.filter((heading) =>
    /\b(approach|guidance|next steps|questions worth|look at the damage|help after|things to know)\b/i.test(heading)
  );
  if (genericHeadings.length) {
    findings.push({
      dimension: "content_quality",
      id: "site_generic_section_headings",
      severity: genericHeadings.length >= 2 ? "major" : "warning",
      title: "Generic generated section headings",
      detail: `Generic headings found: ${genericHeadings.slice(0, 5).join(" | ")}`
    });
  }

  const publicText = headings.concat(sections.flatMap(sectionBodies)).join("\n");
  const generatedPhrases = [
    "can talk through",
    "can ask",
    "available from",
    "worth answering before",
    "clear next steps",
    "straightforward guidance",
    "need a shop to look at the damage"
  ].filter((phrase) => publicText.toLowerCase().includes(phrase));
  if (generatedPhrases.length) {
    findings.push({
      dimension: "content_quality",
      id: "site_generated_copy_phrasing",
      severity: generatedPhrases.length >= 2 ? "major" : "warning",
      title: "Generated-sounding copy phrasing",
      detail: `Generated phrasing found: ${generatedPhrases.join(", ")}`
    });
  }

  for (const page of input.version.pageComposition.pages) {
    const pageSections = page.sections
      .map((section) => getVisualSectionV3(section.props))
      .filter((section): section is NonNullable<ReturnType<typeof getVisualSectionV3>> => Boolean(section));
    const mediaUrls = pageSections.flatMap(sectionMediaUrls).filter(Boolean);
    const counts = countValues(mediaUrls);
    const unique = counts.size;
    const mostRepeated = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    if (mediaUrls.length >= 6 && (unique / mediaUrls.length < 0.65 || (mostRepeated?.[1] ?? 0) >= 3)) {
      findings.push({
        dimension: "visual_design",
        id: `page_repeated_media_${page.id}`,
        severity: "major",
        title: "Repeated media weakens the page",
        detail: `${page.slug || "home"} has ${mediaUrls.length} media placements using ${unique} unique URL(s); most repeated ${mostRepeated?.[1] ?? 0} times.`
      });
    }
  }

  return findings;
}

function sectionHeadings(section: NonNullable<ReturnType<typeof getVisualSectionV3>>) {
  const slots = section.slots as Record<string, unknown>;
  return ["copy", "intro"]
    .map((key) => slots[key])
    .filter((slot): slot is { heading?: string; eyebrow?: string } => Boolean(slot && typeof slot === "object"))
    .flatMap((slot) => [slot.eyebrow, slot.heading])
    .filter((text): text is string => Boolean(text));
}

function sectionBodies(section: NonNullable<ReturnType<typeof getVisualSectionV3>>) {
  const slots = section.slots as Record<string, unknown>;
  const texts: string[] = [];
  for (const key of ["copy", "intro", "action"]) {
    const slot = slots[key];
    if (slot && typeof slot === "object") {
      const body = (slot as { body?: unknown }).body;
      if (typeof body === "string") texts.push(body);
      const title = (slot as { title?: unknown }).title;
      if (typeof title === "string") texts.push(title);
    }
  }
  const items = (slots.items as { items?: unknown } | undefined)?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      for (const key of ["title", "body", "question", "answer"]) {
        const value = (item as Record<string, unknown>)[key];
        if (typeof value === "string") texts.push(value);
      }
    }
  }
  return texts;
}

function sectionMediaUrls(section: NonNullable<ReturnType<typeof getVisualSectionV3>>) {
  const slots = section.slots as Record<string, unknown>;
  const urls: string[] = [];
  const media = slots.media as { items?: Array<{ url?: string }> } | undefined;
  if (media?.items) urls.push(...media.items.map((item) => item.url).filter((url): url is string => Boolean(url)));
  const items = (slots.items as { items?: unknown } | undefined)?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item && typeof item === "object" && typeof (item as { mediaUrl?: unknown }).mediaUrl === "string") {
        urls.push((item as { mediaUrl: string }).mediaUrl);
      }
    }
  }
  const background = section.options.background;
  if (background.kind === "image") urls.push(background.url);
  return urls;
}

function countValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function visualDesignScore(input: ScorecardInput) {
  if (!input.visualQa?.score && typeof input.qualityReport?.craft === "number") return input.qualityReport.craft;
  const parts = [
    input.visualQa?.score?.craft,
    input.visualQa?.score?.layout,
    input.visualQa?.score?.media,
    input.qualityReport?.rubric.mediaCompleteness
  ].filter((value): value is number => typeof value === "number");
  return parts.length ? average(parts) : undefined;
}

function contentScore(input: ScorecardInput, base: number) {
  const parts = [base];
  if (typeof input.factCoverageRatio === "number") parts.push(input.factCoverageRatio * 100);
  if (typeof input.visualQa?.score?.copy === "number") parts.push(input.visualQa.score.copy);
  return average(parts);
}

function brandScore(input: ScorecardInput) {
  const parts: number[] = [];
  if (input.brandCueApplied !== undefined) parts.push(input.brandCueApplied ? 88 : 50);
  if (typeof input.visualQa?.score?.brand === "number") parts.push(input.visualQa.score.brand);
  return parts.length ? average(parts) : undefined;
}

function mobileScore(input: ScorecardInput, rubricMobileCredibility: number | undefined) {
  const deterministic = Math.max(0, 100 - countViewport(input.blockers, "mobile") * 25 - countViewport(input.warnings, "mobile") * 10);
  const parts = [deterministic];
  if (typeof input.visualQa?.score?.mobile === "number") parts.push(input.visualQa.score.mobile);
  if (typeof rubricMobileCredibility === "number") parts.push(rubricMobileCredibility);
  return average(parts);
}

function conversionScore(input: ScorecardInput, ctaFit: number) {
  const presenceSignals = input.aboveFoldCta !== undefined || input.telLinkCount !== undefined;
  if (!presenceSignals) return ctaFit;
  return Math.min(100, ctaFit * 0.75 + (input.aboveFoldCta ? 15 : 0) + ((input.telLinkCount ?? 0) > 0 ? 10 : 0));
}

function sectionInspectionsFromSummary(summary: RenderInspectionSummary | undefined): RenderSectionInspection[] {
  const byKey = new Map<string, RenderSectionInspection>();
  for (const metrics of Object.values(summary?.metricsByViewport ?? {})) {
    for (const section of metrics?.sectionInspections ?? []) {
      byKey.set(`${section.viewport}:${section.sectionIndex}:${section.sectionId ?? ""}`, section);
    }
  }
  return [...byKey.values()];
}

function findingCount(findings: Array<GenerationQaBlocker | GenerationQaWarning>, pattern: RegExp) {
  return findings.filter((finding) => pattern.test(`${finding.id} ${finding.title} ${finding.detail}`)).length;
}

function countViewport(findings: Array<GenerationQaBlocker | GenerationQaWarning>, viewport: string) {
  return findings.filter((finding) => finding.viewport === viewport).length;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
