import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import {
  createGeneratedSiteV3CanonicalVisualGrammarSites,
  type GeneratedSiteV3CanonicalVisualGrammarSite
} from "../lib/generated-site-v3-canonical-visual-grammar";
import { sectionTemplateForPurposeV3 } from "../lib/generated-site-v3-section-templates";
import { compileVisualSectionV3, foregroundForBackgroundV3, getVisualSectionV3, type VisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import type { RenderInspectionResult, RenderViewportMetrics, RenderViewportName } from "../lib/models";
import { SiteRenderer } from "../lib/site-renderer";

const reportPath = join(process.cwd(), "docs", "generated-site-v3-validation-pack-report.md");
const validationShellIds = ["auto_body", "home_service", "restaurant", "law_firm"] as const;
const allowedAssetPlaceholderShellIds = new Set<string>(["home_service", "restaurant", "law_firm"]);
const forbiddenPublicCopy = [
  "template",
  "visual proof",
  "visual factory",
  "canonical visual grammar",
  "section-template",
  "v3",
  "component",
  "renderer",
  "synthetic",
  "placeholder",
  "generic contact form",
  "the page keeps",
  "the site keeps",
  "page rhythm",
  "full page",
  "detached card grid",
  "page feel",
  "short descriptions",
  "visual noise",
  "decision point",
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

type IssueSeverity = "blocker" | "warning" | "known_limit";
type IssueCategory = "renderer_template" | "content" | "asset";

type ValidationIssue = {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  detail: string;
};

type ValidationPackResult = {
  siteId: string;
  shellId: string;
  label: string;
  rendererVersion: string;
  sectionPurposes: string[];
  sectionTemplates: string[];
  heroTemplates: string[];
  backgrounds: string[];
  screenshots: Array<{ viewport: string; path?: string; bytes?: number }>;
  metrics: {
    bodyTextChars?: number;
    ctaCount?: number;
    imageCount?: number;
    minTextContrastRatio?: number;
    headerContrastRatio?: number;
    horizontalOverflowPx?: number;
  };
  issues: ValidationIssue[];
  deterministicFindings: Array<{ id: string; severity: "pass" | "warning" | "fail"; evidence: string; viewport?: string }>;
};

const sites = createGeneratedSiteV3CanonicalVisualGrammarSites().filter((site) =>
  validationShellIds.includes(site.shellId as (typeof validationShellIds)[number])
);

assert.equal(sites.length, validationShellIds.length, "V3 validation pack should include exactly the four selected archetypes.");
assert.deepEqual(
  sites.map((site) => site.shellId),
  [...validationShellIds],
  "V3 validation pack should preserve the planned archetype order."
);

const results: ValidationPackResult[] = [];

for (const site of sites) {
  const page = site.version.pageComposition.pages[0];
  assert.ok(page, `${site.id} should include a homepage.`);

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
  const visibleTextCorpus = visibleText(html);
  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: site.bundle,
    version: site.version,
    qaRunId: `v3_validation_pack_${site.shellId}`
  });
  const visualSections = page.sections.map((section) => getVisualSectionV3(section.props)).filter((section): section is VisualSectionV3 => Boolean(section));
  const issues = [
    ...rendererTemplateIssues(site, inspection),
    ...contentIssues(site, visibleTextCorpus, html),
    ...assetIssues(site, inspection)
  ];

  results.push({
    siteId: site.id,
    shellId: site.shellId,
    label: site.label,
    rendererVersion: site.version.rendererVersion,
    sectionPurposes: site.expectations.expectedPagePurposes.map(String),
    sectionTemplates: visualSections.map((section) => section.templateId),
    heroTemplates: visualSections.filter(isHeroTemplateV3).map((section) => section.templateId),
    backgrounds: visualSections.map((section) => backgroundLabel(section)),
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      path: screenshot.path,
      bytes: screenshot.bytes
    })),
    metrics: {
      bodyTextChars: inspection.metrics.bodyTextChars,
      ctaCount: inspection.metrics.ctaCount,
      imageCount: inspection.metrics.imageCount,
      minTextContrastRatio: inspection.metrics.minTextContrastRatio,
      headerContrastRatio: inspection.metrics.headerContrastRatio,
      horizontalOverflowPx: inspection.metrics.horizontalOverflowPx
    },
    issues,
    deterministicFindings: inspection.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      evidence: finding.evidence,
      viewport: finding.viewport
    }))
  });
}

await writeValidationPackReport(results);

const blockers = results.flatMap((result) =>
  result.issues
    .filter((issue) => issue.severity === "blocker")
    .map((issue) => `${result.siteId}: ${issue.category}/${issue.id} - ${issue.detail}`)
);

assert.equal(blockers.length, 0, `V3 validation pack found blocker issues:\n${blockers.join("\n")}`);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      reportPath,
      sites: results.length,
      blockers: 0,
      warnings: results.flatMap((result) => result.issues.filter((issue) => issue.severity === "warning")).length,
      knownLimits: results.flatMap((result) => result.issues.filter((issue) => issue.severity === "known_limit")).length
    },
    null,
    2
  )}\n`
);

function rendererTemplateIssues(site: GeneratedSiteV3CanonicalVisualGrammarSite, inspection: RenderInspectionResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const page = site.version.pageComposition.pages[0];
  const visualSections = page?.sections.map((section) => getVisualSectionV3(section.props)) ?? [];
  const templates = visualSections.map((section) => section?.templateId ?? "missing");
  const expectedTemplateOrder = site.expectations.expectedSectionTemplates.map(String);
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");

  if (site.version.rendererVersion !== "layout-v3") {
    issues.push(blocker("renderer_version", "renderer_template", `Expected layout-v3, got ${site.version.rendererVersion}.`));
  }
  if (!arrayEqual(site.expectations.expectedPagePurposes.map(sectionTemplateForPurposeV3), site.expectations.expectedSectionTemplates)) {
    issues.push(blocker("purpose_template_mapping", "renderer_template", "Purpose metadata no longer maps cleanly to template expectations."));
  }
  if (!arrayEqual(templates, expectedTemplateOrder)) {
    issues.push(blocker("section_template_order", "renderer_template", `Expected ${expectedTemplateOrder.join(", ")}, got ${templates.join(", ")}.`));
  }
  if (inspection.adapter !== "playwright") {
    issues.push(blocker("playwright_adapter", "renderer_template", `Expected Playwright adapter, got ${inspection.adapter}: ${inspection.unavailableReason ?? "no reason"}.`));
  }
  if (inspection.screenshots.length !== 3) {
    issues.push(blocker("screenshots", "renderer_template", `Expected desktop/tablet/mobile screenshots, got ${inspection.screenshots.length}.`));
  }
  if (failingFindings.length) {
    issues.push(blocker("deterministic_findings", "renderer_template", failingFindings.map((finding) => finding.id).join(", ")));
  }
  for (const section of page?.sections ?? []) {
    const visualSection = getVisualSectionV3(section.props);
    if (!visualSection) {
      issues.push(blocker("missing_visual_section", "renderer_template", `${section.id} is missing visual-section-v3 props.`));
      continue;
    }
    const compiled = compileVisualSectionV3(visualSection);
    const compileErrors = compiled.violations.filter((violation) => violation.severity === "error");
    if (compileErrors.length) {
      issues.push(blocker("visual_section_contract", "renderer_template", `${section.id}: ${compileErrors.map((violation) => violation.id).join(", ")}.`));
    }
    if (!foregroundForBackgroundV3(visualSection.options.background)) {
      issues.push(blocker("background_text_contrast", "renderer_template", `${section.id} background cannot resolve a 4.5:1 foreground.`));
    }
    for (const field of forbiddenVisualFieldErrors(visualSection)) {
      issues.push(blocker("legacy_renderer_control", "renderer_template", `${section.id}: ${field}.`));
    }
  }
  if ((inspection.metrics.horizontalOverflowPx ?? 0) > 0) {
    issues.push(blocker("horizontal_overflow", "renderer_template", `${inspection.metrics.horizontalOverflowPx}px horizontal overflow.`));
  }
  if ((inspection.metrics.visualOverlapCount ?? 0) > 0) {
    issues.push(blocker("visual_overlap", "renderer_template", (inspection.metrics.visualOverlapSamples ?? []).join("; ")));
  }
  if ((inspection.metrics.crampedTextCount ?? 0) > 0) {
    issues.push(blocker("cramped_text", "renderer_template", (inspection.metrics.crampedTextSamples ?? []).join("; ")));
  }
  if ((inspection.metrics.minTextContrastRatio ?? 0) < 4.5) {
    issues.push(blocker("text_contrast", "renderer_template", `Minimum contrast ${inspection.metrics.minTextContrastRatio ?? 0}.`));
  }
  if ((inspection.metrics.headerContrastRatio ?? 0) < 4.5) {
    issues.push(blocker("header_contrast", "renderer_template", `Header contrast ${inspection.metrics.headerContrastRatio ?? 0}.`));
  }

  for (const viewport of ["desktop", "tablet", "mobile"] as RenderViewportName[]) {
    const metrics = inspection.metricsByViewport?.[viewport];
    if (!metrics) {
      issues.push(blocker(`missing_${viewport}_metrics`, "renderer_template", `Missing ${viewport} metrics.`));
      continue;
    }
    issues.push(...viewportWarnings(viewport, metrics));
  }

  return issues;
}

function viewportWarnings(viewport: RenderViewportName, metrics: RenderViewportMetrics): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const maxLines = viewport === "mobile" ? 6 : viewport === "tablet" ? 5 : 4;
  if ((metrics.heroH1LineCount ?? 0) > maxLines) {
    issues.push(warning(`h1_lines_${viewport}`, "renderer_template", `${viewport} H1 uses ${metrics.heroH1LineCount} lines.`));
  }
  if (!metrics.primaryHeroCtaAboveFold) {
    issues.push(warning(`hero_cta_${viewport}`, "renderer_template", `${viewport} primary hero CTA is not meaningfully visible in the first viewport.`));
  }
  if ((metrics.imageCount ?? 0) < 2) {
    issues.push(warning(`image_depth_${viewport}`, "renderer_template", `${viewport} has ${metrics.imageCount ?? 0} images.`));
  }
  return issues;
}

function contentIssues(site: GeneratedSiteV3CanonicalVisualGrammarSite, visibleTextCorpus: string, html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const forbidden of forbiddenPublicCopy) {
    if (visibleTextCorpus.includes(forbidden)) {
      issues.push(blocker("internal_public_copy", "content", `Rendered internal/template phrase: "${forbidden}".`));
    }
  }
  if (html.includes("<figcaption>")) {
    issues.push(blocker("public_media_caption", "content", "Rendered media caption markup without an explicit validation-pack public-caption requirement."));
  }
  if (!visibleTextCorpus.includes(site.business.name.toLowerCase())) {
    issues.push(blocker("business_name", "content", `Rendered page does not include ${site.business.name}.`));
  }
  if (visibleTextCorpus.length < 900) {
    issues.push(warning("thin_copy", "content", `Rendered visible text corpus is ${visibleTextCorpus.length} characters.`));
  }
  return issues;
}

function assetIssues(site: GeneratedSiteV3CanonicalVisualGrammarSite, inspection: RenderInspectionResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if ((inspection.metrics.brokenImageCount ?? 0) > 0) {
    issues.push(blocker("broken_images", "asset", `${inspection.metrics.brokenImageCount} broken images.`));
  }
  if ((inspection.metrics.imageCount ?? 0) < site.expectations.minImageCount) {
    issues.push(warning("low_image_count", "asset", `${inspection.metrics.imageCount ?? 0} images below expected ${site.expectations.minImageCount}.`));
  }
  if (site.business.vertical !== "auto_body" && usesAutoBodyMedia(site)) {
    const severity: IssueSeverity = allowedAssetPlaceholderShellIds.has(site.shellId) ? "known_limit" : "warning";
    issues.push({
      id: "placeholder_vertical_mismatch",
      category: "asset",
      severity,
      detail: "Uses current auto-body fixture media to test geometry; replace with vertical-appropriate assets before judging business-specific quality."
    });
  }
  return issues;
}

function forbiddenVisualFieldErrors(value: unknown, path = "visualSectionV3"): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return errors;
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...forbiddenVisualFieldErrors(item, `${path}[${index}]`)));
    return errors;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenVisualKeys.has(key)) errors.push(`${path}.${key}`);
    if (key === "kind" && (child === "linear_gradient" || child === "radial_gradient")) errors.push(`${path}.kind=${String(child)}`);
    errors.push(...forbiddenVisualFieldErrors(child, `${path}.${key}`));
  }
  return errors;
}

function backgroundLabel(section: VisualSectionV3) {
  const background = section.options.background;
  return background.kind === "image" ? "image" : `${background.kind}:${background.token}`;
}

function usesAutoBodyMedia(site: GeneratedSiteV3CanonicalVisualGrammarSite) {
  return site.version.mediaDecisions.some((decision) => decision.sourceUrl?.includes("/generated-site-assets/auto-body/"));
}

function blocker(id: string, category: IssueCategory, detail: string): ValidationIssue {
  return { id, category, severity: "blocker", detail };
}

function warning(id: string, category: IssueCategory, detail: string): ValidationIssue {
  return { id, category, severity: "warning", detail };
}

function arrayEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function visibleText(html: string) {
  return decodeBasicHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'");
}

function isHeroTemplateV3(section: VisualSectionV3) {
  return section.templateId === "hero_split" || section.templateId === "hero_statement";
}

async function writeValidationPackReport(results: ValidationPackResult[]) {
  await mkdir(dirname(reportPath), { recursive: true });
  const blockers = results.flatMap((result) => result.issues.filter((issue) => issue.severity === "blocker"));
  const warnings = results.flatMap((result) => result.issues.filter((issue) => issue.severity === "warning"));
  const knownLimits = results.flatMap((result) => result.issues.filter((issue) => issue.severity === "known_limit"));
  const lines = [
    "# Generated Site V3 Validation Pack Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "This report is produced by `npm run verify:generated-site-v3-validation-pack`. It validates four generic landing pages rendered through the canonical V3 typed-slot section-template model: auto body, home service, restaurant, and professional service.",
    "",
    "## Summary",
    "",
    `- Sites: ${results.length}`,
    `- Blockers: ${blockers.length}`,
    `- Warnings: ${warnings.length}`,
    `- Known limits: ${knownLimits.length}`,
    "",
    "## Template Coverage",
    "",
    "- Section purposes are generation metadata only; rendered sections carry typed `visualSectionV3` objects.",
    "- Template order, hero template choice, background choices, slot contracts, and browser render metrics are validated.",
    "",
    "## Sites",
    ""
  ];

  for (const result of results) {
    lines.push(`### ${result.label}`);
    lines.push("");
    lines.push(`- Shell: \`${result.shellId}\``);
    lines.push(`- Renderer: \`${result.rendererVersion}\``);
    lines.push(`- Purposes: ${result.sectionPurposes.join(" -> ")}`);
    lines.push(`- Templates: ${result.sectionTemplates.join(" -> ")}`);
    lines.push(`- Hero template: ${result.heroTemplates.join(", ") || "none"}`);
    lines.push(`- Backgrounds: ${result.backgrounds.join(" -> ")}`);
    lines.push(`- Metrics: body ${result.metrics.bodyTextChars ?? 0} chars, ${result.metrics.ctaCount ?? 0} CTAs, ${result.metrics.imageCount ?? 0} images, min contrast ${(result.metrics.minTextContrastRatio ?? 0).toFixed(2)}, header contrast ${(result.metrics.headerContrastRatio ?? 0).toFixed(2)}`);
    lines.push(`- Screenshots: ${result.screenshots.map((screenshot) => `${screenshot.viewport}: ${screenshot.path ?? "missing"}`).join("; ")}`);
    lines.push("");
    if (result.issues.length) {
      lines.push("| Category | Severity | Issue | Detail |");
      lines.push("|---|---:|---|---|");
      for (const issue of result.issues) {
        lines.push(`| ${issue.category} | ${issue.severity} | ${issue.id} | ${escapeMarkdown(issue.detail)} |`);
      }
    } else {
      lines.push("No issues classified.");
    }
    lines.push("");
  }

  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
