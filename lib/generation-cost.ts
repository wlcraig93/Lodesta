import type { CrawlAssessment } from "./crawler";
import type {
  CreativeMockupArtifact,
  GenerationCostBudgetMode,
  GenerationCostEstimate,
  GenerationCostGateState,
  GenerationCostLineItem,
  RenderInspectionResult,
  VisualQaResult
} from "./models";
import type { PublicPresenceEnrichment } from "./public-presence";

export type GenerationCostPlanInput = {
  mode?: GenerationCostBudgetMode;
  sourceUrl?: string;
  crawl?: CrawlAssessment;
  sourceRenderInspection?: RenderInspectionResult;
  generatedRenderInspection?: RenderInspectionResult;
  publicPresence?: PublicPresenceEnrichment;
  aiPlanningAttempted?: boolean;
  plannedMockupImageCount?: number;
  mockupArtifacts?: CreativeMockupArtifact[];
  sourceModelVisualQaRequested?: boolean;
  generatedModelVisualQaRequested?: boolean;
  includeGeneratedRenderQa?: boolean;
  computedAt?: string;
};

const policyVersion = "generation-cost-v1" as const;

const unitWeights = {
  urlSafety: 1,
  crawlPage: 1,
  sourceRenderInspection: 2,
  placesLookup: 3,
  aiPlanning: 8,
  mockupPrompt: 1,
  mockupImage: 12,
  deterministicVisualQa: 1,
  sourceModelVisualQa: 8,
  generatedRenderQa: 2,
  generatedModelVisualQa: 10
} as const;

const budgetUnits: Record<GenerationCostBudgetMode, number> = {
  normal_generation: 88,
  operator_premium_generation: 140
};

export function planGenerationCost(input: GenerationCostPlanInput): GenerationCostEstimate {
  const mode = input.mode ?? "normal_generation";
  const computedAt = input.computedAt ?? new Date().toISOString();
  const plannedMockupImageCount = input.mockupArtifacts
    ? input.mockupArtifacts.filter((artifact) => artifact.status === "generated").length
    : input.plannedMockupImageCount ?? 0;
  const mockupPromptCount = input.mockupArtifacts?.length ?? plannedMockupImageCount;
  const sourceModelRequested = Boolean(input.sourceModelVisualQaRequested);
  const generatedModelRequested = Boolean(input.generatedModelVisualQaRequested);

  let mockupImageGeneration: GenerationCostGateState = plannedMockupImageCount > 0 ? "allowed" : "skipped";
  let sourceModelVisualQa: GenerationCostGateState = sourceModelRequested ? "allowed" : "skipped";
  let generatedModelVisualQa: GenerationCostGateState = generatedModelRequested ? "allowed" : "skipped";
  const reasons: string[] = [];

  let estimate = buildEstimate({
    ...input,
    mode,
    computedAt,
    plannedMockupImageCount,
    mockupPromptCount,
    gates: { mockupImageGeneration, sourceModelVisualQa, generatedModelVisualQa },
    reasons
  });

  if (estimate.estimatedUnits > estimate.budgetUnits && mockupImageGeneration === "allowed") {
    mockupImageGeneration = "skipped";
    reasons.push("Mockup image generation was skipped to reserve budget for generated-site QA.");
    estimate = buildEstimate({
      ...input,
      mode,
      computedAt,
      plannedMockupImageCount,
      mockupPromptCount,
      gates: { mockupImageGeneration, sourceModelVisualQa, generatedModelVisualQa },
      reasons
    });
  }

  if (estimate.estimatedUnits > estimate.budgetUnits && sourceModelVisualQa === "allowed") {
    sourceModelVisualQa = "skipped";
    reasons.push("Source-site model visual QA was skipped to prioritize the final generated-site QA pass.");
    estimate = buildEstimate({
      ...input,
      mode,
      computedAt,
      plannedMockupImageCount,
      mockupPromptCount,
      gates: { mockupImageGeneration, sourceModelVisualQa, generatedModelVisualQa },
      reasons
    });
  }

  if (estimate.estimatedUnits > estimate.budgetUnits && generatedModelVisualQa === "allowed") {
    generatedModelVisualQa = "skipped";
    reasons.push("Generated-site model visual QA was skipped because the generation exceeded the configured unit budget.");
    estimate = buildEstimate({
      ...input,
      mode,
      computedAt,
      plannedMockupImageCount,
      mockupPromptCount,
      gates: { mockupImageGeneration, sourceModelVisualQa, generatedModelVisualQa },
      reasons
    });
  }

  return estimate;
}

export function finalizeGenerationCostEstimate(input: {
  previous?: GenerationCostEstimate;
  generatedRenderInspection?: RenderInspectionResult;
  generatedVisualQa?: VisualQaResult;
  computedAt?: string;
}): GenerationCostEstimate {
  const previous = input.previous;
  const computedAt = input.computedAt ?? new Date().toISOString();
  const retained =
    previous?.lineItems.filter((item) => item.id !== "generated_render_qa" && item.id !== "generated_model_visual_qa") ?? [];
  const gates = previous?.gates ?? {
    generatedRenderQa: "required" as const,
    deterministicVisualQa: "required" as const,
    sourceModelVisualQa: "skipped" as const,
    generatedModelVisualQa: "allowed" as const,
    mockupImageGeneration: "skipped" as const
  };
  const lineItems = [
    ...retained,
    lineItem({
      id: "generated_render_qa",
      label: "Generated-site browser render QA",
      quantity: generatedRenderInspectionCount(input.generatedRenderInspection),
      unitWeight: unitWeights.generatedRenderQa,
      required: true
    }),
    ...(input.generatedVisualQa?.source === "openai" || gates.generatedModelVisualQa === "allowed"
      ? [
          lineItem({
            id: "generated_model_visual_qa",
            label: "Final generated-site model visual QA",
            quantity: 1,
            unitWeight: unitWeights.generatedModelVisualQa,
            required: false
          })
        ]
      : [])
  ];
  const estimatedUnits = totalUnits(lineItems);
  const budget = previous?.budgetUnits ?? budgetUnits.normal_generation;
  return {
    id: previous?.id ?? `cost_${crypto.randomUUID().replace(/-/g, "")}`,
    policyVersion,
    mode: previous?.mode ?? "normal_generation",
    status: estimatedUnits <= budget ? "within_budget" : "over_budget",
    estimatedUnits,
    budgetUnits: budget,
    computedAt,
    lineItems,
    gates,
    minimums: minimums(),
    reasons: previous?.reasons ?? []
  };
}

export function isModelVisualQaAllowed(
  estimate: GenerationCostEstimate | undefined,
  target: "source_site" | "generated_site"
) {
  if (!estimate) return true;
  return target === "source_site"
    ? estimate.gates.sourceModelVisualQa === "allowed"
    : estimate.gates.generatedModelVisualQa === "allowed";
}

export function isMockupImageGenerationAllowed(estimate: GenerationCostEstimate | undefined) {
  return estimate?.gates.mockupImageGeneration === "allowed";
}

function buildEstimate(
  input: GenerationCostPlanInput & {
    mode: GenerationCostBudgetMode;
    computedAt: string;
    plannedMockupImageCount: number;
    mockupPromptCount: number;
    gates: {
      mockupImageGeneration: GenerationCostGateState;
      sourceModelVisualQa: GenerationCostGateState;
      generatedModelVisualQa: GenerationCostGateState;
    };
    reasons: string[];
  }
): GenerationCostEstimate {
  const lineItems = baseLineItems(input);
  const estimatedUnits = totalUnits(lineItems);
  const budget = budgetUnits[input.mode];
  return {
    id: `cost_${crypto.randomUUID().replace(/-/g, "")}`,
    policyVersion,
    mode: input.mode,
    status: estimatedUnits <= budget ? "within_budget" : "over_budget",
    estimatedUnits,
    budgetUnits: budget,
    computedAt: input.computedAt,
    lineItems,
    gates: {
      generatedRenderQa: "required",
      deterministicVisualQa: "required",
      sourceModelVisualQa: input.gates.sourceModelVisualQa,
      generatedModelVisualQa: input.gates.generatedModelVisualQa,
      mockupImageGeneration: input.gates.mockupImageGeneration
    },
    minimums: minimums(),
    reasons: input.reasons
  };
}

function baseLineItems(
  input: GenerationCostPlanInput & {
    plannedMockupImageCount: number;
    mockupPromptCount: number;
    gates: {
      mockupImageGeneration: GenerationCostGateState;
      sourceModelVisualQa: GenerationCostGateState;
      generatedModelVisualQa: GenerationCostGateState;
    };
  }
) {
  const items: GenerationCostLineItem[] = [];
  if (input.sourceUrl) {
    items.push(
      lineItem({
        id: "url_safety",
        label: "URL safety and launch-market checks",
        quantity: 1,
        unitWeight: unitWeights.urlSafety,
        required: true
      })
    );
  }
  const crawlPages = crawlPageCount(input.crawl);
  if (crawlPages > 0) {
    items.push(
      lineItem({
        id: "source_crawl_pages",
        label: "Source website crawl pages",
        quantity: crawlPages,
        unitWeight: unitWeights.crawlPage,
        required: true
      })
    );
  }
  const sourceInspectionCount = renderInspectionCount(input.sourceRenderInspection);
  if (sourceInspectionCount > 0) {
    items.push(
      lineItem({
        id: "source_render_inspection",
        label: "Source-site render inspection",
        quantity: sourceInspectionCount,
        unitWeight: unitWeights.sourceRenderInspection,
        required: false
      })
    );
  }
  if (input.publicPresence) {
    items.push(
      lineItem({
        id: "places_lookup",
        label: "Google Places enrichment lookup",
        quantity: 1,
        unitWeight: unitWeights.placesLookup,
        required: false
      })
    );
  }
  if (input.aiPlanningAttempted) {
    items.push(
      lineItem({
        id: "ai_generation_planning",
        label: "AI generation planning",
        quantity: 1,
        unitWeight: unitWeights.aiPlanning,
        required: false
      })
    );
  }
  if (input.mockupPromptCount > 0) {
    items.push(
      lineItem({
        id: "mockup_prompts",
        label: "Creative mockup prompts",
        quantity: input.mockupPromptCount,
        unitWeight: unitWeights.mockupPrompt,
        required: false
      })
    );
  }
  if (input.gates.mockupImageGeneration === "allowed" && input.plannedMockupImageCount > 0) {
    items.push(
      lineItem({
        id: "mockup_images",
        label: "Generated creative mockup images",
        quantity: input.plannedMockupImageCount,
        unitWeight: unitWeights.mockupImage,
        required: false
      })
    );
  }
  items.push(
    lineItem({
      id: "deterministic_visual_qa",
      label: "Deterministic visual QA",
      quantity: 1,
      unitWeight: unitWeights.deterministicVisualQa,
      required: true
    })
  );
  if (input.gates.sourceModelVisualQa === "allowed") {
    items.push(
      lineItem({
        id: "source_model_visual_qa",
        label: "Source-site model visual QA",
        quantity: 1,
        unitWeight: unitWeights.sourceModelVisualQa,
        required: false
      })
    );
  }
  if (input.includeGeneratedRenderQa !== false) {
    items.push(
      lineItem({
        id: "generated_render_qa",
        label: "Generated-site browser render QA",
        quantity: generatedRenderInspectionCount(input.generatedRenderInspection),
        unitWeight: unitWeights.generatedRenderQa,
        required: true
      })
    );
  }
  if (input.gates.generatedModelVisualQa === "allowed") {
    items.push(
      lineItem({
        id: "generated_model_visual_qa",
        label: "Final generated-site model visual QA",
        quantity: 1,
        unitWeight: unitWeights.generatedModelVisualQa,
        required: false
      })
    );
  }
  return items;
}

function lineItem(input: Omit<GenerationCostLineItem, "units">): GenerationCostLineItem {
  return {
    ...input,
    units: input.quantity * input.unitWeight
  };
}

function crawlPageCount(crawl: CrawlAssessment | undefined) {
  if (!crawl) return 0;
  if (!crawl.fetched) return 1;
  return Math.max(1, crawl.pageSummaries.length || crawl.sampledInternalPages.length || 1);
}

function renderInspectionCount(inspection: RenderInspectionResult | undefined) {
  if (!inspection) return 0;
  return Math.max(1, inspection.screenshots.length || 1);
}

function generatedRenderInspectionCount(inspection: RenderInspectionResult | undefined) {
  if (!inspection) return 2;
  return Math.max(1, inspection.screenshots.length || 1);
}

function totalUnits(lineItems: GenerationCostLineItem[]) {
  return lineItems.reduce((total, item) => total + item.units, 0);
}

function minimums(): GenerationCostEstimate["minimums"] {
  return {
    generatedRenderQa: "required_before_ready",
    deterministicVisualQa: "required_for_every_generation",
    modelVisualQa: "run_for_final_generated_site_when_budget_credentials_and_screenshots_allow"
  };
}
