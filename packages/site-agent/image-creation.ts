import OpenAI, { toFile } from "openai";
import sharp from "sharp";

export const imageCreationActions = ["generate", "edit"] as const;
export const imageCreationPurposes = ["hero", "section", "background", "gallery", "logo", "other"] as const;
export const imageCreationSizes = ["1536x1024", "1024x1536", "1024x1024"] as const;

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

export async function createImageBytes(
  input: CreateImageRequest,
  sources: CreateImageSource[],
  options: { signal?: AbortSignal; client?: OpenAI } = {}
) {
  if (input.action === "generate" && sources.length) throw new Error("Generated images cannot include source assets.");
  if (input.action === "edit" && (sources.length < 1 || sources.length > 4)) {
    throw new Error("Image edits require between one and four source assets.");
  }
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
    sourceAssetRevisionIds: sources.map((source) => source.revisionId)
  };
}

function extensionFor(mimeType: CreateImageSource["mimeType"]) {
  return mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
}
