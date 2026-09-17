import { sha256 } from "@/packages/business-data";
import sharp from "sharp";

export const sourcePhotoWebRecipeVersion = 1 as const;
export const sourcePhotoMaximumEdge = 2_560 as const;
export const sourcePhotoWebpQuality = 90 as const;
export const sourcePhotoWebpEffort = 4 as const;
const maximumSourcePhotoPixels = 80_000_000;

type SourcePhotoMimeType = "image/png" | "image/jpeg" | "image/webp";
type SourcePhotoOperation = "auto_orient" | "resize_inside" | "encode_webp";

export type PreparedSourcePhoto = {
  bytes: Buffer;
  mimeType: SourcePhotoMimeType;
  contentHash: `sha256:${string}`;
  width: number;
  height: number;
  changed: boolean;
  preparation?: {
    processor: "sharp";
    recipe: "source-photo-web";
    recipeVersion: typeof sourcePhotoWebRecipeVersion;
    sourceContentHash: `sha256:${string}`;
    sourceMimeType: SourcePhotoMimeType;
    sourceWidth: number;
    sourceHeight: number;
    maxEdge: typeof sourcePhotoMaximumEdge;
    outputFormat: "webp";
    quality: typeof sourcePhotoWebpQuality;
    effort: typeof sourcePhotoWebpEffort;
    operations: SourcePhotoOperation[];
  };
};

export async function prepareSourcePhoto(input: {
  bytes: Buffer;
  mimeType: SourcePhotoMimeType;
  sourceContentHash: `sha256:${string}`;
}): Promise<PreparedSourcePhoto> {
  if (sha256(input.bytes) !== input.sourceContentHash) throw new Error("source_photo_content_hash_mismatch");
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(input.bytes, { limitInputPixels: maximumSourcePhotoPixels, animated: false }).metadata();
  } catch (error) {
    throw new Error(isPixelLimitError(error) ? "source_photo_pixel_limit_exceeded" : "source_photo_decode_failed");
  }
  const decodedMimeType = decodedSourcePhotoMimeType(metadata.format);
  if (!decodedMimeType) throw new Error("source_photo_decode_format_unsupported");
  if (decodedMimeType !== input.mimeType) throw new Error("source_photo_mime_mismatch");
  if (!metadata.width || !metadata.height) throw new Error("source_photo_dimensions_missing");
  if (metadata.width * metadata.height > maximumSourcePhotoPixels) throw new Error("source_photo_pixel_limit_exceeded");
  if ((metadata.pages ?? 1) !== 1) throw new Error("source_photo_animation_unsupported");

  const orientation = metadata.orientation ?? 1;
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const sourceWidth = swapsAxes ? metadata.height : metadata.width;
  const sourceHeight = swapsAxes ? metadata.width : metadata.height;
  const requiresOrientation = orientation !== 1;
  const requiresResize = Math.max(sourceWidth, sourceHeight) > sourcePhotoMaximumEdge;
  let candidate: { data: Buffer; info: { width: number; height: number } };
  try {
    candidate = await sharp(input.bytes, { limitInputPixels: maximumSourcePhotoPixels, animated: false })
      .rotate()
      .resize({ width: sourcePhotoMaximumEdge, height: sourcePhotoMaximumEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: sourcePhotoWebpQuality, effort: sourcePhotoWebpEffort })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error("source_photo_preparation_failed");
  }

  const useCandidate = requiresOrientation || requiresResize || candidate.data.byteLength < input.bytes.byteLength;
  if (!useCandidate) {
    return {
      bytes: input.bytes,
      mimeType: input.mimeType,
      contentHash: input.sourceContentHash,
      width: sourceWidth,
      height: sourceHeight,
      changed: false
    };
  }
  const operations: SourcePhotoOperation[] = [];
  if (requiresOrientation) operations.push("auto_orient");
  if (requiresResize) operations.push("resize_inside");
  operations.push("encode_webp");
  return {
    bytes: candidate.data,
    mimeType: "image/webp",
    contentHash: sha256(candidate.data),
    width: candidate.info.width,
    height: candidate.info.height,
    changed: true,
    preparation: {
      processor: "sharp",
      recipe: "source-photo-web",
      recipeVersion: sourcePhotoWebRecipeVersion,
      sourceContentHash: input.sourceContentHash,
      sourceMimeType: input.mimeType,
      sourceWidth,
      sourceHeight,
      maxEdge: sourcePhotoMaximumEdge,
      outputFormat: "webp",
      quality: sourcePhotoWebpQuality,
      effort: sourcePhotoWebpEffort,
      operations
    }
  };
}

function isPixelLimitError(error: unknown) {
  return error instanceof Error && /pixel limit|exceeds.*pixels/i.test(error.message);
}

function decodedSourcePhotoMimeType(format: string | undefined): SourcePhotoMimeType | undefined {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return undefined;
}
