import type {
  BrandAssessment,
  BusinessProfile,
  DesignDirection,
  PresenceQualityScore,
  RenderInspectionResult,
  SectionType,
  StandardEvaluation
} from "./models";
import type { CrawlAssessment } from "./crawler";
import type { VerticalRecipe } from "./recipes";
import { coldUrlCheckableChecks } from "./standard-evaluation";

type GenerationPlanningInput = {
  business: BusinessProfile;
  recipe: VerticalRecipe;
  crawl?: CrawlAssessment;
  renderInspection?: RenderInspectionResult;
  currentEvaluation?: StandardEvaluation;
  generatedEvaluation?: StandardEvaluation;
  aiPlanning?: GenerationPlanningOverride;
};

export type GenerationPlanningOverride = {
  source: "openai";
  brandAssessment?: {
    confidence?: number;
    cues?: string[];
    colorSignals?: string[];
    typographySignals?: string[];
    imageStyleSignals?: string[];
    toneSignals?: string[];
    preservationRules?: string[];
    sourceNotes?: string[];
  };
  designDirections?: Array<{
    strategy: DesignDirection["strategy"];
    label?: string;
    rationale?: string;
    themePreset?: DesignDirection["themePreset"];
    sectionEmphasis?: SectionType[];
    mockupPrompt?: string;
    generationRules?: string[];
    riskNotes?: string[];
  }>;
  selectedStrategy?: DesignDirection["strategy"];
  qualitySummary?: string;
};

export function createBrandAssessment({
  business,
  recipe,
  crawl,
  renderInspection,
  aiPlanning
}: GenerationPlanningInput): BrandAssessment {
  const aiBrand = aiPlanning?.brandAssessment;
  const sourceNotes = [
    crawl?.title ? `Title observed: ${crawl.title}` : undefined,
    crawl?.metaDescription ? "Meta description was available as positioning reference." : undefined,
    crawl?.assetReferences.some((asset) => asset.kind === "logo") ? "Logo detected as public source material for internal preview planning." : undefined,
    crawl?.assetReferences.some((asset) => asset.kind === "image") ? "Website imagery detected as public source material for internal preview planning." : undefined,
    renderInspection ? `Render inspection adapter: ${renderInspection.adapter}.` : undefined,
    aiPlanning ? "OpenAI structured generation planning was applied." : undefined
  ].filter((item): item is string => Boolean(item));

  const cues = unique([
    business.name,
    business.categories[0],
    business.address?.city,
    business.serviceAreas[0],
    business.reviewsSummary?.rating ? `${business.reviewsSummary.rating} rating signal` : undefined,
    recipe.label
  ]);

  const confidenceSignals = [
    crawl?.extractedFacts.name,
    crawl?.extractedFacts.phone,
    crawl?.extractedFacts.address?.city,
    crawl?.assetReferences.length ? "assets" : undefined,
    renderInspection?.metrics.bodyTextChars && renderInspection.metrics.bodyTextChars > 250 ? "rendered text" : undefined
  ].filter(Boolean).length;

  return {
    id: `brand_${business.siteId}`,
    siteId: business.siteId,
    confidence: clampConfidence(aiBrand?.confidence ?? Math.min(0.92, 0.45 + confidenceSignals * 0.1)),
    cues: boundedStrings(aiBrand?.cues, 10, cues.length ? cues : [business.name]),
    colorSignals: boundedStrings(aiBrand?.colorSignals, 8, colorSignalsForMood(recipe.mood)),
    typographySignals: boundedStrings(aiBrand?.typographySignals, 8, typographySignalsForVertical(business.vertical)),
    imageStyleSignals: boundedStrings(aiBrand?.imageStyleSignals, 8, imageSignalsForVertical(business.vertical)),
    toneSignals: boundedStrings(aiBrand?.toneSignals, 8, toneSignalsForVertical(business.vertical)),
    preservationRules: boundedStrings(aiBrand?.preservationRules, 8, [
      "Preserve business name, category, and owner-verified facts exactly.",
      "Use existing website visuals only as brand references before claim.",
      "Avoid copying current-site marketing language; rewrite from structured facts.",
      "Keep claims, credentials, prices, offers, and owner story approval-gated."
    ]),
    sourceNotes: boundedStrings(aiBrand?.sourceNotes, 8, sourceNotes.length ? sourceNotes : ["Prompt-only brand assessment; owner verification required."])
  };
}

export function createDesignDirections({
  business,
  recipe,
  crawl,
  renderInspection,
  currentEvaluation,
  aiPlanning
}: GenerationPlanningInput): DesignDirection[] {
  const weakChecks = currentEvaluation?.checks.filter((check) => !check.passed).slice(0, 4) ?? [];
  const renderWarnings = renderInspection?.findings.filter((finding) => finding.severity !== "pass").slice(0, 4) ?? [];
  const selectedStrategy =
    aiPlanning?.selectedStrategy ?? selectDirectionStrategy(business, recipe, crawl, renderInspection, currentEvaluation);
  const baseRules = [
    "Compile the chosen direction into structured sections; never treat the mockup as source-of-truth UI.",
    "Use public source imagery, generated imagery, licensed imagery, or placeholders with provenance.",
    "Keep owner-truth fields pinned or verification-gated.",
    "Retain mobile-first CTA hierarchy and local SEO structure."
  ];

  const directions: DesignDirection[] = [
    {
      id: `direction_modernized_${business.siteId}`,
      siteId: business.siteId,
      strategy: "modernized_brand",
      label: "Modernized brand",
      rationale: "Preserve recognizable local cues while improving hierarchy, accessibility, and trust placement.",
      themePreset: presetForModernizedBrand(recipe),
      sectionEmphasis: sectionEmphasisForStrategy("modernized_brand", recipe.defaultSections),
      mockupPrompt: [
        `Create a modernized brand mockup for ${business.name}, a ${recipe.label}.`,
        `Keep category and local cues visible while improving typography, spacing, CTA prominence, and trust proof.`,
        weakChecks.length ? `Address measured issues: ${weakChecks.map((check) => check.title).join("; ")}.` : ""
      ].filter(Boolean).join(" "),
      generationRules: [
        ...baseRules,
        "Prioritize recognizable category cues and local trust over dramatic repositioning."
      ],
      riskNotes: ["May underperform if the existing brand is too weak to preserve."],
      selected: selectedStrategy === "modernized_brand"
    },
    {
      id: `direction_conversion_${business.siteId}`,
      siteId: business.siteId,
      strategy: "conversion_optimized",
      label: "Conversion-optimized",
      rationale: "Move the primary action, proof, and service clarity into the shortest path from landing to lead.",
      themePreset: "bold",
      sectionEmphasis: sectionEmphasisForStrategy("conversion_optimized", recipe.defaultSections),
      mockupPrompt: [
        `Create a conversion-optimized website mockup for ${business.name}.`,
        `The first viewport must make the ${recipe.primaryGoal.replace("_", " ")} path unmistakable on mobile and desktop.`,
        renderWarnings.length ? `Resolve render risks: ${renderWarnings.map((finding) => finding.title).join("; ")}.` : ""
      ].filter(Boolean).join(" "),
      generationRules: [
        ...baseRules,
        "Place primary CTA in hero, repeat after proof, and keep contact/form path visible.",
        "Use proof before the contact section and avoid decorative sections that slow conversion."
      ],
      riskNotes: ["More assertive CTA treatment should avoid changing offers or claims."],
      selected: selectedStrategy === "conversion_optimized"
    },
    {
      id: `direction_premium_${business.siteId}`,
      siteId: business.siteId,
      strategy: "premium_redesign",
      label: "Premium redesign",
      rationale: "Create a more polished and higher-trust experience for businesses where visual credibility drives action.",
      themePreset: presetForPremiumDirection(business.vertical),
      sectionEmphasis: sectionEmphasisForStrategy("premium_redesign", recipe.defaultSections),
      mockupPrompt: [
        `Create a premium redesign mockup for ${business.name}, a ${recipe.label}.`,
        "Use refined typography, strong proof sections, careful whitespace, and owner-verifiable trust cues.",
        "Avoid unsupported claims, private credentials, and exaggerated luxury positioning."
      ].join(" "),
      generationRules: [
        ...baseRules,
        "Lean on proof, credentials, gallery, team, or results only when those fields are owner-verifiable."
      ],
      riskNotes: ["Premium direction needs especially careful asset rights and claim verification."],
      selected: selectedStrategy === "premium_redesign"
    }
  ];

  return directions.map((direction) => mergeAiDirection(direction, aiPlanning));
}

export function createPresenceQualityScore({
  business,
  currentEvaluation,
  generatedEvaluation,
  aiPlanning
}: GenerationPlanningInput): PresenceQualityScore {
  const measuredChecks = coldUrlCheckableChecks(currentEvaluation?.checks ?? []);
  const coldUrlCheckableFailures = measuredChecks.filter((check) => !check.passed).map((check) => check.title);
  const delta = currentEvaluation && generatedEvaluation
    ? generatedEvaluation.score.percent - currentEvaluation.score.percent
    : undefined;

  return {
    siteId: business.siteId,
    current: currentEvaluation?.score,
    generated: generatedEvaluation?.score,
    measuredCriteria: measuredChecks.length,
    generatedCriteria: generatedEvaluation?.checks.length ?? 0,
    coldUrlCheckableFailures,
    summary: aiPlanning?.qualitySummary ?? (
      delta === undefined
        ? "Generated draft is scored from structured site criteria; no current-site score is attached yet."
        : `Generated draft scores ${delta >= 0 ? "+" : ""}${delta} points versus the imported current-site baseline.`
    )
  };
}

export function selectedDesignDirection(directions: DesignDirection[]) {
  return directions.find((direction) => direction.selected) ?? directions[0];
}

function selectDirectionStrategy(
  business: BusinessProfile,
  recipe: VerticalRecipe,
  crawl?: CrawlAssessment,
  renderInspection?: RenderInspectionResult,
  currentEvaluation?: StandardEvaluation
): DesignDirection["strategy"] {
  const score = currentEvaluation?.score.percent ?? crawl?.score.percent;
  const conversionRisk =
    currentEvaluation?.checks.some((check) => !check.passed && check.layer === "conversion") ||
    renderInspection?.findings.some((finding) => finding.severity === "fail" && /cta|form|call/i.test(finding.title));
  if (conversionRisk || (score !== undefined && score < 65)) return "conversion_optimized";

  if (
    recipe.mood === "premium" ||
    recipe.mood === "clinical" ||
    ["beauty_salon", "med_spa", "dental", "real_estate", "creative_studio"].includes(business.vertical)
  ) {
    return "premium_redesign";
  }

  return "modernized_brand";
}

function presetForModernizedBrand(recipe: VerticalRecipe): DesignDirection["themePreset"] {
  if (recipe.mood === "clinical") return "clinical";
  if (recipe.mood === "premium" || recipe.mood === "editorial") return "premium";
  if (recipe.mood === "bold" || recipe.primaryGoal === "calls") return "bold";
  return "warm";
}

function presetForPremiumDirection(vertical: BusinessProfile["vertical"]): DesignDirection["themePreset"] {
  if (vertical === "dental" || vertical === "med_spa") return "clinical";
  return "premium";
}

function sectionEmphasisForStrategy(
  strategy: DesignDirection["strategy"],
  defaults: SectionType[]
): SectionType[] {
  if (strategy === "conversion_optimized") {
    return prioritize(defaults, ["hero", "trust_bar", "services", "cta", "contact"]);
  }
  if (strategy === "premium_redesign") {
    return prioritize(defaults, ["hero", "gallery", "team", "testimonials", "services", "contact"]);
  }
  return prioritize(defaults, ["hero", "services", "trust_bar", "gallery", "contact"]);
}

function prioritize(defaults: SectionType[], preferred: SectionType[]) {
  return unique([...preferred.filter((type) => defaults.includes(type)), ...defaults]).slice(0, 7);
}

function colorSignalsForMood(mood: VerticalRecipe["mood"]) {
  if (mood === "clinical") return ["cool neutrals", "clear blue/green action color", "high-contrast white surfaces"];
  if (mood === "premium" || mood === "editorial") return ["restrained neutrals", "deep text", "muted metallic accent"];
  if (mood === "bold") return ["high-contrast CTA", "energetic accent", "clean neutral base"];
  if (mood === "utilitarian") return ["service-trust palette", "high contrast", "low-noise surfaces"];
  return ["warm local palette", "friendly accent color", "accessible contrast"];
}

function typographySignalsForVertical(vertical: BusinessProfile["vertical"]) {
  if (vertical === "law_firm") return ["authoritative headings", "dense scannable body copy"];
  if (vertical === "creative_studio") return ["portfolio-forward display type", "minimal body copy"];
  if (vertical === "restaurant") return ["warm display heading", "menu-friendly labels"];
  if (vertical === "home_services" || vertical === "auto_body") return ["plain-spoken headings", "utility-first labels"];
  return ["clear hierarchy", "readable service detail", "compact CTA labels"];
}

function imageSignalsForVertical(vertical: BusinessProfile["vertical"]) {
  if (["beauty_salon", "creative_studio", "landscaping", "restaurant"].includes(vertical)) {
    return ["gallery-forward", "public source asset cues", "owner-approved proof after claim"];
  }
  if (["med_spa", "auto_body"].includes(vertical)) return ["before/after proof after verification", "process visuals"];
  if (vertical === "law_firm") return ["minimal decorative imagery", "team/credential proof after claim"];
  return ["trust-building local imagery", "owner-approved photos after claim"];
}

function toneSignalsForVertical(vertical: BusinessProfile["vertical"]) {
  if (vertical === "law_firm") return ["direct", "credible", "low hype"];
  if (vertical === "home_services") return ["urgent", "practical", "service-area clear"];
  if (vertical === "veterinary" || vertical === "dental") return ["reassuring", "clear", "new-customer friendly"];
  if (vertical === "fitness") return ["energetic", "action-oriented", "trial-focused"];
  return ["local", "plain-spoken", "conversion-focused"];
}

function mergeAiDirection(direction: DesignDirection, aiPlanning?: GenerationPlanningOverride): DesignDirection {
  const aiDirection = aiPlanning?.designDirections?.find((candidate) => candidate.strategy === direction.strategy);
  if (!aiDirection) return direction;
  return {
    ...direction,
    label: boundedString(aiDirection.label, direction.label),
    rationale: boundedString(aiDirection.rationale, direction.rationale),
    themePreset: allowedThemePreset(aiDirection.themePreset) ?? direction.themePreset,
    sectionEmphasis: allowedSectionEmphasis(aiDirection.sectionEmphasis, direction.sectionEmphasis),
    mockupPrompt: boundedString(aiDirection.mockupPrompt, direction.mockupPrompt, 900),
    generationRules: boundedStrings(aiDirection.generationRules, 8, direction.generationRules),
    riskNotes: boundedStrings(aiDirection.riskNotes, 6, direction.riskNotes)
  };
}

function allowedThemePreset(value: unknown): DesignDirection["themePreset"] | undefined {
  return value === "warm" || value === "premium" || value === "bold" || value === "clinical" ? value : undefined;
}

function allowedSectionEmphasis(values: SectionType[] | undefined, fallback: SectionType[]) {
  const allowed = new Set<SectionType>([
    "hero",
    "trust_bar",
    "services",
    "gallery",
    "testimonials",
    "faq",
    "cta",
    "contact",
    "map",
    "menu_deals",
    "team",
    "press_video",
    "before_after"
  ]);
  const cleaned = unique((values ?? []).filter((value) => allowed.has(value)));
  return cleaned.length ? cleaned.slice(0, 8) : fallback;
}

function boundedString(value: string | undefined, fallback: string, maxLength = 420) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function boundedStrings(values: string[] | undefined, maxItems: number, fallback: string[]) {
  const cleaned = unique((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 240));
  return cleaned.length ? cleaned.slice(0, maxItems) : fallback;
}

function clampConfidence(value: number) {
  return Math.max(0.1, Math.min(0.98, Number.isFinite(value) ? value : 0.5));
}

function unique<T>(items: Array<T | undefined>) {
  return Array.from(new Set(items.filter((item): item is T => item !== undefined && item !== "")));
}
