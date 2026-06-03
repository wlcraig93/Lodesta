import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generatedSiteV3BenchmarkReferences } from "../lib/generated-site-v3-benchmark-corpus";
import { createGeneratedSiteV3BenchmarkReproductions } from "../lib/generated-site-v3-benchmark-reproductions";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import { SiteRenderer } from "../lib/site-renderer";

const reportPath = join(process.cwd(), "docs", "generated-site-v3-benchmark-reproduction-report.md");
const reproductions = createGeneratedSiteV3BenchmarkReproductions();
const representativeReferenceIds = new Set(generatedSiteV3BenchmarkReferences.filter((reference) => reference.set === "representative").map((reference) => reference.id));
const forbiddenPublicCopy = [
  "template",
  "benchmark",
  "reproduction",
  "synthetic",
  "generic",
  "v3",
  "component",
  "widget",
  "source fact",
  "proof uses",
  "this proof",
  "layout evaluation"
];
const results = [];

assert.equal(reproductions.length, 8, "Benchmark reproduction suite should include exactly eight representative pages.");

for (const reproduction of reproductions) {
  for (const referenceId of reproduction.benchmarkReferenceIds) {
    assert.ok(representativeReferenceIds.has(referenceId), `${reproduction.id} should map to a representative benchmark reference: ${referenceId}`);
  }
  assert.equal(reproduction.version.rendererVersion, "layout-v3", `${reproduction.id} should use layout-v3.`);
  assert.equal(reproduction.version.designSchemaVersion, "design-v3", `${reproduction.id} should use design-v3.`);
  assert.ok(reproduction.version.pageComposition.pages[0]?.sections.length >= 5, `${reproduction.id} should have enough sections for a focused generic local-business page.`);
  assert.ok(
    reproduction.version.mediaDecisions.every((decision) => decision.rightsStatus === "approved" && decision.mayImplyRealBusinessWork === false),
    `${reproduction.id} media must be policy-safe for benchmark reproduction.`
  );

  const html = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: reproduction.business,
      site: reproduction.bundle.siteModel,
      extensions: reproduction.bundle.extensionModel,
      version: reproduction.version,
      tracking: false,
      formsEnabled: true
    })
  );
  const text = visibleText(html);
  assert.ok(html.includes("public-site-v3"), `${reproduction.id} should render through the V3 public site class.`);
  assert.ok(html.includes("site-header-v3"), `${reproduction.id} should render the V3 header.`);
  assert.ok(html.includes("site-contact-form-v3"), `${reproduction.id} should render the generic contact form shell.`);
  assert.equal(html.includes("button primary"), false, `${reproduction.id} must not use Lodesta product button classes.`);
  for (const forbidden of forbiddenPublicCopy) {
    assert.equal(text.includes(forbidden), false, `${reproduction.id} renders internal/meta copy: ${forbidden}`);
  }

  const page = reproduction.version.pageComposition.pages[0];
  const variants = new Set(page.sections.map((section) => section.variant));
  const layouts = new Set(page.sections.map((section) => section.controls.layout));
  const families = new Set(page.sections.map((section) => section.family));
  assert.ok(variants.size >= 4, `${reproduction.id} should exercise varied section variants.`);
  assert.ok(layouts.size >= 3, `${reproduction.id} should exercise varied reusable layout controls.`);
  assert.ok(families.has("services.editorial_index"), `${reproduction.id} should include services.`);
  assert.ok(families.has("contact.split"), `${reproduction.id} should include contact.`);

  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: reproduction.bundle,
    version: reproduction.version,
    qaRunId: `v3_benchmark_repro_${reproduction.id}`
  });
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");
  assert.equal(inspection.adapter, "playwright", `${reproduction.id} should capture Playwright screenshots: ${inspection.unavailableReason ?? "no fallback reason"}`);
  assert.equal(failingFindings.length, 0, `${reproduction.id} render findings failed: ${failingFindings.map((finding) => finding.id).join(", ")}`);
  assert.equal(inspection.screenshots.length, 3, `${reproduction.id} should capture desktop, tablet, and mobile screenshots.`);
  assert.equal(inspection.metrics.horizontalOverflowPx, 0, `${reproduction.id} should not have horizontal overflow.`);
  assert.equal(inspection.metrics.brokenImageCount, 0, `${reproduction.id} should not render broken images.`);
  assert.ok((inspection.metrics.bodyFontSizePx ?? 0) >= 16, `${reproduction.id} body text should be at least 16px.`);
  assert.ok((inspection.metrics.minReadableTextFontSizePx ?? 0) >= 14, `${reproduction.id} readable text should stay at least 14px.`);
  assert.ok((inspection.metrics.minTextContrastRatio ?? 0) >= 4.5, `${reproduction.id} text contrast should meet WCAG AA.`);

  results.push({
    id: reproduction.id,
    label: reproduction.label,
    benchmarkReferenceIds: reproduction.benchmarkReferenceIds,
    expectedArchetype: reproduction.expectedArchetype,
    sections: page.sections.length,
    variants: Array.from(variants),
    layouts: Array.from(layouts),
    artDirection: reproduction.version.artDirection,
    notes: reproduction.reproductionNotes,
    metrics: {
      imageCount: inspection.metrics.imageCount,
      bodyFontSizePx: inspection.metrics.bodyFontSizePx,
      minReadableTextFontSizePx: inspection.metrics.minReadableTextFontSizePx,
      minTextContrastRatio: inspection.metrics.minTextContrastRatio,
      horizontalOverflowPx: inspection.metrics.horizontalOverflowPx
    },
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      path: screenshot.path,
      bytes: screenshot.bytes
    }))
  });
}

await writeReport(results);
process.stdout.write(`${JSON.stringify({ ok: true, reportPath, reproductions: results }, null, 2)}\n`);

function visibleText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function writeReport(results: Array<Record<string, unknown>>) {
  await mkdir(dirname(reportPath), { recursive: true });
  const lines = [
    "# Generated Site V3 Benchmark Reproduction Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "This report is produced by `npm run verify:generated-site-v3-benchmark-reproductions`. It verifies eight manually composed pages mapped to the representative benchmark set using reusable V3 section props and shared CSS only.",
    "",
    "This is not final 9.5 proof. The next step is side-by-side visual scoring against the actual benchmark screenshots and renderer changes for the gaps that remain.",
    "",
    "## Reproductions",
    "",
    ...results.flatMap((result) => reproductionLines(result)),
    "## Current Gap Notes",
    "",
    "- These pages prove that the current renderer can express multiple archetypes through props, but the variants are still too coarse to match high-end references precisely.",
    "- Missing controls remain around header/hero integration, per-section media rhythm, typography scale per section, richer footer/contact layouts, and mobile-specific recomposition.",
    "- Several archetypes rely on remote curated-stock proof media because the repo has only auto-body local assets today; production V3 needs a curated asset registry or first-party media path.",
    "- Side-by-side scoring against benchmark screenshots is tracked in `docs/generated-site-v3-side-by-side-gap-report.md`; deterministic render success is not the visual quality gate.",
    ""
  ];
  await writeFile(reportPath, lines.join("\n"), "utf8");
}

function reproductionLines(result: Record<string, unknown>) {
  const screenshots = result.screenshots as Array<{ viewport: string; path: string; bytes: number }>;
  return [
    `### ${result.label}`,
    "",
    `- ID: \`${result.id}\``,
    `- Benchmark reference(s): ${(result.benchmarkReferenceIds as string[]).map((id) => `\`${id}\``).join(", ")}`,
    `- Archetype: \`${result.expectedArchetype}\``,
    `- Sections: ${result.sections}`,
    `- Variants: ${(result.variants as string[]).join(", ")}`,
    `- Layout controls: ${(result.layouts as string[]).join(", ")}`,
    `- Metrics: ${JSON.stringify(result.metrics)}`,
    `- Notes: ${(result.notes as string[]).join(" ")}`,
    "- Screenshots:",
    ...screenshots.map((screenshot) => `  - ${screenshot.viewport}: ${screenshot.path} (${screenshot.bytes} bytes)`),
    ""
  ];
}
