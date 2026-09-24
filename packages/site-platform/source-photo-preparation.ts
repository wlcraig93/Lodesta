import { sha256 } from "@/packages/business-data";
import sharp from "sharp";

export const sourcePhotoWebRecipeVersion = 1 as const;
export const sourcePhotoMaximumEdge = 2_560 as const;
export const sourcePhotoWebpQuality = 90 as const;
export const sourcePhotoWebpEffort = 4 as const;
const maximumSourcePhotoPixels = 80_000_000;

type SourcePhotoMimeType = "image/png" | "image/jpeg" | "image/webp";
type SourcePhotoOperation = "auto_orient" | "resize_inside" | "encode_webp" | "decoded_type" | "first_frame";

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
    declaredMimeType?: string;
    sourceWidth: number;
    sourceHeight: number;
    maxEdge: typeof sourcePhotoMaximumEdge;
    outputFormat: "webp";
    quality: typeof sourcePhotoWebpQuality;
    effort: typeof sourcePhotoWebpEffort;
    operations: SourcePhotoOperation[];
  };
};

/**
 * Prepares one retained source photo. The decoded format is trusted over the
 * declared content type (a mislabeled JPEG is still a JPEG), and an animated
 * image contributes its first frame. Both corrections are recorded in the
 * preparation provenance and always produce a re-encoded single-frame WebP.
 */
export async function prepareSourcePhoto(input: {
  bytes: Buffer;
  mimeType: string;
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
  const declaredTypeCorrected = decodedMimeType !== input.mimeType;
  const animated = (metadata.pages ?? 1) > 1;
  // For an animated image sharp reports the first frame's height via pageHeight.
  const frameHeight = animated ? metadata.pageHeight ?? metadata.height : metadata.height;
  if (!metadata.width || !frameHeight) throw new Error("source_photo_dimensions_missing");
  if (metadata.width * frameHeight > maximumSourcePhotoPixels) throw new Error("source_photo_pixel_limit_exceeded");

  const orientation = metadata.orientation ?? 1;
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const sourceWidth = swapsAxes ? frameHeight : metadata.width;
  const sourceHeight = swapsAxes ? metadata.width : frameHeight;
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

  const useCandidate = requiresOrientation || requiresResize || declaredTypeCorrected || animated
    || candidate.data.byteLength < input.bytes.byteLength;
  if (!useCandidate) {
    return {
      bytes: input.bytes,
      mimeType: decodedMimeType,
      contentHash: input.sourceContentHash,
      width: sourceWidth,
      height: sourceHeight,
      changed: false
    };
  }
  const operations: SourcePhotoOperation[] = [];
  if (declaredTypeCorrected) operations.push("decoded_type");
  if (animated) operations.push("first_frame");
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
      sourceMimeType: decodedMimeType,
      ...(declaredTypeCorrected ? { declaredMimeType: input.mimeType.slice(0, 120) } : {}),
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
