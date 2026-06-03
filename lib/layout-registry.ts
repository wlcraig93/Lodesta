import type {
  ButtonStyle,
  DesignPlan,
  FieldPolicy,
  ImageTreatment,
  LayoutComponentInstance,
  LayoutComponentType,
  LayoutSection,
  LayoutSectionKind,
  LayoutSectionPreset,
  PageModel,
  MotionPolicy,
  RadiusStyle,
  SectionModel,
  SectionType,
  SiteVersion,
  SiteStylePack,
  Theme,
  TypographyPack,
  Vertical
} from "./models";

export const rendererVersion = "layout-v1" as const;
export const designSchemaVersion = "design-v1" as const;

export type PresetDefinition = {
  id: LayoutSectionPreset;
  kind: LayoutSectionKind;
  requiredSlots: string[];
  optionalSlots: string[];
  allowedComponentsBySlot: Record<string, LayoutComponentType[]>;
  requiredBindings: string[];
  mediaRequirements: "none" | "image_optional" | "image_required";
  mobileBehavior: Array<LayoutSection["mobileBehavior"]>;
  allowedDesignOverrides: Array<keyof NonNullable<LayoutSection["designOverrides"]>>;
  repairCapabilities: Array<"inject_cta" | "replace_media" | "reduce_type_scale" | "force_mobile_stack" | "switch_preset">;
};

export type LayoutValidationRepairMode = "deterministic_repair" | "ai_repair" | "operator_blocked" | "fatal_schema";

export type LayoutValidationIssue = {
  id: string;
  repairMode: LayoutValidationRepairMode;
  message: string;
  pageId?: string;
  sectionId?: string;
  slot?: string;
};

export const typographyPacks: Record<TypographyPack, { heading: string; body: string; button: string; headingWeight: number; bodyWeight: number; buttonWeight: number }> = {
  clean_sans: {
    heading: 'Aptos, "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif',
    body: 'Aptos, "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif',
    button: 'Aptos, "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif',
    headingWeight: 760,
    bodyWeight: 430,
    buttonWeight: 820
  },
  editorial_serif: {
    heading: 'Georgia, "Times New Roman", ui-serif, serif',
    body: 'Aptos, "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif',
    button: 'Aptos, "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif',
    headingWeight: 650,
    bodyWeight: 430,
    buttonWeight: 800
  },
  rounded_friendly: {
    heading: '"Arial Rounded MT Bold", Avenir, "Avenir Next", ui-sans-serif, system-ui, sans-serif',
    body: 'Aptos, "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif',
    button: '"Arial Rounded MT Bold", Avenir, "Avenir Next", ui-sans-serif, system-ui, sans-serif',
    headingWeight: 760,
    bodyWeight: 430,
    buttonWeight: 760
  },
  utility_sans: {
    heading: '"Segoe UI", Roboto, Arial, ui-sans-serif, system-ui, -apple-system, sans-serif',
    body: '"Segoe UI", Roboto, Arial, ui-sans-serif, system-ui, -apple-system, sans-serif',
    button: '"Segoe UI", Roboto, Arial, ui-sans-serif, system-ui, -apple-system, sans-serif',
    headingWeight: 780,
    bodyWeight: 440,
    buttonWeight: 850
  },
  premium_sans: {
    heading: '"Avenir Next", Avenir, Aptos, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    body: '"Avenir Next", Avenir, Aptos, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    button: '"Avenir Next", Avenir, Aptos, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    headingWeight: 700,
    bodyWeight: 420,
    buttonWeight: 760
  }
};

export const presetRegistry: Record<LayoutSectionPreset, PresetDefinition> = {
  "hero.full_bleed_media": heroPreset("hero.full_bleed_media", ["copy"], ["media", "proof"], "image_required"),
  "hero.split_media": heroPreset("hero.split_media", ["copy"], ["media", "proof"], "image_optional"),
  "hero.centered_editorial": heroPreset("hero.centered_editorial", ["copy"], ["proof"], "none"),
  "hero.collage": heroPreset("hero.collage", ["copy", "media"], ["proof"], "image_required"),
  "hero.service_first": heroPreset("hero.service_first", ["copy"], ["media", "proof", "services"], "image_optional"),
  "hero.proof_first": heroPreset("hero.proof_first", ["copy"], ["media", "proof"], "image_optional"),
  "services.card_grid": sectionPreset("services.card_grid", "services", ["content"], [], { content: ["services"] }, "none"),
  "services.compact_list": sectionPreset("services.compact_list", "services", ["content"], [], { content: ["services"] }, "none"),
  "services.media_feature": sectionPreset("services.media_feature", "services", ["content"], ["media"], { content: ["services"], media: ["image"] }, "image_optional"),
  "gallery.masonry": sectionPreset("gallery.masonry", "gallery", ["content"], [], { content: ["gallery"] }, "image_required"),
  "gallery.proof_grid": sectionPreset("gallery.proof_grid", "gallery", ["content"], [], { content: ["gallery"] }, "image_optional"),
  "proof.review_band": sectionPreset("proof.review_band", "proof", ["content"], [], { content: ["proof"] }, "none"),
  "proof.before_after_grid": sectionPreset("proof.before_after_grid", "before_after", ["content"], [], { content: ["before_after"] }, "none"),
  "contact.form_split": sectionPreset("contact.form_split", "contact", ["facts", "form"], ["cta"], { facts: ["contact_facts"], form: ["form"], cta: ["cta"] }, "none"),
  "contact.contact_card": sectionPreset("contact.contact_card", "contact", ["facts"], ["cta"], { facts: ["contact_facts"], cta: ["cta"] }, "none"),
  "cta.overlay_media": sectionPreset("cta.overlay_media", "cta", ["content"], ["media"], { content: ["cta"], media: ["image"] }, "image_optional"),
  "cta.simple_band": sectionPreset("cta.simple_band", "cta", ["content"], [], { content: ["cta"] }, "none"),
  "faq.conversion_list": sectionPreset("faq.conversion_list", "faq", ["content"], [], { content: ["faq"] }, "none"),
  "map.service_area": sectionPreset("map.service_area", "map", ["content"], [], { content: ["map_area"] }, "none"),
  "team.profile_grid": sectionPreset("team.profile_grid", "team", ["content"], [], { content: ["team"] }, "none"),
  "press.link_strip": sectionPreset("press.link_strip", "press", ["content"], [], { content: ["text"] }, "none"),
  "footer.standard": sectionPreset("footer.standard", "footer", ["content"], [], { content: ["footer"] }, "none")
};

export const presetOptionsByKind = Object.values(presetRegistry).reduce(
  (options, preset) => {
    options[preset.kind] ??= [];
    options[preset.kind].push({ id: preset.id, label: humanizePreset(preset.id) });
    return options;
  },
  {} as Record<LayoutSectionKind, Array<{ id: LayoutSectionPreset; label: string }>>
);

export function defaultDesignPlanForVertical(vertical: Vertical, theme: Theme): DesignPlan {
  const typographyPack = typographyPackForVertical(vertical, theme.mood);
  return {
    stylePack: stylePackForVertical(vertical, theme.mood),
    typographyPack,
    colorSystem: theme.mood === "clinical" ? "clinical" : theme.mood === "premium" || theme.mood === "editorial" ? "premium" : theme.mood === "bold" ? "bold" : "warm",
    spacingDensity: theme.density,
    buttonStyle: vertical === "beauty_salon" || vertical === "creative_studio" ? "pill" : vertical === "law_firm" ? "understated" : "solid",
    radiusStyle: theme.radius === "none" ? "sharp" : theme.radius === "md" ? "rounded" : "soft",
    imageTreatment: ["beauty_salon", "creative_studio", "restaurant", "landscaping"].includes(vertical) ? "collage" : "framed",
    motionPolicy: "none"
  };
}

export function validateDesignPlan(plan: DesignPlan): string[] {
  const issues: string[] = [];
  if (!(plan.typographyPack in typographyPacks)) issues.push(`Unknown typography pack ${plan.typographyPack}.`);
  if (plan.hostedFontAssetId) issues.push("Hosted font assets are not supported in design-v1.");
  if (!isAllowed<SiteStylePack>(plan.stylePack, ["local_modern", "premium_editorial", "urgent_service", "warm_neighborhood", "clinical_trust"])) issues.push(`Unknown style pack ${plan.stylePack}.`);
  if (!isAllowed<ButtonStyle>(plan.buttonStyle, ["solid", "outline_heavy", "pill", "understated"])) issues.push(`Unknown button style ${plan.buttonStyle}.`);
  if (!isAllowed<RadiusStyle>(plan.radiusStyle, ["sharp", "soft", "rounded"])) issues.push(`Unknown radius style ${plan.radiusStyle}.`);
  if (!isAllowed<ImageTreatment>(plan.imageTreatment, ["natural", "full_bleed", "framed", "soft_crop", "collage"])) issues.push(`Unknown image treatment ${plan.imageTreatment}.`);
  if (!isAllowed<MotionPolicy>(plan.motionPolicy, ["none", "subtle"])) issues.push(`Unknown motion policy ${plan.motionPolicy}.`);
  return issues;
}

export function validateLayoutDocument(version: SiteVersion): LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = [];
  if (version.rendererVersion !== rendererVersion) {
    issues.push({ id: "renderer_version", repairMode: "fatal_schema", message: "SiteVersion.rendererVersion must be layout-v1." });
  }
  if (version.designSchemaVersion !== designSchemaVersion) {
    issues.push({ id: "design_schema_version", repairMode: "fatal_schema", message: "SiteVersion.designSchemaVersion must be design-v1." });
  }
  if (!version.designPlan) {
    issues.push({ id: "design_plan_missing", repairMode: "fatal_schema", message: "SiteVersion.designPlan is required." });
  } else {
    for (const message of validateDesignPlan(version.designPlan)) {
      issues.push({ id: `design_plan_${slugifyIssue(message)}`, repairMode: "operator_blocked", message });
    }
  }

  for (const page of version.pages) {
    if (!Array.isArray(page.layoutSections) || page.layoutSections.length === 0) {
      issues.push({ id: "layout_sections_missing", repairMode: "fatal_schema", pageId: page.id, message: "PageModel.layoutSections must contain at least one section." });
      continue;
    }
    for (const section of page.layoutSections) {
      const preset = presetRegistry[section.preset];
      if (!preset) {
        issues.push({ id: "invalid_preset", repairMode: "fatal_schema", pageId: page.id, sectionId: section.id, message: `Preset ${section.preset} is not registered.` });
        continue;
      }
      if (preset.kind !== section.kind) {
        issues.push({
          id: "preset_kind_mismatch",
          repairMode: "fatal_schema",
          pageId: page.id,
          sectionId: section.id,
          message: `Preset ${section.preset} cannot render ${section.kind} sections.`
        });
      }
      for (const slot of preset.requiredSlots) {
        if (!section.slots[slot]?.length) {
          issues.push({
            id: "required_slot_missing",
            repairMode: "deterministic_repair",
            pageId: page.id,
            sectionId: section.id,
            slot,
            message: `Required slot ${slot} is missing for ${section.preset}.`
          });
        }
      }
      for (const [slot, components] of Object.entries(section.slots)) {
        const allowed = preset.allowedComponentsBySlot[slot];
        if (!allowed) {
          issues.push({
            id: "slot_not_allowed",
            repairMode: "fatal_schema",
            pageId: page.id,
            sectionId: section.id,
            slot,
            message: `Slot ${slot} is not allowed for ${section.preset}.`
          });
          continue;
        }
        for (const component of components) {
          if (!allowed.includes(component.type)) {
            issues.push({
              id: "component_not_allowed",
              repairMode: "fatal_schema",
              pageId: page.id,
              sectionId: section.id,
              slot,
              message: `Component ${component.type} is not allowed in ${section.preset}.${slot}.`
            });
          }
          for (const key of Object.keys(component.props)) {
            if (forbiddenPropKeys.has(key)) {
              issues.push({
                id: "arbitrary_code_prop",
                repairMode: "fatal_schema",
                pageId: page.id,
                sectionId: section.id,
                slot,
                message: `Prop ${key} is not allowed in generated layout documents.`
              });
            }
          }
        }
      }
      if (preset.mediaRequirements === "image_required" && !hasImageComponent(section)) {
        issues.push({ id: "required_media_missing", repairMode: "deterministic_repair", pageId: page.id, sectionId: section.id, message: `${section.preset} requires an image.` });
      }
      if (preset.requiredBindings.includes("primaryCta") && !propsForLayoutSection(section).primaryCta) {
        issues.push({ id: "primary_cta_missing", repairMode: "deterministic_repair", pageId: page.id, sectionId: section.id, message: `${section.preset} requires a primary CTA.` });
      }
    }
  }
  return issues;
}

export function repairLayoutDocument(version: SiteVersion) {
  const mutationSummaries: string[] = [];
  for (const page of version.pages) {
    for (const section of page.layoutSections) {
      const preset = presetRegistry[section.preset];
      if (!preset) continue;
      if (preset.requiredBindings.includes("primaryCta") && !propsForLayoutSection(section).primaryCta) {
        applyPropsToLayoutSection(section, {
          primaryCta: { label: "Request Information", href: "#contact", role: "form" }
        });
        mutationSummaries.push(`Injected default CTA into ${page.id}/${section.id}.`);
      }
      if (preset.mediaRequirements === "image_required" && !hasImageComponent(section)) {
        section.preset = fallbackPresetForMissingMedia(section);
        section.background = backgroundForPreset(section.preset);
        section.width = widthForPreset(section.preset);
        mutationSummaries.push(`Switched ${page.id}/${section.id} to ${section.preset} because required media was missing.`);
      }
      if (!section.mobileBehavior) {
        section.mobileBehavior = "stack";
        mutationSummaries.push(`Defaulted mobile behavior for ${page.id}/${section.id}.`);
      }
    }
    syncLegacySectionsFromLayout(page);
  }
  return { applied: mutationSummaries.length > 0, mutationSummaries };
}

export function layoutSectionFromSection(section: SectionModel, vertical: Vertical): LayoutSection {
  const kind = layoutKindForSectionType(section.type);
  const preset = presetForSection(section, vertical);
  return {
    id: section.id,
    kind,
    preset,
    slots: slotsForSection(section, kind),
    background: backgroundForPreset(preset),
    width: widthForPreset(preset),
    spacing: "standard",
    mobileBehavior: preset.includes("full_bleed") || preset.includes("centered") ? "content_first" : "stack",
    visibility: "all"
  };
}

export function sectionFromLayoutSection(section: LayoutSection): SectionModel {
  const props = propsForLayoutSection(section);
  const fieldPolicies = fieldPoliciesForLayoutSection(section);
  return {
    id: section.id,
    type: sectionTypeForLayoutSection(section, props),
    variant: section.preset.split(".")[1] ?? section.preset,
    props,
    bindings: bindingsForLayoutSection(section),
    fieldPolicies
  };
}

export function propsForLayoutSection(section: LayoutSection) {
  return Object.values(section.slots)
    .flat()
    .reduce((props, component) => ({ ...props, ...component.props }), {} as Record<string, unknown>);
}

export function fieldPoliciesForLayoutSection(section: LayoutSection) {
  return Object.values(section.slots)
    .flat()
    .reduce((policies, component) => ({ ...policies, ...(component.fieldPolicies ?? {}) }), {} as Record<string, FieldPolicy>);
}

export function bindingsForLayoutSection(section: LayoutSection) {
  return Object.values(section.slots)
    .flat()
    .reduce((bindings, component) => ({ ...bindings, ...(component.bindings ?? {}) }), {} as Record<string, string>);
}

export function layoutSectionsForLegacySections(sections: SectionModel[], vertical: Vertical) {
  return sections.map((section) => layoutSectionFromSection(section, vertical));
}

export function legacySectionsForLayout(layoutSections: LayoutSection[]) {
  return layoutSections.map(sectionFromLayoutSection);
}

export function syncLegacySectionsFromLayout<T extends { layoutSections: LayoutSection[]; sections: SectionModel[] }>(page: T): T {
  page.sections = legacySectionsForLayout(page.layoutSections);
  return page;
}

export function syncVersionLegacySections<T extends { pages: Array<{ layoutSections: LayoutSection[]; sections: SectionModel[] }> }>(version: T): T {
  for (const page of version.pages) syncLegacySectionsFromLayout(page);
  return version;
}

export function pageFromLegacySections(input: Omit<PageModel, "layoutSections" | "sections"> & { sections: SectionModel[]; vertical: Vertical }): PageModel {
  const page: PageModel = {
    id: input.id,
    slug: input.slug,
    title: input.title,
    seo: input.seo,
    layoutSections: layoutSectionsForLegacySections(input.sections, input.vertical),
    sections: input.sections
  };
  return syncLegacySectionsFromLayout(page);
}

export function applyPropsToLayoutSection(section: LayoutSection, props: Record<string, unknown>) {
  const components = Object.values(section.slots).flat();
  for (const [key, value] of Object.entries(props)) {
    const owningComponent = components.find((component) => Object.prototype.hasOwnProperty.call(component.props, key)) ?? components[0];
    if (!owningComponent) continue;
    owningComponent.props[key] = value;
  }
  return section;
}

export function applyPresetToLayoutSection(section: LayoutSection, preset: LayoutSectionPreset) {
  const definition = presetRegistry[preset];
  if (!definition || definition.kind !== section.kind) return false;
  section.preset = preset;
  section.background = backgroundForPreset(preset);
  section.width = widthForPreset(preset);
  section.mobileBehavior = preset.includes("full_bleed") || preset.includes("centered") ? "content_first" : "stack";
  return true;
}

function heroPreset(id: LayoutSectionPreset, requiredSlots: string[], optionalSlots: string[], mediaRequirements: PresetDefinition["mediaRequirements"]): PresetDefinition {
  const allowed: Record<string, LayoutComponentType[]> = {
    copy: ["hero_copy"],
    media: id === "hero.collage" ? ["image_collage", "image"] : ["image"],
    proof: ["proof"],
    services: ["services"]
  };
  return sectionPreset(id, "hero", requiredSlots, optionalSlots, allowed, mediaRequirements);
}

function sectionPreset(
  id: LayoutSectionPreset,
  kind: LayoutSectionKind,
  requiredSlots: string[],
  optionalSlots: string[],
  allowedComponentsBySlot: Record<string, LayoutComponentType[]>,
  mediaRequirements: PresetDefinition["mediaRequirements"]
): PresetDefinition {
  return {
    id,
    kind,
    requiredSlots,
    optionalSlots,
    allowedComponentsBySlot,
    requiredBindings: requiredBindingsForPreset(id),
    mediaRequirements,
    mobileBehavior: ["stack", "media_first", "content_first", "hide_media"],
    allowedDesignOverrides: ["buttonStyle", "imageTreatment", "radiusStyle", "spacingDensity"],
    repairCapabilities: ["inject_cta", "replace_media", "reduce_type_scale", "force_mobile_stack", "switch_preset"]
  };
}

function requiredBindingsForPreset(id: LayoutSectionPreset) {
  if (id.startsWith("hero.")) return ["primaryCta"];
  if (id.startsWith("contact.")) return ["formId"];
  if (id.startsWith("services.")) return ["services"];
  return [];
}

function slotsForSection(section: SectionModel, kind: LayoutSectionKind): Record<string, LayoutComponentInstance[]> {
  const component = (slot: string, type: LayoutComponentType, props: Record<string, unknown>, keys = Object.keys(props)): LayoutComponentInstance => ({
    id: `${section.id}_${slot}_${type}`,
    type,
    props,
    bindings: section.bindings,
    fieldPolicies: Object.fromEntries(keys.filter((key) => section.fieldPolicies[key]).map((key) => [key, section.fieldPolicies[key]]))
  });

  switch (kind) {
    case "hero":
      return {
        copy: [component("copy", "hero_copy", pick(section.props, ["eyebrow", "heading", "body", "primaryCta", "secondaryCta"]))],
        media: section.props.imageUrl ? [component("media", "image", { imageUrl: section.props.imageUrl, alt: section.props.alt })] : []
      };
    case "services":
    case "menu":
      return {
        content: [component("content", "services", pick(section.props, ["eyebrow", "heading", "body", "items"]))]
      };
    case "gallery":
      return {
        content: [component("content", "gallery", pick(section.props, ["eyebrow", "heading", "body", "images"]))]
      };
    case "proof":
      return {
        content: [component("content", "proof", pick(section.props, ["eyebrow", "heading", "body", "items"]))]
      };
    case "faq":
      return {
        content: [component("content", "faq", pick(section.props, ["eyebrow", "heading", "body", "items"]))]
      };
    case "cta":
      return {
        content: [component("content", "cta", pick(section.props, ["eyebrow", "heading", "body", "primaryCta", "secondaryCta"]))]
      };
    case "contact":
      return {
        facts: [component("facts", "contact_facts", pick(section.props, ["heading", "body", "primaryCta"]))],
        form: [component("form", "form", pick(section.props, ["formId"]))]
      };
    case "map":
      return {
        content: [component("content", "map_area", pick(section.props, ["eyebrow", "heading", "body", "areas"]))]
      };
    case "team":
      return {
        content: [component("content", "team", pick(section.props, ["eyebrow", "heading", "body", "items"]))]
      };
    case "press":
      return {
        content: [component("content", "text", pick(section.props, ["eyebrow", "heading", "body", "links"]))]
      };
    case "before_after":
      return {
        content: [component("content", "before_after", pick(section.props, ["eyebrow", "heading", "body", "items"]))]
      };
    case "trust":
      return {
        content: [component("content", "proof", pick(section.props, ["items"]))]
      };
    default:
      return {
        content: [component("content", "text", section.props)]
      };
  }
}

function presetForSection(section: SectionModel, vertical: Vertical): LayoutSectionPreset {
  if (section.type === "hero") {
    if (vertical === "restaurant" || vertical === "landscaping") return "hero.full_bleed_media";
    if (vertical === "beauty_salon" || vertical === "creative_studio") return "hero.collage";
    if (vertical === "law_firm" || vertical === "dental" || vertical === "med_spa") return "hero.proof_first";
    if (vertical === "home_services" || vertical === "auto_body") return "hero.service_first";
    return "hero.split_media";
  }
  if (section.type === "services" || section.type === "menu_deals") return section.variant === "compact_list" ? "services.compact_list" : "services.card_grid";
  if (section.type === "gallery") return vertical === "creative_studio" || vertical === "beauty_salon" ? "gallery.masonry" : "gallery.proof_grid";
  if (section.type === "testimonials" || section.type === "trust_bar") return "proof.review_band";
  if (section.type === "before_after") return "proof.before_after_grid";
  if (section.type === "contact") return "contact.form_split";
  if (section.type === "cta") return "cta.simple_band";
  if (section.type === "faq") return "faq.conversion_list";
  if (section.type === "map") return "map.service_area";
  if (section.type === "team") return "team.profile_grid";
  if (section.type === "press_video") return "press.link_strip";
  return "cta.simple_band";
}

function layoutKindForSectionType(type: SectionType): LayoutSectionKind {
  if (type === "trust_bar" || type === "testimonials") return "proof";
  if (type === "menu_deals") return "services";
  if (type === "press_video") return "press";
  return type;
}

function sectionTypeForLayoutKind(kind: LayoutSectionKind): SectionType {
  switch (kind) {
    case "hero":
    case "services":
    case "gallery":
    case "faq":
    case "cta":
    case "contact":
    case "map":
    case "team":
    case "before_after":
      return kind;
    case "trust":
    case "proof":
      return "testimonials";
    case "menu":
      return "menu_deals";
    case "press":
      return "press_video";
    case "footer":
      return "cta";
  }
}

function sectionTypeForLayoutSection(section: LayoutSection, props: Record<string, unknown>): SectionType {
  if (section.kind === "proof" && Array.isArray(props.items) && props.items.every((item) => typeof item === "string")) {
    return "trust_bar";
  }
  return sectionTypeForLayoutKind(section.kind);
}

function backgroundForPreset(preset: LayoutSectionPreset): LayoutSection["background"] {
  if (preset.includes("full_bleed") || preset.includes("overlay")) return "image";
  if (preset.includes("proof") || preset.includes("review")) return "surface";
  return "default";
}

function widthForPreset(preset: LayoutSectionPreset): LayoutSection["width"] {
  if (preset.includes("full_bleed") || preset.includes("overlay")) return "full_bleed";
  if (preset.includes("masonry") || preset.includes("collage")) return "wide";
  return "contained";
}

function stylePackForVertical(vertical: Vertical, mood: Theme["mood"]): SiteStylePack {
  if (mood === "clinical") return "clinical_trust";
  if (mood === "premium" || mood === "editorial") return "premium_editorial";
  if (vertical === "home_services" || vertical === "auto_body") return "urgent_service";
  if (mood === "warm") return "warm_neighborhood";
  return "local_modern";
}

function typographyPackForVertical(vertical: Vertical, mood: Theme["mood"]): TypographyPack {
  if (vertical === "creative_studio" || mood === "editorial") return "editorial_serif";
  if (vertical === "beauty_salon" || mood === "premium") return "premium_sans";
  if (vertical === "restaurant" || vertical === "veterinary") return "rounded_friendly";
  if (vertical === "home_services" || vertical === "auto_body" || vertical === "law_firm") return "utility_sans";
  return "clean_sans";
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function humanizePreset(value: string) {
  return value
    .split(".")
    .pop()!
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isAllowed<T extends string>(value: string, allowed: T[]): value is T {
  return (allowed as string[]).includes(value);
}

function hasImageComponent(section: LayoutSection) {
  return Object.values(section.slots)
    .flat()
    .some((component) => {
      if (component.type === "image" || component.type === "image_collage") return Boolean(component.props.imageUrl ?? component.props.images);
      return false;
    });
}

function fallbackPresetForMissingMedia(section: LayoutSection): LayoutSectionPreset {
  if (section.kind === "hero") return "hero.centered_editorial";
  if (section.kind === "gallery") return "gallery.proof_grid";
  if (section.kind === "cta") return "cta.simple_band";
  return section.preset;
}

function slugifyIssue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

const forbiddenPropKeys = new Set([
  "html",
  "rawHtml",
  "innerHTML",
  "dangerouslySetInnerHTML",
  "css",
  "js",
  "script",
  "style",
  "className",
  "embed",
  "plugin"
]);
