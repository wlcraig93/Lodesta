import { storeGeneratedAssetBytes } from "./asset-storage";
import type { CreativeMockupArtifact, DesignDirection, SiteAsset, SiteBundle } from "./models";
import { sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";
import {
  defaultOpenAiRuntimeSettings,
  getOpenAiRuntimeSettings,
  type OpenAiRuntimeSettings
} from "./operator-settings";

type MockupGenerationInput = {
  bundle: SiteBundle;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
};

type ImageGenerationConfig = {
  model: string;
  size: string;
  quality: CreativeMockupArtifact["quality"];
  outputFormat: NonNullable<CreativeMockupArtifact["outputFormat"]>;
  limit: number;
};

export async function createOpenAiMockupArtifacts({
  bundle,
  telemetry,
  spanId
}: MockupGenerationInput): Promise<CreativeMockupArtifact[]> {
  const config = await imageConfig();
  const directions = mockupDirections(bundle, config.limit);
  if (!directions.length) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return createPromptOnlyMockupArtifacts({
      bundle,
      directions,
      config,
      reason: "OPENAI_API_KEY is not set; storing planning prompts without generated images."
    });
  }

  const artifacts: CreativeMockupArtifact[] = [];
  for (const direction of directions) {
    artifacts.push(await generateDirectionMockup({ apiKey, bundle, direction, config, telemetry, spanId }));
  }
  return artifacts;
}

export function createPromptOnlyMockupArtifacts({
  bundle,
  directions,
  config = imageConfigFromSettings(defaultOpenAiRuntimeSettings()),
  reason = "Generated image provider was not run; this artifact preserves the creative prompt for planning."
}: {
  bundle: SiteBundle;
  directions?: DesignDirection[];
  config?: ImageGenerationConfig;
  reason?: string;
}): CreativeMockupArtifact[] {
  const generatedAt = new Date().toISOString();
  const selectedDirections = directions ?? mockupDirections(bundle, config.limit);
  return selectedDirections.map((direction) => ({
    id: mockupId(direction),
    siteId: bundle.businessProfile.siteId,
    designDirectionId: direction.id,
    strategy: direction.strategy,
    status: "prompt_only",
    provider: "deterministic_fallback",
    model: config.model,
    prompt: buildMockupPrompt(bundle, direction),
    size: config.size,
    quality: config.quality,
    outputFormat: config.outputFormat,
    planningOnly: true,
    generatedAt,
    notes: [
      reason,
      "The production website must still be rendered from SiteModel sections, not from this mockup."
    ]
  }));
}

export function createMockupAssets(mockups: CreativeMockupArtifact[]): SiteAsset[] {
  return mockups.map((mockup) => ({
    id: mockup.assetId ?? `asset_${mockup.id}`,
    siteId: mockup.siteId,
    kind: "mockup",
    url: mockup.image?.url,
    alt: mockup.image?.alt ?? `${mockup.strategy.replace(/_/g, " ")} creative planning mockup`,
    source: mockup.image?.source ?? "generated",
    rightsStatus: mockup.image?.rightsStatus ?? "preclaim_safe",
    usageScope: "internal_planning",
    ownerApproved: false,
    metadata: {
      designDirectionId: mockup.designDirectionId,
      strategy: mockup.strategy,
      status: mockup.status,
      provider: mockup.provider,
      model: mockup.model,
      prompt: mockup.prompt,
      revisedPrompt: mockup.revisedPrompt,
      storageProvider: mockup.storageProvider,
      storagePath: mockup.storagePath,
      planningOnly: mockup.planningOnly
    },
    createdAt: mockup.generatedAt
  }));
}

async function generateDirectionMockup({
  apiKey,
  bundle,
  direction,
  config,
  telemetry,
  spanId
}: {
  apiKey: string;
  bundle: SiteBundle;
  direction: DesignDirection;
  config: ImageGenerationConfig;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<CreativeMockupArtifact> {
  const generatedAt = new Date().toISOString();
  const prompt = buildMockupPrompt(bundle, direction);
  const base = {
    id: mockupId(direction),
    siteId: bundle.businessProfile.siteId,
    designDirectionId: direction.id,
    strategy: direction.strategy,
    provider: "openai" as const,
    model: config.model,
    prompt,
    size: config.size,
    quality: config.quality,
    outputFormat: config.outputFormat,
    planningOnly: true as const,
    generatedAt
  };

  const requestBody = {
    model: config.model,
    prompt,
    n: 1,
    size: config.size,
    quality: config.quality,
    output_format: config.outputFormat,
    moderation: "auto"
  };
  const startedAt = new Date().toISOString();
  let recorded = false;
  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    await telemetry?.recordModelCall({
      spanId,
      provider: "openai",
      model: config.model,
      endpoint: "/v1/images/generations",
      operation: "mockup_generation",
      status: response.ok ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(requestBody),
      responseJson: sanitizeTelemetryPayload(payload),
      errorMessage: response.ok ? undefined : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedMs(startedAt, endedAt)
    });
    recorded = true;
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload) ?? `OpenAI image generation failed with status ${response.status}`);
    }

    const image = extractImage(payload);
    if (!image?.base64) throw new Error("OpenAI image generation response did not include b64_json.");
    const assetId = `asset_${mockupId(direction)}`;
    const stored = await storeGeneratedAssetBytes({
      siteId: bundle.businessProfile.siteId,
      assetId,
      base64: image.base64,
      mimeType: mimeTypeForFormat(config.outputFormat),
      publicUrl: false
    });
    return {
      ...base,
      status: "generated",
      revisedPrompt: image.revisedPrompt,
      assetId,
      storageProvider: stored.provider,
      storagePath: stored.storagePath,
      image: stored.url
        ? {
            id: assetId,
            url: stored.url,
            alt: `${direction.label} creative planning mockup for ${bundle.businessProfile.name}`,
            source: "generated" as const,
            rightsStatus: "preclaim_safe" as const
          }
        : undefined,
      notes: [
        "Generated image is a creative planning layer only.",
        `Image bytes stored privately with ${stored.provider} asset storage at ${stored.storagePath}.`,
        "The production website must still be rendered from SiteModel sections, not from this mockup."
      ]
    };
  } catch (error) {
    if (!recorded) {
      const endedAt = new Date().toISOString();
      await telemetry?.recordModelCall({
        spanId,
        provider: "openai",
        model: config.model,
        endpoint: "/v1/images/generations",
        operation: "mockup_generation",
        status: "failed",
        requestJson: sanitizeTelemetryPayload(requestBody),
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: elapsedMs(startedAt, endedAt)
      });
    }
    return {
      ...base,
      status: "failed",
      notes: [
        `OpenAI image generation unavailable: ${error instanceof Error ? error.message : String(error)}`,
        "The prompt remains available so the direction can be generated later without changing the SiteModel."
      ]
    };
  }
}

function elapsedMs(startedAt: string, endedAt: string) {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

function buildMockupPrompt(bundle: SiteBundle, direction: DesignDirection) {
  const business = bundle.businessProfile;
  const brand = bundle.presenceAssessment.brandAssessment;
  return [
    "Create a polished desktop website design mockup for a US small business. This is a planning image only, not the production website.",
    `Business: ${business.name}. Vertical: ${business.vertical.replace(/_/g, " ")}. Categories: ${business.categories.join(", ")}.`,
    `Design direction: ${direction.label}. ${direction.rationale}`,
    `Theme preset: ${direction.themePreset}. Section emphasis: ${direction.sectionEmphasis.join(", ")}.`,
    brand?.cues.length ? `Preserve these source-observed brand cues abstractly: ${brand.cues.slice(0, 6).join(", ")}.` : "",
    brand?.colorSignals.length ? `Use color inspiration from: ${brand.colorSignals.slice(0, 4).join(", ")}.` : "",
    direction.mockupPrompt,
    "Show clear hero hierarchy, primary CTA, trust signals, service proof, and contact path.",
    "You may use public source brand, copy, and asset cues for this internal planning preview.",
    "Do not invent reviews, prices, awards, credentials, regulated claims, or private access details.",
    "Make it visually useful for compiling into structured sections while keeping provenance for business facts."
  ]
    .filter(Boolean)
    .join("\n");
}

function mockupDirections(bundle: SiteBundle, limit: number) {
  const directions = bundle.presenceAssessment.designDirections ?? [];
  return directions.slice(0, Math.max(1, Math.min(limit, 3)));
}

function mockupId(direction: DesignDirection) {
  return `mockup_${direction.id}`;
}

async function imageConfig(): Promise<ImageGenerationConfig> {
  return imageConfigFromSettings((await getOpenAiRuntimeSettings()).settings);
}

function imageConfigFromSettings(settings: OpenAiRuntimeSettings): ImageGenerationConfig {
  return {
    model: settings.imageModel,
    size: settings.imageSize,
    quality: settings.imageQuality,
    outputFormat: settings.imageFormat,
    limit: settings.mockupLimit
  };
}

function mimeTypeForFormat(format: ImageGenerationConfig["outputFormat"]) {
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "image/jpeg";
}

function extractImage(payload: unknown): { base64?: string; revisedPrompt?: string } | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const first = payload.data.find(isRecord);
  if (!first) return undefined;
  return {
    base64: typeof first.b64_json === "string" ? first.b64_json : undefined,
    revisedPrompt: typeof first.revised_prompt === "string" ? first.revised_prompt : undefined
  };
}

function openAiErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  return typeof payload.error.message === "string" ? payload.error.message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
