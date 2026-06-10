import assert from "node:assert/strict";

import {
  compileVisualSectionV3,
  foregroundForBackgroundV3,
  repairVisualSectionV3,
  type NonImageBackgroundV3,
  type SectionBackgroundOptionV3,
  type VisualSectionV3
} from "../lib/generated-site-v3-visual-controls";
import { activeSectionTemplateOrderV3, sectionTemplateDefinitionV3, sectionTemplateForPurposeV3 } from "../lib/generated-site-v3-section-templates";

const heroCopy = {
  eyebrow: "Austin auto body",
  heading: "Body work without a confusing next step.",
  body: "Use one clear path to explain the repair and get a call back.",
  actions: [{ label: "Call now", href: "tel:15125550000", style: "primary" as const }]
};

const mediaSlot = {
  items: [{ url: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg", label: "Shop detail" }]
};

function baseHeroSplitSection(background: NonImageBackgroundV3 = { kind: "solid", token: "page" }): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "hero_split",
    options: { background },
    slots: {
      copy: heroCopy,
      media: mediaSlot,
      facts: {
        items: [
          { label: "Call", value: "(512) 555-0101" },
          { label: "Area", value: "Austin" },
          { label: "Focus", value: "Paint and panel" }
        ]
      }
    }
  };
}

const validHero = compileVisualSectionV3(baseHeroSplitSection());
assert.equal(validHero.violations.length, 0, "Valid hero split should compile without constraint violations.");
const activeTemplateIds = new Set<string>(activeSectionTemplateOrderV3);
assert.equal(activeTemplateIds.has("top_intro_grid"), false, "top_intro_grid should not exist as an active V3 template.");
assert.equal(activeTemplateIds.has("pricing_grid"), false, "pricing_grid should not exist as an active V3 template.");
assert.equal(sectionTemplateForPurposeV3("highlights.grid"), "intro_grid", "highlights.grid should map to intro_grid.");
assert.equal(sectionTemplateForPurposeV3("pricing.packages"), "intro_grid", "pricing.packages should map to intro_grid with comparison treatment at compile time.");
assert.equal("blocks" in validHero.section, false, "Compiled sections must not expose authored block arrays.");
assert.equal("responsive" in validHero.section, false, "Compiled sections must not expose authored responsive overrides.");
assert.equal("densityId" in validHero.section, false, "Compiled sections must not expose densityId.");
assert.equal("emphasisId" in validHero.section, false, "Compiled sections must not expose emphasisId.");
assert.equal("layoutBalanceId" in validHero.section, false, "Compiled sections must not expose layoutBalanceId.");

const legacyPayload = {
  ...baseHeroSplitSection(),
  sectionPurposeId: "hero.split",
  sectionVariantId: "hero_split.copy_left_media_right",
  densityId: "expansive",
  blocks: []
} as unknown as VisualSectionV3;
const legacyResult = compileVisualSectionV3(legacyPayload);
assert.ok(legacyResult.violations.some((violation) => violation.id === "visual.legacy_authored_field"), "Legacy authored V3 fields should be rejected.");

const splitWithImage = {
  ...baseHeroSplitSection({ kind: "solid", token: "page" }),
  options: { background: { kind: "image", url: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg" } }
} as unknown as VisualSectionV3;
const splitWithImageResult = compileVisualSectionV3(splitWithImage);
assert.ok(splitWithImageResult.violations.some((violation) => violation.id === "visual.background_kind_disallowed" || violation.id === "visual.hero_split_image_background_disallowed"), "Split hero should reject image backgrounds.");

const invalidImageStatement = {
  version: "visual-section-v3",
  templateId: "hero_statement",
  options: { align: "center", background: { kind: "image", url: "" } },
  slots: { copy: heroCopy }
} as unknown as VisualSectionV3;
const invalidImageStatementResult = compileVisualSectionV3(invalidImageStatement);
assert.ok(
  invalidImageStatementResult.violations.some((violation) => violation.id === "visual.hero_statement_image_background_missing_eligible_media"),
  "Image-backed statement hero should require an eligible image URL."
);
const repairedImageStatement = repairVisualSectionV3(invalidImageStatement);
assert.equal(repairedImageStatement.templateId, "hero_statement", "No-media image statement repair should remain a hero statement template.");
assert.equal(repairedImageStatement.options.align, "center", "No-media image statement repair should center the hero statement.");
assert.deepEqual(repairedImageStatement.options.background, { kind: "gradient", token: "subtle" }, "No-media image statement repair should use subtle gradient background.");

const invalidSplitMediaSide = {
  version: "visual-section-v3",
  templateId: "split_media",
  options: { background: { kind: "solid", token: "surface" }, mediaSide: "center" },
  slots: {
    copy: heroCopy,
    media: mediaSlot
  }
} as unknown as VisualSectionV3;
const invalidSplitMediaSideResult = compileVisualSectionV3(invalidSplitMediaSide);
assert.ok(invalidSplitMediaSideResult.violations.some((violation) => violation.id === "visual.split_media_side_invalid"), "SplitMedia should reject invalid mediaSide options.");
assert.equal(
  invalidSplitMediaSideResult.section.templateId === "split_media" ? invalidSplitMediaSideResult.section.options.mediaSide : undefined,
  "left",
  "Invalid SplitMedia mediaSide should normalize to left."
);

const invalidIntroGridTreatment = {
  version: "visual-section-v3",
  templateId: "intro_grid",
  options: { background: { kind: "solid", token: "surface" }, cardTreatment: "pricing" },
  slots: {
    intro: heroCopy,
    items: {
      items: [
        { title: "Collision", body: "Body damage review." },
        { title: "Paint", body: "Paint damage review." },
        { title: "Dent", body: "Dent damage review." }
      ]
    }
  }
} as unknown as VisualSectionV3;
const invalidIntroGridTreatmentResult = compileVisualSectionV3(invalidIntroGridTreatment);
assert.ok(invalidIntroGridTreatmentResult.violations.some((violation) => violation.id === "visual.intro_grid_card_treatment_invalid"), "IntroGrid should reject invalid cardTreatment options.");
assert.equal(
  invalidIntroGridTreatmentResult.section.templateId === "intro_grid" ? invalidIntroGridTreatmentResult.section.options.cardTreatment : undefined,
  "standard",
  "Invalid IntroGrid cardTreatment should normalize to standard."
);

for (const templateId of activeSectionTemplateOrderV3) {
  const definition = sectionTemplateDefinitionV3(templateId);
  for (const background of definition.allowedBackgrounds) {
    assert.ok(foregroundForBackgroundV3(background), `${templateId} ${background.kind} background should have a contrast-safe foreground.`);
  }
}

console.log(JSON.stringify({ ok: true, templates: activeSectionTemplateOrderV3.length }, null, 2));
