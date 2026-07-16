import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import type { BusinessProfile, SiteAsset, Theme, Vertical } from "./models";
import type { EvidenceLedger } from "./evidence-ledger";
import {
  generationPlanSchemaVersion,
  type CopySlotSpec,
  type GenerationPlan,
  type GenerationPlanSection,
  type ShippingDesignSystemId
} from "./generation-contracts";
import { slugify } from "./slug";

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
  createdAt?: string;
  designSystemOverride?: ShippingDesignSystemId;
}): GenerationPlan {
  const pack = verticalPackFor(input.business.vertical);
  const heroAsset = firstPartyHeroAsset(input.assets);
  const designSystem = input.designSystemOverride ?? (heroAsset ? "precision_shop_editorial" : "trusted_local_service");
  if (designSystem === "precision_shop_editorial" && !heroAsset) {
    throw new Error("precision_shop_editorial requires a first-party hero asset that clears the media floor.");
  }
  const evidenceIds = input.evidence.items
    .filter((item) => item.renderPolicy === "durable_render")
    .map((item) => item.id);
  const testimonials = input.evidence.items
    .filter((item) => item.kind === "testimonial" && item.renderPolicy === "durable_render")
    .map((item) => item.id)
    .slice(0, 3);
  const services = input.business.services.slice(0, 8);
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
    brandTokens: themeForDesignSystem(designSystem),
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

function firstPartyHeroAsset(assets: SiteAsset[]) {
  return assets.find((asset) => {
    if (asset.kind !== "photo" || !asset.url) return false;
    if (!asset.ownerApproved && asset.rightsStatus !== "customer_granted" && asset.rightsStatus !== "preclaim_safe") return false;
    if (asset.usageScope !== "published_site" && asset.usageScope !== "preclaim_preview") return false;
    const analysis = asset.metadata?.analysisV1 as { warnings?: string[]; imageKind?: string } | undefined;
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

function themeForDesignSystem(id: ShippingDesignSystemId): Theme {
  if (id === "precision_shop_editorial") {
    return {
      paletteName: "precision-shop",
      colors: { background: "#f4f5f2", surface: "#ffffff", text: "#171a1d", muted: "#5d6468", primary: "#1d3f4f", primaryText: "#ffffff", accent: "#c84a2f", border: "#cfd4d3" },
      typography: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
      radius: "sm",
      density: "standard",
      mood: "editorial"
    };
  }
  return {
    paletteName: "trusted-local",
    colors: { background: "#f7f7f4", surface: "#ffffff", text: "#1c1c1a", muted: "#62625d", primary: "#174c3c", primaryText: "#ffffff", accent: "#d3a82f", border: "#d8d8d1" },
    typography: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
    radius: "sm",
    density: "standard",
    mood: "utilitarian"
  };
}
