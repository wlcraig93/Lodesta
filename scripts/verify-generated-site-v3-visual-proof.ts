import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import { createGeneratedSiteV3VisualProofs } from "../lib/generated-site-v3-visual-proof";
import { SiteRenderer } from "../lib/site-renderer";

const proofs = createGeneratedSiteV3VisualProofs();
const reportPath = join(process.cwd(), "docs", "generated-site-v3-visual-proof-report.md");
const forbiddenCopy = [
  "template",
  "source fact",
  "visual proof",
  "v3",
  "component",
  "module",
  "bento",
  "widget",
  "synthetic",
  "generic contact form",
  "page keeps",
  "proof uses",
  "this proof",
  "repo media"
];

const results = [];

assert.equal(proofs.length, 3, "Visual proof suite should include exactly three manual pages for this milestone.");
assert.ok(proofs.some((proof) => proof.rubric.score >= 9), "At least one manual proof should honestly score 9+.");
assert.ok(new Set(proofs.map((proof) => proof.version.artDirection.headerMode)).size >= 3, "Proofs should exercise at least three header modes.");
assert.ok(new Set(proofs.map((proof) => proof.version.artDirection.fontPairingId)).size >= 3, "Proofs should exercise at least three font pairings.");

for (const proof of proofs) {
  const page = proof.version.pageComposition.pages[0];
  assert.ok(page, `${proof.id} should include a homepage.`);
  assert.equal(proof.version.rendererVersion, "layout-v3", `${proof.id} should use layout-v3.`);
  assert.equal(proof.version.designSchemaVersion, "design-v3", `${proof.id} should use design-v3.`);
  assert.ok(page.sections.length >= proof.expectations.minSections, `${proof.id} should include enough page sections.`);

  const variants = new Set(page.sections.map((section) => section.variant));
  const layouts = new Set(page.sections.map((section) => section.controls.layout));
  const widths = new Set(page.sections.map((section) => section.controls.width));
  const backgrounds = new Set(page.sections.map((section) => section.controls.background));
  assert.ok(layouts.size >= proof.expectations.minLayoutControls, `${proof.id} should exercise enough layout controls.`);
  assert.ok(widths.has("contained"), `${proof.id} should include contained reading layouts.`);
  assert.ok(widths.has("wide") || widths.has("full_bleed"), `${proof.id} should include wide/full-bleed visual layouts.`);
  assert.ok(backgrounds.size >= 3, `${proof.id} should vary background relationships.`);
  for (const variant of proof.expectations.requiredVariants) {
    assert.ok(variants.has(variant), `${proof.id} should include variant ${variant}.`);
  }

  assert.ok(
    proof.version.mediaDecisions.every((decision) => decision.rightsStatus === "approved" && decision.mayImplyRealBusinessWork === false),
    `${proof.id} media decisions should be rights-safe and non-deceptive.`
  );

  const html = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: proof.business,
      site: proof.bundle.siteModel,
      extensions: proof.bundle.extensionModel,
      version: proof.version,
      tracking: false,
      formsEnabled: false
    })
  );
  const text = visibleText(html);
  assert.ok(html.includes("public-site-v3"), `${proof.id} should render through V3.`);
  assert.ok(html.includes("site-header-v3"), `${proof.id} should render the V3 header.`);
  assert.ok(html.includes("site-footer-column-v3"), `${proof.id} should render the richer local-business footer.`);
  assert.equal(html.includes("button primary"), false, `${proof.id} must not use Lodesta product button classes.`);
  assert.equal(/\b\d(?:\.\d)?\s+stars?\b/i.test(html), false, `${proof.id} must not statically render ratings.`);
  assert.equal(/\b\d{2,}\s+reviews?\b/i.test(html), false, `${proof.id} must not statically render review counts.`);
  for (const forbidden of forbiddenCopy) {
    assert.equal(text.includes(forbidden), false, `${proof.id} renders internal/proof copy: ${forbidden}`);
  }

  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: proof.bundle,
    version: proof.version,
    qaRunId: `v3_visual_proof_${proof.id}`
  });
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");
  assert.equal(inspection.adapter, "playwright", `${proof.id} should use Playwright screenshots: ${inspection.unavailableReason ?? "no fallback reason"}`);
  assert.equal(failingFindings.length, 0, `${proof.id} should not have failing render findings: ${failingFindings.map((finding) => finding.id).join(", ")}`);
  assert.equal(inspection.screenshots.length, 3, `${proof.id} should capture desktop, tablet, and mobile screenshots.`);
  assert.equal(inspection.metrics.horizontalOverflowPx, 0, `${proof.id} should not create horizontal overflow.`);
  assert.equal(inspection.metrics.brokenImageCount, 0, `${proof.id} should not render broken images.`);
  assert.ok((inspection.metrics.imageCount ?? 0) >= proof.expectations.minImageCount, `${proof.id} should render enough images for media handling evidence.`);
  assert.ok((inspection.metrics.bodyFontSizePx ?? 0) >= 16, `${proof.id} body text should be at least 16px.`);
  assert.ok((inspection.metrics.minReadableTextFontSizePx ?? 0) >= 14, `${proof.id} readable text should stay at least 14px.`);
  assert.ok((inspection.metrics.minTextContrastRatio ?? 0) >= 4.5, `${proof.id} text contrast should meet WCAG AA.`);

  results.push({
    id: proof.id,
    label: proof.label,
    score: proof.rubric.score,
    sections: page.sections.length,
    variants: Array.from(variants),
    layouts: Array.from(layouts),
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      width: screenshot.width,
      height: screenshot.height,
      path: screenshot.path,
      bytes: screenshot.bytes
    })),
    metrics: {
      imageCount: inspection.metrics.imageCount,
      bodyFontSizePx: inspection.metrics.bodyFontSizePx,
      minReadableTextFontSizePx: inspection.metrics.minReadableTextFontSizePx,
      minTextContrastRatio: inspection.metrics.minTextContrastRatio,
      horizontalOverflowPx: inspection.metrics.horizontalOverflowPx
    },
    rubric: proof.rubric
  });
}

await writeVisualProofReport(results);
process.stdout.write(`${JSON.stringify({ ok: true, reportPath, proofs: results }, null, 2)}\n`);

function visibleText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function writeVisualProofReport(results: Array<Record<string, unknown>>) {
  await mkdir(dirname(reportPath), { recursive: true });
  const lines = [
    "# Generated Site V3 Visual Proof Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "This report is produced by `npm run verify:generated-site-v3-visual-proof`. It verifies three manually composed generic small-business homepages rendered through the reusable V3 public renderer.",
    "",
    "## Summary",
    "",
    ...results.map((result) => {
      const screenshots = (result.screenshots as Array<{ viewport: string; path: string; bytes: number }>).map(
        (screenshot) => `  - ${screenshot.viewport}: ${screenshot.path} (${screenshot.bytes} bytes)`
      );
      return [
        `### ${result.label}`,
        "",
        `- ID: \`${result.id}\``,
        `- Manual rubric score: ${result.score}/10`,
        `- Sections: ${result.sections}`,
        `- Variants: ${(result.variants as string[]).join(", ")}`,
        `- Layout controls: ${(result.layouts as string[]).join(", ")}`,
        `- Metrics: ${JSON.stringify(result.metrics)}`,
        "- Screenshots:",
        ...screenshots,
        ""
      ].join("\n");
    }),
    "## Acceptance",
    "",
    "- Three manual pages render through `layout-v3`.",
    "- Each page uses reusable `SiteVersionV3.pageComposition` section props only.",
    "- Desktop, tablet, and mobile screenshots are captured for each page.",
    "- At least one page is honestly scored above 9/10.",
    "- The path to 9.5 is explicit: stronger first-party/curated media and logo/brand-mark controls, not one-off page CSS.",
    ""
  ];
  await writeFile(reportPath, lines.join("\n"), "utf8");
}
