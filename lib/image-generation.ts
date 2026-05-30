import { storeGeneratedAssetBytes } from "./asset-storage";
import type { CreativeMockupArtifact, DesignDirection, SiteAsset, SiteBundle } from "./models";

type MockupGenerationInput = {
  bundle: SiteBundle;
};

type ImageGenerationConfig = {
  model: string;
  size: string;
  quality: CreativeMockupArtifact["quality"];
  outputFormat: NonNullable<CreativeMockupArtifact["outputFormat"]>;
  limit: number;
};

export async function createOpenAiMockupArtifacts({
  bundle
}: MockupGenerationInput): Promise<CreativeMockupArtifact[]> {
  const config = imageConfig();
  const directions = mockupDirections(bundle, config.limit);
  if (!directions.length) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return createPromptOnlyMockupArtifacts({
      bundle,
      directions,
      reason: "OPENAI_API_KEY is not set; storing planning prompts without generated images."
    });
  }

  const artifacts: CreativeMockupArtifact[] = [];
  for (const direction of directions) {
    artifacts.push(await generateDirectionMockup({ apiKey, bundle, direction, config }));
  }
  return artifacts;
}

export function createPromptOnlyMockupArtifacts({
  bundle,
  directions = mockupDirections(bundle, imageConfig().limit),
  reason = "Generated image provider was not run; this artifact preserves the creative prompt for planning."
}: {
  bundle: SiteBundle;
  directions?: DesignDirection[];
  reason?: string;
}): CreativeMockupArtifact[] {
  const generatedAt = new Date().toISOString();
  const config = imageConfig();
  return directions.map((direction) => ({
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
  config
}: {
  apiKey: string;
  bundle: SiteBundle;
  direction: DesignDirection;
  config: ImageGenerationConfig;
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

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        prompt,
        n: 1,
        size: config.size,
        quality: config.quality,
        output_format: config.outputFormat,
        moderation: "auto"
      })
    });

    const payload = (await response.json().catch(() => null)) as unknown;
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
    "Use generated placeholder imagery and generic interface text; do not copy existing marketing text, photos, logos, reviews, prices, awards, credentials, or regulated claims.",
    "Make it visually useful for compiling into structured sections while keeping all business facts verification-gated."
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

function imageConfig(): ImageGenerationConfig {
  return {
    model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
    size: process.env.OPENAI_IMAGE_SIZE ?? "1536x1024",
    quality: imageQuality(process.env.OPENAI_IMAGE_QUALITY),
    outputFormat: imageFormat(process.env.OPENAI_IMAGE_FORMAT),
    limit: imageLimit(process.env.OPENAI_MOCKUP_LIMIT)
  };
}

function imageLimit(value: string | undefined) {
  const parsed = value ? Number.parseInt(value, 10) : 3;
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(parsed, 3));
}

function imageQuality(value: string | undefined): ImageGenerationConfig["quality"] {
  if (value === "medium" || value === "high" || value === "auto") return value;
  return "low";
}

function imageFormat(value: string | undefined): ImageGenerationConfig["outputFormat"] {
  if (value === "png" || value === "webp") return value;
  return "jpeg";
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
