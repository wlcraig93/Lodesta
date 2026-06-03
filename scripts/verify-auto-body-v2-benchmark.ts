import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BusinessProfile, SiteBundle, SiteModel, SiteVersionV2 } from "../lib/models";
import {
  clearFlowHomeServicesBusinessV2,
  createClearFlowHomeServicesV2FixtureVersion,
  createNorthLoopTacosV2FixtureVersion,
  createSuperBAutoBodyV2FixtureVersion,
  northLoopTacosBusinessV2,
  superBAutoBodyBusinessV2
} from "../lib/generated-site-v2-fixture";
import { blockersFromInspection, blockersFromSiteModel } from "../lib/generated-site-qa";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import { SiteRenderer } from "../lib/site-renderer";

const fixtures = [
  {
    id: "auto_body",
    business: superBAutoBodyBusinessV2,
    version: createSuperBAutoBodyV2FixtureVersion().version,
    expectedFamilies: ["hero.estimate_intake", "services.matrix", "process.repair_steps", "contact.location_hours", "cta.final_band"],
    expectedCopy: ["collision repair", "Photos if available", "1 Main St", "PDR for smaller dents and hail repair"]
  },
  {
    id: "restaurant",
    business: northLoopTacosBusinessV2,
    version: createNorthLoopTacosV2FixtureVersion().version,
    expectedFamilies: ["hero.order_path", "menu.highlights", "media.service_gallery", "process.order_steps", "contact.location_hours", "cta.final_band"],
    expectedCopy: ["Tacos", "Catering", "Start order"]
  },
  {
    id: "home_services",
    business: clearFlowHomeServicesBusinessV2,
    version: createClearFlowHomeServicesV2FixtureVersion().version,
    expectedFamilies: ["hero.service_request", "services.matrix", "coverage.service_area", "media.service_gallery", "process.service_steps", "contact.location_hours", "cta.final_band"],
    expectedCopy: ["Plumbing repairs", "Charlotte", "Call for service"]
  }
];

const results = [];
for (const fixture of fixtures) {
  results.push(await verifyFixture(fixture));
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      fixtures: results
    },
    null,
    2
  )}\n`
);

async function verifyFixture(input: {
  id: string;
  business: BusinessProfile;
  version: SiteVersionV2;
  expectedFamilies: string[];
  expectedCopy: string[];
}) {
  const site = fixtureSite(input.business, input.version);
  const bundle = fixtureBundle(input.business, site);
  const html = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: bundle.businessProfile,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version: input.version,
      tracking: false,
      formsEnabled: false
    })
  );

  const families = input.version.compiledPages.flatMap((page) => page.sections.map((section) => section.family));
  const uniqueFamilies = new Set(families);
  const blockers = blockersFromSiteModel(bundle, input.version);
  const inspection = await inspectGeneratedSiteBundleRender({
    bundle,
    version: input.version,
    qaRunId: `v2_benchmark_${input.id}`
  });
  const inspectionBlockers = blockersFromInspection(inspection);
  const forbiddenTemplateCopy = [
    "visual context",
    "estimate conversation",
    "repair conversation",
    "starting point",
    "site source",
    "source-backed",
    "profile details"
  ];
  const htmlLower = html.toLowerCase();
  const templateCopyVisible = forbiddenTemplateCopy.some((copy) => htmlLower.includes(copy));
  const minSectionCount = input.business.vertical === "auto_body" ? 6 : 5;
  const minImageCount = ["auto_body", "restaurant", "home_services"].includes(input.business.vertical) ? 3 : 1;
  const requiresServiceShowcase = input.business.vertical === "auto_body";
  const rubric = {
    visualQuality:
      html.includes("site-hero-v2") &&
      html.includes("site-header-v2") &&
      html.includes("site-final-cta-v2") &&
      (!requiresServiceShowcase || (html.includes("site-service-showcase-v2") && html.includes("site-service-media-panel-v2"))) &&
      (inspection.metrics.sectionCount ?? 0) >= minSectionCount &&
      (inspection.metrics.imageCount ?? 0) >= minImageCount &&
      inspection.metrics.horizontalOverflowPx === 0
        ? 5
        : 3,
    copySpecificity: input.expectedCopy.every((copy) => htmlLower.includes(copy.toLowerCase())) && !templateCopyVisible ? 5 : 3,
    factualGrounding: input.version.compiledPages.every((page) =>
      page.sections.every((section) => section.sourceFactIds.length || section.family.startsWith("process.") || section.family === "cta.final_band")
    )
      ? 5
      : 3,
    mobileQuality: html.includes("site-header-v2") && html.includes("site-button") ? 4 : 3,
    localBusinessUsefulness: html.includes(input.business.phone ?? "missing-phone") && html.includes("site-contact-v2") ? 5 : 3
  };

  assert.equal(input.version.rendererVersion, "layout-v2");
  assert.equal(blockers.length, 0, `${input.id} expected no V2 readiness blockers, got: ${blockers.map((blocker) => blocker.id).join(", ")}`);
  assert.equal(
    inspection.adapter,
    "playwright",
    `${input.id} should use Playwright for V2 browser benchmark: ${inspection.unavailableReason ?? "no fallback reason"}`
  );
  assert.equal(inspectionBlockers.length, 0, `${input.id} expected no V2 render blockers, got: ${inspectionBlockers.map((blocker) => blocker.id).join(", ")}`);
  assert.equal(inspection.screenshots.length, 3, `${input.id} should capture desktop, tablet, and mobile V2 screenshots.`);
  for (const family of input.expectedFamilies) assert.ok(uniqueFamilies.has(family as never), `${input.id} missing ${family}.`);
  assert.ok(uniqueFamilies.size >= 5, `${input.id} should render at least five distinct V2 section families.`);
  assert.equal(html.includes("button primary"), false, `${input.id} must not use internal product button classes.`);
  assert.equal(html.includes("data-mark-long"), false, `${input.id} must not render a repeated wordmark as a fallback brand mark.`);
  assert.equal(html.includes("site-mobile-action-v2"), true, `${input.id} must render generated-site mobile conversion actions.`);
  assert.equal(html.includes("4.8"), false, `${input.id} must not statically render Google rating data.`);
  assert.equal(/312\s+reviews?/i.test(html), false, `${input.id} must not statically render Google review count data.`);
  assert.equal(/google\s+(rating|reviews?)/i.test(html), false, `${input.id} must not statically render Google proof copy.`);
  if (input.business.vertical === "auto_body") {
    assert.equal(html.includes("site-proof-strip-v2"), false, `${input.id} must not clutter the hero with repeated service chips.`);
    assert.equal(html.includes("1625047509168-a7026f36de04"), false, `${input.id} must not use generic under-hood mechanic imagery.`);
    assert.equal(families.includes("guidance.insurance_estimate" as never), false, `${input.id} must not render the weak estimate-prep pill panel.`);
    assert.ok(html.includes('data-variant="capability_showcase"'), `${input.id} should render the richer auto-body service showcase variant.`);
    assert.ok(html.includes("site-service-highlights-v2"), `${input.id} should render source-backed service highlights inside the service module.`);
    assert.ok(html.includes("PDR for smaller dents and hail repair"), `${input.id} should surface source-backed auto-body highlights.`);
  }
  for (const copy of forbiddenTemplateCopy) {
    assert.equal(htmlLower.includes(copy), false, `${input.id} must not render template/prototype language: ${copy}`);
  }
  for (const [dimension, score] of Object.entries(rubric)) {
    assert.ok(score >= 4, `${input.id} ${dimension} benchmark score should be at least 4/5.`);
  }

  return {
    id: input.id,
    rendererVersion: input.version.rendererVersion,
    designSchemaVersion: input.version.designSchemaVersion,
    sectionFamilies: Array.from(uniqueFamilies),
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      bytes: screenshot.bytes,
      path: screenshot.path
    })),
    rubric,
    blockers
  };
}

function fixtureSite(business: BusinessProfile, version: SiteVersionV2): SiteModel {
  return {
    id: business.siteId,
    slug: `${business.siteId}-fixture`,
    theme: {
      paletteName: "fixture",
      colors: {
        background: "#fff",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        primary: "#b21f2d",
        primaryText: "#fff",
        accent: "#f0b429",
        border: "#ddd"
      },
      typography: { heading: "system-ui", body: "system-ui" },
      radius: "sm",
      density: "standard",
      mood: "bold"
    },
    versions: [version],
    pinList: []
  };
}

function fixtureBundle(business: BusinessProfile, site: SiteModel): SiteBundle {
  return {
    businessProfile: business,
    siteModel: site,
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: business.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}
