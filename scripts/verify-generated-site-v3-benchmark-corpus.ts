import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  generatedSiteV3BenchmarkArchetypes,
  generatedSiteV3BenchmarkCollectedAt,
  generatedSiteV3BenchmarkReferences,
  generatedSiteV3BenchmarkSummary,
  type GeneratedSiteV3BenchmarkCategory,
  type GeneratedSiteV3BenchmarkReference
} from "../lib/generated-site-v3-benchmark-corpus";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = join(process.cwd(), ".data", "v3-benchmark-corpus", runId);
const reportPath = join(process.cwd(), "docs", "generated-site-v3-benchmark-coverage-report.md");
const selectedSet = process.env.V3_BENCHMARK_SET;
const limit = process.env.V3_BENCHMARK_LIMIT ? Number.parseInt(process.env.V3_BENCHMARK_LIMIT, 10) : undefined;
const allowFailures = process.env.V3_BENCHMARK_ALLOW_FAILURES === "1";
const references = selectReferences();
const results: ReferenceInspectionResult[] = [];

assertCorpusShape(generatedSiteV3BenchmarkReferences);
await mkdir(artifactRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const [index, reference] of references.entries()) {
    process.stderr.write(`[${index + 1}/${references.length}] ${reference.id} -> ${reference.screenshotUrl}\n`);
    results.push(await inspectReference(browser, reference));
  }
} finally {
  await browser.close();
}

const failures = results.filter((result) => result.error);
await writeCoverageReport(results);
if (!allowFailures) assert.equal(failures.length, 0, `Benchmark screenshot failures: ${failures.map((failure) => failure.id).join(", ")}`);
process.stdout.write(
  `${JSON.stringify(
    {
      ok: failures.length === 0,
      runId,
      artifactRoot,
      reportPath,
      selected: references.length,
      failures: failures.map((failure) => ({ id: failure.id, error: failure.error }))
    },
    null,
    2
  )}\n`
);

function selectReferences() {
  let selected = generatedSiteV3BenchmarkReferences;
  if (selectedSet === "representative" || selectedSet === "holdout" || selectedSet === "corpus") {
    selected = selected.filter((reference) => reference.set === selectedSet);
  }
  if (limit && Number.isFinite(limit) && limit > 0) selected = selected.slice(0, limit);
  return selected;
}

function assertCorpusShape(references: GeneratedSiteV3BenchmarkReference[]) {
  const ids = new Set(references.map((reference) => reference.id));
  assert.equal(ids.size, references.length, "V3 benchmark corpus reference ids must be unique.");
  assert.ok(references.length >= 30 && references.length <= 50, "V3 benchmark corpus should contain 30-50 references.");

  const requiredCategories: GeneratedSiteV3BenchmarkCategory[] = [
    "local_service",
    "restaurant",
    "salon_wellness",
    "professional_service",
    "studio_agency",
    "home_services",
    "venue_fitness",
    "premium_media_led"
  ];
  for (const category of requiredCategories) {
    assert.ok(references.some((reference) => reference.category === category), `V3 benchmark corpus must include ${category}.`);
  }

  const representativeCount = references.filter((reference) => reference.set === "representative").length;
  const holdoutCount = references.filter((reference) => reference.set === "holdout").length;
  const archetypeCount = new Set(references.map((reference) => reference.archetype)).size;
  assert.ok(representativeCount >= 6 && representativeCount <= 8, "V3 benchmark corpus should keep 6-8 representative references.");
  assert.ok(holdoutCount >= 8 && holdoutCount <= 12, "V3 benchmark corpus should keep 8-12 holdout references.");
  assert.ok(archetypeCount >= 6 && archetypeCount <= 10, "V3 benchmark corpus should cluster into 6-10 archetypes.");
  assert.equal(
    new Set(generatedSiteV3BenchmarkArchetypes.map((archetype) => archetype.id)).size,
    generatedSiteV3BenchmarkArchetypes.length,
    "V3 benchmark archetype ids must be unique."
  );
}

async function inspectReference(browser: Browser, reference: GeneratedSiteV3BenchmarkReference): Promise<ReferenceInspectionResult> {
  const outputDir = join(artifactRoot, slugForPath(reference.id));
  await mkdir(outputDir, { recursive: true });
  const desktopPath = join(outputDir, "desktop.png");
  const mobilePath = join(outputDir, "mobile.png");
  const result: ReferenceInspectionResult = {
    id: reference.id,
    title: reference.title,
    provider: reference.provider,
    category: reference.category,
    archetype: reference.archetype,
    set: reference.set,
    sourceUrl: reference.sourceUrl,
    screenshotUrl: reference.screenshotUrl,
    screenshotType: reference.screenshotType,
    screenshots: [],
    desktopMetrics: null,
    mobileMetrics: null,
    declaredAnalysis: reference.analysis
  };

  try {
    const desktop = await captureViewport(browser, reference, desktopPath, { width: 1440, height: 1100 }, "desktop");
    const mobile = await captureViewport(browser, reference, mobilePath, { width: 390, height: 900 }, "mobile");
    result.screenshots.push(desktop.screenshot, mobile.screenshot);
    result.desktopMetrics = desktop.metrics;
    result.mobileMetrics = mobile.metrics;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function captureViewport(
  browser: Browser,
  reference: GeneratedSiteV3BenchmarkReference,
  screenshotPath: string,
  viewport: { width: number; height: number },
  viewportName: "desktop" | "mobile"
) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
    userAgent:
      viewportName === "mobile"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
        : undefined
  });
  try {
    await page.goto(reference.screenshotUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
    await page.waitForTimeout(900);
    const metrics = await analyzePage(page);
    const fullPage = reference.screenshotType === "live_demo";
    await page.screenshot({ path: screenshotPath, fullPage, animations: "disabled", timeout: 25_000 });
    const file = await stat(screenshotPath);
    assert.ok(file.size > 10_000, `${reference.id} ${viewportName} screenshot should be non-empty.`);
    return {
      screenshot: {
        viewport: viewportName,
        width: viewport.width,
        height: viewport.height,
        path: screenshotPath,
        bytes: file.size
      },
      metrics
    };
  } finally {
    await page.close();
  }
}

async function analyzePage(page: Page): Promise<PageInspectionMetrics> {
  return await page.evaluate(() => {
    const text = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const elements = Array.from(document.querySelectorAll<HTMLElement>("a, button"));
    const ctaLike = elements.filter((element) => {
      const label = element.innerText.toLowerCase();
      return /book|call|get|estimate|quote|contact|reserve|menu|start|learn|view|schedule|visit|shop/.test(label);
    });
    const headers = Array.from(document.querySelectorAll<HTMLElement>("header, nav, [class*='nav'], [class*='header']"));
    const stickyHeaderCount = headers.filter((element) => {
      const style = window.getComputedStyle(element);
      return style.position === "sticky" || style.position === "fixed";
    }).length;
    const images = Array.from(document.images);
    const aboveFoldImages = images.filter((image) => image.getBoundingClientRect().top < window.innerHeight && image.getBoundingClientRect().bottom > 0);
    const sectionLike = document.querySelectorAll("section, main > div, [data-framer-name], [class*='section'], [class*='Section']").length;
    const h1Text = Array.from(document.querySelectorAll("h1"))
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" / ");
    const navLinkCount = Array.from(document.querySelectorAll("nav a, header a")).filter((node) => node.textContent?.trim()).length;
    const maxTextWidth = Math.max(
      0,
      ...Array.from(document.querySelectorAll<HTMLElement>("p, h1, h2, h3, li")).map((node) => Math.round(node.getBoundingClientRect().width))
    );
    return {
      title: document.title,
      h1Text,
      bodyTextChars: text.length,
      imageCount: images.length,
      aboveFoldImageCount: aboveFoldImages.length,
      ctaLikeCount: ctaLike.length,
      navLinkCount,
      stickyHeaderCount,
      sectionLikeCount: sectionLike,
      maxTextWidth,
      bodyTextSample: text.slice(0, 280)
    };
  });
}

async function writeCoverageReport(results: ReferenceInspectionResult[]) {
  await mkdir(dirname(reportPath), { recursive: true });
  const summary = generatedSiteV3BenchmarkSummary();
  const successful = results.filter((result) => !result.error);
  const failed = results.filter((result) => result.error);
  const lines = [
    "# Generated Site V3 Benchmark Coverage Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Benchmark corpus collected at: ${generatedSiteV3BenchmarkCollectedAt}`,
    `Screenshot artifact root: \`${artifactRoot}\``,
    "",
    "This report is produced by `npm run verify:generated-site-v3-benchmark-corpus`. It is a coverage and evidence report, not a claim that V3 design quality is solved.",
    "",
    "## Corpus Shape",
    "",
    `- References: ${summary.total}`,
    `- Providers: ${formatCounts(summary.byProvider)}`,
    `- Primary categories: ${formatCounts(summary.byCategory)}`,
    `- Archetypes: ${formatCounts(summary.byArchetype)}`,
    `- Sets: ${formatCounts(summary.bySet)}`,
    `- Screenshot types: ${formatCounts(summary.screenshotTypes)}`,
    "",
    "## Archetype Clusters",
    "",
    ...generatedSiteV3BenchmarkArchetypes.flatMap((archetype) => {
      const refs = generatedSiteV3BenchmarkReferences.filter((reference) => reference.archetype === archetype.id);
      return [
        `### ${archetype.label}`,
        "",
        archetype.reusableQuestion,
        "",
        `References: ${refs.map((reference) => `\`${reference.id}\``).join(", ")}`,
        ""
      ];
    }),
    "## Representative Set",
    "",
    ...referenceList(generatedSiteV3BenchmarkReferences.filter((reference) => reference.set === "representative")),
    "## Holdout Set",
    "",
    ...referenceList(generatedSiteV3BenchmarkReferences.filter((reference) => reference.set === "holdout")),
    "## Coverage Matrix",
    "",
    "| ID | Set | Category | Archetype | Hero | Header | Media Rhythm | Services | Proof/Contact/Footer | Mobile |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...generatedSiteV3BenchmarkReferences.map((reference) =>
      [
        `\`${reference.id}\``,
        reference.set,
        reference.category,
        reference.archetype,
        escapeCell(reference.analysis.heroType),
        escapeCell(reference.analysis.headerBehavior),
        escapeCell(reference.analysis.mediaRhythm.join("; ")),
        escapeCell(reference.analysis.servicePresentation),
        escapeCell(reference.analysis.proofContactFooter),
        escapeCell(reference.analysis.mobileBehavior)
      ].join(" | ")
    ).map((line) => `| ${line} |`),
    "",
    "## Screenshot Results",
    "",
    ...results.flatMap((result) => screenshotResultLines(result)),
    "## Initial Component Gap Report",
    "",
    "These gaps are inferred from the benchmark matrix and should drive the next renderer/component pass. They are not one-off fixes for any single business.",
    "",
    "- First viewport composition needs richer hero template controls: media collage, atmospheric masthead, quiet centerpiece, and text-first professional grid should be selectable without custom CSS.",
    "- Header integration needs explicit compatibility rules with hero mode: transparent overlay, compact sticky, solid editorial, minimal wordmark, and utility-call variants cannot all share the same visual treatment.",
    "- Media rhythm needs section-level controls for full-bleed slabs, mosaics, asymmetric image/text rows, calm lifestyle crops, and text-first no-media fallbacks.",
    "- Service presentation needs multiple horizontal patterns: problem-led service rows, warm tiles, editorial capability rows, hospitality/menu previews, program cards, and premium showcase blocks.",
    "- Contact/footer composition needs practical local facts without generic filler: hours/address/phone/action should be reusable modules with visual variants, not repeated text panels.",
    "- Mobile behavior needs component-specific recomposition rules, not just stacking: CTA reachability, hero crop safety, service density, nav compression, and image/text order must be encoded per variant.",
    "- Marketplace-detail references are useful for component vocabulary but weaker than live demos; the next benchmark pass should replace them with resolved live demo URLs where possible.",
    "",
    "## Status",
    "",
    `- Screenshotted references in this run: ${successful.length}`,
    `- Failed references in this run: ${failed.length}`,
    "- Canonical section-template rendering is verified separately by `npm run verify:generated-site-v3-section-template-library`.",
    "- Historical benchmark references remain evidence for gaps and visual targets; executable benchmark reproduction fixtures have been removed from the go-forward renderer path.",
    ""
  ];
  await writeFile(reportPath, lines.join("\n"), "utf8");
}

function referenceList(references: GeneratedSiteV3BenchmarkReference[]) {
  return references.flatMap((reference) => [
    `- \`${reference.id}\` - ${reference.title} (${reference.provider}, ${reference.category}, ${reference.archetype})`,
    `  Source: ${reference.sourceUrl}`,
    `  Screenshot target: ${reference.screenshotUrl}`,
    `  Lens: ${reference.qualityLens}`,
    ""
  ]);
}

function screenshotResultLines(result: ReferenceInspectionResult) {
  const base = [
    `### ${result.id}`,
    "",
    `- Source: ${result.sourceUrl}`,
    `- Screenshot target: ${result.screenshotUrl}`,
    `- Type: ${result.screenshotType}`,
    `- Category/archetype: ${result.category} / ${result.archetype}`
  ];
  if (result.error) {
    return [...base, `- Error: ${result.error}`, ""];
  }
  return [
    ...base,
    `- Desktop metrics: ${JSON.stringify(result.desktopMetrics)}`,
    `- Mobile metrics: ${JSON.stringify(result.mobileMetrics)}`,
    "- Screenshots:",
    ...result.screenshots.map((screenshot) => `  - ${screenshot.viewport}: ${screenshot.path} (${screenshot.bytes} bytes)`),
    ""
  ];
}

function formatCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function slugForPath(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

type ReferenceInspectionResult = {
  id: string;
  title: string;
  provider: string;
  category: string;
  archetype: string;
  set: string;
  sourceUrl: string;
  screenshotUrl: string;
  screenshotType: string;
  screenshots: Array<{
    viewport: "desktop" | "mobile";
    width: number;
    height: number;
    path: string;
    bytes: number;
  }>;
  desktopMetrics: PageInspectionMetrics | null;
  mobileMetrics: PageInspectionMetrics | null;
  declaredAnalysis: GeneratedSiteV3BenchmarkReference["analysis"];
  error?: string;
};

type PageInspectionMetrics = {
  title: string;
  h1Text: string;
  bodyTextChars: number;
  imageCount: number;
  aboveFoldImageCount: number;
  ctaLikeCount: number;
  navLinkCount: number;
  stickyHeaderCount: number;
  sectionLikeCount: number;
  maxTextWidth: number;
  bodyTextSample: string;
};
