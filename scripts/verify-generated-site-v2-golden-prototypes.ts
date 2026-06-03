import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blockersFromInspection, blockersFromSiteModel } from "../lib/generated-site-qa";
import { createGeneratedSiteV2GoldenPrototypes } from "../lib/generated-site-v2-golden-prototypes";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import { SiteRenderer } from "../lib/site-renderer";

const results = [];

for (const prototype of createGeneratedSiteV2GoldenPrototypes()) {
  const version = prototype.version;
  const home = version.compiledPages.find((page) => page.slug === "");
  assert.ok(home, `${prototype.id} should include a homepage`);
  const html = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: prototype.business,
      site: prototype.bundle.siteModel,
      extensions: prototype.bundle.extensionModel,
      version,
      tracking: false,
      formsEnabled: false
    })
  );
  const lowerHtml = html.toLowerCase();
  const families = home.sections.map((section) => section.family);
  const variants = home.sections.map((section) => section.variant);
  const uniqueFamilies = new Set(families);
  const uniqueVariants = new Set(variants);
  const mediaTitles = home.sections.flatMap((section) =>
    Array.isArray(section.props.items)
      ? section.props.items
          .map((item) => (item && typeof item === "object" && "title" in item && typeof item.title === "string" ? item.title : undefined))
          .filter((title): title is string => Boolean(title))
      : []
  );

  assert.equal(version.rendererVersion, "layout-v2", `${prototype.id} must render through V2`);
  assert.equal(version.designSchemaVersion, "design-v2", `${prototype.id} must use the V2 design schema`);
  assert.ok(
    home.sections.length >= prototype.expectations.minHomepageSections,
    `${prototype.id} should render enough homepage depth: expected ${prototype.expectations.minHomepageSections}, got ${home.sections.length}`
  );
  assert.ok(
    uniqueFamilies.size >= prototype.expectations.minDistinctFamilies,
    `${prototype.id} should use at least ${prototype.expectations.minDistinctFamilies} section families`
  );
  assert.ok(
    uniqueVariants.size >= prototype.expectations.minDistinctVariants,
    `${prototype.id} should use at least ${prototype.expectations.minDistinctVariants} layout variants`
  );
  for (const requiredFamily of prototype.expectations.requiredFamilies) {
    assert.ok(uniqueFamilies.has(requiredFamily as never), `${prototype.id} missing required family ${requiredFamily}`);
  }
  for (const requiredVariant of prototype.expectations.requiredVariants) {
    assert.ok(uniqueVariants.has(requiredVariant), `${prototype.id} missing required layout variant ${requiredVariant}`);
  }
  for (const copy of prototype.expectations.requiredCopy) {
    assert.ok(lowerHtml.includes(copy.toLowerCase()), `${prototype.id} missing required sourced copy: ${copy}`);
  }
  for (const copy of prototype.expectations.forbiddenCopy) {
    assert.equal(lowerHtml.includes(copy.toLowerCase()), false, `${prototype.id} renders forbidden/template copy: ${copy}`);
  }
  assertNoRepeatedAdjacentFamilies(prototype.id, families);
  assert.equal(new Set(mediaTitles).size, mediaTitles.length, `${prototype.id} should not repeat media/gallery titles`);
  assert.equal(html.includes("button primary"), false, `${prototype.id} must not use Lodesta product button classes`);
  assert.equal(html.includes("data-mark-long"), false, `${prototype.id} must not render repeated fallback wordmark`);
  assert.equal(/google\s+(rating|reviews?|profile)/i.test(html), false, `${prototype.id} must not statically render Google proof labels`);
  assert.equal(/\b\d(?:\.\d)?\s+stars?\b/i.test(html), false, `${prototype.id} must not statically render star ratings`);
  assert.equal(/\b\d{2,}\s+reviews?\b/i.test(html), false, `${prototype.id} must not statically render review counts`);
  assert.ok(html.includes("site-header-v2"), `${prototype.id} should render the V2 header`);
  assert.ok(html.includes("site-hero-v2"), `${prototype.id} should render the V2 hero`);
  assert.ok(html.includes("site-contact-v2"), `${prototype.id} should render a contact section`);
  assert.ok(html.includes('data-form-kind="contact"'), `${prototype.id} should render the generic contact form shell`);
  for (const formCopy of ["Contact request", "Name", "Phone", "Email", "Message", "Send message"]) {
    assert.ok(html.includes(formCopy), `${prototype.id} should render generic contact form copy: ${formCopy}`);
  }
  assert.ok(html.includes("site-final-cta-v2"), `${prototype.id} should render a final CTA`);
  assert.ok(html.includes("site-mobile-action-v2"), `${prototype.id} should render mobile conversion actions`);
  assert.ok(home.sections.every((section) => section.sourceFactIds.length || section.family.startsWith("process.") || section.family === "cta.final_band"), `${prototype.id} sections should retain fact provenance unless safe-generic`);

  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: prototype.bundle,
    version,
    qaRunId: `golden_${prototype.id}`
  });
  const blockers = [...blockersFromInspection(inspection), ...blockersFromSiteModel(prototype.bundle, version)];
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");
  assert.equal(
    inspection.adapter,
    "playwright",
    `${prototype.id} should use Playwright for golden prototype screenshots: ${inspection.unavailableReason ?? "no fallback reason"}`
  );
  assert.equal(blockers.length, 0, `${prototype.id} should not have readiness/render blockers: ${blockers.map((blocker) => blocker.id).join(", ")}`);
  assert.equal(failingFindings.length, 0, `${prototype.id} should not have failing render findings: ${failingFindings.map((finding) => finding.id).join(", ")}`);
  assert.equal(inspection.screenshots.length, 3, `${prototype.id} should capture desktop, tablet, and mobile screenshots`);
  assert.equal(inspection.metrics.horizontalOverflowPx, 0, `${prototype.id} should not create horizontal overflow`);
  assert.equal(inspection.metrics.brokenImageCount, 0, `${prototype.id} should not render broken images`);
  assert.equal(inspection.metrics.siteHeaderDetected, true, `${prototype.id} should detect generated-site header`);
  assert.equal(inspection.metrics.siteFooterDetected, true, `${prototype.id} should detect generated-site footer`);
  assert.equal(inspection.metrics.primaryHeroCtaAboveFold, true, `${prototype.id} should keep primary hero CTA above the fold`);
  assert.ok((inspection.metrics.bodyFontSizePx ?? 0) >= 16, `${prototype.id} body text should be at least 16px`);
  assert.ok((inspection.metrics.minReadableTextFontSizePx ?? 0) >= 14, `${prototype.id} readable text should stay at least 14px`);
  assert.ok((inspection.metrics.minTextContrastRatio ?? 0) >= 4.5, `${prototype.id} text contrast should meet WCAG AA`);
  assert.ok(
    (inspection.metrics.bodyTextChars ?? 0) >= prototype.expectations.minBodyTextChars,
    `${prototype.id} should render enough customer-facing copy`
  );
  assert.ok((inspection.metrics.ctaCount ?? 0) >= prototype.expectations.minCtas, `${prototype.id} should render enough conversion paths`);
  assert.ok((inspection.metrics.telLinkCount ?? 0) >= prototype.expectations.minTelLinks, `${prototype.id} should render enough click-to-call paths`);
  assert.ok((inspection.metrics.imageCount ?? 0) >= prototype.expectations.minImages, `${prototype.id} should include enough media depth`);

  results.push({
    id: prototype.id,
    label: prototype.label,
    vertical: prototype.business.vertical,
    benchmarkReferenceIds: prototype.benchmarkReferenceIds,
    homepageSections: home.sections.length,
    sectionFamilies: Array.from(uniqueFamilies),
    layoutVariants: Array.from(uniqueVariants),
    metrics: {
      bodyTextChars: inspection.metrics.bodyTextChars,
      ctaCount: inspection.metrics.ctaCount,
      telLinkCount: inspection.metrics.telLinkCount,
      imageCount: inspection.metrics.imageCount,
      minTextContrastRatio: inspection.metrics.minTextContrastRatio
    },
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      path: screenshot.path,
      bytes: screenshot.bytes
    }))
  });
}

process.stdout.write(`${JSON.stringify({ ok: true, prototypes: results }, null, 2)}\n`);

function assertNoRepeatedAdjacentFamilies(id: string, families: string[]) {
  for (let index = 1; index < families.length; index += 1) {
    const previous = families[index - 1];
    const current = families[index];
    assert.notEqual(current, previous, `${id} should not repeat adjacent section family ${current}`);
  }
}
