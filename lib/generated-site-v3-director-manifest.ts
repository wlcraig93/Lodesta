import {
  compatiblePresentationsForRoleV3,
  controlIncompatibilitiesV3,
  modelSelectablePresentationsForRoleV3,
  presentationGuidanceByRoleV3,
  type ArtDirectionSectionRoleV3
} from "./generated-site-v3-art-direction-catalog";
import { componentControlOptionsForBlueprintV1, templateOptionsForBlueprintV1 } from "./generated-site-v3-blueprint";
import {
  modelSelectableSectionTemplatesV3,
  renderableSectionTemplatesV3,
  sectionTemplateCatalogV3,
  type SectionTemplateDefinitionV3
} from "./generated-site-v3-section-templates";
import type { SectionBackgroundOptionV3 } from "./generated-site-v3-visual-controls";
import type { AssetReference, BusinessLocationRecord, BusinessProfile, SiteBundle } from "./models";

export type CatalogManifestV1 = {
  version: "catalog-manifest-v1";
  catalogSchemaHash: string;
  templateCount: number;
  modelSelectableTemplateIds: string[];
  renderableTemplateIds: string[];
  templates: CatalogTemplateManifestV1[];
  presentationsByRole: Record<ArtDirectionSectionRoleV3, readonly string[]>;
  modelSelectablePresentationsByRole: Record<ArtDirectionSectionRoleV3, readonly string[]>;
  presentationGuidanceByRole: typeof presentationGuidanceByRoleV3;
  componentControls: typeof componentControlOptionsForBlueprintV1;
  controlIncompatibilities: Array<{ id: string; reason: string }>;
  templateOptionsByTemplate: typeof templateOptionsForBlueprintV1;
};

export type CatalogTemplateManifestV1 = {
  id: string;
  label: string;
  status: SectionTemplateDefinitionV3["status"];
  modelSelectable: boolean;
  renderable: boolean;
  rhythmRole: SectionTemplateDefinitionV3["rhythmRole"];
  visualDensity: SectionTemplateDefinitionV3["visualDensity"];
  visualWeight: SectionTemplateDefinitionV3["visualWeight"];
  requiredSlots: readonly string[];
  optionalSlots: readonly string[];
  allowedBackgrounds: string[];
  defaultBackground: string;
  mediaCount?: { min: number; max: number };
  itemCount?: { min: number; max: number };
  factCount?: { min: number; max: number };
  responsive: {
    desktop: string;
    tablet: string;
    mobile: string;
  };
  templateOptions?: Record<string, readonly string[]>;
};

export type DirectorInputManifestV1 = {
  version: "director-input-manifest-v1";
  businessDirectorInputHash: string;
  business: {
    siteId: string;
    name: string;
    vertical: string;
    categories: string[];
    city?: string;
    region?: string;
    hasPhone: boolean;
    hasAddress: boolean;
    hasHours: boolean;
  };
  evidenceRichness: {
    serviceCount: number;
    locationCount: number;
    firstPartyAssetCount: number;
    safeRenderableAssetCount: number;
    hasLogo: boolean;
    hasServiceAreas: boolean;
  };
  services: Array<{ id: string; label: string; source: "business_profile" }>;
  locations: Array<{
    id: string;
    label: string;
    city?: string;
    region?: string;
    hasAddress: boolean;
    hasHours: boolean;
    hasGeo: boolean;
    serviceAreaCount: number;
  }>;
  assets: Array<{
    id: string;
    kind: "photo" | "logo";
    source: AssetReference["source"];
    rightsStatus: AssetReference["rightsStatus"];
    width?: number;
    height?: number;
    aspectRatio?: number;
    orientation: "landscape" | "portrait" | "square" | "unknown";
    quality: "hero_candidate" | "section_candidate" | "detail_only" | "logo_like" | "too_small" | "unknown";
    recommendedUses: Array<"hero" | "service" | "proof" | "gallery" | "background" | "logo">;
    cropHints: Array<"wide" | "subject" | "portrait" | "center" | "avoid_text_edges" | "detail_zoom">;
    cropScores: { hero: number; service: number; proof: number; background: number };
    warnings: Array<"low_resolution" | "logo_like" | "composite_graphic" | "rights_review_required">;
    analysis?: {
      imageKind: NonNullable<AssetReference["analysisV1"]>["imageKind"];
      qualityScore: number;
      usableSlots: NonNullable<AssetReference["analysisV1"]>["usableSlots"];
      focalPoint: NonNullable<AssetReference["analysisV1"]>["focalPoint"];
      recommendedCropIntent: NonNullable<AssetReference["analysisV1"]>["recommendedCropIntent"];
      cropSuitability: {
        wide: number;
        square: number;
        portrait: number;
        card: number;
      };
      warnings: NonNullable<AssetReference["analysisV1"]>["warnings"];
      contentTags: string[];
      summary: string;
    };
    url?: string;
    alt: string;
  }>;
  brandCues: {
    colorSignals: string[];
  };
};

export function buildCatalogManifestV1(): CatalogManifestV1 {
  const modelSelectableTemplateIds = modelSelectableSectionTemplatesV3().map((template) => template.id);
  const renderableTemplateIds = renderableSectionTemplatesV3().map((template) => template.id);
  const hashInput = {
    version: "catalog-manifest-v1",
    templates: sectionTemplateCatalogV3.map(templateManifestEntryV1),
    presentationsByRole: compatiblePresentationsForRoleV3,
    modelSelectablePresentationsByRole: modelSelectablePresentationsForRoleV3,
    presentationGuidanceByRole: presentationGuidanceByRoleV3,
    componentControls: componentControlOptionsForBlueprintV1,
    controlIncompatibilities: controlIncompatibilitiesV3.map((rule) => ({ id: rule.id, reason: rule.reason })),
    templateOptionsByTemplate: templateOptionsForBlueprintV1,
    modelSelectableTemplateIds,
    renderableTemplateIds
  };
  return {
    version: "catalog-manifest-v1",
    catalogSchemaHash: hashDirectorManifestV1(hashInput),
    templateCount: sectionTemplateCatalogV3.length,
    modelSelectableTemplateIds,
    renderableTemplateIds,
    templates: sectionTemplateCatalogV3.map(templateManifestEntryV1),
    presentationsByRole: compatiblePresentationsForRoleV3,
    modelSelectablePresentationsByRole: modelSelectablePresentationsForRoleV3,
    presentationGuidanceByRole: presentationGuidanceByRoleV3,
    componentControls: componentControlOptionsForBlueprintV1,
    controlIncompatibilities: controlIncompatibilitiesV3.map((rule) => ({ id: rule.id, reason: rule.reason })),
    templateOptionsByTemplate: templateOptionsForBlueprintV1
  };
}

export function buildDirectorInputManifestV1(bundle: SiteBundle): DirectorInputManifestV1 {
  const business = bundle.businessProfile;
  const locations = directorLocationsV1(business, bundle.locations);
  const assets = directorAssetsV1(business);
  const body: Omit<DirectorInputManifestV1, "businessDirectorInputHash"> = {
    version: "director-input-manifest-v1",
    business: {
      siteId: business.siteId,
      name: business.name,
      vertical: business.vertical,
      categories: [...business.categories],
      city: business.address?.city,
      region: business.address?.region,
      hasPhone: Boolean(business.phone),
      hasAddress: Boolean(business.address?.street || business.address?.city),
    hasHours: Boolean(business.hours && Object.keys(business.hours).length)
    },
    evidenceRichness: {
      serviceCount: business.services.length,
      locationCount: locations.length,
      firstPartyAssetCount: assets.filter((asset) => asset.source === "uploaded" || asset.source === "website_reference").length,
      safeRenderableAssetCount: assets.filter((asset) => asset.rightsStatus === "preclaim_safe" || asset.rightsStatus === "customer_granted").length,
      hasLogo: Boolean(business.logo),
      hasServiceAreas: business.serviceAreas.length > 0
    },
    services: business.services.map((service, index) => ({ id: `service_${index + 1}`, label: service, source: "business_profile" as const })),
    locations,
    assets,
    brandCues: {
      colorSignals: colorSignalsForBundleV1(bundle)
    }
  };
  return { ...body, businessDirectorInputHash: hashDirectorManifestV1(body) };
}

export function hashDirectorManifestV1(value: unknown): string {
  const input = stableStringifyV1(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function templateManifestEntryV1(template: SectionTemplateDefinitionV3): CatalogTemplateManifestV1 {
  return {
    id: template.id,
    label: template.label,
    status: template.status,
    modelSelectable: template.status === "active",
    renderable: template.status === "active" || template.status === "reserved" || template.status === "replay_only",
    rhythmRole: template.rhythmRole,
    visualDensity: template.visualDensity,
    visualWeight: template.visualWeight,
    requiredSlots: [...template.requiredSlots],
    optionalSlots: [...template.optionalSlots],
    allowedBackgrounds: template.allowedBackgrounds.map(backgroundIdentityV1),
    defaultBackground: backgroundIdentityV1(template.defaultBackground),
    mediaCount: template.mediaCount,
    itemCount: template.itemCount,
    factCount: template.factCount,
    responsive: {
      desktop: template.desktopRule,
      tablet: template.tabletRule,
      mobile: template.mobileRule
    },
    templateOptions: templateOptionsForBlueprintV1[template.id as keyof typeof templateOptionsForBlueprintV1]
  };
}

function directorLocationsV1(business: BusinessProfile, locations: SiteBundle["locations"]): DirectorInputManifestV1["locations"] {
  const sourceLocations: BusinessLocationRecord[] =
    locations && locations.length
      ? locations
      : [
          {
            id: `${business.siteId}_primary_location`,
            businessId: business.id,
            label: "Primary location",
            address: business.address,
            serviceAreas: business.serviceAreas,
            phone: business.phone,
            email: business.email,
            hours: business.hours,
            geo: business.geo,
            provenance: {},
            createdAt: "",
            updatedAt: ""
          }
        ];
  return sourceLocations.map((location, index) => ({
    id: location.id || `location_${index + 1}`,
    label: location.label || (index === 0 ? "Primary location" : `Location ${index + 1}`),
    city: location.address?.city,
    region: location.address?.region,
    hasAddress: Boolean(location.address?.street || location.address?.city),
    hasHours: Boolean(location.hours && Object.keys(location.hours).length),
    hasGeo: Boolean(location.geo),
    serviceAreaCount: location.serviceAreas.length
  }));
}

function directorAssetsV1(business: BusinessProfile): DirectorInputManifestV1["assets"] {
  const photos = business.photos.map((photo) => assetManifestEntryV1(photo, "photo" as const));
  const logo = business.logo ? [assetManifestEntryV1(business.logo, "logo" as const)] : [];
  return [...logo, ...photos];
}

function assetManifestEntryV1(asset: AssetReference, kind: "photo" | "logo") {
  const profile = assetQualityProfileV1(asset, kind);
  return {
    id: asset.id,
    kind,
    source: asset.source,
    rightsStatus: asset.rightsStatus,
    width: asset.width,
    height: asset.height,
    aspectRatio: profile.aspectRatio,
    orientation: profile.orientation,
    quality: profile.quality,
    recommendedUses: profile.recommendedUses,
    cropHints: profile.cropHints,
    cropScores: profile.cropScores,
    warnings: profile.warnings,
    analysis: profile.analysis,
    url: asset.url,
    alt: asset.alt
  };
}

function assetQualityProfileV1(asset: AssetReference, kind: "photo" | "logo") {
  if (asset.analysisV1?.version === "asset-analysis-v1") {
    return analyzedAssetQualityProfileV1(asset);
  }
  const aspectRatio = asset.width && asset.height ? roundAssetAspectRatioV1(asset.width / asset.height) : undefined;
  const orientation: DirectorInputManifestV1["assets"][number]["orientation"] =
    !aspectRatio
      ? "unknown"
      : aspectRatio >= 1.18
        ? "landscape"
        : aspectRatio <= 0.85
          ? "portrait"
          : "square";
  const minSide = asset.width && asset.height ? Math.min(asset.width, asset.height) : undefined;
  const text = `${asset.id} ${asset.url} ${asset.alt}`.toLowerCase();
  const warnings: DirectorInputManifestV1["assets"][number]["warnings"] = [];
  if (asset.rightsStatus === "reference_only") warnings.push("rights_review_required");
  if (minSide !== undefined && minSide < 300) warnings.push("low_resolution");
  if (kind === "logo" || /\b(logo|favicon|icon|brandmark|wordmark)\b/.test(text)) warnings.push("logo_like");
  if (asset.width && asset.height && asset.width / asset.height >= 1.55 && /\b(before|after|review|testimonial|facebook|instagram|collage|banner)\b/.test(text)) {
    warnings.push("composite_graphic");
  }

  const recommendedUses: DirectorInputManifestV1["assets"][number]["recommendedUses"] = [];
  const cropHints: DirectorInputManifestV1["assets"][number]["cropHints"] = [];
  let quality: DirectorInputManifestV1["assets"][number]["quality"] = "unknown";

  if (kind === "logo" || warnings.includes("logo_like")) {
    quality = "logo_like";
    recommendedUses.push("logo");
    cropHints.push("center");
  } else if (minSide !== undefined && minSide < 300) {
    quality = "too_small";
    cropHints.push("center");
  } else {
    const isDetail = /\b(detail|close|dent|scratch|paint|panel|bumper|glass|windshield|food|dish|room|chair|tool|before|after|proof|work)\b/.test(text);
    if (orientation === "landscape" && (asset.width ?? 0) >= 900 && !warnings.includes("composite_graphic")) {
      quality = "hero_candidate";
      recommendedUses.push("hero", "background", "gallery");
      cropHints.push("wide", "subject");
    } else if (orientation === "portrait") {
      quality = isDetail ? "detail_only" : "section_candidate";
      recommendedUses.push("proof", "gallery");
      cropHints.push("portrait", isDetail ? "detail_zoom" : "subject");
    } else {
      quality = isDetail ? "detail_only" : "section_candidate";
      recommendedUses.push("service", "proof", "gallery");
      cropHints.push(isDetail ? "detail_zoom" : "subject", "center");
    }
    if (warnings.includes("composite_graphic")) {
      recommendedUses.splice(0, recommendedUses.length, "proof", "gallery");
      cropHints.push("avoid_text_edges");
      quality = "detail_only";
    }
  }

  return {
    aspectRatio,
    orientation,
    quality,
    recommendedUses: dedupeAssetTagsV1(recommendedUses),
    cropHints: dedupeAssetTagsV1(cropHints),
    cropScores: cropScoresForAssetV1({ aspectRatio, orientation, quality, warnings, minSide }),
    warnings: dedupeAssetTagsV1(warnings),
    analysis: undefined
  };
}

function analyzedAssetQualityProfileV1(asset: AssetReference) {
  const analysis = asset.analysisV1;
  if (!analysis) throw new Error("Asset analysis is required.");
  const aspectRatio = asset.width && asset.height ? roundAssetAspectRatioV1(asset.width / asset.height) : undefined;
  const orientation: DirectorInputManifestV1["assets"][number]["orientation"] =
    !aspectRatio
      ? "unknown"
      : aspectRatio >= 1.18
        ? "landscape"
        : aspectRatio <= 0.85
          ? "portrait"
          : "square";
  const warnings: DirectorInputManifestV1["assets"][number]["warnings"] = [];
  if (asset.rightsStatus === "reference_only") warnings.push("rights_review_required");
  if (analysis.warnings.some((warning) => warning === "low_resolution" || warning === "blurry")) warnings.push("low_resolution");
  if (analysis.imageKind === "logo" || analysis.warnings.includes("logo_like")) warnings.push("logo_like");
  if (analysis.imageKind === "text_heavy_graphic" || analysis.warnings.includes("collage_or_composite")) warnings.push("composite_graphic");

  const recommendedUses = analysis.usableSlots.filter((slot) => slot !== "logo" || analysis.imageKind === "logo");
  const cropHints: DirectorInputManifestV1["assets"][number]["cropHints"] = [analysis.recommendedCropIntent];
  if (analysis.warnings.includes("text_overlay") || analysis.warnings.includes("awkward_empty_space")) cropHints.push("avoid_text_edges");
  if (analysis.imageKind === "repair_detail" || analysis.recommendedCropIntent === "detail_zoom") cropHints.push("detail_zoom");
  if (orientation === "landscape") cropHints.push("wide");
  if (orientation === "portrait") cropHints.push("portrait");

  return {
    aspectRatio,
    orientation,
    quality: analyzedAssetQualityV1(analysis),
    recommendedUses: dedupeAssetTagsV1(recommendedUses.length ? recommendedUses : ["gallery"]),
    cropHints: dedupeAssetTagsV1(cropHints),
    cropScores: {
      hero: cropScoreFromAnalysisV1(analysis.cropRecommendations.wide.suitability),
      background: cropScoreFromAnalysisV1(analysis.cropRecommendations.wide.suitability - 10),
      service: cropScoreFromAnalysisV1(Math.max(analysis.cropRecommendations.card.suitability, analysis.cropRecommendations.square.suitability)),
      proof: cropScoreFromAnalysisV1(Math.max(analysis.cropRecommendations.card.suitability, analysis.cropRecommendations.portrait.suitability))
    },
    warnings: dedupeAssetTagsV1(warnings),
    analysis: {
      imageKind: analysis.imageKind,
      qualityScore: analysis.qualityScore,
      usableSlots: analysis.usableSlots,
      focalPoint: analysis.focalPoint,
      recommendedCropIntent: analysis.recommendedCropIntent,
      cropSuitability: {
        wide: analysis.cropRecommendations.wide.suitability,
        square: analysis.cropRecommendations.square.suitability,
        portrait: analysis.cropRecommendations.portrait.suitability,
        card: analysis.cropRecommendations.card.suitability
      },
      warnings: analysis.warnings,
      contentTags: analysis.contentTags,
      summary: analysis.summary
    }
  };
}

function analyzedAssetQualityV1(
  analysis: NonNullable<AssetReference["analysisV1"]>
): DirectorInputManifestV1["assets"][number]["quality"] {
  if (analysis.imageKind === "logo") return "logo_like";
  if (analysis.qualityScore < 35 || analysis.imageKind === "low_quality") return "too_small";
  if (analysis.usableSlots.includes("hero") || analysis.usableSlots.includes("background")) return "hero_candidate";
  if (analysis.imageKind === "repair_detail" || analysis.imageKind === "before_after" || analysis.recommendedCropIntent === "detail_zoom") return "detail_only";
  if (analysis.usableSlots.includes("service") || analysis.usableSlots.includes("proof") || analysis.usableSlots.includes("gallery")) return "section_candidate";
  return "unknown";
}

function cropScoreFromAnalysisV1(value: number) {
  return clampCropScoreV1(value / 100);
}

function cropScoresForAssetV1(input: {
  aspectRatio?: number;
  orientation: DirectorInputManifestV1["assets"][number]["orientation"];
  quality: DirectorInputManifestV1["assets"][number]["quality"];
  warnings: DirectorInputManifestV1["assets"][number]["warnings"];
  minSide?: number;
}): DirectorInputManifestV1["assets"][number]["cropScores"] {
  const resolution = input.minSide === undefined ? 0.55 : Math.min(1, input.minSide / 900);
  const warningPenalty = input.warnings.includes("low_resolution") || input.warnings.includes("logo_like") ? 0.35 : 0;
  const compositePenalty = input.warnings.includes("composite_graphic") ? 0.25 : 0;
  const landscapeFit = input.orientation === "landscape" ? 1 : input.orientation === "square" ? 0.65 : 0.35;
  const subjectFit = input.orientation === "portrait" ? 0.8 : input.orientation === "square" ? 0.75 : 0.65;
  const detailFit = input.quality === "detail_only" ? 0.95 : input.quality === "section_candidate" ? 0.75 : 0.45;
  return {
    hero: clampCropScoreV1(resolution * landscapeFit - warningPenalty - compositePenalty),
    background: clampCropScoreV1(resolution * landscapeFit - warningPenalty - compositePenalty * 1.4),
    service: clampCropScoreV1(resolution * Math.max(subjectFit, detailFit) - warningPenalty * 0.7),
    proof: clampCropScoreV1(resolution * Math.max(subjectFit, detailFit) - warningPenalty * 0.5)
  };
}

function clampCropScoreV1(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function roundAssetAspectRatioV1(value: number) {
  return Math.round(value * 100) / 100;
}

function dedupeAssetTagsV1<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function colorSignalsForBundleV1(bundle: SiteBundle) {
  const brandAssessment = bundle.presenceAssessment.brandAssessment as { colorSignals?: string[] } | undefined;
  return [...(brandAssessment?.colorSignals ?? [])];
}

function backgroundIdentityV1(background: SectionBackgroundOptionV3) {
  if (background.kind === "image") return "image";
  return `${background.kind}:${background.token}`;
}

function stableStringifyV1(value: unknown): string {
  return JSON.stringify(sortForStableStringifyV1(value));
}

function sortForStableStringifyV1(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringifyV1);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortForStableStringifyV1(entryValue)])
  );
}
