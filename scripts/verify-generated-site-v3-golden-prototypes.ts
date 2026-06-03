import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import { createGeneratedSiteV3GoldenPrototypes } from "../lib/generated-site-v3-prototypes";
import { SiteRenderer } from "../lib/site-renderer";

const results = [];
const prototypes = createGeneratedSiteV3GoldenPrototypes();
const forbiddenPublicV3Copy = [
  "template",
  "source fact",
  "source-backed",
  "generic contact form",
  "visual context",
  "business media context",
  "proof",
  "the page keeps",
  "the site keeps",
  "services listed here",
  "avoid unrelated work",
  "call path",
  "kept close",
  "text-first layout",
  "confirmed business information",
  "next step",
  "customer action path",
  "context"
];

for (const prototype of prototypes) {
  const { bundle, business, version } = prototype;
  const home = version.pageComposition.pages.find((page) => page.slug === "");
  assert.ok(home, `${prototype.id} should include a V3 homepage`);
  assert.equal(version.rendererVersion, "layout-v3", `${prototype.id} should use layout-v3`);
  assert.equal(version.designSchemaVersion, "design-v3", `${prototype.id} should use design-v3`);
  assert.ok(home.sections.length >= prototype.expectations.minSections, `${prototype.id} should render enough meaningful sections`);

  const families = new Set(home.sections.map((section) => section.family));
  for (const family of prototype.expectations.requiredFamilies) {
    assert.ok(families.has(family), `${prototype.id} should include section family ${family}`);
  }

  const variants = new Set(home.sections.map((section) => section.variant));
  const layouts = new Set(home.sections.map((section) => section.controls.layout));
  const widths = new Set(home.sections.map((section) => section.controls.width));
  const backgrounds = new Set(home.sections.map((section) => section.controls.background));
  assert.ok(variants.size >= 6, `${prototype.id} should not reuse the same section variant rhythm`);
  assert.ok(layouts.size >= 4, `${prototype.id} should include at least four distinct layout controls`);
  assert.ok(widths.has("wide"), `${prototype.id} should include at least one wide composition`);
  assert.ok(widths.has("contained"), `${prototype.id} should include contained compositions for reading`);
  assert.ok(backgrounds.size >= 2, `${prototype.id} should vary section background treatment without arbitrary CSS`);
  if (home.sections.some((section) => section.variant === "media_masthead")) {
    assert.notEqual(version.artDirection.headerMode, "solid_editorial", `${prototype.id} should not use the disconnected solid editorial header for a media-led hero`);
  }

  const html = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version,
      tracking: false,
      formsEnabled: true
    })
  );
  const noFormHtml = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version,
      tracking: false,
      formsEnabled: false
    })
  );
  const lowerHtml = html.toLowerCase();
  const renderedTextCorpus = visibleTextFromHtml(html);
  const copyCorpus = home.sections.flatMap((section) => collectStrings(section.props)).join("\n").toLowerCase();

  assert.ok(html.includes("public-site-v3"), `${prototype.id} should render through the V3 public-site class`);
  assert.ok(html.includes("site-header-v3"), `${prototype.id} should render a V3 header`);
  assert.ok(html.includes("site-hero-v3"), `${prototype.id} should render a V3 hero`);
  assert.ok(html.includes("site-service-index-v3"), `${prototype.id} should render editorial service rows`);
  if (prototype.expectations.requiredFamilies.some((family) => family.startsWith("media."))) {
    assert.ok(html.includes("site-media-story-v3"), `${prototype.id} should render a media story`);
  }
  assert.ok(html.includes("site-contact-form-v3"), `${prototype.id} should render the generic contact form shell`);
  assert.ok(noFormHtml.includes("site-contact-action-v3"), `${prototype.id} should render a structured contact action fallback when forms are disabled`);
  assert.equal(html.includes("button primary"), false, `${prototype.id} must not use Lodesta product button classes`);
  assert.equal(/\b\d(?:\.\d)?\s+stars?\b/i.test(html), false, `${prototype.id} must not statically render star ratings`);
  assert.equal(/\b\d{2,}\s+reviews?\b/i.test(html), false, `${prototype.id} must not statically render review counts`);

  for (const copy of prototype.expectations.forbiddenCopy) {
    assert.equal(copyCorpus.includes(copy.toLowerCase()), false, `${prototype.id} renders forbidden/template copy: ${copy}`);
    assert.equal(renderedTextCorpus.includes(copy.toLowerCase()), false, `${prototype.id} renders forbidden/template public text: ${copy}`);
  }
  for (const copy of forbiddenPublicV3Copy) {
    assert.equal(copyCorpus.includes(copy), false, `${prototype.id} includes internal generator copy in section props: ${copy}`);
    assert.equal(renderedTextCorpus.includes(copy), false, `${prototype.id} renders internal generator copy: ${copy}`);
  }

  const inspection = await inspectGeneratedSiteBundleRender({
    bundle,
    version,
    qaRunId: `v3_golden_${prototype.id}`
  });
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");
  assert.equal(
    inspection.adapter,
    "playwright",
    `${prototype.id} should use Playwright for V3 screenshots: ${inspection.unavailableReason ?? "no fallback reason"}`
  );
  assert.equal(failingFindings.length, 0, `${prototype.id} should not have failing render findings: ${failingFindings.map((finding) => finding.id).join(", ")}`);
  assert.equal(inspection.screenshots.length, 3, `${prototype.id} should capture desktop, tablet, and mobile screenshots`);
  assert.equal(inspection.metrics.horizontalOverflowPx, 0, `${prototype.id} should not create horizontal overflow`);
  assert.equal(inspection.metrics.brokenImageCount, 0, `${prototype.id} should not render broken images`);
  assert.ok((inspection.metrics.bodyFontSizePx ?? 0) >= 16, `${prototype.id} body text should be at least 16px`);
  assert.ok((inspection.metrics.minReadableTextFontSizePx ?? 0) >= 14, `${prototype.id} readable text should stay at least 14px`);
  assert.ok((inspection.metrics.minTextContrastRatio ?? 0) >= 4.5, `${prototype.id} text contrast should meet WCAG AA`);

  results.push({
    id: prototype.id,
    label: prototype.label,
    sections: home.sections.length,
    families: Array.from(families),
    metrics: {
      bodyFontSizePx: inspection.metrics.bodyFontSizePx,
      minReadableTextFontSizePx: inspection.metrics.minReadableTextFontSizePx,
      minTextContrastRatio: inspection.metrics.minTextContrastRatio,
      imageCount: inspection.metrics.imageCount
    },
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      path: screenshot.path,
      bytes: screenshot.bytes
    }))
  });
}

assert.ok(prototypes.length >= 2, "V3 golden suite should cover at least two horizontal design prototypes");
assert.ok(new Set(prototypes.map((prototype) => prototype.version.artDirection.recipeId)).size >= 2, "V3 golden suite should exercise at least two art direction recipes");
assert.ok(new Set(prototypes.map((prototype) => prototype.version.artDirection.headerMode)).size >= 2, "V3 golden suite should exercise at least two header modes");
assert.ok(
  new Set(prototypes.flatMap((prototype) => prototype.version.pageComposition.pages.flatMap((page) => page.sections.filter((section) => section.family.startsWith("hero.")).map((section) => section.variant)))).size >= 2,
  "V3 golden suite should exercise at least two hero variants"
);
assert.ok(results.some((result) => (result.metrics.imageCount ?? 0) > 0), "V3 golden suite should include a media-led prototype");
assert.ok(results.some((result) => (result.metrics.imageCount ?? 0) === 0), "V3 golden suite should include a text-first no-media prototype");

process.stdout.write(`${JSON.stringify({ ok: true, prototypes: results }, null, 2)}\n`);

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function visibleTextFromHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
