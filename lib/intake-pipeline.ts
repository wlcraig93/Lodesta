import { crawlUrl } from "./crawler";
import { createSiteFromInput, type IntakeInput } from "./intake";
import { createOpenAiMockupArtifacts } from "./image-generation";
import { createOpenAiGenerationPlanning } from "./openai-generation";
import { gatherPublicPresenceSignals } from "./public-presence";
import { inspectUrlRender } from "./render-inspection";
import { assertPublicFetchUrl } from "./url-safety";
import { createOpenAiVisualQa } from "./visual-qa";
import { assertLaunchMarket } from "./launch-market";
import type { AgentTelemetryRecorder, AgentTelemetrySpan } from "./agent-telemetry";
import type { CreativeMockupArtifact, RenderInspectionResult, SiteBundle, VisualQaResult } from "./models";
import type { CrawlAssessment } from "./crawler";

export async function prepareIntakeInput(
  input: { url?: string; prompt?: string },
  options: { telemetry?: AgentTelemetryRecorder } = {}
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

  const deterministicBundle = await runSpan(
    telemetry,
    {
      spanType: "deterministic_build",
      name: "Build deterministic baseline",
      inputJson: { url: safeUrl, prompt: input.prompt }
    },
    async () => createSiteFromInput({ ...input, url: safeUrl, crawl, renderInspection, publicPresence }),
    (bundle) => ({ outputJson: summarizeBundle(bundle) })
  );
  const aiPlanning = await runSpan(
    telemetry,
    {
      spanType: "ai_planning",
      name: "AI planning",
      inputJson: { url: safeUrl, prompt: input.prompt, baselineSiteId: deterministicBundle.businessProfile.siteId }
    },
    (span) =>
      createOpenAiGenerationPlanning({
        bundle: deterministicBundle,
        sourceUrl: safeUrl,
        prompt: input.prompt,
        crawl,
        renderInspection,
        telemetry,
        spanId: span.id
      }),
    (planning) => ({
      outputJson: {
        source: planning?.source ?? "deterministic_fallback",
        selectedStrategy: planning?.selectedStrategy,
        directions: planning?.designDirections?.length ?? 0,
        summary: planning?.qualitySummary
      }
    })
  );
  const plannedBundle = await runSpan(
    telemetry,
    {
      spanType: "planned_build",
      name: "Build planned site model",
      inputJson: { planningSource: aiPlanning?.source ?? "deterministic_fallback" }
    },
    async () => createSiteFromInput({ ...input, url: safeUrl, crawl, renderInspection, aiPlanning, publicPresence }),
    (bundle) => ({ outputJson: summarizeBundle(bundle) })
  );
  const [mockupArtifacts, visualQa] = await Promise.all([
    runSpan(
      telemetry,
      {
        spanType: "mockup_generation",
        name: "Mockup generation",
        inputJson: { siteId: plannedBundle.businessProfile.siteId }
      },
      (span) => createOpenAiMockupArtifacts({ bundle: plannedBundle, telemetry, spanId: span.id }),
      (artifacts) => ({
        outputJson: summarizeMockups(artifacts),
        artifactRefs: {
          assets: artifacts.map((artifact) => ({
            id: artifact.assetId,
            storageProvider: artifact.storageProvider,
            storagePath: artifact.storagePath,
            url: artifact.image?.url
          }))
        }
      })
    ),
    runSpan(
      telemetry,
      {
        spanType: "visual_qa",
        name: "Visual QA",
        inputJson: { siteId: plannedBundle.businessProfile.siteId, screenshots: renderInspection?.screenshots.length ?? 0 }
      },
      (span) => createOpenAiVisualQa({ bundle: plannedBundle, renderInspection, telemetry, spanId: span.id }),
      (qa) => ({ outputJson: summarizeVisualQa(qa) })
    )
  ]);

  return {
    ...input,
    url: safeUrl,
    crawl,
    renderInspection,
    publicPresence,
    aiPlanning,
    mockupArtifacts,
    visualQa
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
  try {
    const result = await operation(span ?? noopSpan);
    await span?.end(finish?.(result));
    return result;
  } catch (error) {
    await span?.fail(error);
    throw error;
  }
}

const noopSpan: AgentTelemetrySpan = {
  async end() {},
  async fail() {}
};

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
    pageSummaries: crawl.pageSummaries.slice(0, 8)
  };
}

function summarizeRenderInspection(result: RenderInspectionResult) {
  return {
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

function summarizeBundle(bundle: SiteBundle) {
  const version = bundle.siteModel.versions[0];
  return {
    siteId: bundle.businessProfile.siteId,
    slug: bundle.siteModel.slug,
    businessName: bundle.businessProfile.name,
    vertical: bundle.businessProfile.vertical,
    pages: version?.pages.length ?? 0,
    sections: version?.pages.reduce((sum, page) => sum + page.sections.length, 0) ?? 0,
    findings: bundle.optimizationFindings.length,
    designDirections: bundle.presenceAssessment.designDirections?.length ?? 0
  };
}

function summarizeMockups(artifacts: CreativeMockupArtifact[]) {
  return {
    total: artifacts.length,
    generated: artifacts.filter((artifact) => artifact.status === "generated").length,
    failed: artifacts.filter((artifact) => artifact.status === "failed").length,
    promptOnly: artifacts.filter((artifact) => artifact.status === "prompt_only").length,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      provider: artifact.provider,
      model: artifact.model,
      strategy: artifact.strategy,
      storageProvider: artifact.storageProvider,
      storagePath: artifact.storagePath
    }))
  };
}

function summarizeVisualQa(qa: VisualQaResult) {
  return {
    source: qa.source,
    model: qa.model,
    target: qa.target,
    screenshotCount: qa.screenshotCount,
    summary: qa.summary,
    failures: qa.findings.filter((finding) => finding.severity === "fail").length,
    warnings: qa.findings.filter((finding) => finding.severity === "warning").length,
    findings: qa.findings
  };
}
