import { defaultDesignPlanForVertical } from "./design-plan-defaults";
import type {
  AssetReference,
  BrandAssessment,
  BusinessLocationRecord,
  BusinessProfile,
  ComponentControlSchemaV3,
  GeneratedCopyDeckV2,
  GeneratedSiteCompilerDecisionV3,
  GeneratedSiteMediaReuseDecisionV3,
  MediaAssetDecisionV3,
  PageModel,
  SectionInstanceV3,
  SiteArtDirectionFontPairingIdV3,
  SiteArtDirectionRecipeV3,
  SiteBundle,
  SiteHeaderModeV3,
  SiteLocationBinding,
  SiteVersionV3,
  Theme,
  Vertical
} from "./models";
import {
  withVisualSectionV3,
  type BackgroundFocalPointV3,
  type FaqItemV3,
  type IntroGridCardTreatmentV3,
  type MapEmbedIntentV3,
  type MediaSlotV3,
  type QuoteItemV3,
  type RenderableLocationV3,
  type SectionBackgroundOptionV3,
  type SectionTemplateIdV3,
  type StandardItemV3,
  type VisualCtaV3,
  type VisualFactV3,
  type VisualSectionV3,
  getVisualSectionV3
} from "./generated-site-v3-visual-controls";
import { withBusinessBundleFields } from "./business-model";
import { isDynamicHoursStatus } from "./business-understanding-v2";
import { deriveBrandThemeV2, siteVariationSeedV2, type BrandCueReportV2 } from "./brand-derivation-v2";
import { resolveBrief } from "./design-brief-v1";
import {
  registerForVertical,
  resolveDesignControlsV3,
  validateDesignControlsV3,
  type CtaBandToneV3,
  type DesignControlsV3,
  type DesignProfileV3
} from "./generated-site-v3-art-direction-catalog";
import { areServicesVerticalDefaults, sentenceOverlapRatio, servicePageMaxOverlapRatio } from "./generation-quality-v2";
import {
  applyCompositionPlanV3,
  validateCompositionPlanV3,
  type CompositionIntentV3,
  type CompositionPlanV3
} from "./generated-site-v3-composition-plan";
import { sectionBlueprintsFromSectionInstancesV1, type SectionBlueprintV1 } from "./generated-site-v3-blueprint";
import { assignGeneratedSiteDesignArchetypeV1, type GeneratedSiteDesignArchetypeV1 } from "./generated-site-v3-archetypes";
import {
  buttonSystemFromSiteDirectorPlanV1,
  cardTreatmentFromSiteDirectorPlanV1,
  designControlOverridesFromSiteDirectorPlanV1,
  fontPairingFromSiteDirectorPlanV1,
  headerModeFromSiteDirectorPlanV1,
  navPlanFromSiteDirectorPlanV1,
  spacingRhythmFromSiteDirectorPlanV1,
  presentationMapFromSiteDirectorPlanV1,
  type SiteDirectorServicePageProposalV1
} from "./site-director-plan-v1";
import { homeAnchorsFromSectionsV3, reconcileNavPlanV3, type GeneratedSiteQualitySignalsV3 } from "./generated-site-v3-nav";
import {
  generatedSiteVerticalQualityProfileForBusinessV1,
  mediaIdentityKeyV1,
  mediaSuitabilityForProfileV1,
  qualityProfileAssignmentDecisionV1,
  semanticDedupeServiceItemsForProfileV1,
  type GeneratedSiteVerticalQualityProfileV1
} from "./generated-site-v3-quality-profiles";
import { slugify } from "./slug";
import type { GeneratedServicePageCopyV2 } from "./models";
import {
  validateSectionPresentationMapV3,
  type ListPresentationIdV3,
  type SectionPresentationMapV3
} from "./generated-site-v3-art-direction-catalog";
import {
  assessAssetLibraryPolicy,
  assetLibraryApprovedLicenseNote,
  isAssetLibraryAssetAllowedForBusiness,
  selectApprovedAssetLibraryMedia,
  type ApprovedAssetLibraryAsset
} from "./asset-library";
import { imageAssetsForVertical } from "./image-registry";

const compilerVersion = "generated-site-v3-compiler-v1-minimal-template-options";

const backgrounds = {
  page: { kind: "solid", token: "page" },
  surface: { kind: "solid", token: "surface" },
  dark: { kind: "solid", token: "dark" },
  brand: { kind: "solid", token: "brand" },
  subtleGradient: { kind: "gradient", token: "subtle" },
  brandGradient: { kind: "gradient", token: "brand" }
} as const satisfies Record<string, SectionBackgroundOptionV3>;

export type GeneratedSiteV3CompileResult = {
  version: SiteVersionV3;
  compositionReport: GeneratedSiteV3CompositionReport;
  brandCueReport: BrandCueReportV2;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
};

export type GeneratedSiteV3EvidenceSignals = {
  serviceCount: number;
  hasPhone: boolean;
  hasAddress: boolean;
  hasHours: boolean;
  hasServiceAreas: boolean;
  mediaCount: number;
  safeMediaCount: number;
  hasSafeHeroMedia: boolean;
  hasEnoughGalleryMedia: boolean;
  hasBeforeAfterProof: boolean;
  hasRepairReferenceMedia: boolean;
  hasQuoteProof: boolean;
  hasRealPricingEvidence: boolean;
  hasCredentialTrustProof: boolean;
  hasLocationSection: boolean;
};

export type GeneratedSiteV3CompositionDecision = {
  id: string;
  status: "included" | "skipped";
  sectionRole: string;
  evidenceSignal: keyof GeneratedSiteV3EvidenceSignals | "recipe";
  reason: string;
  selectedTemplateId?: SectionTemplateIdV3;
  selectedOptions?: Record<string, unknown>;
  skipReason?: string;
};

export type GeneratedSiteV3RecipeId = "auto_body_v1" | "auto_services_v1" | "general_local_v1";

export type GeneratedSiteV3CompositionReport = {
  version: "generated-site-v3-composition-report-v1";
  selectedRecipe: GeneratedSiteV3RecipeId;
  recipeSelection: {
    selectedRecipe: GeneratedSiteV3RecipeId;
    reason: string;
    signals: string[];
  };
  evidence: GeneratedSiteV3EvidenceSignals;
  decisions: GeneratedSiteV3CompositionDecision[];
  sectionBlueprints?: SectionBlueprintV1[];
  sectionBlueprintValidation?: {
    status: "passed";
    issues: [];
  };
};

export function compileGeneratedSiteV3Site(input: ({
  bundle: SiteBundle;
  createdAt?: string;
} | {
  siteId: string;
  business: BusinessProfile;
  createdAt?: string;
}) & {
  assetLibraryAssets?: ApprovedAssetLibraryAsset[];
  /**
   * Craft-loop recompile overrides (Tier 2). Preconditions enforced here:
   * image hero variants require safe gallery media; hero media overrides
   * must reference an already-selected safe asset. Invalid overrides are
   * ignored, never guessed at.
   */
  overrides?: GeneratedSiteV3CompilerOverrides;
}): GeneratedSiteV3CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const bundle = withBusinessBundleFields("bundle" in input ? input.bundle : temporaryBundleForProfile(input.business, input.siteId));
  const business = bundle.businessProfile;
  const siteId = business.siteId;
  const qualityProfile = generatedSiteVerticalQualityProfileForBusinessV1(business);
  const profileCompilerDecisions: GeneratedSiteCompilerDecisionV3[] = [qualityProfileAssignmentDecisionV1(qualityProfile)];
  const copyDeck = bundle.presenceAssessment?.generatedCopyDeck;
  const baseLocationContext = locationCompileContextForBundle(bundle);
  const media = selectV3Media(business, input.assetLibraryAssets ?? []);
  const presetTheme = themeForV3Business(business, media.kind);
  const brandDerivation = deriveBrandThemeV2({
    vertical: business.vertical,
    presetTheme,
    renderInspection: bundle.presenceAssessment?.renderInspection,
    brandAssessment: bundle.presenceAssessment?.brandAssessment
  });
  const theme = brandDerivation.theme ?? presetTheme;
  const archetypeAssignment = assignGeneratedSiteDesignArchetypeV1({
    business,
    brandApplied: brandDerivation.report.applied
  });
  const designArchetype = archetypeAssignment.archetype;
  const brief = bundle.presenceAssessment?.designBrief;
  const compilerOverrides = {
    ...bundle.presenceAssessment?.v3CompilerOverrides,
    ...input.overrides
  };
  const designProfile = brief?.profile ?? designProfileForBusiness(business, brandDerivation.report.applied);
  let designControls = resolveBrief(designProfile, brief?.overrides, "solid_editorial");
  applyDesignArchetypeControlsV1(designControls, designArchetype, { brandApplied: brandDerivation.report.applied });
  const siteDirectorRuntime = bundle.presenceAssessment.siteDirectorPlanV1;
  const acceptedSiteDirectorPlan =
    siteDirectorRuntime?.validation.status === "passed" ? siteDirectorRuntime.plan : undefined;
  const acceptedSiteDirectorBlueprints =
    siteDirectorRuntime?.validation.status === "passed" ? siteDirectorRuntime.validation.acceptedSectionBlueprints : undefined;
  const siteDirectorHeaderMode = acceptedSiteDirectorPlan
    ? headerModeFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    : undefined;
  const siteDirectorFontPairing = acceptedSiteDirectorPlan
    ? fontPairingFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    : undefined;
  const selectedHeaderMode = siteDirectorHeaderMode ?? headerModeForBusiness(business, designProfile);
  if (acceptedSiteDirectorPlan) {
    const directorControls = {
      ...designControls,
      ...designControlOverridesFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    };
    if (!validateDesignControlsV3(directorControls, { headerMode: "solid_editorial" }).length) {
      designControls = directorControls;
    }
  } else if (!brief) {
    applyAutoBodyControlVariation(business, designControls, brandDerivation.report.applied);
  }
  const siteDirectorPresentationMap = acceptedSiteDirectorPlan
    ? presentationMapFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    : undefined;
  const siteDirectorButtonSystem = acceptedSiteDirectorPlan
    ? buttonSystemFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    : undefined;
  const siteDirectorCardTreatment = acceptedSiteDirectorPlan
    ? cardTreatmentFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    : undefined;
  const siteDirectorSpacingRhythm = acceptedSiteDirectorPlan
    ? spacingRhythmFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    : undefined;
  const siteDirectorGeometryDiversityDirective = acceptedSiteDirectorPlan?.strategy.geometryDiversityDirective;
  const siteDirectorNavPlan = acceptedSiteDirectorPlan
    ? navPlanFromSiteDirectorPlanV1(acceptedSiteDirectorPlan)
    : undefined;
  const requestedPresentationMap = acceptedSiteDirectorPlan
    ? siteDirectorPresentationMap
    : brief?.presentationMap;
  const effectivePresentationMap = presentationMapWithArchetypeV1(requestedPresentationMap, designArchetype);
  const pageSlugRegistry = createPageSlugRegistryV3();
  const locationPages = buildLocationLandingPagesV3(business, baseLocationContext, copyDeck, pageSlugRegistry);
  const locationContext = locationContextWithLandingPages(baseLocationContext, locationPages);
  const composition = v3PageSectionsForBusiness(
    business,
    media,
    locationContext,
    copyDeck,
    compilerOverrides,
    designControls,
    acceptedSiteDirectorPlan ? undefined : brief?.compositionPlan,
    effectivePresentationMap,
    acceptedSiteDirectorBlueprints,
    designArchetype
  );
  const pageSections = composition.sections;
  const mediaReuseDecisions = applyPageMediaDedupeV1(pageSections, galleryForSelectedMedia(media));
  {
    // Validate controls against the COMPOSED header mode, not a static one:
    // an image-background hero makes the header transparent_overlay, which
    // the incompatibility table forbids for brand_bar.
    const firstVisual = composition.sections
      .map((section) => getVisualSectionV3(section.props))
      .find((visual) => Boolean(visual));
    const imageHeroLeads = Boolean(
      firstVisual && firstVisual.templateId === "hero_statement" && firstVisual.options.background.kind === "image"
    );
    const violations = validateDesignControlsV3(designControls, {
      headerMode: imageHeroLeads ? "transparent_overlay" : selectedHeaderMode
    });
    if (violations.length && designControls.headerSurface === "brand_bar") {
      designControls.headerSurface = "neutral";
    }
  }
  const servicePages = buildServiceLandingPagesV3(
    business,
    locationContext,
    copyDeck,
    pageSections,
    media,
    pageSlugRegistry,
    acceptedSiteDirectorPlan?.servicePages
  );
  linkServiceItemsToPages(pageSections, servicePages);
  profileCompilerDecisions.push(
    ...applyVerticalQualityProfileToSectionsV1({
      business,
      profile: qualityProfile,
      designArchetype,
      sections: pageSections,
      gallery: galleryForSelectedMedia(media)
    })
  );
  if (!acceptedSiteDirectorPlan) {
    applyBackgroundRhythm(pageSections, siteId, business.vertical);
  }
  const homeSeo: PageModel["seo"] = {
    title: copyDeck?.seo.title ?? seoTitleForBusiness(business),
    description: copyDeck?.seo.description ?? seoDescriptionForBusiness(business),
    canonicalPath: "/"
  };
  const pages: SiteVersionV3["pageComposition"]["pages"] = [
    {
      id: "home",
      slug: "",
      title: business.name,
      seo: homeSeo,
      purpose: "homepage",
      sections: pageSections
    },
    ...servicePages.map((page) => ({
      id: page.id,
      slug: page.slug,
      title: page.title,
      seo: page.seo,
      purpose: "service_landing" as const,
      sections: page.sections
    })),
    ...locationPages.map((page) => ({
      id: page.id,
      slug: page.slug,
      title: page.title,
      seo: page.seo,
      purpose: "location_landing" as const,
      sections: page.sections
    }))
  ];
  sanitizeGeneratedSitePublicCopyV1(pages);
  const navReconciliation = reconcileNavPlanV3({
    navPlan: siteDirectorNavPlan,
    pages,
    homeAnchors: homeAnchorsFromSectionsV3(pageSections)
  });
  const reconciledSiteDirectorNavPlan = navReconciliation.navPlan;
  const sectionOptionSequence = sectionOptionSequenceV1(pageSections);
  const compilerDecisions = compilerDecisionsForVersionV1({
    compositionDecisions: composition.report.decisions,
    sections: pageSections,
    archetype: designArchetype,
    archetypeReason: archetypeAssignment.reason,
    acceptedSiteDirectorPlan: Boolean(acceptedSiteDirectorPlan),
    profileDecisions: profileCompilerDecisions
  });
  const geometryDiversityDirective = siteDirectorGeometryDiversityDirective ?? designArchetype.geometryDiversityDirective;
  const version: SiteVersionV3 = {
    id: `version_${siteId}_layout_v3`,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    designPlan: defaultDesignPlanForVertical(business.vertical, theme),
    createdAt,
    theme,
    presentation: {
      mobileActionBehavior: "disabled",
      reservedMobileActionSpace: false
    },
    artifactRefs: [],
    mediaDecisions: media.decisions,
    designArchetypeId: designArchetype.id,
    archetypeAssignmentReason: archetypeAssignment.reason,
    geometryDiversityDirective,
    compilerDecisions,
    sectionOptionSequence,
    mediaReuseDecisions,
    artDirection: media.kind === "media"
      ? {
          version: "site-art-direction-v3",
          recipeId: `precision-service-v1:${designArchetype.id}`,
          designArchetypeId: designArchetype.id,
          archetypeAssignmentReason: archetypeAssignment.reason,
          geometryDiversityDirective,
          fontPairingId: siteDirectorFontPairing ?? fontPairingForBusinessWithArchetypeV1(business, bundle.presenceAssessment?.brandAssessment, designArchetype),
          colorSystem: designArchetype.chassis.colorSystem,
          spacingRhythm: siteDirectorSpacingRhythm ?? designArchetype.chassis.spacingRhythm,
          headerMode: selectedHeaderMode,
          mediaTreatment: "editorial_crop",
          buttonSystem: siteDirectorButtonSystem ?? designArchetype.chassis.buttonSystem,
          cardTreatment: siteDirectorCardTreatment ?? designArchetype.chassis.cardTreatment,
          density: designArchetype.chassis.density,
          sectionPresentation: acceptedSiteDirectorPlan
            ? (effectivePresentationMap ?? {})
            : sectionPresentationWithProfile(business, designProfile, copyDeck, effectivePresentationMap),
          ...(reconciledSiteDirectorNavPlan ? { navPlan: reconciledSiteDirectorNavPlan } : {}),
          designProfile,
          controls: designControls
        }
      : {
          version: "site-art-direction-v3",
          recipeId: `quiet-boutique-v1:${designArchetype.id}`,
          designArchetypeId: designArchetype.id,
          archetypeAssignmentReason: archetypeAssignment.reason,
          geometryDiversityDirective,
          fontPairingId: siteDirectorFontPairing ?? fontPairingForBusinessWithArchetypeV1(business, bundle.presenceAssessment?.brandAssessment, designArchetype),
          colorSystem: designArchetype.chassis.colorSystem,
          spacingRhythm: siteDirectorSpacingRhythm ?? designArchetype.chassis.spacingRhythm,
          headerMode: selectedHeaderMode,
          mediaTreatment: "text_first_fallback",
          buttonSystem: siteDirectorButtonSystem ?? designArchetype.chassis.buttonSystem,
          cardTreatment: siteDirectorCardTreatment ?? designArchetype.chassis.cardTreatment,
          density: designArchetype.chassis.density,
          sectionPresentation: acceptedSiteDirectorPlan
            ? (effectivePresentationMap ?? {})
            : sectionPresentationWithProfile(business, designProfile, copyDeck, effectivePresentationMap),
          ...(reconciledSiteDirectorNavPlan ? { navPlan: reconciledSiteDirectorNavPlan } : {}),
          designProfile,
          controls: designControls
        },
    artDirectionDecision: {
      id: `art_${siteId}_layout_v3`,
      version: "art-direction-decision-v3",
      selectedRecipeId: media.kind === "media" ? "precision-service-v1" : "quiet-boutique-v1",
      rejectedRecipeIds: media.kind === "media" ? ["quiet-boutique-v1"] : ["precision-service-v1", "media-led-local-v1"],
      inputSignals: [
        business.vertical,
        media.kind === "media" ? "public-safe contextual media available" : "text-first fallback selected",
        business.phone ? "phone-first conversion available" : "generic contact conversion",
        business.address ? "location fact available" : "location unavailable"
      ],
      rationale:
        media.kind === "media"
          ? "Use a media-led local-service composition because the selected media is rights-safe and does not imply documented customer-specific work."
          : "Use a text-first editorial composition because no safe business-specific media should be implied.",
      validation: { status: "passed", issues: [] },
      tokenVersions: { fontPool: "v3-font-pool-v1", recipeCatalog: "v3-recipe-catalog-v1", componentControls: "visual-section-v3" }
    },
    pageComposition: {
      id: `composition_${siteId}_layout_v3`,
      version: "page-composition-v3",
      pages
    }
  };
  const sectionBlueprints = sectionBlueprintsFromSectionInstancesV1(pageSections, "deterministic");
  if (siteDirectorRuntime) {
    siteDirectorRuntime.finalRenderedSequence = pageSections.map((section) => section.id);
  }
  return {
    version,
    compositionReport: {
      ...composition.report,
      sectionBlueprints,
      sectionBlueprintValidation: { status: "passed", issues: [] }
    },
    brandCueReport: brandDerivation.report,
    qualitySignals: {
      navReconciliation,
      compilerDecisions,
      mediaReuseDecisions
    }
  };
}

function temporaryBundleForProfile(business: BusinessProfile, siteId: string): SiteBundle {
  return {
    businessProfile: business,
    siteModel: {
      id: siteId,
      slug: siteId,
      theme: {} as Theme,
      versions: [],
      pinList: []
    },
    extensionModel: {
      forms: [],
      workflows: [],
      customBlocks: []
    },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {} as SiteBundle["presenceAssessment"]
  };
}

type SelectedV3Media =
  | {
      kind: "media";
      heroUrl: string;
      conversionBackgroundUrl?: string;
      conversionBackgroundFocalPoint?: BackgroundFocalPointV3;
      gallery: SiteMediaItemV3[];
      decisions: MediaAssetDecisionV3[];
    }
  | {
      kind: "text";
      decisions: MediaAssetDecisionV3[];
    };

type V3Composition = {
  sections: SectionInstanceV3[];
  report: GeneratedSiteV3CompositionReport;
};

type SiteMediaItemV3 = {
  url: string;
  label: string;
  publicCaption?: string;
  focalPoint?: BackgroundFocalPointV3;
  cropIntent?: SiteMediaCropIntentV3;
};

type SiteMediaCropIntentV3 = NonNullable<SectionBlueprintV1["assetRefs"]>[number]["cropIntent"];

function v3RecipeIdForVertical(vertical: Vertical): GeneratedSiteV3RecipeId {
  if (vertical === "auto_body") return "auto_body_v1";
  if (vertical === "auto_services") return "auto_services_v1";
  return "general_local_v1";
}

/**
 * Typography rotation: each vertical has an affinity pool over the loaded font
 * catalog; the site seed picks within it so same-vertical sites vary.
 */
const fontPairingPools: Partial<Record<Vertical, SiteArtDirectionFontPairingIdV3[]>> = {
  auto_services: ["precision_grotesk", "condensed_service_sans", "display_sans_humanist", "magazine_grotesk"],
  auto_body: ["precision_grotesk", "condensed_service_sans", "magazine_grotesk", "display_sans_humanist"],
  home_services: ["precision_grotesk", "display_sans_humanist", "condensed_service_sans", "friendly_rounded"],
  restaurant: ["warm_editorial_sans", "editorial_serif_clean_sans", "friendly_rounded", "magazine_grotesk"],
  beauty_salon: ["quiet_serif", "editorial_serif_clean_sans", "warm_editorial_sans", "magazine_grotesk"],
  med_spa: ["quiet_serif", "editorial_serif_clean_sans", "display_sans_humanist", "magazine_grotesk"],
  law_firm: ["editorial_serif_clean_sans", "display_sans_humanist", "quiet_serif", "precision_grotesk"],
  dental: ["display_sans_humanist", "friendly_rounded", "precision_grotesk", "editorial_serif_clean_sans"],
  fitness: ["condensed_service_sans", "display_sans_humanist", "magazine_grotesk", "precision_grotesk"],
  real_estate: ["editorial_serif_clean_sans", "quiet_serif", "display_sans_humanist", "magazine_grotesk"],
  landscaping: ["warm_editorial_sans", "friendly_rounded", "display_sans_humanist", "precision_grotesk"],
  veterinary: ["friendly_rounded", "warm_editorial_sans", "display_sans_humanist", "editorial_serif_clean_sans"],
  creative_studio: ["magazine_grotesk", "editorial_serif_clean_sans", "quiet_serif", "display_sans_humanist"]
};

const defaultFontPairingPool: SiteArtDirectionFontPairingIdV3[] = [
  "display_sans_humanist",
  "magazine_grotesk",
  "editorial_serif_clean_sans",
  "friendly_rounded"
];

function fontPairingForBusiness(business: BusinessProfile, brandAssessment?: BrandAssessment): SiteArtDirectionFontPairingIdV3 {
  const typographySignals = brandAssessment?.typographySignals.join(" ").toLowerCase() ?? "";
  if (/\b(serif|baskerville|georgia|editorial|traditional)\b/.test(typographySignals)) {
    return business.vertical === "auto_body" ? "editorial_serif_clean_sans" : "quiet_serif";
  }
  const pool = fontPairingPools[business.vertical] ?? defaultFontPairingPool;
  if (business.vertical === "auto_body") {
    const serviceBreadthOffset = Math.max(0, business.services.length - 3);
    return pool[(siteVariationSeedV2(`${business.siteId}:font`) + serviceBreadthOffset) % pool.length];
  }
  return pool[siteVariationSeedV2(business.siteId) % pool.length];
}

/** Axis-salted seed so per-axis picks decorrelate across one site id. */
function axisPick<T>(siteId: string, axis: string, pool: readonly T[]): T {
  return pool[siteVariationSeedV2(`${siteId}:${axis}`) % pool.length];
}

/**
 * Header mode axis: register-aware pools over the previously dead headerMode
 * enum (it was hardcoded to solid_editorial). Image-backed heroes still force
 * transparent_overlay at render time regardless of this pick.
 */
function headerModeForBusiness(business: BusinessProfile, profile: DesignProfileV3): SiteHeaderModeV3 {
  const pools: Record<DesignProfileV3["register"], readonly SiteHeaderModeV3[]> = {
    punchy_retail: ["solid_editorial", "utility_call_bar", "compact_sticky"],
    steady_professional: ["solid_editorial", "compact_sticky"],
    warm_boutique: ["solid_editorial", "minimal_wordmark"]
  };
  return axisPick(business.siteId, "header", pools[profile.register]);
}

/**
 * Process presentation axis with one grammar rule baked in: when services
 * render as side_intro_rows (4+ services), process may not repeat the same
 * template directly below it (the audit-confirmed "two identical row sections
 * back to back" smell), so it takes the vertical stepper. Otherwise the seed
 * picks between row and stepper geometry.
 */
function processPresentationForBusiness(
  business: BusinessProfile,
  deck?: GeneratedCopyDeckV2,
  requested?: SectionPresentationMapV3["process"]
): "program_rows" | "stepper_vertical" | "checklist_cards" | "numbered_ledger" {
  if (business.vertical === "auto_body" && requested === "program_rows") return "stepper_vertical";
  if (requested === "program_rows" || requested === "stepper_vertical" || requested === "checklist_cards" || requested === "numbered_ledger") return requested;
  const services = serviceItemsForBusiness(business, deck);
  const servicePresentation = servicePresentationForBusiness(business, deck);
  if (business.vertical === "auto_body" && servicePresentation !== "service_problem_rows") {
    return axisPick(business.siteId, "process", ["program_rows", "stepper_vertical", "checklist_cards", "numbered_ledger"] as const);
  }
  if (services.length >= 4) return "stepper_vertical";
  return axisPick(business.siteId, "process", ["program_rows", "stepper_vertical", "checklist_cards", "numbered_ledger"] as const);
}

/**
 * B3 selector: per-section presentation choices from validated pools. Pools are
 * deliberately conservative — only presentations the grammar harness renders
 * cleanly on both text-only and media shells (e.g. menu_preview needs a dark
 * section and stays out until that combination is harness-validated).
 */
function sectionPresentationForBusiness(
  business: BusinessProfile,
  deck?: GeneratedCopyDeckV2,
  requested?: SectionPresentationMapV3
): SectionPresentationMapV3 {
  const servicesPresentation = servicePresentationForBusiness(business, deck, requested?.services);
  const processPresentation = processPresentationForBusiness(business, deck, requested?.process);
  const map: SectionPresentationMapV3 = {
    services: servicesPresentation,
    process: processPresentation,
    faq: "faq_accordion",
    factsStrip: axisPick(business.siteId, "facts", ["trust_bar", "utility_rail", "proof_cards"] as const),
    heroFacts: "inline_strip",
    contactFacts: "stacked",
    gallery: axisPick(business.siteId, "gallery", ["mosaic", "collage", "editorial_strip"] as const),
    quotes: "action_tiles",
    ...requested
  };
  const violations = validateSectionPresentationMapV3(map);
  if (violations.length) {
    // Selector bugs must fail loudly in development, never ship invalid maps.
    throw new Error(`Art direction selector produced an invalid presentation map: ${violations.map((violation) => violation.reason).join("; ")}`);
  }
  return map;
}

function servicePresentationForBusiness(
  business: BusinessProfile,
  deck?: GeneratedCopyDeckV2,
  requested?: SectionPresentationMapV3["services"]
): ListPresentationIdV3 {
  const serviceCount = serviceItemsForBusiness(business, deck).length;
  if (requested) return requested;
  const servicesHaveMedia = serviceItemsForBusiness(business, deck).some((service) => Boolean(service.mediaUrl));
  const servicesPools: Partial<Record<Vertical, readonly ListPresentationIdV3[]>> = {
    auto_body: serviceCount >= 5
      ? ["showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "feature_list", "media_grid", "card_grid", "action_tiles", "premium_showcase", "menu_preview"]
      : ["feature_list", "showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "media_grid", "premium_showcase", "card_grid", "menu_preview", "action_tiles"],
    auto_services: serviceCount >= 5
      ? ["showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "feature_list", "media_grid", "card_grid", "action_tiles", "premium_showcase", "menu_preview"]
      : ["feature_list", "showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "media_grid", "card_grid", "premium_showcase", "action_tiles", "menu_preview"],
    restaurant: ["showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "card_grid", "action_tiles", "coaching_cards"],
    beauty_salon: ["showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "card_grid", "coaching_cards", "action_tiles"],
    med_spa: ["showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "card_grid", "coaching_cards"],
    creative_studio: ["showcase_grid", ...(servicesHaveMedia ? ["image_tiles"] as const : []), "coaching_cards", "card_grid"]
  };
  const servicesPool = servicesPools[business.vertical] ?? (["card_grid", "action_tiles", "coaching_cards"] as const);
  return axisPick(business.siteId, "services", servicesPool);
}

/**
 * Background rhythm (craft roadmap, Track 1.4): the middle sections alternate
 * tonal backgrounds per a seed-picked pattern so the page stops reading as one
 * unbroken run of white cards on one neutral surface. Hero, CTA band, and contact keep their
 * deliberate backgrounds; contrast safety is enforced by the existing
 * foreground-token derivation + render QA.
 */
function applyBackgroundRhythm(sections: SectionInstanceV3[], siteId: string, vertical: Vertical): void {
  const basePatterns: Array<Array<keyof typeof backgrounds>> = [
    ["surface", "page", "subtleGradient", "page", "surface"],
    ["page", "subtleGradient", "page", "surface", "subtleGradient"],
    ["subtleGradient", "surface", "page", "subtleGradient", "page"]
  ];
  const autoBodyPatterns: Array<Array<keyof typeof backgrounds>> = [
    ["page", "surface", "dark", "page", "brandGradient", "surface"],
    ["surface", "page", "brandGradient", "surface", "dark", "page"],
    ["page", "dark", "surface", "brandGradient", "page", "surface"]
  ];
  const patterns = vertical === "auto_body" ? autoBodyPatterns : basePatterns;
  const pattern = patterns[siteVariationSeedV2(`${siteId}:rhythm`) % patterns.length];
  const rhythmSectionIds = new Set(["story", "services", "proof", "process", "about", "gallery", "faq"]);
  let index = 0;
  for (const section of sections) {
    if (!rhythmSectionIds.has(section.id)) continue;
    const visual = section.props?.visualSectionV3 as VisualSectionV3 | undefined;
    const background = visual?.options?.background as { kind?: string; token?: string } | undefined;
    if (!visual?.options || background?.token === "brand" || background?.kind === "image") continue;
    visual.options.background = backgrounds[pattern[index % pattern.length]];
    index += 1;
  }
}

function cardTreatmentForBusiness(business: BusinessProfile): "minimal_surface" | "borderless" {
  return axisPick(business.siteId, "card", ["minimal_surface", "borderless"] as const);
}

function buttonSystemForBusiness(
  business: BusinessProfile,
  mediaKind: SelectedV3Media["kind"]
): SiteArtDirectionRecipeV3["buttonSystem"] {
  const pools: Partial<Record<Vertical, readonly SiteArtDirectionRecipeV3["buttonSystem"][]>> = {
    auto_body: ["high_contrast_primary", "solid_with_quiet_secondary", "understated"],
    auto_services: ["high_contrast_primary", "solid_with_quiet_secondary", "rounded_primary"],
    home_services: ["solid_with_quiet_secondary", "high_contrast_primary", "understated"],
    restaurant: ["rounded_primary", "solid_with_quiet_secondary", "understated"],
    beauty_salon: ["rounded_primary", "understated", "solid_with_quiet_secondary"]
  };
  const fallbackPool =
    mediaKind === "media"
      ? (["solid_with_quiet_secondary", "high_contrast_primary", "rounded_primary"] as const)
      : (["understated", "solid_with_quiet_secondary"] as const);
  return axisPick(business.siteId, "buttons", pools[business.vertical] ?? fallbackPool);
}

function applyAutoBodyControlVariation(business: BusinessProfile, controls: DesignControlsV3, brandApplied: boolean) {
  if (business.vertical !== "auto_body") return;
  const pick = <T,>(axis: string, pool: readonly T[]): T => pool[siteVariationSeedV2(`${business.siteId}:auto-body-${axis}`) % pool.length];
  controls.eyebrowTreatment = pick("eyebrow", ["plain_caps", "accent_bar_chip", "filled_kicker"] as const);
  controls.cardChrome = pick("card-chrome", ["bordered", "elevated", "accent_underline"] as const);
  controls.figureTreatment = pick("figure", ["flush", "framed_shadow"] as const);
  controls.badgeStyle = pick("badge", ["square", "rounded", "tilted"] as const);
  controls.headerSurface = brandApplied ? pick("header", ["neutral", "brand_bar"] as const) : "neutral";
  controls.ctaBandTone = pick("cta-band", brandApplied ? (["dark", "brand", "paper"] as const) : (["dark", "paper"] as const));
  controls.numberStyle = pick("number-style", ["outlined", "oversized", "filled_chip"] as const);
  controls.factHighlight = pick("fact-highlight", ["plain", "accent_value"] as const);
}

/**
 * Design-profile selector (deterministic fallback tier — the model design
 * brief slots in above this later, exactly like copy). Register follows
 * vertical + conversion energy; posture follows brand-cue confidence with a
 * seeded coin for verticals where both postures read well. Incompatible
 * resolutions fall back to the reserved posture (validated, never shipped
 * broken).
 */
function designProfileForBusiness(business: BusinessProfile, brandApplied: boolean): DesignProfileV3 {
  const register = registerForVertical(business.vertical);
  const seededForward =
    business.vertical === "auto_body"
      ? siteVariationSeedV2(business.siteId) % 4 >= 2
      : siteVariationSeedV2(`${business.siteId}:posture`) % 2 === 0;
  // accent_forward shipped after the derived-palette contrast class was
  // pinned and matrix-covered (composed-header validation + kicker cascade);
  // the env var remains as a kill-switch.
  const accentForwardEnabled = process.env.LODESTA_ACCENT_FORWARD !== "off";
  const brandPosture: DesignProfileV3["brandPosture"] =
    accentForwardEnabled && brandApplied && (register === "punchy_retail" || seededForward) ? "accent_forward" : "reserved";
  const profile: DesignProfileV3 = {
    register,
    brandPosture,
    rationale: `${business.vertical} → ${register}; brand cues ${brandApplied ? "applied" : "absent"} → ${brandPosture}.`
  };
  const violations = validateDesignControlsV3(resolveDesignControlsV3(profile), { headerMode: "solid_editorial" });
  return violations.length ? { ...profile, brandPosture: "reserved", rationale: `${profile.rationale} Downgraded: ${violations[0]}` } : profile;
}

/**
 * Profile-aware presentation overrides on top of the per-business defaults:
 * the punchy retail register pulls the hero facts into chips and the facts
 * strip into the marquee (accent-forward only), both seeded so a vertical's
 * fleet stays varied.
 */
function sectionPresentationWithProfile(
  business: BusinessProfile,
  profile: DesignProfileV3,
  deck?: GeneratedCopyDeckV2,
  requested?: SectionPresentationMapV3
) {
  const base = sectionPresentationForBusiness(business, deck, requested) ?? {};
  if (profile.register !== "punchy_retail") return base;
  const seed = siteVariationSeedV2(`${business.siteId}:retail-presentation`);
  return {
    ...base,
    heroFacts: "hero_chips" as const,
    // Marquee eligibility widened to all punchy-retail sites (seeded): the
    // ticker is a register expression, not a brand-cue privilege.
    ...(seed % 2 === 0 ? { factsStrip: "marquee" as const } : {}),
    ...requested
  };
}

function presentationMapWithArchetypeV1(
  requested: SectionPresentationMapV3 | undefined,
  archetype: GeneratedSiteDesignArchetypeV1
): SectionPresentationMapV3 {
  return {
    services: archetype.services.presentation,
    ...requested
  };
}

function applyDesignArchetypeControlsV1(
  controls: DesignControlsV3,
  archetype: GeneratedSiteDesignArchetypeV1,
  context: { brandApplied: boolean }
) {
  const archetypeControls = archetype.chassis.controls;
  for (const [key, value] of Object.entries(archetypeControls) as Array<[keyof DesignControlsV3, DesignControlsV3[keyof DesignControlsV3]]>) {
    if (value === undefined) continue;
    if (context.brandApplied && key === "headerSurface") continue;
    (controls as Record<keyof DesignControlsV3, DesignControlsV3[keyof DesignControlsV3]>)[key] = value;
  }
}

function fontPairingForBusinessWithArchetypeV1(
  business: BusinessProfile,
  brandAssessment: BrandAssessment | undefined,
  archetype: GeneratedSiteDesignArchetypeV1
): SiteArtDirectionFontPairingIdV3 {
  if (brandAssessment?.typographySignals.length) return fontPairingForBusiness(business, brandAssessment);
  return archetype.chassis.fontPairingId;
}

function sectionOptionSequenceV1(sections: SectionInstanceV3[]): string[] {
  return sections.flatMap((section) => {
    const visual = getVisualSectionV3(section.props);
    if (!visual) return [];
    const options = Object.entries(visual.options as Record<string, unknown>)
      .filter(([key, value]) => key !== "background" && typeof value === "string")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${String(value)}`);
    return [`${visual.templateId}{${options.join(",")}}`];
  });
}

function sanitizeGeneratedSitePublicCopyV1(pages: SiteVersionV3["pageComposition"]["pages"]) {
  for (const page of pages) {
    for (const section of page.sections) {
      sanitizeGeneratedSiteValueV1(section.props);
    }
  }
}

function sanitizeGeneratedSiteValueV1(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (typeof value[index] === "string") value[index] = sanitizeGeneratedSiteTextV1(value[index]);
      else sanitizeGeneratedSiteValueV1(value[index]);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string") {
      (value as Record<string, unknown>)[key] = sanitizeGeneratedSiteTextV1(child);
    } else {
      sanitizeGeneratedSiteValueV1(child);
    }
  }
}

function sanitizeGeneratedSiteTextV1(text: string): string {
  return text
    .replace(/\bfocused option\b/gi, "repair choice")
    .replace(/\bfocused help\b/gi, "repair help")
    .replace(/\bclear next steps\b/gi, "the next repair step")
    .replace(/\bpractical support\b/gi, "repair support")
    .replace(/\bneed a shop to look at the damage\b/gi, "need collision or paint repair")
    .replace(/\bcan talk through\b/gi, "will review")
    .replace(/\bcan discuss\b/gi, "will review")
    .replace(/\bcan help with\b/gi, "handles");
}

function compilerDecisionsForVersionV1(input: {
  compositionDecisions: GeneratedSiteV3CompositionDecision[];
  sections: SectionInstanceV3[];
  archetype: GeneratedSiteDesignArchetypeV1;
  archetypeReason: string;
  acceptedSiteDirectorPlan: boolean;
  profileDecisions: GeneratedSiteCompilerDecisionV3[];
}): GeneratedSiteCompilerDecisionV3[] {
  const decisions: GeneratedSiteCompilerDecisionV3[] = [
    {
      id: `archetype.${input.archetype.id}`,
      kind: "archetype_assignment",
      severity: "info",
      reason: input.archetypeReason
    },
    ...input.profileDecisions
  ];

  for (const decision of input.compositionDecisions) {
    const selected = decision.selectedOptions as Record<string, unknown> | undefined;
    if (decision.id.endsWith(".clamped") && selected) {
      decisions.push({
        id: decision.id,
        kind: "template_option_clamp",
        severity: "warning",
        sectionId: decision.id.split(".")[1],
        templateId: String(selected.renderedTemplateId ?? decision.selectedTemplateId ?? ""),
        optionName: String(selected.optionName ?? ""),
        requestedValue: String(selected.requestedValue ?? ""),
        resolvedValue: String(selected.renderedValue ?? ""),
        reason: String(selected.reason ?? decision.reason)
      });
      continue;
    }
    if (decision.skipReason === "duplicate_service_list_with_service_index") {
      decisions.push({
        id: decision.id,
        kind: "composition_section_drop",
        severity: "warning",
        sectionId: decision.id.split(".")[1],
        ...(decision.selectedTemplateId ? { templateId: String(decision.selectedTemplateId), requestedValue: String(decision.selectedTemplateId) } : {}),
        resolvedValue: "dropped",
        reason: decision.reason
      });
    }
  }

  const defaultHeavy = defaultHeavyVariantSelectionDecisionV1(input.sections, input.acceptedSiteDirectorPlan);
  if (defaultHeavy) decisions.push(defaultHeavy);
  return decisions;
}

function defaultHeavyVariantSelectionDecisionV1(
  sections: SectionInstanceV3[],
  acceptedSiteDirectorPlan: boolean
): GeneratedSiteCompilerDecisionV3 | undefined {
  if (!acceptedSiteDirectorPlan) return undefined;
  const optionPairs = sections.flatMap((section) => {
    const visual = getVisualSectionV3(section.props);
    if (!visual) return [];
    return Object.entries(visual.options as Record<string, unknown>)
      .filter(([key, value]) => key !== "background" && typeof value === "string")
      .map(([key, value]) => `${visual.templateId}.${key}=${String(value)}`);
  });
  if (optionPairs.length < 6) return undefined;
  const defaultLike = optionPairs.filter((pair) =>
    /heroLayout=classic_split|proofPlacement=below_copy|ctaLayout=inline|mediaTreatment=framed|headlineScale=standard|serviceIndexTreatment=featured_services_plus_all|contactLayout=call_first/.test(pair)
  );
  if (defaultLike.length / optionPairs.length < 0.72) return undefined;
  return {
    id: "variant_selection.default_heavy",
    kind: "default_heavy_variant_selection",
    severity: "warning",
    reason: `SiteDirector selected mostly default-like section options (${defaultLike.length}/${optionPairs.length}); archetype/default diversity should be more visible.`
  };
}

function applyVerticalQualityProfileToSectionsV1(input: {
  business: BusinessProfile;
  profile: GeneratedSiteVerticalQualityProfileV1;
  designArchetype: GeneratedSiteDesignArchetypeV1;
  sections: SectionInstanceV3[];
  gallery: SiteMediaItemV3[];
}): GeneratedSiteCompilerDecisionV3[] {
  const decisions: GeneratedSiteCompilerDecisionV3[] = [];
  for (const section of input.sections) {
    const visual = getVisualSectionV3(section.props);
    if (!visual) continue;
    const next = structuredClone(visual) as VisualSectionV3;
    const sectionDecisions = [
      ...applyProfileServicePolicyV1(input.profile, next),
      ...applyProfileProofMediaPolicyV1(input.business, input.profile, next, input.gallery)
    ];
    if (!sectionDecisions.length) continue;
    section.props = withVisualSectionV3({ ...section.props }, next);
    const normalizedDecisions = sectionDecisions.map((decision) => ({
      ...decision,
      sectionId: decision.sectionId ?? section.id,
      templateId: decision.templateId ?? next.templateId
    }));
    decisions.push(...normalizedDecisions);
    if (
      input.designArchetype.hero.proofPlacement !== "none" &&
      normalizedDecisions.some((decision) => decision.kind === "proof_section_fallback")
    ) {
      decisions.push({
        id: `profile_archetype_constraint.${input.designArchetype.id}.${section.id}`,
        kind: "profile_archetype_constraint",
        severity: "warning",
        sectionId: section.id,
        templateId: next.templateId,
        requestedValue: input.designArchetype.hero.proofPlacement,
        resolvedValue: "context_process_section",
        reason: `${input.designArchetype.label} is proof-capable, but ${input.profile.label} evidence policy rejected all proof-slot media for this section; the compiler retained the archetype chassis and converted the proof moment to honest context/process content.`
      });
    }
  }
  return decisions;
}

function applyProfileServicePolicyV1(
  profile: GeneratedSiteVerticalQualityProfileV1,
  visual: VisualSectionV3
): GeneratedSiteCompilerDecisionV3[] {
  if (visual.templateId !== "service_index" && visual.templateId !== "intro_grid" && visual.templateId !== "comparison_table") return [];
  const slots = visual.slots as Record<string, unknown>;
  const itemsSlot = slots.items;
  if (!itemsSlot || typeof itemsSlot !== "object" || !Array.isArray((itemsSlot as { items?: unknown }).items)) return [];
  const currentItems = (itemsSlot as { items: StandardItemV3[] }).items;
  const deduped = semanticDedupeServiceItemsForProfileV1({ profile, items: currentItems });
  if (deduped.items.length !== currentItems.length || deduped.decisions.length) {
    (itemsSlot as { items: StandardItemV3[] }).items = deduped.items.map((item, index) => ({
      ...item,
      meta: item.meta ?? (deduped.items.length >= 5 ? String(index + 1).padStart(2, "0") : item.meta)
    }));
  }
  return deduped.decisions;
}

function applyProfileProofMediaPolicyV1(
  business: BusinessProfile,
  profile: GeneratedSiteVerticalQualityProfileV1,
  visual: VisualSectionV3,
  gallery: SiteMediaItemV3[]
): GeneratedSiteCompilerDecisionV3[] {
  if (!isProofLikeVisualSectionV1(visual)) return [];
  const slots = visual.slots as Record<string, unknown>;
  const media = slots.media;
  if (!media || typeof media !== "object" || !Array.isArray((media as { items?: unknown }).items)) return [];
  const mediaSlotRef = media as MediaSlotV3;
  const decisions: GeneratedSiteCompilerDecisionV3[] = [];
  const accepted: SiteMediaItemV3[] = [];
  for (const item of mediaSlotRef.items) {
    const suitability = mediaSuitabilityForProfileV1({ profile, business, item, slot: "proof" });
    if (suitability.allowed) {
      accepted.push(item);
      continue;
    }
    decisions.push({
      id: `media_suitability_reject.${visual.templateId}.${mediaIdentityKey(item.url)}`,
      kind: "media_suitability_reject",
      severity: "warning",
      requestedValue: item.url,
      resolvedValue: "rejected_from_proof",
      reason: `Rejected proof media "${item.label}" because ${suitability.reason}: ${suitability.evidence}`
    });
  }
  const minimumMediaCount = minimumMediaCountForProfiledProofSectionV1(visual);
  if (decisions.length === 0) return [];
  if (accepted.length >= minimumMediaCount) {
    mediaSlotRef.items = accepted;
    return decisions;
  }

  const fallback = normalizeMediaItems(
    [...accepted, ...fallbackContextMediaForProofSlotV1(business, profile, gallery, mediaSlotRef.items)],
    Math.max(minimumMediaCount, Math.min(3, mediaSlotRef.items.length || minimumMediaCount))
  ).slice(0, Math.max(minimumMediaCount, Math.min(3, mediaSlotRef.items.length || minimumMediaCount)));
  if (fallback.length < minimumMediaCount) return decisions;
  mediaSlotRef.items = fallback.map((item) => ({
    ...item,
    publicCaption: undefined,
    cropIntent: item.cropIntent ?? "wide"
  }));
  rewriteProofSectionAsContextSectionV1(visual, profile);
  decisions.push({
    id: `proof_section_fallback.${visual.templateId}`,
    kind: "proof_section_fallback",
    severity: "warning",
    requestedValue: "proof_media",
    resolvedValue: "generic_context_media",
    reason:
      "All candidate proof media was unsuitable for a source-backed proof section, so the compiler kept a generic process/context section without implying business-specific repair proof."
  });
  return decisions;
}

function minimumMediaCountForProfiledProofSectionV1(visual: VisualSectionV3) {
  if (visual.templateId === "media_mosaic") return 3;
  if (visual.templateId === "proof_pair") return 2;
  return 1;
}

function isProofLikeVisualSectionV1(visual: VisualSectionV3) {
  return (
    visual.anchorId === "proof" ||
    visual.templateId === "case_study_preview" ||
    visual.templateId === "proof_pair" ||
    visual.templateId === "media_mosaic"
  );
}

function fallbackContextMediaForProofSlotV1(
  business: BusinessProfile,
  profile: GeneratedSiteVerticalQualityProfileV1,
  gallery: SiteMediaItemV3[],
  rejectedItems: SiteMediaItemV3[]
) {
  const rejected = new Set(rejectedItems.map((item) => mediaIdentityKeyV1(item.url)));
  const cleanGallery = gallery.filter((item) => {
    if (rejected.has(mediaIdentityKeyV1(item.url))) return false;
    return mediaSuitabilityForProfileV1({ profile, business, item, slot: "service" }).allowed;
  });
  const registryFallback = imageAssetsForVertical(business.vertical).map((asset) => ({
    url: asset.url,
    label: asset.label || asset.alt || "Generic service context",
    focalPoint: "center" as const,
    cropIntent: "wide" as const
  }));
  return normalizeMediaItems([...cleanGallery, ...registryFallback], 8);
}

function rewriteProofSectionAsContextSectionV1(
  visual: VisualSectionV3,
  profile: GeneratedSiteVerticalQualityProfileV1
) {
  const slots = visual.slots as Record<string, unknown>;
  const copy = slots.copy;
  if (!copy || typeof copy !== "object") return;
  const copyRecord = copy as Record<string, unknown>;
  if (profile.id === "auto_body") {
    copyRecord.eyebrow = "Damage details";
    copyRecord.heading = "What to share before the vehicle comes in.";
    copyRecord.body = "Share where the vehicle was hit, whether panels rub or doors bind, paint color concerns, photos, timing, and whether it can be driven.";
    return;
  }
  copyRecord.eyebrow = "Service details";
  copyRecord.heading = "Confirm the request before scheduling.";
  copyRecord.body = "The business can respond best with the service need, timing, location, access notes, and contact details.";
}

function spacingRhythmForBusiness(business: BusinessProfile): "standard" | "spacious" | "cinematic" {
  // Restaurants/boutiques lean airy; trades lean efficient. Seed varies within.
  const pools: Partial<Record<Vertical, readonly ("standard" | "spacious" | "cinematic")[]>> = {
    restaurant: ["spacious", "cinematic"],
    beauty_salon: ["spacious", "cinematic"],
    med_spa: ["cinematic", "spacious"],
    creative_studio: ["cinematic", "spacious"]
  };
  const pool = pools[business.vertical] ?? (["spacious", "standard"] as const);
  return pool[siteVariationSeedV2(`${business.siteId}:spacing`) % pool.length];
}

type LocationCompileContextV3 = {
  locations: RenderableLocationV3[];
  physicalLocations: RenderableLocationV3[];
  primaryLocation?: RenderableLocationV3;
  serviceAreas: string[];
  hasLocationSection: boolean;
  hasPhysicalLocation: boolean;
};

type GeneratedSiteV3CompilerOverrides = {
  heroVariant?: "image_statement" | "hero_split";
  heroMediaUrl?: string;
  heroPrimaryCta?: VisualCtaV3;
};

function v3PageSectionsForBusiness(
  business: BusinessProfile,
  media: SelectedV3Media,
  locationContext: LocationCompileContextV3,
  deck?: GeneratedCopyDeckV2,
  overrides?: GeneratedSiteV3CompilerOverrides,
  controls?: DesignControlsV3,
  plan?: CompositionPlanV3,
  presentationPlan?: SectionPresentationMapV3,
  directorBlueprints?: readonly SectionBlueprintV1[],
  designArchetype?: GeneratedSiteDesignArchetypeV1
): V3Composition {
  const recipeId = v3RecipeIdForVertical(business.vertical);
  const services = serviceItemsForBusiness(business, deck);
  const gallery = normalizeMediaItems(galleryForSelectedMedia(media), 12);
  const evidence = classifyAutoBodyV3Evidence(business, media, gallery, services, locationContext);
  const decisions: GeneratedSiteV3CompositionDecision[] = [
    {
      id: `recipe.${recipeId}`,
      status: "included",
      sectionRole: "recipe",
      evidenceSignal: "recipe",
      reason: `${recipeId} is the deterministic V3 recipe selected for the ${business.vertical} vertical.`,
      selectedOptions: { recipeId }
    }
  ];
  const sections: SectionInstanceV3[] = [];
  const directorBlueprintById = new Map((directorBlueprints ?? []).map((blueprint) => [blueprint.id, blueprint]));

  const include = (id: string, family: string, sectionRole: string, evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"], reason: string, section: VisualSectionV3) => {
    sections.push(visualSection(id, family, section));
    decisions.push(includedDecision(sectionRole, evidenceSignal, reason, section));
  };
  const skip = (sectionRole: string, evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"], reason: string) => {
    decisions.push({
      id: `${sectionRole}.skipped`,
      status: "skipped",
      sectionRole,
      evidenceSignal,
      reason,
      skipReason: reason
    });
  };

  if (directorBlueprints?.length) {
    return v3PageSectionsFromDirectorBlueprints({
      business,
      media,
      locationContext,
      deck,
      overrides,
      controls,
      presentationPlan,
      recipeId,
      services,
      gallery,
      evidence,
      directorBlueprints,
      designArchetype
    });
  }

  const heroBlueprint = directorBlueprintById.get("hero");
  if (heroBlueprint?.templateId === "hero_statement") {
    if (evidence.hasSafeHeroMedia) {
      const heroItem = gallery[0];
      include(
        "hero",
        "hero.section_template",
        "hero",
        "hasSafeHeroMedia",
        "SiteDirectorPlanV1 selected hero_statement; safe hero media is available, so it renders as an image-backed statement hero.",
        heroImageStatementSection(business, heroItem?.url ?? "", deck, overrides?.heroPrimaryCta, designArchetype?.hero, heroItem?.focalPoint)
      );
    } else {
      include(
        "hero",
        "hero.section_template",
        "hero",
        "hasSafeHeroMedia",
        "SiteDirectorPlanV1 selected hero_statement; no safe hero media is available, so it renders as a text-led statement hero.",
        heroStatementSection(business, deck, overrides?.heroPrimaryCta, heroBlueprint.templateOptions?.heroAlign, designArchetype?.hero)
      );
    }
  } else if (heroBlueprint?.templateId === "hero_split" && evidence.hasSafeHeroMedia) {
    include(
      "hero",
      "hero.section_template",
      "hero",
      "hasSafeHeroMedia",
      "SiteDirectorPlanV1 selected hero_split and safe hero media is available.",
      heroSplitSection(business, gallery, deck, overrides?.heroPrimaryCta, designArchetype?.hero)
    );
  } else if (evidence.hasSafeHeroMedia) {
    // Hero family rotation: full-bleed image hero vs split hero, by seed.
    // Craft-loop hero overrides (preconditions enforced): an explicit variant
    // beats the seed, and a media override must be one of THIS compile's safe
    // gallery assets — never an arbitrary URL.
    const overrideHeroUrl =
      overrides?.heroMediaUrl && gallery.some((item) => item.url === overrides.heroMediaUrl)
        ? overrides.heroMediaUrl
        : undefined;
    const heroItem = (overrideHeroUrl ? gallery.find((item) => item.url === overrideHeroUrl) : undefined) ?? gallery[0];
    const hasProtectedAutoBodyReferenceMedia =
      business.vertical === "auto_body" && media.decisions.some((decision) => decision.rightsStatus === "owner_attestation_required");
    const useImageHero =
      overrides?.heroVariant === "image_statement"
        ? gallery.length > 0
        : overrides?.heroVariant === "hero_split"
          ? false
          : !hasProtectedAutoBodyReferenceMedia && siteVariationSeedV2(`${business.siteId}:hero`) % 2 === 0 && gallery.length > 0;
    if (useImageHero) {
      include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "Safe hero media is available; the seed selects the full-bleed image hero.", heroImageStatementSection(business, heroItem.url, deck, overrides?.heroPrimaryCta, designArchetype?.hero, heroItem.focalPoint));
    } else {
      include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "Safe hero media is available, so the recipe uses hero_split.", heroSplitSection(business, gallery, deck, overrides?.heroPrimaryCta, designArchetype?.hero));
    }
  } else {
    include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "No safe hero media is available, so the recipe uses hero_statement.", heroStatementSection(business, deck, overrides?.heroPrimaryCta, heroBlueprint?.templateOptions?.heroAlign, designArchetype?.hero));
  }

  if (proofFactsForBusiness(business).length >= 3) {
    include("facts", "proof.section_template", "facts_strip", "hasCredentialTrustProof", "Facts strip renders because at least three real business facts are available.", factsStripSection(business));
  } else {
    skip("facts_strip", "hasCredentialTrustProof", "Skipped facts_strip because fewer than three real business facts are available; filler facts are not rendered.");
  }

  if (evidence.hasSafeHeroMedia && !(business.vertical === "auto_body" && evidence.hasBeforeAfterProof)) {
    const heroTemplateId = sections[0]?.variant === "hero_split" ? "hero_split" : "hero_statement";
    include(
      "story",
      "story.section_template",
      "story_split_media",
      "hasSafeHeroMedia",
      "Safe media is available, so the recipe adds one supporting split-media story section.",
      splitMediaSection(business, gallery, splitMediaSideForOccurrence(heroTemplateId, 0), deck)
    );
  } else {
    skip(
      "story_split_media",
      "hasSafeHeroMedia",
      business.vertical === "auto_body" && evidence.hasBeforeAfterProof
        ? "Skipped split_media because before/after proof media gets a focused proof section instead of another collage treatment."
        : "Skipped split_media because no safe media is available."
    );
  }

  // Media-headed cards (catalog batch): when enough distinct safe images
  // exist, the first service cards carry section-grade figures — the
  // demo-parity treatment. Hero keeps gallery[0]; cards draw from the rest.
  const visibleServiceCount = services.length >= 4 ? Math.min(services.length, 6) : Math.min(services.length, 3);
  const serviceGallery = serviceThumbnailGalleryForBusiness(business, gallery, visibleServiceCount);
  const allowAutoBodyServiceMedia = business.vertical !== "auto_body" || serviceGallery.length >= visibleServiceCount;
  const servicesWithMedia = allowAutoBodyServiceMedia ? servicesWithCompleteMedia(services, serviceGallery, visibleServiceCount) : services;
  const galleryUsedByServices = servicesWithMedia.flatMap((item) => (item.mediaUrl ? [item.mediaUrl] : []));
  const servicesBlueprint = directorBlueprintById.get("services");
  if (servicesBlueprint?.templateId === "side_intro_rows" && services.length >= 3) {
    include(
      "services",
      "services.section_template",
      "services",
      "serviceCount",
      "SiteDirectorPlanV1 selected side_intro_rows for the services section.",
      serviceRowsSection(business, servicesWithMedia, deck, servicesBlueprint.background)
    );
  } else if (services.length >= 4) {
    include(
      "services",
      "services.section_template",
      "services",
      "serviceCount",
      "Four to six service items render as a responsive service card grid.",
      serviceCardGridSection(business, servicesWithMedia, deck, presentationPlan?.services, servicesBlueprint?.templateOptions?.cardTreatment, servicesBlueprint?.background)
    );
  } else {
    include(
      "services",
      "services.section_template",
      "services",
      "serviceCount",
      "Three service cards fit intro_grid.",
      introGridSection(
        business,
        servicesWithMedia,
        servicesBlueprint?.templateOptions?.cardTreatment ?? serviceGridCardTreatmentForBusiness(business, servicesWithMedia),
        deck,
        servicesBlueprint?.background
      )
    );
  }

  skip(
    "repair_scope",
    "hasRepairReferenceMedia",
    business.vertical === "auto_body" && evidence.hasBeforeAfterProof
      ? "Skipped abstract proof band because before/after media renders as a focused proof image section."
      : "Skipped repair-scope proof band because no source-grounded repair reference media is available."
  );

  if (evidence.hasRealPricingEvidence) {
    include(
      "pricing",
      "pricing.section_template",
      "pricing_packages",
      "hasRealPricingEvidence",
      "Real pricing/package evidence is present, so comparison card treatment is allowed.",
      pricingIntroGridSection(business)
    );
  } else {
    skip("pricing_packages", "hasRealPricingEvidence", "Skipped pricing/package comparison because no real pricing evidence was found.");
  }

  const processBlueprint = directorBlueprintById.get("process");
  const processPresentation = processPresentationForBusiness(business, deck, processBlueprint?.templateOptions?.stepTreatment ?? presentationPlan?.process);
  include(
    "process",
    "process.section_template",
    "process_steps",
    "serviceCount",
    business.vertical === "auto_body"
      ? "Auto-body pages include a compact repair-flow section so proof, inspection, timing, and pickup do not have to be implied by service cards."
      : processPresentation === "stepper_vertical"
        ? "Process renders as the full-width vertical stepper (axis pick, or the no-adjacent-duplicate-template rule when services use side_intro_rows)."
        : processPresentation === "checklist_cards"
          ? "Process renders as checklist cards for a less sequential expectation-setting rhythm."
        : processPresentation === "numbered_ledger"
          ? "Process renders as a full-width numbered ledger for a quieter editorial process rhythm."
        : "Process uses deterministic row geometry with vertical-specific steps.",
    processBlueprint?.templateId === "side_intro_rows" || processPresentation === "program_rows"
      ? processRowsSection(business, deck, processBlueprint?.background)
      : processStepperSection(business, deck, gallery, processPresentation, processBlueprint?.background)
  );

  // Guideline: when the source reveals a story (family-owned, founders,
  // mascots), it gets its own section — distinctiveness is conversion surface.
  const deterministicStory = autoBodyBusinessStoryForBusiness(business);
  if (deck?.about?.body || deterministicStory) {
    include("about", "about.section_template", "business_story", "recipe", "Source material revealed a business story; the about section presents it.", aboutStorySection(business, deck, deterministicStory));
  } else {
    skip("business_story", "recipe", "No business story was found in the source material.");
  }

  const mediaBlueprint = directorBlueprintById.get("media") ?? directorBlueprintById.get("gallery") ?? directorBlueprintById.get("proof");
  const requestedMediaTemplate = mediaBlueprint?.templateId;
  const requestedMediaSide = mediaBlueprint?.templateOptions?.mediaSide;
  if (business.vertical === "auto_body" && evidence.hasRepairReferenceMedia) {
    const contextDetailMedia = mediaItemsExcluding(
      gallery.filter((item) => !isAutoBodyProofMedia(item)),
      [gallery[0]?.url, ...galleryUsedByServices].filter((url): url is string => Boolean(url)),
      1
    );
    const fallbackProofMedia = normalizeMediaItems(gallery.filter(isAutoBodyProofMedia), 1);
    const proofPairMedia = selectAutoBodyRepairProofPairMedia(gallery.filter(isAutoBodyProofMedia));
    const repairDetailMedia = fallbackProofMedia.length ? fallbackProofMedia : contextDetailMedia;
    const directorRequestedReference = requestedMediaTemplate === "split_media" || requestedMediaTemplate === "media_feature";
    if (proofPairMedia.length >= 2 && !directorRequestedReference) {
      include(
        "media",
        "media.section_template",
        "before_after_media",
        "hasBeforeAfterProof",
        requestedMediaTemplate === "proof_pair"
          ? "SiteDirectorPlanV1 selected proof_pair and a distinct before/after repair media pair is available."
          : "A distinct before/after repair media pair is available, so the proof section renders a two-up comparison.",
        autoBodyBeforeAfterProofSection(business, proofPairMedia)
      );
    } else if (repairDetailMedia.length) {
      include(
        "media",
        "media.section_template",
        "repair_reference_media",
        "hasRepairReferenceMedia",
        directorRequestedReference
          ? `SiteDirectorPlanV1 selected ${requestedMediaTemplate}; source repair media is available, so the section renders repair reference imagery without before/after claims.`
          : "Source repair media is available, but no true before/after pair exists, so the section renders repair reference imagery without before/after claims.",
        autoBodyRepairReferenceSection(business, repairDetailMedia, requestedMediaSide)
      );
    } else {
      skip("repair_reference_media", "hasRepairReferenceMedia", "Skipped auto-body repair media because no safe source image was available for the proof section.");
    }
  } else if (evidence.safeMediaCount >= 4) {
    const mosaicGallery =
      business.vertical === "auto_body"
        ? mediaItemsExcluding(gallery, [gallery[0]?.url, gallery[1]?.url, ...galleryUsedByServices].filter((url): url is string => Boolean(url)), 3)
        : gallery;
    if (requestedMediaTemplate === "media_feature") {
      include(
        "gallery",
        "media.section_template",
        "media_feature",
        "safeMediaCount",
        "SiteDirectorPlanV1 selected media_feature; safe media is available, so the page uses one focused media statement instead of a mosaic.",
        mediaFeatureSection(business, mosaicGallery)
      );
    } else if (requestedMediaTemplate === "split_media") {
      include(
        "gallery",
        "story.section_template",
        "media_split",
        "safeMediaCount",
        "SiteDirectorPlanV1 selected split_media; safe media is available, so the page uses a focused split-media proof/story block.",
        splitMediaSection(business, mosaicGallery, requestedMediaSide ?? splitMediaSideForOccurrence(sections[0]?.variant === "hero_split" ? "hero_split" : "hero_statement", 1), deck)
      );
    } else {
      include(
        "gallery",
        "media.section_template",
        "media_gallery",
        "safeMediaCount",
        requestedMediaTemplate === "media_mosaic"
          ? "SiteDirectorPlanV1 selected media_mosaic and four or more safe media items are available."
          : "Four or more safe media items select media_mosaic.",
        mediaMosaicSection(business, mosaicGallery, deck)
      );
    }
  } else {
    skip("media_gallery", "safeMediaCount", "Skipped media_mosaic because fewer than four safe media items are available.");
  }

  if (evidence.safeMediaCount >= 2 && evidence.safeMediaCount <= 3) {
    if (business.vertical === "auto_body") {
      const excluded = [gallery[0]?.url, gallery[1]?.url, ...galleryUsedByServices].filter((url): url is string => Boolean(url)).map(mediaIdentityKey);
      const distinctFeatureGallery = normalizeMediaItems(
        gallery.filter((item) => !excluded.includes(mediaIdentityKey(item.url))),
        1
      );
      if (distinctFeatureGallery.length) {
        include(
          "media",
          "media.section_template",
          "media_feature",
          "safeMediaCount",
          "Two to three safe media items select media_feature with a distinct image from hero and proof sections.",
          mediaFeatureSection(business, distinctFeatureGallery)
        );
      } else {
        skip("media_feature", "safeMediaCount", "Skipped media_feature because no distinct auto-body media remained after hero/proof sections.");
      }
    } else {
      include(
        "media",
        requestedMediaTemplate === "split_media" ? "story.section_template" : "media.section_template",
        requestedMediaTemplate === "split_media" ? "media_split" : "media_feature",
        "safeMediaCount",
        requestedMediaTemplate === "split_media"
          ? "SiteDirectorPlanV1 selected split_media and two to three safe media items are available."
          : "Two to three safe media items select media_feature.",
        requestedMediaTemplate === "split_media"
          ? splitMediaSection(business, gallery, requestedMediaSide ?? "left", deck)
          : mediaFeatureSection(business, gallery)
      );
    }
  } else {
    skip("media_feature", "safeMediaCount", "Skipped media_feature because safe media count is outside the 2-3 range.");
  }

  if (evidence.hasQuoteProof) {
    include("testimonials", "proof.section_template", "testimonials", "hasQuoteProof", "Renderable testimonial/quote proof is present, so quote_wall is included.", quoteWallSection(business));
  } else {
    skip("testimonials", "hasQuoteProof", "Skipped quote_wall because no renderable testimonial/quote proof was found.");
  }

  include("faq", "faq.section_template", "faq", "serviceCount", "FAQ is required in every V3 recipe.", faqListSection(business, deck));

  // Conversion band before the closing sections: the brand-colored CTA moment.
  const conversionBackgroundUrl = media.kind === "media" ? media.conversionBackgroundUrl : undefined;
  const conversionBackgroundFocalPoint =
    media.kind === "media"
      ? media.conversionBackgroundFocalPoint ?? gallery.find((item) => item.url === media.conversionBackgroundUrl)?.focalPoint
      : undefined;
  include(
    "cta_band",
    "conversion.section_template",
    "conversion_band",
    "hasPhone",
    conversionBackgroundUrl
      ? "Approved generic category background gives the page a clear closing CTA before contact."
      : "Brand-colored conversion band gives the page a clear closing CTA before contact.",
    conversionBandSection(business, conversionBackgroundUrl, controls?.ctaBandTone, conversionBackgroundFocalPoint)
  );

  const locationBlueprint =
    directorBlueprintById.get("location") ??
    [...directorBlueprintById.values()].find((blueprint) => blueprint.role === "local");
  const requestedLocationTemplate = locationBlueprint?.templateId;
  const locationBackground = locationBlueprint?.background;
  if (locationContext.physicalLocations.length === 1) {
    include(
      "location",
      "local.section_template",
      "location_showcase",
      "hasLocationSection",
      requestedLocationTemplate === "location_showcase"
        ? "SiteDirectorPlanV1 selected location_showcase, and one address-bearing physical location supports it."
        : requestedLocationTemplate
          ? `SiteDirectorPlanV1 requested ${requestedLocationTemplate}, but one address-bearing physical location requires location_showcase.`
          : "One address-bearing physical location selects the destination-style location showcase.",
      locationShowcaseSection(business, locationContextForLocations(locationContext, locationContext.physicalLocations), deck, locationBackground)
    );
  } else if (locationContext.physicalLocations.length > 1) {
    include(
      "location",
      "local.section_template",
      "location_directory",
      "hasLocationSection",
      requestedLocationTemplate === "location_directory"
        ? "SiteDirectorPlanV1 selected location_directory, and multiple address-bearing physical locations support it."
        : requestedLocationTemplate
          ? `SiteDirectorPlanV1 requested ${requestedLocationTemplate}, but multiple address-bearing physical locations require location_directory.`
          : "Multiple address-bearing physical locations select a directory with links to generated location pages.",
      locationDirectorySection(business, locationContext, deck, locationBackground)
    );
  } else if (locationContext.serviceAreas.length) {
    include(
      "location",
      "local.section_template",
      "service_area_showcase",
      "hasLocationSection",
      requestedLocationTemplate === "service_area_showcase"
        ? "SiteDirectorPlanV1 selected service_area_showcase, and service-area facts support it."
        : requestedLocationTemplate
          ? `SiteDirectorPlanV1 requested ${requestedLocationTemplate}, but service-area facts without a physical address require service_area_showcase.`
          : "Coverage facts exist without a physical address, so the page uses a service-area showcase.",
      serviceAreaShowcaseSection(business, locationContext, deck, locationBackground)
    );
  } else {
    skip("location", "hasLocationSection", "Skipped location section because no address-bearing location or service-area facts were available.");
  }

  include("contact", "contact.section_template", "contact", "hasPhone", "Contact is required in every V3 recipe and normalizes sparse contact data.", contactSplitSection(business, locationContext, deck));

  // Grammar-bounded composition planning: a validated model plan reorders the
  // middle sections; anything invalid keeps the deterministic default order.
  let orderedSections = sections;
  if (plan) {
    const plannable = sections.map((section) => ({
      id: section.id,
      variant: section.variant,
      backgroundKey: backgroundKeyForSectionInstance(section)
    }));
    const normalizedPlan = normalizeCompositionPlanForBuiltSections(plan, plannable, {
      hasLocationSection: locationContext.hasLocationSection
    });
    if (normalizedPlan.repairs.length) {
      decisions.push({
        id: "composition_plan.repaired",
        status: "included",
        sectionRole: "composition_plan",
        evidenceSignal: "recipe",
        reason: `Model composition plan was mechanically repaired: ${normalizedPlan.repairs.join(" ")}`,
        selectedOptions: {
          original: plan.sections.map((entry) => entry.intent),
          repaired: normalizedPlan.plan.sections.map((entry) => entry.intent)
        }
      });
    }
    const planViolations = validateCompositionPlanV3(normalizedPlan.plan, plannable, { hasLocationSection: locationContext.hasLocationSection });
    if (planViolations.length) {
      decisions.push({
        id: "composition_plan.rejected",
        status: "skipped",
        sectionRole: "composition_plan",
        evidenceSignal: "recipe",
        reason: `Model composition plan rejected after repair; deterministic order kept. ${planViolations.join(" ")}`,
        skipReason: planViolations.join(" ")
      });
    } else {
      const applied = applyCompositionPlanV3(sections, normalizedPlan.plan);
      orderedSections = applied.sections;
      decisions.push({
        id: "composition_plan.applied",
        status: "included",
        sectionRole: "composition_plan",
        evidenceSignal: "recipe",
        reason: `Model composition plan applied: ${normalizedPlan.plan.sections.map((entry) => entry.intent).join(" → ")}.`,
        selectedOptions: { dropped: applied.dropped }
      });
      for (const droppedId of applied.dropped) {
        decisions.push({
          id: `${droppedId}.excluded_by_plan`,
          status: "skipped",
          sectionRole: droppedId,
          evidenceSignal: "recipe",
          reason: `Section "${droppedId}" was built but excluded by the accepted composition plan.`,
          skipReason: "excluded_by_composition_plan"
        });
      }
    }
  } else if (business.vertical === "auto_body") {
    const composition = autoBodySeededCompositionSections(sections, business.siteId);
    orderedSections = composition.sections;
    decisions.push({
      id: "composition.auto_body_seeded",
      status: "included",
      sectionRole: "composition_plan",
      evidenceSignal: "recipe",
      reason: `Auto-body deterministic composition variant ${composition.variant} applied so same-vertical sites do not share one section skeleton.`,
      selectedOptions: { variant: composition.variant, dropped: composition.dropped, order: orderedSections.map((section) => section.id) }
    });
  }
  if (business.vertical === "auto_body") {
    orderedSections = removeAutoBodyStandaloneCtaBand(orderedSections);
  }

  return {
    sections: orderedSections,
    report: {
      version: "generated-site-v3-composition-report-v1",
      selectedRecipe: recipeId,
      recipeSelection: {
        selectedRecipe: recipeId,
        reason: `${recipeId} selected for the ${business.vertical} vertical.`,
        signals: [
          business.vertical,
          deck ? "generated_copy_deck" : "deterministic_copy_fallback",
          evidence.hasSafeHeroMedia ? "safe_hero_media" : "no_safe_hero_media",
          `${evidence.serviceCount}_services`,
          `${evidence.safeMediaCount}_safe_media`
        ]
      },
      evidence,
      decisions
    }
  };
}

function v3PageSectionsFromDirectorBlueprints(input: {
  business: BusinessProfile;
  media: SelectedV3Media;
  locationContext: LocationCompileContextV3;
  deck?: GeneratedCopyDeckV2;
  overrides?: GeneratedSiteV3CompilerOverrides;
  controls?: DesignControlsV3;
  presentationPlan?: SectionPresentationMapV3;
  recipeId: GeneratedSiteV3RecipeId;
  services: StandardItemV3[];
  gallery: Array<{ url: string; label: string }>;
  evidence: GeneratedSiteV3EvidenceSignals;
  directorBlueprints: readonly SectionBlueprintV1[];
  designArchetype?: GeneratedSiteDesignArchetypeV1;
}): V3Composition {
  const decisions: GeneratedSiteV3CompositionDecision[] = [
    {
      id: `recipe.${input.recipeId}`,
      status: "included",
      sectionRole: "recipe",
      evidenceSignal: "recipe",
      reason: `${input.recipeId} still supplies hydration rules, but the accepted SiteDirectorPlanV1 owns the home-page blueprint sequence.`,
      selectedOptions: { recipeId: input.recipeId, planningAuthority: "site_director" }
    },
    {
      id: "site_director.blueprints_applied",
      status: "included",
      sectionRole: "site_director",
      evidenceSignal: "recipe",
      reason: `Accepted SiteDirectorPlanV1 blueprint order is the source of truth: ${input.directorBlueprints.map((blueprint) => blueprint.id).join(" → ")}.`,
      selectedOptions: {
        order: input.directorBlueprints.map((blueprint) => blueprint.id),
        templates: input.directorBlueprints.map((blueprint) => ({ id: blueprint.id, templateId: blueprint.templateId, role: blueprint.role }))
      }
    }
  ];
  const sections: SectionInstanceV3[] = [];
  const includedIds = new Set<string>();

  const visibleServiceCount = input.services.length >= 4 ? Math.min(input.services.length, 6) : Math.min(input.services.length, 3);
  const serviceBlueprint = input.directorBlueprints.find((blueprint) => blueprint.role === "services" || blueprint.id === "services");
  const serviceGallery = directorGalleryForBlueprintV1(
    input.business,
    serviceBlueprint,
    serviceThumbnailGalleryForBusiness(input.business, input.gallery, visibleServiceCount),
    visibleServiceCount,
    ["media"]
  );
  const allowAutoBodyServiceMedia = input.business.vertical !== "auto_body" || serviceGallery.length >= visibleServiceCount;
  const servicesWithMedia = allowAutoBodyServiceMedia ? servicesWithCompleteMedia(input.services, serviceGallery, visibleServiceCount) : input.services;
  const galleryUsedByServices = servicesWithMedia.flatMap((item) => (item.mediaUrl ? [item.mediaUrl] : []));
  const hasFullServiceIndexBlueprint =
    input.services.length >= 4 &&
    input.directorBlueprints.some(
      (blueprint) => blueprint.templateId === "service_index" && (blueprint.role === "services" || blueprint.id === "service_index" || blueprint.anchorId === "services")
    );

  const include = (
    blueprint: SectionBlueprintV1,
    family: string,
    evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"],
    reason: string,
    section: VisualSectionV3,
    selectedOptions?: Record<string, unknown>
  ) => {
    if (includedIds.has(blueprint.id)) {
      decisions.push({
        id: `site_director.${blueprint.id}.duplicate_skipped`,
        status: "skipped",
        sectionRole: blueprint.role,
        evidenceSignal: "recipe",
        reason: `Duplicate SiteDirectorPlanV1 section id "${blueprint.id}" was skipped; section ids must be unique in the rendered page.`,
        skipReason: "duplicate_site_director_section_id"
      });
      return;
    }
    includedIds.add(blueprint.id);
    const resolvedSection = sectionWithBlueprintBackgroundV1(section, blueprint);
    const optionDeltas = templateOptionDeltasForDecisionV1(blueprint, resolvedSection);
    sections.push(visualSection(blueprint.id, family, resolvedSection));
    decisions.push({
      id: `site_director.${blueprint.id}.included`,
      status: "included",
      sectionRole: blueprint.role,
      evidenceSignal,
      reason,
      selectedTemplateId: resolvedSection.templateId,
      selectedOptions: {
        requestedTemplateId: blueprint.templateId,
        requestedRole: blueprint.role,
        requestedBackground: backgroundIdentityForDecisionV1(blueprint.background),
        requestedTemplateOptions: blueprint.templateOptions,
        renderedTemplateOptions: renderedTemplateOptionsForDecisionV1(blueprint, resolvedSection),
        ctaRole: blueprint.ctaRole,
        copyJob: blueprint.copyJob,
        copyJobId: blueprint.copyJobId,
        ...selectedOptions
      }
    });
    for (const delta of optionDeltas) {
      decisions.push({
        id: `site_director.${blueprint.id}.${delta.optionName}.clamped`,
        status: "included",
        sectionRole: blueprint.role,
        evidenceSignal: "recipe",
        reason: `SiteDirectorPlanV1 requested ${blueprint.templateId}.${delta.optionName}=${delta.requestedValue}; the compiler rendered ${String(delta.renderedValue)} because ${delta.reason}.`,
        selectedTemplateId: resolvedSection.templateId,
        selectedOptions: {
          requestedTemplateId: blueprint.templateId,
          renderedTemplateId: resolvedSection.templateId,
          optionName: delta.optionName,
          requestedValue: delta.requestedValue,
          renderedValue: delta.renderedValue,
          reason: delta.reason
        }
      });
    }
  };

  const skip = (
    blueprint: SectionBlueprintV1,
    evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"],
    reason: string,
    skipReason: string
  ) => {
    decisions.push({
      id: `site_director.${blueprint.id}.skipped`,
      status: "skipped",
      sectionRole: blueprint.role,
      evidenceSignal,
      reason,
      selectedTemplateId: blueprint.templateId,
      skipReason
    });
  };

  for (const blueprint of input.directorBlueprints) {
    switch (blueprint.templateId) {
      case "hero_split": {
        const heroGallery = directorGalleryForBlueprintV1(input.business, blueprint, input.gallery, 3, ["media", "background"]);
        if (heroGallery.length) {
          include(
            blueprint,
            "hero.section_template",
            "hasSafeHeroMedia",
            "SiteDirectorPlanV1 selected hero_split; safe media is available, so the split hero renders in model order.",
            heroSplitSection(input.business, heroGallery, input.deck, input.overrides?.heroPrimaryCta, blueprint.templateOptions)
          );
        } else {
          include(
            blueprint,
            "hero.section_template",
            "hasSafeHeroMedia",
            "SiteDirectorPlanV1 selected hero_split, but no safe hero media is available; repaired to the text-led hero_statement geometry.",
            heroStatementSection(input.business, input.deck, input.overrides?.heroPrimaryCta, blueprint.templateOptions?.heroAlign ?? "left", blueprint.templateOptions),
            { repair: "hero_split_without_media_to_hero_statement" }
          );
        }
        break;
      }
      case "hero_statement": {
        const heroBackgroundAsset = directorAssetForBlueprintV1(input.business, blueprint, ["background", "media"]);
        include(
          blueprint,
          "hero.section_template",
          heroBackgroundAsset ? "hasSafeHeroMedia" : "recipe",
          heroBackgroundAsset
            ? "SiteDirectorPlanV1 selected hero_statement with an explicit background asset; the compiler hydrates the requested image statement hero."
            : "SiteDirectorPlanV1 selected hero_statement; the compiler hydrates it without seed-picked hero-family rotation.",
          heroBackgroundAsset
            ? heroImageStatementSection(input.business, heroBackgroundAsset.url, input.deck, input.overrides?.heroPrimaryCta, blueprint.templateOptions, heroBackgroundAsset.focalPoint)
            : heroStatementSection(input.business, input.deck, input.overrides?.heroPrimaryCta, blueprint.templateOptions?.heroAlign ?? "left", blueprint.templateOptions)
        );
        break;
      }
      case "facts_strip": {
        const facts = proofFactsForBusiness(input.business);
        if (facts.length >= 3) {
          include(blueprint, "proof.section_template", "hasCredentialTrustProof", "SiteDirectorPlanV1 selected facts_strip and at least three grounded facts are available.", factsStripSection(input.business));
        } else {
          skip(blueprint, "hasCredentialTrustProof", "SiteDirectorPlanV1 selected facts_strip, but fewer than three grounded facts are available.", "insufficient_facts_for_facts_strip");
        }
        break;
      }
      case "facts_cta": {
        const facts = proofFactsForBusiness(input.business);
        if (facts.length >= 3) {
          include(blueprint, "proof.section_template", "hasCredentialTrustProof", "SiteDirectorPlanV1 selected facts_cta and grounded facts are available.", factsCtaSection(input.business, blueprint.background));
        } else {
          skip(blueprint, "hasCredentialTrustProof", "SiteDirectorPlanV1 selected facts_cta, but fewer than three grounded facts are available.", "insufficient_facts_for_facts_cta");
        }
        break;
      }
      case "stat_band": {
        const facts = proofFactsForBusiness(input.business);
        if (facts.length) {
          include(blueprint, "proof.section_template", "hasCredentialTrustProof", "SiteDirectorPlanV1 selected stat_band and a grounded fact is available.", statBandSection(input.business, blueprint.background));
        } else {
          skip(blueprint, "hasCredentialTrustProof", "SiteDirectorPlanV1 selected stat_band, but no grounded fact is available.", "insufficient_facts_for_stat_band");
        }
        break;
      }
      case "intro_grid": {
        if (blueprint.role === "pricing" || blueprint.id === "pricing") {
          if (input.evidence.hasRealPricingEvidence) {
            include(blueprint, "pricing.section_template", "hasRealPricingEvidence", "SiteDirectorPlanV1 selected a pricing intro_grid and real pricing evidence is available.", pricingIntroGridSection(input.business));
          } else {
            skip(blueprint, "hasRealPricingEvidence", "SiteDirectorPlanV1 selected pricing intro_grid, but no real pricing/package evidence was found.", "insufficient_pricing_evidence");
          }
          break;
        }
        if (hasFullServiceIndexBlueprint && (blueprint.role === "services" || blueprint.id === "services" || blueprint.anchorId === "services")) {
          skip(
            blueprint,
            "serviceCount",
            "SiteDirectorPlanV1 selected both an intro_grid service-card list and a full service_index for the same large service set; the compiler kept service_index and dropped the duplicate card list.",
            "duplicate_service_list_with_service_index"
          );
          break;
        }
        if (input.services.length >= 4) {
          include(
            blueprint,
            "services.section_template",
            "serviceCount",
            "SiteDirectorPlanV1 selected intro_grid for services; the service grid hydrates with the requested presentation and card treatment.",
            serviceCardGridSection(
              input.business,
              servicesWithMedia,
              input.deck,
              servicePresentationForBlueprintV1(blueprint, input.presentationPlan),
              blueprint.templateOptions?.cardTreatment ?? "service_cards",
              blueprint.background,
              blueprint.templateOptions
            )
          );
        } else {
          include(
            blueprint,
            "services.section_template",
            "serviceCount",
            "SiteDirectorPlanV1 selected intro_grid for a compact service/highlight section.",
            introGridSection(
              input.business,
              servicesWithMedia,
              blueprint.templateOptions?.cardTreatment ?? "service_cards",
              input.deck,
              blueprint.background,
              blueprint.templateOptions
            )
          );
        }
        break;
      }
      case "side_intro_rows": {
        if (blueprint.role === "process" || blueprint.id === "process") {
          include(blueprint, "process.section_template", "serviceCount", "SiteDirectorPlanV1 selected side_intro_rows for process.", processRowsSection(input.business, input.deck, blueprint.background));
        } else if (hasFullServiceIndexBlueprint && (blueprint.role === "services" || blueprint.id === "services" || blueprint.anchorId === "services")) {
          skip(
            blueprint,
            "serviceCount",
            "SiteDirectorPlanV1 selected both side_intro_rows service rows and a full service_index for the same large service set; the compiler kept service_index and dropped the duplicate service rows.",
            "duplicate_service_list_with_service_index"
          );
        } else if (input.services.length >= 3) {
          include(blueprint, "services.section_template", "serviceCount", "SiteDirectorPlanV1 selected side_intro_rows for services.", serviceRowsSection(input.business, servicesWithMedia, input.deck, blueprint.background));
        } else {
          skip(blueprint, "serviceCount", "SiteDirectorPlanV1 selected side_intro_rows, but fewer than three service/process items are available.", "insufficient_items_for_side_intro_rows");
        }
        break;
      }
      case "numbered_steps": {
        include(
          blueprint,
          "process.section_template",
          "serviceCount",
          "SiteDirectorPlanV1 selected numbered_steps; step treatment comes from the blueprint, not seeded process rotation.",
          processStepperSection(input.business, input.deck, input.gallery, blueprint.templateOptions?.stepTreatment ?? "stepper_vertical", blueprint.background, blueprint.templateOptions)
        );
        break;
      }
      case "feature_band": {
        if (blueprint.role === "conversion" || blueprint.id === "cta_band") {
          const conversionBackgroundAsset = directorAssetForBlueprintV1(input.business, blueprint, ["background", "media"]);
          include(
            blueprint,
            "conversion.section_template",
            "hasPhone",
            "SiteDirectorPlanV1 selected feature_band for the conversion moment; deterministic copy/claim safety hydrates the CTA.",
            conversionBandSection(
              input.business,
              conversionBackgroundAsset?.url,
              input.controls?.ctaBandTone,
              conversionBackgroundAsset?.focalPoint
            )
          );
        } else {
          const facts = proofFactsForBusiness(input.business);
          if (facts.length >= 3) {
            include(blueprint, "feature.section_template", "hasCredentialTrustProof", "SiteDirectorPlanV1 selected feature_band and grounded proof facts are available.", genericFeatureBandSection(input.business, blueprint.background));
          } else {
            skip(blueprint, "hasCredentialTrustProof", "SiteDirectorPlanV1 selected feature_band, but not enough grounded facts are available.", "insufficient_facts_for_feature_band");
          }
        }
        break;
      }
      case "split_media": {
        const fallbackMediaItems = mediaItemsExcluding(
          input.gallery,
          [input.gallery[0]?.url, ...galleryUsedByServices].filter((url): url is string => Boolean(url)),
          1
        );
        const mediaItems = directorGalleryForBlueprintV1(input.business, blueprint, fallbackMediaItems, 1, ["media"]);
        if (mediaItems.length) {
          include(
            blueprint,
            blueprint.role === "story" ? "story.section_template" : "media.section_template",
            "safeMediaCount",
            "SiteDirectorPlanV1 selected split_media and safe media is available.",
            splitMediaSection(input.business, mediaItems, blueprint.templateOptions?.mediaSide ?? "left", input.deck, blueprint.templateOptions)
          );
        } else {
          skip(blueprint, "safeMediaCount", "SiteDirectorPlanV1 selected split_media, but no distinct safe media remained for this section.", "insufficient_media_for_split_media");
        }
        break;
      }
      case "proof_pair": {
        const proofPairMedia = selectAutoBodyRepairProofPairMedia(
          directorGalleryForBlueprintV1(input.business, blueprint, input.gallery, 6, ["media"]).filter(isAutoBodyProofMedia)
        );
        if (proofPairMedia.length >= 2) {
          include(blueprint, "proof.section_template", "hasBeforeAfterProof", "SiteDirectorPlanV1 selected proof_pair and a distinct before/after repair media pair is available.", autoBodyBeforeAfterProofSection(input.business, proofPairMedia));
        } else {
          skip(blueprint, "hasBeforeAfterProof", "SiteDirectorPlanV1 selected proof_pair, but no distinct before/after media pair is available.", "insufficient_before_after_media_for_proof_pair");
        }
        break;
      }
      case "media_feature": {
        const fallbackMediaItems = mediaItemsExcluding(
          input.gallery,
          [input.gallery[0]?.url, ...galleryUsedByServices].filter((url): url is string => Boolean(url)),
          1
        );
        const mediaItems = directorGalleryForBlueprintV1(input.business, blueprint, fallbackMediaItems, 1, ["media"]);
        if (mediaItems.length) {
          include(blueprint, "media.section_template", "safeMediaCount", "SiteDirectorPlanV1 selected media_feature and safe media is available.", mediaFeatureSection(input.business, mediaItems));
        } else {
          skip(blueprint, "safeMediaCount", "SiteDirectorPlanV1 selected media_feature, but no distinct safe media is available.", "insufficient_media_for_media_feature");
        }
        break;
      }
      case "media_mosaic": {
        const fallbackMediaItems = mediaItemsExcluding(
          input.gallery,
          [input.gallery[0]?.url, ...galleryUsedByServices].filter((url): url is string => Boolean(url)),
          3
        );
        const mediaItems = directorGalleryForBlueprintV1(input.business, blueprint, fallbackMediaItems, 3, ["media"]);
        if (mediaItems.length >= 3) {
          include(blueprint, "media.section_template", "safeMediaCount", "SiteDirectorPlanV1 selected media_mosaic and at least three safe media items are available.", mediaMosaicSection(input.business, mediaItems, input.deck, blueprint.templateOptions));
        } else {
          skip(blueprint, "safeMediaCount", "SiteDirectorPlanV1 selected media_mosaic, but fewer than three safe media items are available.", "insufficient_media_for_media_mosaic");
        }
        break;
      }
      case "eligibility_band": {
        const facts = proofFactsForBusiness(input.business).slice(0, 6);
        if (facts.length >= 2) {
          include(blueprint, "proof.section_template", "hasCredentialTrustProof", "SiteDirectorPlanV1 selected eligibility_band and grounded proof facts are available.", eligibilityBandSection(input.business, input.deck, facts, blueprint.templateOptions, blueprint.background));
        } else {
          skip(blueprint, "hasCredentialTrustProof", "SiteDirectorPlanV1 selected eligibility_band, but fewer than two grounded facts are available.", "insufficient_facts_for_eligibility_band");
        }
        break;
      }
      case "service_index": {
        if (input.services.length >= 4) {
          include(blueprint, "services.section_template", "serviceCount", "SiteDirectorPlanV1 selected service_index for a larger service set.", serviceIndexSection(input.business, servicesWithMedia, input.deck, blueprint.templateOptions, blueprint.background));
        } else {
          skip(blueprint, "serviceCount", "SiteDirectorPlanV1 selected service_index, but fewer than four service items are available.", "insufficient_services_for_service_index");
        }
        break;
      }
      case "case_study_preview": {
        const proofMedia = directorGalleryForBlueprintV1(input.business, blueprint, input.gallery, 3, ["media"]);
        if (proofMedia.length) {
          include(blueprint, "proof.section_template", "safeMediaCount", "SiteDirectorPlanV1 selected case_study_preview and safe media is available.", caseStudyPreviewSection(input.business, proofMedia, input.deck, blueprint.templateOptions, blueprint.background));
        } else {
          skip(blueprint, "safeMediaCount", "SiteDirectorPlanV1 selected case_study_preview, but no safe media is available.", "insufficient_media_for_case_study_preview");
        }
        break;
      }
      case "comparison_table": {
        const comparisonItems = dedupeStandardItems(input.services).slice(0, 6);
        if (comparisonItems.length >= 2) {
          include(blueprint, "feature.section_template", "serviceCount", "SiteDirectorPlanV1 selected comparison_table and enough differentiated entries are available.", comparisonTableSection(input.business, comparisonItems, input.deck, blueprint.templateOptions, blueprint.background));
        } else {
          skip(blueprint, "serviceCount", "SiteDirectorPlanV1 selected comparison_table, but fewer than two comparison entries are available.", "insufficient_items_for_comparison_table");
        }
        break;
      }
      case "team_story": {
        const storyMedia = directorGalleryForBlueprintV1(input.business, blueprint, input.gallery, 1, ["media"]);
        include(blueprint, "about.section_template", "recipe", "SiteDirectorPlanV1 selected team_story for business story/proof.", teamStorySection(input.business, storyMedia, input.deck, blueprint.templateOptions, blueprint.background));
        break;
      }
      case "offer_band": {
        include(blueprint, "conversion.section_template", "hasPhone", "SiteDirectorPlanV1 selected offer_band for a source-safe conversion moment.", offerBandSection(input.business, input.deck, blueprint.templateOptions, blueprint.background));
        break;
      }
      case "quote_wall": {
        if (input.evidence.hasQuoteProof) {
          include(blueprint, "proof.section_template", "hasQuoteProof", "SiteDirectorPlanV1 selected quote_wall and renderable quote proof is present.", quoteWallSection(input.business));
        } else {
          skip(blueprint, "hasQuoteProof", "SiteDirectorPlanV1 selected quote_wall, but no renderable quote proof was found.", "insufficient_quote_proof");
        }
        break;
      }
      case "faq_list": {
        include(blueprint, "faq.section_template", "serviceCount", "SiteDirectorPlanV1 selected faq_list.", faqListSection(input.business, input.deck));
        break;
      }
      case "editorial_statement": {
        const deterministicStory = autoBodyBusinessStoryForBusiness(input.business);
        if (blueprint.id === "about" || blueprint.role === "story") {
          include(blueprint, "about.section_template", "recipe", "SiteDirectorPlanV1 selected editorial_statement for business story/about copy.", aboutStorySection(input.business, input.deck, deterministicStory));
        } else if (blueprint.role === "conversion" || blueprint.id === "cta_band") {
          include(blueprint, "conversion.section_template", "hasPhone", "SiteDirectorPlanV1 selected editorial_statement for a conversion break.", editorialStatementSection(input.business));
        } else {
          include(blueprint, "statement.section_template", "recipe", "SiteDirectorPlanV1 selected editorial_statement.", editorialStatementSection(input.business));
        }
        break;
      }
      case "location_showcase":
      case "location_directory":
      case "service_area_showcase": {
        hydrateDirectorLocationBlueprintV1({ ...input, blueprint, include, skip });
        break;
      }
      case "contact_split": {
        include(blueprint, "contact.section_template", "hasPhone", "SiteDirectorPlanV1 selected contact_split.", contactSplitSection(input.business, input.locationContext, input.deck, { templateOptions: blueprint.templateOptions }));
        break;
      }
      default:
        skip(blueprint, "recipe", `SiteDirectorPlanV1 selected ${blueprint.templateId}, but this compiler does not yet have a hydrator for that template.`, "missing_director_hydrator");
        break;
    }
  }

  return {
    sections,
    report: {
      version: "generated-site-v3-composition-report-v1",
      selectedRecipe: input.recipeId,
      recipeSelection: {
        selectedRecipe: input.recipeId,
        reason: `${input.recipeId} selected for hydration constraints; SiteDirectorPlanV1 controls the rendered home section sequence.`,
        signals: [
          input.business.vertical,
          input.deck ? "generated_copy_deck" : "deterministic_copy_fallback",
          input.evidence.hasSafeHeroMedia ? "safe_hero_media" : "no_safe_hero_media",
          `${input.evidence.serviceCount}_services`,
          `${input.evidence.safeMediaCount}_safe_media`,
          "site_director_blueprint_sequence"
        ]
      },
      evidence: input.evidence,
      decisions
    }
  };
}

function hydrateDirectorLocationBlueprintV1(input: {
  business: BusinessProfile;
  locationContext: LocationCompileContextV3;
  deck?: GeneratedCopyDeckV2;
  blueprint: SectionBlueprintV1;
  include: (
    blueprint: SectionBlueprintV1,
    family: string,
    evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"],
    reason: string,
    section: VisualSectionV3,
    selectedOptions?: Record<string, unknown>
  ) => void;
  skip: (
    blueprint: SectionBlueprintV1,
    evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"],
    reason: string,
    skipReason: string
  ) => void;
}) {
  const requestedLocationTemplate = input.blueprint.templateId;
  const locationBackground = input.blueprint.background;
  if (input.locationContext.physicalLocations.length === 1) {
    input.include(
      input.blueprint,
      "local.section_template",
      "hasLocationSection",
      requestedLocationTemplate === "location_showcase"
        ? "SiteDirectorPlanV1 selected location_showcase, and one address-bearing physical location supports it."
        : `SiteDirectorPlanV1 selected ${requestedLocationTemplate}, but one address-bearing physical location requires location_showcase; repaired mechanically.`,
      locationShowcaseSection(input.business, locationContextForLocations(input.locationContext, input.locationContext.physicalLocations), input.deck, locationBackground, input.blueprint.templateOptions),
      requestedLocationTemplate === "location_showcase" ? undefined : { repair: `${requestedLocationTemplate}_to_location_showcase` }
    );
  } else if (input.locationContext.physicalLocations.length > 1) {
    input.include(
      input.blueprint,
      "local.section_template",
      "hasLocationSection",
      requestedLocationTemplate === "location_directory"
        ? "SiteDirectorPlanV1 selected location_directory, and multiple address-bearing physical locations support it."
        : `SiteDirectorPlanV1 selected ${requestedLocationTemplate}, but multiple address-bearing physical locations require location_directory; repaired mechanically.`,
      locationDirectorySection(input.business, input.locationContext, input.deck, locationBackground),
      requestedLocationTemplate === "location_directory" ? undefined : { repair: `${requestedLocationTemplate}_to_location_directory` }
    );
  } else if (input.locationContext.serviceAreas.length) {
    input.include(
      input.blueprint,
      "local.section_template",
      "hasLocationSection",
      requestedLocationTemplate === "service_area_showcase"
        ? "SiteDirectorPlanV1 selected service_area_showcase, and service-area facts support it."
        : `SiteDirectorPlanV1 selected ${requestedLocationTemplate}, but service-area facts without a physical address require service_area_showcase; repaired mechanically.`,
      serviceAreaShowcaseSection(input.business, input.locationContext, input.deck, locationBackground),
      requestedLocationTemplate === "service_area_showcase" ? undefined : { repair: `${requestedLocationTemplate}_to_service_area_showcase` }
    );
  } else {
    input.skip(input.blueprint, "hasLocationSection", `SiteDirectorPlanV1 selected ${requestedLocationTemplate}, but no address-bearing location or service-area facts are available.`, "insufficient_location_evidence");
  }
}

function directorAssetForBlueprintV1(
  business: BusinessProfile,
  blueprint: SectionBlueprintV1 | undefined,
  slots: Array<"media" | "background" | "logo">
): SiteMediaItemV3 | undefined {
  return directorGalleryForBlueprintV1(business, blueprint, [], 1, slots)[0];
}

function directorGalleryForBlueprintV1(
  business: BusinessProfile,
  blueprint: SectionBlueprintV1 | undefined,
  fallbackGallery: SiteMediaItemV3[],
  count: number,
  slots: Array<"media" | "background" | "logo">
): SiteMediaItemV3[] {
  const directorItems = directorAssetItemsForBlueprintV1(business, blueprint, slots, fallbackGallery);
  return normalizeMediaItems([...directorItems, ...fallbackGallery], count);
}

function directorAssetItemsForBlueprintV1(
  business: BusinessProfile,
  blueprint: SectionBlueprintV1 | undefined,
  slots: Array<"media" | "background" | "logo">,
  admittedGallery: SiteMediaItemV3[]
): SiteMediaItemV3[] {
  if (!blueprint?.assetRefs?.length) return [];
  const allowedSlots = new Set(slots);
  const photosById = new Map(business.photos.map((asset) => [asset.id, asset]));
  const admittedAssetKeys = new Set(admittedGallery.map((item) => mediaIdentityKey(item.url)));
  return blueprint.assetRefs.flatMap((assetRef) => {
    if (!allowedSlots.has(assetRef.slot)) return [];
    if (assetRef.slot === "logo") return [];
    const asset = photosById.get(assetRef.assetId);
    if (!asset) return [];
    if (isLikelyLogoOnlyMedia(asset, business)) return [];
    if (!isPublicSafeMedia(asset) && !admittedAssetKeys.has(mediaIdentityKey(asset.url))) return [];
    return [{
      url: asset.url,
      label: asset.alt || "Business photo",
      focalPoint: focalPointForAssetCropIntentV1(asset, assetRef.cropIntent),
      cropIntent: assetRef.cropIntent
    }];
  });
}

function focalPointForAssetCropIntentV1(
  asset: AssetReference,
  cropIntent: SiteMediaCropIntentV3 | undefined
): BackgroundFocalPointV3 {
  if (cropIntent === "center" || cropIntent === "wide") return "center";
  if (cropIntent === "portrait") return "top";
  if (asset.analysisV1?.version === "asset-analysis-v1") return asset.analysisV1.focalPoint;
  return focalPointForAssetContentV1(asset);
}

function cropIntentForBusinessPhotoV1(asset: AssetReference): SiteMediaCropIntentV3 {
  if (asset.analysisV1?.version === "asset-analysis-v1") {
    return cropIntentFromAssetAnalysisV1(asset.analysisV1.recommendedCropIntent);
  }
  if (asset.width && asset.height) {
    const ratio = asset.width / asset.height;
    if (ratio >= 1.45) return "wide";
    if (ratio <= 0.85) return "portrait";
  }
  const text = mediaTextForAssetV1(asset);
  if (/\b(before|after|finished|proof|scratch|dent|chip|detail|closeup|close-up|panel|bumper|fender|door|glass)\b/i.test(text)) {
    return "subject";
  }
  return "center";
}

function focalPointForAssetContentV1(asset: AssetReference): BackgroundFocalPointV3 {
  if (asset.analysisV1?.version === "asset-analysis-v1") return asset.analysisV1.focalPoint;
  const text = mediaTextForAssetV1(asset);
  if (/\b(left|driver)\b/i.test(text)) return "left";
  if (/\b(right|passenger)\b/i.test(text)) return "right";
  if (/\b(bumper|valance|rocker|wheel|tire|floor|lower)\b/i.test(text)) return "bottom";
  if (/\b(windshield|hood|roof|sign|storefront|team|owner|face|person|people|logo)\b/i.test(text)) return "top";
  if (asset.width && asset.height && asset.width / asset.height < 0.85) return "top";
  return "center";
}

function cropIntentFromAssetAnalysisV1(intent: NonNullable<AssetReference["analysisV1"]>["recommendedCropIntent"]): SiteMediaCropIntentV3 {
  if (intent === "detail_zoom") return "subject";
  return intent;
}

function mediaTextForAssetV1(asset: AssetReference): string {
  return `${asset.id} ${asset.url} ${asset.alt}`;
}

function focalPointForMediaItemsV1(items: SiteMediaItemV3[]): BackgroundFocalPointV3 {
  return items.find((item) => item.focalPoint)?.focalPoint ?? "center";
}

function sectionWithBlueprintBackgroundV1(section: VisualSectionV3, blueprint: SectionBlueprintV1): VisualSectionV3 {
  const presentation = blueprint.presentation && Object.keys(blueprint.presentation).length ? blueprint.presentation : section.presentation;
  if (!blueprint.background || blueprint.background.kind === "image") {
    return presentation ? ({ ...section, presentation } as VisualSectionV3) : section;
  }
  return {
    ...section,
    ...(presentation ? { presentation } : {}),
    options: {
      ...section.options,
      background: blueprint.background
    }
  } as VisualSectionV3;
}

function servicePresentationForBlueprintV1(
  blueprint: SectionBlueprintV1,
  presentationPlan?: SectionPresentationMapV3
): SectionPresentationMapV3["services"] {
  return (blueprint.presentation?.services ?? presentationPlan?.services) as SectionPresentationMapV3["services"];
}

function backgroundIdentityForDecisionV1(background: SectionBlueprintV1["background"]) {
  if (!background) return undefined;
  return background.kind === "image" ? "image" : `${background.kind}:${background.token}`;
}

function renderedTemplateOptionsForDecisionV1(
  blueprint: SectionBlueprintV1,
  section: VisualSectionV3
): Record<string, unknown> | undefined {
  const templateOptions = blueprint.templateOptions;
  if (!templateOptions) return undefined;
  const rendered: Record<string, unknown> = {};
  for (const optionName of Object.keys(templateOptions)) {
    const renderedValue = renderedTemplateOptionValueForDecisionV1(section, optionName);
    if (renderedValue !== undefined) rendered[optionName] = renderedValue;
  }
  return Object.keys(rendered).length ? rendered : undefined;
}

function templateOptionDeltasForDecisionV1(
  blueprint: SectionBlueprintV1,
  section: VisualSectionV3
): Array<{ optionName: string; requestedValue: unknown; renderedValue: unknown; reason: string }> {
  const templateOptions = blueprint.templateOptions;
  if (!templateOptions) return [];
  const deltas: Array<{ optionName: string; requestedValue: unknown; renderedValue: unknown; reason: string }> = [];
  for (const [optionName, requestedValue] of Object.entries(templateOptions)) {
    if (requestedValue === undefined) continue;
    const renderedValue = renderedTemplateOptionValueForDecisionV1(section, optionName);
    if (renderedValue === undefined || String(renderedValue) === String(requestedValue)) continue;
    deltas.push({
      optionName,
      requestedValue,
      renderedValue,
      reason: templateOptionClampReasonForDecisionV1(blueprint.templateId, section.templateId, optionName, requestedValue, renderedValue)
    });
  }
  return deltas;
}

function renderedTemplateOptionValueForDecisionV1(section: VisualSectionV3, optionName: string): unknown {
  const options = section.options as Record<string, unknown>;
  if (optionName === "heroAlign") return options.align;
  return options[optionName];
}

function templateOptionClampReasonForDecisionV1(
  requestedTemplateId: SectionTemplateIdV3,
  renderedTemplateId: SectionTemplateIdV3,
  optionName: string,
  requestedValue: unknown,
  renderedValue: unknown
) {
  if (requestedTemplateId !== renderedTemplateId) {
    return `the requested template was repaired to ${renderedTemplateId} before template options were applied`;
  }
  if (requestedTemplateId === "hero_statement" && optionName === "heroLayout" && requestedValue === "full_bleed_masthead" && renderedValue === "card_overlay") {
    return "full_bleed_masthead requires an image-backed hero_statement";
  }
  if (requestedTemplateId === "hero_statement" && optionName === "proofPlacement" && requestedValue === "side_panel" && renderedValue === "bottom_strip") {
    return "side_panel proof is incompatible with a non-image full-bleed hero repair";
  }
  if ((requestedTemplateId === "hero_split" || requestedTemplateId === "hero_statement") && optionName === "headlineScale" && requestedValue === "display" && renderedValue === "standard") {
    return "display headline scale is unsafe for long hero headings because it can push the primary CTA below the fold";
  }
  if ((requestedTemplateId === "hero_split" || requestedTemplateId === "hero_statement") && optionName === "ctaLayout" && requestedValue === "stacked" && renderedValue === "button_plus_text_link") {
    return "stacked hero CTAs are unsafe with long media-heavy heroes because the primary CTA can fall below the fold";
  }
  if (requestedTemplateId === "service_index" && optionName === "serviceIndexTreatment" && requestedValue !== renderedValue) {
    return "large flat service lists require uniform rows instead of a featured card that creates cramped secondary text columns";
  }
  if (requestedTemplateId === "contact_split" && optionName === "contactLayout" && requestedValue === "form_first" && renderedValue === "call_first") {
    return "form_first is incompatible with formComplexity=none";
  }
  if (requestedTemplateId === "location_showcase" && optionName === "hoursDisplay" && requestedValue === "today_first" && renderedValue === "full_week") {
    return "today_first would hide known weekend hours";
  }
  return "the template-option compatibility table clamped the invalid combination";
}

function backgroundKeyForSectionInstance(section: SectionInstanceV3): string | undefined {
  const visual = getVisualSectionV3(section.props);
  const background = visual?.options?.background as { kind?: string; token?: string } | undefined;
  if (!background?.kind) return undefined;
  return background.kind === "image" ? "image" : `${background.kind}:${background.token ?? ""}`;
}

function autoBodySeededCompositionSections(sections: SectionInstanceV3[], siteId: string): { sections: SectionInstanceV3[]; variant: string; dropped: string[] } {
  const variant = siteVariationSeedV2(`${siteId}:auto-body-composition`) % 4;
  if (variant === 0) {
    const order = ["hero", "facts", "media", "story", "services", "process", "proof", "gallery", "faq", "location", "contact", "cta_band"];
    return { sections: sortSectionsByAutoBodyOrder(sections, order), variant: "repair_review_after_services", dropped: [] };
  }
  const order =
    variant === 1
      ? ["hero", "facts", "services", "process", "proof", "media", "story", "about", "gallery", "faq", "location", "contact", "cta_band"]
      : variant === 2
        ? ["hero", "services", "process", "proof", "facts", "gallery", "media", "story", "about", "faq", "location", "contact", "cta_band"]
        : ["hero", "facts", "media", "story", "services", "process", "proof", "about", "gallery", "faq", "location", "contact", "cta_band"];
  const dropped = variant === 2 ? ["story", "media"] : [];
  const rank = new Map(order.map((id, index) => [id, index]));
  const keptSections = sections.filter((section) => !dropped.includes(section.id));
  return {
    sections: keptSections.sort((left, right) => (rank.get(left.id) ?? 100 + keptSections.indexOf(left)) - (rank.get(right.id) ?? 100 + keptSections.indexOf(right))),
    variant:
      variant === 1
        ? "services_repair_review_before_story"
        : variant === 2
          ? "services_repair_review_open_story_trimmed"
          : "story_services_repair_review",
    dropped
  };
}

function sortSectionsByAutoBodyOrder(sections: SectionInstanceV3[], order: string[]): SectionInstanceV3[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...sections].sort((left, right) => (rank.get(left.id) ?? 100 + sections.indexOf(left)) - (rank.get(right.id) ?? 100 + sections.indexOf(right)));
}

function normalizeCompositionPlanForBuiltSections(
  plan: CompositionPlanV3,
  builtSections: readonly { id: string }[],
  context: { hasLocationSection: boolean }
): { plan: CompositionPlanV3; repairs: string[] } {
  const builtIds = new Set(builtSections.map((section) => section.id));
  const seen = new Set<CompositionIntentV3>();
  const sections: CompositionPlanV3["sections"] = [];
  const repairs: string[] = [];

  for (const entry of plan.sections) {
    const normalizedIntent = compositionIntentForBuiltSection(entry.intent, builtIds);
    if (!normalizedIntent) {
      repairs.push(`Dropped unavailable intent "${entry.intent}".`);
      continue;
    }
    if (seen.has(normalizedIntent)) {
      repairs.push(`Dropped duplicate intent "${entry.intent}" after normalizing to "${normalizedIntent}".`);
      continue;
    }
    seen.add(normalizedIntent);
    sections.push(
      normalizedIntent === entry.intent
        ? entry
        : { intent: normalizedIntent, why: `${entry.why} Normalized from ${entry.intent} because that proof/media role is compiled as ${normalizedIntent}.` }
    );
  }

  const required: CompositionIntentV3[] = ["services", "faq", "cta_band", "contact"];
  if (context.hasLocationSection) required.push("location");
  for (const intent of required) {
    if (!builtIds.has(intent) || seen.has(intent)) continue;
    seen.add(intent);
    sections.push({ intent, why: `Required ${intent} section was appended by the compiler plan repair.` });
    repairs.push(`Appended required intent "${intent}".`);
  }

  return {
    plan: { ...plan, sections },
    repairs
  };
}

function compositionIntentForBuiltSection(intent: CompositionIntentV3, builtIds: Set<string>): CompositionIntentV3 | undefined {
  if (builtIds.has(intent)) return intent;
  if ((intent === "proof" || intent === "gallery") && builtIds.has("media")) return "media";
  return undefined;
}

function removeAutoBodyStandaloneCtaBand(sections: SectionInstanceV3[]): SectionInstanceV3[] {
  return sections.filter((section) => section.id !== "cta_band");
}

type ServiceLandingPageV3 = {
  id: string;
  slug: string;
  title: string;
  seo: PageModel["seo"];
  sections: SectionInstanceV3[];
  serviceName?: string;
};

type LocationLandingPageV3 = {
  id: string;
  slug: string;
  title: string;
  seo: PageModel["seo"];
  sections: SectionInstanceV3[];
  locationId: string;
};

type PageSlugRegistryV3 = Set<string>;

function createPageSlugRegistryV3(): PageSlugRegistryV3 {
  return new Set([""]);
}

function reserveUniquePageSlugV3(registry: PageSlugRegistryV3, rawSlug: string): string | undefined {
  const normalized = rawSlug.replace(/^\/+|\/+$/g, "");
  if (!normalized) return undefined;
  const slashIndex = normalized.lastIndexOf("/");
  const prefix = slashIndex >= 0 ? `${normalized.slice(0, slashIndex)}/` : "";
  const stem = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  let candidate = normalized;
  let suffix = 2;
  while (registry.has(candidate)) {
    candidate = `${prefix}${stem}-${suffix}`;
    suffix += 1;
  }
  registry.add(candidate);
  return candidate;
}

function typedPageSlugV3(registry: PageSlugRegistryV3, prefix: "services" | "locations", rawName: string, fallbackStem: string): string | undefined {
  const stem = slugify(rawName) || fallbackStem;
  return reserveUniquePageSlugV3(registry, `${prefix}/${stem}`);
}

function buildLocationLandingPagesV3(
  business: BusinessProfile,
  locationContext: LocationCompileContextV3,
  deck: GeneratedCopyDeckV2 | undefined,
  pageSlugRegistry: PageSlugRegistryV3
): LocationLandingPageV3[] {
  if (locationContext.physicalLocations.length < 2) return [];

  const serviceItems = serviceItemsForBusiness(business, deck).slice(0, 4);
  return locationContext.physicalLocations.flatMap((location, index) => {
    const slugSeed = [location.label, location.localityLine].filter(Boolean).join(" ");
    const slug = typedPageSlugV3(pageSlugRegistry, "locations", slugSeed, `location-${index + 1}`);
    if (!slug) return [];
    const idPrefix = `loc_${slug.replace(/\//g, "_")}`;
    const locationOnlyContext = locationContextForLocations(locationContext, [location]);
    const locality = location.localityLine ? ` in ${location.localityLine}` : "";
    const heroBody = location.addressLine
      ? `${location.addressLine}${location.hoursSummary ? `. Hours: ${location.hoursSummary}.` : "."}`
      : `Use this page to confirm the right ${business.name} location${locality}.`;
    const sections: SectionInstanceV3[] = [
      visualSection(`${idPrefix}_hero`, "hero.section_template", {
        version: "visual-section-v3",
        templateId: "hero_statement",
        options: { align: "left", background: backgrounds.subtleGradient },
        slots: {
          copy: {
            eyebrow: "Location",
            heading: `${business.name} ${location.label}`,
            body: heroBody,
            actions: [
              ...(location.directionsUrl ? [{ label: "Get directions", href: location.directionsUrl, style: "primary" as const }] : []),
              ...(location.phone ? [{ label: `Call ${formatPhone(location.phone)}`, href: `tel:${phoneHref(location.phone)}`, style: "secondary" as const }] : [])
            ]
          },
          facts: { items: locationFactsForLandingPage(location).slice(0, 4) }
        }
      }),
      visualSection(`${idPrefix}_showcase`, "local.section_template", locationShowcaseSection(business, locationOnlyContext)),
      serviceItems.length >= 3
        ? visualSection(`${idPrefix}_services`, "services.section_template", {
            version: "visual-section-v3",
            templateId: "side_intro_rows",
            anchorId: "services",
            options: { background: backgrounds.surface },
            slots: {
              intro: {
                eyebrow: "Services",
                heading: `Services at ${location.label}.`,
                body: serviceIntroForBusiness(business)
              },
              items: { items: dedupeStandardItems(serviceItems) }
            }
          })
        : visualSection(`${idPrefix}_service_statement`, "statement.section_template", {
            version: "visual-section-v3",
            templateId: "editorial_statement",
            options: { background: backgrounds.surface },
            slots: {
              copy: {
                eyebrow: "Services",
                heading: `Ask what fits this location.`,
                body: serviceIntroForBusiness(business),
                actions: [primaryCtaForBusiness(business)]
              }
            }
          }),
      visualSection(`${idPrefix}_contact`, "contact.section_template", contactSplitSection(business, locationOnlyContext, deck, { includeLocationAnchor: false }))
    ];

    return [{
      id: `page_${slug.replace(/\//g, "_")}`,
      slug,
      locationId: location.id,
      title: `${location.label} | ${business.name}`,
      seo: {
        title: `${location.label} | ${business.name}`,
        description: location.addressLine
          ? `${business.name} location details for ${location.addressLine}.`
          : `${business.name} location details for ${location.label}.`,
        canonicalPath: `/${slug}`
      },
      sections
    }];
  });
}

function locationFactsForLandingPage(location: RenderableLocationV3): VisualFactV3[] {
  return [
    ...(location.addressLine ? [{ label: "Address", value: location.addressLine }] : []),
    ...(location.phone ? [{ label: "Phone", value: formatPhone(location.phone), href: `tel:${phoneHref(location.phone)}` }] : []),
    ...(location.hoursSummary ? [{ label: "Hours", value: location.hoursSummary }] : []),
    ...(location.serviceAreas.length ? [{ label: "Serves", value: location.serviceAreas.slice(0, 3).join(", ") }] : [])
  ];
}

function locationContextWithLandingPages(
  locationContext: LocationCompileContextV3,
  locationPages: LocationLandingPageV3[]
): LocationCompileContextV3 {
  if (!locationPages.length) return locationContext;
  const hrefByLocationId = new Map(locationPages.map((page) => [page.locationId, `/${page.slug}`]));
  const locations = locationContext.locations.map((location) => {
    const href = hrefByLocationId.get(location.id);
    return href ? { ...location, href } : location;
  });
  return locationContextForLocations({ ...locationContext, locations }, locations);
}

function locationContextForLocations(
  source: LocationCompileContextV3,
  locations: RenderableLocationV3[]
): LocationCompileContextV3 {
  const physicalLocations = locations.filter(hasRenderableAddressV3);
  const primaryLocation = physicalLocations.find((location) => location.isPrimary) ?? physicalLocations[0] ?? locations[0];
  const normalizedLocations = locations.map((location) => ({
    ...location,
    isPrimary: location.id === primaryLocation?.id
  }));
  const normalizedPhysicalLocations = normalizedLocations.filter(hasRenderableAddressV3);
  return {
    ...source,
    locations: normalizedLocations,
    physicalLocations: normalizedPhysicalLocations,
    primaryLocation: normalizedLocations.find((location) => location.isPrimary),
    serviceAreas: dedupeStrings([
      ...source.serviceAreas,
      ...normalizedLocations.flatMap((location) => location.serviceAreas)
    ]),
    hasLocationSection: normalizedPhysicalLocations.length > 0 || source.serviceAreas.length > 0,
    hasPhysicalLocation: normalizedPhysicalLocations.length > 0
  };
}

/**
 * Service landing pages with anti-doorway enforcement: pages exist only for
 * source-backed services with substantively distinct, service-specific copy.
 * Below threshold means fewer pages, never thinner ones.
 */
/**
 * Homepage service cards link to their landing pages with service-specific labels, making
 * the multi-page structure visible and crawlable from the homepage.
 */
function linkServiceItemsToPages(sections: SectionInstanceV3[], servicePages: Array<{ slug: string; title: string; serviceName?: string }>) {
  if (!servicePages.length) return;
  const pageByService = servicePages
    .map((page) => ({ slug: page.slug, name: (page.serviceName ?? page.title).toLowerCase() }))
    .filter((entry) => entry.name);
  for (const section of sections) {
    const visual = section.props?.visualSectionV3 as VisualSectionV3 | undefined;
    if (!visual || (visual.templateId !== "intro_grid" && visual.templateId !== "side_intro_rows")) continue;
    if (section.id !== "services") continue;
    const slots = visual.slots as { items?: { items?: StandardItemV3[] } };
    for (const [index, item] of (slots.items?.items ?? []).entries()) {
      const title = item.title.toLowerCase();
      const match = pageByService.find((entry) => title.includes(entry.name) || entry.name.includes(title));
      if (match) item.href = `/${match.slug}`;
      else if (servicePages[index]) item.href = `/${servicePages[index].slug}`;
    }
  }
}

function buildServiceLandingPagesV3(
  business: BusinessProfile,
  locationContext: LocationCompileContextV3,
  deck: GeneratedCopyDeckV2 | undefined,
  homepageSections: SectionInstanceV3[],
  media: SelectedV3Media | undefined,
  pageSlugRegistry: PageSlugRegistryV3,
  directorServicePageProposals?: readonly SiteDirectorServicePageProposalV1[]
): ServiceLandingPageV3[] {
  const deterministicServicePages = deterministicServicePageCopiesForBusiness(business);
  const usesDirectorServicePageStrategy = Boolean(directorServicePageProposals?.length);
  const servicePageCopies =
    usesDirectorServicePageStrategy
      ? deck?.servicePages ?? []
      : deck?.servicePages?.length
        ? deck.servicePages
        : deterministicServicePages;
  if (!servicePageCopies.length) return [];
  // Vertical-default services are unverified claims; they never earn pages.
  if (areServicesVerticalDefaults(business.services, business.vertical)) return [];

  const gallery = media ? galleryForSelectedMedia(media) : [];
  const homepageTexts = sectionTextsForOverlap(homepageSections);
  const accepted: ServiceLandingPageV3[] = [];

  for (const pageCopy of servicePageCopies) {
    if (isPseudoServicePageCandidateV3(pageCopy.serviceName)) continue;
    const matchedService = business.services.find(
      (service) =>
        !isPseudoServicePageCandidateV3(service) &&
        service.toLowerCase().includes(pageCopy.serviceName.toLowerCase()) ||
        (!isPseudoServicePageCandidateV3(service) && pageCopy.serviceName.toLowerCase().includes(service.toLowerCase()))
    );
    if (!matchedService) continue;
    const directorProposal = servicePageProposalForServiceV1(business, matchedService, directorServicePageProposals);
    if (directorServicePageProposals?.length && directorProposal?.strategy !== "dedicated") continue;

    const pageTexts = servicePageCopyTexts(pageCopy);
    const serviceWords = pageCopy.serviceName.toLowerCase().split(/\s+/).filter((word) => word.length >= 4);
    const mentionCount = pageTexts.filter((text) =>
      serviceWords.some((word) => text.toLowerCase().includes(word))
    ).length;
    if (mentionCount < 3) continue;

    if (sentenceOverlapRatio(pageTexts, homepageTexts) >= servicePageMaxOverlapRatio) continue;
    if (accepted.some((sibling) => sentenceOverlapRatio(pageTexts, sectionTextsForOverlap(sibling.sections)) >= servicePageMaxOverlapRatio)) {
      continue;
    }

    const slug = typedPageSlugV3(pageSlugRegistry, "services", directorProposal?.slug ?? pageCopy.serviceName, `service-${accepted.length + 1}`);
    if (!slug) continue;

    const idPrefix = `svc_${slug.replace(/\//g, "_")}`;
    const sections: SectionInstanceV3[] = [
      visualSection(`${idPrefix}_hero`, "hero.section_template", {
        version: "visual-section-v3",
        templateId: "hero_statement",
        options: { align: "left", background: backgrounds.subtleGradient },
        slots: {
          copy: {
            eyebrow: eyebrowForBusiness(business),
            heading: pageCopy.hero.heading,
            body: pageCopy.hero.body,
            actions: heroActionsForBusiness(business)
          },
          facts: { items: proofFactsForBusiness(business).slice(0, 4) }
        }
      }),
      // Service pages carry a real photo when safe media exists: split_media
      // pairs the detail copy with a distinct gallery image per page, instead
      // of every service page rendering as a text-only statement.
      gallery.length
        ? visualSection(`${idPrefix}_detail`, "story.section_template", {
            version: "visual-section-v3",
            templateId: "split_media",
            options: {
              background: backgrounds.surface,
              mediaSide: accepted.length % 2 === 0 ? "right" : "left"
            },
            slots: {
              copy: {
                eyebrow: "Details",
                heading: pageCopy.detail.heading,
                body: pageCopy.detail.body,
                actions: [primaryCtaForBusiness(business)]
              },
              media: mediaSlot([gallery[(accepted.length + 2) % gallery.length]])
            }
          })
        : visualSection(`${idPrefix}_detail`, "statement.section_template", {
            version: "visual-section-v3",
            templateId: "editorial_statement",
            options: { background: backgrounds.surface },
            slots: {
              copy: {
                eyebrow: "Details",
                heading: pageCopy.detail.heading,
                body: pageCopy.detail.body,
                actions: [primaryCtaForBusiness(business)]
              }
            }
          }),
      visualSection(`${idPrefix}_faq`, "faq.section_template", {
        version: "visual-section-v3",
        templateId: "faq_list",
        anchorId: "faq",
        options: { background: backgrounds.subtleGradient },
        slots: {
          intro: {
            eyebrow: "Questions",
            heading: `Common questions about ${pageCopy.serviceName.toLowerCase()}.`,
            body: faqIntroForBusiness(business)
          },
          items: { items: pageCopy.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })) }
        }
      }),
      visualSection(`${idPrefix}_contact`, "contact.section_template", contactSplitSection(business, locationContext, deck, { includeLocationAnchor: false }))
    ];

    accepted.push({
      id: `page_${slug.replace(/\//g, "_")}`,
      slug,
      serviceName: pageCopy.serviceName,
      title: `${pageCopy.serviceName} | ${business.name}`,
      seo: {
        title: pageCopy.seo.title,
        description: pageCopy.seo.description,
        canonicalPath: `/${slug}`
      },
      sections
    });
  }
  return accepted;
}

function isPseudoServicePageCandidateV3(value: string) {
  return /\b(free\s+)?(repair\s+)?(quote|estimate)\b|\b(get|request)\s+(a\s+)?(free\s+)?(quote|estimate)\b|\bappointment\b|\bcontact\s+us\b/i.test(value);
}

function servicePageProposalForServiceV1(
  business: BusinessProfile,
  serviceName: string,
  proposals: readonly SiteDirectorServicePageProposalV1[] | undefined
): SiteDirectorServicePageProposalV1 | undefined {
  if (!proposals?.length) return undefined;
  const serviceIndex = business.services.findIndex((service) => service.toLowerCase() === serviceName.toLowerCase());
  if (serviceIndex < 0) return undefined;
  return proposals.find((proposal) => proposal.serviceId === `service_${serviceIndex + 1}`);
}

function deterministicServicePageCopiesForBusiness(business: BusinessProfile): GeneratedServicePageCopyV2[] {
  if (business.vertical !== "auto_body" && business.vertical !== "auto_services") return [];
  if (business.services.length < 3) return [];
  return serviceNamesForBusiness(business)
    .slice(0, 8)
    .map((service) =>
      business.vertical === "auto_body"
        ? autoBodyServicePageCopy(business, service)
        : autoServicesServicePageCopy(business, service)
    );
}

function autoBodyServicePageCopy(business: BusinessProfile, service: string): GeneratedServicePageCopyV2 {
  const serviceLower = service.toLowerCase();
  const location = locationLineForBusiness(business);
  const place = location ? ` in ${location}` : "";
  const insuranceEvidence = autoBodyHasPublishableInsuranceServiceEvidence(business);
  const insuranceDetail = insuranceEvidence ? " Keep claim or adjuster details nearby if insurance is involved." : "";
  const title = `${service} | ${business.name}`;
  const page = (input: {
    heading: string;
    heroBody: string;
    detailHeading: string;
    detailBody: string;
    faqs: Array<{ question: string; answer: string }>;
    description: string;
  }): GeneratedServicePageCopyV2 => ({
    serviceName: service,
    hero: {
      heading: input.heading,
      body: input.heroBody
    },
    detail: {
      heading: input.detailHeading,
      body: input.detailBody
    },
    faqs: input.faqs,
    seo: {
      title,
      description: input.description
    }
  });

  if (/dent|pdr|paintless/i.test(service)) {
    return page({
      heading: `Paintless dent repair${place}.`,
      heroBody: `${business.name} checks shallow dents, door dings, and finish condition before paintless dent repair is recommended.`,
      detailHeading: "When paintless repair fits.",
      detailBody: `Useful details include dent size, panel location, whether the paint is cracked, and whether the dent is easy to see in natural light.${insuranceDetail}`,
      faqs: [
        { question: "What makes paintless dent repair different?", answer: "It focuses on shallow dents where the finish is still intact." },
        { question: "What should I photograph?", answer: "A wide panel photo and a close detail photo usually give the shop enough to start the first call." },
        { question: "Does cracked paint change the repair?", answer: "Cracked paint usually moves the repair from paintless dent work into body and paint work." },
        { question: "Should I call before visiting?", answer: `Call first with the vehicle details and photos so ${business.name} knows what to look for.` }
      ],
      description: `${business.name} checks shallow dents, door dings, and finish condition for paintless dent repair${place}.`
    });
  }

  if (/hail/i.test(service)) {
    return page({
      heading: `Hail damage repair${place}.`,
      heroBody: `${business.name} reviews hail marks across the hood, roof, doors, and trim so storm damage is not treated as one isolated dent.`,
      detailHeading: "Panel-by-panel hail review.",
      detailBody: `Helpful details include when the storm hit, which panels show dents most clearly, and whether trim or glass was affected.${insuranceDetail}`,
      faqs: [
        { question: "Why does hail need a full-panel look?", answer: "Hail often leaves clusters of shallow marks across several panels." },
        { question: "Which photos are useful?", answer: "Photos with reflected light across the panel show shallow dents more clearly than a single flat view." },
        { question: "Should I list every dent?", answer: "Start with the panels affected most; the shop reviews the pattern during the visit." },
        { question: "What should I bring?", answer: "Bring vehicle details, photos, timing, and when the storm damage happened." }
      ],
      description: `${business.name} reviews hail marks across vehicle panels for hail damage repair${place}.`
    });
  }

  if (/collision|body/i.test(service)) {
    return page({
      heading: `Collision repair${place}.`,
      heroBody: `${business.name} looks beyond the visible dent to bumpers, panel gaps, trim, lights, paint, and nearby impact marks.`,
      detailHeading: "Accident damage rarely stops at one panel.",
      detailBody: `Share where the impact happened, whether the vehicle drives normally, dashboard warnings, photos, and timing.${insuranceDetail}`,
      faqs: [
        { question: "What details matter after a collision?", answer: "Where the vehicle was hit, warning lights, drivability, loose trim, and nearby panel gaps all matter." },
        { question: "Why mention panel gaps or trim?", answer: "Gaps, clips, trim, and lights reveal related damage that is easy to miss in one photo." },
        { question: "Should I drive the car in?", answer: "Call first if the car pulls, leaks, has warning lights, or has loose exterior parts." },
        { question: "What happens at the shop visit?", answer: "The damaged area and nearby panels are checked before repair direction is discussed." }
      ],
      description: `${business.name} handles collision repair${place} with attention to panels, trim, paint, lights, and accident damage.`
    });
  }

  if (/bumper/i.test(service)) {
    return page({
      heading: `Bumper repair${place}.`,
      heroBody: `${business.name} checks scuffs, cracks, clips, sensor areas, and nearby paint before bumper repair direction is discussed.`,
      detailHeading: "Bumper damage includes more than the cover.",
      detailBody: `Photos of corners, lower edges, lights, and trim help show whether damage is cosmetic or tied to nearby parts.${insuranceDetail}`,
      faqs: [
        { question: "What should bumper photos show?", answer: "Show the full bumper, close damage, lower edge, lights, trim, and any loose pieces." },
        { question: "Do clips and tabs matter?", answer: "Clips and tabs affect how the cover sits and whether nearby parts need attention." },
        { question: "What if sensors are nearby?", answer: "Mention parking sensors, camera areas, or warning lights when you call." },
        { question: "Should I keep loose pieces?", answer: "Keep loose trim or clips with the vehicle if it is safe to do so." }
      ],
      description: `${business.name} checks bumper scuffs, cracks, clips, trim, and nearby paint for bumper repair${place}.`
    });
  }

  if (/glass|windshield|window/i.test(service)) {
    return page({
      heading: `Auto glass damage${place}.`,
      heroBody: `${business.name} keeps glass damage connected to the surrounding body work so a second issue is not missed during the visit.`,
      detailHeading: "Glass damage and nearby panels.",
      detailBody: `Share which glass is damaged, whether the door or frame was hit, and whether water, wind noise, or loose trim is present.${insuranceDetail}`,
      faqs: [
        { question: "What glass details should I share?", answer: "Mention windshield, side glass, rear glass, cracks, missing pieces, and nearby impact marks." },
        { question: "Why mention trim or frame damage?", answer: "Trim, seals, and frames affect how glass damage is handled with body work." },
        { question: "Should I cover broken glass?", answer: "Protect the interior if it is safe, then call before bringing the vehicle in." },
        { question: "What photos help?", answer: "Use one wide photo and one close photo of the glass and surrounding edge." }
      ],
      description: `${business.name} handles auto glass damage${place} alongside nearby body and trim details.`
    });
  }

  if (/\bpaint\b|refinish/i.test(service)) {
    return page({
      heading: `Paint refinishing${place}.`,
      heroBody: `${business.name} looks at scraped paint, repaired panels, adjacent finish, and blend areas before paint refinishing is discussed.`,
      detailHeading: "Paint work depends on the surrounding finish.",
      detailBody: `Helpful details include the damaged panel, nearby paint edges, and whether the color difference is visible in daylight.${insuranceDetail}`,
      faqs: [
        { question: "What paint photos are useful?", answer: "Show the whole panel, the damaged finish, and adjacent panels in natural light." },
        { question: "Why do adjacent panels matter?", answer: "Nearby panels affect how paint refinishing is planned around the existing finish." },
        { question: "Should I mention prior repairs?", answer: "Mention prior body or paint work if you know about it." },
        { question: "What should I ask on the call?", answer: "Ask what photos to send and whether the shop wants to see the vehicle in person." }
      ],
      description: `${business.name} handles paint refinishing${place} for scraped, repaired, or refinished exterior panels.`
    });
  }

  return page({
    heading: `${sentenceCasePhrase(serviceLower)}${place}.`,
    heroBody: `${business.name} handles ${serviceLower}${place} with attention to the damaged area, driveability, visible panels, and timing.`,
    detailHeading: `Details that matter for ${serviceLower}.`,
    detailBody: `Vehicle year, make, model, affected area, and clear photos help shape the first shop review.${insuranceDetail}`,
    faqs: [
      { question: `What matters most for ${serviceLower}?`, answer: "Where the damage sits, how it happened, whether the vehicle drives, and what the surrounding panels look like." },
      { question: "Should I call before visiting?", answer: `Call first with vehicle details and timing so ${business.name} knows what to look for.` },
      { question: "Which views help the shop understand the damage?", answer: "A wide view, a close view, and an angled view make depth and panel alignment easier to judge." },
      { question: "What changes after the shop visit?", answer: "Panel edges, paint condition, trim, and related damage affect the repair direction." }
    ],
    description: `${business.name} handles ${serviceLower}${place}. Call with damage photos, vehicle details, and timing.`
  });
}

function autoServicesServicePageCopy(business: BusinessProfile, service: string): GeneratedServicePageCopyV2 {
  const serviceLower = service.toLowerCase();
  const location = locationLineForBusiness(business);
  const place = location ? ` in ${location}` : "";
  return {
    serviceName: service,
    hero: {
      heading: `${sentenceCasePhrase(serviceLower)}${place}.`,
      body: `${business.name} handles ${serviceLower}${place}. Call or pull in with vehicle details for price and timing before work starts.`
    },
    detail: {
      heading: `What to confirm for ${serviceLower}.`,
      body: `For ${serviceLower}, the useful details are the vehicle, tire or part size when relevant, the issue you noticed, and whether you need help the same day.`
    },
    faqs: [
      {
        question: `What should I have ready for ${serviceLower}?`,
        answer: `Have the vehicle make and model, the tire or part size if you know it, and the timing you need.`
      },
      {
        question: `Can I call before coming in?`,
        answer: `Yes. Calling first helps confirm stock, price, repairability, or the best time to arrive for ${serviceLower}.`
      },
      {
        question: `Will I know the ${serviceLower} price before work starts?`,
        answer: `The ${serviceLower} price should be clear after the first look and before work begins.`
      },
      {
        question: `What can change after the first ${serviceLower} check?`,
        answer: `Repairability, part availability, tire condition, and timing can change after the shop checks the vehicle in person.`
      }
    ],
    seo: {
      title: `${service} | ${business.name}`,
      description: `${business.name} handles ${serviceLower}${place}. Call with vehicle details to confirm fit, price, timing, and same-day options.`
    }
  };
}

function sectionTextsForOverlap(sections: SectionInstanceV3[]): string[] {
  const texts: string[] = [];
  const sharedChrome = new Set(["contact_split", "facts_strip", "location_directory", "location_showcase", "service_area_showcase", "facts_cta"]);
  for (const section of sections) {
    const props = section.props as { visualSectionV3?: VisualSectionV3 };
    const visual = props.visualSectionV3;
    if (!visual || sharedChrome.has(visual.templateId)) continue;
    const visit = (value: unknown) => {
      if (typeof value === "string") {
        if (value.trim()) texts.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (key === "url" || key === "href" || key === "id") continue;
          visit(item);
        }
      }
    };
    visit(visual.slots);
  }
  return texts;
}

function servicePageCopyTexts(pageCopy: GeneratedServicePageCopyV2): string[] {
  return [
    pageCopy.hero.heading,
    pageCopy.hero.body,
    pageCopy.detail.heading,
    pageCopy.detail.body,
    ...pageCopy.faqs.flatMap((faq) => [faq.question, faq.answer])
  ];
}

function includedDecision(
  sectionRole: string,
  evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"],
  reason: string,
  section: VisualSectionV3
): GeneratedSiteV3CompositionDecision {
  return {
    id: `${sectionRole}.included`,
    status: "included",
    sectionRole,
    evidenceSignal,
    reason,
    selectedTemplateId: section.templateId,
    selectedOptions: section.options as Record<string, unknown>
  };
}

function classifyAutoBodyV3Evidence(
  business: BusinessProfile,
  media: SelectedV3Media,
  gallery: Array<{ url: string; label: string }>,
  services: StandardItemV3[],
  locationContext: LocationCompileContextV3
): GeneratedSiteV3EvidenceSignals {
  const quoteItems = quoteItemsForBusiness(business);
  const eligibleAutoBodyProofMedia = business.vertical === "auto_body"
    ? business.photos.filter((asset) => (isPublicSafeMedia(asset) || isProtectedPreviewEligibleMedia(asset)) && !isLikelyLogoOnlyMedia(asset, business) && isLikelyAutoBodyProofReferenceMedia(asset))
    : [];
  const hasEligibleAutoBodyProofMedia = eligibleAutoBodyProofMedia.length > 0;
  const hasBeforeAfterPair =
    business.vertical === "auto_body" &&
    selectAutoBodyRepairProofPairMedia(
      eligibleAutoBodyProofMedia.map((asset) => ({ url: asset.url, label: asset.alt || "Repair reference" }))
    ).length >= 2;
  return {
    serviceCount: serviceNamesForBusiness(business).length,
    hasPhone: Boolean(business.phone),
    hasAddress: Boolean(business.address),
    hasHours: Boolean(business.hours && Object.keys(business.hours).length),
    hasServiceAreas: business.serviceAreas.length > 0,
    mediaCount: business.photos.length,
    safeMediaCount: media.kind === "media" ? gallery.length : 0,
    hasSafeHeroMedia: media.kind === "media" && gallery.length > 0,
    hasEnoughGalleryMedia: media.kind === "media" && gallery.length >= 2,
    hasBeforeAfterProof: hasBeforeAfterPair,
    hasRepairReferenceMedia: hasEligibleAutoBodyProofMedia,
    hasQuoteProof: quoteItems.length >= 3,
    hasRealPricingEvidence: pricingItemsForBusiness(business).length >= 3,
    hasCredentialTrustProof: Boolean(business.phone || business.address || business.reviewsSummary?.count || services.length),
    hasLocationSection: locationContext.hasLocationSection
  };
}

function galleryForSelectedMedia(media: SelectedV3Media): SiteMediaItemV3[] {
  if (media.kind !== "media") return [];
  return media.gallery.length ? media.gallery : [{ url: media.heroUrl, label: "Business photo" }];
}

function isAutoBodyProofMedia(item: { url: string; label: string }) {
  return /\bbefore\b|\bafter\b|\brepair reference\b|\bfinished repair\b|\bproof\b/i.test(`${item.url} ${item.label}`);
}

function locationCompileContextForBundle(bundle: SiteBundle): LocationCompileContextV3 {
  const business = bundle.businessProfile;
  const locations = bundle.locations ?? [];
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const bindings = orderedLocationBindings(bundle.locationBindings ?? [], locations);
  const renderableLocations = bindings
    .map((binding) => {
      const location = locationById.get(binding.locationId);
      if (!location) return undefined;
      return renderableLocationForRecord(location, binding, business);
    })
    .filter((location): location is RenderableLocationV3 => Boolean(location));
  const primaryLocation = renderableLocations.find((location) => location.isPrimary) ?? renderableLocations[0];
  const normalizedLocations = renderableLocations.map((location) => ({
    ...location,
    isPrimary: location.id === primaryLocation?.id
  }));
  const physicalCount = normalizedLocations.filter(hasRenderableAddressV3).length;
  const locationsWithHoursFallback = normalizedLocations.map((location) => {
    if (physicalCount !== 1 || !hasRenderableAddressV3(location) || location.hours?.length || !business.hours) return location;
    return {
      ...location,
      hoursSummary: hoursSummaryForHours(business.hours) ?? location.hoursSummary,
      hours: hoursEntriesForHours(business.hours)
    };
  });
  const physicalLocations = locationsWithHoursFallback.filter(hasRenderableAddressV3);
  const canonicalServiceAreas = dedupeStrings([
    ...business.serviceAreas,
    ...locationsWithHoursFallback.flatMap((location) => location.serviceAreas)
  ]);
  const primaryPhysicalLocation = physicalLocations.find((location) => location.isPrimary) ?? physicalLocations[0];
  const finalLocations = locationsWithHoursFallback.map((location) => ({
    ...location,
    isPrimary: location.id === (primaryPhysicalLocation?.id ?? primaryLocation?.id)
  }));
  return {
    locations: finalLocations,
    physicalLocations: finalLocations.filter(hasRenderableAddressV3),
    primaryLocation: finalLocations.find((location) => location.isPrimary),
    serviceAreas: canonicalServiceAreas,
    hasLocationSection: physicalLocations.length > 0 || canonicalServiceAreas.length > 0,
    hasPhysicalLocation: physicalLocations.length > 0
  };
}

function hasRenderableAddressV3(location: RenderableLocationV3): boolean {
  return Boolean(location.addressLine?.trim());
}

function orderedLocationBindings(bindings: SiteLocationBinding[], locations: BusinessLocationRecord[]): SiteLocationBinding[] {
  if (bindings.length) return [...bindings].sort((left, right) => left.orderIndex - right.orderIndex || left.locationId.localeCompare(right.locationId));
  return locations.map((location, index) => ({
    locationId: location.id,
    role: index === 0 ? "primary" : "covered",
    orderIndex: index
  }));
}

function renderableLocationForRecord(
  location: BusinessLocationRecord,
  binding: SiteLocationBinding,
  business: BusinessProfile
): RenderableLocationV3 {
  const addressLine = location.address ? formatAddress(location.address) : undefined;
  const localityLine = [location.address?.city, location.address?.region].filter(Boolean).join(", ") || undefined;
  const isPhysical = Boolean(addressLine);
  return {
    id: location.id,
    label: location.label ?? location.address?.city ?? location.serviceAreas[0] ?? business.name,
    role: binding.role,
    isPrimary: binding.role === "primary",
    addressLine,
    localityLine,
    phone: location.phone ?? business.phone,
    email: publicEmailForBusiness(location.email ?? business.email),
    hoursSummary: location.hours ? hoursSummaryForHours(location.hours) : undefined,
    hours: hoursEntriesForHours(location.hours),
    serviceAreas: location.serviceAreas,
    directionsUrl: isPhysical ? directionsUrlForLocation(location, addressLine) : undefined,
    mapEmbedIntent: isPhysical ? mapEmbedIntentForLocation(location, addressLine) : undefined
  };
}

function directionsUrlForLocation(location: BusinessLocationRecord, addressLine: string | undefined) {
  const destination = addressLine ?? (location.geo ? `${location.geo.latitude},${location.geo.longitude}` : undefined);
  if (!destination) return undefined;
  const params = new URLSearchParams({ api: "1", destination });
  if (location.googlePlaceId) params.set("destination_place_id", location.googlePlaceId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function mapEmbedIntentForLocation(location: BusinessLocationRecord, addressLine: string | undefined): MapEmbedIntentV3 | undefined {
  if (location.googlePlaceId) return { kind: "place", placeId: location.googlePlaceId, address: addressLine };
  if (addressLine) return { kind: "address", address: addressLine };
  if (location.geo) return { kind: "geo", latitude: location.geo.latitude, longitude: location.geo.longitude };
  return undefined;
}

function splitMediaSideForOccurrence(heroTemplateId: "hero_split" | "hero_statement", occurrenceIndex: number) {
  if (occurrenceIndex === 0) return heroTemplateId === "hero_split" ? "right" : "left";
  return occurrenceIndex % 2 === 0 ? "left" : "right";
}

function heroCopySlotForSection(business: BusinessProfile, mode: SelectedV3Media["kind"], deck?: GeneratedCopyDeckV2) {
  if (business.vertical === "auto_body") {
    return {
      eyebrow: deck?.hero.eyebrow ?? eyebrowForBusiness(business),
      heading: deck?.hero.heading ?? headlineForBusiness(business, mode),
      body: deck?.hero.body ?? subheadlineForBusiness(business)
    };
  }
  return {
    eyebrow: deck?.hero.eyebrow ?? eyebrowForBusiness(business),
    heading: deck?.hero.heading ?? headlineForBusiness(business, mode),
    body: deck?.hero.body ?? subheadlineForBusiness(business)
  };
}

function heroSplitSection(
  business: BusinessProfile,
  gallery: Array<{ url: string; label: string }>,
  deck?: GeneratedCopyDeckV2,
  heroPrimaryCta?: VisualCtaV3,
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  const heroMedia = heroMediaForBusinessV1(business, gallery);
  const heroMediaCount = templateOptions?.mediaTreatment === "collage_pair" ? 2 : 1;
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "hero_split",
    options: { background: backgrounds.page },
    slots: {
      copy: {
        ...heroCopySlotForSection(business, "media", deck),
        actions: heroActionsForBusiness(business, heroPrimaryCta)
      },
      media: mediaSlot(heroMedia.slice(0, heroMediaCount)),
      facts: { items: proofFactsForBusiness(business).slice(0, 4) }
    }
  }, templateOptions);
}

function heroMediaForBusinessV1(
  business: BusinessProfile,
  items: Array<{ url: string; label: string }>
): Array<{ url: string; label: string }> {
  if (business.vertical !== "auto_body" || items.length < 2) return items;
  const clean = items.filter((item) => isCleanCaseStudyLeadMediaV1(business, item));
  if (!clean.length) return items;
  const cleanKeys = new Set(clean.map((item) => mediaIdentityKey(item.url)));
  return [...clean, ...items.filter((item) => !cleanKeys.has(mediaIdentityKey(item.url)))];
}

function heroStatementSection(
  business: BusinessProfile,
  deck?: GeneratedCopyDeckV2,
  heroPrimaryCta?: VisualCtaV3,
  requestedAlign?: "left" | "center",
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  // Seeded variation keeps same-vertical sites from rendering pixel-identical.
  const align = requestedAlign ?? (siteVariationSeedV2(business.siteId) % 2 === 0 ? "center" : "left");
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align, background: backgrounds.subtleGradient },
    slots: {
      copy: {
        ...heroCopySlotForSection(business, "text", deck),
        actions: heroActionsForBusiness(business, heroPrimaryCta)
      },
      facts: { items: proofFactsForBusiness(business).slice(0, 4) }
    }
  }, templateOptions);
}

/**
 * Full-bleed image hero: the business's real photo behind scrimmed copy — the
 * highest-impact hero when a strong wide photo exists. CSS scrim +
 * foreground-token derivation keep text WCAG-safe; render QA gates it.
 */
function heroImageStatementSection(
  business: BusinessProfile,
  heroUrl: string,
  deck?: GeneratedCopyDeckV2,
  heroPrimaryCta?: VisualCtaV3,
  templateOptions?: SectionBlueprintV1["templateOptions"],
  focalPoint?: BackgroundFocalPointV3
): VisualSectionV3 {
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align: "left", background: { kind: "image", url: heroUrl, focalPoint: focalPoint ?? "center" } },
    slots: {
      copy: {
        ...heroCopySlotForSection(business, "text", deck),
        actions: heroActionsForBusiness(business, heroPrimaryCta)
      },
      facts: { items: proofFactsForBusiness(business).slice(0, 4) }
    }
  }, templateOptions);
}

function splitMediaSection(
  business: BusinessProfile,
  gallery: Array<{ url: string; label: string }>,
  mediaSide: "left" | "right" = "left",
  deck?: GeneratedCopyDeckV2,
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  const autoBodyCopy =
    business.vertical === "auto_body"
      ? {
          heading: "The first look goes beyond the obvious dent.",
          body: `${business.name} checks the obvious hit together with nearby panel gaps, trim, lights, paint edges, and finish lines before recommending the repair direction.`
        }
      : undefined;
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "split_media",
    anchorId: "proof",
    options: { background: backgrounds.subtleGradient, mediaSide },
    slots: {
      copy: {
        eyebrow: business.vertical === "auto_body" ? "Repair prep" : "Approach",
        heading: autoBodyCopy?.heading ?? deck?.splitMedia.heading ?? splitMediaFallbackHeading(business),
        body: autoBodyCopy?.body ?? deck?.splitMedia.body ?? splitMediaFallbackBody(business),
        actions: [
          {
            label: business.phone ? (business.vertical === "auto_body" ? "Call the shop" : "Talk through timing") : "Send the details",
            href: business.phone ? `tel:${phoneHref(business.phone)}` : "#contact",
            style: "text"
          }
        ]
      },
      media: mediaSlot(gallery.slice(1, 2).length ? gallery.slice(1, 2) : gallery.slice(0, 1))
    }
  }, templateOptions);
}

function introGridSection(
  business: BusinessProfile,
  services: StandardItemV3[],
  cardTreatment: IntroGridCardTreatmentV3,
  deck?: GeneratedCopyDeckV2,
  background: SectionBackgroundOptionV3 = backgrounds.subtleGradient,
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  const intro = serviceIntroSlotForSection(business, deck);
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "intro_grid",
    anchorId: "services",
    options: { background, cardTreatment },
    slots: {
      intro,
      items: { items: dedupeStandardItems(services).slice(0, 3) }
    }
  }, templateOptions);
}

function serviceCardGridSection(
  business: BusinessProfile,
  services: StandardItemV3[],
  deck?: GeneratedCopyDeckV2,
  requestedPresentation?: SectionPresentationMapV3["services"],
  requestedCardTreatment?: IntroGridCardTreatmentV3,
  background: SectionBackgroundOptionV3 = backgrounds.subtleGradient,
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  const intro = serviceIntroSlotForSection(business, deck);
  const servicePresentation = servicePresentationForBusiness(business, deck, requestedPresentation);
  const itemLimit = business.vertical === "auto_body" && servicePresentation === "premium_showcase" ? 4 : 6;
  const cardTreatment: IntroGridCardTreatmentV3 =
    requestedCardTreatment ??
    (servicePresentation === "premium_showcase"
      ? "service_cards"
      : servicePresentation === "showcase_grid"
        ? "feature_cards"
      : servicePresentation === "card_grid" && services.some((service) => Boolean(service.mediaUrl))
        ? "media_top_cards"
        : servicePresentation === "service_problem_rows"
          ? "service_cards"
          : serviceGridCardTreatmentForBusiness(business, services));
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "intro_grid",
    anchorId: "services",
    options: { background, cardTreatment },
    slots: {
      intro,
      items: { items: dedupeStandardItems(services).slice(0, itemLimit) }
    }
  }, templateOptions);
}

function serviceGridCardTreatmentForBusiness(business: BusinessProfile, services: StandardItemV3[]): IntroGridCardTreatmentV3 {
  if (services.some((service) => Boolean(service.mediaUrl))) return "media_top_cards";
  if (business.vertical === "auto_body" || business.vertical === "auto_services") return "editorial_cards";
  return "standard";
}

function serviceRowsSection(
  business: BusinessProfile,
  services: StandardItemV3[],
  deck?: GeneratedCopyDeckV2,
  background: SectionBackgroundOptionV3 = backgrounds.surface
): VisualSectionV3 {
  const intro = serviceIntroSlotForSection(business, deck);
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "services",
    options: { background },
    slots: {
      intro,
      items: { items: dedupeStandardItems(services).slice(0, 4) }
    }
  };
}

function serviceIntroSlotForSection(business: BusinessProfile, deck?: GeneratedCopyDeckV2) {
  if (business.vertical === "auto_body") {
    return {
      eyebrow: "Services",
      heading: serviceHeadingForBusiness(business),
      body: serviceIntroForBusiness(business)
    };
  }
  return {
    eyebrow: "Services",
    heading: deck?.servicesIntro.heading ?? serviceHeadingForBusiness(business),
    body: deck?.servicesIntro.body ?? serviceIntroForBusiness(business)
  };
}

function processRowsSection(
  business: BusinessProfile,
  deck?: GeneratedCopyDeckV2,
  background: SectionBackgroundOptionV3 = backgrounds.surface
): VisualSectionV3 {
  const items = processItemsForSection(business, deck);
  const intro = processIntroSlotForSection(business, deck);
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "process",
    options: { background },
    slots: {
      intro,
      items: { items: dedupeStandardItems(items) }
    }
  };
}

function autoBodyRepairScopeBandSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "feature_band",
    anchorId: "proof",
    options: { background: backgrounds.brandGradient },
    slots: {
      copy: {
        eyebrow: "Repair details",
        heading: "The details show in daylight.",
        body:
            "Panel gaps, trim, lights, paint edges, and driveability all matter when the vehicle is back outside the shop."
      },
      facts: { items: autoBodyRepairScopeFactsForBusiness(business) }
    }
  };
}

function processStepperSection(
  business: BusinessProfile,
  deck: GeneratedCopyDeckV2 | undefined,
  gallery: Array<{ url: string; label: string }>,
  stepTreatment?: "stepper_vertical" | "checklist_cards" | "numbered_ledger",
  background: SectionBackgroundOptionV3 = backgrounds.page,
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  const baseItems = processItemsForSection(business, deck);
  const intro = processIntroSlotForSection(business, deck);
  const effectiveStepTreatment =
    stepTreatment ??
    (business.vertical === "auto_body"
      ? axisPick(business.siteId, "process-step-treatment", ["numbered_ledger", "stepper_vertical"] as const)
      : "stepper_vertical");
  // Per-step media only when the gallery is deep enough to keep steps visually
  // distinct from the hero and mosaic usages.
  const useStepMedia = effectiveStepTreatment === "stepper_vertical" && (business.vertical === "auto_body" ? false : gallery.length >= 4);
  const items =
    useStepMedia
      ? dedupeStandardItems(baseItems).map((item, index) => ({ ...item, mediaUrl: gallery[(index + 1) % gallery.length].url }))
      : dedupeStandardItems(baseItems);
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "numbered_steps",
    anchorId: "process",
    options: {
      background,
      stepTreatment: effectiveStepTreatment
    },
    slots: {
      intro,
      items: { items }
    }
  }, templateOptions);
}

function processIntroSlotForSection(business: BusinessProfile, deck?: GeneratedCopyDeckV2) {
  if (business.vertical === "auto_body" && (!deck || isWeakAutoBodyProcessCopy(`${deck.processIntro.heading} ${deck.processIntro.body}`))) {
    return {
      eyebrow: "Process",
      heading: processHeadingForBusiness(business),
      body: processIntroForBusiness(business)
    };
  }
  const heading = deck?.processIntro.heading ?? processHeadingForBusiness(business);
  const body = deck?.processIntro.body ?? processIntroForBusiness(business);
  return {
    eyebrow: "Process",
    heading,
    body
  };
}

function processItemsForSection(business: BusinessProfile, deck?: GeneratedCopyDeckV2): StandardItemV3[] {
  if (business.vertical === "auto_body") {
    const modelItems = deck?.processSteps ?? [];
    const modelCopy = [deck?.processIntro.heading, deck?.processIntro.body, ...modelItems.flatMap((item) => [item.title, item.body])]
      .filter(Boolean)
      .join(" ");
    if (modelItems.length >= 3 && !isWeakAutoBodyProcessCopy(modelCopy)) {
      return modelItems.map((step, index) => ({ title: step.title, body: step.body, meta: String(index + 1).padStart(2, "0") }));
    }
    return processItemsForBusiness(business).map((item, index) => ({ ...item, meta: String(index + 1).padStart(2, "0") }));
  }
  if (deck) {
    return deck.processSteps.map((step, index) => ({ title: step.title, body: step.body, meta: String(index + 1).padStart(2, "0") }));
  }
  return processItemsForBusiness(business).map((item, index) => ({ ...item, meta: String(index + 1).padStart(2, "0") }));
}

function isWeakAutoBodyProcessCopy(text: string) {
  if (/\b(conversation|discussion|repair-related|centered on the vehicle|work involved|claim and deductible answers)\b/i.test(text)) return true;
  if (/\b(body,\s*dent,\s*hail|vehicle damage in person|repair quote for the auto body|performs the needed|damaged areas|once repairs are finished)\b/i.test(text)) {
    return true;
  }
  const serviceTermHits = text.match(/\b(auto body|paint|dent|hail|scratch|collision|bumper|panel|insurance|self-pay)\b/gi)?.length ?? 0;
  return serviceTermHits >= 12;
}

function processHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "How the repair stays accountable.";
  if (business.vertical === "auto_services") return "From pulling in to driving out.";
  if (business.vertical === "restaurant") return "From order to table.";
  if (business.vertical === "home_services") return "From first call to finished work.";
  if (business.vertical === "beauty_salon") return "From booking to the chair.";
  return "A simple path from first call to shop review.";
}

function processIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "The shop connects the damaged area, repair scope, payment path, and pickup expectations before work moves forward.";
  if (business.vertical === "auto_services") return "Most visits start with a quick look at the tire or the symptom, then a clear price before any work starts.";
  if (business.vertical === "restaurant") return "Order ahead, dine in, or plan something bigger; the kitchen works the same way either way.";
  if (business.vertical === "home_services") return "Most jobs follow the same path: describe the issue, get a window and estimate, and watch the work get done.";
  if (business.vertical === "beauty_salon") return "Booking ahead holds your time and stylist; the plan is confirmed in the chair before anything starts.";
  return "Keep the request focused on timing, fit, and contact details.";
}

function mediaFeatureSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>): VisualSectionV3 {
  const autoBodyHasProofMedia = business.vertical === "auto_body" && gallery.some(isAutoBodyProofMedia);
  const autoBodyMediaItems = autoBodyHasProofMedia ? gallery : gallery.slice(2).length ? gallery.slice(2) : gallery.slice(1).length ? gallery.slice(1) : gallery;
  const media = business.vertical === "auto_body" ? autoBodyProofMediaSlot(autoBodyMediaItems) : mediaSlot(gallery.slice(2, 3).length ? gallery.slice(2, 3) : gallery.slice(0, 1));
  const copy =
    business.vertical === "auto_body"
      ? autoBodyHasProofMedia
        ? {
            eyebrow: "Repair photos",
            heading: "The right repair starts with the whole damaged area.",
            body: "The first look ties the hit area to exposed paint edges, nearby trim, lights, and the panels that have to line up again."
          }
        : {
            eyebrow: "Paint and panels",
            heading: "Look past the first dent.",
            body: "Panel gaps, paint edges, trim clips, light housings, and surface reflections are what make a repair look right after the vehicle leaves."
          }
      : {
          eyebrow: "Gallery",
          heading: mediaHeadingForBusiness(business),
          body: galleryFallbackBody(business)
        };
  return {
    version: "visual-section-v3",
    templateId: "media_feature",
    options: { background: backgrounds.surface },
    slots: {
      copy,
      media
    }
  };
}

function mediaMosaicSection(
  business: BusinessProfile,
  gallery: Array<{ url: string; label: string }>,
  deck?: GeneratedCopyDeckV2,
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  const galleryCopy = distinctGalleryCopyForBusiness(business, deck);
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "media_mosaic",
    options: { background: backgrounds.surface },
    slots: {
      copy: {
        eyebrow: "Gallery",
        heading: galleryCopy.heading,
        body: galleryCopy.body
      },
      media: mediaSlot(normalizeMediaItems(gallery, 3))
    }
  }, templateOptions);
}

function distinctGalleryCopyForBusiness(business: BusinessProfile, deck?: GeneratedCopyDeckV2): { heading: string; body: string } {
  const fallback = {
    heading: business.vertical === "auto_body" ? "Recent repair work from the shop floor." : mediaHeadingForBusiness(business),
    body:
      business.vertical === "auto_body"
        ? "These images show repair conditions, panel access, paint prep, and finished body lines without repeating the detail section."
        : galleryFallbackBody(business)
  };
  if (!deck?.gallery) return fallback;
  const repeatsSplitMedia =
    deck.splitMedia &&
    (copyTextSimilarityV1(deck.gallery.heading, deck.splitMedia.heading) >= 0.58 ||
      copyTextSimilarityV1(`${deck.gallery.heading} ${deck.gallery.body}`, `${deck.splitMedia.heading} ${deck.splitMedia.body}`) >= 0.54);
  if (repeatsSplitMedia) return fallback;
  return deck.gallery;
}

function autoBodyRepairReferenceSection(
  business: BusinessProfile,
  gallery: Array<{ url: string; label: string }>,
  mediaSide: "left" | "right" = "left"
): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "split_media",
    anchorId: "proof",
    options: { background: backgrounds.surface, mediaSide },
    slots: {
      copy: {
        eyebrow: "Repair proof",
        heading: "Panel gaps, paint edges, and finish lines get the attention.",
        body: `${business.name} looks past the obvious hit to the surrounding panels, trim, lights, and surface reflections that decide whether a repair feels right when it leaves the shop.`,
        actions: [business.phone ? autoBodyPhoneCtaForBusiness(business, "Call the shop") : { label: "Send repair details", href: "#contact", style: "text" }]
      },
      media: autoBodyProofMediaSlot(selectAutoBodyRepairReferenceMedia(gallery))
    }
  };
}

function autoBodyBeforeAfterProofSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "proof_pair",
    anchorId: "proof",
    options: { background: backgrounds.surface },
    slots: {
      copy: {
        eyebrow: "Repair proof",
        heading: "Repair proof, before and after.",
        body: "These repair photos show the damaged panel before and after the work, with body fit and finish visible at a glance."
      },
      media: autoBodyProofPairMediaSlot(gallery),
      facts: { items: autoBodyRepairScopeFactsForBusiness(business).slice(0, 3) }
    }
  };
}

function quoteWallSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "quote_wall",
    anchorId: "proof",
    options: { background: backgrounds.subtleGradient },
    slots: {
      intro: {
        eyebrow: "Reviews",
        heading: "What customers have said.",
        body: "Customer comments help show what people noticed about the work, service, and visit."
      },
      items: { items: quoteItemsForBusiness(business).slice(0, 3) }
    }
  };
}

function pricingIntroGridSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "intro_grid",
    anchorId: "services",
    options: { background: backgrounds.subtleGradient, cardTreatment: "comparison" },
    slots: {
      intro: {
        eyebrow: "Pricing",
        heading: "Compare the documented service options.",
        body: "Use the documented package or pricing language to compare the paths before calling."
      },
      items: { items: pricingItemsForBusiness(business).slice(0, 3) }
    }
  };
}

function faqListSection(business: BusinessProfile, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  const deckFaqs = deck ? deck.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })) : [];
  const fallbackFaqs = faqItemsForBusiness(business);
  const faqItems = [...deckFaqs, ...fallbackFaqs.filter((fallback) => !deckFaqs.some((faq) => slugify(faq.question) === slugify(fallback.question)))].slice(0, 4);
  return {
    version: "visual-section-v3",
    templateId: "faq_list",
    anchorId: "faq",
    options: { background: backgrounds.subtleGradient },
    slots: {
      intro: {
        eyebrow: "Questions",
        heading: faqHeadingForBusiness(business),
        body: faqIntroForBusiness(business)
      },
      items: { items: faqItems }
    }
  };
}

function faqIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_services") return "The questions customers ask most before a tire or service visit.";
  if (business.vertical === "auto_body") return "What to share before calling, from repair photos to whether the vehicle still drives.";
  return "The questions customers ask most before a first visit.";
}

function factsStripSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "facts_strip",
    options: { background: backgrounds.subtleGradient },
    slots: { facts: { items: proofFactsForBusiness(business) } }
  };
}

function factsCtaSection(
  business: BusinessProfile,
  background: SectionBackgroundOptionV3 = backgrounds.subtleGradient
): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "facts_cta",
    options: { background },
    slots: {
      facts: { items: proofFactsForBusiness(business).slice(0, 4) },
      action: {
        title: business.phone ? "Talk through the details." : "Start with the details.",
        body:
          business.vertical === "auto_body"
            ? "Shop facts, hours, and repair scope make it easier to decide whether to call before heading over."
            : "Verified contact details and service fit make the first request more straightforward.",
        cta: primaryCtaForBusiness(business)
      }
    }
  };
}

function eligibilityBandSection(
  business: BusinessProfile,
  deck: GeneratedCopyDeckV2 | undefined,
  facts: VisualFactV3[],
  templateOptions?: SectionBlueprintV1["templateOptions"],
  background: SectionBackgroundOptionV3 = backgrounds.surface
): VisualSectionV3 {
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "eligibility_band",
    anchorId: "proof",
    options: { background, eligibilityTreatment: templateOptions?.eligibilityTreatment ?? "statement_plus_list" },
    slots: {
      copy: {
        eyebrow: business.vertical === "auto_body" ? "Insurance & visit fit" : "Good fit",
        heading: business.vertical === "auto_body" ? "Know what the shop can confirm before you visit." : "Confirm the details that make the next step easy.",
        body:
          deck?.splitMedia.body ??
          deck?.servicesIntro.body ??
          (business.vertical === "auto_body"
            ? "Service scope, hours, contact details, and visit expectations are easier to act on when they are listed together."
            : "Verified service, location, and contact details make the first decision easier.")
      },
      facts: { items: facts.slice(0, 6) },
      action: {
        title: business.phone ? "Need a quick confirmation?" : "Need to confirm fit?",
        body: business.phone ? "Call with the service, timing, and any practical constraints." : "Send the details and ask for the best next step.",
        cta: primaryCtaForBusiness(business)
      }
    }
  }, templateOptions);
}

function serviceIndexSection(
  business: BusinessProfile,
  services: StandardItemV3[],
  deck: GeneratedCopyDeckV2 | undefined,
  templateOptions?: SectionBlueprintV1["templateOptions"],
  background: SectionBackgroundOptionV3 = backgrounds.surface
): VisualSectionV3 {
  const dedupedServices = dedupeStandardItems(services).slice(0, 12);
  const requestedTreatment = templateOptions?.serviceIndexTreatment ?? "featured_services_plus_all";
  const serviceIndexTreatment = serviceIndexTreatmentForServiceSetV1(dedupedServices, requestedTreatment);
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "service_index",
    anchorId: "services",
    options: { background, serviceIndexTreatment },
    slots: {
      intro: serviceIntroSlotForSection(business, deck),
      items: { items: dedupedServices },
      action: {
        title: business.phone ? "Not sure which service matches?" : "Need help choosing?",
        body: "Start with the symptom, service, or timing, then confirm the best route before you commit.",
        cta: primaryCtaForBusiness(business)
      }
    }
  }, templateOptions);
}

function serviceIndexTreatmentForServiceSetV1(
  services: StandardItemV3[],
  requested: NonNullable<SectionBlueprintV1["templateOptions"]>["serviceIndexTreatment"]
) {
  if (services.length >= 6) {
    if (requested === "categorized_menu" && serviceItemsHaveCategoryMetadataV1(services)) return "categorized_menu";
    return "dropdown_preview";
  }
  return requested ?? "featured_services_plus_all";
}

function serviceItemsHaveCategoryMetadataV1(services: StandardItemV3[]) {
  const categories = services
    .map((service) => service.meta?.trim().toLowerCase())
    .filter((meta): meta is string => Boolean(meta && !/^(service|services|repair|details?)$/i.test(meta)));
  return new Set(categories).size >= 2;
}

function caseStudyPreviewSection(
  business: BusinessProfile,
  gallery: Array<{ url: string; label: string }>,
  deck: GeneratedCopyDeckV2 | undefined,
  templateOptions?: SectionBlueprintV1["templateOptions"],
  background: SectionBackgroundOptionV3 = backgrounds.page
): VisualSectionV3 {
  const proofFacts = proofFactsForBusiness(business).slice(0, 4);
  const proofCopy = distinctProofCopyForBusiness(business, deck);
  const caseStudyMedia = business.vertical === "auto_body" ? prioritizeCleanCaseStudyMediaForBusinessV1(business, gallery) : gallery;
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "case_study_preview",
    anchorId: "proof",
    options: { background, caseStudyTreatment: templateOptions?.caseStudyTreatment ?? (gallery.length >= 2 ? "before_after_pair" : "story_card") },
    slots: {
      copy: {
        eyebrow: business.vertical === "auto_body" ? "Shop proof" : "Proof point",
        heading: proofCopy?.heading ?? (business.vertical === "auto_body" ? "See the repair details before you call." : "A closer look at the work."),
        body:
          proofCopy?.body ??
          (business.vertical === "auto_body"
            ? "Panel gaps, finish quality, prep work, and final fit are easier to understand when the shop shows the details clearly."
            : "Concrete examples and clear details help customers understand the work before they choose the next step.")
      },
      media: mediaSlot(normalizeMediaItems(caseStudyMedia, Math.min(Math.max(caseStudyMedia.length, 1), 3))),
      ...(proofFacts.length && business.vertical !== "auto_body" ? { facts: { items: proofFacts } } : {})
    }
  }, templateOptions);
}

function distinctProofCopyForBusiness(business: BusinessProfile, deck?: GeneratedCopyDeckV2): { heading: string; body: string } | undefined {
  const fallback =
    business.vertical === "auto_body"
      ? {
          heading: "See the repair details before you call.",
          body: "Panel fit, finish quality, prep work, and final alignment are easier to judge when the shop shows the work from more than one angle."
        }
      : undefined;
  if (!deck?.splitMedia) return fallback ?? deck?.gallery;
  const repeatsGallery =
    deck.gallery &&
    (copyTextSimilarityV1(deck.splitMedia.heading, deck.gallery.heading) >= 0.58 ||
      copyTextSimilarityV1(`${deck.splitMedia.heading} ${deck.splitMedia.body}`, `${deck.gallery.heading} ${deck.gallery.body}`) >= 0.54);
  return repeatsGallery ? fallback ?? deck.splitMedia : deck.splitMedia;
}

function copyTextSimilarityV1(left: string | undefined, right: string | undefined) {
  const leftTokens = copyTokenSetV1(left);
  const rightTokens = copyTokenSetV1(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function copyTokenSetV1(value: string | undefined) {
  const stop = new Set(["and", "the", "with", "for", "from", "that", "this", "your", "our", "into", "here", "work"]);
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stop.has(token))
  );
}

function prioritizeCleanCaseStudyMediaForBusinessV1(
  business: BusinessProfile,
  items: Array<{ url: string; label: string }>
): Array<{ url: string; label: string }> {
  if (items.length < 2) return items;
  const clean = items.filter((item) => isCleanCaseStudyLeadMediaV1(business, item));
  if (clean.length) return clean;
  return items.filter((item) => !isLikelyComposedProofArtifactMediaV1(item));
}

function isCleanCaseStudyLeadMediaV1(business: BusinessProfile, item: { url: string; label: string }) {
  if (isLikelyComposedProofArtifactMediaV1(item)) return false;
  const asset = business.photos.find((photo) => mediaIdentityKey(photo.url) === mediaIdentityKey(item.url));
  if (!asset) return true;
  const warningText = [
    ...(asset.analysisV1?.version === "asset-analysis-v1" ? asset.analysisV1.warnings : [])
  ].join(" ");
  return !/\b(collage|composite|text_overlay|logo_like|awkward_empty_space)\b/i.test(warningText);
}

function isLikelyComposedProofArtifactMediaV1(item: { url: string; label: string }) {
  return /\b(before|after|full vehicle|color transformation|transformation|collage|composite|overlay|banner|flyer|graphic|screenshot)\b/i.test(`${item.url} ${item.label}`);
}

function comparisonTableSection(
  business: BusinessProfile,
  items: StandardItemV3[],
  deck: GeneratedCopyDeckV2 | undefined,
  templateOptions?: SectionBlueprintV1["templateOptions"],
  background: SectionBackgroundOptionV3 = backgrounds.subtleGradient
): VisualSectionV3 {
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "comparison_table",
    anchorId: "services",
    options: { background, comparisonTreatment: templateOptions?.comparisonTreatment ?? "feature_compare" },
    slots: {
      intro: {
        eyebrow: "Compare",
        heading: deck?.servicesIntro.heading ?? (business.vertical === "auto_body" ? "Match the damage to the right first conversation." : "Compare the common service paths."),
        body:
          deck?.servicesIntro.body ??
          (business.vertical === "auto_body"
            ? "Different repair areas call for different first questions, from paint match and panel fit to whether the vehicle still drives."
            : "Different service paths are easier to compare when the practical differences are shown side by side.")
      },
      items: { items: dedupeStandardItems(items).slice(0, 6) },
      action: {
        title: "Still deciding?",
        body: "The fastest route is to describe what you need and confirm the right fit.",
        cta: primaryCtaForBusiness(business)
      }
    }
  }, templateOptions);
}

function teamStorySection(
  business: BusinessProfile,
  gallery: Array<{ url: string; label: string }>,
  deck: GeneratedCopyDeckV2 | undefined,
  templateOptions?: SectionBlueprintV1["templateOptions"],
  background: SectionBackgroundOptionV3 = backgrounds.surface
): VisualSectionV3 {
  const facts = proofFactsForBusiness(business).slice(0, 4);
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "team_story",
    anchorId: "about",
    options: { background, teamStoryTreatment: templateOptions?.teamStoryTreatment ?? (gallery.length ? "portrait_split" : "founder_card") },
    slots: {
      copy: {
        eyebrow: "About",
        heading: deck?.about?.heading ?? `The people behind ${business.name}.`,
        body: deck?.about?.body ?? `${business.name} brings the service, location, and customer handoff into one clear local business presence.`,
        actions: [primaryCtaForBusiness(business)]
      },
      ...(gallery.length ? { media: mediaSlot(gallery.slice(0, 1)) } : {}),
      ...(facts.length ? { facts: { items: facts } } : {})
    }
  }, templateOptions);
}

function offerBandSection(
  business: BusinessProfile,
  deck: GeneratedCopyDeckV2 | undefined,
  templateOptions?: SectionBlueprintV1["templateOptions"],
  background: SectionBackgroundOptionV3 = backgrounds.brandGradient
): VisualSectionV3 {
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "offer_band",
    anchorId: "contact",
    options: { background, offerBandTreatment: templateOptions?.offerBandTreatment ?? "quiet_offer" },
    slots: {
      copy: {
        eyebrow: business.vertical === "auto_body" ? "Estimate" : "Next step",
        heading: deck?.contactIntro.heading ?? (business.vertical === "auto_body" ? "Start with the vehicle details." : "Start with the details that matter."),
        body:
          deck?.contactIntro.body ??
          (business.vertical === "auto_body"
            ? "Share where the vehicle was hit, whether it still drives, and the timing you need so the first response can stay focused."
            : "Send the service, timing, and best callback details so the first response can stay focused.")
      },
      action: {
        title: business.phone ? "Talk through the next step." : "Send the request.",
        body: business.phone ? "A short call can confirm fit, timing, and what to bring." : "A short message is enough to start.",
        cta: primaryCtaForBusiness(business)
      },
      facts: { items: proofFactsForBusiness(business).slice(0, 4) }
    }
  }, templateOptions);
}

function statBandSection(
  business: BusinessProfile,
  background: SectionBackgroundOptionV3 = backgrounds.brandGradient
): VisualSectionV3 {
  const fact = proofFactsForBusiness(business)[0] ?? { label: "Service", value: business.categories[0] ?? business.vertical };
  return {
    version: "visual-section-v3",
    templateId: "stat_band",
    anchorId: "proof",
    options: { background },
    slots: {
      facts: { items: [fact] },
      copy: {
        eyebrow: "Quick read",
        heading: business.vertical === "auto_body" ? "Repair details before the visit." : "The important detail, up front.",
        body:
          business.vertical === "auto_body"
            ? "Drivers can compare the shop details, service scope, and next step before deciding whether to call, visit, or request an estimate."
            : `${business.name} keeps the first decision focused on the service, location, and best next step.`
      },
      action: {
        title: business.phone ? "Need a straight answer?" : "Ready to ask?",
        cta: primaryCtaForBusiness(business)
      }
    }
  };
}

function genericFeatureBandSection(
  business: BusinessProfile,
  background: SectionBackgroundOptionV3 = backgrounds.brandGradient
): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "feature_band",
    anchorId: "proof",
    options: { background },
    slots: {
      copy: {
        eyebrow: "Why it matters",
        heading: business.vertical === "auto_body" ? "Small details shape the first estimate." : "Start with the facts that matter.",
        body:
          business.vertical === "auto_body"
            ? "Panel location, paint condition, trim, lighting, and whether the vehicle still drives all shape the first estimate conversation."
            : "The page brings the verified service and contact details forward so the next step is clear."
      },
      facts: { items: proofFactsForBusiness(business).slice(0, 4) },
      action: {
        title: business.phone ? "Confirm the fit." : "Send the request.",
        cta: primaryCtaForBusiness(business)
      }
    }
  };
}

function aboutStorySection(
  business: BusinessProfile,
  deck?: GeneratedCopyDeckV2,
  deterministicStory?: { heading: string; body: string }
): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "editorial_statement",
    anchorId: "about",
    options: { background: backgrounds.subtleGradient },
    slots: {
      copy: {
        eyebrow: "About",
        heading: deck?.about?.heading ?? deterministicStory?.heading ?? `The people behind ${business.name}.`,
        body: deck?.about?.body ?? deterministicStory?.body ?? "",
        actions: [primaryCtaForBusiness(business)]
      }
    }
  };
}

function editorialStatementSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "editorial_statement",
    options: { background: backgrounds.surface },
    slots: {
      copy: {
        eyebrow: "Action",
        heading: business.vertical === "auto_body" ? "Call before you visit." : "The first step should be simple.",
        body:
          business.vertical === "auto_body"
            ? `Confirm the shop is open and ask whether the vehicle should come in today.`
            : `${business.name} keeps the request focused on the service, timing, and best callback details.`,
        actions: [primaryCtaForBusiness(business)]
      }
    }
  };
}

/**
 * Conversion band: full-bleed brand-color CTA before the contact section — the
 * "Ready for new tires?" moment. Copy is deterministic and fact-grounded
 * (primary service + phone); the brand background carries the energy.
 */
function conversionBandSection(
  business: BusinessProfile,
  backgroundUrl?: string,
  tone?: CtaBandToneV3,
  focalPoint?: BackgroundFocalPointV3
): VisualSectionV3 {
  const primaryService = business.services[0];
  const heading =
    business.vertical === "auto_body"
      ? "Bring the damage into focus."
      : primaryService
        ? `Need ${primaryService.toLowerCase()}?`
        : `Ready when you are.`;
  const body =
    business.vertical === "auto_body" && business.phone
      ? `Call ${formatPhone(business.phone)} with what happened, where the vehicle was hit, and when you can bring it by.`
      : business.phone
        ? `Call ${formatPhone(business.phone)} for a straight answer on price and timing.`
        : "Send the details and we'll get right back to you.";
  // ctaBandTone control: "paper" exists so page bottoms can avoid stacking two
  // dark bands around the location panel. Default keeps the brand gradient.
  const toneBackground: SectionBackgroundOptionV3 =
    tone === "dark" ? { kind: "solid", token: "dark" } : tone === "paper" ? backgrounds.surface : backgrounds.brandGradient;
  return {
    version: "visual-section-v3",
    templateId: "editorial_statement",
    anchorId: "cta",
    options: { background: backgroundUrl ? { kind: "image", url: backgroundUrl, focalPoint: focalPoint ?? "center" } : toneBackground },
    slots: {
      copy: {
        heading,
        body,
        actions: [business.vertical === "auto_body" ? { label: "Start a repair request", href: "#contact", style: "primary" } : primaryCtaForBusiness(business)]
      }
    }
  };
}

function locationDirectorySection(
  business: BusinessProfile,
  locationContext: LocationCompileContextV3,
  deck?: GeneratedCopyDeckV2,
  background: SectionBackgroundOptionV3 = backgrounds.surface
): VisualSectionV3 {
  const locationCount = locationContext.physicalLocations.length;
  return {
    version: "visual-section-v3",
    templateId: "location_directory",
    anchorId: "location",
    options: { background },
    slots: {
      copy: {
        eyebrow: "Locations",
        heading: deck?.locationIntro?.heading ?? "Choose the right location before you reach out.",
        body:
          deck?.locationIntro?.body ??
          `${business.name} has ${locationCount} documented locations. Pick the one that fits your visit before calling or getting directions.`
      },
      locations: { locations: locationContext.physicalLocations },
      action: {
        title: business.phone ? "Not sure which location fits?" : "Need help choosing?",
        body: business.phone ? "Call first to confirm hours, arrival details, and the best location for the work." : "Send the details to confirm the right location and timing.",
        cta: primaryCtaForBusiness(business)
      }
    }
  };
}

function serviceAreaShowcaseSection(
  business: BusinessProfile,
  locationContext: LocationCompileContextV3,
  deck?: GeneratedCopyDeckV2,
  background: SectionBackgroundOptionV3 = backgrounds.surface
): VisualSectionV3 {
  const areas = locationContext.serviceAreas.slice(0, 6);
  return {
    version: "visual-section-v3",
    templateId: "service_area_showcase",
    anchorId: "location",
    options: { background },
    slots: {
      copy: {
        eyebrow: "Service area",
        heading: deck?.locationIntro?.heading ?? "Coverage details before you reach out.",
        body:
          deck?.locationIntro?.body ??
          `${business.name} serves the listed areas with visit timing and coverage handled before arrival.`
      },
      facts: {
        items: areas.map((area, index) => ({
          label: index === 0 ? "Serves" : "Also serves",
          value: area
        }))
      },
      action: {
        title: business.phone ? "Confirm the visit." : "Start with the visit details.",
        body: business.phone ? "Call to confirm coverage, timing, and what to bring." : "Send the details to confirm coverage and timing.",
        cta: primaryCtaForBusiness(business)
      }
    }
  };
}

function locationShowcaseSection(
  business: BusinessProfile,
  locationContext: LocationCompileContextV3,
  deck?: GeneratedCopyDeckV2,
  background: SectionBackgroundOptionV3 = backgrounds.page,
  templateOptions?: SectionBlueprintV1["templateOptions"]
): VisualSectionV3 {
  const primaryLocation = locationContext.primaryLocation ?? locationContext.physicalLocations[0];
  const addressLine =
    primaryLocation?.addressLine && primaryLocation.localityLine && primaryLocation.addressLine.toLowerCase().includes(primaryLocation.localityLine.toLowerCase())
      ? primaryLocation.addressLine
      : [primaryLocation?.addressLine, primaryLocation?.localityLine].filter(Boolean).join(", ");
  const locationHeading =
    business.vertical === "auto_body"
      ? business.address?.street && business.address.city
        ? `${shortStreetLabel(business.address.street).replace(/\.+$/, "")} shop hours and directions.`
        : "Shop hours, directions, and a phone number."
      : "Location, hours, and directions.";
  const locationBody =
    business.vertical === "auto_body"
      ? addressLine
        ? `Find the shop at ${addressLine}. Check hours, get directions, or call before heading over with photos or a repair question.`
        : "Check shop hours, get directions, or call before heading over with photos or a repair question."
      : addressLine
        ? `${business.name} keeps the practical visit details for ${addressLine} — hours, address, and directions — one glance away.`
        : `${business.name} keeps the practical visit details — hours, address, and directions — one glance away.`;
  const safeTemplateOptions = safeLocationShowcaseTemplateOptionsV3(locationContext, templateOptions);
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "location_showcase",
    anchorId: "location",
    options: { background },
    slots: {
      copy: {
        eyebrow: "Location & hours",
        heading: business.vertical === "auto_body" ? locationHeading : deck?.locationIntro?.heading ?? locationHeading,
        body: business.vertical === "auto_body" ? locationBody : deck?.locationIntro?.body ?? locationBody
      },
      locations: { locations: locationContext.locations }
    }
  }, safeTemplateOptions);
}

function safeLocationShowcaseTemplateOptionsV3(
  locationContext: LocationCompileContextV3,
  templateOptions: SectionBlueprintV1["templateOptions"] | undefined
): SectionBlueprintV1["templateOptions"] | undefined {
  const shouldShowWeeklyHours =
    locationContext.physicalLocations.length === 1 &&
    locationContext.physicalLocations.some((location) =>
      location.hours?.some((entry) => /sat|sun|weekend/i.test(entry.label) && entry.value && !/closed/i.test(entry.value))
    );
  if (!shouldShowWeeklyHours || templateOptions?.hoursDisplay !== "today_first") return templateOptions;
  return { ...templateOptions, hoursDisplay: "full_week" };
}

function shortStreetLabel(street: string) {
  return street.replace(/^\d+\s+/, "").trim() || street;
}

function contactSplitSection(
  business: BusinessProfile,
  locationContext?: LocationCompileContextV3,
  deck?: GeneratedCopyDeckV2,
  options?: { includeLocationAnchor?: boolean; templateOptions?: SectionBlueprintV1["templateOptions"] }
): VisualSectionV3 {
  const contactIntro =
    business.vertical === "auto_body"
      ? autoBodyHasQuoteCtaEvidence(business)
        ? {
            heading: "Request a repair estimate.",
            body: `Share where the vehicle was hit, whether it still drives normally, and when you are hoping to bring it in. ${business.name} can start the estimate from the repair details that matter.`
          }
        : {
            heading: business.address?.city ? `Call ${business.name} in ${business.address.city}.` : `Call ${business.name}.`,
            body: "Keep the first call focused on the vehicle: where it was damaged, whether it drives normally, timing, and the best callback number."
          }
      : {
          heading: deck?.contactIntro.heading ?? (business.phone ? "Call or send a short message." : "Send a short message."),
          body: deck?.contactIntro.body ?? "Include what you need, any timing constraints, and the best callback details."
        };
  return withDirectorTemplateOptionsV1({
    version: "visual-section-v3",
    templateId: "contact_split",
    anchorId: "contact",
    options: { background: backgrounds.brandGradient },
    slots: {
      copy: {
        eyebrow: "Contact",
        heading: contactIntro.heading,
        body: contactIntro.body,
        actions: [business.vertical === "auto_body" ? autoBodyPhoneCtaForBusiness(business, "Call the shop") : primaryCtaForBusiness(business)]
      },
      contact: { facts: contactFactsForBusiness(business, locationContext, options) }
    }
  }, options?.templateOptions);
}

function visualSection(id: string, family: string, section: VisualSectionV3): SectionInstanceV3 {
  return {
    id,
    family,
    variant: section.templateId,
    props: withVisualSectionV3({ renderPath: "generated_site_v3" }, section),
    controls: controlForTemplate(section.templateId),
    slots: [],
    responsiveRules: responsiveRulesForTemplate(section.templateId),
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: {
      minimumValidSlots: ["heading"],
      omitWhenMissingFactKinds: [],
      blockWhenMissingFactKinds: [],
      gracefulDegradation: "Render the generated section with honest local-business content."
    }
  };
}

function withDirectorTemplateOptionsV1(section: VisualSectionV3, templateOptions?: SectionBlueprintV1["templateOptions"]): VisualSectionV3 {
  if (!templateOptions) return section;
  const { heroAlign: _heroAlign, ...renderedOptions } = templateOptions;
  if (!Object.keys(renderedOptions).length) return section;
  const compatibleOptions = compatibleDirectorTemplateOptionsV1(section, renderedOptions);
  return {
    ...section,
    options: {
      ...section.options,
      ...compatibleOptions
    }
  } as VisualSectionV3;
}

function compatibleDirectorTemplateOptionsV1(
  section: VisualSectionV3,
  renderedOptions: Omit<NonNullable<SectionBlueprintV1["templateOptions"]>, "heroAlign">
): Omit<NonNullable<SectionBlueprintV1["templateOptions"]>, "heroAlign"> {
  if (section.templateId === "service_index") {
    const services = ((section.slots as { items?: { items?: StandardItemV3[] } }).items?.items ?? []) as StandardItemV3[];
    const requested = renderedOptions.serviceIndexTreatment;
    if (services.length >= 6) {
      return {
        ...renderedOptions,
        serviceIndexTreatment:
          requested === "categorized_menu" && serviceItemsHaveCategoryMetadataV1(services)
            ? "categorized_menu"
            : "dropdown_preview"
      };
    }
  }
  if (section.templateId === "hero_split" || section.templateId === "hero_statement") {
    const next = { ...renderedOptions };
    const heading = heroHeadingForSectionV1(section);
    const longHeading = headingLengthScoreV1(heading) >= 25 || heading.split(/\s+/).filter(Boolean).length >= 5;
    const mediaHeavy = next.mediaTreatment === "bleed" || next.mediaTreatment === "collage_pair" || next.heroLayout === "full_bleed_masthead";
    if (longHeading && next.headlineScale === "display") next.headlineScale = "standard";
    if (longHeading && next.ctaLayout === "stacked" && mediaHeavy) next.ctaLayout = "button_plus_text_link";
    if (longHeading && next.mediaTreatment === "bleed" && next.heroLayout === "classic_split") next.mediaTreatment = "framed";
    if (section.templateId === "hero_statement" && section.options.background.kind !== "image" && next.heroLayout === "full_bleed_masthead") {
      next.heroLayout = "card_overlay";
      next.proofPlacement = next.proofPlacement === "side_panel" ? "bottom_strip" : next.proofPlacement;
    }
    return next;
  }
  if (
    section.templateId === "contact_split" &&
    renderedOptions.formComplexity === "none" &&
    renderedOptions.contactLayout === "form_first"
  ) {
    return {
      ...renderedOptions,
      contactLayout: "call_first"
    };
  }
  return renderedOptions;
}

function heroHeadingForSectionV1(section: VisualSectionV3) {
  const copy = (section.slots as { copy?: { heading?: string } }).copy;
  return copy?.heading ?? "";
}

function headingLengthScoreV1(value: string) {
  return value.replace(/\s+/g, " ").trim().length;
}

function controlForTemplate(templateId: SectionTemplateIdV3): ComponentControlSchemaV3 {
  const layout = controlLayoutForTemplate(templateId);
  return {
    layout,
    alignment: layout === "single_column" ? "center" : "split",
    width: "wide",
    padding: "spacious",
    background: templateId === "contact_split" ? "contrast" : "surface",
    mediaCrop:
      templateId === "hero_split" ||
      templateId === "split_media" ||
      templateId === "proof_pair" ||
      templateId === "media_feature" ||
      templateId === "media_mosaic" ||
      templateId === "case_study_preview" ||
      templateId === "team_story"
        ? "subject"
        : "none",
    density: "open"
  };
}

function controlLayoutForTemplate(templateId: SectionTemplateIdV3): ComponentControlSchemaV3["layout"] {
  switch (templateId) {
    case "hero_split":
    case "split_media":
      return "two_column";
    case "hero_statement":
    case "facts_strip":
    case "editorial_statement":
      return "single_column";
    case "intro_grid":
    case "service_index":
    case "comparison_table":
    case "quote_wall":
      return "card_grid";
    case "side_intro_rows":
    case "numbered_steps":
    case "faq_list":
      return "editorial_rows";
    case "feature_band":
    case "stat_band":
    case "proof_pair":
    case "eligibility_band":
    case "case_study_preview":
    case "team_story":
    case "offer_band":
      return "architectural_split";
    case "media_feature":
      return "asymmetric_grid";
    case "media_mosaic":
      return "mosaic_grid";
    case "facts_cta":
      return "story_panel";
    case "location_directory":
    case "service_area_showcase":
    case "location_showcase":
      return "architectural_split";
    case "contact_split":
      return "contact_panel";
  }
}

function responsiveRulesForTemplate(templateId: SectionTemplateIdV3): SectionInstanceV3["responsiveRules"] {
  return [
    { breakpoint: "mobile", behavior: "stack", notes: [`${templateId} stacks to one column and preserves source order.`] },
    { breakpoint: "tablet", behavior: "stack", notes: [`${templateId} uses deterministic tablet stacking to avoid horizontal overflow.`] },
    { breakpoint: "desktop", behavior: "preserve_crop", notes: [`${templateId} preserves the desktop section geometry.`] }
  ];
}

/**
 * Backup imagery for the rights-declined path: the gallery this business
 * would have received if its scraped photos did not exist (curated library /
 * stock only). Used by preview rights simulation and, eventually, the
 * publish-time fallback when an owner declines media attestation.
 */
export function backupGalleryForRightsFallbackV3(
  business: BusinessProfile,
  assetLibraryAssets: ApprovedAssetLibraryAsset[] = []
): Array<{ url: string; label: string }> {
  const publicSafeBusiness: BusinessProfile = {
    ...business,
    photos: business.photos.filter((asset) => isPublicSafeMedia(asset))
  };
  return galleryForSelectedMedia(selectV3Media(publicSafeBusiness, assetLibraryAssets));
}

function selectV3Media(business: BusinessProfile, assetLibraryAssets: ApprovedAssetLibraryAsset[] = []): SelectedV3Media {
  // Customer-granted/preclaim-safe business photos win. Privately scraped
  // reference media is a later fallback for non-automotive verticals; for
  // automotive sites, curated category media is usually stronger and publishable
  // without owner attestation than low-quality source-page thumbnails.
  const publicSafePhotos = business.photos.filter(isPublicSafeMedia);
  const publicSafeHero = publicSafePhotos[0];
  if (publicSafeHero) {
    return businessMediaSelection(business, publicSafeHero, publicSafePhotos);
  }
  if (business.vertical === "auto_services" || business.vertical === "auto_body") {
    const libraryMedia = selectAutomotiveLibraryMedia(business, assetLibraryAssets);
    if (business.vertical !== "auto_body" && libraryMedia) return libraryMedia;
    if (business.vertical === "auto_services") return autoServicesFallbackContextMedia(business);
    if (business.vertical === "auto_body") {
      const protectedPreviewPhotos = business.photos.filter(
        (asset) =>
          isProtectedPreviewEligibleMedia(asset) &&
          !isLikelyLogoOnlyMedia(asset, business)
      );
      const proofPhotos = protectedPreviewPhotos.filter(isLikelyAutoBodyProofReferenceMedia);
      const contextPreviewPhotos = protectedPreviewPhotos.filter((asset) => !isLikelyCompositedAutoBodyGraphicMedia(asset));
      const strongContextPhotos = contextPreviewPhotos.filter(isUsableFirstPartyContextMedia);
      const protectedHeroPhoto = strongestFirstPartyHeroPhoto(strongContextPhotos);
      if (protectedHeroPhoto && (strongContextPhotos.length >= 2 || proofPhotos.length)) {
        return autoBodyMediaSelectionWithProof(
          business,
          businessMediaSelection(business, protectedHeroPhoto, prioritizeFirstPartyMediaForGallery(strongContextPhotos, protectedHeroPhoto)),
          proofPhotos.length ? proofPhotos : contextPreviewPhotos
        );
      }
      if (libraryMedia) return autoBodyMediaSelectionWithProof(business, libraryMedia, proofPhotos.length ? proofPhotos : contextPreviewPhotos);
      if (proofPhotos.length || contextPreviewPhotos.length >= 2) return autoBodyMediaSelectionWithProof(business, autoBodyFallbackContextMedia(business), proofPhotos.length ? proofPhotos : contextPreviewPhotos);
    }
  }
  if (business.vertical === "auto_body") {
    return autoBodyFallbackContextMedia(business);
  }
  // Protected preview fallback: useful when no stronger public-safe media exists,
  // but publish still requires owner attestation.
  const heroPhoto = business.photos.find((asset) => isProtectedPreviewEligibleMedia(asset));
  if (heroPhoto) {
    return businessMediaSelection(business, heroPhoto, business.photos.filter(isProtectedPreviewEligibleMedia));
  }
  return {
    kind: "text",
    decisions: [
      {
        id: `media_${business.siteId}_text_fallback`,
        version: "media-asset-decision-v3",
        slotId: "home.hero.panel",
        source: "text_layout_fallback",
        rightsStatus: "approved",
        usageScope: "hero",
        policyNotes: ["Text-first layout selected because no approved public-safe media is available."],
        mayImplyRealBusinessWork: false
      }
    ]
  };
}

function businessMediaSelection(
  business: BusinessProfile,
  heroPhoto: AssetReference,
  photos: AssetReference[]
): SelectedV3Media {
  const eligibleGallery: SiteMediaItemV3[] = photos.slice(0, 5).map((asset) => ({
    url: asset.url,
    label: asset.alt || "Business photo",
    focalPoint: focalPointForAssetContentV1(asset),
    cropIntent: cropIntentForBusinessPhotoV1(asset)
  }));
  const requiresAttestation = !isPublicSafeMedia(heroPhoto) || photos.some((asset) => !isPublicSafeMedia(asset));
  return {
    kind: "media",
    heroUrl: heroPhoto.url,
    gallery: eligibleGallery.length
      ? eligibleGallery
      : [{
          url: heroPhoto.url,
          label: heroPhoto.alt || "Business photo",
          focalPoint: focalPointForAssetContentV1(heroPhoto),
          cropIntent: cropIntentForBusinessPhotoV1(heroPhoto)
        }],
    decisions: [
      {
        id: `media_${business.siteId}_hero`,
        version: "media-asset-decision-v3",
        slotId: "home.hero.media",
        source: mediaSourceForAsset(heroPhoto),
        rightsStatus: requiresAttestation ? "owner_attestation_required" : "approved",
        usageScope: "hero",
        sourceUrl: heroPhoto.url,
        policyNotes: requiresAttestation
          ? ["Real scraped business media on a protected preview; publishing requires per-photo owner attestation."]
          : ["Selected from public-safe business media."],
        mayImplyRealBusinessWork: heroPhoto.rightsStatus === "customer_granted"
      }
    ]
  };
}

function autoBodyFallbackContextMedia(business: BusinessProfile): SelectedV3Media {
  return generatedRegistryMediaSelection({
    business,
    vertical: "auto_body",
    decisionId: `media_${business.siteId}_auto_context`,
    policyNote: "Generated generic auto-body category media. Does not imply real business staff, location, or documented customer work."
  });
}

function autoServicesFallbackContextMedia(business: BusinessProfile): SelectedV3Media {
  return generatedRegistryMediaSelection({
    business,
    vertical: "auto_services",
    decisionId: `media_${business.siteId}_auto_services_context`,
    policyNote: "Generated generic auto-service category media. Does not imply real business staff, location, vehicles, or documented customer work."
  });
}

function generatedRegistryMediaSelection(input: {
  business: BusinessProfile;
  vertical: Vertical;
  decisionId: string;
  policyNote: string;
}): SelectedV3Media {
  const gallery: SiteMediaItemV3[] = imageAssetsForVertical(input.vertical).map((asset) => ({
    url: asset.url,
    label: asset.label || asset.alt || "Generated category media",
    focalPoint: "center",
    cropIntent: "wide"
  }));
  if (!gallery.length) {
    return {
      kind: "text",
      decisions: [
        {
          id: `${input.decisionId}_text_fallback`,
          version: "media-asset-decision-v3",
          slotId: "home.hero.panel",
          source: "text_layout_fallback",
          rightsStatus: "approved",
          usageScope: "hero",
          policyNotes: ["Text-first layout selected because no approved generated registry media is available."],
          mayImplyRealBusinessWork: false
        }
      ]
    };
  }
  return {
    kind: "media",
    heroUrl: gallery[0].url,
    gallery,
    decisions: [
      {
        id: input.decisionId,
        version: "media-asset-decision-v3",
        slotId: "home.hero.media",
        source: "generated_ai",
        rightsStatus: "approved",
        usageScope: "hero",
        sourceUrl: gallery[0].url,
        policyNotes: [input.policyNote],
        mayImplyRealBusinessWork: false
      }
    ]
  };
}

function autoBodyMediaSelectionWithProof(
  business: BusinessProfile,
  contextMedia: SelectedV3Media,
  proofPhotos: AssetReference[]
): SelectedV3Media {
  if (contextMedia.kind !== "media") return contextMedia;
  const proofGallery = normalizeMediaItems(
    proofPhotos.map((asset) => ({
      url: asset.url,
      label: /\bbefore\b|\bafter\b|\brepair\b|\bfinished\b|\bproof\b/i.test(asset.alt)
        ? asset.alt
        : "Before-and-after repair reference",
      focalPoint: focalPointForAssetContentV1(asset),
      cropIntent: "subject" as const
    })),
    6
  );
  if (!proofGallery.length) return contextMedia;
  return {
    kind: "media",
    heroUrl: contextMedia.heroUrl,
    conversionBackgroundUrl: contextMedia.conversionBackgroundUrl,
    conversionBackgroundFocalPoint: contextMedia.conversionBackgroundFocalPoint,
    gallery: normalizeMediaItems([...contextMedia.gallery.slice(0, 4), ...proofGallery, ...contextMedia.gallery.slice(4)], 12),
    decisions: [
      ...contextMedia.decisions,
      {
        id: `media_${business.siteId}_auto_body_reference_proof`,
        version: "media-asset-decision-v3",
        slotId: "home.proof.before_after",
        source: "first_party",
        rightsStatus: "owner_attestation_required",
        usageScope: "section",
        sourceUrl: proofGallery[0]?.url ?? contextMedia.heroUrl,
        policyNotes: ["Real scraped business repair media is reserved for protected preview proof sections; publishing requires owner attestation."],
        mayImplyRealBusinessWork: true
      }
    ]
  };
}

/**
 * Library asset ids encode generation variants ("..._001_1_76", "..._001_2_fc"
 * are the same scene). Selecting by id alone fills a page with near-identical
 * shots; family-level dedupe keeps each slot visually distinct.
 */
function assetPromptFamily(asset: ApprovedAssetLibraryAsset) {
  return asset.promptMetadata?.sceneFamily || asset.id.split("_").slice(0, -2).join("_") || asset.id;
}

function selectAutomotiveLibraryMedia(
  business: BusinessProfile,
  assetLibraryAssets: ApprovedAssetLibraryAsset[]
): SelectedV3Media | undefined {
  const allApproved = assetLibraryAssets.filter(
    (asset) => asset.publicUrl && assessAssetLibraryPolicy(asset).siteSelectable && isAssetLibraryAssetAllowedForBusiness(asset, business)
  );
  const visualApproved = allApproved.filter((asset) => !asset.intendedUses.includes("background"));
  if (!visualApproved.length) return undefined;
  // Per-site rotation: different sites start from different assets so the
  // fleet does not converge on the same top-ranked imagery.
  const offset = siteVariationSeedV2(`${business.siteId}:media`) % visualApproved.length;
  const approved = [...visualApproved.slice(offset), ...visualApproved.slice(0, offset)];

  const usedAssetIds = new Set<string>();
  const usedFamilies = new Set<string>();
  const poolFor = (assets: ApprovedAssetLibraryAsset[] = approved) => {
    return assets.filter((asset) => !usedFamilies.has(assetPromptFamily(asset)));
  };
  const markUsed = (asset: ApprovedAssetLibraryAsset) => {
    usedAssetIds.add(asset.id);
    usedFamilies.add(assetPromptFamily(asset));
  };

  const heroSelection = selectApprovedAssetLibraryMedia({
    business,
    assets: poolFor(),
    intendedUse: "hero",
    usedAssetIds
  });
  const heroAsset = heroSelection.asset;
  if (!heroAsset?.publicUrl) return undefined;
  markUsed(heroAsset);

  const galleryAssets: ApprovedAssetLibraryAsset[] = [heroAsset];
  for (const intendedUse of ["section", "card", "gallery"]) {
    const selection = selectApprovedAssetLibraryMedia({
      business,
      assets: poolFor(),
      intendedUse,
      usedAssetIds
    });
    if (selection.asset?.publicUrl) {
      markUsed(selection.asset);
      galleryAssets.push(selection.asset);
    }
    if (galleryAssets.length >= 4) break;
  }
  if (galleryAssets.length < 4) {
    for (const asset of poolFor()) {
      if (!asset.publicUrl || usedAssetIds.has(asset.id)) continue;
      markUsed(asset);
      galleryAssets.push(asset);
      if (galleryAssets.length >= 4) break;
    }
  }
  const backgroundPool = allApproved.filter(
    (asset) => asset.intendedUses.includes("background") && asset.promptMetadata?.compositionTemplate === "soft_blur_background"
  );
  const backgroundSelection = selectApprovedAssetLibraryMedia({
    business,
    assets: poolFor(backgroundPool),
    intendedUse: "background",
    usedAssetIds
  });
  const backgroundAsset = backgroundSelection.asset?.publicUrl ? backgroundSelection.asset : undefined;
  if (backgroundAsset) markUsed(backgroundAsset);

  const gallery = galleryAssets.map((asset) => ({
    url: asset.publicUrl as string,
    label: libraryAssetAlt(asset)
  }));
  const decisions: MediaAssetDecisionV3[] = [
    {
      id: `media_${business.siteId}_asset_library_${heroAsset.id}`,
      version: "media-asset-decision-v3",
      slotId: "home.hero.media",
      source: "generated_ai",
      rightsStatus: "preclaim_safe",
      usageScope: "hero",
      sourceUrl: heroAsset.publicUrl,
      artifactRef: heroAsset.id,
      policyNotes: [
        ...heroSelection.notes,
        assetLibraryApprovedLicenseNote(heroAsset.id)
      ],
      mayImplyRealBusinessWork: false
    }
  ];
  if (backgroundAsset?.publicUrl) {
    decisions.push({
      id: `media_${business.siteId}_asset_library_${backgroundAsset.id}_background`,
      version: "media-asset-decision-v3",
      slotId: "home.conversion.background",
      source: "generated_ai",
      rightsStatus: "preclaim_safe",
      usageScope: "background",
      sourceUrl: backgroundAsset.publicUrl,
      artifactRef: backgroundAsset.id,
      policyNotes: [
        ...backgroundSelection.notes,
        assetLibraryApprovedLicenseNote(backgroundAsset.id)
      ],
      mayImplyRealBusinessWork: false
    });
  }
  return {
    kind: "media",
    heroUrl: heroAsset.publicUrl,
    conversionBackgroundUrl: backgroundAsset?.publicUrl,
    conversionBackgroundFocalPoint: "center",
    gallery,
    decisions
  };
}

function libraryAssetAlt(asset: ApprovedAssetLibraryAsset) {
  return `${asset.promptMetadata.title}. Generic Lodesta category image, not this specific business.`;
}

function isPublicSafeMedia(asset: AssetReference) {
  return asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe";
}

/**
 * Protected-preview policy (product decision): privately stored scraped media
 * (reference_only, served only to authenticated admin/owner sessions) is
 * eligible for candidate composition so v1 sites show the business's real
 * photos. The public /sites route refuses to render any version whose media
 * decisions include reference_only assets — publishing requires per-photo
 * owner attestation, which converts assets to customer_granted and triggers
 * recompile.
 */
function isProtectedPreviewEligibleMedia(asset: AssetReference) {
  if (isPublicSafeMedia(asset)) return true;
  if ((process.env.LODESTA_PROTECTED_PREVIEW_REAL_MEDIA ?? "on") === "off") return false;
  return asset.rightsStatus === "reference_only" && /^\/api\/assets\/[^/]+\/scraped-/.test(asset.url);
}

function isLikelyLogoOnlyMedia(asset: AssetReference, business?: BusinessProfile) {
  const text = `${asset.id} ${asset.url} ${asset.alt}`.toLowerCase();
  if (/\blogo\b|wordmark|brand mark|brandmark/.test(text)) return true;
  const logoFingerprint = business?.logo ? assetFingerprintFromUrl(business.logo.url) : undefined;
  if (logoFingerprint && asset.url.includes(logoFingerprint)) return true;
  const aspectRatio = asset.width && asset.height ? asset.width / asset.height : undefined;
  return Boolean(aspectRatio && aspectRatio > 1.6 && /\btransparent|png|mark\b/.test(text));
}

function isLikelyCompositedAutoBodyGraphicMedia(asset: AssetReference) {
  const aspectRatio = asset.width && asset.height ? asset.width / asset.height : undefined;
  if (!aspectRatio) return false;
  // Wide scraped repair graphics are commonly social before/after composites
  // with black bars, motion backgrounds, and watermarks. They are useful as
  // owner review references, but they consistently fail as premium site media.
  return aspectRatio >= 1.55 && asset.rightsStatus === "reference_only";
}

function isLikelyAutoBodyProofReferenceMedia(asset: AssetReference) {
  const text = `${asset.id} ${asset.url} ${asset.alt}`.toLowerCase();
  return /\bbefore\b|\bafter\b|\bproof\b|\brepair\b|\bfinished\b|\bshowroom\b|\bportfolio\b|\bwork\b/.test(text) || isLikelyCompositedAutoBodyGraphicMedia(asset);
}

function isUsableFirstPartyContextMedia(asset: AssetReference) {
  if (asset.width && asset.height && (asset.width < 500 || asset.height < 300)) return false;
  return !isLikelyCompositedAutoBodyGraphicMedia(asset);
}

function strongestFirstPartyHeroPhoto(photos: AssetReference[]) {
  return [...photos].sort((left, right) => firstPartyHeroScore(right) - firstPartyHeroScore(left))[0];
}

function firstPartyHeroScore(asset: AssetReference) {
  if (!asset.width || !asset.height) return 0.35;
  const aspect = asset.width / asset.height;
  let score = Math.min(asset.width, 1600) / 1600;
  if (aspect >= 1.15 && aspect <= 2.3) score += 1;
  if (asset.width >= 900 && asset.height >= 500) score += 0.4;
  if (aspect < 0.85) score -= 0.6;
  if (isLikelyCompositedAutoBodyGraphicMedia(asset)) score -= 1;
  return score;
}

function prioritizeFirstPartyMediaForGallery(photos: AssetReference[], heroPhoto: AssetReference) {
  const heroKey = mediaIdentityKey(heroPhoto.url);
  return [
    heroPhoto,
    ...photos
      .filter((asset) => mediaIdentityKey(asset.url) !== heroKey)
      .sort((left, right) => firstPartyHeroScore(right) - firstPartyHeroScore(left))
  ];
}

function assetFingerprintFromUrl(url: string) {
  return url.match(/-([a-f0-9]{8,})(?:\.[a-z0-9]+)?(?:\?|#|$)/i)?.[1];
}

function mediaSourceForAsset(asset: AssetReference): MediaAssetDecisionV3["source"] {
  if (asset.source === "uploaded") return "first_party";
  if (asset.source === "licensed") return "curated_stock";
  if (asset.source === "generated") return "generated_ai";
  return "first_party";
}

function themeForV3Business(business: BusinessProfile, mediaKind: SelectedV3Media["kind"]): Theme {
  if (business.vertical === "restaurant") {
    return {
      paletteName: "v3-restaurant-warm",
      colors: {
        background: "#fdf8f1",
        surface: "#fffdf8",
        text: "#26190f",
        muted: "#70614f",
        primary: "#9a3412",
        primaryText: "#ffffff",
        accent: "#d99022",
        border: "#e9dcc9"
      },
      typography: { heading: "magazine_grotesk", body: "magazine_grotesk" },
      radius: "md",
      density: "spacious",
      mood: "warm"
    };
  }
  if (business.vertical === "home_services") {
    return {
      paletteName: "v3-home-services-utility",
      colors: {
        background: "#f4f7f8",
        surface: "#ffffff",
        text: "#15222b",
        muted: "#5a6b75",
        primary: "#155e75",
        primaryText: "#ffffff",
        accent: "#e0a325",
        border: "#d8e2e6"
      },
      typography: { heading: "precision_grotesk", body: "precision_grotesk" },
      radius: "sm",
      density: "spacious",
      mood: "utilitarian"
    };
  }
  if (business.vertical === "beauty_salon") {
    return {
      paletteName: "v3-beauty-premium",
      colors: {
        background: "#fbf7f5",
        surface: "#fffdfb",
        text: "#241a1a",
        muted: "#6f5e5e",
        primary: "#7c2d4e",
        primaryText: "#ffffff",
        accent: "#c9a36a",
        border: "#ead9d3"
      },
      typography: { heading: "magazine_grotesk", body: "magazine_grotesk" },
      radius: "md",
      density: "spacious",
      mood: "premium"
    };
  }
  if (business.vertical === "auto_services") {
    return {
      paletteName: "v3-auto-services-utility",
      colors: {
        background: "#eef2f4",
        surface: "#ffffff",
        text: "#16181a",
        muted: "#59646f",
        primary: "#1f3a5f",
        primaryText: "#ffffff",
        accent: "#d94a1e",
        border: "#d2dde4"
      },
      typography: { heading: "precision_grotesk", body: "precision_grotesk" },
      radius: "sm",
      density: "spacious",
      mood: "utilitarian"
    };
  }
  if (business.vertical === "auto_body") {
    return {
      paletteName: "v3-auto-precision",
      colors: {
        background: "#eef2f4",
        surface: "#ffffff",
        text: "#14181c",
        muted: "#5a646d",
        primary: "#17324a",
        primaryText: "#ffffff",
        accent: "#d94a1e",
        border: "#d2dde4"
      },
      typography: { heading: "precision_grotesk", body: "precision_grotesk" },
      radius: "sm",
      density: "spacious",
      mood: "editorial"
    };
  }
  return {
    paletteName: mediaKind === "media" ? "v3-local-media" : "v3-local-text-first",
    colors: {
      background: "#f3f6ef",
      surface: "#fffdf7",
      text: "#13231b",
      muted: "#5f6a61",
      primary: "#145c48",
      primaryText: "#ffffff",
      accent: "#c59d44",
      border: "#d9dfd3"
    },
    typography: { heading: "magazine_grotesk", body: "magazine_grotesk" },
    radius: "md",
    density: "spacious",
    mood: "editorial"
  };
}

function serviceItemsForBusiness(business: BusinessProfile, deck?: GeneratedCopyDeckV2): StandardItemV3[] {
  if (deck) {
    const deckItems =
      business.vertical === "auto_body" && business.services.length
        ? deck.serviceItems.slice(0, business.services.length)
        : deck.serviceItems;
    return deckItems.map((item, index) => (
      business.vertical === "auto_body" ? autoBodyDeckServiceItemForBusiness(item, business, index) : item
    ));
  }
  return serviceNamesForBusiness(business).map((service) => serviceItemForBusiness(service, business));
}

function autoBodyDeckServiceItemForBusiness(
  item: Pick<StandardItemV3, "title" | "body">,
  business: BusinessProfile,
  index: number
): Pick<StandardItemV3, "title" | "body"> {
  const sourceService = business.services[index] ?? item.title;
  const deterministic = autoBodyServiceItemForBusiness(sourceService);
  if (/insurance|claim|deductible/i.test(`${deterministic.title} ${deterministic.body}`) && !autoBodyHasPublishableInsuranceServiceEvidence(business)) {
    return {
      title: "Repair questions",
      body: "Call with where the vehicle was hit, whether it still drives normally, and which panels, lights, or trim look different."
    };
  }
  return {
    title: sentenceCasePhrase(sourceService),
    body: deterministic.body
  };
}

function serviceItemForBusiness(service: string, business: BusinessProfile): Pick<StandardItemV3, "title" | "body"> {
  if (business.vertical === "auto_body") return autoBodyServiceItemForBusiness(service);
  return {
    title: service,
    body: serviceBodyForBusiness(service, business)
  };
}

function autoBodyServiceItemForBusiness(service: string): Pick<StandardItemV3, "title" | "body"> {
  if (/insurance|claim/i.test(service)) {
    return {
      title: "Insurance Claim Support",
      body: "If insurance is involved, claim details stay connected to the vehicle and the repair plan so paperwork does not drift away from the work."
    };
  }
  if (/collision|body/i.test(service)) {
    return {
      title: "Impact and Panel Repair",
      body: "Panels, nearby lights, clips, bumper covers, and gaps are checked together so related accident damage is not missed."
    };
  }
  if (/hail/i.test(service)) {
    return {
      title: "Hail Damage Repair",
      body: "Roof, hood, door, rail, and trim dents are mapped together so hail damage is handled as a full-vehicle repair pattern."
    };
  }
  if (/\bpaint\b|refinish/i.test(service)) {
    return {
      title: "Auto Paint and Refinishing",
      body: "Scraped or repaired panels are matched against adjacent finish, edges, and trim so the blend disappears in daylight."
    };
  }
  if (/scratch|scuff/i.test(service)) {
    return {
      title: "Scratch and Scuff Repair",
      body: "The shop separates surface scuffs from paint or panel damage so the recommendation fits the depth, edge location, and trim nearby."
    };
  }
  if (/glass|windshield|window/i.test(service)) {
    return {
      title: "Glass and Trim Damage",
      body: "Broken or cracked glass is considered with nearby seals, trim, and body fit when damage reaches beyond the pane."
    };
  }
  if (/\bdents?\b|\bpdr\b|paintless dent/i.test(service)) {
    return {
      title: "Paintless Dent Repair",
      body: "Best for shallow dents with intact paint and clean panel access, so the original finish can stay in place."
    };
  }
  if (/bumper/i.test(service)) {
    return {
      title: "Bumper and Panel Repair",
      body: "Scuffs, cracks, loose clips, and shifted covers are checked with nearby lights and panels so the bumper sits cleanly again."
    };
  }
  return {
    title: service,
    body: `${service} starts with the affected panels, visible changes, and whether the vehicle still drives normally.`
  };
}

/**
 * Dedupes items by normalized title and preserves semantic metadata. Items are never
 * cycled or duplicated to satisfy a slot count; sparse content stays sparse and
 * is caught by the quality gate instead.
 */
function dedupeStandardItems(items: StandardItemV3[]): StandardItemV3[] {
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeMediaItems<T extends { url: string; label: string }>(items: T[], count: number): T[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = mediaIdentityKey(item.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
}

function mediaItemsExcluding(
  items: SiteMediaItemV3[],
  excludedUrls: string[],
  desiredCount: number
): SiteMediaItemV3[] {
  const excluded = new Set(excludedUrls.map(mediaIdentityKey));
  const filtered = normalizeMediaItems(
    items.filter((item) => !excluded.has(mediaIdentityKey(item.url))),
    desiredCount
  );
  if (filtered.length >= desiredCount) return filtered;
  return normalizeMediaItems([...filtered, ...items], desiredCount);
}

type MediaPlacementRefV1 = {
  section: SectionInstanceV3;
  visual: VisualSectionV3;
  slotId: string;
  readUrl: () => string | undefined;
  writeUrl: (item: SiteMediaItemV3) => void;
};

function applyPageMediaDedupeV1(
  sections: SectionInstanceV3[],
  gallery: SiteMediaItemV3[]
): GeneratedSiteMediaReuseDecisionV3[] {
  const decisions: GeneratedSiteMediaReuseDecisionV3[] = [];
  const used = new Set<string>();
  const replacementPool = normalizeMediaItems(gallery, gallery.length);
  for (const ref of mediaPlacementRefsForSectionsV1(sections)) {
    const url = ref.readUrl();
    if (!url) continue;
    const key = mediaIdentityKey(url);
    if (!used.has(key)) {
      used.add(key);
      continue;
    }
    const replacement = replacementPool.find((item) => {
      const replacementKey = mediaIdentityKey(item.url);
      return replacementKey !== key && !used.has(replacementKey);
    });
    if (replacement) {
      ref.writeUrl(replacement);
      used.add(mediaIdentityKey(replacement.url));
      ref.section.props = withVisualSectionV3({ ...ref.section.props }, ref.visual);
      decisions.push({
        id: `media_reuse_${ref.section.id}_${decisions.length}`,
        sectionId: ref.section.id,
        slotId: ref.slotId,
        originalUrl: url,
        replacementUrl: replacement.url,
        reason: "duplicate_replaced"
      });
    } else {
      decisions.push({
        id: `media_reuse_${ref.section.id}_${decisions.length}`,
        sectionId: ref.section.id,
        slotId: ref.slotId,
        originalUrl: url,
        reason: "duplicate_allowed_no_alternative"
      });
    }
  }
  return decisions;
}

function mediaPlacementRefsForSectionsV1(sections: SectionInstanceV3[]): MediaPlacementRefV1[] {
  const refs: MediaPlacementRefV1[] = [];
  for (const section of sections) {
    const visual = getVisualSectionV3(section.props);
    if (!visual) continue;
    const slots = visual.slots as Record<string, unknown>;
    const media = slots.media;
    if (media && typeof media === "object" && Array.isArray((media as { items?: unknown }).items)) {
      (media as { items: Array<{ url?: string; label?: string; publicCaption?: string; focalPoint?: BackgroundFocalPointV3; cropIntent?: SiteMediaCropIntentV3 }> }).items.forEach((item, index) => {
        refs.push({
          section,
          visual,
          slotId: `media.items.${index}`,
          readUrl: () => item.url,
          writeUrl: (replacement) => {
            item.url = replacement.url;
            item.label = replacement.label;
            item.publicCaption = replacement.publicCaption;
            item.focalPoint = replacement.focalPoint;
            item.cropIntent = replacement.cropIntent;
          }
        });
      });
    }
    const items = slots.items;
    if (items && typeof items === "object" && Array.isArray((items as { items?: unknown }).items)) {
      (items as { items: StandardItemV3[] }).items.forEach((item, index) => {
        if (!item.mediaUrl) return;
        refs.push({
          section,
          visual,
          slotId: `items.items.${index}.mediaUrl`,
          readUrl: () => item.mediaUrl,
          writeUrl: (replacement) => {
            item.mediaUrl = replacement.url;
          }
        });
      });
    }
  }
  return refs;
}

function serviceThumbnailGalleryForBusiness(
  business: BusinessProfile,
  gallery: SiteMediaItemV3[],
  visibleCount: number
): SiteMediaItemV3[] {
  if (business.vertical !== "auto_body") return gallery;

  const cleanGallery = gallery.filter((item) => !isAutoBodyProofMedia(item));
  const preferred = cleanGallery.slice(2);
  const fallback = cleanGallery.slice(1);
  const base = preferred.length >= visibleCount ? preferred : fallback;
  const contextFallback = autoBodyFallbackContextMedia(business);
  const fallbackGallery =
    contextFallback.kind === "media"
      ? galleryForSelectedMedia(contextFallback)
          .filter((item) => !isAutoBodyProofMedia(item))
      : [];
  return normalizeMediaItems([...base, ...fallbackGallery], visibleCount);
}

function mediaIdentityKey(url: string) {
  return assetFingerprintFromUrl(url) ?? url;
}

function servicesWithCompleteMedia(
  services: StandardItemV3[],
  gallery: SiteMediaItemV3[],
  visibleCount: number
): StandardItemV3[] {
  const media = normalizeMediaItems(gallery, visibleCount);
  if (visibleCount < 3 || media.length < visibleCount) return services;
  return services.map((item, index) => (index < visibleCount ? { ...item, mediaUrl: media[index].url } : item));
}

const fallbackServicePools: Partial<Record<Vertical, string[]>> = {
  auto_body: ["Collision repair", "Paint refinishing", "Dent repair", "Bumper repair"],
  auto_services: ["Flat repair", "New and used tires", "Tire rotation and balancing", "Brake service"],
  restaurant: ["Dine-in", "Takeout and pickup", "Catering"],
  home_services: ["Emergency service", "Repairs", "Maintenance"],
  beauty_salon: ["Cuts and styling", "Color services", "Treatments"]
};

function serviceNamesForBusiness(business: BusinessProfile) {
  const sourceServices = business.services.length ? business.services : business.serviceHighlights ?? [];
  const pool = fallbackServicePools[business.vertical] ?? [];
  const maxNames = business.vertical === "auto_body" ? 6 : 4;
  const names: string[] = [];
  const overlapsExisting = (candidate: string) => {
    const key = candidate.toLowerCase().trim();
    return names.some((name) => {
      const existing = name.toLowerCase().trim();
      return existing === key || existing.includes(key) || key.includes(existing);
    });
  };
  for (const service of sourceServices) {
    if (!service.trim() || overlapsExisting(service)) continue;
    if (business.vertical === "auto_body" && /insurance|claim|deductible/i.test(service) && !autoBodyHasPublishableInsuranceServiceEvidence(business)) continue;
    names.push(service);
    if (names.length >= maxNames) break;
  }
  for (const service of [...pool, ...business.categories]) {
    if (names.length >= 3) break;
    if (!service.trim() || overlapsExisting(service)) continue;
    names.push(service);
  }
  return names;
}

function autoBodyEvidenceText(business: BusinessProfile): string {
  return [business.description, ...business.services, ...(business.serviceHighlights ?? []), ...business.categories]
    .filter(Boolean)
    .join(" ");
}

function autoBodyHasPublishableInsuranceServiceEvidence(business: BusinessProfile): boolean {
  if (business.vertical !== "auto_body") return false;
  const serviceText = autoBodyEvidenceText(business);
  if (!/\binsurance\b|\bclaim\b|\bdeductible\b/i.test(serviceText)) return false;
  return /\b(insurance claims?|insurance claim support|works?\s+with\s+insurance|handles?\s+insurance\s+claims?|accepts?\s+insurance|direct\s+repair|drp|claim\s+(handling|process|repair)|insurance\s+(claims?|work|repairs?)\s+(handled|accepted|supported|managed))\b/i.test(serviceText);
}

function autoBodyHasGlassEvidence(business: BusinessProfile): boolean {
  if (business.vertical !== "auto_body") return false;
  return /\b(glass|windshield|window)\b/i.test([business.description, ...business.services].filter(Boolean).join(" "));
}

function autoBodyHasQuoteCtaEvidence(business: BusinessProfile): boolean {
  if (business.vertical !== "auto_body") return false;
  return /\b(?:free\s+)?(?:repair\s+)?(?:quote|estimate)\b|\brequest\s+(?:a\s+)?(?:quote|estimate)\b/i.test(autoBodyEvidenceText(business));
}

function autoBodyHasFreeQuoteEvidence(business: BusinessProfile): boolean {
  if (business.vertical !== "auto_body") return false;
  return /\bfree\s+(?:repair\s+)?(?:quote|estimate)\b/i.test(autoBodyEvidenceText(business));
}

function autoBodyBusinessStoryForBusiness(business: BusinessProfile): { heading: string; body: string } | undefined {
  if (business.vertical !== "auto_body" || !business.description?.trim()) return undefined;
  const sourceText = business.description.trim();
  const foundedYear = sourceText.match(/\bfounded\s+in\s+(\d{4})\b/i)?.[1];
  const familyOwned = /\bfamily[-\s]?owned\b/i.test(sourceText);
  if (!familyOwned && !foundedYear) return undefined;
  const city = business.address?.city;
  const serviceSummary = compactServiceNameList(serviceNamesForBusiness(business).slice(0, 4)).toLowerCase();
  const headingParts = [
    familyOwned ? "Family-owned auto body work" : "Auto body work",
    city ? `in ${city}` : "",
    foundedYear ? `since ${foundedYear}` : ""
  ].filter(Boolean);
  const optionCopy = autoBodyHasPublishableInsuranceServiceEvidence(business) ? " The shop can keep insurance or self-pay questions tied to the vehicle details." : "";
  return {
    heading: `${headingParts.join(" ")}.`,
    body: `${business.name} is a ${familyOwned ? "family-owned " : ""}${city ? `${city} ` : ""}auto body shop${foundedYear ? ` founded in ${foundedYear}` : ""} handling ${serviceSummary}.${optionCopy}`
  };
}

function serviceBodyForBusiness(service: string, business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    if (/collision|body|panel/i.test(service)) return "Panel fit, light alignment, clips, bumper cover movement, and nearby gaps are checked together.";
    if (/bumper/i.test(service)) return "Scuffed, cracked, or shifted bumper covers are checked with the brackets, lights, trim, and surrounding panels.";
    if (/hail/i.test(service)) return "Roof, hood, door, rail, and quarter-panel dents are mapped together so hail damage is not treated one spot at a time.";
    if (/scratch|scuff/i.test(service)) return "Depth, edge location, and nearby trim help determine whether polish, paint, or panel work is needed.";
    if (/dent|pdr/i.test(service)) return "Shallow dents with intact paint are checked for access, panel shape, and whether the original finish can stay in place.";
    if (/glass|windshield|window/i.test(service)) return "Windshield or window damage is handled with the surrounding seals, trim, and body fit in mind.";
    if (/\bpaint\b|refinish/i.test(service)) return "Repaired or scraped panels are matched against nearby finish, edges, and trim so the blend holds up outside.";
  }
  if (business.vertical === "auto_services") {
    if (/flat|patch|plug/i.test(service)) return "Punctures and slow leaks checked and patched while you wait when the tire is repairable.";
    if (/new|used|tire(s)?\b/i.test(service)) return "Tires matched to your vehicle and budget, mounted and balanced on site.";
    if (/rotation|balanc|alignment/i.test(service)) return "Even wear and a straight ride, with a quick check of tread and pressure.";
    if (/brake/i.test(service)) return "Pads, rotors, and brake inspections with a clear price before work starts.";
    if (/oil|fluid/i.test(service)) return "Routine service to keep the vehicle on schedule without an appointment hassle.";
    return `${service} handled in the shop with a clear price before work starts.`;
  }
  if (business.vertical === "restaurant") return `${service} options for dining, pickup, or group orders.`;
  if (business.vertical === "home_services") return `${service} help for homes that need a clear appointment path.`;
  if (business.vertical === "beauty_salon") return `${service} appointments with room to share timing, goals, and references.`;
  if (business.vertical === "law_firm") return `${service} questions that start with the matter and the next deadline.`;
  return `${service} with a direct path to availability and scheduling.`;
}

function processItemsForBusiness(business: BusinessProfile): StandardItemV3[] {
  const autoBodyHasInsurance = autoBodyHasPublishableInsuranceServiceEvidence(business);
  const autoBodyItems = [
    {
      title: "Start with the whole hit area",
      body: "A good estimate looks past the obvious mark to nearby trim, lights, panel gaps, and paint edges so the repair matches what actually needs to line up again."
    },
    {
      title: autoBodyHasInsurance ? "Review insurance and payment details" : "Choose the repair scope",
      body: autoBodyHasInsurance
        ? "If insurance is involved, the claim details and self-pay questions stay connected to the same visible repair scope before work begins."
        : "The estimate separates what can be repaired from what may need parts, paint, or a closer look in the shop."
    },
    {
      title: "Finish with fit and paint",
      body: "Before pickup, the repaired area is checked for alignment, color blend, and the small edges around the original impact."
    }
  ];
  const autoServicesItems = [
    { title: "Pull in or call ahead", body: "Walk-ins work for most tire issues; a quick call confirms the tire size or part is in stock." },
    { title: "Get a quick look", body: "The shop checks the tire or symptom and tells you whether it can be repaired or needs replacement." },
    { title: "Approve the price", body: "You get the price before any work starts, including mounting and balancing." },
    { title: "Back on the road", body: "Most flat repairs and swaps are done while you wait." }
  ];
  const restaurantItems = [
    { title: "Check the menu", body: "Scan the menu for the dishes and options that fit your group and timing." },
    { title: "Order or reserve", body: "Order online for pickup, or call ahead for larger groups and catering." },
    { title: "Pick up or dine in", body: "Food comes out fresh; pickup orders are timed so they are ready when you arrive." }
  ];
  const homeServicesItems = [
    { title: "Describe the issue", body: "Share what is happening, where in the home, and how urgent it is." },
    { title: "Get a window and estimate", body: "You get an arrival window and a clear read on likely cost before work starts." },
    { title: "Work gets done", body: "The technician confirms the fix and walks the work with you before leaving." }
  ];
  const beautySalonItems = [
    { title: "Pick your service", body: "Choose the cut, color, or treatment closest to what you want." },
    { title: "Book a time", body: "Book online or call; share reference photos and hair history if it is a big change." },
    { title: "Sit back", body: "Your stylist confirms the plan in the chair before anything starts." }
  ];
  const genericItems = [
    { title: "Share the situation", body: "Start with the service, timing, location, and best contact details." },
    { title: "Confirm the fit", body: "The team can route the request and ask one or two practical follow-up questions." },
    { title: "Plan the visit", body: "Use the call or message to confirm availability and the right next action." }
  ];
  const itemsByVertical: Partial<Record<Vertical, typeof genericItems>> = {
    auto_body: autoBodyItems,
    auto_services: autoServicesItems,
    restaurant: restaurantItems,
    home_services: homeServicesItems,
    beauty_salon: beautySalonItems
  };
  const items = itemsByVertical[business.vertical] ?? genericItems;
  return dedupeStandardItems(items.map((item, index) => ({ ...item, meta: String(index + 1).padStart(2, "0") })));
}

function quoteItemsForBusiness(business: BusinessProfile): QuoteItemV3[] {
  return business.pressLinks
    .map((link) => testimonialFromString(link))
    .filter((item): item is QuoteItemV3 => Boolean(item))
    .slice(0, 3);
}

function testimonialFromString(value: string): QuoteItemV3 | undefined {
  const match = value.match(/^(?:testimonial|quote|review)\s*:\s*(.+)$/i);
  if (!match) return undefined;
  const [quoteText, attributionText] = match[1].split(/\s+(?:--|—|-)\s+/);
  const quote = quoteText?.trim();
  if (!quote) return undefined;
  if (/^review\s*:/i.test(value) && !isRenderableCustomerReviewQuote(quote)) return undefined;
  return {
    quote,
    attribution: attributionText?.trim() || "Customer review"
  };
}

function isRenderableCustomerReviewQuote(value: string) {
  if (value.length < 45 || value.length > 220) return false;
  if (/@|©|all rights reserved/i.test(value)) return false;
  if (/^(?:where|restore|from|texas weather|no matter|appointments?|ready to|get a|serving)\b/i.test(value)) return false;
  if (/\b(original condition|major structural damage|insurance companies|repair process|smooth and hassle-free|expert craftsmanship|exceptional results)\b/i.test(value)) {
    return false;
  }
  const positiveExperience =
    /\b(highly recommend|recommend(?:ed)?|great (?:service|job|work|experience)|excellent (?:service|work|job)|amazing|professional|honest|helpful|friendly|perfect|happy|satisfied|thank(?:s| you)?)\b/i.test(
      value
    );
  if (!positiveExperience) return false;
  return /\b(i|me|my|we|our|they|their|them|mencia|shop|team|staff|owner|service|job|work|repair)\b/i.test(value);
}

function pricingItemsForBusiness(business: BusinessProfile): StandardItemV3[] {
  const evidenceStrings = [
    ...business.services,
    ...(business.serviceHighlights ?? []),
    ...(business.description ? [business.description] : [])
  ].filter(hasPricingLanguage);

  return evidenceStrings.slice(0, 3).map((evidence, index) => {
    const [titlePart, bodyPart] = evidence.split(/\s*[:|-]\s*/, 2);
    return {
      title: titlePart?.trim() || `Documented option ${index + 1}`,
      body: bodyPart?.trim() || evidence.trim(),
      meta: String(index + 1).padStart(2, "0")
    };
  });
}

function hasPricingLanguage(value: string) {
  return /\$\s*\d|\b(starting at|starts at|from \$|package|packages|plan|plans|tier|tiers)\b/i.test(value);
}

/**
 * Real business facts only. Filler facts ("Services: 3", "Start: Call directly")
 * are never synthesized; sections with fact minimums are skipped instead.
 */
function isOpenSevenDays(business: BusinessProfile): boolean {
  const hours = business.hours;
  if (!hours) return false;
  const entries = hoursEntriesForHours(hours);
  const openValues = entries.filter(({ value }) => value && !/closed/i.test(value));
  // Collapsed entries (Mon–Fri) count their day spans; seven open weekdays.
  const dayCount = openValues.reduce((sum, entry) => {
    const span = entry.label.match(/^(\w+)\s*[–-]\s*(\w+)$/);
    if (!span) return sum + 1;
    const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const from = order.findIndex((day) => span[1].toLowerCase().startsWith(day));
    const to = order.findIndex((day) => span[2].toLowerCase().startsWith(day));
    return sum + (from >= 0 && to >= from ? to - from + 1 : 1);
  }, 0);
  return dayCount >= 7;
}

function proofFactsForBusiness(business: BusinessProfile): VisualFactV3[] {
  const hoursSummary = hoursSummaryForBusiness(business);
  const autoBodyServiceFact = autoBodyTopServiceFactForBusiness(business);
  // Open-7-days is a selling point (demo-parity): promoted as an explicit
  // fact, grounded in the structured weekly schedule, never inferred.
  const openSeven = isOpenSevenDays(business);
  const coreFacts: VisualFactV3[] = [
    ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
    ...(business.address ? [{ label: "Location", value: locationLineForBusiness(business) }] : [])
  ];
  return [
    ...coreFacts,
    ...(openSeven ? [{ label: "Hours", value: "Open 7 days a week" }] : hoursSummary ? [{ label: "Hours", value: hoursSummary }] : []),
    ...autoBodyProofFactsForBusiness(business),
    ...(autoBodyServiceFact ? [autoBodyServiceFact] : []),
    ...(business.serviceAreas.length && !business.address ? [{ label: "Serves", value: business.serviceAreas.slice(0, 2).join(", ") }] : [])
  ].slice(0, 4);
}

function autoBodyTopServiceFactForBusiness(business: BusinessProfile): VisualFactV3 | undefined {
  if (business.vertical !== "auto_body") return undefined;
  const services = serviceNamesForBusiness(business).join(" ").toLowerCase();
  const parts = [
    /\bdent|hail|pdr\b/.test(services) ? "dents" : undefined,
    /\bpaint|refinish|scratch\b/.test(services) ? "paint" : undefined,
    /\bcollision|body\b/.test(services) ? "collision" : undefined
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) return undefined;
  return { label: "Repairs", value: parts.slice(0, 3).join(" / ") };
}

function autoBodyProofFactsForBusiness(business: BusinessProfile): VisualFactV3[] {
  if (business.vertical !== "auto_body") return [];
  const sourceText = [business.description, ...business.services, ...(business.serviceHighlights ?? [])].filter(Boolean).join(" ");
  const hasInsurance = autoBodyHasPublishableInsuranceServiceEvidence(business);
  const hasSelfPay = /\bself[-\s]?pay\b|out of pocket|payment options?/i.test(sourceText);
  const facts: VisualFactV3[] = [];
  if (autoBodyHasFreeQuoteEvidence(business)) {
    facts.push({ label: "Quote", value: "Free repair quote", href: "#contact" });
  } else if (autoBodyHasQuoteCtaEvidence(business)) {
    facts.push({ label: "Quote", value: "Repair quote request", href: "#contact" });
  }
  if (hasInsurance && hasSelfPay) facts.push({ label: "Options", value: "Insurance and self-pay" });
  else if (hasInsurance) facts.push({ label: "Insurance", value: "Claim details welcome" });
  else if (hasSelfPay) facts.push({ label: "Payment", value: "Self-pay options" });
  return facts;
}

function autoBodyRepairScopeFactsForBusiness(business: BusinessProfile): VisualFactV3[] {
  if (business.vertical !== "auto_body") return [];
  const sourceText = [business.description, ...business.services, ...(business.serviceHighlights ?? [])].filter(Boolean).join(" ");
  const hasInsurance = autoBodyHasPublishableInsuranceServiceEvidence(business);
  return [
    { label: "Impact area", value: "Wide and close views" },
    { label: "Body fit", value: "Panel gaps and trim" },
    { label: "Finish", value: "Paint edges" },
    hasInsurance ? { label: "Claim notes", value: "Photos and details ready" } : { label: "Visit plan", value: "Driveability and timing" }
  ];
}

function contactFactsForBusiness(
  business: BusinessProfile,
  locationContext?: LocationCompileContextV3,
  options?: { includeLocationAnchor?: boolean }
): VisualFactV3[] {
  const hoursSummary = hoursSummaryForBusiness(business);
  const fullFacts = () => {
    const facts: VisualFactV3[] = [
      ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
      ...(publicEmailForBusiness(business.email)
        ? [{ label: "Email", value: publicEmailForBusiness(business.email)!, href: `mailto:${publicEmailForBusiness(business.email)!}` }]
        : []),
      ...(business.address ? [{ label: "Address", value: formatAddress(business.address) }] : []),
      ...(hoursSummary ? [{ label: "Hours", value: hoursSummary }] : [])
    ];
    // Sparse-contact businesses pad the slot minimum with real navigational
    // facts, never synthesized filler.
    if (facts.length < 3) {
      const serviceNames = serviceNamesForBusiness(business).slice(0, 2);
      if (serviceNames.length) facts.push({ label: "Services", value: serviceNames.join(", "), href: "#services" });
    }
    if (facts.length < 3) facts.push({ label: "Message", value: "Repair request", href: "#contact" });
    if (facts.length < 3) facts.push({ label: "Questions", value: "Read the FAQ", href: "#faq" });
    return facts.slice(0, 4);
  };

  if (!locationContext?.hasLocationSection) return fullFacts();

  const conversionFacts: VisualFactV3[] = [
    ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
    ...(publicEmailForBusiness(business.email)
      ? [{ label: "Email", value: publicEmailForBusiness(business.email)!, href: `mailto:${publicEmailForBusiness(business.email)!}` }]
      : []),
    ...(options?.includeLocationAnchor === false
      ? [{ label: "Services", value: serviceNamesForBusiness(business).slice(0, 2).join(", ") || "Ask what fits", href: "#services" }]
      : [
          {
            label: "Location",
            value: locationContext.physicalLocations.length === 1 && locationContext.physicalLocations[0]?.addressLine
              ? locationContext.physicalLocations[0].addressLine
              : locationContext.physicalLocations.length > 1
                ? "Shop addresses & hours"
                : "Shop address & hours",
            href: "#location"
          }
        ]),
    {
      label: business.vertical === "auto_body" && autoBodyHasQuoteCtaEvidence(business) ? "Quote" : "Message",
      value:
        business.vertical === "auto_body"
          ? autoBodyHasFreeQuoteEvidence(business)
            ? "Free repair quote"
            : autoBodyHasQuoteCtaEvidence(business)
              ? "Repair quote request"
              : "Repair request"
          : "Send a message",
      href: "#contact"
    }
  ];
  return conversionFacts.length >= 3 ? conversionFacts.slice(0, 4) : fullFacts();
}

function faqItemsForBusiness(business: BusinessProfile): FaqItemV3[] {
  if (business.vertical === "auto_body") {
    return autoBodyFaqItemsForBusiness(business);
  }
  if (business.vertical === "auto_services") {
    return [
      { question: "Do I need an appointment?", answer: "Walk-ins work for most tire repairs and swaps. Calling ahead helps confirm a tire size or part is in stock." },
      { question: "Can my flat tire be repaired instead of replaced?", answer: "If the puncture is in the tread and the sidewall is intact, it can usually be patched. The shop confirms after a quick look." },
      { question: "How long does a typical visit take?", answer: "Flat repairs and tire swaps are usually done while you wait. Brake and mechanical work depends on the job and parts." },
      { question: "Will I know the price before work starts?", answer: "Yes. You get the price after the initial look and approve it before any work begins." }
    ];
  }
  if (business.vertical === "restaurant") {
    return [
      { question: "Can I order ahead for pickup?", answer: "Yes. Order online or call it in, and the kitchen times it so the food is ready when you arrive." },
      { question: "Do you handle large groups or catering?", answer: "Call ahead with the headcount and timing so the kitchen and seating can be set up for the group." },
      { question: "How busy does it get at peak hours?", answer: "Lunch and dinner rushes are the busiest; ordering ahead or arriving outside the rush keeps the wait short." },
      { question: "Where do I check the current menu?", answer: "The services section lists the main options; call for today's specials and seasonal items." }
    ];
  }
  if (business.vertical === "home_services") {
    return [
      { question: "Do you handle emergencies?", answer: "Call with what is happening and where; urgent issues get the earliest available window." },
      { question: "Will I get a price before work starts?", answer: "Yes. You get an estimate after the issue is assessed and approve it before any work begins." },
      { question: "What should I have ready when I call?", answer: "The issue, where in the home it is, how long it has been happening, and your availability." },
      { question: "Do I need to be home during the work?", answer: "For most jobs yes, at least at the start and the final walkthrough of the work." }
    ];
  }
  if (business.vertical === "beauty_salon") {
    return [
      { question: "Do I need an appointment?", answer: "Booking ahead guarantees your time and stylist; call to check same-day availability." },
      { question: "How should I prepare for a big change?", answer: "Bring reference photos and your hair history (color, treatments) so the stylist can plan the session." },
      { question: "How long do appointments take?", answer: "Cuts are usually under an hour; color and treatments can take two or more depending on the service." },
      { question: "What if I'm not sure which service I need?", answer: "Book a consultation slot and the stylist will walk options, timing, and pricing with you first." }
    ];
  }
  return [
    { question: "What should I include first?", answer: "Share the service you need, timeline, location, and best callback details." },
    { question: "How should I choose the right service?", answer: "Start with the outcome you want, then include any constraints that could affect timing or fit." },
    { question: "What happens after I reach out?", answer: "You can expect a reply with availability, timing, or a quick follow-up question." },
    { question: "What should I include in the first message?", answer: "Share the service, timing, location, and the best way to reach you." }
  ];
}

function autoBodyFaqItemsForBusiness(business: BusinessProfile): FaqItemV3[] {
  const sourceText = autoBodyEvidenceText(business);
  const hasInsurance = autoBodyHasPublishableInsuranceServiceEvidence(business);
  const hasDent = /\bdent\b|\bhail\b|\bpdr\b|paintless dent/i.test(sourceText);
  const hasGlass = /\bglass\b|\bwindshield\b|\bwindow\b/i.test(sourceText);
  const hasPaint = /\bpaint\b|\brefinish\b|\bscratch\b/i.test(sourceText);
  const hasBumper = /\bbumper\b/i.test(sourceText);
  const hasFrame = /\bframe\b/i.test(sourceText);
  const items: FaqItemV3[] = [
    { question: "What should I have ready when I call?", answer: "Vehicle year, make, model, the damaged area, whether it drives, and any photos you already have." }
  ];
  if (hasInsurance) {
    items.push({
      question: "What if insurance is involved?",
      answer: "Have the claim number, adjuster contact, and vehicle details nearby so the first call starts with the right facts."
    });
  }
  if (hasDent) {
    items.push({
      question: "What helps with dent or hail questions?",
      answer: "Share which panels are affected, how it happened, and whether doors, trim, or lights still open and line up normally."
    });
  }
  if (hasGlass) {
    items.push({
      question: "Can glass damage be included?",
      answer: "For windshield or window damage, include which glass is affected and whether the vehicle can be driven."
    });
  }
  if (hasPaint) {
    items.push({
      question: "How should I describe paint or scratch damage?",
      answer: "Mention where the scratch or paint damage sits, whether bare material is showing, and whether one panel or several are affected."
    });
  }
  if (hasBumper) {
    items.push({
      question: "How should I describe bumper damage?",
      answer: "Share whether the damage is a scuff, crack, loose clip, shifted cover, or nearby panel issue."
    });
  }
  if (hasFrame) {
    items.push({
      question: "When should frame measuring come up?",
      answer: "Mention where the vehicle was hit and whether it pulls, sits unevenly, or has visible gaps around panels."
    });
  }
  items.push({
    question: "What needs an in-person look?",
    answer: "Photos help with the first call, but panel gaps, paint edges, and trim usually need a closer shop review."
  });
  const fallbackItems: FaqItemV3[] = [
    {
      question: "Can I start with photos before bringing the vehicle in?",
      answer: "Yes. Photos help with the first call, but the final repair scope should be confirmed after the shop can inspect the vehicle."
    },
    {
      question: "What details help with the first estimate?",
      answer: "Share the vehicle year, make, model, where the damage is, whether it drives normally, and whether insurance is already involved."
    },
    {
      question: "Do small dents or scratches still need a shop visit?",
      answer: "Usually yes. Small exterior damage can involve clips, trim, paint edges, or adjacent panels that are hard to judge from a quick description."
    }
  ];
  return [
    ...items,
    ...fallbackItems.filter((fallback) => !items.some((item) => slugify(item.question) === slugify(fallback.question)))
  ].slice(0, 4);
}

function mediaSlot(items: SiteMediaItemV3[]): MediaSlotV3 {
  const selected = normalizeMediaItems(items, Math.min(Math.max(items.length, 1), 3));
  return {
    items: selected.map((item) => ({ url: item.url, label: item.label, publicCaption: item.publicCaption, cropIntent: item.cropIntent })),
    focalPoint: focalPointForMediaItemsV1(selected),
    caption: "none"
  };
}

function selectAutoBodyRepairReferenceMedia(items: SiteMediaItemV3[]): SiteMediaItemV3[] {
  const normalized = normalizeMediaItems(items, 3);
  return normalized.slice(0, 1);
}

function selectAutoBodyRepairProofPairMedia(items: SiteMediaItemV3[]): SiteMediaItemV3[] {
  const normalized = normalizeMediaItems(items, 6);
  const labelFor = (item: SiteMediaItemV3) => `${item.url} ${item.label}`;
  const before = normalized.find((item) => /\bbefore\b/i.test(labelFor(item)) && !/\bafter\b/i.test(labelFor(item)));
  const after = normalized.find((item) => /\bafter\b|\bfinished\b/i.test(labelFor(item)) && !/\bbefore\b/i.test(labelFor(item)));
  if (before && after && mediaIdentityKey(before.url) !== mediaIdentityKey(after.url)) return [before, after];
  return [];
}

function autoBodyProofPairMediaSlot(items: SiteMediaItemV3[]): MediaSlotV3 {
  const selected = normalizeMediaItems(items, 2);
  const captions = ["Before", "After"];
  return {
    items: selected.map((item, index) => ({
      url: item.url,
      label: item.label,
      publicCaption: captions[index] ?? "Repair view"
    })),
    focalPoint: focalPointForMediaItemsV1(selected),
    caption: "below"
  };
}

function autoBodyProofMediaSlot(items: SiteMediaItemV3[]): MediaSlotV3 {
  const selected = normalizeMediaItems(items, 1);
  return {
    items: selected.map((item) => ({
      url: item.url,
      label: item.label
    })),
    focalPoint: focalPointForMediaItemsV1(selected),
    caption: "none"
  };
}

function heroActionsForBusiness(business: BusinessProfile, primaryOverride?: VisualCtaV3): VisualCtaV3[] {
  const primary = primaryOverride ?? primaryCtaForBusiness(business);
  if (!primaryOverride && business.vertical === "auto_body" && autoBodyHasQuoteCtaEvidence(business) && business.phone) {
    return [
      primary,
      { label: "Call the shop", href: `tel:${phoneHref(business.phone)}`, style: "secondary" }
    ];
  }
  return [
    primary,
    { label: "View services", href: "#services", style: "secondary" }
  ];
}

/**
 * Primary conversion action follows the vertical's goal: ordering for
 * restaurants, booking for appointment trades, phone-first otherwise.
 */
function primaryCtaForBusiness(business: BusinessProfile): VisualCtaV3 {
  if (business.vertical === "auto_body" && autoBodyHasQuoteCtaEvidence(business)) {
    return { label: autoBodyHasFreeQuoteEvidence(business) ? "Get a free quote" : "Get a quote", href: "#contact", style: "primary" };
  }
  if (business.vertical === "restaurant" && business.orderingLinks[0]) {
    return { label: "Order online", href: business.orderingLinks[0], style: "primary" };
  }
  if (
    (business.vertical === "beauty_salon" || business.vertical === "med_spa" || business.vertical === "dental" || business.vertical === "fitness" || business.vertical === "veterinary") &&
    business.bookingLinks[0]
  ) {
    return { label: "Book now", href: business.bookingLinks[0], style: "primary" };
  }
  return business.phone
    ? { label: business.vertical === "auto_body" ? "Call the shop" : "Call now", href: `tel:${phoneHref(business.phone)}`, style: "primary" }
    : { label: "Send details", href: "#contact", style: "primary" };
}

function autoBodyPhoneCtaForBusiness(business: BusinessProfile, label: string): VisualCtaV3 {
  return business.phone ? { label, href: `tel:${phoneHref(business.phone)}`, style: "primary" } : { label: "Start a repair request", href: "#contact", style: "primary" };
}

function headlineForBusiness(business: BusinessProfile, mode: SelectedV3Media["kind"]) {
  if (business.vertical === "auto_body") return autoBodyHeroHeadline(business);
  if (business.vertical === "auto_services") return autoServicesHeroHeadline(business);
  const services = serviceNamesForBusiness(business);
  const location = business.address?.city;
  if (services.length >= 2) {
    return `${joinServiceNames(services.slice(0, 2))}${location ? ` in ${location}` : ""}.`;
  }
  if (mode === "media") return `A direct way to work with ${business.name}.`;
  return `Start with ${business.name}.`;
}

function subheadlineForBusiness(business: BusinessProfile) {
  const serviceNames = serviceNamesForBusiness(business);
  const services = compactServiceNameList(business.vertical === "auto_body" ? serviceNames.slice(0, 5) : serviceNames);
  const location = locationLineForBusiness(business);
  if (business.vertical === "auto_body") {
    const shopLocation = business.address?.street ? ` from its ${shortStreetLabel(business.address.street).replace(/\.+$/, "")} shop` : location ? ` in ${location}` : "";
    const audience = business.address?.city ? `${business.address.city} drivers` : "drivers";
    const servicePhrase = autoBodyServicePhraseForBusiness(business);
    const evidenceText = autoBodyEvidenceText(business);
    const hasInsuranceAndSelfPay = autoBodyHasPublishableInsuranceServiceEvidence(business) && /\bself[-\s]?pay\b|out of pocket|payment options?/i.test(evidenceText);
    const optionPhrase = hasInsuranceAndSelfPay ? " with insurance and self-pay options" : "";
    return `${business.name} handles ${servicePhrase}${optionPhrase} for ${audience}${shopLocation}.`;
  }
  if (business.vertical === "auto_services") {
    return `${business.name} handles ${services.toLowerCase()}${location ? ` in ${location}` : ""}. Pull in or call for a quick answer on price and timing.`;
  }
  return `${services} from ${business.name}${location ? ` in ${location}` : ""}.`;
}

function autoServicesHeroHeadline(business: BusinessProfile) {
  const services = serviceNamesForBusiness(business);
  const city = business.address?.city;
  // Two services keeps the rendered H1 within the line-count budget.
  const serviceText = joinServiceNames(services.slice(0, 2)) || "Tires and auto service";
  const headline = `${serviceText}${city ? ` in ${city}` : ""}.`;
  return headline.length > 56 ? `${joinServiceNames(services.slice(0, 2)) || "Tires and auto service"}.` : headline;
}

function joinServiceNames(names: string[]) {
  const lowered = names.map((name, index) => (index === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1)));
  if (lowered.length <= 1) return lowered[0] ?? "";
  if (lowered.length === 2) return `${lowered[0]} and ${lowered[1]}`;
  return `${lowered.slice(0, -1).join(", ")}, and ${lowered[lowered.length - 1]}`;
}

function autoBodyHeroHeadline(business: BusinessProfile) {
  const location = business.address?.city || locationLineForBusiness(business);
  return location ? `Auto body repair in ${location}.` : "Auto body repair.";
}

function autoBodyServiceSignalsForBusiness(business: BusinessProfile) {
  const serviceText = serviceNamesForBusiness(business).join(" ").toLowerCase();
  return {
    hasCollision: /\b(collision|body)\b/.test(serviceText),
    hasDent: /\b(dent|pdr|hail)\b/.test(serviceText),
    hasPaint: /\b(paint|refinish|scratch)\b/.test(serviceText),
    hasGlass: /\bglass|windshield|window\b/.test(serviceText)
  };
}

function autoBodyServicePhraseForBusiness(business: BusinessProfile) {
  const signals = autoBodyServiceSignalsForBusiness(business);
  const serviceText = serviceNamesForBusiness(business).join(" ").toLowerCase();
  const hasHail = /\bhail\b/.test(serviceText);
  const hasScratch = /\bscratch|scuff\b/.test(serviceText);
  if (signals.hasCollision && signals.hasDent && hasHail && signals.hasPaint) return "dents, hail marks, paint damage, and collision repair";
  if (signals.hasCollision && signals.hasDent && hasHail) return "dents, hail marks, and collision damage";
  if (signals.hasCollision && signals.hasDent) return "dents, bumper hits, and collision damage";
  if (signals.hasCollision && signals.hasPaint) return "collision damage and paint repair";
  if (signals.hasDent && signals.hasGlass && hasHail && hasScratch) return "dents, hail marks, auto glass, and scratch damage";
  if (signals.hasDent && signals.hasGlass && hasHail) return "dents, hail marks, and auto glass";
  if (signals.hasDent && signals.hasGlass) return "dents and auto glass";
  if (signals.hasGlass && signals.hasPaint) return hasScratch ? "auto glass and scratch damage" : "auto glass and paint damage";
  if (signals.hasDent && signals.hasPaint) return hasHail ? "dents, hail marks, and paint damage" : "dents and paint damage";
  const parts = [
    signals.hasDent ? (hasHail ? "dents and hail marks" : "dents") : undefined,
    signals.hasPaint ? (hasScratch ? "scratch damage" : "paint damage") : undefined,
    signals.hasCollision ? "collision repair" : undefined,
    signals.hasGlass ? "auto glass" : undefined
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) return "body damage and repair questions";
  return joinPlainList(parts);
}

function autoBodyServiceHeadingForBusiness(business: BusinessProfile) {
  const signals = autoBodyServiceSignalsForBusiness(business);
  const serviceText = serviceNamesForBusiness(business).join(" ").toLowerCase();
  const hasHail = /\bhail\b/.test(serviceText);
  const city = business.address?.city;
  if (signals.hasCollision && signals.hasDent && hasHail && signals.hasPaint) return `Dent, hail, paint, and collision repair${city ? ` in ${city}` : ""}.`;
  if (signals.hasCollision && signals.hasDent && hasHail) return `Dent, hail, and collision repair${city ? ` in ${city}` : ""}.`;
  if (signals.hasCollision && signals.hasDent) return "Dents, bumper hits, and panel damage.";
  if (signals.hasCollision && signals.hasPaint) return "Collision damage with paint and panel work.";
  if (signals.hasDent && signals.hasGlass && hasHail) return `Dent, hail, and glass repair${city ? ` in ${city}` : ""}.`;
  if (signals.hasDent && signals.hasGlass) return `Dent and glass repair${city ? ` in ${city}` : ""}.`;
  if (signals.hasGlass && signals.hasPaint) return "Glass, paint, and exterior finish details.";
  if (signals.hasDent && hasHail) return "Dents and hail marks across the vehicle.";
  if (signals.hasDent && signals.hasPaint) return "Dents, paint edges, and panel finish.";
  if (signals.hasCollision) return "Collision damage that needs a closer look.";
  if (signals.hasDent) return "Dents and panel damage.";
  if (signals.hasPaint) return "Paint damage and refinish work.";
  if (signals.hasGlass) return "Glass damage with nearby body details.";
  return "Body damage, paint, and repair questions.";
}

function joinPlainList(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Customer-facing eyebrow. Internal vertical slugs must never render here; the
 * category falls back to the human recipe label set during intake.
 */
function eyebrowForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  const category = business.categories.find((value) => !looksLikeInternalSlug(value));
  if (category && location) return `${category} in ${location}`;
  return category ?? location ?? "Local business";
}

function looksLikeInternalSlug(value: string) {
  return /_/.test(value) || /\bgeneral local\b/i.test(value);
}

function serviceHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    return autoBodyServiceHeadingForBusiness(business);
  }
  if (business.vertical === "auto_services") return "Tires, repairs, and routine service.";
  if (business.vertical === "restaurant") return "The menu, and the ways to get it.";
  if (business.vertical === "home_services") return "Repairs, maintenance, and urgent fixes.";
  if (business.vertical === "beauty_salon") return "Cuts, color, and care.";
  return "Choose the service that fits the visit.";
}

function serviceIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    const city = business.address?.city;
    const glassCopy = autoBodyHasGlassEvidence(business) ? ", glass" : "";
    return `${business.name}${city ? ` in ${city}` : ""} handles the visible damage and the details around it: dents, hail marks, bumper hits, paint scuffs${glassCopy}, and panels that need to line up cleanly again.`;
  }
  if (business.vertical === "auto_services") return "Straightforward tire and auto work with the price confirmed before anything starts.";
  if (business.vertical === "restaurant") return "Scan the main options, then call or order with the timing and group size in mind.";
  if (business.vertical === "beauty_salon") return "Pick the service closest to your goal, then share timing, references, and current hair details.";
  if (business.vertical === "home_services") return "Choose the issue that best matches the visit, then include location and timing when you reach out.";
  return "Pick the closest service, then send the details that affect availability, timing, and fit.";
}

function mediaHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "The details that decide the repair.";
  if (business.vertical === "auto_services") return "Tires, wheels, and the work behind them.";
  return "A closer look at the work.";
}

// Deterministic fallbacks are fact-grounded and never meta: they describe the
// business and its work, not the website or how to use it. The LLM deck covers
// these slots in the normal path; fallbacks only render when the deck is absent.
function splitMediaFallbackHeading(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "The first look is about the whole damaged area.";
  const primary = business.services[0];
  if (primary && business.services[1]) return `${primary} and ${business.services[1].toLowerCase()}, handled in-house.`;
  if (primary) return `${primary}, handled in-house.`;
  return mediaHeadingForBusiness(business);
}

function splitMediaFallbackBody(business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    return "Photos help, but the shop still checks adjacent panels, trim, lights, and paint edges together before discussing the repair.";
  }
  const place = business.address?.city ? ` in ${business.address.city}` : "";
  const services = business.services.slice(0, 3).map((service) => service.toLowerCase()).join(", ");
  if (services) return `${business.name} handles ${services} from the shop${place}.`;
  return `${business.name} serves customers${place} from one location.`;
}

function galleryFallbackBody(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Wide views, close details, paint edges, and trim fit all tell part of the repair story.";
  const place = business.address?.city ? ` in ${business.address.city}` : "";
  return `The kind of work ${business.name} handles${place}.`;
}

function faqHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return autoBodyFaqHeadingForBusiness(business);
  if (business.vertical === "auto_services") return "Common questions before a visit.";
  if (business.vertical === "restaurant") return "Good to know before you visit.";
  if (business.vertical === "home_services") return "Common questions before booking a visit.";
  if (business.vertical === "beauty_salon") return "Common questions before you book.";
  return "Common questions before a first visit.";
}

function autoBodyFaqHeadingForBusiness(business: BusinessProfile) {
  const signals = autoBodyServiceSignalsForBusiness(business);
  const serviceText = serviceNamesForBusiness(business).join(" ").toLowerCase();
  const hailText = /\bhail\b/.test(serviceText) ? "dents, hail, " : "dents, ";
  if (signals.hasCollision && signals.hasDent) return `Questions after ${hailText}or collision damage.`;
  if (signals.hasCollision) return "Questions after collision damage.";
  if (signals.hasDent) return /\bhail\b/.test(serviceText) ? "Questions after dents or hail damage." : "Questions after dents.";
  if (signals.hasPaint) return "Questions after paint damage.";
  return "Questions before body repair.";
}

function seoTitleForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  return [business.name, business.categories[0], location].filter(Boolean).join(" | ");
}

function seoDescriptionForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  const services = serviceNamesForBusiness(business).slice(0, 2);
  const serviceText = compactServiceNameList(services).toLowerCase();
  const locationText = location ? ` in ${location}` : "";
  return `${business.name} handles ${serviceText}${locationText}. Call with photos, timing, and repair details.`;
}

function compactServiceNameList(services: string[]) {
  return joinServiceNames(services.map((service) => service.trim()).filter(Boolean));
}

function locationLineForBusiness(business: BusinessProfile) {
  return [business.address?.city, business.address?.region].filter(Boolean).join(", ");
}

function formatAddress(address: NonNullable<BusinessProfile["address"]>) {
  const regionLine = [address.region, address.postalCode].filter(Boolean).join(" ");
  return [address.street, address.city, regionLine].filter(Boolean).join(", ");
}

function publicEmailForBusiness(email: string | undefined) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return undefined;
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return undefined;
  if (/^(example|domain|yourdomain|test)\./i.test(domain)) return undefined;
  if (/^(user|name|email|you|yourname|test|example)$/i.test(local) && /(?:domain|example|yourdomain)\./i.test(domain)) return undefined;
  return normalized;
}

function hoursSummaryForBusiness(business: BusinessProfile) {
  return hoursSummaryForHours(business.hours);
}

function compactHoursSummaryForBusiness(business: BusinessProfile) {
  const openEntries = hoursEntriesForHours(business.hours).filter(({ value }) => value && !/closed/i.test(value));
  if (openEntries.length) {
    if (openEntries.length > 1) {
      return openEntries
        .slice(0, 2)
        .map(({ label }) => compactHoursDayLabel(label))
        .join(" + ");
    }
    return openEntries
      .slice(0, 2)
      .map(({ label, value }) => `${compactHoursDayLabel(label)} ${compactHoursValue(value)}`)
      .join("; ");
  }
  return hoursSummaryForBusiness(business) ? compactHoursSummaryText(hoursSummaryForBusiness(business)!) : undefined;
}

function compactHoursSummaryText(value: string) {
  return compactHoursValue(compactHoursDayLabel(value));
}

function compactHoursDayLabel(value: string) {
  return value
    .replace(/\bMonday\b/g, "Mon")
    .replace(/\bTuesday\b/g, "Tue")
    .replace(/\bWednesday\b/g, "Wed")
    .replace(/\bThursday\b/g, "Thu")
    .replace(/\bFriday\b/g, "Fri")
    .replace(/\bSaturday\b/g, "Sat")
    .replace(/\bSunday\b/g, "Sun")
    .replace(/\s+\u2013\s+/g, "-")
    .replace(/\s+-\s+/g, "-");
}

function compactHoursValue(value: string) {
  return value
    .replace(/:00(?=\s*[ap]m\b)/gi, "")
    .replace(/\s+/g, "")
    .replace(/\u2013/g, "-");
}

function hoursSummaryForHours(hours: BusinessProfile["hours"] | undefined) {
  if (!hours || !Object.keys(hours).length) return undefined;
  const firstOpenDay = hoursEntriesForHours(hours).find(({ value }) => value && !/closed/i.test(value));
  if (!firstOpenDay) return undefined;
  return `${firstOpenDay.label} ${firstOpenDay.value}`;
}

const weekDayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function dayIndexForHoursLabel(label: string) {
  const lower = label.toLowerCase();
  const index = weekDayOrder.findIndex((day) => lower.includes(day) || lower.includes(day.slice(0, 3)));
  return index === -1 ? weekDayOrder.length : index;
}

export function hoursEntriesForHours(hours: BusinessProfile["hours"] | undefined) {
  if (!hours) return [];
  // Defensive: junk scraped keys and live status strings must never render even
  // if an unnormalized hours record reaches the compiler.
  const entries = Object.entries(hours)
    .filter(([label, value]) => Boolean(value) && !/^hours?[_\s-]*\d*$/i.test(label) && !isDynamicHoursStatus(value))
    .map(([label, value]) => ({ label: titleCaseDay(label), value }))
    .sort((left, right) => dayIndexForHoursLabel(left.label) - dayIndexForHoursLabel(right.label));
  return collapseHoursEntries(entries);
}

/** "Monday 8-5, Tuesday 8-5, ... Friday 8-5" collapses to "Monday \u2013 Friday 8-5". */
function collapseHoursEntries(entries: Array<{ label: string; value: string }>) {
  const singleDay = (label: string) => weekDayOrder.includes(label.toLowerCase());
  if (!entries.length || !entries.every(({ label }) => singleDay(label))) return entries;
  const collapsed: Array<{ label: string; value: string; lastDay: string }> = [];
  for (const entry of entries) {
    const previous = collapsed[collapsed.length - 1];
    const consecutive =
      previous &&
      previous.value === entry.value &&
      dayIndexForHoursLabel(entry.label) === dayIndexForHoursLabel(previous.lastDay) + 1;
    if (previous && consecutive) {
      previous.lastDay = entry.label;
      previous.label = `${previous.label.split(" \u2013 ")[0]} \u2013 ${entry.label}`;
      continue;
    }
    collapsed.push({ label: entry.label, value: entry.value, lastDay: entry.label });
  }
  return collapsed.map(({ label, value }) => ({ label, value }));
}

function titleCaseDay(value: string) {
  return value ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

function sentenceCasePhrase(value: string) {
  return value ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

function phoneHref(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) return phone;
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

export const generatedSiteV3CompilerVersion = compilerVersion;
