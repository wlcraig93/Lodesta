import { readFile } from "node:fs/promises";
import { storeAssetBytes } from "./asset-storage";
import type { GenerationQaPrimaryScreenshot, RenderInspectionArtifactRef, SiteVersion } from "./models";

/**
 * Copies the lead QA render screenshot from its ephemeral inspection
 * directory into durable asset storage and records the pointer on the
 * version's generation QA metadata. Must run before the candidate bundle is
 * persisted so the pointer is serialized with it. Pass `screenshots` to use
 * refs from a fresh inspection instead of the ones stored on QA metadata
 * (whose temp files may no longer exist), e.g. during backfill.
 */
export async function persistPrimaryQaScreenshot(input: {
  candidateId: string;
  version: SiteVersion;
  screenshots?: RenderInspectionArtifactRef[];
}): Promise<GenerationQaPrimaryScreenshot | undefined> {
  const qa = input.version.generationQa;
  if (!qa) return undefined;
  const refs = input.screenshots ?? qa.artifactRefs ?? [];
  // Above-the-fold JPEG thumbnails (~100KB) beat full-page PNGs (~3MB) for
  // queue cards; fall back to the full desktop capture for older inspections.
  const primary =
    refs.find((ref) => ref.path?.includes("-fold.")) ??
    refs.find((ref) => ref.viewport === "desktop" && ref.path) ??
    refs.find((ref) => ref.path);
  if (!primary?.path) return undefined;
  const bytes = await readFile(primary.path).catch(() => undefined);
  if (!bytes) return undefined;
  const stored = await storeAssetBytes({
    siteId: input.candidateId,
    assetId: `qa-screenshot-${primary.viewport}`,
    bytes,
    mimeType: primary.path.endsWith(".jpg") || primary.path.endsWith(".jpeg") ? "image/jpeg" : "image/png",
    publicUrl: false
  });
  qa.primaryScreenshot = {
    storagePath: stored.storagePath,
    viewport: primary.viewport,
    width: primary.width,
    height: primary.height,
    capturedAt: primary.capturedAt
  };
  return qa.primaryScreenshot;
}
