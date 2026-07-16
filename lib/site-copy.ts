import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { extractOpenAiUsage, sanitizeTelemetryPayload } from "./agent-telemetry";
import type { BusinessProfile } from "./models";
import type { EvidenceLedger } from "./evidence-ledger";
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
import { publicGenerationServices } from "./vertical-packs";

export type SiteCopyGenerationResult = {
  copy: SiteCopy;
  attempts: 1 | 2;
};

export async function createSiteCopy(input: {
  business: BusinessProfile;
  plan: GenerationPlan;
  evidence: EvidenceLedger;
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
            "Write every requested copy slot for one complete US auto-body business website in a single response.",
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
  business: BusinessProfile;
  plan: GenerationPlan;
  evidence: EvidenceLedger;
  revisionFindings?: string[];
}) {
  return {
    business: {
      name: input.business.name,
      description: input.business.description && !containsGatedSensitiveClaim(input.business.description)
        ? input.business.description
        : undefined,
      phone: input.business.phone,
      address: input.business.address,
      hours: input.business.hours,
      services: publicGenerationServices(input.business.services),
      serviceAreas: input.business.serviceAreas
    },
    designSystem: input.plan.designSystem,
    pages: input.plan.pages.map((page) => ({ id: page.id, slug: page.slug, title: page.title, sections: page.sections.map((section) => ({ id: section.id, templateId: section.templateId })) })),
    copySlots: input.plan.pages.flatMap((page) => page.sections.flatMap((section) => section.copySlots)),
    allowedEvidence: input.evidence.items
      .filter((item) => item.renderPolicy === "durable_render" && item.kind !== "testimonial")
      .map((item) => ({ id: item.id, kind: item.kind, publicText: item.publicText })),
    revisionFindings: input.revisionFindings ?? []
  };
}

export function createFixtureSiteCopy(plan: GenerationPlan, business: BusinessProfile): SiteCopy {
  const services = business.services;
  const serviceForPage = new Map(plan.pages.filter((page) => page.purpose === "service_landing").map((page) => [page.id, page.title]));
  const slots = plan.pages.flatMap((page) => page.sections.flatMap((section) => section.copySlots.map((spec) => ({
    slotId: spec.slotId,
    value: fixtureValue(spec.slotId, spec.role, business, services, serviceForPage.get(page.id)),
    evidenceIds: []
  }))));
  return {
    schemaVersion: siteCopySchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "create-fixture-site-copy",
      producerVersion: siteCopySchemaVersion,
      inputs: { plan, business }
    }),
    slots
  };
}

function fixtureValue(slotId: string, role: string, business: BusinessProfile, services: string[], pageService?: string) {
  const location = business.address?.city ?? business.serviceAreas[0];
  const index = Number(slotId.match(/\.(\d+)\.(?:title|body|question|answer)$/)?.[1] ?? 0);
  const service = pageService ?? services[index % Math.max(services.length, 1)] ?? "Auto body repair";
  if (slotId.endsWith("hero.eyebrow")) return pageService ? `${business.name} service` : business.name;
  if (slotId.endsWith("hero.heading")) {
    if (pageService) return location ? `${pageService} in ${location}` : `${pageService} from ${business.name}`;
    return location ? `Auto body repair in ${location}` : `${business.name} auto body repair`;
  }
  if (slotId.endsWith("hero.body")) return pageService ? `Understand the damage, repair approach, and next step for ${pageService.toLowerCase()} at ${business.name}.` : `${business.name} handles ${services.slice(0, 3).join(", ").toLowerCase()} with a clear estimate and repair plan.`;
  if (slotId.includes("services") && slotId.endsWith("heading")) return "Repairs matched to the damage";
  if (slotId.includes("services") && slotId.endsWith(".title")) return service;
  if (slotId.includes("services") && /\.\d+\.body$/.test(slotId)) return `Discuss the affected panels, repair options, and estimate details for ${service.toLowerCase()}.`;
  if (slotId.endsWith("services.body")) return "Start with the visible damage so the shop can identify the repair work it needs.";
  if (slotId.includes("process") && slotId.endsWith("heading")) return "From damage review to pickup";
  if (slotId.includes("process") && slotId.endsWith(".title")) return ["Share the damage", "Review the estimate", "Approve the plan", "Inspect and pick up"][index] ?? "Confirm the next step";
  if (slotId.includes("process") && /\.\d+\.body$/.test(slotId)) return ["Send photos or arrange an in-person inspection.", "Review the documented damage and proposed work.", "Confirm the repair scope before work begins.", "Review the finished repair and pickup details."][index] ?? "Confirm details with the shop.";
  if (slotId.endsWith("process.body")) return "A documented sequence keeps the estimate, repair decision, and pickup expectations visible.";
  if (slotId.includes("testimonials") && slotId.endsWith("heading")) return "What customers said";
  if (slotId.includes("testimonials")) return "Exact comments retained from the business website.";
  if (slotId.includes("location") && slotId.endsWith("heading")) return location ? `Visit the shop in ${location}` : `Visit ${business.name}`;
  if (slotId.includes("location")) return "Check the address, hours, and best way to reach the shop before you go.";
  if (slotId.includes("faq") && slotId.endsWith("heading")) return pageService ? `${pageService} questions` : "Before you request an estimate";
  if (slotId.includes("faq") && slotId.endsWith(".body")) return "Direct answers about estimates, repair scope, timing, and pickup.";
  if (slotId.includes("faq") && slotId.endsWith("question")) return [`How does the estimate start?`, `What helps define the repair scope?`, `What determines repair timing?`, `How will I know the repair is ready?`][index] ?? `What should I know about ${service.toLowerCase()}?`;
  if (slotId.includes("faq") && slotId.endsWith("answer")) return [`Call or send the available damage details so the shop can recommend an inspection path.`, `The shop can explain the damage documentation it provides and what information is needed before work begins.`, `Timing depends on damage, parts, approvals, and the final repair plan.`, `Confirm the quality-check and pickup process with the shop before work begins.`][index] ?? `The repair approach depends on the damage found during inspection.`;
  if (slotId.includes("detail") && slotId.endsWith("heading")) return `What ${service.toLowerCase()} may involve`;
  if (slotId.includes("detail") && slotId.endsWith(".title")) return ["Inspect the damage", "Confirm the repair scope", "Review the finished work"][index] ?? "Plan the repair";
  if (slotId.includes("detail") && /\.\d+\.body$/.test(slotId)) return ["The inspection documents the affected area and any connected damage.", "The estimate identifies the proposed work, parts, and approval path.", "The finished repair is checked before pickup details are confirmed.", "Questions about the repair can be resolved before work begins."][index] ?? `The exact ${service.toLowerCase()} process follows the condition found during inspection.`;
  if (slotId.endsWith("detail.body")) return `The shop inspects the affected area before confirming the work needed for ${service.toLowerCase()}.`;
  if (slotId.includes("contact") && slotId.endsWith("heading")) return pageService ? `Ask about ${pageService.toLowerCase()}` : "Start with an estimate request";
  if (slotId.includes("contact")) return business.phone ? `Call ${business.phone} or send the damage details to discuss the next step.` : "Send the damage details to discuss the next step.";
  return role === "heading" ? business.name : `Contact ${business.name} for source-backed service details.`;
}
