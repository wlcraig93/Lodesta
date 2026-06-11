import { readLocalAsset } from "./asset-storage";

/**
 * Pixel palette extraction (craft roadmap, Track 1.1).
 *
 * Samples dominant saturated colors from privately stored scraped media
 * (logo first — it carries the brand) so `deriveBrandThemeV2` finally gets
 * real cues instead of falling back to the preset cream/navy. Uses the
 * Playwright runtime already present for render QA: images decode in a
 * headless page canvas, so no native image dependency is added.
 *
 * Also measures natural dimensions per image, which feeds media casting
 * (wide contextual shots belong in the hero, not detail close-ups).
 */

export type ImagePaletteResult = {
  /** Dominant saturated hexes, strongest first. */
  hexes: string[];
  /** Natural dimensions keyed by storage path. */
  dimensions: Record<string, { width: number; height: number }>;
};

type PlaywrightLike = {
  chromium: { launch(options: { headless: boolean }): Promise<{ newPage(): Promise<PageLike>; close(): Promise<void> }> };
};

type PageLike = {
  evaluate<T>(script: string): Promise<T>;
  close(): Promise<void>;
};

async function loadPlaywright(): Promise<PlaywrightLike | undefined> {
  try {
    return (await import("playwright")) as unknown as PlaywrightLike;
  } catch {
    return undefined;
  }
}

const paletteScript = (dataUrl: string) => `(async () => {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("decode failed"));
    image.src = ${JSON.stringify(dataUrl)};
  });
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const buckets = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const a = pixels[index + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const lightness = (max + min) / 2;
    const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
    // Only saturated, mid-lightness pixels carry brand signal.
    if (saturation < 0.28 || lightness < 0.12 || lightness > 0.88) continue;
    const key = [Math.round(r / 24), Math.round(g / 24), Math.round(b / 24)].join(",");
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  // Dedupe by hue family: one winner per 30-degree band, so the brand's
  // distinct hues (yellow AND blue AND red) all survive instead of five
  // shades of the loudest one.
  const byHueBand = new Map();
  for (const bucket of buckets.values()) {
    if (bucket.count < 12) continue;
    const r = bucket.r / bucket.count / 255;
    const g = bucket.g / bucket.count / 255;
    const b = bucket.b / bucket.count / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue = 0;
    if (max !== min) {
      const d = max - min;
      if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) hue = ((b - r) / d + 2) * 60;
      else hue = ((r - g) / d + 4) * 60;
    }
    const band = Math.floor(hue / 30);
    const existing = byHueBand.get(band);
    if (!existing || bucket.count > existing.count) byHueBand.set(band, bucket);
  }
  const ranked = [...byHueBand.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 4)
    .map((bucket) => {
      const toHex = (value) => Math.round(value / bucket.count).toString(16).padStart(2, "0");
      return "#" + toHex(bucket.r) + toHex(bucket.g) + toHex(bucket.b);
    });
  return { hexes: ranked, width: image.naturalWidth, height: image.naturalHeight };
})()`;

export async function extractImagePalette(storagePaths: string[]): Promise<ImagePaletteResult> {
  const result: ImagePaletteResult = { hexes: [], dimensions: {} };
  if (!storagePaths.length) return result;
  const playwright = await loadPlaywright();
  if (!playwright) return result;
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      const seen = new Set<string>();
      for (const storagePath of storagePaths.slice(0, 8)) {
        const asset = await readLocalAsset(storagePath);
        if (!asset) continue;
        const dataUrl = `data:${asset.mimeType};base64,${asset.bytes.toString("base64")}`;
        try {
          const sampled = await page.evaluate<{ hexes: string[]; width: number; height: number }>(paletteScript(dataUrl));
          result.dimensions[storagePath] = { width: sampled.width, height: sampled.height };
          for (const hex of sampled.hexes) {
            if (!seen.has(hex)) {
              seen.add(hex);
              result.hexes.push(hex);
            }
          }
        } catch {
          // Per-image failures are non-fatal; remaining images still sample.
        }
      }
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return result;
}
