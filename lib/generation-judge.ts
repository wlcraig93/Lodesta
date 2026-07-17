import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { extractOpenAiUsage, sanitizeTelemetryPayload } from "./agent-telemetry";
import type { RegenerableArtifactProvenanceV1, SiteVersionV3 } from "./models";
import type { GenerationInputSnapshotV1, ResolvedAssetV1, VerticalPackV1 } from "./control-plane-contracts";
import type { GenerationPlan } from "./generation-contracts";
import type { ObjectiveGenerationGateResult } from "./generation-objective-gate";
import { renderedTextManifest } from "./generation-objective-gate";
import { alternateDesignSystem, offeringNamesForGeneration, publicGenerationServices, verticalPackFor } from "./vertical-packs";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import {
  elapsedOpenAiCallMs,
  extractOpenAiResponseText,
  openAiErrorMessage,
  openAiResponseIncompleteReason
} from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";

export const generationJudgeSchemaVersion = "generation-judge-v1" as const;

export type GenerationJudgeRevisionAction = "copy" | "alternate_system" | "operator_review";
export type GenerationJudgeAction = "none" | GenerationJudgeRevisionAction;

export type GenerationJudgeFinding = {
  id: string;
  area: "hierarchy" | "responsive" | "copy" | "brand" | "trust" | "conversion" | "media";
  severity: "material" | "polish";
  pageId: string;
  evidence: string;
  instruction: string;
};

type GenerationJudgeCommon = {
  schemaVersion: typeof generationJudgeSchemaVersion;
  provenance: RegenerableArtifactProvenanceV1;
  source: "openai" | "unavailable";
  model?: string;
  evaluatedAt: string;
  screenshotCount: number;
  summary: string;
  findings: GenerationJudgeFinding[];
};

export type GenerationJudgeResult = GenerationJudgeCommon & (
  | { verdict: "ship"; action: "none" }
  | { verdict: "revise"; action: GenerationJudgeRevisionAction }
  | { verdict: "operator_review"; action: "operator_review" }
);

export type GenerationJudgePacket = {
  availableActions: GenerationJudgeRevisionAction[];
  images: Array<{
    id: "homepage_desktop" | "homepage_mobile" | "service_contact_sheet_desktop" | "service_contact_sheet_mobile";
    label: string;
    imageUrl: string;
    path: string;
    bytes: number;
  }>;
  textManifest: ReturnType<typeof renderedTextManifest>;
};

const findingSchema = z.object({
  id: z.string().min(1).max(80),
  area: z.enum(["hierarchy", "responsive", "copy", "brand", "trust", "conversion", "media"]),
  severity: z.enum(["material", "polish"]),
  pageId: z.string().min(1).max(120),
  evidence: z.string().min(1).max(420),
  instruction: z.string().min(1).max(420)
});

const responseCommon = {
  summary: z.string().min(1).max(500),
  findings: z.array(findingSchema).max(8)
};

const judgePayloadSchema = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("ship"), action: z.literal("none"), ...responseCommon }),
  z.object({ verdict: z.literal("revise"), action: z.enum(["copy", "alternate_system", "operator_review"]), ...responseCommon }),
  z.object({ verdict: z.literal("operator_review"), action: z.literal("operator_review"), ...responseCommon })
]);

export async function buildGenerationJudgePacket(input: {
  snapshot: GenerationInputSnapshotV1;
  plan: GenerationPlan;
  version: SiteVersionV3;
  gate: ObjectiveGenerationGateResult;
  artifactRoot: string;
}): Promise<GenerationJudgePacket> {
  if (input.gate.status !== "pass") throw new Error("Final judgment requires a passing objective gate.");
  const home = input.gate.routes.find((route) => route.slug === "");
  if (!home) throw new Error("Final judgment requires the canonical homepage route.");
  const serviceRoutes = input.gate.routes.filter((route) => route.slug !== "");
  if (!serviceRoutes.length) throw new Error("Final judgment requires at least one service route contact sheet.");
  const homepageDesktop = await screenshotImage(home.inspection, "desktop", "homepage_desktop", "Homepage desktop");
  const homepageMobile = await screenshotImage(home.inspection, "mobile", "homepage_mobile", "Homepage mobile");
  const serviceDesktop = await createServiceContactSheet(serviceRoutes, "desktop", input.artifactRoot, input.gate.qaRunId);
  const serviceMobile = await createServiceContactSheet(serviceRoutes, "mobile", input.artifactRoot, input.gate.qaRunId);
  return {
    availableActions: availableJudgeActions(input.plan, input.snapshot.assets),
    images: [homepageDesktop, homepageMobile, serviceDesktop, serviceMobile],
    textManifest: renderedTextManifest(input.version)
  };
}

export function availableJudgeActions(plan: GenerationPlan, assets: ResolvedAssetV1[]): GenerationJudgeRevisionAction[] {
  return [
    "copy",
    ...(alternateDesignSystem(plan.designSystem, assets) ? ["alternate_system" as const] : []),
    "operator_review"
  ];
}

export function parseGenerationJudgeResult(
  value: unknown,
  availableActions: GenerationJudgeRevisionAction[]
) {
  const parsed = judgePayloadSchema.parse(value);
  if (parsed.verdict === "revise" && !availableActions.includes(parsed.action)) {
    throw new Error(`Judge returned unavailable action ${parsed.action}.`);
  }
  return parsed;
}

export async function createGenerationJudge(input: {
  snapshot: GenerationInputSnapshotV1;
  plan: GenerationPlan;
  packet: GenerationJudgePacket;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
}): Promise<GenerationJudgeResult> {
  const evaluatedAt = new Date().toISOString();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return unavailableJudgeResult(input, evaluatedAt, "OPENAI_API_KEY is not configured.");
  const runtime = await getOpenAiRuntimeSettings();
  const model = runtime.settings.generationJudgeModel;
  const context = generationJudgeContext(input);
  const body = {
    model,
    reasoning: { effort: "medium" },
    max_output_tokens: 2600,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: [
            "You are the single final creative director for a generated US local-business website described by the selected vertical pack.",
            "Make one holistic decision; do not score dimensions, average grades, or repeat objective browser checks.",
            "Ship only when the site looks intentional, specific, trustworthy, coherent on desktop and mobile, and commercially credible at a $30-$100 monthly managed-site price.",
            "Use the complete text manifest to judge copy on service pages because their contact-sheet text may be small.",
            "Do not request invented reviews, credentials, warranties, awards, offers, prices, or business-specific media.",
            "A sparse but honest source is not itself a defect when the text-led system is coherent.",
            "Use copy only when the plan and design system should remain. Use alternate_system only when it is offered and the entire visual system is the problem.",
            "Use operator_review when neither bounded revision can responsibly resolve the issue.",
            "Ship requires action none. Revise requires exactly one offered action. Operator review requires action operator_review.",
            "Return no scores and no pass findings. Findings must cite visible evidence and give one concrete revision instruction."
          ].join(" ")
        }]
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: JSON.stringify(context) },
          ...input.packet.images.flatMap((image) => [
            { type: "input_text" as const, text: image.label },
            { type: "input_image" as const, image_url: image.imageUrl, detail: "high" as const }
          ])
        ]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_generation_judge_v1",
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
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: openAiRequestSignal(undefined, input.signal)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    const incomplete = response.ok ? openAiResponseIncompleteReason(payload) : undefined;
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model,
      endpoint: "/v1/responses",
      operation: "final_generation_judge",
      status: response.ok && !incomplete ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok ? (incomplete ? `Incomplete response (${incomplete})` : undefined) : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    recorded = true;
    if (!response.ok) throw new Error(openAiErrorMessage(payload) ?? `Final generation judge failed with HTTP ${response.status}.`);
    if (incomplete) throw new Error(`Final generation judge response was incomplete (${incomplete}).`);
    const text = extractOpenAiResponseText(payload);
    if (!text) throw new Error("Final generation judge did not return structured output.");
    const parsed = parseGenerationJudgeResult(JSON.parse(text), input.packet.availableActions);
    return {
      ...parsed,
      schemaVersion: generationJudgeSchemaVersion,
      provenance: createRegenerableArtifactProvenanceV1({
        producerId: "create-generation-judge",
        producerVersion: generationJudgeSchemaVersion,
        modelId: model,
        createdAt: evaluatedAt,
        inputs: { context, imageBytes: input.packet.images.map((image) => ({ id: image.id, bytes: image.bytes })) }
      }),
      source: "openai",
      model,
      evaluatedAt,
      screenshotCount: input.packet.images.length
    };
  } catch (error) {
    if (!recorded) {
      const endedAt = new Date().toISOString();
      await input.telemetry?.recordModelCall({
        spanId: input.spanId,
        provider: "openai",
        model,
        endpoint: "/v1/responses",
        operation: "final_generation_judge",
        status: "failed",
        requestJson: sanitizeTelemetryPayload(body),
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
      });
    }
    return unavailableJudgeResult(input, evaluatedAt, error instanceof Error ? error.message : String(error), model);
  }
}

export function generationJudgeContext(input: {
  snapshot: GenerationInputSnapshotV1;
  plan: GenerationPlan;
  packet: GenerationJudgePacket;
}) {
  const business = input.snapshot.business;
  const pack = verticalPackFor(business.vertical);
  assertPlanUsesPack(input.plan, pack);
  return {
    business: {
      name: business.name,
      services: publicGenerationServices(offeringNamesForGeneration(input.snapshot)),
      location: business.address?.city ?? business.serviceAreas[0]
    },
    verticalPack: {
      id: pack.id,
      version: pack.version,
      businessCategory: pack.businessCategory,
      copyBrief: pack.copyBrief
    },
    designSystem: input.plan.designSystem,
    availableActions: input.packet.availableActions,
    renderedTextManifest: input.packet.textManifest
  };
}

function assertPlanUsesPack(plan: GenerationPlan, pack: VerticalPackV1) {
  if (plan.verticalPack.id !== pack.id || plan.verticalPack.version !== pack.version) {
    throw new Error(`Generation plan pack ${plan.verticalPack.id}@${plan.verticalPack.version} does not match selected pack ${pack.id}@${pack.version}.`);
  }
}

function unavailableJudgeResult(
  input: { packet: GenerationJudgePacket },
  evaluatedAt: string,
  reason: string,
  model?: string
): GenerationJudgeResult {
  return {
    schemaVersion: generationJudgeSchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "create-generation-judge",
      producerVersion: generationJudgeSchemaVersion,
      modelId: model,
      createdAt: evaluatedAt,
      inputs: { availableActions: input.packet.availableActions, reason }
    }),
    source: "unavailable",
    ...(model ? { model } : {}),
    evaluatedAt,
    screenshotCount: input.packet.images.length,
    verdict: "operator_review",
    action: "operator_review",
    summary: "Final model judgment was unavailable; operator review is required.",
    findings: [{
      id: "judge_unavailable",
      area: "trust",
      severity: "material",
      pageId: "site",
      evidence: reason,
      instruction: "Complete operator review before publishing."
    }]
  };
}

async function screenshotImage(
  inspection: ObjectiveGenerationGateResult["routes"][number]["inspection"],
  viewport: "desktop" | "mobile",
  id: "homepage_desktop" | "homepage_mobile",
  label: string
): Promise<GenerationJudgePacket["images"][number]> {
  const screenshot = inspection.screenshots.find((candidate) => candidate.viewport === viewport && candidate.path);
  if (!screenshot?.path) throw new Error(`Missing ${viewport} homepage screenshot for final judgment.`);
  const bytes = await readFile(screenshot.path);
  return { id, label, imageUrl: dataUrl(bytes, screenshot.path), path: screenshot.path, bytes: bytes.length };
}

async function createServiceContactSheet(
  routes: ObjectiveGenerationGateResult["routes"],
  viewport: "desktop" | "mobile",
  artifactRoot: string,
  qaRunId: string
): Promise<GenerationJudgePacket["images"][number]> {
  const cards = await Promise.all(routes.map(async (route) => {
    const screenshot = route.inspection.screenshots.find((candidate) => candidate.viewport === viewport && candidate.path);
    if (!screenshot?.path) throw new Error(`Missing ${viewport} screenshot for /${route.slug}.`);
    const bytes = await readFile(screenshot.path);
    return { label: `/${route.slug}`, imageUrl: dataUrl(bytes, screenshot.path) };
  }));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, timeout: 15_000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  try {
    await page.setContent(contactSheetHtml(cards), { waitUntil: "load", timeout: 15_000 });
    const directory = join(artifactRoot, "judge-packets", qaRunId.replace(/[^a-z0-9_-]+/gi, "-"));
    await mkdir(directory, { recursive: true });
    const path = join(directory, `service-contact-sheet-${viewport}.jpg`);
    await page.screenshot({ path, type: "jpeg", quality: 84, fullPage: false });
    const file = await stat(path);
    const bytes = await readFile(path);
    const id = viewport === "desktop" ? "service_contact_sheet_desktop" : "service_contact_sheet_mobile";
    return {
      id,
      label: `Service pages ${viewport} contact sheet`,
      imageUrl: dataUrl(bytes, path),
      path,
      bytes: file.size
    };
  } finally {
    await page.close();
    await browser.close();
  }
}

function contactSheetHtml(cards: Array<{ label: string; imageUrl: string }>) {
  return `<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1440px; height: 960px; overflow: hidden; background: #eceeeb; color: #171a1d; font-family: Arial, sans-serif; }
    main { display: grid; grid-template-columns: repeat(${Math.min(cards.length, 3)}, minmax(0, 1fr)); gap: 18px; height: 100%; padding: 22px; }
    figure { background: #fff; border: 1px solid #c9cecb; display: grid; grid-template-rows: auto minmax(0, 1fr); margin: 0; min-width: 0; overflow: hidden; }
    figcaption { border-bottom: 1px solid #d7dbd8; font-size: 18px; font-weight: 700; padding: 12px 14px; }
    img { display: block; height: 100%; object-fit: contain; object-position: top center; width: 100%; }
  </style></head><body><main>${cards.map((card) => `<figure><figcaption>${escapeHtml(card.label)}</figcaption><img src="${card.imageUrl}" alt="" /></figure>`).join("")}</main></body></html>`;
}

function dataUrl(bytes: Buffer, path: string) {
  const mime = extname(path).toLocaleLowerCase("en-US") === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "action", "summary", "findings"],
  properties: {
    verdict: { type: "string", enum: ["ship", "revise", "operator_review"] },
    action: { type: "string", enum: ["none", "copy", "alternate_system", "operator_review"] },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    findings: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "area", "severity", "pageId", "evidence", "instruction"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          area: { type: "string", enum: ["hierarchy", "responsive", "copy", "brand", "trust", "conversion", "media"] },
          severity: { type: "string", enum: ["material", "polish"] },
          pageId: { type: "string", minLength: 1, maxLength: 120 },
          evidence: { type: "string", minLength: 1, maxLength: 420 },
          instruction: { type: "string", minLength: 1, maxLength: 420 }
        }
      }
    }
  }
};
