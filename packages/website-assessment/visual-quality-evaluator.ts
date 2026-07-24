import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { usageForModel } from "@/packages/site-agent/run-policy";
import type { VisualQuality, VisualQualityCheckInput } from "./contracts";
import {
  buildVisualQuality,
  configuredVisualQualityModelId,
  currentVisualQualityEvaluatorIdentity,
  unavailableVisualQuality,
  visualEvidence,
  visualQualityCheckDefinitions,
  visualQualityOutputContract,
  visualQualityPrompt,
  visualQualityPromptIdentity,
  visualQualityResponseStatuses,
  visualQualityValidationPolicy
} from "./visual-quality";

export type VisualQualityScreenshot = {
  route: string;
  viewport: "desktop" | "mobile";
  artifactKey: string;
  sourceUrl?: string;
};

type VisualQualityResponse = {
  status?: string;
  output_text?: string;
  usage?: Parameters<typeof usageForModel>[1];
};

export type VisualQualityResponsesClient = {
  create(
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<VisualQualityResponse>;
};

const responseCheckSchema = z.object({
  id: z.string().min(1).max(180),
  status: z.enum(visualQualityResponseStatuses),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(2_000),
  evidence: z.array(z.object({
    route: z.string().startsWith("/"),
    viewport: z.enum(["desktop", "mobile"]),
    observation: z.string().min(1).max(1_000)
  }).strict()).max(3)
}).strict();

const responseSchema = z.object({
  checks: z.array(responseCheckSchema)
    .length(visualQualityCheckDefinitions.length)
}).strict();

const prohibitedLanguage = new RegExp(visualQualityValidationPolicy.prohibitedLanguagePattern, "i");
const prohibitedAssertion = new RegExp(visualQualityValidationPolicy.prohibitedAssertionPattern, "i");
const maximumOutputTokens = 4_500;

export function visualQualityModelIsConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function evaluateVisualQuality(input: {
  contactSheet?: Buffer;
  contactSheetMimeType?: "image/png" | "image/jpeg" | "image/webp";
  screenshots: VisualQualityScreenshot[];
  vertical: string;
  verticalConfidence: number;
  businessName?: string;
  primaryLocation?: string;
  services: string[];
  customerJourneys: string[];
  deterministicContext: Record<string, unknown>;
  hasMeaningfulImagery: boolean;
  limitations?: string[];
  observedAt?: string;
  signal?: AbortSignal;
  client?: VisualQualityResponsesClient;
  modelId?: string;
}): Promise<VisualQuality> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const screenshotSetHash = sha256(input.contactSheet ?? Buffer.alloc(0));
  if (!input.contactSheet?.length || !input.screenshots.length) {
    return unavailableVisualQuality({
      observedAt,
      screenshotSetHash,
      limitation: "Visual Quality requires retained, labeled desktop and mobile screenshots."
    });
  }
  const modelId = input.modelId ?? configuredVisualQualityModelId();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!input.client && !apiKey) {
    return unavailableVisualQuality({
      observedAt,
      screenshotSetHash,
      limitation: "Visual Quality was unavailable because the multimodal evaluator is not configured."
    });
  }
  const client = input.client ?? configuredClient(apiKey!);
  const available = new Map(input.screenshots.map((screenshot) => [
    screenshotKey(screenshot.route, screenshot.viewport),
    screenshot
  ]));
  const availableRoutes = [...new Set(input.screenshots.map((screenshot) => screenshot.route))].sort();
  const availableViewports = [...new Set(input.screenshots.map((screenshot) => screenshot.viewport))].sort();
  const startedAt = Date.now();
  try {
    const response = await client.create({
      model: modelId,
      store: false,
      instructions: visualQualityPrompt,
      input: [{
        role: "user",
        type: "message",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              task: "Evaluate every Visual Quality check exactly once.",
              checks: visualQualityCheckDefinitions.map((check) => ({
                id: check.id,
                title: check.title,
                applicability: check.applicability
              })),
              screenshotLabels: input.screenshots.map(({ route, viewport }) => ({ route, viewport })),
              businessContext: {
                businessName: input.businessName,
                primaryLocation: input.primaryLocation,
                services: input.services.slice(0, 20),
                customerJourneys: input.customerJourneys.slice(0, 12),
                vertical: input.vertical,
                verticalConfidence: input.verticalConfidence,
                hasMeaningfulImagery: input.hasMeaningfulImagery
              },
              deterministicContext: input.deterministicContext
            })
          },
          {
            type: "input_image",
            image_url: `data:${input.contactSheetMimeType ?? "image/png"};base64,${input.contactSheet.toString("base64")}`,
            detail: "high"
          }
        ]
      }],
      reasoning: { effort: "medium" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "visual_quality_review",
          strict: true,
          schema: outputJsonSchema(availableRoutes, availableViewports)
        }
      },
      max_output_tokens: maximumOutputTokens
    }, input.signal ? { signal: input.signal } : undefined);
    if (response.status && response.status !== "completed") {
      throw new Error(`visual_evaluator_status_${response.status}`);
    }
    if (!response.output_text?.trim()) throw new Error("visual_evaluator_empty_output");
    const parsed = responseSchema.parse(JSON.parse(response.output_text));
    assertCompleteCheckSet(parsed.checks.map((check) => check.id));
    const checks = parsed.checks.map((check): VisualQualityCheckInput => {
      if (isImageryCheck(check.id) && !input.hasMeaningfulImagery) {
        return applicabilityResult(check.id, "not_applicable", "No prominent imagery was available, so this imagery-specific check was not applicable.", observedAt);
      }
      if (check.id === "visual.trust.vertical_fit" && input.verticalConfidence < 0.8) {
        return applicabilityResult(check.id, "not_applicable", `Vertical-fit judgment was excluded because category confidence was ${Math.round(input.verticalConfidence * 100)}%.`, observedAt);
      }
      if (check.id === "visual.responsive.cross_viewport_consistency" && !hasBothViewports(input.screenshots)) {
        return applicabilityResult(check.id, "unknown", "Both desktop and mobile screenshots are required for cross-viewport comparison.", observedAt);
      }
      if (check.status === "not_applicable") {
        throw new Error(`visual_evaluator_invalid_applicability:${check.id}`);
      }
      if (prohibitedLanguage.test(check.explanation) || check.evidence.some((item) => prohibitedLanguage.test(item.observation))) {
        throw new Error(`visual_evaluator_prohibited_language:${check.id}`);
      }
      if (prohibitedAssertion.test(check.explanation) || check.evidence.some((item) => prohibitedAssertion.test(item.observation))) {
        throw new Error(`visual_evaluator_prohibited_assertion:${check.id}`);
      }
      const assessed = check.status === "pass" || check.status === "warning" || check.status === "fail";
      if (assessed && !check.evidence.length) throw new Error(`visual_evaluator_missing_citation:${check.id}`);
      const evidence = check.evidence.map((item, index) => {
        const screenshot = available.get(screenshotKey(item.route, item.viewport));
        if (!screenshot) throw new Error(`visual_evaluator_invalid_citation:${check.id}`);
        return visualEvidence({
          id: `${check.id}.screenshot.${index + 1}`,
          summary: `${item.route} · ${item.viewport}: ${item.observation}`,
          observedAt,
          route: item.route,
          viewport: item.viewport,
          artifactKey: screenshot.artifactKey,
          sourceUrl: screenshot.sourceUrl
        });
      });
      return {
        id: check.id,
        status: check.status,
        certainty: "inferred",
        confidence: check.status === "unknown" ? undefined : check.confidence,
        explanation: check.explanation,
        evidence: evidence.length
          ? evidence
          : [visualEvidence({
              id: `${check.id}.model`,
              summary: "The evaluator could not reach a screenshot-grounded conclusion.",
              observedAt
            })]
      };
    });
    const modelUsage = usageForModel(modelId, response.usage, Date.now() - startedAt);
    return buildVisualQuality({
      checks,
      limitations: input.limitations,
      observedAt,
      evaluator: {
        identity: currentVisualQualityEvaluatorIdentity(modelId),
        status: "completed",
        provider: "openai",
        modelId,
        promptIdentity: visualQualityPromptIdentity,
        screenshotSetHash,
        generatedAt: observedAt,
        inputTokens: modelUsage.inputTokens,
        cachedInputTokens: modelUsage.cachedInputTokens,
        outputTokens: modelUsage.outputTokens,
        durationMs: modelUsage.durationMs,
        estimatedCostUsd: modelUsage.costUsd
      }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.split(":")[0] : "visual_evaluator_failed";
    return unavailableVisualQuality({
      observedAt,
      screenshotSetHash,
      limitation: `Visual Quality was unavailable because the bounded evaluator did not produce valid evidence (${reason.slice(0, 120)}).`
    });
  }
}

function configuredClient(apiKey: string): VisualQualityResponsesClient {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 90_000 });
  return {
    create: (params, options) => client.responses.create(params as never, options) as unknown as Promise<VisualQualityResponse>
  };
}

function outputJsonSchema(routes: string[], viewports: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      checks: {
        type: "array",
        minItems: visualQualityCheckDefinitions.length,
        maxItems: visualQualityCheckDefinitions.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", enum: visualQualityCheckDefinitions.map((check) => check.id) },
            status: { type: "string", enum: visualQualityOutputContract.statuses },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            explanation: { type: "string" },
            evidence: {
              type: "array",
              maxItems: visualQualityOutputContract.maximumCitationsPerCheck,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  route: { type: "string", enum: routes },
                  viewport: { type: "string", enum: viewports },
                  observation: { type: "string" }
                },
                required: ["route", "viewport", "observation"]
              }
            }
          },
          required: ["id", "status", "confidence", "explanation", "evidence"]
        }
      }
    },
    required: ["checks"]
  };
}

function assertCompleteCheckSet(ids: string[]) {
  const expected = visualQualityCheckDefinitions.map((check) => check.id).sort();
  const actual = [...new Set(ids)].sort();
  if (actual.length !== ids.length || actual.join("\n") !== expected.join("\n")) {
    throw new Error("visual_evaluator_incomplete_check_set");
  }
}

function applicabilityResult(
  id: string,
  status: "unknown" | "not_applicable",
  explanation: string,
  observedAt: string
): VisualQualityCheckInput {
  return {
    id,
    status,
    certainty: "inferred",
    explanation,
    evidence: [visualEvidence({
      id: `${id}.applicability`,
      summary: explanation,
      observedAt
    })]
  };
}

function isImageryCheck(id: string) {
  return id === "visual.imagery.relevance_quality" || id === "visual.imagery.presentation_consistency";
}

function hasBothViewports(screenshots: VisualQualityScreenshot[]) {
  const viewports = new Set(screenshots.map((screenshot) => screenshot.viewport));
  return viewports.has("desktop") && viewports.has("mobile");
}

function screenshotKey(route: string, viewport: string) {
  return `${route}:${viewport}`;
}

function sha256(value: Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;
}
