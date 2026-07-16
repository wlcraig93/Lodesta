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
import { assessAssetLibraryPolicy, isAssetLibraryAssetAllowedForBusiness, type ApprovedAssetLibraryAsset } from "./asset-library";
import { mediaFloorEffectiveWarningsV1, mediaFloorVerdictV1, type MediaFloorVerdictV1 } from "./media-floor-v1";

export type DesignSystemCatalogManifestV1 = {
  version: "design-system-catalog-manifest-v1";
  catalogSchemaHash: string;
  templateCount: number;
  modelSelectableTemplateIds: string[];
  renderableTemplateIds: string[];
  templates: DesignSystemCatalogTemplateManifestV1[];
  presentationsByRole: Record<ArtDirectionSectionRoleV3, readonly string[]>;
  modelSelectablePresentationsByRole: Record<ArtDirectionSectionRoleV3, readonly string[]>;
  presentationGuidanceByRole: typeof presentationGuidanceByRoleV3;
  componentControls: typeof componentControlOptionsForBlueprintV1;
  controlIncompatibilities: Array<{ id: string; reason: string }>;
  templateOptionsByTemplate: typeof templateOptionsForBlueprintV1;
};

export type DesignSystemCatalogTemplateManifestV1 = {
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

export type DesignSystemPlannerInputManifestV1 = {
  version: "design-system-planner-input-v1";
  businessPlannerInputHash: string;
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
    analyzedAssetCount: number;
    floorClearingAssetCount: number;
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
    warnings: Array<"low_resolution" | "logo_like" | "composite_graphic">;
    mediaFloor?: MediaFloorVerdictV1;
    analysis?: {
      imageKind: NonNullable<AssetReference["analysisV1"]>["imageKind"];
      focalPoint: NonNullable<AssetReference["analysisV1"]>["focalPoint"];
      subjectPlacement: NonNullable<AssetReference["analysisV1"]>["subjectPlacement"];
      warnings: NonNullable<AssetReference["analysisV1"]>["warnings"];
      contentTags: string[];
      summary: string;
    };
    url?: string;
    alt: string;
  }>;
  mediaCandidates?: DesignSystemPlannerMediaCandidateV1[];
  brandCues: {
    colorSignals: string[];
  };
  evidenceDossier?: {
    version: string;
    contentHash: string;
    sourcePageCount: number;
    proseCharCount: number;
    reviewEvidenceCount: number;
    markdown: string;
  };
};

export type DesignSystemPlannerMediaCandidateV1 = {
  id: string;
  source: "business_photo" | "business_logo" | "asset_library";
  rightsStatus: AssetReference["rightsStatus"] | "preclaim_safe";
  allowedUses: Array<"hero" | "service" | "context" | "background" | "gallery" | "proof" | "logo">;
  proofEligible: boolean;
  mayImplyRealBusinessWork: boolean;
  width?: number;
  height?: number;
  focalPoint?: string;
  tags: string[];
  artifactRef?: string;
  url?: string;
  policyNotes: string[];
  floorVerdict?: MediaFloorVerdictV1;
};

export function buildDesignSystemCatalogManifestV1(): DesignSystemCatalogManifestV1 {
  const modelSelectableTemplateIds = modelSelectableSectionTemplatesV3().map((template) => template.id);
  const renderableTemplateIds = renderableSectionTemplatesV3().map((template) => template.id);
  const hashInput = {
    version: "design-system-catalog-manifest-v1",
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
    version: "design-system-catalog-manifest-v1",
    catalogSchemaHash: hashDesignSystemPlannerManifestV1(hashInput),
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

export function buildDesignSystemPlannerInputManifestV1(bundle: SiteBundle, assetLibraryAssets: ApprovedAssetLibraryAsset[] = []): DesignSystemPlannerInputManifestV1 {
  const business = bundle.businessProfile;
  const locations = plannerLocationsV1(business, bundle.locations);
  const assets = plannerAssetsV1(business);
  const mediaCandidates = selectableMediaCandidatesV1(business, assets, assetLibraryAssets);
  const body: Omit<DesignSystemPlannerInputManifestV1, "businessPlannerInputHash"> = {
    version: "design-system-planner-input-v1",
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
      analyzedAssetCount: assets.filter((asset) => asset.analysis).length,
      floorClearingAssetCount: assets.filter((asset) => asset.mediaFloor && Object.values(asset.mediaFloor).some((verdict) => verdict.allowed)).length,
      hasLogo: Boolean(business.logo),
      hasServiceAreas: business.serviceAreas.length > 0
    },
    services: business.services.map((service, index) => ({ id: `service_${index + 1}`, label: service, source: "business_profile" as const })),
    locations,
    assets,
    mediaCandidates,
    brandCues: {
      colorSignals: colorSignalsForBundleV1(bundle)
    },
    evidenceDossier: dossierForPlannerInputV1(bundle)
  };
  return { ...body, businessPlannerInputHash: hashDesignSystemPlannerManifestV1(body) };
}

function dossierForPlannerInputV1(bundle: SiteBundle): DesignSystemPlannerInputManifestV1["evidenceDossier"] {
  const dossier = bundle.presenceAssessment.siteDossierV1;
  if (!dossier) return undefined;
  return {
    version: dossier.version,
    contentHash: dossier.contentHash,
    sourcePageCount: dossier.sourcePageCount,
    proseCharCount: dossier.proseCharCount,
    reviewEvidenceCount: dossier.reviewEvidence.length,
    markdown: dossier.markdown.slice(0, 6000)
  };
}

function selectableMediaCandidatesV1(
  business: BusinessProfile,
  assets: DesignSystemPlannerInputManifestV1["assets"],
  assetLibraryAssets: ApprovedAssetLibraryAsset[]
): DesignSystemPlannerMediaCandidateV1[] {
  const businessCandidates: DesignSystemPlannerMediaCandidateV1[] = assets.map((asset) => {
    const allowedUses = allowedUsesForBusinessAssetV1(asset);
    return {
      id: asset.id,
      source: asset.kind === "logo" ? "business_logo" as const : "business_photo" as const,
      rightsStatus: asset.rightsStatus,
      allowedUses,
      proofEligible: allowedUses.includes("proof"),
      mayImplyRealBusinessWork: asset.kind === "photo",
      width: asset.width,
      height: asset.height,
      focalPoint: asset.analysis?.focalPoint,
      tags: asset.analysis?.contentTags ?? [],
      url: asset.url,
      policyNotes: asset.kind === "photo"
        ? ["First-party business media candidate; generation ignores rights status, while publishing may require owner attestation."]
        : ["Business logo candidate."],
      floorVerdict: asset.mediaFloor
    };
  }).filter((candidate) => candidate.source !== "business_photo" || candidate.allowedUses.length > 0);

  const libraryCandidates: DesignSystemPlannerMediaCandidateV1[] = assetLibraryAssets
    .filter((asset) => asset.publicUrl && assessAssetLibraryPolicy(asset).siteSelectable && isAssetLibraryAssetAllowedForBusiness(asset, business))
    .map((asset) => ({
      id: `library_${asset.id}`,
      source: "asset_library",
      rightsStatus: "preclaim_safe",
      allowedUses: asset.intendedUses
        .map((use) => use === "section" || use === "card" ? "context" : use)
        .filter((use): use is DesignSystemPlannerMediaCandidateV1["allowedUses"][number] =>
          ["hero", "service", "context", "background", "gallery"].includes(use)
        ),
      proofEligible: false,
      mayImplyRealBusinessWork: false,
      width: asset.promptMetadata.aspectRatio ? undefined : undefined,
      height: undefined,
      tags: asset.tags,
      artifactRef: asset.id,
      url: asset.publicUrl,
      policyNotes: ["Approved library image. Generic Lodesta category image, not this specific business."]
    }));

  return [...businessCandidates, ...libraryCandidates];
}

function allowedUsesForBusinessAssetV1(
  asset: DesignSystemPlannerInputManifestV1["assets"][number]
): DesignSystemPlannerMediaCandidateV1["allowedUses"] {
  if (asset.kind === "logo") return ["logo"];
  const floorUses = asset.mediaFloor
    ? (Object.entries(asset.mediaFloor)
        .filter(([, verdict]) => verdict.allowed)
        .map(([slot]) => slot) as Array<"hero" | "background" | "proof" | "gallery">)
    : [];
  const uses = new Set<DesignSystemPlannerMediaCandidateV1["allowedUses"][number]>();
  for (const use of floorUses) uses.add(use);
  if (floorUses.includes("gallery")) uses.add("context");
  if (!asset.mediaFloor && !floorUses.length) {
    for (const use of asset.recommendedUses) {
      if (use === "logo") continue;
      uses.add(use === "service" ? "context" : use);
    }
  }
  return [...uses];
}

export function hashDesignSystemPlannerManifestV1(value: unknown): string {
  const input = stableStringifyV1(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function templateManifestEntryV1(template: SectionTemplateDefinitionV3): DesignSystemCatalogTemplateManifestV1 {
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

function plannerLocationsV1(business: BusinessProfile, locations: SiteBundle["locations"]): DesignSystemPlannerInputManifestV1["locations"] {
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

function plannerAssetsV1(business: BusinessProfile): DesignSystemPlannerInputManifestV1["assets"] {
  const photos = business.photos.map((photo) => assetManifestEntryV1(photo, "photo" as const, business));
  const logo = business.logo ? [assetManifestEntryV1(business.logo, "logo" as const, business)] : [];
  return [...logo, ...photos];
}

function assetManifestEntryV1(asset: AssetReference, kind: "photo" | "logo", business: BusinessProfile) {
  const profile = assetQualityProfileV1(asset, kind, business);
  const mediaFloor = kind === "photo" ? mediaFloorVerdictV1(asset, business) : undefined;
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
    mediaFloor,
    analysis: profile.analysis,
    url: asset.url,
    alt: asset.alt
  };
}

function assetQualityProfileV1(asset: AssetReference, kind: "photo" | "logo", business: BusinessProfile) {
  if (asset.analysisV1?.version === "asset-analysis-v1") {
    return analyzedAssetQualityProfileV1(asset, business);
  }
  const aspectRatio = asset.width && asset.height ? roundAssetAspectRatioV1(asset.width / asset.height) : undefined;
  const orientation: DesignSystemPlannerInputManifestV1["assets"][number]["orientation"] =
    !aspectRatio
      ? "unknown"
      : aspectRatio >= 1.18
        ? "landscape"
        : aspectRatio <= 0.85
          ? "portrait"
          : "square";
  const minSide = asset.width && asset.height ? Math.min(asset.width, asset.height) : undefined;
  const text = `${asset.id} ${asset.url} ${asset.alt}`.toLowerCase();
  const warnings: DesignSystemPlannerInputManifestV1["assets"][number]["warnings"] = [];
  if (minSide !== undefined && minSide < 300) warnings.push("low_resolution");
  if (kind === "logo" || /\b(logo|favicon|icon|brandmark|wordmark)\b/.test(text)) warnings.push("logo_like");
  if (asset.width && asset.height && asset.width / asset.height >= 1.55 && /\b(before|after|review|testimonial|facebook|instagram|collage|banner)\b/.test(text)) {
    warnings.push("composite_graphic");
  }

  const recommendedUses: DesignSystemPlannerInputManifestV1["assets"][number]["recommendedUses"] = [];
  const cropHints: DesignSystemPlannerInputManifestV1["assets"][number]["cropHints"] = [];
  let quality: DesignSystemPlannerInputManifestV1["assets"][number]["quality"] = "unknown";

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

function analyzedAssetQualityProfileV1(asset: AssetReference, business: BusinessProfile) {
  const analysis = asset.analysisV1;
  if (!analysis) throw new Error("Asset analysis is required.");
  const aspectRatio = asset.width && asset.height ? roundAssetAspectRatioV1(asset.width / asset.height) : undefined;
  const orientation: DesignSystemPlannerInputManifestV1["assets"][number]["orientation"] =
    !aspectRatio
      ? "unknown"
      : aspectRatio >= 1.18
        ? "landscape"
        : aspectRatio <= 0.85
          ? "portrait"
          : "square";
  const warnings: DesignSystemPlannerInputManifestV1["assets"][number]["warnings"] = [];
  const effectiveWarnings = mediaFloorEffectiveWarningsV1(asset);
  if (effectiveWarnings.some((warning) => warning === "low_resolution" || warning === "blurry")) warnings.push("low_resolution");
  if (analysis.imageKind === "logo" || effectiveWarnings.includes("logo_like")) warnings.push("logo_like");
  if (analysis.imageKind === "text_heavy_graphic" || effectiveWarnings.includes("collage_or_composite")) warnings.push("composite_graphic");

  const quality = analyzedAssetQualityV1(asset, business);
  const mediaFloor = mediaFloorVerdictV1(asset, business);
  const recommendedUses: DesignSystemPlannerInputManifestV1["assets"][number]["recommendedUses"] = [];
  if (analysis.imageKind === "logo") recommendedUses.push("logo");
  else {
    for (const slot of ["hero", "background", "proof", "gallery"] as const) {
      if (mediaFloor[slot].allowed) recommendedUses.push(slot);
    }
    if (quality === "detail_only" || quality === "section_candidate") recommendedUses.push("service");
  }
  const cropHints: DesignSystemPlannerInputManifestV1["assets"][number]["cropHints"] = [];
  if (analysis.focalPoint === "center" || analysis.subjectPlacement === "full_frame") cropHints.push("center");
  else cropHints.push("subject");
  if (analysis.warnings.includes("text_overlay") || analysis.warnings.includes("awkward_empty_space")) cropHints.push("avoid_text_edges");
  if (analysis.imageKind === "repair_detail" || analysis.imageKind === "before_after") cropHints.push("detail_zoom");
  if (orientation === "landscape") cropHints.push("wide");
  if (orientation === "portrait") cropHints.push("portrait");
  const minSide = asset.width && asset.height ? Math.min(asset.width, asset.height) : undefined;

  return {
    aspectRatio,
    orientation,
    quality,
    recommendedUses: dedupeAssetTagsV1(recommendedUses),
    cropHints: dedupeAssetTagsV1(cropHints),
    cropScores: cropScoresForAssetV1({ aspectRatio, orientation, quality, warnings, minSide }),
    warnings: dedupeAssetTagsV1(warnings),
    analysis: {
      imageKind: analysis.imageKind,
      focalPoint: analysis.focalPoint,
      subjectPlacement: analysis.subjectPlacement,
      warnings: analysis.warnings,
      contentTags: analysis.contentTags,
      summary: analysis.summary
    }
  };
}

function analyzedAssetQualityV1(asset: AssetReference, business: BusinessProfile): DesignSystemPlannerInputManifestV1["assets"][number]["quality"] {
  const analysis = asset.analysisV1;
  if (!analysis) return "unknown";
  if (analysis.imageKind === "logo") return "logo_like";
  if (analysis.imageKind === "low_quality" || analysis.warnings.some((warning) => warning === "low_resolution" || warning === "blurry")) return "too_small";
  const floor = mediaFloorVerdictV1(asset, business);
  if (floor.hero.allowed || floor.background.allowed) return "hero_candidate";
  if (analysis.imageKind === "repair_detail" || analysis.imageKind === "before_after") return "detail_only";
  if (floor.gallery.allowed) return "section_candidate";
  return "unknown";
}

function cropScoresForAssetV1(input: {
  aspectRatio?: number;
  orientation: DesignSystemPlannerInputManifestV1["assets"][number]["orientation"];
  quality: DesignSystemPlannerInputManifestV1["assets"][number]["quality"];
  warnings: DesignSystemPlannerInputManifestV1["assets"][number]["warnings"];
  minSide?: number;
}): DesignSystemPlannerInputManifestV1["assets"][number]["cropScores"] {
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
