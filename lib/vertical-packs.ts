import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import type { BrandAssessment, BusinessBrandExpressionV1, BusinessProfile, SiteAsset, Theme, Vertical } from "./models";
import type { EvidenceLedger } from "./evidence-ledger";
import {
  generationPlanSchemaVersion,
  type CopySlotSpec,
  type GenerationPlan,
  type GenerationPlanSection,
  type ShippingDesignSystemId
} from "./generation-contracts";
import { slugify } from "./slug";
import { containsGatedSensitiveClaim } from "./content-safety-scanners";

export type VerticalPack = {
  id: "auto_body";
  label: string;
  primaryCtaLabel: string;
  defaultProcessSteps: string[];
  servicePageLimit: number;
};

const autoBodyPack: VerticalPack = {
  id: "auto_body",
  label: "Auto body and collision repair",
  primaryCtaLabel: "Request an estimate",
  defaultProcessSteps: ["Share the damage", "Review the estimate", "Approve the repair plan", "Inspect and pick up"],
  servicePageLimit: 3
};

const verticalPackRegistry: Partial<Record<Vertical, VerticalPack>> = {
  auto_body: autoBodyPack
};

export function verticalPackFor(vertical: Vertical) {
  const pack = verticalPackRegistry[vertical];
  if (!pack) throw new Error(`Canonical generation currently supports auto_body only; received ${vertical}.`);
  return pack;
}

export function buildGenerationPlan(input: {
  business: BusinessProfile;
  evidence: EvidenceLedger;
  assets: SiteAsset[];
  brandExpression?: BusinessBrandExpressionV1;
  brandAssessment?: BrandAssessment;
  createdAt?: string;
  designSystemOverride?: ShippingDesignSystemId;
}): GenerationPlan {
  const pack = verticalPackFor(input.business.vertical);
  const heroAsset = firstPartyHeroAsset(input.assets);
  const designSystem = input.designSystemOverride ?? (heroAsset ? "precision_shop_editorial" : "trusted_local_service");
  if (!compatibleDesignSystems(input.assets).includes(designSystem)) {
    throw new Error(`${designSystem} is not compatible with the retained asset floor.`);
  }
  const evidenceIds = input.evidence.items
    .filter((item) => item.renderPolicy === "durable_render")
    .map((item) => item.id);
  const testimonials = input.evidence.items
    .filter((item) => item.kind === "testimonial" && item.renderPolicy === "durable_render")
    .map((item) => item.id)
    .slice(0, 3);
  const services = publicGenerationServices(input.business.services).slice(0, 8);
  const homeSections: GenerationPlanSection[] = [
    section("home.hero", heroAsset ? "hero_split" : "hero_statement", [
      slot("home.hero.eyebrow", "eyebrow", 48),
      slot("home.hero.heading", "heading", 72),
      slot("home.hero.body", "body", 220, evidenceIds)
    ], evidenceIds, heroAsset?.id),
    ...(services.length >= 3
      ? [section("home.services", services.length > 4 ? "service_index" : "side_intro_rows", [
          slot("home.services.heading", "heading", 64),
          slot("home.services.body", "body", 180),
          ...services.flatMap((_, index) => [
            slot(`home.services.${index}.title`, "item_title", 54),
            slot(`home.services.${index}.body`, "item_body", 150)
          ])
        ], [])]
      : []),
    section("home.process", "numbered_steps", [
      slot("home.process.heading", "heading", 64),
      slot("home.process.body", "body", 180),
      ...pack.defaultProcessSteps.flatMap((_, index) => [
        slot(`home.process.${index}.title`, "item_title", 48),
        slot(`home.process.${index}.body`, "item_body", 140)
      ])
    ], [])
  ];
  if (testimonials.length >= 2) {
    homeSections.push(section("home.testimonials", "quote_wall", [
      slot("home.testimonials.heading", "heading", 64),
      slot("home.testimonials.body", "body", 140)
    ], testimonials));
  }
  if (input.business.address || input.business.serviceAreas.length) {
    homeSections.push(section("home.location", input.business.address ? "location_showcase" : "service_area_showcase", [
      slot("home.location.heading", "heading", 64),
      slot("home.location.body", "body", 180)
    ], []));
  }
  homeSections.push(
    section("home.faq", "faq_list", [
      slot("home.faq.heading", "heading", 64),
      slot("home.faq.body", "body", 140),
      ...Array.from({ length: 4 }, (_, index) => [
        slot(`home.faq.${index}.question`, "question", 90),
        slot(`home.faq.${index}.answer`, "answer", 240)
      ]).flat()
    ], []),
    section("home.contact", "contact_split", [
      slot("home.contact.heading", "heading", 64),
      slot("home.contact.body", "body", 180)
    ], evidenceIds)
  );

  const servicePages = services.slice(0, pack.servicePageLimit).map((serviceName, index) => {
    const pageId = `service-${index + 1}`;
    const prefix = `${pageId}`;
    return {
      id: pageId,
      slug: `services/${slugify(serviceName)}`,
      purpose: "service_landing" as const,
      title: serviceName,
      sections: [
        section(`${prefix}.hero`, "hero_statement", [
          slot(`${prefix}.hero.eyebrow`, "eyebrow", 48),
          slot(`${prefix}.hero.heading`, "heading", 72),
          slot(`${prefix}.hero.body`, "body", 220)
        ], []),
        section(`${prefix}.detail`, "side_intro_rows", [
          slot(`${prefix}.detail.heading`, "heading", 64),
          slot(`${prefix}.detail.body`, "body", 220),
          ...Array.from({ length: 4 }, (_, itemIndex) => [
            slot(`${prefix}.detail.${itemIndex}.title`, "item_title", 54),
            slot(`${prefix}.detail.${itemIndex}.body`, "item_body", 170)
          ]).flat()
        ], []),
        section(`${prefix}.faq`, "faq_list", [
          slot(`${prefix}.faq.heading`, "heading", 64),
          slot(`${prefix}.faq.body`, "body", 140),
          ...Array.from({ length: 4 }, (_, itemIndex) => [
            slot(`${prefix}.faq.${itemIndex}.question`, "question", 90),
            slot(`${prefix}.faq.${itemIndex}.answer`, "answer", 240)
          ]).flat()
        ], []),
        section(`${prefix}.contact`, "contact_split", [
          slot(`${prefix}.contact.heading`, "heading", 64),
          slot(`${prefix}.contact.body`, "body", 180)
        ], evidenceIds)
      ]
    };
  });
  const pages = [{ id: "home", slug: "", purpose: "homepage" as const, title: input.business.name, sections: homeSections }, ...servicePages];
  return {
    schemaVersion: generationPlanSchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "build-generation-plan",
      producerVersion: generationPlanSchemaVersion,
      createdAt: input.createdAt,
      inputs: { business: input.business, evidence: input.evidence, assets: input.assets, designSystem }
    }),
    designSystem,
    brandTokens: themeForDesignSystem(designSystem, input.brandExpression, input.brandAssessment),
    navigation: {
      items: [
        ...(services.length >= 3 ? [{ label: "Services", target: "#services", kind: "anchor" as const }] : []),
        ...servicePages.map((page) => ({ label: page.title, target: `/${page.slug}`, kind: "page" as const }))
      ],
      primaryCta: { label: pack.primaryCtaLabel, target: "#contact" }
    },
    pages,
    formId: `form_${input.business.siteId}_estimate`
  };
}

export function publicGenerationServices(services: readonly string[]) {
  return services.filter((service) => !containsGatedSensitiveClaim(service));
}

export function compatibleDesignSystems(assets: SiteAsset[]): ShippingDesignSystemId[] {
  return [
    "trusted_local_service",
    ...(firstPartyHeroAsset(assets) ? ["precision_shop_editorial" as const] : [])
  ];
}

export function alternateDesignSystem(
  current: ShippingDesignSystemId,
  assets: SiteAsset[]
): ShippingDesignSystemId | undefined {
  return compatibleDesignSystems(assets).find((candidate) => candidate !== current);
}

function firstPartyHeroAsset(assets: SiteAsset[]) {
  return assets.find((asset) => {
    if (asset.kind !== "photo" || !asset.url) return false;
    const protectedFirstPartyPreview = asset.rightsStatus === "reference_only" && asset.usageScope === "preclaim_preview";
    if (!asset.ownerApproved && asset.rightsStatus !== "customer_granted" && asset.rightsStatus !== "preclaim_safe" && !protectedFirstPartyPreview) return false;
    if (asset.usageScope !== "published_site" && asset.usageScope !== "preclaim_preview") return false;
    const analysis = asset.metadata?.analysisV1 as { warnings?: string[]; imageKind?: string } | undefined;
    if (!analysis?.imageKind) return false;
    if (analysis?.warnings?.some((warning) => ["low_resolution", "blurry", "text_overlay", "logo_like", "not_business_relevant"].includes(warning))) return false;
    return analysis?.imageKind !== "logo" && analysis?.imageKind !== "generic_graphic" && analysis?.imageKind !== "text_heavy_graphic";
  });
}

function section(
  id: string,
  templateId: GenerationPlanSection["templateId"],
  copySlots: CopySlotSpec[],
  evidenceIds: string[],
  mediaAssetId?: string
): GenerationPlanSection {
  return { id, templateId, copySlots, evidenceIds, ...(mediaAssetId ? { mediaAssetId } : {}) };
}

function slot(slotId: string, role: CopySlotSpec["role"], maxCharacters: number, allowedEvidence: string[] = []): CopySlotSpec {
  return { slotId, role, maxCharacters, allowedEvidence };
}

function themeForDesignSystem(
  id: ShippingDesignSystemId,
  expression?: BusinessBrandExpressionV1,
  assessment?: BrandAssessment
): Theme {
  const sourceHex = [expression?.paletteSeed.preferredHex, ...(assessment?.colorSignals ?? [])]
    .find((value): value is string => Boolean(value && /^#[0-9a-f]{6}$/i.test(value)));
  const background = id === "precision_shop_editorial" ? "#f4f5f2" : "#f7f7f4";
  const surface = "#ffffff";
  const defaultPrimary = id === "precision_shop_editorial" ? "#1d3f4f" : "#174c3c";
  const primary = accessiblePrimary(sourceHex ?? defaultPrimary, [background, surface]);
  const accent = contrastingAccent(primary);
  const typography = typographyFor(expression?.fontPosture, id);
  const mood = themeMood(expression?.mood, id);
  if (id === "precision_shop_editorial") {
    return {
      paletteName: sourceHex ? "precision-shop-source-brand" : "precision-shop",
      colors: { background, surface, text: "#171a1d", muted: "#5d6468", primary, primaryText: "#ffffff", accent, border: "#cfd4d3" },
      typography,
      radius: "sm",
      density: "standard",
      mood
    };
  }
  return {
    paletteName: sourceHex ? "trusted-local-source-brand" : "trusted-local",
    colors: { background, surface, text: "#1c1c1a", muted: "#62625d", primary, primaryText: "#ffffff", accent, border: "#d8d8d1" },
    typography,
    radius: "sm",
    density: "standard",
    mood
  };
}

function typographyFor(posture: BusinessBrandExpressionV1["fontPosture"] | undefined, system: ShippingDesignSystemId) {
  if (posture === "editorial" || posture === "premium") return { heading: "Georgia, serif", body: "Arial, sans-serif" };
  if (posture === "rounded") return { heading: "Trebuchet MS, sans-serif", body: "Arial, sans-serif" };
  if (posture === "condensed") return { heading: "Arial Narrow, Arial, sans-serif", body: "Arial, sans-serif" };
  return system === "precision_shop_editorial"
    ? { heading: "Georgia, serif", body: "Arial, sans-serif" }
    : { heading: "Arial, sans-serif", body: "Arial, sans-serif" };
}

function themeMood(mood: BusinessBrandExpressionV1["mood"] | undefined, system: ShippingDesignSystemId): Theme["mood"] {
  if (mood === "premium") return "premium";
  if (mood === "warm" || mood === "neighborhood") return "warm";
  if (mood === "bold") return "bold";
  if (mood === "clinical") return "clinical";
  return system === "precision_shop_editorial" ? "editorial" : "utilitarian";
}

function accessiblePrimary(hex: string, lightBackgrounds: string[]) {
  let [red, green, blue] = hexChannels(hex);
  while (Math.min(...lightBackgrounds.map((background) => contrastRatio([red, green, blue], hexChannels(background)))) < 4.75) {
    red = Math.max(0, Math.round(red * 0.86));
    green = Math.max(0, Math.round(green * 0.86));
    blue = Math.max(0, Math.round(blue * 0.86));
  }
  return channelsHex(red, green, blue);
}

function contrastingAccent(primary: string) {
  const [red, green, blue] = hexChannels(primary);
  const accent = [
    Math.min(230, Math.round(210 - red * 0.2)),
    Math.min(190, Math.round(150 + (255 - green) * 0.1)),
    Math.min(170, Math.round(75 + (255 - blue) * 0.12))
  ];
  return channelsHex(accent[0], accent[1], accent[2]);
}

function hexChannels(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function channelsHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([red, green, blue]: [number, number, number]) => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}
