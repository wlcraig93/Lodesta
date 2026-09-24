import { chromium } from "playwright";
import sharp from "sharp";
import { sha256 } from "@/packages/business-data";
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
 * Author-inspection image budget. Every image is sent at explicit `high`
 * detail, which caps an image at 2,500 32px patches (larger images are
 * downscaled by the provider). `auto` is never used: some models treat it as
 * uncapped original detail, and `low` cannot read page text.
 */
export const authorInspectionImageDetail = "high" as const;
export const authorInspectionPatchCap = 2_500;
/** Desktop full pages are pre-scaled to this width; phone full pages stay native. */
export const authorInspectionDesktopFullWidth = 640;
/** Changed routes (beyond the homepage) that receive full-page images by default. */
export const authorInspectionChangedFullPageLimit = 2;

export function imagePatchCount(width: number, height: number) {
  return Math.ceil(width / 32) * Math.ceil(height / 32);
}

/** Estimated input tokens for one `high` image (about 1.2 tokens per 32px patch, capped). */
export function estimatedHighDetailImageTokens(width: number, height: number) {
  return Math.ceil(Math.min(imagePatchCount(width, height), authorInspectionPatchCap) * 1.2);
}

/** Largest proportional size at or under `width`×`height` that fits the patch cap. */
export function fitWithinPatchCap(width: number, height: number, cap = authorInspectionPatchCap) {
  if (imagePatchCount(width, height) <= cap) return { width, height };
  let scale = Math.sqrt((cap * 1024) / (width * height));
  for (;;) {
    const scaledWidth = Math.max(1, Math.floor(width * scale));
    const scaledHeight = Math.max(1, Math.floor(height * scale));
    if (imagePatchCount(scaledWidth, scaledHeight) <= cap) return { width: scaledWidth, height: scaledHeight };
    scale *= 0.99;
  }
}

export type AuthorInspectionImageEvidence = {
  imageIndex: number;
  kind: "full-page" | "first-viewport-sheet" | "navigation" | "tablet" | "focus";
  route?: string;
  routes?: string[];
  viewport?: "desktop" | "tablet" | "mobile";
  focusSelector?: string;
  width: number;
  height: number;
  /** Image pixels per page CSS pixel; below 1 means the page was scaled down. */
  scale: number;
  detail: typeof authorInspectionImageDetail;
  estimatedTokens: number;
  contentHash: `sha256:${string}`;
  byteLength: number;
};

export type AuthorInspectionImages = {
  images: Array<{ bytes: Buffer; evidence: AuthorInspectionImageEvidence }>;
  /** Per-route hash of the settled full-page desktop and phone pixels. */
  routeRenderHashes: Record<string, `sha256:${string}`>;
  fullPageRoutes: string[];
  changedRoutes: string[];
};

const inspectionPixelLimit = 200_000_000;

/**
 * Compose the author's inspection images from review captures: full-page
 * desktop (pre-scaled to 640px wide) and phone images for the homepage,
 * requested routes and up to two routes whose pixels changed since the
 * previous inspection; one labelled first-viewport sheet (desktop beside
 * phone) for every other inspected route; the opened homepage phone
 * navigation once. Tablet and focus frames pass through. Every image fits the
 * `high` patch cap.
 */
export async function createAuthorInspectionImages(input: {
  captures: BrowserGateCapture[];
  routes: readonly string[];
  requestedFullRoutes?: readonly string[];
  previousRouteRenderHashes?: Readonly<Record<string, string>>;
  viewportHeights?: { desktop: number; mobile: number };
}): Promise<AuthorInspectionImages> {
  const routes = [...new Set(input.routes)];
  const settled = input.captures.filter((capture) => capture.stage === "settled" && routes.includes(capture.route));
  if (!settled.length) throw new Error("Visual inspection requires settled browser frames.");
  for (const capture of settled) {
    const metadata = await sharp(capture.bytes, { limitInputPixels: inspectionPixelLimit }).metadata();
    if (!capture.frame || metadata.format !== "png" || !metadata.width || !metadata.height) {
      throw new Error(`Malformed visual inspection frame for ${capture.route}: expected a labeled PNG.`);
    }
  }
  const fullCapture = (route: string, viewport: "desktop" | "mobile") => settled.find((capture) =>
    capture.route === route && capture.viewport === viewport && capture.frame === "full");
  const routeRenderHashes: Record<string, `sha256:${string}`> = {};
  for (const route of routes) {
    const desktop = fullCapture(route, "desktop");
    const mobile = fullCapture(route, "mobile");
    if (desktop && mobile) routeRenderHashes[route] = sha256(`${sha256(desktop.bytes)}\n${sha256(mobile.bytes)}`);
  }
  const previous = input.previousRouteRenderHashes;
  const changedRoutes = previous
    ? routes.filter((route) => routeRenderHashes[route] && previous[route] !== routeRenderHashes[route])
    : [];
  const requested = new Set(input.requestedFullRoutes ?? []);
  const changedFull = changedRoutes
    .filter((route) => route !== "/" && !requested.has(route))
    .slice(0, authorInspectionChangedFullPageLimit);
  const fullPageRoutes = routes.filter((route) => routeRenderHashes[route]
    && (route === "/" || requested.has(route) || changedFull.includes(route)));
  const sheetRoutes = routes.filter((route) => routeRenderHashes[route] && !fullPageRoutes.includes(route));
  type Pending = { bytes: Buffer; evidence: Pick<AuthorInspectionImageEvidence, "kind" | "route" | "routes" | "viewport" | "focusSelector" | "scale"> };
  const pending: Pending[] = [];
  for (const route of fullPageRoutes) {
    for (const viewport of ["desktop", "mobile"] as const) {
      const capture = fullCapture(route, viewport)!;
      const metadata = await sharp(capture.bytes, { limitInputPixels: inspectionPixelLimit }).metadata();
      const sourceWidth = metadata.width!;
      const width = viewport === "desktop" ? Math.min(authorInspectionDesktopFullWidth, sourceWidth) : sourceWidth;
      const target = fitWithinPatchCap(width, Math.max(1, Math.round(metadata.height! * (width / sourceWidth))));
      pending.push({
        bytes: target.width === sourceWidth ? capture.bytes : await resizePng(capture.bytes, target.width, target.height),
        evidence: { kind: "full-page", route, viewport, scale: target.width / sourceWidth }
      });
    }
  }
  const navigation = settled.find((capture) => capture.frame === "navigation" && capture.route === "/")
    ?? settled.find((capture) => capture.frame === "navigation");
  if (navigation) {
    pending.push({ bytes: navigation.bytes, evidence: { kind: "navigation", route: navigation.route, viewport: navigation.viewport, scale: 1 } });
  }
  if (sheetRoutes.length) {
    const sheet = await renderFirstViewportSheet(sheetRoutes.map((route) => ({
      route,
      desktop: fullCapture(route, "desktop")!.bytes,
      mobile: fullCapture(route, "mobile")!.bytes
    })), input.viewportHeights ?? { desktop: 900, mobile: 844 });
    pending.push({ bytes: sheet.bytes, evidence: { kind: "first-viewport-sheet", routes: sheetRoutes, scale: sheet.scale } });
  }
  for (const route of routes) {
    for (const capture of settled.filter((item) => item.route === route
      && (item.frame === "focus" || (item.viewport === "tablet" && item.frame === "top")))) {
      pending.push({
        bytes: capture.bytes,
        evidence: {
          kind: capture.frame === "focus" ? "focus" : "tablet",
          route,
          viewport: capture.viewport,
          ...(capture.focusSelector ? { focusSelector: capture.focusSelector } : {}),
          scale: 1
        }
      });
    }
  }
  const images = await Promise.all(pending.map(async (image, index) => {
    const metadata = await sharp(image.bytes, { limitInputPixels: inspectionPixelLimit }).metadata();
    const width = metadata.width ?? 1;
    const height = metadata.height ?? 1;
    const fitted = fitWithinPatchCap(width, height);
    const bytes = fitted.width === width && fitted.height === height
      ? image.bytes
      : await resizePng(image.bytes, fitted.width, fitted.height);
    const evidence: AuthorInspectionImageEvidence = {
      imageIndex: index + 1,
      ...image.evidence,
      scale: Math.round(image.evidence.scale * (fitted.width / width) * 1000) / 1000,
      width: fitted.width,
      height: fitted.height,
      detail: authorInspectionImageDetail,
      estimatedTokens: estimatedHighDetailImageTokens(fitted.width, fitted.height),
      contentHash: sha256(bytes),
      byteLength: bytes.byteLength
    };
    return { bytes, evidence };
  }));
  return { images, routeRenderHashes, fullPageRoutes, changedRoutes };
}

async function resizePng(bytes: Buffer, width: number, height: number) {
  return sharp(bytes, { limitInputPixels: inspectionPixelLimit })
    .resize({ width, height, fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
}

/** Desktop and phone first viewports side by side per route, labelled by route. */
async function renderFirstViewportSheet(
  rows: Array<{ route: string; desktop: Buffer; mobile: Buffer }>,
  viewportHeights: { desktop: number; mobile: number }
) {
  const desktopTileWidth = 560;
  let scale = 1;
  const cards: string[] = [];
  for (const row of rows) {
    const desktopTop = await firstViewport(row.desktop, viewportHeights.desktop);
    const mobileTop = await firstViewport(row.mobile, viewportHeights.mobile);
    scale = desktopTileWidth / desktopTop.width;
    cards.push(`<article><header>${escapeHtml(row.route)}</header><div class="pair">`
      + `<img class="desktop" src="data:image/png;base64,${desktopTop.bytes.toString("base64")}" alt="">`
      + `<img class="mobile" src="data:image/png;base64,${mobileTop.bytes.toString("base64")}" alt="">`
      + `</div></article>`);
  }
  const tileHeight = Math.round(viewportHeights.desktop * scale);
  const columns = rows.length > 4 ? 2 : 1;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}
      body{margin:0;padding:12px;width:max-content;background:#d7d9dc;color:#17191c;font:700 18px Arial,sans-serif}
      main{display:grid;grid-template-columns:repeat(${columns},max-content);gap:12px;align-items:start}
      article{background:#fff;border:1px solid #aeb2b7;padding:0 8px 8px}
      header{padding:6px 0}
      .pair{display:flex;gap:10px;align-items:flex-start}
      .desktop{display:block;width:${desktopTileWidth}px;height:auto}
      .mobile{display:block;height:${tileHeight}px;width:auto}
    </style></head><body><main>${cards.join("")}</main></body></html>`, { waitUntil: "load" });
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    return {
      bytes: Buffer.from(await page.screenshot({ fullPage: true, type: "png" })),
      scale
    };
  } finally {
    await browser.close();
  }
}

async function firstViewport(bytes: Buffer, viewportHeight: number) {
  const metadata = await sharp(bytes, { limitInputPixels: inspectionPixelLimit }).metadata();
  const width = metadata.width!;
  return {
    width,
    bytes: await sharp(bytes, { limitInputPixels: inspectionPixelLimit })
      .extract({ left: 0, top: 0, width, height: Math.min(viewportHeight, metadata.height!) })
      .png()
      .toBuffer()
  };
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
