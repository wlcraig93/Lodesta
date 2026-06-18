import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import {
  componentControlOptionsForBlueprintV1,
  templateOptionsForBlueprintV1
} from "../lib/generated-site-v3-blueprint";

type TemplateId = keyof typeof templateOptionsForBlueprintV1;
type TemplateOptionMap = Record<string, string>;
type MetricNode = {
  role: string;
  display: string;
  gridTemplateColumns: string;
  backgroundColor: string;
  backgroundImage: string;
  borderLeftWidth: string;
  borderTopWidth: string;
  borderBottomWidth: string;
  borderRadius: string;
  color: string;
  textAlign: string;
  objectPosition: string;
  gap: string;
  paddingTop: string;
  paddingLeft: string;
  transform: string;
  rect: { x: number; y: number; width: number; height: number };
};

const viewports = [
  { width: 1280, height: 1200 },
  { width: 980, height: 1200 },
  { width: 768, height: 1100 },
  { width: 375, height: 1000 }
] as const;

const defaultOptions: Record<TemplateId, TemplateOptionMap> = {
  hero_split: {
    heroLayout: "classic_split",
    proofPlacement: "below_copy",
    ctaLayout: "inline",
    mediaTreatment: "framed",
    headlineScale: "standard"
  },
  intro_grid: {
    cardTreatment: "standard",
    headingLayout: "full_width",
    numberDisplay: "none",
    cardAction: "text_link",
    mediaAspect: "16x10",
    mediaCrop: "subject",
    cardTone: "uniform",
    gridPattern: "equal_grid"
  },
  numbered_steps: {
    stepTreatment: "stepper_vertical",
    orientation: "vertical",
    numberStyle: "small_badge",
    mediaMode: "none",
    stepDensity: "balanced"
  },
  split_media: {
    mediaSide: "left"
  },
  hero_statement: {
    heroAlign: "left",
    heroLayout: "classic_split",
    proofPlacement: "below_copy",
    ctaLayout: "inline",
    mediaTreatment: "framed",
    headlineScale: "standard"
  },
  media_mosaic: {
    mediaPattern: "lead_left",
    captionMode: "below",
    cropSet: "consistent"
  },
  location_showcase: {
    locationLayout: "map_left_hours_right",
    statusBadge: "open_now",
    hoursDisplay: "full_week",
    actionCluster: "directions_call"
  },
  contact_split: {
    contactLayout: "call_first",
    formComplexity: "short",
    proofSidebar: "trust_facts",
    ctaMode: "phone"
  },
  eligibility_band: {
    eligibilityTreatment: "statement_plus_list"
  },
  service_index: {
    serviceIndexTreatment: "categorized_menu"
  },
  case_study_preview: {
    caseStudyTreatment: "story_card"
  },
  comparison_table: {
    comparisonTreatment: "feature_compare"
  },
  team_story: {
    teamStoryTreatment: "portrait_split"
  },
  offer_band: {
    offerBandTreatment: "quiet_offer"
  }
};

const attributeNames: Record<string, string> = {
  heroAlign: "data-align",
  heroLayout: "data-hero-layout",
  proofPlacement: "data-proof-placement",
  ctaLayout: "data-cta-layout",
  mediaTreatment: "data-media-treatment",
  headlineScale: "data-headline-scale",
  mediaSide: "data-media-side",
  cardTreatment: "data-card-treatment",
  headingLayout: "data-heading-layout",
  numberDisplay: "data-number-display",
  cardAction: "data-card-action",
  mediaAspect: "data-media-aspect",
  mediaCrop: "data-media-crop",
  cardTone: "data-card-tone",
  gridPattern: "data-grid-pattern",
  stepTreatment: "data-step-treatment",
  orientation: "data-step-orientation",
  numberStyle: "data-number-style",
  mediaMode: "data-step-media-mode",
  stepDensity: "data-step-density",
  locationLayout: "data-location-layout",
  statusBadge: "data-location-status-badge",
  hoursDisplay: "data-location-hours-display",
  actionCluster: "data-location-action-cluster",
  contactLayout: "data-contact-layout",
  formComplexity: "data-contact-form-complexity",
  proofSidebar: "data-contact-proof-sidebar",
  ctaMode: "data-contact-cta-mode",
  mediaPattern: "data-media-pattern",
  captionMode: "data-caption-mode",
  cropSet: "data-crop-set",
  eligibilityTreatment: "data-eligibility-treatment",
  serviceIndexTreatment: "data-service-index-treatment",
  caseStudyTreatment: "data-case-study-treatment",
  comparisonTreatment: "data-comparison-treatment",
  teamStoryTreatment: "data-team-story-treatment",
  offerBandTreatment: "data-offer-band-treatment"
};

const defaultComponentControls: Record<string, string> = {
  layout: "two_column",
  alignment: "split",
  width: "wide",
  padding: "standard",
  background: "surface",
  mediaCrop: "center",
  density: "balanced"
};

const controlAttributeNames: Record<string, string> = {
  layout: "data-control-layout",
  alignment: "data-control-alignment",
  width: "data-control-width",
  padding: "data-control-padding",
  background: "data-control-background",
  mediaCrop: "data-control-media-crop",
  density: "data-control-density"
};

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

async function main() {
  validateManifestShape();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures: string[] = [];
  let checked = 0;

  try {
    for (const [templateId, optionGroups] of Object.entries(templateOptionsForBlueprintV1) as Array<[TemplateId, Record<string, readonly string[]>]>) {
      for (const [optionName, values] of Object.entries(optionGroups)) {
        const defaultValue = defaultOptions[templateId]?.[optionName];
        if (!defaultValue) {
          failures.push(`${templateId}.${optionName}: no default value declared in variant coverage verifier.`);
          continue;
        }
        for (const value of values) {
          if (value === defaultValue) continue;
          checked += 1;
          const diffedViewports: number[] = [];
          for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            const baseOptions = compatibleFixtureOptions(templateId, { ...defaultOptions[templateId] });
            const variantOptions = compatibleFixtureOptions(templateId, { ...defaultOptions[templateId], [optionName]: value });
            const base = await renderAndMeasure(page, templateId, baseOptions);
            const variant = await renderAndMeasure(page, templateId, variantOptions);
            if (base.qaIssues.length) failures.push(`${templateId}.${optionName}=${defaultValue} @ ${viewport.width}: ${base.qaIssues.join("; ")}`);
            if (variant.qaIssues.length) failures.push(`${templateId}.${optionName}=${value} @ ${viewport.width}: ${variant.qaIssues.join("; ")}`);
            if (metricsMateriallyDiffer(base.metrics, variant.metrics)) diffedViewports.push(viewport.width);
          }
          if (!diffedViewports.length) {
            failures.push(`${templateId}.${optionName}=${value}: rendered metrics match the default at 1280, 980, 768, and 375.`);
          }
        }
      }
    }
    for (const [controlName, values] of Object.entries(componentControlOptionsForBlueprintV1)) {
      const defaultValue = defaultComponentControls[controlName];
      if (!defaultValue) {
        failures.push(`componentControls.${controlName}: no default value declared in variant coverage verifier.`);
        continue;
      }
      for (const value of values) {
        if (value === defaultValue) continue;
        checked += 1;
        const diffedViewports: number[] = [];
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          const base = await renderAndMeasure(page, "intro_grid", defaultOptions.intro_grid, { ...defaultComponentControls });
          const variant = await renderAndMeasure(page, "intro_grid", defaultOptions.intro_grid, { ...defaultComponentControls, [controlName]: value });
          if (base.qaIssues.length) failures.push(`componentControls.${controlName}=${defaultValue} @ ${viewport.width}: ${base.qaIssues.join("; ")}`);
          if (variant.qaIssues.length) failures.push(`componentControls.${controlName}=${value} @ ${viewport.width}: ${variant.qaIssues.join("; ")}`);
          if (metricsMateriallyDiffer(base.metrics, variant.metrics)) diffedViewports.push(viewport.width);
        }
        if (!diffedViewports.length) {
          failures.push(`componentControls.${controlName}=${value}: rendered metrics match the default at 1280, 980, 768, and 375.`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`Generated Site V3 variant coverage failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Generated Site V3 variant coverage passed (${checked} non-default template option values checked across ${viewports.length} viewports).`);
}

function validateManifestShape() {
  const missingAttrs: string[] = [];
  for (const [templateId, optionGroups] of Object.entries(templateOptionsForBlueprintV1) as Array<[TemplateId, Record<string, readonly string[]>]>) {
    if (!defaultOptions[templateId]) missingAttrs.push(`${templateId}: missing verifier defaults`);
    for (const optionName of Object.keys(optionGroups)) {
      if (!attributeNames[optionName]) missingAttrs.push(`${templateId}.${optionName}: missing renderer data attribute mapping`);
    }
  }
  for (const [controlName, values] of Object.entries(componentControlOptionsForBlueprintV1)) {
    if (!Array.isArray(values) || values.length < 1) missingAttrs.push(`componentControls.${controlName}: empty option list`);
    if (!controlAttributeNames[controlName]) missingAttrs.push(`componentControls.${controlName}: missing renderer data attribute mapping`);
  }
  if (missingAttrs.length) {
    throw new Error(`Variant coverage manifest mismatch:\n${missingAttrs.map((item) => `- ${item}`).join("\n")}`);
  }
}

function compatibleFixtureOptions(templateId: TemplateId, options: TemplateOptionMap): TemplateOptionMap {
  if (templateId === "hero_statement" && options.heroLayout === "full_bleed_masthead") {
    return { ...options, backgroundKind: "image", backgroundToken: "image" };
  }
  if (templateId === "contact_split" && options.formComplexity === "none" && options.contactLayout === "form_first") {
    return { ...options, contactLayout: "call_first" };
  }
  return options;
}

async function renderAndMeasure(page: Page, templateId: TemplateId, options: TemplateOptionMap, controls = defaultComponentControls) {
  await page.setContent(htmlForFixture(templateId, options, controls), { waitUntil: "load" });
  return page.evaluate(() => {
    const section = document.querySelector<HTMLElement>(".site-visual-section-v3");
    if (!section) return { metrics: [] as MetricNode[], qaIssues: ["section did not render"] };
    const qaIssues: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth + 2) qaIssues.push(`horizontal overflow ${root.scrollWidth}px > ${window.innerWidth}px`);
    const visibleFigures = Array.from(section.querySelectorAll<HTMLElement>("figure")).filter((figure) => getComputedStyle(figure).display !== "none");
    for (const figure of visibleFigures) {
      const rect = figure.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) qaIssues.push(`collapsed figure ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    const metricNodes = [section, ...Array.from(section.querySelectorAll<HTMLElement>(".site-visual-block-v3, .site-visual-list-v3, .site-visual-facts-v3, .site-visual-media-v3, .site-visual-action-card-v3, .site-actions-v3, .site-contact-form-v3, .site-location-showcase-v3, .site-location-showcase-hours-v3, .site-location-showcase-hours-badge-v3, .site-button-v3, article, figure, img, figcaption"))];
    const metrics = metricNodes.map((node): MetricNode => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        role: node.getAttribute("data-role") ?? node.getAttribute("data-presentation") ?? node.tagName.toLowerCase(),
        display: style.display,
        gridTemplateColumns: style.gridTemplateColumns,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderLeftWidth: style.borderLeftWidth,
        borderTopWidth: style.borderTopWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderRadius: style.borderRadius,
        color: style.color,
        textAlign: style.textAlign,
        objectPosition: style.objectPosition,
        gap: style.gap,
        paddingTop: style.paddingTop,
        paddingLeft: style.paddingLeft,
        transform: style.transform,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
    return { metrics, qaIssues };
  });
}

function metricsMateriallyDiffer(left: MetricNode[], right: MetricNode[]) {
  if (left.length !== right.length) return true;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return true;
    if (
      a.display !== b.display ||
      a.gridTemplateColumns !== b.gridTemplateColumns ||
      a.backgroundColor !== b.backgroundColor ||
      a.backgroundImage !== b.backgroundImage ||
      a.borderLeftWidth !== b.borderLeftWidth ||
      a.borderTopWidth !== b.borderTopWidth ||
      a.borderBottomWidth !== b.borderBottomWidth ||
      a.borderRadius !== b.borderRadius ||
      a.color !== b.color ||
      a.textAlign !== b.textAlign ||
      a.objectPosition !== b.objectPosition ||
      a.gap !== b.gap ||
      a.paddingTop !== b.paddingTop ||
      a.paddingLeft !== b.paddingLeft ||
      a.transform !== b.transform
    ) {
      return true;
    }
    const rectDelta =
      Math.abs(a.rect.x - b.rect.x) +
      Math.abs(a.rect.y - b.rect.y) +
      Math.abs(a.rect.width - b.rect.width) +
      Math.abs(a.rect.height - b.rect.height);
    if (rectDelta >= 16) return true;
  }
  return false;
}

function htmlForFixture(templateId: TemplateId, options: TemplateOptionMap, controls: Record<string, string>) {
  const attrs = sectionAttrs(templateId, options, controls);
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>${css}</style>
      </head>
      <body>
        <main class="public-site public-site-v3" ${rootStyle()}>
          <section id="${templateId}" class="site-section-v3 site-visual-section-v3" ${attrs}>
            ${templateMarkup(templateId, options)}
          </section>
        </main>
      </body>
    </html>`;
}

function rootStyle() {
  return `style="${[
    "--site-v3-bg:#eef2f4",
    "--site-v3-surface:#ffffff",
    "--site-v3-ink:#171512",
    "--site-v3-muted:rgba(23,21,18,.72)",
    "--site-v3-primary:#17324a",
    "--site-v3-primaryText:#ffffff",
    "--site-v3-accent:#d46b2a",
    "--site-v3-line:#d8dde2",
    "--site-v3-heading:Georgia,serif",
    "--site-v3-body:Arial,sans-serif",
    "--site-v3-page-gutter:clamp(20px,5vw,72px)",
    "--site-button-radius:6px"
  ].join(";")};"`;
}

function sectionAttrs(templateId: TemplateId, options: TemplateOptionMap, controls: Record<string, string>) {
  const backgroundKind = options.backgroundKind ?? "solid";
  const backgroundToken = options.backgroundToken ?? "page";
  const attrs = [
    ["data-section-template", templateId],
    ["data-section-anchor", templateId],
    ["data-background-kind", backgroundKind],
    ["data-background-token", backgroundKind === "image" ? "" : backgroundToken],
    ["data-rhythm-role", "standard"],
    ["data-constraint-status", "valid"],
    ["style", "--site-visual-grid-columns:12;--site-section-bg:var(--site-v3-bg);--site-section-fg:var(--site-v3-ink);--site-section-muted:var(--site-v3-muted);--site-section-label:var(--site-v3-primary);--site-section-line:var(--site-v3-line);--site-section-button-bg:var(--site-v3-primary);--site-section-button-fg:#ffffff;--site-section-button-border:var(--site-v3-primary);--site-section-button-secondary-bg:transparent;--site-section-button-secondary-fg:var(--site-v3-ink);--site-section-button-secondary-border:var(--site-v3-line);"]
  ];
  for (const [key, value] of Object.entries(options)) {
    const attr = attributeNames[key];
    if (attr) attrs.push([attr, value]);
  }
  for (const [key, value] of Object.entries(controls)) {
    const attr = controlAttributeNames[key];
    if (attr) attrs.push([attr, value]);
  }
  return attrs
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(" ");
}

function templateMarkup(templateId: TemplateId, options: TemplateOptionMap) {
  switch (templateId) {
    case "hero_split":
      return `${block("hero_copy", "text", copy("h1", true))}
        ${options.heroLayout === "text_first" ? "" : block("hero_media", "media", media(options.mediaTreatment === "collage_pair" ? "collage" : options.mediaTreatment === "bleed" || options.heroLayout === "full_bleed_masthead" ? "object_stage" : "single", "portrait", options.mediaTreatment === "flush" || options.mediaTreatment === "bleed" ? "none" : "soft", 2))}
        ${options.proofPlacement === "none" ? "" : block("hero_facts", "facts", facts(options.proofPlacement === "side_panel" ? "hero_chips" : options.proofPlacement === "bottom_strip" ? "trust_bar" : "inline_strip"))}`;
    case "hero_statement":
      return `${block("hero_copy", "text", copy("h1", true))}
        ${options.proofPlacement === "none" ? "" : block("hero_facts", "facts", facts(options.proofPlacement === "side_panel" ? "hero_chips" : options.proofPlacement === "bottom_strip" ? "trust_bar" : "inline_strip"))}
        ${block("hero_action", "action_card", actionCard())}`;
    case "intro_grid":
      return `${block("intro_grid_intro", "text", copy("h2"))}
        ${block("intro_grid_items", "list", items(introGridPresentation(options.cardTreatment), 4, true, true))}
        ${block("intro_grid_action", "action_card", actionCard())}`;
    case "numbered_steps":
      return `${block("steps_intro", "text", copy("h2"))}
        ${block("steps_items", "list", items(options.stepTreatment === "numbered_ledger" ? "numbered_ledger" : options.stepTreatment === "checklist_cards" ? "checklist_cards" : "stepper_vertical", 4, options.mediaMode !== "none", false))}`;
    case "split_media":
      return `${block("story_media", "media", media("single", "portrait", "soft", 1))}
        ${block("story_copy", "text", copy("h2"))}
        ${block("story_facts", "facts", facts("inline_strip"))}`;
    case "media_mosaic":
      return `${block("gallery_copy", "text", copy("h2"))}
        ${block("gallery_mosaic", "media", media(options.mediaPattern === "strip" || options.mediaPattern === "alternating_rows" ? "editorial_strip" : options.mediaPattern === "wall" ? "collage" : "mosaic", options.cropSet === "mixed_editorial" || options.mediaPattern === "strip" ? "wide" : "landscape", "soft", 3, options.captionMode === "none" ? "none" : options.captionMode === "below" ? "below" : "overlay"))}`;
    case "location_showcase":
      return `${block("showcase_copy", "text", copy("h2"))}${block("showcase_visit", "facts", locationShowcase())}`;
    case "contact_split":
      return `${block("contact_copy", "text", copy("h2"))}
        ${options.proofSidebar === "none" ? "" : block("contact_facts", "facts", facts(options.proofSidebar === "hours" || options.proofSidebar === "location" ? "utility_rail" : options.proofSidebar === "response_expectation" ? "inline_strip" : "stacked"))}
        ${options.formComplexity === "none" ? "" : block("contact_form", "action_card", contactForm(options.formComplexity === "detailed"))}
        ${block("contact_action", "action_card", actionCard())}`;
    case "eligibility_band":
      return `${block("eligibility_copy", "text", copy("h2"))}
        ${block("eligibility_facts", "facts", facts(options.eligibilityTreatment === "icon_cards" ? "proof_cards" : options.eligibilityTreatment === "statement_plus_list" ? "utility_rail" : "trust_bar"))}
        ${block("eligibility_action", "action_card", actionCard())}`;
    case "service_index":
      return `${block("service_index_intro", "text", copy("h2"))}
        ${block("service_index_items", "list", items(options.serviceIndexTreatment === "featured_services_plus_all" ? "feature_list" : options.serviceIndexTreatment === "dropdown_preview" ? "program_rows" : "menu_preview", 8, true, true))}
        ${block("service_index_action", "action_card", actionCard())}`;
    case "case_study_preview":
      return `${block("case_study_copy", "text", copy("h2"))}
        ${block("case_study_media", "media", media(options.caseStudyTreatment === "story_card" ? "single" : options.caseStudyTreatment === "media_plus_results" ? "object_stage" : options.caseStudyTreatment === "three_step_case" ? "collage" : "editorial_strip", options.caseStudyTreatment === "story_card" ? "portrait" : options.caseStudyTreatment === "media_plus_results" ? "wide" : "landscape", "soft", 3))}
        ${block("case_study_facts", "facts", facts("inline_strip"))}`;
    case "comparison_table":
      return `${block("comparison_intro", "text", copy("h2"))}
        ${block("comparison_items", "list", items(options.comparisonTreatment === "table_rows" ? "program_rows" : options.comparisonTreatment === "pros_cons_cards" ? "action_tiles" : "coaching_cards", 4, false, true))}
        ${block("comparison_action", "action_card", actionCard())}`;
    case "team_story":
      return `${block("team_story_copy", "text", copy("h2"))}
        ${options.teamStoryTreatment === "founder_card" ? "" : block("team_story_media", "media", media(options.teamStoryTreatment === "team_strip" ? "editorial_strip" : "single", options.teamStoryTreatment === "team_strip" ? "wide" : "portrait", "soft", 3))}
        ${block("team_story_facts", "facts", facts(options.teamStoryTreatment === "team_strip" ? "trust_bar" : "inline_strip"))}`;
    case "offer_band":
      return `${block("offer_copy", "text", copy("h2"))}
        ${block("offer_action", "action_card", actionCard())}
        ${block("offer_facts", "facts", facts("inline_strip"))}`;
  }
}

function block(role: string, kind: string, content: string) {
  return `<div class="site-visual-block-v3 site-visual-block-v3-${kind} site-visual-block-v3-${role}" data-role="${role}" data-kind="${kind}">${content}</div>`;
}

function copy(level: "h1" | "h2", withActions = false) {
  return `<p class="site-eyebrow-v3">Local service</p><${level}>Repair work with visible section variation</${level}><p>Clear body copy gives the section enough text to exercise wrapping, spacing, and alignment across viewport widths.</p>${withActions ? actions() : ""}`;
}

function actions() {
  return `<div class="site-actions-v3"><a class="site-button-v3 site-button-v3-primary" href="#contact">Call the shop</a><a class="site-button-v3 site-button-v3-secondary" href="#services">View services</a></div>`;
}

function actionCard() {
  return `<aside class="site-visual-action-card-v3"><strong>Start here</strong><p>Share the service and timing details for the next step.</p><a class="site-button-v3 site-button-v3-primary" href="#contact">Start request</a></aside>`;
}

function introGridPresentation(cardTreatment: string | undefined) {
  if (cardTreatment === "feature_cards") return "card_grid";
  if (cardTreatment === "service_cards") return "service_problem_rows";
  if (cardTreatment === "media_top_cards") return "card_grid";
  if (cardTreatment === "editorial_cards") return "card_grid";
  return "action_tiles";
}

function media(presentation: string, crop: string, radius: string, count: number, caption = "none") {
  const figures = Array.from({ length: count }, (_, index) => `<figure data-media-index="${index}" data-crop-intent="subject"><img src="${svgDataUrl(index)}" alt="" />${caption !== "none" ? `<figcaption>Shop detail ${index + 1}</figcaption>` : ""}</figure>`).join("");
  return `<div class="site-visual-media-v3" data-presentation="${presentation}" data-crop="${crop}" data-tablet-crop="wide" data-mobile-crop="wide" data-radius="${radius}" data-caption="${caption}">${figures}</div>`;
}

function items(presentation: string, count: number, withMedia: boolean, withLinks: boolean) {
  const articles = Array.from({ length: count }, (_, index) => `<article data-item-index="${index}" data-item-has-media="${withMedia ? "true" : ""}">
    ${withMedia ? `<figure data-item-index="${index}"><img src="${svgDataUrl(index)}" alt="" /></figure>` : ""}
    <span>${String(index + 1).padStart(2, "0")}</span>
    <h3>Service option ${index + 1}</h3>
    <p>Specific service copy with enough words to expose cramped cards and wrapping issues in the generated site renderer.</p>
    ${withLinks ? `<a class="site-item-link-v3" href="#contact">Request an estimate →</a>` : ""}
  </article>`).join("");
  return `<div class="site-visual-list-v3" data-presentation="${presentation}">${articles}</div>`;
}

function facts(presentation: string) {
  return `<div class="site-visual-facts-v3" data-presentation="${presentation}">
    <div><span>Phone</span><strong>(512) 555-0184</strong></div>
    <div><span>Hours</span><strong>Mon-Sat</strong></div>
    <div><span>Location</span><strong>Austin, TX</strong></div>
    <div><span>Service</span><strong>Auto body</strong></div>
  </div>`;
}

function locationShowcase() {
  return `<div class="site-location-showcase-v3" data-has-map="true">
    <div class="site-location-showcase-map-embed-v3"><span class="site-location-showcase-map-city-v3">Austin</span><span class="site-location-showcase-map-address-v3">123 Manchaca Road</span></div>
    <div class="site-location-showcase-head-v3"><span class="site-location-showcase-eyebrow-v3">Visit the shop</span><em class="site-location-showcase-hours-badge-v3">Open now</em><strong>123 Manchaca Road</strong><p>Austin, TX</p></div>
    <dl class="site-location-showcase-hours-v3">
      <div><dt>Monday</dt><dd>9:00 AM - 6:00 PM</dd></div>
      <div><dt>Tuesday</dt><dd>9:00 AM - 6:00 PM</dd></div>
      <div><dt>Wednesday</dt><dd>9:00 AM - 6:00 PM</dd></div>
      <div><dt>Thursday</dt><dd>9:00 AM - 6:00 PM</dd></div>
      <div><dt>Friday</dt><dd>9:00 AM - 6:00 PM</dd></div>
      <div><dt>Saturday</dt><dd>10:00 AM - 2:00 PM</dd></div>
    </dl>
    <div class="site-location-showcase-actions-v3"><a class="site-button-v3 site-button-v3-primary" href="#directions">Get directions</a><a class="site-button-v3 site-button-v3-secondary" href="tel:5125550184">Call</a></div>
  </div>`;
}

function contactForm(detailed: boolean) {
  return `<form class="site-contact-form-v3">
    <label>Name<input name="name" /></label>
    <label>Phone<input name="phone" /></label>
    ${detailed ? `<label>Email<input name="email" /></label><label>Damage or service<input name="vehicle_issue" /></label><label>Preferred contact<select><option>Phone</option></select></label>` : ""}
    <label>Message<textarea name="message"></textarea></label>
    <button class="site-button-v3 site-button-v3-primary" type="button">Send details</button>
  </form>`;
}

function svgDataUrl(index: number) {
  const colors = ["#17324a", "#d46b2a", "#65737e", "#334155"];
  const color = colors[index % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="${color}"/><rect x="120" y="120" width="720" height="360" rx="18" fill="rgba(255,255,255,.22)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
