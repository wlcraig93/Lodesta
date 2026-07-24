import sharp from "sharp";
import type { BrowserGateCapture } from "./browser-gate";

export type ArtifactThumbnail = {
  key: string;
  bytes: Buffer;
};

export async function createArtifactThumbnail(
  captures: BrowserGateCapture[],
  capturePrefix: string
): Promise<ArtifactThumbnail | undefined> {
  const homeDesktop = captures.find((capture) => capture.route === "/" && capture.viewport === "desktop");
  if (!homeDesktop) return undefined;
  try {
    const bytes = await sharp(homeDesktop.bytes, { limitInputPixels: 80_000_000 })
      .resize(640, 400, { fit: "cover", position: "north" })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    return {
      key: `${capturePrefix.replace(/\/$/, "")}/thumbnail.webp`,
      bytes
    };
  } catch (error) {
    logThumbnailFailure("encode", error);
    return undefined;
  }
}

export function logThumbnailFailure(stage: "encode" | "store", error: unknown) {
  console.warn(JSON.stringify({
    event: "artifact_thumbnail_skipped",
    stage,
    error: error instanceof Error ? error.name : "unknown"
  }));
}
