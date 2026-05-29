import { z } from "zod";
import type { SiteBundle } from "./models";
import type { CrawlAssessment } from "./crawler";
import type { RenderInspectionResult } from "./models";
import type { GenerationPlanningOverride } from "./generation-planning";

type OpenAiGenerationInput = {
  bundle: SiteBundle;
  sourceUrl?: string;
  prompt?: string;
  crawl?: CrawlAssessment;
  renderInspection?: RenderInspectionResult;
};

const sectionTypes = [
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
] as const;

const strategyValues = ["modernized_brand", "conversion_optimized", "premium_redesign"] as const;
const themeValues = ["warm", "premium", "bold", "clinical"] as const;

const aiPlanningSchema = z.object({
  brandAssessment: z.object({
    confidence: z.number().min(0.1).max(0.98),
    cues: z.array(z.string()).min(1).max(10),
    colorSignals: z.array(z.string()).min(1).max(8),
    typographySignals: z.array(z.string()).min(1).max(8),
    imageStyleSignals: z.array(z.string()).min(1).max(8),
    toneSignals: z.array(z.string()).min(1).max(8),
    preservationRules: z.array(z.string()).min(1).max(8),
    sourceNotes: z.array(z.string()).min(1).max(8)
  }),
  designDirections: z.array(
    z.object({
      strategy: z.enum(strategyValues),
      label: z.string().min(1).max(80),
      rationale: z.string().min(1).max(420),
      themePreset: z.enum(themeValues),
      sectionEmphasis: z.array(z.enum(sectionTypes)).min(3).max(8),
      mockupPrompt: z.string().min(1).max(900),
      generationRules: z.array(z.string()).min(1).max(8),
      riskNotes: z.array(z.string()).min(1).max(6)
    })
  ).length(3),
  selectedStrategy: z.enum(strategyValues),
  qualitySummary: z.string().min(1).max(320)
});

export async function createOpenAiGenerationPlanning(
  input: OpenAiGenerationInput
): Promise<GenerationPlanningOverride | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;

  const body = {
    model: process.env.OPENAI_GENERATION_MODEL ?? "gpt-5.5",
    reasoning: { effort: "low" },
    max_output_tokens: 3200,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You generate SMB website planning data for Lodesta.",
              "Return only schema-valid JSON through Structured Outputs.",
              "Use source facts and measured findings, but do not copy existing marketing copy.",
              "Treat scraped assets as reference-only before claim.",
              "Do not invent credentials, offers, prices, years in business, reviews, awards, or legal/medical claims.",
              "Every direction must be compilable into structured website sections and reversible owner-approved drafts."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(makePlanningContext(input))
          }
        ]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_generation_planning",
        strict: true,
        schema: responseJsonSchema
      }
    }
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload) ?? `OpenAI generation planning failed with status ${response.status}`);
    }

    const text = extractResponseText(payload);
    if (!text) throw new Error("OpenAI generation planning response did not include output text.");
    const parsedJson = JSON.parse(text) as unknown;
    const parsed = aiPlanningSchema.parse(parsedJson);
    return {
      source: "openai",
      ...parsed
    };
  } catch (error) {
    console.warn(
      `OpenAI generation planning unavailable; using deterministic fallback. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

function makePlanningContext({ bundle, sourceUrl, prompt, crawl, renderInspection }: OpenAiGenerationInput) {
  const business = bundle.businessProfile;
  const currentEvaluation = bundle.presenceAssessment.standardEvaluation;
  return {
    productContract: {
      market: "US SMB launch",
      renderer: "structured multi-tenant Next.js renderer",
      customerEditing: "curated controls only",
      legalBoundary: "pre-claim previews use facts and licensed/generated/placeholders, not copied photos/logos/copy"
    },
    sourceUrl,
    prompt,
    business: {
      name: business.name,
      vertical: business.vertical,
      categories: business.categories,
      description: business.description,
      services: business.services,
      serviceAreas: business.serviceAreas,
      hasPhone: Boolean(business.phone),
      hasEmail: Boolean(business.email),
      hasAddress: Boolean(business.address),
      reviewsSummary: business.reviewsSummary
    },
    currentSite: {
      title: crawl?.title,
      metaDescription: crawl?.metaDescription,
      findings: crawl?.findings.slice(0, 8),
      score: crawl?.score,
      extractedFacts: crawl?.extractedFacts,
      assetReferences: crawl?.assetReferences.slice(0, 8).map((asset) => ({
        kind: asset.kind,
        alt: asset.alt,
        rightsStatus: asset.rightsStatus
      })),
      standardFailures: currentEvaluation?.checks
        .filter((check) => !check.passed)
        .slice(0, 8)
        .map((check) => ({
          title: check.title,
          layer: check.layer,
          checkMethod: check.checkMethod,
          consequence: check.businessConsequence
        }))
    },
    renderInspection: renderInspection
      ? {
          adapter: renderInspection.adapter,
          metrics: renderInspection.metrics,
          findings: renderInspection.findings.slice(0, 8)
        }
      : undefined,
    deterministicBaseline: {
      designDirections: bundle.presenceAssessment.designDirections?.map((direction) => ({
        strategy: direction.strategy,
        label: direction.label,
        themePreset: direction.themePreset,
        sectionEmphasis: direction.sectionEmphasis
      })),
      selectedDirectionId: bundle.presenceAssessment.selectedDesignDirectionId,
      creativeBrief: bundle.presenceAssessment.creativeBrief
    },
    allowedValues: {
      strategies: strategyValues,
      themePresets: themeValues,
      sectionTypes
    }
  };
}

function extractResponseText(payload: unknown) {
  if (isRecord(payload) && typeof payload.output_text === "string") return payload.output_text;
  if (!isRecord(payload) || !Array.isArray(payload.output)) return undefined;
  const parts: string[] = [];
  for (const output of payload.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    for (const item of output.content) {
      if (!isRecord(item)) continue;
      if (item.type === "refusal" && typeof item.refusal === "string") {
        throw new Error(`OpenAI generation planning refused: ${item.refusal}`);
      }
      if (typeof item.parsed === "object" && item.parsed) return JSON.stringify(item.parsed);
      if (typeof item.text === "string") parts.push(item.text);
    }
  }
  return parts.join("").trim() || undefined;
}

function openAiErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  return typeof payload.error.message === "string" ? payload.error.message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["brandAssessment", "designDirections", "selectedStrategy", "qualitySummary"],
  properties: {
    brandAssessment: {
      type: "object",
      additionalProperties: false,
      required: [
        "confidence",
        "cues",
        "colorSignals",
        "typographySignals",
        "imageStyleSignals",
        "toneSignals",
        "preservationRules",
        "sourceNotes"
      ],
      properties: {
        confidence: { type: "number", minimum: 0.1, maximum: 0.98 },
        cues: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
        colorSignals: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
        typographySignals: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
        imageStyleSignals: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
        toneSignals: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
        preservationRules: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
        sourceNotes: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } }
      }
    },
    designDirections: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "strategy",
          "label",
          "rationale",
          "themePreset",
          "sectionEmphasis",
          "mockupPrompt",
          "generationRules",
          "riskNotes"
        ],
        properties: {
          strategy: { type: "string", enum: strategyValues },
          label: { type: "string", minLength: 1, maxLength: 80 },
          rationale: { type: "string", minLength: 1, maxLength: 420 },
          themePreset: { type: "string", enum: themeValues },
          sectionEmphasis: {
            type: "array",
            minItems: 3,
            maxItems: 8,
            items: { type: "string", enum: sectionTypes }
          },
          mockupPrompt: { type: "string", minLength: 1, maxLength: 900 },
          generationRules: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
          riskNotes: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } }
        }
      }
    },
    selectedStrategy: { type: "string", enum: strategyValues },
    qualitySummary: { type: "string", minLength: 1, maxLength: 320 }
  }
};
