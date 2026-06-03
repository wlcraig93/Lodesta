import { z } from "zod";
import type { BusinessFactGraph, GenerationPlanV2, SiteBundle, SiteVersion } from "./models";
import { propsForLayoutSection } from "./layout-registry";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import {
  applySiteDirectorDecisionsToPlan,
  withSiteDirectorRun,
  type SiteDirectorDecisionInput
} from "./site-director";
import { extractOpenAiUsage, sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";
import { openAiRequestSignal } from "./openai-timeout";

type OpenAiSiteDirectorInput = {
  bundle: SiteBundle;
  version: SiteVersion;
  factGraph: BusinessFactGraph;
  plan: GenerationPlanV2;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
};

const claimCategories = [
  "business_identity",
  "service",
  "location",
  "contact",
  "hours",
  "reviews",
  "credentials",
  "insurance",
  "pricing",
  "warranty",
  "emergency",
  "regulated"
] as const;

const actionValues = ["keep", "revise", "omit"] as const;

const siteDirectorSchema = z.object({
  summary: z.string().min(1).max(420),
  sectionDecisions: z.array(
    z.object({
      pageId: z.string().min(1).max(120),
      sectionId: z.string().min(1).max(160),
      action: z.enum(actionValues),
      priority: z.number().int().min(1).max(20),
      rationale: z.string().min(1).max(320),
      factIds: z.array(z.string().min(1).max(160)).max(12),
      allowedClaimCategories: z.array(z.enum(claimCategories)).min(1).max(8),
      headlineBrief: z.string().min(1).max(180),
      bodyBrief: z.string().min(1).max(320),
      riskNotes: z.array(z.string().min(1).max(220)).max(6)
    })
  ).min(1).max(80)
});

export async function createOpenAiSiteDirectorPlan(
  input: OpenAiSiteDirectorInput
): Promise<GenerationPlanV2 | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const runtimeSettings = await getOpenAiRuntimeSettings();
  const model = runtimeSettings.settings.generationModel;
  const body = {
    model,
    reasoning: { effort: "low" },
    max_output_tokens: 4200,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are the Lodesta AI Site Director for generated small-business websites.",
              "Return only schema-valid JSON through Structured Outputs.",
              "You receive a rendered section plan, a fact graph, and strict per-section copy policies.",
              "Return one decision for every rendered section.",
              "Use keep or revise for rendered sections. Do not use omit unless a section is already unsupported; unsupported sections should normally be pruned before this step.",
              "Every factual brief must be grounded in the provided fact ids.",
              "Never allow credentials, insurance, pricing, warranties, emergency availability, regulated outcomes, reviews, awards, or years in business unless the section policy explicitly allows that claim category.",
              "Prefer concise, concrete, business-specific briefs over generic website-production language."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(makeSiteDirectorContext(input)) }]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_site_director",
        strict: true,
        schema: responseJsonSchema
      }
    }
  };

  const startedAt = new Date().toISOString();
  let recorded = false;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal()
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model,
      endpoint: "/v1/responses",
      operation: "site_director",
      status: response.ok ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok ? undefined : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedMs(startedAt, endedAt)
    });
    recorded = true;
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload) ?? `OpenAI Site Director failed with status ${response.status}`);
    }

    const text = extractResponseText(payload);
    if (!text) throw new Error("OpenAI Site Director response did not include output text.");
    const parsedJson = JSON.parse(text) as unknown;
    const parsed = siteDirectorSchema.parse(parsedJson);
    const decisions: SiteDirectorDecisionInput[] = parsed.sectionDecisions.map((decision) => ({
      ...decision,
      allowedClaimCategories: [...decision.allowedClaimCategories],
      riskNotes: [...decision.riskNotes]
    }));
    const applied = applySiteDirectorDecisionsToPlan({
      plan: input.plan,
      decisions,
      model,
      summary: parsed.summary
    });
    return applied.plan;
  } catch (error) {
    if (!recorded) {
      const endedAt = new Date().toISOString();
      await input.telemetry?.recordModelCall({
        spanId: input.spanId,
        provider: "openai",
        model,
        endpoint: "/v1/responses",
        operation: "site_director",
        status: "failed",
        requestJson: sanitizeTelemetryPayload(body),
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: elapsedMs(startedAt, endedAt)
      });
    }
    console.warn(
      `OpenAI Site Director unavailable; using deterministic Site Director plan. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return withSiteDirectorRun(input.plan, {
      status: "failed",
      source: "openai",
      model,
      summary: "OpenAI Site Director did not produce an accepted plan; deterministic generation plan remains authoritative.",
      issues: [error instanceof Error ? error.message : String(error)]
    });
  }
}

function makeSiteDirectorContext(input: OpenAiSiteDirectorInput) {
  const business = input.bundle.businessProfile;
  const sectionPropsById = new Map(
    input.version.pages.flatMap((page) =>
      page.layoutSections.map((section) => [section.id, propsForLayoutSection(section)] as const)
    )
  );
  return {
    productContract: {
      output: "final generated website, not a website editor",
      renderer: "registered structured section catalog",
      decisionPolicy: "one decision per rendered section; do not create new sections",
      copyPolicy: "fact_ids_only; unsupported claims are blocked before ready"
    },
    business: {
      name: business.name,
      vertical: business.vertical,
      categories: business.categories,
      services: business.services,
      serviceAreas: business.serviceAreas,
      hasPhone: Boolean(business.phone),
      hasAddress: Boolean(business.address),
      hasHours: Boolean(business.hours && Object.keys(business.hours).length),
      reviewsSummary: business.reviewsSummary
    },
    facts: input.factGraph.facts
      .filter((fact) => fact.renderSafety !== "blocked" && fact.renderSafety !== "internal_only")
      .slice(0, 120)
      .map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        label: fact.label,
        value: fact.value,
        confidence: fact.confidence,
        renderSafety: fact.renderSafety,
        source: fact.provenance.source,
        sourceUrl: fact.sourceUrl
      })),
    plan: {
      id: input.plan.id,
      source: input.plan.source,
      vertical: input.plan.vertical,
      primaryGoal: input.plan.primaryGoal,
      artDirection: input.plan.artDirection,
      pages: input.plan.pages.map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        sections: page.sections.map((section) => ({
          id: section.id,
          kind: section.kind,
          catalogSection: section.catalogSection,
          currentProps: sectionPropsById.get(section.id),
          currentIntent: section.intent,
          supportStatus: section.supportStatus,
          rejectionBehavior: section.rejectionBehavior,
          missingFactKinds: section.missingFactKinds,
          requiredFactIds: section.requiredFactIds,
          optionalFactIds: section.optionalFactIds,
          copyPolicy: section.copyPolicy
        }))
      })),
      omittedSections: input.plan.omittedSections,
      structuralRejections: input.plan.structuralRejections
    },
    responseRules: {
      factIds: "Use only fact ids listed on the corresponding section.",
      allowedClaimCategories: "Use only categories listed in the section copyPolicy.allowedClaimCategories.",
      forbiddenClaimCategories: "Never include categories listed in the section copyPolicy.forbiddenClaimCategories.",
      omittedSections: "Do not reintroduce omitted sections."
    }
  };
}

function elapsedMs(startedAt: string, endedAt: string) {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
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
        throw new Error(`OpenAI Site Director refused: ${item.refusal}`);
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
  required: ["summary", "sectionDecisions"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 420 },
    sectionDecisions: {
      type: "array",
      minItems: 1,
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "pageId",
          "sectionId",
          "action",
          "priority",
          "rationale",
          "factIds",
          "allowedClaimCategories",
          "headlineBrief",
          "bodyBrief",
          "riskNotes"
        ],
        properties: {
          pageId: { type: "string", minLength: 1, maxLength: 120 },
          sectionId: { type: "string", minLength: 1, maxLength: 160 },
          action: { type: "string", enum: actionValues },
          priority: { type: "integer", minimum: 1, maximum: 20 },
          rationale: { type: "string", minLength: 1, maxLength: 320 },
          factIds: {
            type: "array",
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 160 }
          },
          allowedClaimCategories: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string", enum: claimCategories }
          },
          headlineBrief: { type: "string", minLength: 1, maxLength: 180 },
          bodyBrief: { type: "string", minLength: 1, maxLength: 320 },
          riskNotes: {
            type: "array",
            maxItems: 6,
            items: { type: "string", minLength: 1, maxLength: 220 }
          }
        }
      }
    }
  }
};
