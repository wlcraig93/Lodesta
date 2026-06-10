import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

type RenderFile = {
  screenshots?: Array<{
    viewport?: string;
    path?: string;
  }>;
};

export type MarketBenchmarkScreenshotInput = {
  runId: string;
  siteId: string;
  viewport: string;
};

export type MarketBenchmarkScreenshotResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

const benchmarkRoot = join(process.cwd(), ".data", "market-benchmarks", "austin-auto");
const safeSegmentPattern = /^[a-z0-9_.-]+$/i;
const allowedViewports = new Set(["desktop", "tablet", "mobile"]);

export async function readMarketBenchmarkScreenshot(input: MarketBenchmarkScreenshotInput): Promise<MarketBenchmarkScreenshotResult> {
  if (!isSafeSegment(input.runId) || !isSafeSegment(input.siteId) || !allowedViewports.has(input.viewport)) {
    return { ok: false, status: 400, error: "Invalid benchmark screenshot request" };
  }

  const runRoot = resolve(benchmarkRoot, input.runId);
  const siteRoot = resolve(runRoot, "sites", input.siteId);
  if (!isInside(resolve(benchmarkRoot), runRoot) || !isInside(runRoot, siteRoot)) {
    return { ok: false, status: 400, error: "Invalid benchmark path" };
  }

  const render = await readJson<RenderFile>(join(siteRoot, "render.json"));
  const screenshot = render?.screenshots?.find((item) => item.viewport === input.viewport && item.path);
  if (!screenshot?.path) {
    return { ok: false, status: 404, error: "Screenshot not found" };
  }

  const screenshotPath = resolve(screenshot.path);
  if (!isInside(runRoot, screenshotPath) || !isSupportedImage(screenshotPath)) {
    return { ok: false, status: 400, error: "Screenshot path is not allowed" };
  }

  const file = await readFile(screenshotPath).catch(() => undefined);
  if (!file) return { ok: false, status: 404, error: "Screenshot not found" };

  return {
    ok: true,
    bytes: new Uint8Array(file),
    contentType: contentTypeForPath(screenshotPath)
  };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function isSafeSegment(value: string) {
  return Boolean(value && safeSegmentPattern.test(value));
}

function isInside(parent: string, child: string) {
  const result = relative(parent, child);
  return Boolean(result && !result.startsWith("..") && !result.startsWith("/") && result !== "..");
}

function isSupportedImage(path: string) {
  return [".png", ".jpg", ".jpeg", ".webp"].includes(extname(path).toLowerCase());
}

function contentTypeForPath(path: string) {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}
