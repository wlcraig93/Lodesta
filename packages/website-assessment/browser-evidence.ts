import axeCore from "axe-core";
import { generationCrawlerUserAgent } from "@/packages/business-data/robots-policy";
import { assertPublicFetchUrl } from "@/lib/url-safety";

export type PerformanceMetric = {
  value?: number;
  rating: "good" | "needs_improvement" | "poor" | "unknown";
  unit: "ms" | "score";
};

export type WebPerformanceEvidence = {
  source: "crux_field" | "lab_median" | "unavailable";
  formFactor: "PHONE";
  lcp: PerformanceMetric;
  inp: PerformanceMetric;
  cls: PerformanceMetric;
  ttfb: PerformanceMetric;
  sampleCount: number;
  observedAt: string;
  limitation?: string;
};

export type AccessibilityViolation = {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | "unknown";
  description: string;
  help: string;
  helpUrl: string;
  nodeCount: number;
  samples: string[];
};

export type AutomatedAccessibilityEvidence = {
  adapter: "axe-core" | "unavailable";
  version?: string;
  violations: AccessibilityViolation[];
  observedAt: string;
  limitation?: string;
};

type LabSample = {
  lcp?: number;
  cls?: number;
  ttfb?: number;
};

export async function collectBrowserEvidence(input: {
  url: string;
  cruxApiKey?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}) {
  const observedAt = new Date().toISOString();
  const field = input.cruxApiKey
    ? await readCrux(input.url, input.cruxApiKey, input.fetchImpl ?? fetch, input.signal).catch(() => undefined)
    : undefined;
  const browser = await runBrowserEvidence({
    url: input.url,
    sampleCount: field ? 1 : 3,
    signal: input.signal
  }).catch((error) => ({
    samples: [] as LabSample[],
    accessibility: {
      adapter: "unavailable" as const,
      violations: [],
      observedAt,
      limitation: error instanceof Error ? error.message : String(error)
    }
  }));
  const performance = field ?? labPerformance(browser.samples, observedAt);
  return { performance, accessibility: browser.accessibility };
}

async function readCrux(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<WebPerformanceEvidence | undefined> {
  const origin = new URL(url).origin;
  const response = await fetchImpl(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": generationCrawlerUserAgent
    },
    body: JSON.stringify({
      origin,
      formFactor: "PHONE",
      metrics: [
        "largest_contentful_paint",
        "interaction_to_next_paint",
        "cumulative_layout_shift",
        "experimental_time_to_first_byte"
      ]
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`CrUX query returned HTTP ${response.status}.`);
  const body = await response.json() as {
    record?: {
      metrics?: Record<string, { percentiles?: { p75?: string } }>;
      collectionPeriod?: { firstDate?: Record<string, number>; lastDate?: Record<string, number> };
    };
  };
  const metrics = body.record?.metrics;
  if (!metrics) return undefined;
  const lcp = numericPercentile(metrics.largest_contentful_paint);
  const inp = numericPercentile(metrics.interaction_to_next_paint);
  const cls = numericPercentile(metrics.cumulative_layout_shift);
  const ttfb = numericPercentile(metrics.experimental_time_to_first_byte);
  return {
    source: "crux_field",
    formFactor: "PHONE",
    lcp: metric(lcp, "ms", [2_500, 4_000]),
    inp: metric(inp, "ms", [200, 500]),
    cls: metric(cls, "score", [0.1, 0.25]),
    ttfb: metric(ttfb, "ms", [800, 1_800]),
    sampleCount: 1,
    observedAt: new Date().toISOString(),
    limitation: inp === undefined
      ? "CrUX did not expose INP for this origin; the criterion remains unknown."
      : undefined
  };
}

async function runBrowserEvidence(input: {
  url: string;
  sampleCount: number;
  signal?: AbortSignal;
}): Promise<{ samples: LabSample[]; accessibility: AutomatedAccessibilityEvidence }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const samples: LabSample[] = [];
  const validatedOrigins = new Map<string, Promise<void>>();
  const sourceHostname = new URL(await assertPublicFetchUrl(input.url)).hostname;
  let accessibility: AutomatedAccessibilityEvidence = {
    adapter: "unavailable",
    violations: [],
    observedAt: new Date().toISOString(),
    limitation: "Accessibility audit did not run."
  };
  try {
    for (let index = 0; index < input.sampleCount; index += 1) {
      if (input.signal?.aborted) throw input.signal.reason;
      if (index > 0) await delay(500);
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        userAgent: generationCrawlerUserAgent
      });
      try {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 150,
          downloadThroughput: 1_600_000 / 8,
          uploadThroughput: 750_000 / 8,
          connectionType: "cellular3g"
        });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.route("**/*", async (route) => {
          try {
            const requestUrl = route.request().url();
            const parsed = new URL(requestUrl);
            if (route.request().isNavigationRequest() && !sameSite(parsed.hostname, sourceHostname)) {
              throw new Error("Cross-site browser navigation blocked.");
            }
            const origin = parsed.origin;
            let validation = validatedOrigins.get(origin);
            if (!validation) {
              validation = assertPublicFetchUrl(requestUrl).then(() => undefined);
              validatedOrigins.set(origin, validation);
            }
            await validation;
            await route.continue();
          } catch {
            await route.abort("blockedbyclient");
          }
        });
        await page.addInitScript(() => {
          const metrics = { lcp: undefined as number | undefined, cls: 0 };
          Object.defineProperty(globalThis, "__lodestaVitals", { value: metrics, configurable: true });
          try {
            new PerformanceObserver((entries) => {
              const last = entries.getEntries().at(-1);
              if (last) metrics.lcp = last.startTime;
            }).observe({ type: "largest-contentful-paint", buffered: true });
          } catch {
            // Some browsers or pages may not expose this entry type.
          }
          try {
            new PerformanceObserver((entries) => {
              for (const entry of entries.getEntries()) {
                const value = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
                if (!value.hadRecentInput) metrics.cls += value.value ?? 0;
              }
            }).observe({ type: "layout-shift", buffered: true });
          } catch {
            // Some browsers or pages may not expose this entry type.
          }
        });
        await page.goto(await assertPublicFetchUrl(input.url), { waitUntil: "load", timeout: 45_000 });
        const finalUrl = await assertPublicFetchUrl(page.url());
        if (!sameSite(new URL(finalUrl).hostname, sourceHostname)) {
          throw new Error("Cross-site browser navigation blocked.");
        }
        await page.waitForTimeout(1_500);
        samples.push(await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          const vitals = (globalThis as typeof globalThis & { __lodestaVitals?: { lcp?: number; cls?: number } }).__lodestaVitals;
          return {
            lcp: vitals?.lcp,
            cls: vitals?.cls,
            ttfb: navigation ? navigation.responseStart - navigation.requestStart : undefined
          };
        }));
        if (index === 0) {
          await page.addScriptTag({ content: axeCore.source });
          const axeResult = await page.evaluate(async () => {
            const runtime = (globalThis as typeof globalThis & {
              axe: { version: string; run: (context?: unknown, options?: unknown) => Promise<{
                violations: Array<{
                  id: string;
                  impact: "minor" | "moderate" | "serious" | "critical" | null;
                  description: string;
                  help: string;
                  helpUrl: string;
                  nodes: Array<{ target: string[]; failureSummary?: string }>;
                }>;
              }> };
            }).axe;
            return {
              version: runtime.version,
              result: await runtime.run(document, {
                resultTypes: ["violations"],
                runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }
              })
            };
          });
          accessibility = {
            adapter: "axe-core",
            version: axeResult.version,
            observedAt: new Date().toISOString(),
            violations: axeResult.result.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact ?? "unknown",
              description: violation.description,
              help: violation.help,
              helpUrl: violation.helpUrl,
              nodeCount: violation.nodes.length,
              samples: violation.nodes.slice(0, 5).map((node) => `${node.target.join(" ")}${node.failureSummary ? ` — ${node.failureSummary}` : ""}`.slice(0, 1_000))
            }))
          };
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { samples, accessibility };
}

function labPerformance(samples: LabSample[], observedAt: string): WebPerformanceEvidence {
  if (!samples.length) {
    return {
      source: "unavailable",
      formFactor: "PHONE",
      lcp: metric(undefined, "ms", [2_500, 4_000]),
      inp: metric(undefined, "ms", [200, 500]),
      cls: metric(undefined, "score", [0.1, 0.25]),
      ttfb: metric(undefined, "ms", [800, 1_800]),
      sampleCount: 0,
      observedAt,
      limitation: "CrUX had no field data and the browser lab run was unavailable."
    };
  }
  return {
    source: "lab_median",
    formFactor: "PHONE",
    lcp: metric(median(samples.map((sample) => sample.lcp)), "ms", [2_500, 4_000]),
    inp: metric(undefined, "ms", [200, 500]),
    cls: metric(median(samples.map((sample) => sample.cls)), "score", [0.1, 0.25]),
    ttfb: metric(median(samples.map((sample) => sample.ttfb)), "ms", [800, 1_800]),
    sampleCount: samples.length,
    observedAt,
    limitation: "Lab values are the median of three Chromium runs using a 390px viewport, 4× CPU slowdown, 150 ms latency, and 1.6 Mbps downstream throttling. They are a repeatable proxy, not field data. INP requires field interaction data and remains unknown."
  };
}

function numericPercentile(metricValue: { percentiles?: { p75?: string } } | undefined) {
  const value = Number(metricValue?.percentiles?.p75);
  return Number.isFinite(value) ? value : undefined;
}

function metric(value: number | undefined, unit: PerformanceMetric["unit"], thresholds: [number, number]): PerformanceMetric {
  if (value === undefined) return { rating: "unknown", unit };
  return {
    value: Math.round(value * 1000) / 1000,
    unit,
    rating: value <= thresholds[0] ? "good" : value <= thresholds[1] ? "needs_improvement" : "poor"
  };
}

function median(values: Array<number | undefined>) {
  const numeric = values.filter((value): value is number => value !== undefined && Number.isFinite(value)).sort((left, right) => left - right);
  if (!numeric.length) return undefined;
  const middle = Math.floor(numeric.length / 2);
  return numeric.length % 2 ? numeric[middle] : (numeric[middle - 1] + numeric[middle]) / 2;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameSite(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/^www\./, "");
  return normalize(left) === normalize(right);
}
