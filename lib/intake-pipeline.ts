import { crawlUrl } from "./crawler";
import type { IntakeInput } from "./intake";
import { createOpenAiBusinessUnderstanding } from "./business-understanding-v2";
import { gatherPublicPresenceSignals } from "./public-presence";
import { inspectUrlRender } from "./render-inspection";
import { assertPublicFetchUrl } from "./url-safety";
import { assertLaunchMarket } from "./launch-market";
import { planGenerationCost } from "./generation-cost";
import type { AgentTelemetryRecorder, AgentTelemetrySpan } from "./agent-telemetry";
import type { RenderInspectionResult } from "./models";
import type { CrawlAssessment } from "./crawler";

export async function prepareIntakeInput(
  input: { url?: string; prompt?: string },
  options: { telemetry?: AgentTelemetryRecorder; identity?: IntakeInput["identity"]; signal?: AbortSignal } = {}
): Promise<IntakeInput> {
  const telemetry = options.telemetry;
  const safeUrl = await runSpan(
    telemetry,
    {
      spanType: "url_safety",
      name: "URL safety",
      inputJson: input
    },
    async () => {
      assertLaunchMarket(input);
      return input.url ? assertPublicFetchUrl(input.url) : undefined;
    },
    (url) => ({
      outputJson: { safeUrl: url }
    })
  );
  const [crawl, renderInspection] = safeUrl
    ? await Promise.all([
        runSpan(
          telemetry,
          {
            spanType: "crawl",
            name: "Crawl source website",
            inputJson: { url: safeUrl }
          },
          () => crawlUrl(safeUrl),
          (result) => ({
            outputJson: summarizeCrawl(result),
            artifactRefs: {
              sourceUrl: result.url,
              finalUrl: result.finalUrl,
              assets: result.assetReferences.map((asset) => asset.url).slice(0, 12)
            }
          })
        ),
        runSpan(
          telemetry,
          {
            spanType: "render_inspection",
            name: "Inspect source render",
            inputJson: { url: safeUrl, captureScreenshots: true }
          },
          () => inspectUrlRender({ url: safeUrl, captureScreenshots: true }),
          (result) => ({
            outputJson: summarizeRenderInspection(result),
            artifactRefs: {
              screenshots: result.screenshots.map((screenshot) => ({
                viewport: screenshot.viewport,
                path: screenshot.path,
                bytes: screenshot.bytes
              }))
            }
          })
        )
      ])
    : [undefined, undefined];
  const publicPresence = await runSpan(
    telemetry,
    {
      spanType: "public_presence",
      name: "Gather public presence",
      inputJson: { url: safeUrl, hasCrawl: Boolean(crawl) }
    },
    () => gatherPublicPresenceSignals({ ...input, url: safeUrl, crawl }),
    (enrichment) => ({
      outputJson: {
        signals: enrichment?.signals.length ?? 0,
        provider: enrichment?.provider,
        names: enrichment?.signals.map((signal) => signal.fields.name).filter(Boolean) ?? [],
        notes: enrichment?.notes ?? []
      },
      artifactRefs: {
        urls: enrichment?.signals.map((signal) => signal.sourceUrl).filter(Boolean) ?? []
      }
    })
  );
  await runSpan(
    telemetry,
    {
      spanType: "url_safety",
      name: "Launch market validation",
      inputJson: { url: safeUrl, crawlStatus: crawl?.status, publicPresenceSignals: publicPresence?.signals.length ?? 0 }
    },
    async () => {
      assertLaunchMarket({ ...input, url: safeUrl, crawl, publicPresence });
      return { ok: true };
    },
    (result) => ({ outputJson: result })
  );

  const understanding = await runSpan(
    telemetry,
    {
      spanType: "business_understanding",
      name: "Business understanding",
      inputJson: { url: safeUrl, prompt: input.prompt, hasCrawl: Boolean(crawl) }
    },
    (span) =>
      createOpenAiBusinessUnderstanding({
        sourceUrl: safeUrl,
        prompt: input.prompt,
        crawl,
        publicPresence,
        telemetry,
        spanId: span.id,
        signal: options.signal
      }),
    (result) => ({
      outputJson: {
        source: result?.source ?? "deterministic_fallback",
        vertical: result?.vertical,
        verticalConfidence: result?.verticalConfidence,
        cleanedServices: result?.cleanedServices.length ?? 0,
        hoursEntries: result?.hours?.length ?? 0,
        primaryConversionGoal: result?.primaryConversionGoal
      }
    })
  );
  const generationCostEstimate = planGenerationCost({
    sourceUrl: safeUrl,
    crawl,
    sourceRenderInspection: renderInspection,
    publicPresence,
    includeGeneratedRenderQa: true
  });

  return {
    ...input,
    identity: options.identity,
    url: safeUrl,
    crawl,
    renderInspection,
    publicPresence,
    understanding,
    generationCostEstimate
  };
}

async function runSpan<T>(
  telemetry: AgentTelemetryRecorder | undefined,
  input: Parameters<AgentTelemetryRecorder["startSpan"]>[0],
  operation: (span: AgentTelemetrySpan) => Promise<T> | T,
  finish?: (result: T) => {
    outputJson?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    artifactRefs?: Record<string, unknown>;
  }
): Promise<T> {
  const span = telemetry ? await telemetry.startSpan(input) : undefined;
  logIntakeProgress("span_start", { spanType: input.spanType, name: input.name });
  try {
    const result = await operation(span ?? noopSpan);
    await span?.end(finish?.(result));
    logIntakeProgress("span_done", { spanType: input.spanType, name: input.name });
    return result;
  } catch (error) {
    await span?.fail(error);
    logIntakeProgress("span_failed", {
      spanType: input.spanType,
      name: input.name,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

const noopSpan: AgentTelemetrySpan = {
  async end() {},
  async fail() {}
};

function logIntakeProgress(event: string, payload: Record<string, unknown>) {
  if (process.env.LODESTA_GENERATE_SITE_PROGRESS !== "1") return;
  console.error(JSON.stringify({ event, scope: "prepare_intake", ...payload }));
}

function summarizeCrawl(crawl: CrawlAssessment) {
  return {
    url: crawl.url,
    fetched: crawl.fetched,
    status: crawl.status,
    finalUrl: crawl.finalUrl,
    title: crawl.title,
    metaDescription: crawl.metaDescription,
    score: crawl.score,
    facts: crawl.extractedFacts,
    counts: {
      forms: crawl.formCount,
      images: crawl.imageCount,
      internalLinks: crawl.internalLinkCount,
      externalLinks: crawl.externalLinkCount,
      pages: crawl.pageSummaries.length
    },
    findings: crawl.findings,
    sampledInternalPages: crawl.sampledInternalPages,
    pageSummaries: crawl.pageSummaries.slice(0, 8).map((page) => ({
      url: page.url,
      source: page.source,
      purposeTags: page.purposeTags,
      title: page.title,
      metaDescription: page.metaDescription,
      mainTextChars: page.mainText?.length ?? 0,
      facts: page.extractedFacts
    }))
  };
}

function summarizeRenderInspection(result: RenderInspectionResult) {
  return {
    target: result.target,
    sourceUrl: result.sourceUrl,
    finalUrl: result.finalUrl,
    adapter: result.adapter,
    metrics: result.metrics,
    findings: result.findings,
    screenshots: result.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      width: screenshot.width,
      height: screenshot.height,
      path: screenshot.path,
      bytes: screenshot.bytes
    })),
    unavailableReason: result.unavailableReason
  };
}
