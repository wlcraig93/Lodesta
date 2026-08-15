import { chromium } from "playwright";
import sharp from "sharp";
import type { BrowserGateCapture } from "./browser-gate";

export type ArtifactContactSheet = {
  viewport: "desktop" | "mobile";
  bytes: Buffer;
  captureCount: number;
};

export async function createArtifactContactSheets(
  captures: BrowserGateCapture[],
  selectedRoutes?: string[],
  expectedDimensions: Partial<Record<"desktop" | "mobile", { width: number; height: number }>> = {}
): Promise<ArtifactContactSheet[]> {
  const routes = selectedRoutes?.length
    ? selectedRoutes.slice(0, 3)
    : [...new Set(captures.map((capture) => capture.route))].slice(0, 3);
  const selected = captures.filter((capture) =>
    capture.stage !== "natural"
    && capture.viewport !== "tablet"
    && routes.includes(capture.route)
  );
  if (!selected.length) {
    throw new Error("A visual review contact sheet requires settled browser captures.");
  }
  await assertNativeViewportFrames(selected, expectedDimensions);
  const sheets: ArtifactContactSheet[] = [];
  for (const viewport of ["desktop", "mobile"] as const) {
    const viewportCaptures = selected.filter((capture) => capture.viewport === viewport);
    if (!viewportCaptures.length) continue;
    sheets.push({
      viewport,
      bytes: await renderContactSheet(viewportCaptures, viewport, expectedDimensions[viewport]),
      captureCount: viewportCaptures.length
    });
  }
  return sheets;
}

export async function createArtifactContactSheet(
  captures: BrowserGateCapture[],
  selectedRoutes?: string[]
) {
  const sheets = await createArtifactContactSheets(captures, selectedRoutes);
  if (sheets.length === 1) return sheets[0].bytes;
  const composites = await Promise.all(sheets.map(async (sheet) => {
    const metadata = await sharp(sheet.bytes).metadata();
    return {
      input: sheet.bytes,
      top: 0,
      left: 0,
      width: metadata.width ?? 1,
      height: metadata.height ?? 1
    };
  }));
  const width = Math.max(...composites.map((item) => item.width));
  let top = 0;
  const inputs = composites.map((item) => {
    const result = { input: item.input, top, left: 0 };
    top += item.height;
    return result;
  });
  return sharp({
    create: {
      width,
      height: top,
      channels: 3,
      background: "#d7d9dc"
    }
  }).composite(inputs).png().toBuffer();
}

/**
 * Produces a complete, labeled route-family review without shrinking every
 * representative page type into one unreadable image. The ordinary artifact
 * contact sheet deliberately remains capped at three routes.
 */
export async function createArtifactRouteFamilyContactSheets(
  captures: BrowserGateCapture[],
  selectedRoutes: readonly string[],
  routesPerSheet = 3
) {
  const routeGroups = routeFamilyContactSheetRouteGroups(captures, selectedRoutes, routesPerSheet);
  const sheets: Array<{ routes: string[]; bytes: Buffer }> = [];
  for (const chunk of routeGroups) {
    sheets.push({
      routes: chunk,
      bytes: await createArtifactContactSheet(captures, chunk)
    });
  }
  return sheets;
}

export function routeFamilyContactSheetRouteGroups(
  captures: Pick<BrowserGateCapture, "route">[],
  selectedRoutes: readonly string[],
  routesPerSheet = 3
) {
  if (!Number.isInteger(routesPerSheet) || routesPerSheet < 1) {
    throw new Error("Route-family contact sheets require a positive routes-per-sheet value.");
  }
  const available = new Set(captures.map((capture) => capture.route));
  const routes = [...new Set(selectedRoutes)].filter((route) => available.has(route));
  const groups: string[][] = [];
  for (let index = 0; index < routes.length; index += routesPerSheet) {
    groups.push(routes.slice(index, index + routesPerSheet));
  }
  return groups;
}

async function assertNativeViewportFrames(
  captures: BrowserGateCapture[],
  overrides: Partial<Record<"desktop" | "mobile", { width: number; height: number }>>
) {
  const expected = {
    desktop: { width: 1280, height: 900 },
    mobile: { width: 390, height: 844 },
    ...overrides
  } as const;
  for (const capture of captures) {
    const metadata = await sharp(capture.bytes, { limitInputPixels: 80_000_000 }).metadata();
    const dimensions = expected[capture.viewport as "desktop" | "mobile"];
    if (
      !capture.frame
      || metadata.width !== dimensions.width
      || metadata.height !== dimensions.height
    ) {
      throw new Error(
        `Malformed ${capture.viewport} visual evidence for ${capture.route}: expected a labeled ${dimensions.width}×${dimensions.height} native viewport frame, received ${metadata.width ?? 0}×${metadata.height ?? 0}.`
      );
    }
  }
}

async function renderContactSheet(
  captures: BrowserGateCapture[],
  viewport: "desktop" | "mobile",
  dimensions?: { width: number; height: number }
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      deviceScaleFactor: 1
    });
    const cards = captures.map((capture) => `
      <article>
        <header>${escapeHtml(capture.route)} · ${capture.viewport} · ${capture.frame}</header>
        <img src="data:image/png;base64,${capture.bytes.toString("base64")}" alt="">
      </article>
    `).join("");
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}
      body{margin:0;padding:24px;background:#d7d9dc;color:#17191c;font:16px Arial,sans-serif}
      h1{margin:0 0 18px;font-size:22px}
      main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:start}
      article{background:#fff;border:1px solid #aeb2b7;box-shadow:0 3px 12px rgba(0,0,0,.12);overflow:hidden}
      header{padding:10px 12px;background:#17191c;color:#fff;font-weight:700}
      img{display:block;width:100%;height:auto;background:#f4f4f4}
    </style></head><body><h1>${viewport === "desktop" ? "Desktop" : "Mobile"} · ${dimensions?.width ?? (viewport === "desktop" ? 1280 : 390)}×${dimensions?.height ?? (viewport === "desktop" ? 900 : 844)} native frames</h1><main>${cards}</main></body></html>`, {
      waitUntil: "load"
    });
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete && image.naturalWidth > 0)
    );
    return Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
  } finally {
    await browser.close();
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
