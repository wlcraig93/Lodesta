import sharp, { type Metadata, type Sharp } from "sharp";

export const logoPresentationRecipeVersion = 1 as const;

export type PreparedLogoPresentation = {
  status: "prepared";
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  changed: boolean;
  operations: Array<"trim_transparent_canvas" | "trim_uniform_canvas" | "remove_uniform_background">;
  sourceWidth: number;
  sourceHeight: number;
  contentBounds: { left: number; top: number; width: number; height: number };
  backgroundColor?: string;
  confidence: number;
};

export type UnusableLogoPresentation = {
  status: "unusable";
  reason: "decode_failed" | "dimensions_missing" | "pixel_limit_exceeded" | "empty_content";
  message: string;
};

export type LogoPresentationPreparation = PreparedLogoPresentation | UnusableLogoPresentation;

const maximumAnalyzedPixels = 12_000_000;
const transparentContentThreshold = 8;
const uniformCornerTolerance = 10;
const uniformBorderTolerance = 20;
const removableBackgroundTolerance = 48;

/**
 * Creates a presentation derivative without redrawing or recoloring the mark.
 * Only empty transparent canvas and high-confidence uniform neutral
 * backgrounds are removed. Every retained foreground pixel keeps its original
 * RGB value.
 */
export async function prepareLogoPresentation(input: {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}): Promise<LogoPresentationPreparation> {
  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(input.bytes, { limitInputPixels: 80_000_000, animated: false }).rotate();
    metadata = await image.metadata();
  } catch (error) {
    return unusable("decode_failed", error);
  }
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (!sourceWidth || !sourceHeight) return unusable("dimensions_missing");
  if (sourceWidth * sourceHeight > maximumAnalyzedPixels) return unusable("pixel_limit_exceeded");

  let data: Buffer;
  let info: { width: number; height: number };
  try {
    const result = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    data = result.data;
    info = result.info;
  } catch (error) {
    return unusable("decode_failed", error);
  }
  const width = info.width;
  const height = info.height;
  const pixels = width * height;
  const hasTransparency = hasVisibleTransparency(data, pixels);
  const opaqueBackgroundCandidate = opaqueBorderShare(data, width, height) >= 0.99;
  const operations: PreparedLogoPresentation["operations"] = [];
  let backgroundColor: string | undefined;
  let confidence = hasTransparency && !opaqueBackgroundCandidate ? 1 : 0;

  if (opaqueBackgroundCandidate) {
    const background = analyzeNeutralBorder(data, width, height);
    if (background) {
      const removedPixels = removeUniformBackground(data, width, height, background.rgb);
      if (removedPixels / pixels >= 0.08) {
        operations.push("remove_uniform_background");
        backgroundColor = rgbHex(background.rgb);
        confidence = background.confidence;
      }
    }
  }

  const alphaBounds = boundsForAlpha(data, width, height);
  if (!alphaBounds) return unusable("empty_content");
  const paddedBounds = addContentPadding(alphaBounds, width, height);
  const trimmed = paddedBounds.left > 0
    || paddedBounds.top > 0
    || paddedBounds.width < width
    || paddedBounds.height < height;

  if (trimmed) {
    operations.push(hasTransparency || operations.includes("remove_uniform_background")
      ? "trim_transparent_canvas"
      : "trim_uniform_canvas");
  }
  if (!operations.length) {
    return {
      status: "prepared",
      ...unchanged(input, width, height),
      contentBounds: alphaBounds,
      confidence
    };
  }

  const output = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract(paddedBounds)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return {
    status: "prepared",
    bytes: output,
    mimeType: "image/png",
    width: paddedBounds.width,
    height: paddedBounds.height,
    changed: true,
    operations: unique(operations),
    sourceWidth: width,
    sourceHeight: height,
    contentBounds: alphaBounds,
    ...(backgroundColor ? { backgroundColor } : {}),
    confidence
  };
}

function unchanged(
  input: { bytes: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp" },
  width: number,
  height: number
): Omit<PreparedLogoPresentation, "status"> {
  return {
    bytes: input.bytes,
    mimeType: input.mimeType,
    width,
    height,
    changed: false,
    operations: [],
    sourceWidth: width,
    sourceHeight: height,
    contentBounds: { left: 0, top: 0, width, height },
    confidence: 0
  };
}

function unusable(reason: UnusableLogoPresentation["reason"], error?: unknown): UnusableLogoPresentation {
  const detail = error instanceof Error ? error.message : error ? String(error) : undefined;
  return {
    status: "unusable",
    reason,
    message: detail ? `${reason}: ${detail}` : reason
  };
}

function hasVisibleTransparency(data: Buffer, pixels: number) {
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (data[pixel * 4 + 3]! < 250) return true;
  }
  return false;
}

function opaqueBorderShare(data: Buffer, width: number, height: number) {
  const border = borderIndexes(width, height);
  if (!border.length) return 0;
  let opaque = 0;
  for (const index of border) {
    if (data[index * 4 + 3]! >= 250) opaque += 1;
  }
  return opaque / border.length;
}

function analyzeNeutralBorder(data: Buffer, width: number, height: number) {
  const corners = [
    rgbAt(data, 0),
    rgbAt(data, width - 1),
    rgbAt(data, (height - 1) * width),
    rgbAt(data, height * width - 1)
  ];
  const rgb = averageRgb(corners);
  if (corners.some((corner) => colorDistance(corner, rgb) > uniformCornerTolerance)) return undefined;
  if (Math.max(...rgb) - Math.min(...rgb) > 12 || rgb[0] < 232) return undefined;

  const border = borderIndexes(width, height);
  let matching = 0;
  for (const index of border) {
    if (colorDistance(rgbAt(data, index), rgb) <= uniformBorderTolerance) matching += 1;
  }
  const confidence = matching / border.length;
  return confidence >= 0.985 ? { rgb, confidence } : undefined;
}

function removeUniformBackground(
  data: Buffer,
  width: number,
  height: number,
  background: readonly [number, number, number]
) {
  const pixels = width * height;
  let removed = 0;
  for (let index = 0; index < pixels; index += 1) {
    if (colorDistance(rgbAt(data, index), background) > removableBackgroundTolerance) continue;
    data[index * 4 + 3] = 0;
    removed += 1;
  }
  return removed;
}

function boundsForAlpha(data: Buffer, width: number, height: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! <= transparentContentThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top
    ? undefined
    : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function addContentPadding(
  bounds: { left: number; top: number; width: number; height: number },
  width: number,
  height: number
) {
  const padding = Math.max(2, Math.min(32, Math.round(Math.max(bounds.width, bounds.height) * 0.02)));
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const right = Math.min(width, bounds.left + bounds.width + padding);
  const bottom = Math.min(height, bounds.top + bounds.height + padding);
  return { left, top, width: right - left, height: bottom - top };
}

function borderIndexes(width: number, height: number) {
  const indexes: number[] = [];
  const step = Math.max(1, Math.floor((width * 2 + height * 2) / 2_000));
  for (let x = 0; x < width; x += step) {
    indexes.push(x, (height - 1) * width + x);
  }
  for (let y = step; y < height - step; y += step) {
    indexes.push(y * width, y * width + width - 1);
  }
  return indexes;
}

function rgbAt(data: Buffer, pixel: number): [number, number, number] {
  const offset = pixel * 4;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

function averageRgb(colors: Array<readonly [number, number, number]>): [number, number, number] {
  return [0, 1, 2].map((channel) => Math.round(colors.reduce((sum, color) => sum + color[channel]!, 0) / colors.length)) as [number, number, number];
}

function colorDistance(left: readonly number[], right: readonly number[]) {
  return Math.max(Math.abs(left[0]! - right[0]!), Math.abs(left[1]! - right[1]!), Math.abs(left[2]! - right[2]!));
}

function rgbHex(rgb: readonly number[]) {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
