import { createHash } from "node:crypto";
import type {
  AssessmentApplicability,
  AssessmentEvidence,
  VisualQuality,
  VisualQualityCheck,
  VisualQualityCheckInput,
  VisualQualityGroupId
} from "./contracts";

type VisualQualityCheckDefinition = {
  id: string;
  groupId: VisualQualityGroupId;
  title: string;
  impact: "major" | "minor" | "advisory";
  applicability: AssessmentApplicability;
  businessConsequence: string;
  recommendation: string;
};

export const visualQualityGroupLabels: Record<VisualQualityGroupId, string> = {
  hierarchy: "Hierarchy and conversion",
  typography: "Typography",
  composition: "Composition and spacing",
  imagery: "Imagery and media",
  brand_trust: "Brand and trust",
  responsive_polish: "Responsive polish"
};

export const visualQualityCheckDefinitions: ReadonlyArray<VisualQualityCheckDefinition> = [
  definition("visual.hierarchy.value_proposition", "hierarchy", "The primary value proposition is visually clear", "major", "Visitors may not quickly understand what the business offers or why the page matters.", "Strengthen the opening visual hierarchy so the business, offer, and customer benefit are immediately legible."),
  definition("visual.hierarchy.primary_action", "hierarchy", "The primary action is visually unambiguous", "major", "Competing or visually weak actions make high-intent visitors work to find the next step.", "Give the primary call, booking, quote, or inquiry action clear visual priority."),
  definition("visual.hierarchy.scanability", "hierarchy", "The page supports fast visual scanning", "minor", "Weak section hierarchy makes customers work harder to compare services, proof, and contact options.", "Use clear section boundaries, headings, and content grouping to create an obvious reading path."),
  definition("visual.typography.readability", "typography", "Typography remains readable and comfortably paced", "major", "Difficult reading reduces comprehension and makes the business feel less trustworthy.", "Improve type size, line length, contrast, and spacing where reading becomes strained."),
  definition("visual.typography.consistency", "typography", "Typography follows a coherent system", "minor", "Inconsistent type treatments create noise and weaken the perceived quality of the site.", "Use a consistent type scale, weight hierarchy, and treatment across equivalent elements."),
  definition("visual.composition.spacing_rhythm", "composition", "Spacing creates a consistent visual rhythm", "minor", "Uneven density or spacing makes important information feel disorganized.", "Normalize section, component, and text spacing so related elements read as intentional groups."),
  definition("visual.composition.alignment_balance", "composition", "Alignment and visual balance feel intentional", "minor", "Misaligned or poorly balanced elements distract from the content and reduce perceived polish.", "Align repeated elements to a shared grid and rebalance areas with awkward weight or empty space."),
  definition("visual.imagery.relevance_quality", "imagery", "Prominent imagery is relevant and presentation-ready", "minor", "Weak or irrelevant imagery can undermine confidence in the business before visitors read the copy.", "Use clear, appropriately cropped imagery that directly supports the service, location, team, or proof being presented.", "business_specific"),
  definition("visual.imagery.presentation_consistency", "imagery", "Imagery is presented consistently", "advisory", "Inconsistent crops, treatments, or visual styles make the site feel assembled rather than designed.", "Apply a coherent aspect-ratio, crop, and treatment system to prominent imagery.", "business_specific"),
  definition("visual.brand.coherence", "brand_trust", "The visual language is coherent across the reviewed pages", "minor", "A fragmented visual system weakens recognition and makes navigation feel less predictable.", "Use consistent colors, controls, typography, imagery treatment, and component styling across important pages."),
  definition("visual.trust.vertical_fit", "brand_trust", "The presentation supports trust for the business category", "major", "A presentation that conflicts with category expectations can make customers hesitate even when the content is accurate.", "Align the visual emphasis with the decision signals customers need for this business category.", "vertical"),
  definition("visual.responsive.cross_viewport_consistency", "responsive_polish", "Desktop and mobile preserve the same hierarchy", "major", "A mobile composition that loses hierarchy or actions creates a materially weaker customer journey.", "Preserve the primary message, action, proof, and reading order across desktop and mobile."),
  definition("visual.polish.visible_defects", "responsive_polish", "No obvious visual defects distract from the experience", "major", "Clipping, overlap, awkward crops, or visibly broken composition can make the website feel unreliable.", "Resolve visible clipping, overlap, crop, alignment, and component-presentation defects.")
] as const;

export const visualQualityPrompt = [
  "Review the supplied labeled website contact sheet as a visual-quality evaluator for a US local-business website.",
  "Return every requested check exactly once using only the supplied screenshots and deterministic context.",
  "Judge observable hierarchy, typography, spacing, alignment, imagery presentation, cross-page consistency, responsive composition, and visible defects.",
  "Do not judge source code, performance, SEO, accessibility compliance, business truth, or functionality from screenshots.",
  "Do not infer facts, demographics, intent, or customer sentiment that are not visible.",
  "Every pass, warning, or fail must cite at least one supplied route and viewport and describe the exact visible observation.",
  "Use unknown when the screenshots do not support a reliable judgment and not_applicable only when the supplied applicability context requires it.",
  "Use fail only for a clear, material visual problem; use warning for a defensible improvement opportunity.",
  "Never use vague or demeaning labels such as ugly, amateur, dated, bad, cheap, or unprofessional.",
  "Write concise, specific evidence that another reviewer can verify from the cited screenshot."
].join(" ");

export const visualQualityResponseStatuses = [
  "pass",
  "warning",
  "fail",
  "unknown",
  "not_applicable"
] as const;

export const visualQualityOutputContract = {
  strictJsonSchema: true,
  allChecksRequiredExactlyOnce: true,
  statuses: visualQualityResponseStatuses,
  confidenceRange: [0, 1],
  maximumCitationsPerCheck: 3,
  citationFields: ["route", "viewport", "observation"],
  assessedChecksRequireCitations: true,
  citationsMustMatchRetainedScreenshots: true
} as const;

export const visualQualityValidationPolicy = {
  inferredOnly: true,
  criticalImpactAllowed: false,
  unsupportedApplicabilityRejected: true,
  malformedOutputFailsSectionClosed: true,
  prohibitedLanguagePattern: String.raw`\b(?:ugly|amateur|dated|cheap|unprofessional|bad)\b`,
  prohibitedAssertionPattern: String.raw`\b(?:lcp|cls|inp|seo|search ranking|wcag|screen reader|source code|html (?:error|validation)|javascript error|conversion rate|bounce rate|https|secure connection|(?:page|site) loads? (?:slowly|quickly|in|within)|form (?:works|submits|fails)|link (?:works|is broken)|button (?:works|does not work)|(?:customers|visitors|users) (?:will|would|are likely to|feel|think|prefer|trust|distrust))\b`
} as const;

export const visualQualityPromptIdentity = contentIdentity("visual-prompt", {
  prompt: visualQualityPrompt,
  outputContract: visualQualityOutputContract,
  validationPolicy: visualQualityValidationPolicy
});

export const visualQualityMethodologyIdentity = contentIdentity("visual-quality", {
  groups: visualQualityGroupLabels,
  checks: visualQualityCheckDefinitions,
  publicConfidenceThreshold: 0.9,
  imageryApplicability: "prominent-imagery-required",
  verticalFitMinimumConfidence: 0.8,
  responsiveEvidence: "desktop-and-mobile-required"
});

export function configuredVisualQualityModelId() {
  return process.env.LODESTA_VISUAL_ASSESSMENT_MODEL?.trim() || "gpt-5.6-sol";
}

export function currentVisualQualityEvaluatorIdentity(modelId = configuredVisualQualityModelId()) {
  return contentIdentity("visual-evaluator", {
    provider: "openai",
    modelId,
    promptIdentity: visualQualityPromptIdentity,
    outputContract: visualQualityOutputContract,
    validationPolicy: visualQualityValidationPolicy,
    capturePolicy: {
      maximumRoutes: 3,
      assessedViewports: ["desktop", "mobile"],
      homepageMeasurementViewports: ["desktop", "tablet", "mobile"],
      contactSheetMaximumWidth: 1600,
      contactSheetMaximumHeight: 4096,
      maximumImageBytes: 20_000_000
    }
  });
}

export const visualQualityEvaluatorIdentity = currentVisualQualityEvaluatorIdentity();

export const publiclyEligibleVisualQualityCheckIds: ReadonlySet<string> = new Set([
  "visual.hierarchy.value_proposition",
  "visual.hierarchy.primary_action",
  "visual.hierarchy.scanability",
  "visual.typography.readability",
  "visual.typography.consistency",
  "visual.composition.spacing_rhythm",
  "visual.composition.alignment_balance",
  "visual.imagery.relevance_quality",
  "visual.imagery.presentation_consistency",
  "visual.responsive.cross_viewport_consistency",
  "visual.polish.visible_defects"
]);

export function buildVisualQuality(input: {
  checks: VisualQualityCheckInput[];
  evaluator: VisualQuality["evaluator"];
  limitations?: string[];
  observedAt: string;
}): VisualQuality {
  const supplied = new Map(input.checks.map((check) => [check.id, check]));
  const groups = (Object.keys(visualQualityGroupLabels) as VisualQualityGroupId[]).map((groupId) => {
    const checks = visualQualityCheckDefinitions
      .filter((definitionValue) => definitionValue.groupId === groupId)
      .map((definitionValue): VisualQualityCheck => {
        const suppliedCheck = supplied.get(definitionValue.id);
        if (!suppliedCheck) return unknownCheck(definitionValue, input.observedAt);
        return {
          ...suppliedCheck,
          groupId,
          title: definitionValue.title,
          impact: definitionValue.impact,
          applicability: definitionValue.applicability,
          businessConsequence: definitionValue.businessConsequence,
          recommendation: definitionValue.recommendation
        };
      });
    const applicable = checks.filter((check) => check.status !== "not_applicable");
    const assessed = applicable.filter((check) => check.status !== "unknown");
    return {
      id: groupId,
      label: visualQualityGroupLabels[groupId],
      coverage: applicable.length ? assessed.length / applicable.length : 1,
      verifiedChecks: checks.filter((check) => check.status === "pass").length,
      opportunityChecks: checks.filter((check) => check.status === "warning" || check.status === "fail").length,
      unknownChecks: checks.filter((check) => check.status === "unknown").length,
      notApplicableChecks: checks.filter((check) => check.status === "not_applicable").length,
      applicableChecks: applicable.length,
      checks
    };
  });
  const checks = groups.flatMap((group) => group.checks);
  const applicable = checks.filter((check) => check.status !== "not_applicable");
  const assessed = applicable.filter((check) => check.status !== "unknown");
  return {
    methodologyIdentity: visualQualityMethodologyIdentity,
    evaluator: input.evaluator,
    coverage: {
      value: applicable.length ? round(assessed.length / applicable.length, 4) : 1,
      assessedChecks: assessed.length,
      applicableChecks: applicable.length,
      limitations: unique(input.limitations ?? [])
    },
    counts: {
      verified: checks.filter((check) => check.status === "pass").length,
      opportunities: checks.filter((check) => check.status === "warning" || check.status === "fail").length,
      unknown: checks.filter((check) => check.status === "unknown").length,
      notApplicable: checks.filter((check) => check.status === "not_applicable").length
    },
    groups
  };
}

export function unavailableVisualQuality(input: {
  observedAt: string;
  limitation: string;
  screenshotSetHash?: `sha256:${string}`;
  checks?: VisualQualityCheckInput[];
}): VisualQuality {
  return buildVisualQuality({
    observedAt: input.observedAt,
    limitations: [input.limitation],
    checks: input.checks ?? [],
    evaluator: {
      identity: currentVisualQualityEvaluatorIdentity(),
      status: "unavailable",
      provider: "openai",
      modelId: configuredVisualQualityModelId(),
      promptIdentity: visualQualityPromptIdentity,
      screenshotSetHash: input.screenshotSetHash ?? sha256(""),
      generatedAt: input.observedAt,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      estimatedCostUsd: 0
    }
  });
}

export function visualQualityDefinition(id: string) {
  const value = visualQualityCheckDefinitions.find((check) => check.id === id);
  if (!value) throw new Error(`Unknown Visual Quality check: ${id}`);
  return value;
}

export function visualEvidence(input: {
  id: string;
  summary: string;
  observedAt: string;
  route?: string;
  viewport?: "desktop" | "tablet" | "mobile";
  artifactKey?: string;
  sourceUrl?: string;
}): AssessmentEvidence {
  return {
    id: input.id,
    kind: input.artifactKey ? "screenshot" : "system",
    summary: input.summary,
    observedAt: input.observedAt,
    route: input.route,
    viewport: input.viewport,
    artifactKey: input.artifactKey,
    sourceUrl: input.sourceUrl
  };
}

function definition(
  id: string,
  groupId: VisualQualityGroupId,
  title: string,
  impact: VisualQualityCheckDefinition["impact"],
  businessConsequence: string,
  recommendation: string,
  applicability: AssessmentApplicability = "universal"
): VisualQualityCheckDefinition {
  return { id, groupId, title, impact, applicability, businessConsequence, recommendation };
}

function unknownCheck(definitionValue: VisualQualityCheckDefinition, observedAt: string): VisualQualityCheck {
  return {
    ...definitionValue,
    status: "unknown",
    certainty: "inferred",
    explanation: "The available screenshots did not support a reliable visual-quality conclusion.",
    evidence: [visualEvidence({
      id: `${definitionValue.id}.coverage`,
      summary: "No validated screenshot-grounded result was available for this check.",
      observedAt
    })]
  };
}

function contentIdentity(prefix: string, value: unknown) {
  return `${prefix}@sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}` as `${string}@sha256:${string}`;
}

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
