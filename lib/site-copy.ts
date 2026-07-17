import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { extractOpenAiUsage, sanitizeTelemetryPayload } from "./agent-telemetry";
import type { GenerationInputSnapshotV1, ResolvedBusinessSnapshotV1, VerticalPackV1 } from "./control-plane-contracts";
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

export function createFixtureSiteCopy(plan: GenerationPlan, snapshot: GenerationInputSnapshotV1, createdAt?: string): SiteCopy {
  const business = snapshot.business;
  const pack = verticalPackFor(business.vertical);
  assertPlanUsesPack(plan, pack);
  const services = offeringNamesForGeneration(snapshot);
  const serviceForPage = new Map(plan.pages.filter((page) => page.purpose === "service_landing").map((page) => [page.id, page.title]));
  const slots = plan.pages.flatMap((page) => page.sections.flatMap((section) => section.copySlots.map((spec) => ({
    slotId: spec.slotId,
    value: fixtureValue(spec.slotId, spec.role, business, services, pack, serviceForPage.get(page.id)),
    evidenceIds: []
  }))));
  return {
    schemaVersion: siteCopySchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "create-fixture-site-copy",
      producerVersion: siteCopySchemaVersion,
      createdAt,
      inputs: { plan, inputSnapshotId: snapshot.id }
    }),
    slots
  };
}

function fixtureValue(
  slotId: string,
  role: string,
  business: ResolvedBusinessSnapshotV1,
  services: string[],
  pack: VerticalPackV1,
  pageService?: string
) {
  const location = business.address?.city ?? business.serviceAreas[0];
  const index = Number(slotId.match(/\.(\d+)\.(?:title|body|question|answer)$/)?.[1] ?? 0);
  const service = pageService ?? services[index % Math.max(services.length, 1)] ?? "Service";
  if (slotId.endsWith("hero.eyebrow")) return pageService ? `${business.name} service` : business.name;
  if (slotId.endsWith("hero.heading")) {
    if (pageService) return location ? `${pageService} in ${location}` : `${pageService} from ${business.name}`;
    return location ? `${business.name} in ${location}` : business.name;
  }
  if (slotId.endsWith("hero.body")) return pageService ? `Learn what to expect and how to take the next step for ${pageService.toLowerCase()} at ${business.name}.` : `${business.name} provides ${services.slice(0, 3).join(", ").toLowerCase()} with a clear next step.`;
  if (slotId.includes("services") && slotId.endsWith("heading")) return "Services for the work you need";
  if (slotId.includes("services") && slotId.endsWith(".title")) return service;
  if (slotId.includes("services") && /\.\d+\.body$/.test(slotId)) return `Discuss your needs, available options, and next step for ${service.toLowerCase()}.`;
  if (slotId.endsWith("services.body")) return "Start with the service you need and the business can explain the available next step.";
  if (slotId.includes("process") && slotId.endsWith("heading")) return "What to expect";
  if (slotId.includes("process") && slotId.endsWith(".title")) return pack.defaultProcessSteps[index]?.title ?? "Confirm the next step";
  if (slotId.includes("process") && /\.\d+\.body$/.test(slotId)) return pack.defaultProcessSteps[index]?.body ?? "Confirm the details with the business.";
  if (slotId.endsWith("process.body")) return "A clear sequence keeps decisions and expectations visible from first contact through completion.";
  if (slotId.includes("testimonials") && slotId.endsWith("heading")) return "What customers said";
  if (slotId.includes("testimonials")) return "Exact comments retained from the business website.";
  if (slotId.includes("location") && slotId.endsWith("heading")) return location ? `Visit in ${location}` : `Visit ${business.name}`;
  if (slotId.includes("location")) return "Check the address, hours, and best way to reach the business before you go.";
  if (slotId.includes("faq") && slotId.endsWith("heading")) return pageService ? `${pageService} questions` : "Questions before you get started";
  if (slotId.includes("faq") && slotId.endsWith(".body")) return "Direct answers about preparation, options, timing, and next steps.";
  if (slotId.includes("faq") && slotId.endsWith("question")) return ["How do I get started?", "What information should I provide?", "What determines timing?", "How will I know the next step?"][index] ?? `What should I know about ${service.toLowerCase()}?`;
  if (slotId.includes("faq") && slotId.endsWith("answer")) return ["Contact the business with the available details so it can recommend the next step.", "Share the relevant context and ask what else is needed before work begins.", "Timing depends on the service, availability, and the final scope.", "Confirm the communication and completion process before work begins."][index] ?? `The exact approach depends on the needs confirmed during the first conversation.`;
  if (slotId.includes("detail") && slotId.endsWith("heading")) return `What ${service.toLowerCase()} may include`;
  if (slotId.includes("detail") && slotId.endsWith(".title")) return ["Review the need", "Confirm the scope", "Complete the work"][index] ?? "Plan the next step";
  if (slotId.includes("detail") && /\.\d+\.body$/.test(slotId)) return ["The first review identifies the relevant needs and constraints.", "The business explains the proposed work and approval path.", "The completed work is reviewed before the final handoff.", "Questions can be resolved before work begins."][index] ?? `The exact ${service.toLowerCase()} process follows the needs confirmed at the start.`;
  if (slotId.endsWith("detail.body")) return `The business reviews the request before confirming the work needed for ${service.toLowerCase()}.`;
  if (slotId.includes("contact") && slotId.endsWith("heading")) return pageService ? `Ask about ${pageService.toLowerCase()}` : pack.primaryCtaLabel;
  if (slotId.includes("contact")) return business.phone ? `Call ${business.phone} or send the relevant details to discuss the next step.` : "Send the relevant details to discuss the next step.";
  return role === "heading" ? business.name : `Contact ${business.name} for source-backed service details.`;
}
