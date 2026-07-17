import type {
  SectionBackgroundKindV3,
  SectionBackgroundOptionV3,
  SectionTemplateIdV3
} from "./generated-site-v3-visual-controls";

type SectionTemplateSlotIdV3 = "intro" | "copy" | "media" | "items" | "facts" | "action" | "contact" | "locations";
type SectionTemplateRhythmRoleV3 = "hero" | "rows" | "grid" | "quotes" | "faq" | "location" | "contact";
type CountRangeV3 = { min: number; max: number };

type SectionTemplateDefinitionV3 = {
  id: SectionTemplateIdV3;
  requiredSlots: readonly SectionTemplateSlotIdV3[];
  optionalSlots: readonly SectionTemplateSlotIdV3[];
  allowedBackgrounds: readonly SectionBackgroundOptionV3[];
  defaultBackground: SectionBackgroundOptionV3;
  rhythmRole: SectionTemplateRhythmRoleV3;
  visualWeight: "quiet" | "standard" | "feature" | "hero";
  mediaCount?: CountRangeV3;
  itemCount?: CountRangeV3;
  factCount?: CountRangeV3;
};

const pageBackground: SectionBackgroundOptionV3 = { kind: "solid", token: "page" };
const surfaceBackground: SectionBackgroundOptionV3 = { kind: "solid", token: "surface" };
const darkBackground: SectionBackgroundOptionV3 = { kind: "solid", token: "dark" };
const brandBackground: SectionBackgroundOptionV3 = { kind: "solid", token: "brand" };
const allowedBackgrounds = [pageBackground, surfaceBackground, darkBackground, brandBackground] as const;

export const activeSectionTemplateOrderV3 = [
  "hero_split",
  "hero_statement",
  "side_intro_rows",
  "auto_body_service_index",
  "numbered_steps",
  "quote_wall",
  "faq_list",
  "location_showcase",
  "service_area_showcase",
  "contact_split"
] as const satisfies readonly SectionTemplateIdV3[];

export const sectionTemplateCatalogV3: readonly SectionTemplateDefinitionV3[] = [
  template("hero_split", "hero", ["copy", "media"], ["facts"], pageBackground, "hero", {
    mediaCount: { min: 1, max: 1 },
    factCount: { min: 0, max: 4 }
  }),
  template("hero_statement", "hero", ["copy"], ["facts", "action"], pageBackground, "hero", {
    factCount: { min: 0, max: 4 }
  }),
  template("side_intro_rows", "rows", ["intro", "items"], [], surfaceBackground, "standard", {
    itemCount: { min: 3, max: 8 }
  }),
  template("auto_body_service_index", "grid", ["intro", "items"], ["action"], surfaceBackground, "standard", {
    itemCount: { min: 3, max: 8 }
  }),
  template("numbered_steps", "rows", ["intro", "items"], [], surfaceBackground, "standard", {
    itemCount: { min: 3, max: 4 }
  }),
  template("quote_wall", "quotes", ["intro", "items"], [], pageBackground, "standard", {
    itemCount: { min: 2, max: 3 }
  }),
  template("faq_list", "faq", ["intro", "items"], [], pageBackground, "standard", {
    itemCount: { min: 4, max: 4 }
  }),
  template("location_showcase", "location", ["copy", "locations"], ["action"], pageBackground, "feature"),
  template("service_area_showcase", "location", ["copy", "facts"], ["action"], pageBackground, "standard", {
    factCount: { min: 1, max: 12 }
  }),
  template("contact_split", "contact", ["copy", "contact"], ["action"], darkBackground, "feature", {
    factCount: { min: 1, max: 4 }
  })
];

export function sectionTemplateDefinitionV3(templateId: SectionTemplateIdV3): SectionTemplateDefinitionV3 {
  const definition = sectionTemplateCatalogV3.find((candidate) => candidate.id === templateId);
  if (!definition) throw new Error(`Section template ${templateId} is outside the two-system canonical catalog.`);
  return definition;
}

export function sectionTemplateAllowsBackgroundV3(templateId: SectionTemplateIdV3, background: SectionBackgroundOptionV3) {
  return sectionTemplateDefinitionV3(templateId).allowedBackgrounds.some(
    (allowed) => backgroundIdentity(allowed) === backgroundIdentity(background)
  );
}

export function defaultBackgroundForTemplateV3(templateId: SectionTemplateIdV3): SectionBackgroundOptionV3 {
  return sectionTemplateDefinitionV3(templateId).defaultBackground;
}

function template(
  id: SectionTemplateIdV3,
  rhythmRole: SectionTemplateRhythmRoleV3,
  requiredSlots: readonly SectionTemplateSlotIdV3[],
  optionalSlots: readonly SectionTemplateSlotIdV3[],
  defaultBackground: SectionBackgroundOptionV3,
  visualWeight: SectionTemplateDefinitionV3["visualWeight"],
  counts: Pick<SectionTemplateDefinitionV3, "mediaCount" | "itemCount" | "factCount"> = {}
): SectionTemplateDefinitionV3 {
  return { id, rhythmRole, requiredSlots, optionalSlots, defaultBackground, allowedBackgrounds, visualWeight, ...counts };
}

function backgroundIdentity(background: SectionBackgroundOptionV3) {
  if (background.kind === "image") return "image";
  return `${background.kind}:${background.token}` satisfies `${SectionBackgroundKindV3}:${string}`;
}
