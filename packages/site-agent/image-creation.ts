import OpenAI, { toFile } from "openai";
import sharp from "sharp";

export const imageCreationActions = ["generate", "edit"] as const;
export const imageCreationPurposes = ["hero", "section", "background", "gallery", "logo", "other"] as const;
export const imageCreationSizes = ["1536x1024", "1024x1536", "1024x1024"] as const;
export const gptImage2Pricing = {
  textInputUsdPerMillion: 5,
  imageInputUsdPerMillion: 8,
  imageOutputUsdPerMillion: 30
} as const;

export type CreateImageRequest = {
  action: (typeof imageCreationActions)[number];
  purpose: (typeof imageCreationPurposes)[number];
  prompt: string;
  sourceAssetIds: string[];
  size: (typeof imageCreationSizes)[number];
  alt: string;
};

export type CreateImageSource = {
  revisionId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
};

export type ImageCreationUsage = {
  inputTokens: number;
  textInputTokens: number;
  imageInputTokens: number;
  outputTokens: number;
  costUsd: number;
  costSource: "catalog_estimate" | "unavailable";
  durationMs: number;
};

export async function createImageBytes(
  input: CreateImageRequest,
  sources: CreateImageSource[],
  options: { signal?: AbortSignal; client?: OpenAI } = {}
) {
  if (input.action === "generate" && sources.length) throw new Error("Generated images cannot include source assets.");
  if (input.action === "edit" && (sources.length < 1 || sources.length > 4)) {
    throw new Error("Image edits require between one and four source assets.");
  }
  const startedAt = Date.now();
  const client = options.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const common = {
    model: "gpt-image-2",
    prompt: input.prompt,
    n: 1,
    size: input.size,
    quality: "high" as const,
    output_format: "webp" as const,
    output_compression: 90
  };
  const response = input.action === "generate"
    ? await client.images.generate({ ...common, moderation: "auto" }, { signal: options.signal })
    : await client.images.edit({
        ...common,
        input_fidelity: "high",
        image: await Promise.all(sources.map((source, index) =>
          toFile(source.bytes, `source-${index + 1}.${extensionFor(source.mimeType)}`, { type: source.mimeType })
        ))
      }, { signal: options.signal });
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw new Error("Image generation returned no image data.");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > 20_000_000) throw new Error("Generated image exceeded the retained media limit.");
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false }).metadata();
  if (metadata.format !== "webp" || !metadata.width || !metadata.height) {
    throw new Error("Generated image was not a valid WebP image.");
  }
  return {
    bytes,
    mimeType: "image/webp" as const,
    width: metadata.width,
    height: metadata.height,
    sourceAssetRevisionIds: sources.map((source) => source.revisionId),
    usage: imageCreationUsage(response.usage, Date.now() - startedAt)
  };
}

export function imageCreationUsage(value: unknown, durationMs: number): ImageCreationUsage {
  const usage = record(value);
  const details = record(usage?.input_tokens_details);
  const inputTokens = nonnegativeInteger(usage?.input_tokens);
  const textInputTokens = nonnegativeInteger(details?.text_tokens);
  const imageInputTokens = nonnegativeInteger(details?.image_tokens);
  const outputTokens = nonnegativeInteger(usage?.output_tokens);
  if (
    inputTokens === undefined
    || textInputTokens === undefined
    || imageInputTokens === undefined
    || outputTokens === undefined
    || inputTokens !== textInputTokens + imageInputTokens
  ) {
    return {
      inputTokens: inputTokens ?? 0,
      textInputTokens: textInputTokens ?? 0,
      imageInputTokens: imageInputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      costUsd: 0,
      costSource: "unavailable",
      durationMs
    };
  }
  return {
    inputTokens,
    textInputTokens,
    imageInputTokens,
    outputTokens,
    costUsd: (
      textInputTokens * gptImage2Pricing.textInputUsdPerMillion
      + imageInputTokens * gptImage2Pricing.imageInputUsdPerMillion
      + outputTokens * gptImage2Pricing.imageOutputUsdPerMillion
    ) / 1_000_000,
    costSource: "catalog_estimate",
    durationMs
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function extensionFor(mimeType: CreateImageSource["mimeType"]) {
  return mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
}
