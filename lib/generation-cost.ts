import type { CrawlAssessment } from "./crawler";
import type {
  GenerationCostBudgetMode,
  GenerationCostEstimate,
  GenerationCostLineItem,
  RenderInspectionResult
} from "./models";
import type { PublicPresenceEnrichment } from "./public-presence";

export type GenerationCostPlanInput = {
  mode?: GenerationCostBudgetMode;
  sourceUrl?: string;
  crawl?: CrawlAssessment;
  sourceRenderInspection?: RenderInspectionResult;
  generatedRenderInspection?: RenderInspectionResult;
  publicPresence?: PublicPresenceEnrichment;
  includeGeneratedRenderQa?: boolean;
  computedAt?: string;
};

const policyVersion = "generation-cost-v1" as const;
const unitWeights = {
  urlSafety: 1,
  crawlPage: 1,
  sourceRenderInspection: 2,
  placesLookup: 3,
  generatedRenderQa: 2,
  visualJudgment: 10
} as const;

const budgetUnits: Record<GenerationCostBudgetMode, number> = {
  normal_generation: 88,
  operator_premium_generation: 140
};

export function planGenerationCost(input: GenerationCostPlanInput): GenerationCostEstimate {
  const mode = input.mode ?? "normal_generation";
  const lineItems = baseLineItems(input);
  const estimatedUnits = totalUnits(lineItems);
  const budget = budgetUnits[mode];
  return {
    id: `cost_${crypto.randomUUID().replace(/-/g, "")}`,
    policyVersion,
    mode,
    status: estimatedUnits <= budget ? "within_budget" : "over_budget",
    estimatedUnits,
    budgetUnits: budget,
    computedAt: input.computedAt ?? new Date().toISOString(),
    lineItems,
    gates: requiredGates(),
    minimums: minimums(),
    reasons: []
  };
}

export function finalizeGenerationCostEstimate(input: {
  previous?: GenerationCostEstimate;
  generatedRenderInspection?: RenderInspectionResult;
  computedAt?: string;
}): GenerationCostEstimate {
  const previous = input.previous;
  const retainedIds = new Set(["url_safety", "source_crawl_pages", "source_render_inspection", "places_lookup"]);
  const lineItems = [
    ...(previous?.lineItems.filter((item) => retainedIds.has(item.id)) ?? []),
    lineItem({
      id: "generated_render_qa",
      label: "Generated-site browser render QA",
      quantity: generatedRenderInspectionCount(input.generatedRenderInspection),
      unitWeight: unitWeights.generatedRenderQa,
      required: true
    }),
    lineItem({
      id: "generated_visual_judgment",
      label: "Final generated-site visual judgment",
      quantity: 1,
      unitWeight: unitWeights.visualJudgment,
      required: true
    })
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
    computedAt: input.computedAt ?? new Date().toISOString(),
    lineItems,
    gates: requiredGates(),
    minimums: minimums(),
    reasons: previous?.reasons ?? []
  };
}

export function isMockupImageGenerationAllowed(estimate: GenerationCostEstimate | undefined) {
  return false;
}

function baseLineItems(input: GenerationCostPlanInput) {
  const items: GenerationCostLineItem[] = [];
  if (input.sourceUrl) {
    items.push(lineItem({ id: "url_safety", label: "URL safety and launch-market checks", quantity: 1, unitWeight: unitWeights.urlSafety, required: true }));
  }
  const crawlPages = crawlPageCount(input.crawl);
  if (crawlPages > 0) {
    items.push(lineItem({ id: "source_crawl_pages", label: "Source website crawl pages", quantity: crawlPages, unitWeight: unitWeights.crawlPage, required: true }));
  }
  const sourceInspectionCount = renderInspectionCount(input.sourceRenderInspection);
  if (sourceInspectionCount > 0) {
    items.push(lineItem({ id: "source_render_inspection", label: "Source-site render inspection", quantity: sourceInspectionCount, unitWeight: unitWeights.sourceRenderInspection, required: false }));
  }
  if (input.publicPresence) {
    items.push(lineItem({ id: "places_lookup", label: "Google Places enrichment lookup", quantity: 1, unitWeight: unitWeights.placesLookup, required: false }));
  }
  if (input.includeGeneratedRenderQa !== false) {
    items.push(
      lineItem({
        id: "generated_render_qa",
        label: "Generated-site browser render QA",
        quantity: generatedRenderInspectionCount(input.generatedRenderInspection),
        unitWeight: unitWeights.generatedRenderQa,
        required: true
      }),
      lineItem({
        id: "generated_visual_judgment",
        label: "Final generated-site visual judgment",
        quantity: 1,
        unitWeight: unitWeights.visualJudgment,
        required: true
      })
    );
  }
  return items;
}

function requiredGates(): GenerationCostEstimate["gates"] {
  return {
    generatedRenderQa: "required",
    visualJudgment: "required",
    mockupImageGeneration: "skipped"
  };
}

function minimums(): GenerationCostEstimate["minimums"] {
  return {
    generatedRenderQa: "required_before_ready",
    visualJudgment: "required_before_ready"
  };
}

function lineItem(input: Omit<GenerationCostLineItem, "units">): GenerationCostLineItem {
  return { ...input, units: input.quantity * input.unitWeight };
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
