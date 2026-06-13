import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import {
  canonicalActiveSectionTemplateOrderV3,
  canonicalPageSectionPurposeOrderV3,
  createGeneratedSiteV3CanonicalVisualGrammarSites,
  type CanonicalVisualGrammarQaSiteResultV3,
  type GeneratedSiteV3CanonicalVisualGrammarSite
} from "../lib/generated-site-v3-canonical-visual-grammar";
import {
  sectionTemplateCatalogV3,
  sectionTemplateDefinitionV3,
  sectionTemplateForPurposeV3,
  type SectionGeometryTemplateIdV3,
  type SectionPurposeTemplateIdV3
} from "../lib/generated-site-v3-section-templates";
import {
  compileVisualSectionV3,
  foregroundForBackgroundV3,
  getVisualSectionV3,
  type HeroSectionV3,
  type MediaSlotV3,
  type VisualSectionV3
} from "../lib/generated-site-v3-visual-controls";
import type { RenderInspectionFinding, RenderInspectionResult, RenderViewportMetrics, RenderViewportName, SectionInstanceV3 } from "../lib/models";
import { SiteRenderer } from "../lib/site-renderer";

const sites = createGeneratedSiteV3CanonicalVisualGrammarSites();
const reportPath = join(process.cwd(), "docs", "generated-site-v3-canonical-visual-grammar-report.md");
const expectedShells = new Set([
  "auto_body",
  "home_service",
  "restaurant",
  "beauty_salon",
  "med_spa",
  "law_firm",
  "dental",
  "fitness",
  "real_estate",
  "landscaping",
  "veterinary",
  "creative_studio",
  "cleaning",
  "bakery",
  "tutoring",
  "pet_grooming"
]);
const forbiddenCopy = [
  "template",
  "visual proof",
  "visual factory",
  "canonical visual grammar",
  "v3",
  "component",
  "renderer",
  "synthetic",
  "placeholder",
  "primary service context",
  "workspace and visit flow",
  "focused service detail",
  "practical work detail",
  "clean section texture",
  "close crop for rhythm",
  "local storefront context"
];
const forbiddenVisualKeys = new Set([
  "sectionPurposeId",
  "sectionVariantId",
  "sectionTemplateId",
  "densityId",
  "emphasisId",
  "layoutBalanceId",
  "responsive",
  "blocks",
  "frame",
  "overlay"
]);
const activeSectionTemplateIds = new Set<SectionGeometryTemplateIdV3>(canonicalActiveSectionTemplateOrderV3);
const results: CanonicalVisualGrammarQaSiteResultV3[] = [];
const hardErrors: string[] = [];

assert.equal(sites.length, 16, "Canonical visual grammar should cover exactly 16 business shells.");
assert.deepEqual(new Set(sites.map((site) => site.shellId)), expectedShells, "Canonical visual grammar should cover the planned generic business shells.");
assert.deepEqual(new Set(sites.map((site) => site.recipeId)), new Set(["canonical_editorial"]), "Canonical visual grammar should use one recipe.");
assert.deepEqual(
  sectionTemplateCatalogV3.filter((template) => template.status === "active").map((template) => template.id),
  canonicalActiveSectionTemplateOrderV3,
  "Canonical active section templates should stay intentionally small and ordered."
);
assert.ok(
  canonicalPageSectionPurposeOrderV3.every((purposeId) => activeSectionTemplateIds.has(sectionTemplateForPurposeV3(purposeId))),
  "Every canonical section purpose should map to an active template."
);

for (const site of sites) {
  const page = site.version.pageComposition.pages[0];
  assert.ok(page, `${site.id} should include a homepage.`);
  assert.equal(site.version.rendererVersion, "layout-v3", `${site.id} should use layout-v3.`);
  assert.equal(site.version.designSchemaVersion, "design-v3", `${site.id} should use design-v3.`);
  assert.ok(page.sections.length >= site.expectations.minSections, `${site.id} should include enough sections.`);
  assert.deepEqual(
    site.expectations.expectedPagePurposes.map(sectionTemplateForPurposeV3),
    site.expectations.expectedSectionTemplates,
    `${site.id} should keep purpose-to-template expectations outside rendered section props.`
  );

  const visualSections = page.sections.map((section) => getVisualSectionV3(section.props));
  assert.ok(visualSections.every(Boolean), `${site.id} should render every section through visual-section-v3.`);
  assert.deepEqual(
    visualSections.map((section) => section?.templateId),
    site.expectations.expectedSectionTemplates,
    `${site.id} should render the approved canonical template order.`
  );
  assert.ok(
    page.sections.every((section) => section.props.renderPath === "canonical_section_template"),
    `${site.id} should route canonical sections through the section-template path.`
  );

  hardErrors.push(...page.sections.flatMap((section, index) => templateContractErrors(site, section, index)));
  hardErrors.push(...compositionRhythmErrors(site, page.sections));

  const constraintViolations = page.sections.flatMap((section) => {
    const visualSection = getVisualSectionV3(section.props);
    if (!visualSection) return [];
    return compileVisualSectionV3(visualSection).violations.map((violation) => ({ ...violation, sectionId: section.id }));
  });
  const constraintErrors = constraintViolations.filter((violation) => violation.severity === "error");
  if (constraintErrors.length) {
    hardErrors.push(`${site.id}: pre-render constraint errors ${constraintErrors.map((violation) => `${violation.sectionId}:${violation.id}`).join(", ")}`);
  }

  assert.ok(
    site.version.mediaDecisions.every((decision) => decision.rightsStatus === "approved" && decision.mayImplyRealBusinessWork === false),
    `${site.id} media decisions should be rights-safe and non-deceptive.`
  );

  const html = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: site.business,
      site: site.bundle.siteModel,
      extensions: site.bundle.extensionModel,
      locations: site.bundle.locations,
      locationBindings: site.bundle.locationBindings,
      version: site.version,
      tracking: false,
      formsEnabled: false
    })
  );
  const text = visibleText(html);
  assert.ok(html.includes("public-site-v3"), `${site.id} should render through V3.`);
  assert.ok(html.includes("site-header-v3"), `${site.id} should render the V3 header.`);
  assert.ok(html.includes(`data-header-visual-mode="${site.expectations.expectedHeaderVisualMode}"`), `${site.id} should render the expected header visual mode.`);
  assert.ok(html.includes("site-footer-column-v3"), `${site.id} should render the V3 footer.`);
  assert.equal(html.includes("<figcaption>"), false, `${site.id} must not render internal media labels as public captions.`);
  assert.equal(html.includes("button primary"), false, `${site.id} must not use Lodesta product button classes.`);
  assert.equal(/\b\d(?:\.\d)?\s+stars?\b/i.test(html), false, `${site.id} must not statically render ratings.`);
  assert.equal(/\b\d{2,}\s+reviews?\b/i.test(html), false, `${site.id} must not statically render review counts.`);
  for (const forbidden of forbiddenCopy) {
    assert.equal(text.includes(forbidden), false, `${site.id} renders internal/proof copy: ${forbidden}`);
  }

  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: site.bundle,
    version: site.version,
    qaRunId: `v3_canonical_visual_grammar_${site.id}`
  });
  const score = visualSafetyScore(site, inspection);
  const polishNotes = polishNotesFor(site, inspection, score);
  hardErrors.push(...hardErrorsFor(site, inspection));

  results.push({
    siteId: site.id,
    shellId: site.shellId,
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      path: screenshot.path,
      bytes: screenshot.bytes
    })),
    deterministicFindings: inspection.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      evidence: finding.evidence,
      viewport: finding.viewport
    })),
    visualSafetyScore: score,
    polishNotes
  });
}

await writeCanonicalReport(results);

assert.equal(hardErrors.length, 0, `Canonical visual grammar render QA failed:\n${hardErrors.join("\n")}`);

const scoreFailures = results.filter((result) => result.visualSafetyScore < 9.4);
assert.equal(
  scoreFailures.length,
  0,
  `Canonical visual grammar missed the 9.4 deterministic safety floor: ${scoreFailures.map((result) => `${result.siteId}=${result.visualSafetyScore}`).join(", ")}`
);

process.stdout.write(`${JSON.stringify({ ok: true, reportPath, sites: results.length, minScore: minScore(results) }, null, 2)}\n`);

function templateContractErrors(site: GeneratedSiteV3CanonicalVisualGrammarSite, section: SectionInstanceV3, index: number) {
  const errors: string[] = [];
  const expectedPurposeId = site.expectations.expectedPagePurposes[index];
  const expectedTemplateId = site.expectations.expectedSectionTemplates[index];
  const visualSection = getVisualSectionV3(section.props);
  if (!expectedPurposeId || !expectedTemplateId) return [`${site.id}:${section.id} missing canonical expectation for section index ${index}.`];
  if (!visualSection) return [`${site.id}:${section.id} template ${expectedTemplateId} is missing visual-section-v3 props.`];

  if (sectionTemplateForPurposeV3(expectedPurposeId) !== expectedTemplateId) {
    errors.push(`${site.id}:${section.id} purpose ${expectedPurposeId} should map to ${sectionTemplateForPurposeV3(expectedPurposeId)}, got ${expectedTemplateId}`);
  }
  if (visualSection.templateId !== expectedTemplateId) {
    errors.push(`${site.id}:${section.id} visual section should use template ${expectedTemplateId}, got ${visualSection.templateId}.`);
  }
  if ((section.props as { sectionPurposeId?: unknown }).sectionPurposeId !== undefined) {
    errors.push(`${site.id}:${section.id} should not persist sectionPurposeId on rendered section props.`);
  }
  if ((section.props as { sectionVariantId?: unknown }).sectionVariantId !== undefined) {
    errors.push(`${site.id}:${section.id} should not persist sectionVariantId on rendered section props.`);
  }

  errors.push(...forbiddenVisualFieldErrors(site.id, section.id, visualSection));
  if (!foregroundForBackgroundV3(visualSection.options.background)) {
    errors.push(`${site.id}:${expectedPurposeId}/${expectedTemplateId} background cannot support a 4.5:1 foreground.`);
  }

  const definition = sectionTemplateDefinitionV3(visualSection.templateId);
  const slotKeys = Object.keys(visualSection.slots);
  for (const slot of definition.requiredSlots) {
    if (!(slot in visualSection.slots)) errors.push(`${site.id}:${expectedPurposeId}/${expectedTemplateId} is missing required ${slot} slot.`);
  }
  const allowedSlots = new Set<string>([...definition.requiredSlots, ...definition.optionalSlots]);
  for (const slot of slotKeys) {
    if (!allowedSlots.has(slot)) {
      errors.push(`${site.id}:${expectedPurposeId}/${expectedTemplateId} includes disallowed ${slot} slot.`);
    }
  }

  errors.push(...slotShapeErrors(site.id, expectedPurposeId, visualSection));
  return errors;
}

function slotShapeErrors(siteId: string, purposeId: SectionPurposeTemplateIdV3, visualSection: VisualSectionV3) {
  const errors: string[] = [];
  const templateId = visualSection.templateId;
  const context = `${siteId}:${purposeId}/${templateId}`;

  switch (visualSection.templateId) {
    case "hero_split":
    case "hero_statement":
      errors.push(...heroShapeErrors(context, visualSection));
      break;
    case "split_media":
      if (visualSection.options.mediaSide !== "left" && visualSection.options.mediaSide !== "right") {
        errors.push(`${context} should carry a left or right mediaSide option.`);
      }
      if (mediaCount(visualSection.slots.media) !== 1) errors.push(`${context} should carry exactly one media item.`);
      break;
    case "media_feature":
      if (mediaCount(visualSection.slots.media) !== 1) errors.push(`${context} should carry exactly one media item.`);
      break;
    case "media_mosaic":
      if (mediaCount(visualSection.slots.media) !== 3) errors.push(`${context} should carry exactly three media items.`);
      break;
    case "intro_grid":
      if (visualSection.slots.items.items.length !== 3) errors.push(`${context} should carry exactly three standard items.`);
      if (visualSection.slots.items.items.some((item) => item.mediaUrl)) errors.push(`${context} should not smuggle media layout through item mediaUrl yet.`);
      if (purposeId === "pricing.packages" && visualSection.options.cardTreatment !== "comparison") {
        errors.push(`${context} pricing purpose should render as intro_grid with comparison cardTreatment.`);
      }
      if (purposeId !== "pricing.packages" && (visualSection.options.cardTreatment ?? "standard") !== "standard") {
        errors.push(`${context} non-pricing intro_grid should use standard cardTreatment.`);
      }
      break;
    case "side_intro_rows":
      if (!withinRange(visualSection.slots.items.items.length, { min: 3, max: 4 })) errors.push(`${context} should carry three or four row items.`);
      if (visualSection.slots.items.items.some((item) => item.mediaUrl)) errors.push(`${context} should not smuggle media layout through item mediaUrl yet.`);
      break;
    case "quote_wall":
      if (visualSection.slots.items.items.length !== 3) errors.push(`${context} should carry exactly three quotes.`);
      if (visualSection.slots.items.items.some((item) => !item.quote)) errors.push(`${context} quote items should use quote content fields.`);
      break;
    case "faq_list":
      if (visualSection.slots.items.items.length !== 4) errors.push(`${context} should carry exactly four FAQ items.`);
      if (visualSection.slots.items.items.some((item) => !item.question || !item.answer)) errors.push(`${context} FAQ items should use question and answer fields.`);
      break;
    case "facts_strip":
      if (!withinRange(visualSection.slots.facts.items.length, { min: 3, max: 4 })) errors.push(`${context} should carry three or four facts.`);
      break;
    case "feature_band":
      if (!withinRange(visualSection.slots.facts.items.length, { min: 3, max: 4 })) errors.push(`${context} should carry three or four facts.`);
      break;
    case "facts_cta":
      if (!withinRange(visualSection.slots.facts.items.length, { min: 3, max: 4 })) errors.push(`${context} should carry three or four facts.`);
      break;
    case "location_directory":
      if (!visualSection.slots.locations.locations.length) errors.push(`${context} should carry at least one renderable location.`);
      if (!visualSection.slots.locations.locations.some((location) => location.isPrimary)) errors.push(`${context} should identify a primary location.`);
      break;
    case "location_showcase":
      if (!visualSection.slots.locations.locations.length) errors.push(`${context} should carry one renderable location.`);
      if (!visualSection.slots.locations.locations.every((location) => location.addressLine)) errors.push(`${context} location_showcase should only carry address-bearing locations.`);
      break;
    case "service_area_showcase":
      if (!withinRange(visualSection.slots.facts.items.length, { min: 1, max: 6 })) errors.push(`${context} should carry one to six service-area facts.`);
      break;
    case "contact_split":
      if (!withinRange(visualSection.slots.contact.facts.length, { min: 3, max: 4 })) errors.push(`${context} should carry three or four contact facts.`);
      break;
    case "editorial_statement":
      break;
  }

  return errors;
}

function heroShapeErrors(context: string, visualSection: HeroSectionV3) {
  const errors: string[] = [];
  if (visualSection.templateId === "hero_split") {
    const background = visualSection.options.background as VisualSectionV3["options"]["background"];
    if (background.kind === "image") errors.push(`${context} split hero must reject image backgrounds because it owns a media slot.`);
    if (!("media" in visualSection.slots) || mediaCount(visualSection.slots.media) !== 1) errors.push(`${context} split hero should carry one bounded media item.`);
  }
  if (visualSection.templateId === "hero_statement") {
    if ("media" in visualSection.slots) errors.push(`${context} statement hero should not carry a media slot.`);
    if (visualSection.options.background.kind === "image" && !visualSection.options.background.url.trim()) {
      errors.push(`${context} image-backed statement hero requires an eligible image background.`);
    }
  }
  return errors;
}

function forbiddenVisualFieldErrors(siteId: string, sectionId: string, value: unknown, path = "visualSectionV3"): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return errors;
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...forbiddenVisualFieldErrors(siteId, sectionId, item, `${path}[${index}]`)));
    return errors;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenVisualKeys.has(key)) {
      errors.push(`${siteId}:${sectionId} should not author legacy renderer-control field ${path}.${key}.`);
    }
    if (key === "kind" && (child === "linear_gradient" || child === "radial_gradient")) {
      errors.push(`${siteId}:${sectionId} should not author old background kind ${String(child)} at ${path}.kind.`);
    }
    errors.push(...forbiddenVisualFieldErrors(siteId, sectionId, child, `${path}.${key}`));
  }
  return errors;
}

function compositionRhythmErrors(site: GeneratedSiteV3CanonicalVisualGrammarSite, sections: SectionInstanceV3[]) {
  const errors: string[] = [];
  const visualSections = sections.map((section) => getVisualSectionV3(section.props)).filter((section): section is VisualSectionV3 => Boolean(section));
  const templateIds = visualSections.map((section) => section.templateId);
  const rhythmRoles = templateIds.map((templateId) => sectionTemplateDefinitionV3(templateId).rhythmRole);
  const heroSections = visualSections.filter(isHeroTemplateV3);
  for (let index = 1; index < templateIds.length; index += 1) {
    if (templateIds[index] === templateIds[index - 1]) errors.push(`${site.id}: adjacent sections repeat template ${templateIds[index]}.`);
  }
  for (let index = 1; index < rhythmRoles.length; index += 1) {
    if (rhythmRoles[index] === rhythmRoles[index - 1]) errors.push(`${site.id}: adjacent sections repeat rhythm role ${rhythmRoles[index]}.`);
  }
  if (heroSections.length !== 1) errors.push(`${site.id}: expected exactly one hero template.`);
  if (!visualSections[0] || !isHeroTemplateV3(visualSections[0])) errors.push(`${site.id}: first section should use a hero template.`);
  if (templateIds.at(-1) !== "contact_split") errors.push(`${site.id}: final section should close with contact_split.`);
  for (const requiredTemplate of ["intro_grid", "feature_band", "media_feature", "media_mosaic", "quote_wall", "faq_list", "editorial_statement"] as const) {
    if (!templateIds.includes(requiredTemplate)) errors.push(`${site.id}: missing required rhythm template ${requiredTemplate}.`);
  }
  if (new Set(templateIds).size < 10) errors.push(`${site.id}: section rhythm uses too few distinct templates (${new Set(templateIds).size}).`);
  return errors;
}

function mediaCount(slot: MediaSlotV3) {
  return slot.items.filter((item) => Boolean(item.url.trim())).length;
}

function withinRange(value: number, range: { min: number; max: number }) {
  return value >= range.min && value <= range.max;
}

function visualSafetyScore(site: GeneratedSiteV3CanonicalVisualGrammarSite, inspection: RenderInspectionResult) {
  let score = 10;
  const relevantWarnings = inspection.findings.filter((finding) => finding.severity === "warning" && !ignoredWarning(finding));
  score -= relevantWarnings.length * 0.07;
  score -= inspection.findings.filter((finding) => finding.severity === "fail").length * 0.9;

  for (const viewport of ["desktop", "tablet", "mobile"] as RenderViewportName[]) {
    const metrics = inspection.metricsByViewport?.[viewport];
    if (!metrics) {
      score -= 0.6;
      continue;
    }
    score -= viewportPenalty(site, metrics, viewport);
  }

  if ((inspection.metrics.imageCount ?? 0) < site.expectations.minImageCount) score -= 0.4;
  if ((inspection.metrics.sectionCount ?? 0) < site.expectations.minSections) score -= 0.4;
  return Math.max(0, Math.round(score * 100) / 100);
}

function viewportPenalty(site: GeneratedSiteV3CanonicalVisualGrammarSite, metrics: RenderViewportMetrics, viewport: RenderViewportName) {
  let penalty = 0;
  const maxLines = viewport === "mobile" ? 5 : 4;
  if ((metrics.heroH1LineCount ?? 0) > maxLines) penalty += 0.45;
  if ((metrics.heroH1MaxLineWidthPx ?? 0) > metrics.viewport.width - 24) penalty += 0.35;
  if ((metrics.visualOverlapCount ?? 0) > 0) penalty += 0.8;
  if ((metrics.crampedTextCount ?? 0) > 0) penalty += 0.6;
  if (viewport !== "mobile" && (metrics.heroMediaEdgeClipCount ?? 0) > 0 && !usesFullBleedHero(site)) penalty += 0.8;
  if ((metrics.headerContrastRatio ?? 10) < 4.5) penalty += 0.7;
  if ((metrics.minTextContrastRatio ?? 10) < 4.5) penalty += 0.7;
  if ((metrics.horizontalOverflowPx ?? 0) > 2) penalty += 0.9;
  if (!metrics.primaryHeroCtaAboveFold) penalty += 0.5;
  if (!metrics.primaryMediaImageLoaded && usesMediaHero(site)) penalty += 0.3;
  return penalty;
}

function polishNotesFor(site: GeneratedSiteV3CanonicalVisualGrammarSite, inspection: RenderInspectionResult, score: number) {
  const notes: string[] = [];
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");
  if (failingFindings.length) notes.push(`Failing deterministic findings: ${failingFindings.map((finding) => finding.id).join(", ")}`);
  if (score < 9.4) notes.push(`Visual safety score ${score}/10 is below the canonical floor.`);

  for (const viewport of ["desktop", "tablet", "mobile"] as RenderViewportName[]) {
    const metrics = inspection.metricsByViewport?.[viewport];
    if (!metrics) continue;
    if ((metrics.heroH1LineCount ?? 0) > (viewport === "mobile" ? 5 : 4)) notes.push(`${viewport}: H1 uses ${metrics.heroH1LineCount} lines.`);
    if ((metrics.visualOverlapCount ?? 0) > 0) notes.push(`${viewport}: foreground overlap ${(metrics.visualOverlapSamples ?? []).join("; ")}`);
    if ((metrics.crampedTextCount ?? 0) > 0) notes.push(`${viewport}: cramped text ${(metrics.crampedTextSamples ?? []).join("; ")}`);
    if (viewport !== "mobile" && (metrics.heroMediaEdgeClipCount ?? 0) > 0 && !usesFullBleedHero(site)) {
      notes.push(`${viewport}: hero media edge clipping ${(metrics.heroMediaEdgeClipSamples ?? []).join("; ")}`);
    }
    if ((metrics.headerContrastRatio ?? 10) < 4.5) notes.push(`${viewport}: header contrast ${metrics.headerContrastRatio?.toFixed(2) ?? "unknown"}.`);
  }

  return notes;
}

function hardErrorsFor(site: GeneratedSiteV3CanonicalVisualGrammarSite, inspection: RenderInspectionResult) {
  const errors: string[] = [];
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");
  if (inspection.adapter !== "playwright") errors.push(`${site.id}: expected Playwright adapter, got ${inspection.adapter} (${inspection.unavailableReason ?? "no reason"})`);
  if (inspection.screenshots.length !== 3) errors.push(`${site.id}: expected 3 screenshots, got ${inspection.screenshots.length}`);
  if (failingFindings.length) errors.push(`${site.id}: failing render findings ${failingFindings.map((finding) => finding.id).join(", ")}`);
  if ((inspection.metrics.horizontalOverflowPx ?? 0) !== 0) errors.push(`${site.id}: horizontal overflow ${inspection.metrics.horizontalOverflowPx}`);
  if ((inspection.metrics.brokenImageCount ?? 0) !== 0) errors.push(`${site.id}: broken images ${inspection.metrics.brokenImageCount}`);
  if ((inspection.metrics.imageCount ?? 0) < site.expectations.minImageCount) errors.push(`${site.id}: image count ${inspection.metrics.imageCount ?? 0} below ${site.expectations.minImageCount}`);
  if ((inspection.metrics.bodyFontSizePx ?? 0) < 16) errors.push(`${site.id}: body font ${inspection.metrics.bodyFontSizePx ?? 0}px below 16px`);
  if ((inspection.metrics.minReadableTextFontSizePx ?? 0) < 14) errors.push(`${site.id}: readable text ${inspection.metrics.minReadableTextFontSizePx ?? 0}px below 14px`);
  if ((inspection.metrics.minTextContrastRatio ?? 0) < 4.5) errors.push(`${site.id}: text contrast ${inspection.metrics.minTextContrastRatio ?? 0} below 4.5`);
  if ((inspection.metrics.headerContrastRatio ?? 0) < 4.5) errors.push(`${site.id}: header contrast ${inspection.metrics.headerContrastRatio ?? 0} below 4.5`);
  if ((inspection.metrics.visualOverlapCount ?? 0) !== 0) errors.push(`${site.id}: foreground overlaps ${(inspection.metrics.visualOverlapSamples ?? []).join("; ")}`);
  if ((inspection.metrics.crampedTextCount ?? 0) !== 0) errors.push(`${site.id}: cramped text ${(inspection.metrics.crampedTextSamples ?? []).join("; ")}`);
  for (const viewport of ["desktop", "tablet"] as RenderViewportName[]) {
    const metrics = inspection.metricsByViewport?.[viewport];
    if ((metrics?.heroMediaEdgeClipCount ?? 0) !== 0 && !usesFullBleedHero(site)) {
      errors.push(`${site.id}: ${viewport} hero media edge clipping ${(metrics?.heroMediaEdgeClipSamples ?? []).join("; ")}`);
    }
  }
  return errors;
}

function usesFullBleedHero(site: GeneratedSiteV3CanonicalVisualGrammarSite) {
  const firstSection = getVisualSectionV3(site.version.pageComposition.pages[0]?.sections[0]?.props ?? {});
  return firstSection?.templateId === "hero_statement" && firstSection.options.background.kind === "image";
}

function usesMediaHero(site: GeneratedSiteV3CanonicalVisualGrammarSite) {
  const firstSection = getVisualSectionV3(site.version.pageComposition.pages[0]?.sections[0]?.props ?? {});
  return firstSection?.templateId === "hero_split";
}

function isHeroTemplateV3(section: VisualSectionV3) {
  return section.templateId === "hero_split" || section.templateId === "hero_statement";
}

function ignoredWarning(finding: RenderInspectionFinding) {
  return finding.id.startsWith("render.form") || finding.id.startsWith("render.tel_link");
}

function visibleText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function minScore(results: CanonicalVisualGrammarQaSiteResultV3[]) {
  return results.length ? Math.min(...results.map((result) => result.visualSafetyScore)) : 0;
}

async function writeCanonicalReport(results: CanonicalVisualGrammarQaSiteResultV3[]) {
  await mkdir(dirname(reportPath), { recursive: true });
  const failures = results.filter((result) => result.visualSafetyScore < 9.4 || result.polishNotes.length);
  const lines = [
    "# Generated Site V3 Canonical Section Template Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "This report is produced by `npm run verify:generated-site-v3-section-template-library`. It verifies one reusable high-polish generic homepage section-template stack across 16 local-business shells.",
    "",
    "## Active Templates",
    "",
    "- `HeaderStandard` and `FooterStandard` are V3 chrome.",
    `- Active templates: ${canonicalActiveSectionTemplateOrderV3.map((templateId) => `\`${templateId}\``).join(", ")}.`,
    `- Default page section purposes render in this order: ${canonicalPageSectionPurposeOrderV3.map((purposeId) => `\`${purposeId}\``).join(", ")}.`,
    "- Canonical page sections must carry `renderPath: \"canonical_section_template\"` and a typed `visualSectionV3` with `templateId`, `options`, and `slots`.",
    "",
    "## Summary",
    "",
    `- Sites: ${results.length}`,
    `- Minimum deterministic visual safety score: ${minScore(results).toFixed(2)}/10`,
    `- Sites below 9.4: ${results.filter((result) => result.visualSafetyScore < 9.4).length}`,
    `- Sites with polish notes: ${failures.length}`,
    "",
    "## Sites",
    "",
    ...results.flatMap((result) => [
      `### ${result.siteId}`,
      "",
      "- Recipe: `canonical_editorial`",
      `- Shell: \`${result.shellId}\``,
      `- Deterministic visual safety score: ${result.visualSafetyScore}/10`,
      `- Failing findings: ${result.deterministicFindings.filter((finding) => finding.severity === "fail").map((finding) => finding.id).join(", ") || "none"}`,
      `- Polish notes: ${result.polishNotes.join(" | ") || "none"}`,
      "- Screenshots:",
      ...result.screenshots.map((screenshot) => `  - ${screenshot.viewport}: ${screenshot.path ?? "missing"} (${screenshot.bytes ?? 0} bytes)`),
      ""
    ]),
    "## Acceptance",
    "",
    "- 16 sites cover one canonical recipe across many generic local-business shells.",
    "- Every canonical section uses an approved template and typed slot contract.",
    "- Purpose and rhythm metadata remain in generation expectations, not authored renderer section props.",
    "- Composition rhythm rejects adjacent template or rhythm-role repetition and requires feature, media, editorial, and contact-close templates.",
    "- Every section renders through `visual-section-v3` and the public V3 renderer.",
    "- Desktop, tablet, and mobile screenshots are captured for every site.",
    "- Deterministic QA checks overlap, cramped text, H1 line behavior, header contrast, overflow, media loading, hero media edge clipping, CTA visibility, and template drift.",
    "- A score below 9.4 is treated as a blocker and recorded above before the command fails.",
    ""
  ];
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
}
