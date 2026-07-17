import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import type { BrandAssessment, BusinessBrandExpressionV1, Theme } from "./models";
import type { GenerationEvidenceManifestV1 } from "./generation-evidence-manifest";
import type { GenerationInputSnapshotV1, ResolvedAssetV1, VerticalPackV1 } from "./control-plane-contracts";
import {
  generationPlanSchemaVersion,
  type CopySlotSpec,
  type GenerationPlan,
  type GenerationPlanSection,
  type ShippingDesignSystemId
} from "./generation-contracts";
import { slugify } from "./slug";
import { containsGatedSensitiveClaim } from "./content-safety-scanners";
import { serviceCatalog } from "./service-catalog";
import type { ServiceDefinition } from "./service-catalog";

export const autoBodyVerticalPack: VerticalPackV1 = {
  id: "auto_body",
  version: "auto-body-pack-v1",
  vertical: "auto_body",
  businessCategory: "auto-body repair business",
  serviceCatalog: serviceCatalog.map(({ id, name, aliases, retired }) => ({ id, name, aliases, retired })),
  primaryCtaLabel: "Request an estimate",
  defaultProcessSteps: [
    { title: "Share the damage", body: "Send photos or arrange an inspection." },
    { title: "Review the estimate", body: "Review the documented damage and proposed work." },
    { title: "Approve the repair plan", body: "Confirm the repair scope before work begins." },
    { title: "Inspect and pick up", body: "Review the finished repair and pickup details." }
  ],
  servicePageLimit: 3,
  formBlueprint: {
    schemaVersion: "form-definition-v1",
    name: "Estimate request",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "phone", label: "Phone", type: "phone", required: true },
      { id: "details", label: "Damage details", type: "textarea", required: true }
    ],
    submitLabel: "Request an estimate"
  },
  pageRecipe: {
    compactServicesTemplate: "side_intro_rows",
    expandedServicesTemplate: "auto_body_service_index",
    expandedServicesThreshold: 4,
    processTemplate: "numbered_steps",
    serviceDetailTemplate: "side_intro_rows",
    faqTemplate: "faq_list",
    contactTemplate: "contact_split"
  },
  pageArchetypes: ["homepage", "service_landing"],
  seoVocabulary: ["auto body repair", "collision repair", "dent repair", "repair estimate"],
  structuredDataType: "AutoRepair",
  copyBrief: "Clear, specific auto-body repair copy centered on damage assessment, estimate clarity, repair scope, and pickup.",
  proofPolicy: {
    testimonial: "verified_source_span",
    credential: "owner_confirmation",
    warranty: "owner_confirmation",
    award: "owner_confirmation",
    offer: "owner_confirmation",
    insurance_support: "owner_confirmation",
    longevity: "owner_confirmation"
  }
};

const verticalPackRegistry = {
  auto_body: autoBodyVerticalPack
};

export function verticalPackFor(vertical: GenerationInputSnapshotV1["business"]["vertical"]): VerticalPackV1 {
  if (vertical !== "auto_body") throw new Error(`Canonical generation currently supports auto_body only; received ${vertical}.`);
  return verticalPackRegistry.auto_body;
}

export function matchServiceDefinition(
  vertical: GenerationInputSnapshotV1["business"]["vertical"],
  serviceName: string
): ServiceDefinition | undefined {
  const lower = serviceName.toLowerCase();
  let best: { definition: ServiceDefinition; length: number } | undefined;
  const catalog = verticalPackFor(vertical).serviceCatalog;
  for (const entry of serviceCatalog.filter((definition) => catalog.some((item) => item.id === definition.id && !item.retired))) {
    for (const alias of entry.aliases) {
      if (lower.includes(alias) && (!best || alias.length > best.length)) best = { definition: entry, length: alias.length };
    }
  }
  return best?.definition;
}

export function canonicalOfferingSeeds(
  vertical: GenerationInputSnapshotV1["business"]["vertical"],
  serviceNames: readonly string[]
) {
  const seen = new Set<string>();
  return serviceNames.flatMap((rawName) => {
    const name = rawName.replace(/\s+/g, " ").trim();
    if (!name) return [];
    const definition = matchServiceDefinition(vertical, name);
    const key = definition ? `catalog:${definition.id}` : `custom:${name.toLocaleLowerCase("en-US")}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ name: definition?.name ?? name, catalogId: definition?.id, customName: definition ? undefined : name }];
  });
}

export function buildGenerationPlan(input: {
  snapshot: GenerationInputSnapshotV1;
  evidence: GenerationEvidenceManifestV1;
  createdAt?: string;
  designSystemOverride?: ShippingDesignSystemId;
}): GenerationPlan {
  const business = input.snapshot.business;
  const assets = input.snapshot.assets;
  const pack = verticalPackFor(business.vertical);
  const heroAsset = firstPartyHeroAsset(assets);
  const designSystem = input.designSystemOverride ?? (heroAsset ? "precision_shop_editorial" : "trusted_local_service");
  if (!compatibleDesignSystems(assets).includes(designSystem)) {
    throw new Error(`${designSystem} is not compatible with the retained asset floor.`);
  }
  const selectedProof = selectedProofForGeneration(input.snapshot);
  const resolvedEvidenceIds = new Set(selectedProof.flatMap((item) => item.evidenceIds));
  const testimonials = input.evidence.items
    .filter((item) => item.kind === "testimonial" && item.renderPolicy === "durable_render" && resolvedEvidenceIds.has(item.id))
    .map((item) => item.id)
    .slice(0, 3);
  const offerings = generationOfferings(input.snapshot);
  const services = publicGenerationServices(offerings.map((offering) => offering.name)).slice(0, 8);
  const primaryCta = primaryCtaForIntent(input.snapshot, pack);
  const homeSections: GenerationPlanSection[] = [
    section("home.hero", heroAsset ? "hero_split" : "hero_statement", [
      slot("home.hero.eyebrow", "eyebrow", 48),
      slot("home.hero.heading", "heading", 72),
      slot("home.hero.body", "body", 220)
    ], [], heroAsset?.id),
    ...(services.length >= 3
      ? [section("home.services", services.length > pack.pageRecipe.expandedServicesThreshold
        ? pack.pageRecipe.expandedServicesTemplate
        : pack.pageRecipe.compactServicesTemplate, [
          slot("home.services.heading", "heading", 64),
          slot("home.services.body", "body", 180),
          ...services.flatMap((_, index) => [
            slot(`home.services.${index}.title`, "item_title", 54),
            slot(`home.services.${index}.body`, "item_body", 150)
          ])
        ], [])]
      : []),
    section("home.process", pack.pageRecipe.processTemplate, [
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
  if (business.address || business.serviceAreas.length) {
    homeSections.push(section("home.location", business.address ? "location_showcase" : "service_area_showcase", [
      slot("home.location.heading", "heading", 64),
      slot("home.location.body", "body", 180)
    ], []));
  }
  homeSections.push(
    section("home.faq", pack.pageRecipe.faqTemplate, [
      slot("home.faq.heading", "heading", 64),
      slot("home.faq.body", "body", 140),
      ...Array.from({ length: 4 }, (_, index) => [
        slot(`home.faq.${index}.question`, "question", 90),
        slot(`home.faq.${index}.answer`, "answer", 240)
      ]).flat()
    ], []),
    section("home.contact", pack.pageRecipe.contactTemplate, [
      slot("home.contact.heading", "heading", 64),
      slot("home.contact.body", "body", 180)
    ], [])
  );

  const servicePages = offerings
    .filter((offering) => offering.pageMode === "dedicated")
    .map((offering) => offering.name)
    .filter((name) => services.includes(name))
    .slice(0, pack.servicePageLimit)
    .map((serviceName, index) => {
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
        section(`${prefix}.detail`, pack.pageRecipe.serviceDetailTemplate, [
          slot(`${prefix}.detail.heading`, "heading", 64),
          slot(`${prefix}.detail.body`, "body", 220),
          ...Array.from({ length: 4 }, (_, itemIndex) => [
            slot(`${prefix}.detail.${itemIndex}.title`, "item_title", 54),
            slot(`${prefix}.detail.${itemIndex}.body`, "item_body", 170)
          ]).flat()
        ], []),
        section(`${prefix}.faq`, pack.pageRecipe.faqTemplate, [
          slot(`${prefix}.faq.heading`, "heading", 64),
          slot(`${prefix}.faq.body`, "body", 140),
          ...Array.from({ length: 4 }, (_, itemIndex) => [
            slot(`${prefix}.faq.${itemIndex}.question`, "question", 90),
            slot(`${prefix}.faq.${itemIndex}.answer`, "answer", 240)
          ]).flat()
        ], []),
        section(`${prefix}.contact`, pack.pageRecipe.contactTemplate, [
          slot(`${prefix}.contact.heading`, "heading", 64),
          slot(`${prefix}.contact.body`, "body", 180)
        ], [])
      ]
    };
  });
  const pages = [{ id: "home", slug: "", purpose: "homepage" as const, title: business.name, sections: homeSections }, ...servicePages];
  return {
    schemaVersion: generationPlanSchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "build-generation-plan",
      producerVersion: generationPlanSchemaVersion,
      createdAt: input.createdAt,
      inputs: { inputSnapshotId: input.snapshot.id, evidence: input.evidence, assets, verticalPack: { id: pack.id, version: pack.version }, designSystem }
    }),
    verticalPack: { id: pack.id, version: pack.version },
    designSystem,
    brandTokens: themeForDesignSystem(designSystem, input.snapshot.brandExpression, input.snapshot.brandAssessment, input.snapshot.siteIntent.brandConstraints),
    navigation: {
      items: [
        ...(services.length >= 3 ? [{ label: "Services", target: "#services", kind: "anchor" as const }] : []),
        ...servicePages.map((page) => ({ label: page.title, target: `/${page.slug}`, kind: "page" as const }))
      ],
      primaryCta
    },
    pages,
    formId: input.snapshot.formDefinition.id
  };
}

export function publicGenerationServices(services: readonly string[]) {
  return services.filter((service) => !containsGatedSensitiveClaim(service));
}

export function compatibleDesignSystems(assets: ResolvedAssetV1[]): ShippingDesignSystemId[] {
  return [
    "trusted_local_service",
    ...(firstPartyHeroAsset(assets) ? ["precision_shop_editorial" as const] : [])
  ];
}

export function alternateDesignSystem(
  current: ShippingDesignSystemId,
  assets: ResolvedAssetV1[]
): ShippingDesignSystemId | undefined {
  return compatibleDesignSystems(assets).find((candidate) => candidate !== current);
}

function firstPartyHeroAsset(assets: ResolvedAssetV1[]) {
  return assets.find((asset) => {
    if (asset.kind !== "photo" || !asset.revision.publicUrl) return false;
    const protectedFirstPartyPreview = asset.revision.rightsStatus === "reference_only" && asset.usageScope === "preclaim_preview";
    if (!asset.ownerApproved && asset.revision.rightsStatus !== "customer_granted" && asset.revision.rightsStatus !== "preclaim_safe" && !protectedFirstPartyPreview) return false;
    if (asset.usageScope !== "published_site" && asset.usageScope !== "preclaim_preview") return false;
    const analysis = asset.metadata?.analysisV1 as { warnings?: string[]; imageKind?: string } | undefined;
    if (!analysis?.imageKind) return false;
    if (analysis?.warnings?.some((warning) => ["low_resolution", "blurry", "text_overlay", "logo_like", "not_business_relevant"].includes(warning))) return false;
    return analysis?.imageKind !== "logo" && analysis?.imageKind !== "generic_graphic" && analysis?.imageKind !== "text_heavy_graphic";
  });
}

export function offeringNamesForGeneration(snapshot: GenerationInputSnapshotV1) {
  return generationOfferings(snapshot).map((offering) => offering.name);
}

function generationOfferings(snapshot: GenerationInputSnapshotV1) {
  const catalogNames = new Map(verticalPackFor(snapshot.business.vertical).serviceCatalog.map((entry) => [entry.id, entry.name]));
  const explicitlyFeatured = new Set(snapshot.siteIntent.featuredOfferingIds);
  const seen = new Set<string>();
  return snapshot.business.offerings
    .map((offering, index) => ({
      id: offering.id,
      name: offering.customName ?? (offering.catalogId ? catalogNames.get(offering.catalogId) : undefined),
      semanticKey: offering.catalogId ? `catalog:${offering.catalogId}` : `custom:${offering.customName?.toLocaleLowerCase("en-US")}`,
      pageMode: snapshot.siteIntent.offeringPageModes[offering.id] ?? offering.pageMode,
      featured: explicitlyFeatured.size ? explicitlyFeatured.has(offering.id) : offering.featured,
      index
    }))
    .filter((offering): offering is typeof offering & { name: string } => Boolean(offering.name) && offering.pageMode !== "none")
    .filter((offering) => {
      if (seen.has(offering.semanticKey)) return false;
      seen.add(offering.semanticKey);
      return true;
    })
    .sort((left, right) => Number(right.featured) - Number(left.featured) || left.index - right.index);
}

function selectedProofForGeneration(snapshot: GenerationInputSnapshotV1) {
  const selected = new Set(snapshot.siteIntent.selectedProofIds);
  return selected.size ? snapshot.business.proof.filter((proof) => selected.has(proof.id)) : snapshot.business.proof;
}

function primaryCtaForIntent(snapshot: GenerationInputSnapshotV1, pack: VerticalPackV1) {
  if (snapshot.siteIntent.primaryConversion === "call" && snapshot.business.phone) {
    return { label: "Call now", target: `tel:${snapshot.business.phone.replace(/[^\d+]/g, "")}` };
  }
  if (snapshot.siteIntent.primaryConversion === "booking" && snapshot.business.bookingLinks[0]) {
    return { label: "Book now", target: snapshot.business.bookingLinks[0] };
  }
  if (snapshot.siteIntent.primaryConversion === "visit") {
    return { label: "Get directions", target: "#location" };
  }
  return { label: pack.primaryCtaLabel, target: "#contact" };
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
  assessment?: BrandAssessment,
  constraints?: GenerationInputSnapshotV1["siteIntent"]["brandConstraints"]
): Theme {
  const prohibited = new Set((constraints?.prohibitedColors ?? []).map((value) => value.toLocaleLowerCase("en-US")));
  const sourceHex = [constraints?.preferredPrimaryColor, expression?.paletteSeed.preferredHex, ...(assessment?.colorSignals ?? [])]
    .find((value): value is string => Boolean(value && /^#[0-9a-f]{6}$/i.test(value)));
  const background = id === "precision_shop_editorial" ? "#f4f5f2" : "#f7f7f4";
  const surface = "#ffffff";
  const defaultPrimary = id === "precision_shop_editorial" ? "#1d3f4f" : "#174c3c";
  const allowedSourceHex = sourceHex && !prohibited.has(sourceHex.toLocaleLowerCase("en-US")) ? sourceHex : undefined;
  const primary = accessiblePrimary(allowedSourceHex ?? defaultPrimary, [background, surface]);
  const accent = contrastingAccent(primary);
  const typography = typographyFor(expression?.fontPosture, id);
  const mood = themeMood(expression?.mood, id);
  if (id === "precision_shop_editorial") {
    return {
      paletteName: allowedSourceHex ? "precision-shop-source-brand" : "precision-shop",
      colors: { background, surface, text: "#171a1d", muted: "#5d6468", primary, primaryText: "#ffffff", accent, border: "#cfd4d3" },
      typography,
      radius: "sm",
      density: "standard",
      mood
    };
  }
  return {
    paletteName: allowedSourceHex ? "trusted-local-source-brand" : "trusted-local",
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
