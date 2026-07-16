import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createGeneratedSiteV3CanonicalVisualGrammarSites,
  type GeneratedSiteV3CanonicalVisualGrammarSite
} from "../lib/generated-site-v3-canonical-visual-grammar";
import { inspectGeneratedSiteBundleRender, renderGeneratedSiteHtml } from "../lib/generated-site-render-inspection";
import type { ListPresentationIdV3 } from "../lib/generated-site-v3-art-direction-catalog";
import {
  getVisualSectionV3,
  type IntroGridCardActionV3,
  type IntroGridCardTreatmentV3,
  type IntroGridCardToneV3,
  type IntroGridMediaAspectV3,
  type IntroGridMediaCropV3,
  type IntroGridPatternV3,
  type NumberedStepsTreatmentV3,
  type StandardItemV3
} from "../lib/generated-site-v3-visual-controls";
import { sectionTemplateDefinitionV3, type SectionTemplateIdV3 } from "../lib/generated-site-v3-section-templates";
import type { RenderInspectionFinding, SectionInstanceV3, SiteVersionV3 } from "../lib/models";

type Args = {
  template?: SectionTemplateIdV3;
  site?: string;
  index?: number;
  cardTreatment?: IntroGridCardTreatmentV3;
  cardAction?: IntroGridCardActionV3;
  cardTone?: IntroGridCardToneV3;
  gridPattern?: IntroGridPatternV3;
  mediaAspect?: IntroGridMediaAspectV3;
  mediaCrop?: IntroGridMediaCropV3;
  stepTreatment?: NumberedStepsTreatmentV3;
  listPresentation?: WorkbenchListPresentationId;
  fixtureCount?: number;
  fixtureMedia: boolean;
  artifactRoot: string;
  list: boolean;
  allowFailures: boolean;
};

type WorkbenchSelection = {
  site: GeneratedSiteV3CanonicalVisualGrammarSite;
  section: SectionInstanceV3;
  sectionIndex: number;
  templateId: string;
};

type WorkbenchListPresentationId = Extract<
  ListPresentationIdV3,
  "card_grid" | "action_tiles" | "coaching_cards" | "service_problem_rows" | "menu_preview" | "premium_showcase" | "feature_list" | "showcase_grid" | "image_tiles" | "media_grid"
>;

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  listSections();
  process.exit(0);
}

if (args.template) sectionTemplateDefinitionV3(args.template);

const selection = selectSection(args);
const bundle = cloneJson(selection.site.bundle);
const version = cloneJson(selection.site.version);
const homepage = version.pageComposition.pages[0];
if (!homepage) throw new Error(`${selection.site.id} is missing a homepage.`);
const workbenchSection = cloneJson(selection.section);
applyIntroGridOptionOverrides(workbenchSection, {
  cardTreatment: args.cardTreatment,
  cardAction: args.cardAction,
  cardTone: args.cardTone,
  gridPattern: args.gridPattern,
  mediaAspect: args.mediaAspect,
  mediaCrop: args.mediaCrop
});
applyStepTreatmentOverride(workbenchSection, args.stepTreatment);
applyFixtureItemCount(workbenchSection, args.fixtureCount);
applyFixtureMedia(workbenchSection, args.fixtureMedia);
applyListPresentationOverride(version, args.listPresentation);

bundle.businessProfile.siteId = `section_workbench_${selection.site.shellId}_${selection.templateId}`;
version.id = `version_${bundle.businessProfile.siteId}`;
homepage.id = "home";
homepage.slug = "";
homepage.title = `Workbench ${selection.templateId}`;
homepage.sections = [workbenchSection];
bundle.siteModel.versions = [version];

await mkdir(args.artifactRoot, { recursive: true });
const renderedHtml = await renderGeneratedSiteHtml(bundle, version);
const renderedAttributes = renderedSectionAttributes(renderedHtml, workbenchSection.id);
const inspection = await inspectGeneratedSiteBundleRender({
  bundle,
  version,
  qaRunId: `section_workbench_${selection.site.shellId}_${selection.templateId}`,
  artifactRoot: args.artifactRoot
});

const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");
const blockingFindings = failingFindings.filter(isWorkbenchBlockingFinding);
const report = {
  ok: blockingFindings.length === 0 && !inspection.unavailableReason,
  unavailableReason: inspection.unavailableReason,
  artifactRoot: args.artifactRoot,
  siteId: selection.site.id,
  shellId: selection.site.shellId,
  sourceSectionIndex: selection.sectionIndex,
  sectionId: selection.section.id,
  templateId: selection.templateId,
  cardTreatment: args.cardTreatment,
  cardAction: args.cardAction,
  cardTone: args.cardTone,
  gridPattern: args.gridPattern,
  mediaAspect: args.mediaAspect,
  mediaCrop: args.mediaCrop,
  stepTreatment: args.stepTreatment,
  listPresentation: args.listPresentation,
  fixtureCount: args.fixtureCount,
  fixtureMedia: args.fixtureMedia,
  renderedAttributes,
  screenshots: inspection.screenshots.map((screenshot) => ({
    viewport: screenshot.viewport,
    path: screenshot.path,
    bytes: screenshot.bytes
  })),
  sectionScreenshots: (inspection.sectionScreenshots ?? []).map((screenshot) => ({
    viewport: screenshot.viewport,
    sectionIndex: screenshot.sectionIndex,
    sectionId: screenshot.sectionId,
    templateId: screenshot.templateId,
    path: screenshot.path,
    bytes: screenshot.bytes,
    clipped: screenshot.clipped
  })),
  findings: inspection.findings.map(compactFinding),
  nonBlockingFailingFindings: failingFindings.filter((finding) => !isWorkbenchBlockingFinding(finding)).map(compactFinding),
  blockingFindings: blockingFindings.map(compactFinding)
};
const reportPath = join(args.artifactRoot, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (inspection.unavailableReason) {
  process.stdout.write(`${JSON.stringify({ ok: false, skipped: true, reportPath, unavailableReason: inspection.unavailableReason }, null, 2)}\n`);
  process.exit(0);
}

if (!args.allowFailures) {
  assert.equal(blockingFindings.length, 0, `section workbench failures:\n${blockingFindings.map((finding) => `${finding.id}: ${finding.evidence}`).join("\n")}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: blockingFindings.length === 0,
      reportPath,
      templateId: selection.templateId,
      sectionScreenshots: report.sectionScreenshots.length,
      failingFindings: failingFindings.length,
      blockingFindings: blockingFindings.length
    },
    null,
    2
  )}\n`
);

function parseArgs(raw: string[]): Args {
  const parsed: Args = {
    artifactRoot: join(process.cwd(), ".data", "section-workbench", new Date().toISOString().replace(/[:.]/g, "-")),
    fixtureMedia: false,
    list: false,
    allowFailures: false
  };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--list") parsed.list = true;
    else if (arg === "--allow-failures") parsed.allowFailures = true;
    else if (arg === "--fixture-media") parsed.fixtureMedia = true;
    else if (arg === "--template") parsed.template = valueAfter(raw, index, arg) as SectionTemplateIdV3;
    else if (arg === "--site") parsed.site = valueAfter(raw, index, arg);
    else if (arg === "--index") parsed.index = Number(valueAfter(raw, index, arg));
    else if (arg === "--card-treatment") parsed.cardTreatment = parseCardTreatment(valueAfter(raw, index, arg));
    else if (arg === "--card-action") parsed.cardAction = parseCardAction(valueAfter(raw, index, arg));
    else if (arg === "--card-tone") parsed.cardTone = parseCardTone(valueAfter(raw, index, arg));
    else if (arg === "--grid-pattern") parsed.gridPattern = parseGridPattern(valueAfter(raw, index, arg));
    else if (arg === "--media-aspect") parsed.mediaAspect = parseMediaAspect(valueAfter(raw, index, arg));
    else if (arg === "--media-crop") parsed.mediaCrop = parseMediaCrop(valueAfter(raw, index, arg));
    else if (arg === "--step-treatment") parsed.stepTreatment = parseStepTreatment(valueAfter(raw, index, arg));
    else if (arg === "--list-presentation") parsed.listPresentation = parseListPresentation(valueAfter(raw, index, arg));
    else if (arg === "--fixture-count") parsed.fixtureCount = Number(valueAfter(raw, index, arg));
    else if (arg === "--artifact-root") parsed.artifactRoot = valueAfter(raw, index, arg);
    if (
      arg === "--template" ||
      arg === "--site" ||
      arg === "--index" ||
      arg === "--card-treatment" ||
      arg === "--card-action" ||
      arg === "--card-tone" ||
      arg === "--grid-pattern" ||
      arg === "--media-aspect" ||
      arg === "--media-crop" ||
      arg === "--step-treatment" ||
      arg === "--list-presentation" ||
      arg === "--fixture-count" ||
      arg === "--artifact-root"
    ) {
      index += 1;
    }
  }
  if (parsed.index !== undefined && (!Number.isInteger(parsed.index) || parsed.index < 0)) {
    throw new Error("--index must be a non-negative integer.");
  }
  if (parsed.fixtureCount !== undefined && (!Number.isInteger(parsed.fixtureCount) || parsed.fixtureCount < 1 || parsed.fixtureCount > 12)) {
    throw new Error("--fixture-count must be an integer from 1 to 12.");
  }
  return parsed;
}

function valueAfter(raw: string[], index: number, flag: string) {
  const value = raw[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function selectSection(parsed: Args): WorkbenchSelection {
  const sites = createGeneratedSiteV3CanonicalVisualGrammarSites();
  const scopedSites = parsed.site ? sites.filter((site) => site.shellId === parsed.site || site.id === parsed.site) : sites;
  if (!scopedSites.length) throw new Error(`No canonical site matched --site ${parsed.site}. Run with --list to inspect available sites.`);

  for (const site of scopedSites) {
    const sections = site.version.pageComposition.pages[0]?.sections ?? [];
    for (const [sectionIndex, section] of sections.entries()) {
      const visualSection = getVisualSectionV3(section.props);
      if (!visualSection) continue;
      if (parsed.index !== undefined && sectionIndex !== parsed.index) continue;
      if (parsed.template && visualSection.templateId !== parsed.template) continue;
      return { site, section, sectionIndex, templateId: visualSection.templateId };
    }
  }

  if (parsed.template === "proof_pair") {
    const site = scopedSites[0];
    if (site) return { site, section: proofPairFixtureSection(), sectionIndex: 0, templateId: "proof_pair" };
  }

  if (parsed.template === "numbered_steps") {
    const site = scopedSites[0];
    if (site) return { site, section: numberedStepsFixtureSection(), sectionIndex: 0, templateId: "numbered_steps" };
  }

  const scope = parsed.site ? ` in ${parsed.site}` : "";
  const target = parsed.template ? `template ${parsed.template}` : `section index ${parsed.index ?? 0}`;
  throw new Error(`No canonical section matched ${target}${scope}. Run with --list to inspect available sections.`);
}

function proofPairFixtureSection(): SectionInstanceV3 {
  return {
    id: "proof-pair-workbench",
    family: "proof.section_template",
    variant: "proof_pair",
    controls: {
      layout: "two_column",
      density: "balanced",
      width: "wide",
      padding: "spacious",
      alignment: "start",
      mediaCrop: "subject",
      background: "surface"
    },
    slots: [],
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: {
      minimumValidSlots: ["copy", "media"],
      gracefulDegradation: "Render the generated proof-pair section with honest media and copy.",
      omitWhenMissingFactKinds: [],
      blockWhenMissingFactKinds: []
    },
    responsiveRules: [
      { breakpoint: "mobile", behavior: "stack", notes: ["Proof media stacks to one column."] },
      { breakpoint: "tablet", behavior: "stack", notes: ["Proof copy and media stack with paired frames preserved."] },
      { breakpoint: "desktop", behavior: "preserve_crop", notes: ["Proof media renders as paired frames."] }
    ],
    props: {
      renderPath: "generated_site_v3",
      visualSectionV3: {
        version: "visual-section-v3",
        templateId: "proof_pair",
        anchorId: "proof",
        options: { background: { kind: "solid", token: "surface" } },
        slots: {
          copy: {
            eyebrow: "Repair proof",
            heading: "Repair proof, before and after.",
            body: "These repair photos show the damaged panel before and after the work, with body fit and finish visible at a glance."
          },
          media: {
            items: [
              { url: "/generated-site-assets/auto-body/before-after-body-panel-v2.png", label: "Before", publicCaption: "Before" },
              { url: "/generated-site-assets/auto-body/panel-gap-inspection-v1.png", label: "After", publicCaption: "After" }
            ],
            focalPoint: "center",
            caption: "below"
          },
          facts: {
            items: [
              { label: "Impact area", value: "Wide and close views" },
              { label: "Body fit", value: "Panel gaps and trim" },
              { label: "Finish", value: "Paint edges" }
            ]
          }
        }
      }
    }
  };
}

function numberedStepsFixtureSection(): SectionInstanceV3 {
  return {
    id: "numbered-steps-workbench",
    family: "process.section_template",
    variant: "numbered_steps",
    controls: {
      layout: "single_column",
      density: "balanced",
      width: "wide",
      padding: "spacious",
      alignment: "start",
      mediaCrop: "none",
      background: "site_bg"
    },
    slots: [],
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: {
      minimumValidSlots: ["intro", "items"],
      gracefulDegradation: "Render the generated process section with clear steps.",
      omitWhenMissingFactKinds: [],
      blockWhenMissingFactKinds: []
    },
    responsiveRules: [
      { breakpoint: "mobile", behavior: "stack", notes: ["Process steps stack as readable cards."] },
      { breakpoint: "tablet", behavior: "stack", notes: ["Process steps keep a full-width reading flow."] },
      { breakpoint: "desktop", behavior: "preserve_crop", notes: ["Process intro leads the numbered step layout."] }
    ],
    props: {
      renderPath: "generated_site_v3",
      visualSectionV3: {
        version: "visual-section-v3",
        templateId: "numbered_steps",
        anchorId: "process",
        options: { background: { kind: "solid", token: "page" }, stepTreatment: "numbered_ledger" },
        slots: {
          intro: {
            eyebrow: "Process",
            heading: "From first look to finished pickup.",
            body: "The shop keeps the estimate, repair scope, and pickup review connected so the handoff feels clear."
          },
          items: {
            items: [
              {
                meta: "01",
                title: "Start with the whole hit area",
                body: "The estimate looks past the obvious mark to nearby trim, lights, panel gaps, and paint edges."
              },
              {
                meta: "02",
                title: "Review insurance and payment details",
                body: "Insurance details and self-pay questions stay connected to the same visible repair scope before work begins."
              },
              {
                meta: "03",
                title: "Finish with fit and paint",
                body: "Before pickup, the repaired area is checked for alignment, color blend, and the edges around the original impact."
              }
            ]
          }
        }
      }
    }
  };
}

function listSections() {
  const rows = createGeneratedSiteV3CanonicalVisualGrammarSites().flatMap((site) => {
    const sections = site.version.pageComposition.pages[0]?.sections ?? [];
    return sections.map((section, index) => {
      const visualSection = getVisualSectionV3(section.props);
      return {
        site: site.shellId,
        index,
        sectionId: section.id,
        templateId: visualSection?.templateId ?? "unknown"
      };
    });
  });
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}

function compactFinding(finding: RenderInspectionFinding) {
  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    viewport: finding.viewport,
    evidence: finding.evidence
  };
}

function parseCardTreatment(value: string): IntroGridCardTreatmentV3 {
  const allowed = ["standard", "comparison", "feature_cards", "service_cards", "media_top_cards", "editorial_cards"] as const;
  if (!allowed.includes(value as IntroGridCardTreatmentV3)) {
    throw new Error(`Unknown --card-treatment ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as IntroGridCardTreatmentV3;
}

function parseCardAction(value: string): IntroGridCardActionV3 {
  const allowed = ["none", "text_link", "bottom_aligned_button", "full_width_button"] as const;
  if (!allowed.includes(value as IntroGridCardActionV3)) {
    throw new Error(`Unknown --card-action ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as IntroGridCardActionV3;
}

function parseCardTone(value: string): IntroGridCardToneV3 {
  const allowed = ["uniform", "alternating_surface", "featured_first", "dark_feature"] as const;
  if (!allowed.includes(value as IntroGridCardToneV3)) {
    throw new Error(`Unknown --card-tone ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as IntroGridCardToneV3;
}

function parseGridPattern(value: string): IntroGridPatternV3 {
  const allowed = ["equal_grid", "lead_card", "mixed_masonry", "two_by_two", "compact_rows"] as const;
  if (!allowed.includes(value as IntroGridPatternV3)) {
    throw new Error(`Unknown --grid-pattern ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as IntroGridPatternV3;
}

function parseMediaAspect(value: string): IntroGridMediaAspectV3 {
  const allowed = ["none", "square", "4x3", "16x10", "portrait"] as const;
  if (!allowed.includes(value as IntroGridMediaAspectV3)) {
    throw new Error(`Unknown --media-aspect ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as IntroGridMediaAspectV3;
}

function parseMediaCrop(value: string): IntroGridMediaCropV3 {
  const allowed = ["center", "subject", "wide", "detail_zoom"] as const;
  if (!allowed.includes(value as IntroGridMediaCropV3)) {
    throw new Error(`Unknown --media-crop ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as IntroGridMediaCropV3;
}

function parseListPresentation(value: string): WorkbenchListPresentationId {
  const allowed = ["card_grid", "action_tiles", "coaching_cards", "service_problem_rows", "menu_preview", "premium_showcase", "feature_list", "showcase_grid", "image_tiles", "media_grid"] as const;
  if (!allowed.includes(value as WorkbenchListPresentationId)) {
    throw new Error(`Unknown --list-presentation ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as WorkbenchListPresentationId;
}

function parseStepTreatment(value: string): NumberedStepsTreatmentV3 {
  const allowed = ["stepper_vertical", "checklist_cards", "numbered_ledger"] as const;
  if (!allowed.includes(value as NumberedStepsTreatmentV3)) {
    throw new Error(`Unknown --step-treatment ${value}. Allowed: ${allowed.join(", ")}.`);
  }
  return value as NumberedStepsTreatmentV3;
}

function applyListPresentationOverride(version: SiteVersionV3, listPresentation: WorkbenchListPresentationId | undefined) {
  if (!listPresentation) return;
  version.artDirection = {
    ...version.artDirection,
    sectionPresentation: {
      ...(version.artDirection.sectionPresentation ?? {}),
      services: listPresentation
    }
  };
}

function applyIntroGridOptionOverrides(
  section: SectionInstanceV3,
  overrides: {
    cardTreatment?: IntroGridCardTreatmentV3;
    cardAction?: IntroGridCardActionV3;
    cardTone?: IntroGridCardToneV3;
    gridPattern?: IntroGridPatternV3;
    mediaAspect?: IntroGridMediaAspectV3;
    mediaCrop?: IntroGridMediaCropV3;
  }
) {
  const definedOverrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  if (!Object.keys(definedOverrides).length) return;
  const visualSection = getVisualSectionV3(section.props);
  if (!visualSection) throw new Error("IntroGrid option overrides require a visual-section-v3 section.");
  if (visualSection.templateId !== "intro_grid") throw new Error(`IntroGrid option overrides only apply to intro_grid, got ${visualSection.templateId}.`);
  section.props = {
    ...section.props,
    visualSectionV3: {
      ...visualSection,
      options: {
        ...visualSection.options,
        ...definedOverrides
      }
    }
  };
}

function applyStepTreatmentOverride(section: SectionInstanceV3, stepTreatment: NumberedStepsTreatmentV3 | undefined) {
  if (!stepTreatment) return;
  const visualSection = getVisualSectionV3(section.props);
  if (!visualSection) throw new Error("--step-treatment requires a visual-section-v3 section.");
  if (visualSection.templateId !== "numbered_steps") throw new Error(`--step-treatment only applies to numbered_steps, got ${visualSection.templateId}.`);
  section.props = {
    ...section.props,
    visualSectionV3: {
      ...visualSection,
      options: {
        ...visualSection.options,
        stepTreatment
      }
    }
  };
}

function applyFixtureItemCount(section: SectionInstanceV3, fixtureCount: number | undefined) {
  if (!fixtureCount) return;
  const visualSection = getVisualSectionV3(section.props);
  const itemSlot = (visualSection?.slots as { items?: { items?: StandardItemV3[] } } | undefined)?.items;
  if (!visualSection || !itemSlot?.items) throw new Error("--fixture-count requires a visual-section-v3 section with an items slot.");
  const items = itemSlot.items;
  if (!items.length) throw new Error("--fixture-count requires at least one source item.");
  const nextItems = Array.from({ length: fixtureCount }, (_, index) => {
    const item = cloneJson(items[index % items.length]);
    return {
      ...item,
      title: item.title ?? `Item ${index + 1}`
    };
  });
  section.props = {
    ...section.props,
    visualSectionV3: {
      ...visualSection,
      slots: {
        ...visualSection.slots,
        items: {
          ...itemSlot,
          items: nextItems
        }
      }
    }
  };
}

function applyFixtureMedia(section: SectionInstanceV3, enabled: boolean) {
  if (!enabled) return;
  const visualSection = getVisualSectionV3(section.props);
  if (!visualSection || visualSection.templateId !== "intro_grid") throw new Error("--fixture-media currently targets intro_grid standard item slots.");
  const items = visualSection.slots.items.items as StandardItemV3[];
  const media = [
    "/generated-site-assets/auto-body/paint-prep-sanding-block-v1.png",
    "/generated-site-assets/auto-body/panel-gap-inspection-v1.png",
    "/generated-site-assets/auto-body/windshield-replacement-v1.png",
    "/generated-site-assets/auto-body/lift-bay-overview-v1.png"
  ];
  section.props = {
    ...section.props,
    visualSectionV3: {
      ...visualSection,
      slots: {
        ...visualSection.slots,
        items: {
          ...visualSection.slots.items,
          items: items.map((item, index) => ({
            ...item,
            mediaUrl: item.mediaUrl ?? media[index % media.length]
          }))
        }
      }
    }
  };
}

function isWorkbenchBlockingFinding(finding: RenderInspectionFinding) {
  const sectionIrrelevantSiteFindings = ["render.above_fold_cta", "render.a11y_structure", "render.primary_hero_cta"];
  return !sectionIrrelevantSiteFindings.some((id) => finding.id.startsWith(id));
}

function renderedSectionAttributes(html: string, sectionId: string) {
  const sectionTag =
    findOpeningTag(html, "section", (tag) => tag.includes(`data-section-id="${sectionId}"`)) ??
    findOpeningTag(html, "section", (tag) => tag.includes('data-section-template="intro_grid"'));
  const listTag = findOpeningTag(html, "div", (tag) => tag.includes("site-visual-list-v3"));
  return {
    dataSectionTemplate: dataAttribute(sectionTag, "data-section-template"),
    dataCardTreatment: dataAttribute(sectionTag, "data-card-treatment"),
    dataCardAction: dataAttribute(sectionTag, "data-card-action"),
    dataCardTone: dataAttribute(sectionTag, "data-card-tone"),
    dataGridPattern: dataAttribute(sectionTag, "data-grid-pattern"),
    dataMediaAspect: dataAttribute(sectionTag, "data-media-aspect"),
    dataMediaCrop: dataAttribute(sectionTag, "data-media-crop"),
    dataPresentation: dataAttribute(listTag, "data-presentation")
  };
}

function findOpeningTag(html: string, tagName: string, predicate: (tag: string) => boolean) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "g");
  for (const match of html.matchAll(pattern)) {
    const tag = match[0];
    if (predicate(tag)) return tag;
  }
  return undefined;
}

function dataAttribute(tag: string | undefined, name: string) {
  if (!tag) return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`${escaped}="([^"]*)"`));
  return match?.[1];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
