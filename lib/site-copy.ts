import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { extractOpenAiUsage, sanitizeTelemetryPayload } from "./agent-telemetry";
import type { GenerationInputSnapshotV1, VerticalPackV1 } from "./control-plane-contracts";
import {
  siteCopyResponseSchema,
  siteCopySchemaVersion,
  validateSiteCopyForPlan,
  type GenerationPlan,
  type SiteCopy
} from "./generation-contracts";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import {
  elapsedOpenAiCallMs,
  extractOpenAiResponseText,
  openAiErrorMessage,
  openAiResponseIncompleteReason
} from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import { containsGatedSensitiveClaim } from "./content-safety-scanners";
import { offeringNamesForGeneration, publicGenerationServices, verticalPackFor } from "./vertical-packs";

export type SiteCopyGenerationResult = {
  copy: SiteCopy;
  attempts: 1 | 2;
};

export async function createSiteCopy(input: {
  snapshot: GenerationInputSnapshotV1;
  plan: GenerationPlan;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
  revisionFindings?: string[];
}): Promise<SiteCopyGenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for canonical whole-site copy generation.");
  const runtime = await getOpenAiRuntimeSettings();
  const context = copyContext(input);
  let lastError: unknown;
  for (const attempt of [1, 2] as const) {
    try {
      const response = await runCopyCall({
        apiKey,
        model: runtime.settings.generationModel,
        context,
        telemetry: input.telemetry,
        spanId: input.spanId,
        signal: input.signal,
        attempt
      });
      const parsed = siteCopyResponseSchema.parse(response);
      const copy: SiteCopy = {
        schemaVersion: siteCopySchemaVersion,
        provenance: createRegenerableArtifactProvenanceV1({
          producerId: "create-site-copy",
          producerVersion: siteCopySchemaVersion,
          modelId: runtime.settings.generationModel,
          inputs: { context }
        }),
        slots: parsed.slots
      };
      const validation = validateSiteCopyForPlan(input.plan, copy);
      if (!validation.ok) throw new Error(`Site copy contract failed: ${validation.issues.join(" ")}`);
      return { copy, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Whole-site copy generation failed after one retry.");
}

async function runCopyCall(input: {
  apiKey: string;
  model: string;
  context: ReturnType<typeof copyContext>;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
  attempt: 1 | 2;
}) {
  const body = {
    model: input.model,
    reasoning: { effort: "medium" },
    max_output_tokens: input.attempt === 1 ? 12_000 : 15_000,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: [
            "Write every requested copy slot for the complete US local-business website described by the selected vertical pack in a single response.",
            "Return exactly one value for every slotId and no unrequested slots.",
            "Use concrete, business-specific language. Avoid generic headings, repeated sentences, clipped phrases, and meta-instructions.",
            "Do not invent services, prices, credentials, warranties, awards, offers, reviews, turnaround times, insurance relationships, or years in business.",
            "Omit pricing, free offers, insurance, rental-car, credential, warranty, award, review-rating, superlative, and longevity claims from model-written copy. Those facts render only through deterministic evidence components, even when they appear in the supplied source profile.",
            "Only cite evidence IDs allowed by that slot. Evidence is optional unless the wording directly relies on it.",
            "Testimonials and protected claims are rendered deterministically outside this call; never rewrite or summarize them.",
            "Service landing pages must each have distinct service-specific detail and questions."
          ].join(" ")
        }]
      },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(input.context) }] }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_site_copy_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["slots"],
          properties: {
            slots: {
              type: "array",
              minItems: input.context.copySlots.length,
              maxItems: input.context.copySlots.length,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["slotId", "value", "evidenceIds"],
                properties: {
                  slotId: { type: "string", enum: input.context.copySlots.map((slot) => slot.slotId) },
                  value: { type: "string", minLength: 1, maxLength: 900 },
                  evidenceIds: { type: "array", maxItems: 8, items: { type: "string" } }
                }
              }
            }
          }
        }
      }
    }
  };
  const startedAt = new Date().toISOString();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: openAiRequestSignal(undefined, input.signal)
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const endedAt = new Date().toISOString();
  const incomplete = response.ok ? openAiResponseIncompleteReason(payload) : undefined;
  await input.telemetry?.recordModelCall({
    spanId: input.spanId,
    provider: "openai",
    model: input.model,
    endpoint: "/v1/responses",
    operation: "whole_site_copy",
    status: response.ok && !incomplete ? "completed" : "failed",
    requestJson: sanitizeTelemetryPayload(body),
    responseJson: sanitizeTelemetryPayload(payload),
    ...extractOpenAiUsage(payload),
    errorMessage: response.ok ? (incomplete ? `Incomplete response (${incomplete})` : undefined) : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
    startedAt,
    endedAt,
    durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
  });
  if (!response.ok) throw new Error(openAiErrorMessage(payload) ?? `Whole-site copy failed with HTTP ${response.status}.`);
  if (incomplete) throw new Error(`Whole-site copy response was incomplete (${incomplete}).`);
  const text = extractOpenAiResponseText(payload);
  if (!text) throw new Error("Whole-site copy response did not include output text.");
  return JSON.parse(text) as unknown;
}

function copyContext(input: {
  snapshot: GenerationInputSnapshotV1;
  plan: GenerationPlan;
  revisionFindings?: string[];
}) {
  const business = input.snapshot.business;
  const pack = verticalPackFor(business.vertical);
  assertPlanUsesPack(input.plan, pack);
  return {
    business: {
      name: business.name,
      description: business.description && !containsGatedSensitiveClaim(business.description)
        ? business.description
        : undefined,
      phone: business.phone,
      address: business.address,
      hours: business.hours,
      services: publicGenerationServices(offeringNamesForGeneration(input.snapshot)),
      serviceAreas: business.serviceAreas
    },
    verticalPack: {
      id: pack.id,
      version: pack.version,
      businessCategory: pack.businessCategory,
      copyBrief: pack.copyBrief,
      seoVocabulary: pack.seoVocabulary
    },
    designSystem: input.plan.designSystem,
    siteIntent: {
      audience: input.snapshot.siteIntent.audience,
      positioning: input.snapshot.siteIntent.positioning,
      voice: input.snapshot.siteIntent.voice,
      primaryConversion: input.snapshot.siteIntent.primaryConversion
    },
    pages: input.plan.pages.map((page) => ({ id: page.id, slug: page.slug, title: page.title, sections: page.sections.map((section) => ({ id: section.id, templateId: section.templateId })) })),
    copySlots: input.plan.pages.flatMap((page) => page.sections.flatMap((section) => section.copySlots)),
    // Trust-sensitive proof never enters model-authored prose. Testimonials and
    // confirmed proof render through deterministic compiler-owned components.
    allowedEvidence: [],
    revisionFindings: input.revisionFindings ?? []
  };
}

function assertPlanUsesPack(plan: GenerationPlan, pack: VerticalPackV1) {
  if (plan.verticalPack.id !== pack.id || plan.verticalPack.version !== pack.version) {
    throw new Error(`Generation plan pack ${plan.verticalPack.id}@${plan.verticalPack.version} does not match selected pack ${pack.id}@${pack.version}.`);
  }
}
