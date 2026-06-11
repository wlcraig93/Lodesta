import { defaultDesignPlanForVertical } from "./layout-registry";
import type {
  AssetReference,
  BusinessLocationRecord,
  BusinessProfile,
  ComponentControlSchemaV3,
  GeneratedCopyDeckV2,
  MediaAssetDecisionV3,
  PageModel,
  SectionInstanceV3,
  SiteArtDirectionFontPairingIdV3,
  SiteBundle,
  SiteLocationBinding,
  SiteVersionV3,
  Theme,
  Vertical
} from "./models";
import {
  withVisualSectionV3,
  type FaqItemV3,
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
import {
  registerForVertical,
  resolveDesignControlsV3,
  validateDesignControlsV3,
  type DesignProfileV3
} from "./generated-site-v3-art-direction-catalog";
import { areServicesVerticalDefaults, sentenceOverlapRatio, servicePageMaxOverlapRatio } from "./generation-quality-v2";
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

const compilerVersion = "generated-site-v3-compiler-v1-minimal-template-options";

const backgrounds = {
  page: { kind: "solid", token: "page" },
  surface: { kind: "solid", token: "surface" },
  subtleGradient: { kind: "gradient", token: "subtle" },
  brandGradient: { kind: "gradient", token: "brand" }
} as const satisfies Record<string, SectionBackgroundOptionV3>;

export type GeneratedSiteV3CompileResult = {
  version: SiteVersionV3;
  compositionReport: GeneratedSiteV3CompositionReport;
  brandCueReport: BrandCueReportV2;
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
  hasQuoteProof: boolean;
  hasRealPricingEvidence: boolean;
  hasCredentialTrustProof: boolean;
  hasLocationPanel: boolean;
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
}): GeneratedSiteV3CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const bundle = withBusinessBundleFields("bundle" in input ? input.bundle : temporaryBundleForProfile(input.business, input.siteId));
  const business = bundle.businessProfile;
  const siteId = business.siteId;
  const copyDeck = bundle.presenceAssessment?.generatedCopyDeck;
  const locationContext = locationCompileContextForBundle(bundle);
  const media = selectV3Media(business, input.assetLibraryAssets ?? []);
  const presetTheme = themeForV3Business(business, media.kind);
  const brandDerivation = deriveBrandThemeV2({
    vertical: business.vertical,
    presetTheme,
    renderInspection: bundle.presenceAssessment?.renderInspection,
    brandAssessment: bundle.presenceAssessment?.brandAssessment
  });
  const theme = brandDerivation.theme ?? presetTheme;
  const designProfile = designProfileForBusiness(business, brandDerivation.report.applied);
  const designControls = resolveDesignControlsV3(designProfile);
  const composition = v3PageSectionsForBusiness(business, media, locationContext, copyDeck);
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
      headerMode: imageHeroLeads ? "transparent_overlay" : "solid_editorial"
    });
    if (violations.length && designControls.headerSurface === "brand_bar") {
      designControls.headerSurface = "neutral";
    }
  }
  const pageSections = composition.sections;
  const servicePages = buildServiceLandingPagesV3(business, locationContext, copyDeck, pageSections);
  linkServiceItemsToPages(pageSections, servicePages);
  applyBackgroundRhythm(pageSections, siteId);
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: business.name,
    seo: {
      title: copyDeck?.seo.title ?? seoTitleForBusiness(business),
      description: copyDeck?.seo.description ?? seoDescriptionForBusiness(business),
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  const legacyServicePages: PageModel[] = servicePages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    seo: page.seo,
    layoutSections: [],
    sections: []
  }));
  const version: SiteVersionV3 = {
    id: `version_${siteId}_layout_v3`,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage, ...legacyServicePages],
    designPlan: defaultDesignPlanForVertical(business.vertical, theme),
    createdAt,
    theme,
    presentation: {
      mobileActionBehavior: business.phone ? "always" : "disabled",
      reservedMobileActionSpace: Boolean(business.phone)
    },
    artifactRefs: [],
    mediaDecisions: media.decisions,
    artDirection: media.kind === "media"
      ? {
          version: "site-art-direction-v3",
          recipeId: "precision-service-v1",
          fontPairingId: fontPairingForBusiness(business),
          colorSystem: "high_contrast_neutral",
          spacingRhythm: spacingRhythmForBusiness(business),
          headerMode: "solid_editorial",
          mediaTreatment: "editorial_crop",
          buttonSystem: "solid_with_quiet_secondary",
          cardTreatment: cardTreatmentForBusiness(business),
          density: "balanced",
          sectionPresentation: sectionPresentationWithProfile(business, designProfile),
          designProfile,
          controls: designControls
        }
      : {
          version: "site-art-direction-v3",
          recipeId: "quiet-boutique-v1",
          fontPairingId: fontPairingForBusiness(business),
          colorSystem: "quiet_boutique",
          spacingRhythm: spacingRhythmForBusiness(business),
          headerMode: "solid_editorial",
          mediaTreatment: "text_first_fallback",
          buttonSystem: "understated",
          cardTreatment: cardTreatmentForBusiness(business),
          density: "open",
          sectionPresentation: sectionPresentationWithProfile(business, designProfile),
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
      pages: [
        {
          id: "home",
          slug: "",
          title: business.name,
          seo: legacyHomePage.seo,
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
        }))
      ]
    }
  };
  return { version, compositionReport: composition.report, brandCueReport: brandDerivation.report };
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
      gallery: Array<{ url: string; label: string }>;
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

function fontPairingForBusiness(business: BusinessProfile): SiteArtDirectionFontPairingIdV3 {
  const pool = fontPairingPools[business.vertical] ?? defaultFontPairingPool;
  return pool[siteVariationSeedV2(business.siteId) % pool.length];
}

/** Axis-salted seed so per-axis picks decorrelate across one site id. */
function axisPick<T>(siteId: string, axis: string, pool: readonly T[]): T {
  return pool[siteVariationSeedV2(`${siteId}:${axis}`) % pool.length];
}

/**
 * B3 selector: per-section presentation choices from validated pools. Pools are
 * deliberately conservative — only presentations the grammar harness renders
 * cleanly on both text-only and media shells (e.g. menu_preview needs a dark
 * section and stays out until that combination is harness-validated).
 */
function sectionPresentationForBusiness(business: BusinessProfile): SectionPresentationMapV3 {
  const servicesPools: Partial<Record<Vertical, readonly ListPresentationIdV3[]>> = {
    restaurant: ["numbered_ledger", "card_grid", "action_tiles", "coaching_cards"],
    beauty_salon: ["card_grid", "coaching_cards", "numbered_ledger", "action_tiles"],
    med_spa: ["card_grid", "coaching_cards", "numbered_ledger"],
    creative_studio: ["numbered_ledger", "coaching_cards", "card_grid"]
  };
  const servicesPool = servicesPools[business.vertical] ?? (["card_grid", "action_tiles", "coaching_cards", "numbered_ledger"] as const);
  const map: SectionPresentationMapV3 = {
    services: axisPick(business.siteId, "services", servicesPool),
    process: "program_rows",
    faq: "faq_accordion",
    factsStrip: axisPick(business.siteId, "facts", ["trust_bar", "utility_rail"] as const),
    heroFacts: "inline_strip",
    contactFacts: "stacked",
    gallery: axisPick(business.siteId, "gallery", ["mosaic", "collage", "editorial_strip"] as const),
    quotes: "action_tiles"
  };
  const violations = validateSectionPresentationMapV3(map);
  if (violations.length) {
    // Selector bugs must fail loudly in development, never ship invalid maps.
    throw new Error(`Art direction selector produced an invalid presentation map: ${violations.map((violation) => violation.reason).join("; ")}`);
  }
  return map;
}

/**
 * Background rhythm (craft roadmap, Track 1.4): the middle sections alternate
 * tonal backgrounds per a seed-picked pattern so the page stops reading as one
 * unbroken run of white cards on cream. Hero, CTA band, and contact keep their
 * deliberate backgrounds; contrast safety is enforced by the existing
 * foreground-token derivation + render QA.
 */
function applyBackgroundRhythm(sections: SectionInstanceV3[], siteId: string): void {
  const patterns: Array<Array<keyof typeof backgrounds>> = [
    ["surface", "page", "subtleGradient", "page", "surface"],
    ["page", "subtleGradient", "page", "surface", "subtleGradient"],
    ["subtleGradient", "surface", "page", "subtleGradient", "page"]
  ];
  const pattern = patterns[siteVariationSeedV2(`${siteId}:rhythm`) % patterns.length];
  const rhythmSectionIds = new Set(["story", "services", "process", "about", "gallery", "faq"]);
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
  const seededForward = siteVariationSeedV2(`${business.siteId}:posture`) % 2 === 0;
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
function sectionPresentationWithProfile(business: BusinessProfile, profile: DesignProfileV3) {
  const base = sectionPresentationForBusiness(business) ?? {};
  if (profile.register !== "punchy_retail") return base;
  const seed = siteVariationSeedV2(`${business.siteId}:retail-presentation`);
  return {
    ...base,
    heroFacts: "hero_chips" as const,
    ...(profile.brandPosture === "accent_forward" && seed % 2 === 0 ? { factsStrip: "marquee" as const } : {})
  };
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
  primaryLocation?: RenderableLocationV3;
  hasLocationPanel: boolean;
  hasPhysicalLocation: boolean;
};

function v3PageSectionsForBusiness(
  business: BusinessProfile,
  media: SelectedV3Media,
  locationContext: LocationCompileContextV3,
  deck?: GeneratedCopyDeckV2
): V3Composition {
  const recipeId = v3RecipeIdForVertical(business.vertical);
  const services = serviceItemsForBusiness(business, deck);
  const gallery = galleryForSelectedMedia(media);
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

  if (evidence.hasSafeHeroMedia) {
    // Hero family rotation: full-bleed image hero vs split hero, by seed.
    const useImageHero = siteVariationSeedV2(`${business.siteId}:hero`) % 2 === 0 && gallery.length > 0;
    if (useImageHero) {
      include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "Safe hero media is available; the seed selects the full-bleed image hero.", heroImageStatementSection(business, gallery[0].url, deck));
    } else {
      include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "Safe hero media is available, so the recipe uses hero_split.", heroSplitSection(business, gallery, deck));
    }
  } else {
    include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "No safe hero media is available, so the recipe uses hero_statement.", heroStatementSection(business, deck));
  }

  if (proofFactsForBusiness(business).length >= 3) {
    include("facts", "proof.section_template", "facts_strip", "hasCredentialTrustProof", "Facts strip renders because at least three real business facts are available.", factsStripSection(business));
  } else {
    skip("facts_strip", "hasCredentialTrustProof", "Skipped facts_strip because fewer than three real business facts are available; filler facts are not rendered.");
  }

  if (evidence.hasSafeHeroMedia) {
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
    skip("story_split_media", "hasSafeHeroMedia", "Skipped split_media because no safe media is available.");
  }

  // Media-headed cards (catalog batch): when enough distinct safe images
  // exist, the first service cards carry section-grade figures — the
  // demo-parity treatment. Hero keeps gallery[0]; cards draw from the rest.
  const cardMediaPool = gallery.slice(1, 1 + Math.min(3, Math.max(0, gallery.length - 1)));
  const servicesWithMedia =
    cardMediaPool.length >= 3
      ? services.map((item, index) => (index < cardMediaPool.length ? { ...item, mediaUrl: cardMediaPool[index].url } : item))
      : services;
  if (services.length >= 4) {
    include("services", "services.section_template", "services", "serviceCount", "Four or more service items fit the side_intro_rows service geometry.", serviceRowsSection(business, services, deck));
  } else {
    include("services", "services.section_template", "services", "serviceCount", "Three service cards fit intro_grid.", introGridSection(business, servicesWithMedia, "standard", deck));
  }

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

  include("process", "process.section_template", "process_steps", "serviceCount", "Process uses deterministic row geometry with vertical-specific steps.", processRowsSection(business, deck));

  // Guideline: when the source reveals a story (family-owned, founders,
  // mascots), it gets its own section — distinctiveness is conversion surface.
  if (deck?.about?.body) {
    include("about", "about.section_template", "business_story", "recipe", "Source material revealed a business story; the about section presents it.", aboutStorySection(business, deck));
  } else {
    skip("business_story", "recipe", "No business story was found in the source material.");
  }

  if (evidence.safeMediaCount >= 4) {
    include("gallery", "media.section_template", "media_gallery", "safeMediaCount", "Four or more safe media items select media_mosaic.", mediaMosaicSection(business, gallery, deck));
  } else {
    skip("media_gallery", "safeMediaCount", "Skipped media_mosaic because fewer than four safe media items are available.");
  }

  if (evidence.safeMediaCount >= 2 && evidence.safeMediaCount <= 3) {
    include("media", "media.section_template", "media_feature", "safeMediaCount", "Two to three safe media items select media_feature.", mediaFeatureSection(business, gallery));
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
  include(
    "cta_band",
    "conversion.section_template",
    "conversion_band",
    "hasPhone",
    conversionBackgroundUrl
      ? "Approved generic category background gives the page a clear closing CTA before contact."
      : "Brand-colored conversion band gives the page a clear closing CTA before contact.",
    conversionBandSection(business, conversionBackgroundUrl)
  );

  if (locationContext.hasLocationPanel) {
    include("location", "local.section_template", "location_panel", "hasLocationPanel", "First-party location facts are available, so the recipe adds a dedicated location panel before contact.", locationPanelSection(business, locationContext, deck));
  } else {
    skip("location_panel", "hasLocationPanel", "Skipped location_panel because no first-party location or service-area facts were available.");
  }

  include("contact", "contact.section_template", "contact", "hasPhone", "Contact is required in every V3 recipe and normalizes sparse contact data.", contactSplitSection(business, locationContext, deck));

  return {
    sections,
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

type ServiceLandingPageV3 = {
  id: string;
  slug: string;
  title: string;
  seo: PageModel["seo"];
  sections: SectionInstanceV3[];
};

/**
 * Service landing pages with anti-doorway enforcement: pages exist only for
 * source-backed services with substantively distinct, service-specific copy.
 * Below threshold means fewer pages, never thinner ones.
 */
/**
 * Homepage service cards link to their landing pages ("Learn more →"), making
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
    for (const item of slots.items?.items ?? []) {
      const title = item.title.toLowerCase();
      const match = pageByService.find((entry) => title.includes(entry.name) || entry.name.includes(title));
      if (match) item.href = `/${match.slug}`;
    }
  }
}

function buildServiceLandingPagesV3(
  business: BusinessProfile,
  locationContext: LocationCompileContextV3,
  deck: GeneratedCopyDeckV2 | undefined,
  homepageSections: SectionInstanceV3[]
): ServiceLandingPageV3[] {
  if (!deck?.servicePages?.length) return [];
  // Vertical-default services are unverified claims; they never earn pages.
  if (areServicesVerticalDefaults(business.services, business.vertical)) return [];

  const homepageTexts = sectionTextsForOverlap(homepageSections);
  const accepted: ServiceLandingPageV3[] = [];
  const usedSlugs = new Set<string>();

  for (const pageCopy of deck.servicePages.slice(0, 4)) {
    const matchedService = business.services.find(
      (service) =>
        service.toLowerCase().includes(pageCopy.serviceName.toLowerCase()) ||
        pageCopy.serviceName.toLowerCase().includes(service.toLowerCase())
    );
    if (!matchedService) continue;

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

    const slug = slugify(pageCopy.serviceName);
    if (!slug || usedSlugs.has(slug)) continue;
    usedSlugs.add(slug);

    const idPrefix = `svc_${slug}`;
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
      visualSection(`${idPrefix}_detail`, "statement.section_template", {
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
      visualSection(`${idPrefix}_contact`, "contact.section_template", contactSplitSection(business, locationContext, deck))
    ];

    accepted.push({
      id: `page_${slug}`,
      slug,
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

function sectionTextsForOverlap(sections: SectionInstanceV3[]): string[] {
  const texts: string[] = [];
  const sharedChrome = new Set(["contact_split", "facts_strip", "location_panel", "facts_cta"]);
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
    hasBeforeAfterProof: gallery.some((item) => /before|after|proof|finished|repair/i.test(`${item.url} ${item.label}`)),
    hasQuoteProof: quoteItems.length >= 3,
    hasRealPricingEvidence: pricingItemsForBusiness(business).length >= 3,
    hasCredentialTrustProof: Boolean(business.phone || business.address || business.reviewsSummary?.count || services.length),
    hasLocationPanel: locationContext.hasLocationPanel
  };
}

function galleryForSelectedMedia(media: SelectedV3Media): Array<{ url: string; label: string }> {
  if (media.kind !== "media") return [];
  return media.gallery.length ? media.gallery : [{ url: media.heroUrl, label: "Business photo" }];
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
  return {
    locations: normalizedLocations,
    primaryLocation: normalizedLocations.find((location) => location.isPrimary),
    hasLocationPanel: normalizedLocations.length > 0,
    hasPhysicalLocation: normalizedLocations.some((location) => Boolean(location.addressLine || location.mapEmbedIntent?.kind === "geo"))
  };
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
  const isPhysical = Boolean(location.address || location.geo);
  return {
    id: location.id,
    label: location.label ?? location.address?.city ?? location.serviceAreas[0] ?? business.name,
    role: binding.role,
    isPrimary: binding.role === "primary",
    addressLine,
    localityLine,
    phone: location.phone ?? business.phone,
    email: location.email ?? business.email,
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

function heroSplitSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "hero_split",
    options: { background: backgrounds.page },
    slots: {
      copy: {
        eyebrow: deck?.hero.eyebrow ?? eyebrowForBusiness(business),
        heading: deck?.hero.heading ?? headlineForBusiness(business, "media"),
        body: deck?.hero.body ?? subheadlineForBusiness(business),
        actions: heroActionsForBusiness(business)
      },
      media: mediaSlot(gallery.slice(0, 1)),
      facts: { items: proofFactsForBusiness(business).slice(0, 4) }
    }
  };
}

function heroStatementSection(business: BusinessProfile, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  // Seeded variation keeps same-vertical sites from rendering pixel-identical.
  const align = siteVariationSeedV2(business.siteId) % 2 === 0 ? "center" : "left";
  return {
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align, background: backgrounds.subtleGradient },
    slots: {
      copy: {
        eyebrow: deck?.hero.eyebrow ?? eyebrowForBusiness(business),
        heading: deck?.hero.heading ?? headlineForBusiness(business, "text"),
        body: deck?.hero.body ?? subheadlineForBusiness(business),
        actions: heroActionsForBusiness(business)
      },
      facts: { items: proofFactsForBusiness(business).slice(0, 4) }
    }
  };
}

/**
 * Full-bleed image hero: the business's real photo behind scrimmed copy — the
 * highest-impact hero when a strong wide photo exists. CSS scrim +
 * foreground-token derivation keep text WCAG-safe; render QA gates it.
 */
function heroImageStatementSection(business: BusinessProfile, heroUrl: string, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align: "left", background: { kind: "image", url: heroUrl } },
    slots: {
      copy: {
        eyebrow: deck?.hero.eyebrow ?? eyebrowForBusiness(business),
        heading: deck?.hero.heading ?? headlineForBusiness(business, "text"),
        body: deck?.hero.body ?? subheadlineForBusiness(business),
        actions: heroActionsForBusiness(business)
      },
      facts: { items: proofFactsForBusiness(business).slice(0, 4) }
    }
  };
}

function splitMediaSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>, mediaSide: "left" | "right" = "left", deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "split_media",
    anchorId: "proof",
    options: { background: backgrounds.subtleGradient, mediaSide },
    slots: {
      copy: {
        eyebrow: "Approach",
        heading: deck?.splitMedia.heading ?? splitMediaFallbackHeading(business),
        body: deck?.splitMedia.body ?? splitMediaFallbackBody(business),
        actions: [{ label: business.phone ? "Talk through timing" : "Send the details", href: business.phone ? `tel:${phoneHref(business.phone)}` : "#contact", style: "text" }]
      },
      media: mediaSlot(gallery.slice(1, 2).length ? gallery.slice(1, 2) : gallery.slice(0, 1))
    }
  };
}

function introGridSection(business: BusinessProfile, services: StandardItemV3[], cardTreatment: "standard" | "comparison", deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "intro_grid",
    anchorId: "services",
    options: { background: backgrounds.subtleGradient, cardTreatment },
    slots: {
      intro: {
        eyebrow: "Services",
        heading: deck?.servicesIntro.heading ?? serviceHeadingForBusiness(business),
        body: deck?.servicesIntro.body ?? serviceIntroForBusiness(business)
      },
      items: { items: dedupeStandardItems(services).slice(0, 3) }
    }
  };
}

function serviceRowsSection(business: BusinessProfile, services: StandardItemV3[], deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "services",
    options: { background: backgrounds.surface },
    slots: {
      intro: {
        eyebrow: "Services",
        heading: deck?.servicesIntro.heading ?? serviceHeadingForBusiness(business),
        body: deck?.servicesIntro.body ?? serviceIntroForBusiness(business)
      },
      items: { items: dedupeStandardItems(services).slice(0, 4) }
    }
  };
}

function processRowsSection(business: BusinessProfile, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  const items = deck
    ? deck.processSteps.map((step, index) => ({ title: step.title, body: step.body, meta: String(index + 1).padStart(2, "0") }))
    : processItemsForBusiness(business);
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "process",
    options: { background: backgrounds.surface },
    slots: {
      intro: {
        eyebrow: "Process",
        heading: deck?.processIntro.heading ?? processHeadingForBusiness(business),
        body: deck?.processIntro.body ?? processIntroForBusiness(business)
      },
      items: { items: dedupeStandardItems(items) }
    }
  };
}

function processHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_services") return "From pulling in to driving out.";
  if (business.vertical === "restaurant") return "From order to table.";
  if (business.vertical === "home_services") return "From first call to finished work.";
  if (business.vertical === "beauty_salon") return "From booking to the chair.";
  return "A simple path from first call to shop review.";
}

function processIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Keep the first conversation practical: vehicle, damage area, photos, timing, and preferred contact.";
  if (business.vertical === "auto_services") return "Most visits start with a quick look at the tire or the symptom, then a clear price before any work starts.";
  if (business.vertical === "restaurant") return "Order ahead, dine in, or plan something bigger; the kitchen works the same way either way.";
  if (business.vertical === "home_services") return "Most jobs follow the same path: describe the issue, get a window and estimate, and watch the work get done.";
  if (business.vertical === "beauty_salon") return "Booking ahead holds your time and stylist; the plan is confirmed in the chair before anything starts.";
  return "Keep the first conversation focused on timing, fit, and contact details.";
}

function mediaFeatureSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "media_feature",
    options: { background: backgrounds.surface },
    slots: {
      copy: {
        eyebrow: "Setting",
        heading: mediaHeadingForBusiness(business),
        body: galleryFallbackBody(business)
      },
      media: mediaSlot(gallery.slice(2, 3).length ? gallery.slice(2, 3) : gallery.slice(0, 1))
    }
  };
}

function mediaMosaicSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "media_mosaic",
    options: { background: backgrounds.surface },
    slots: {
      copy: {
        eyebrow: "Gallery",
        heading: deck?.gallery.heading ?? mediaHeadingForBusiness(business),
        body: deck?.gallery.body ?? galleryFallbackBody(business)
      },
      media: mediaSlot(normalizeMediaItems(gallery, 3))
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
        body: "Use confirmed customer language when it exists; otherwise this section stays out of the page."
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
      items: { items: deck ? deck.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })) : faqItemsForBusiness(business) }
    }
  };
}

function faqIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_services") return "The questions customers ask most before a tire or service visit.";
  if (business.vertical === "auto_body") return "The questions customers ask most before bringing a vehicle in.";
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

function aboutStorySection(business: BusinessProfile, deck: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "editorial_statement",
    anchorId: "about",
    options: { background: backgrounds.subtleGradient },
    slots: {
      copy: {
        eyebrow: "About",
        heading: deck.about?.heading ?? `The people behind ${business.name}.`,
        body: deck.about?.body ?? "",
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
        eyebrow: "Next step",
        heading: "The first step should be simple.",
        body: `${business.name} can keep the request focused on the service, timing, and best callback details.`,
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
function conversionBandSection(business: BusinessProfile, backgroundUrl?: string): VisualSectionV3 {
  const primaryService = business.services[0];
  const heading = primaryService ? `Need ${primaryService.toLowerCase()}?` : `Ready when you are.`;
  const body = business.phone
    ? `Call ${formatPhone(business.phone)} for a straight answer on price and timing.`
    : "Send the details and we'll get right back to you.";
  return {
    version: "visual-section-v3",
    templateId: "editorial_statement",
    anchorId: "cta",
    options: { background: backgroundUrl ? { kind: "image", url: backgroundUrl, focalPoint: "center" } : backgrounds.brandGradient },
    slots: {
      copy: {
        heading,
        body,
        actions: [primaryCtaForBusiness(business)]
      }
    }
  };
}

function locationPanelSection(business: BusinessProfile, locationContext: LocationCompileContextV3, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  const hasPhysicalLocation = locationContext.hasPhysicalLocation;
  const locationCount = locationContext.locations.length;
  return {
    version: "visual-section-v3",
    templateId: "location_panel",
    anchorId: "location",
    options: { background: backgrounds.surface },
    slots: {
      copy: {
        eyebrow: hasPhysicalLocation ? "Location" : "Service area",
        heading: deck?.locationIntro?.heading ?? (locationCount > 1 ? "Choose the right location before you reach out." : hasPhysicalLocation ? "Location, hours, and directions." : "Coverage details before you reach out."),
        body: deck?.locationIntro?.body ?? (hasPhysicalLocation
          ? `${business.name} keeps the practical visit details close to the contact path.`
          : `${business.name} serves the listed areas and can confirm fit when you call or send details.`)
      },
      locations: { locations: locationContext.locations },
      action: {
        title: business.phone ? "Confirm before you visit." : "Send the details first.",
        body: business.phone ? "Use the call button to confirm timing, service fit, and arrival details." : "Use the contact path to confirm service fit and timing.",
        cta: primaryCtaForBusiness(business)
      }
    }
  };
}

function contactSplitSection(business: BusinessProfile, locationContext?: LocationCompileContextV3, deck?: GeneratedCopyDeckV2): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "contact_split",
    anchorId: "contact",
    options: { background: backgrounds.brandGradient },
    slots: {
      copy: {
        eyebrow: "Contact",
        heading: deck?.contactIntro.heading ?? (business.phone ? "Call or send a short message." : "Send a short message."),
        body: deck?.contactIntro.body ?? "Include what you need, any timing constraints, and the best callback details.",
        actions: [primaryCtaForBusiness(business)]
      },
      contact: { facts: contactFactsForBusiness(business, locationContext) }
    }
  };
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

function controlForTemplate(templateId: SectionTemplateIdV3): ComponentControlSchemaV3 {
  const layout = controlLayoutForTemplate(templateId);
  return {
    layout,
    alignment: layout === "single_column" ? "center" : "split",
    width: "wide",
    padding: "spacious",
    background: templateId === "contact_split" ? "contrast" : "surface",
    mediaCrop: templateId === "hero_split" || templateId === "split_media" || templateId === "media_feature" || templateId === "media_mosaic" ? "subject" : "none",
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
    case "quote_wall":
      return "card_grid";
    case "side_intro_rows":
    case "faq_list":
      return "editorial_rows";
    case "feature_band":
      return "architectural_split";
    case "media_feature":
      return "asymmetric_grid";
    case "media_mosaic":
      return "mosaic_grid";
    case "facts_cta":
      return "story_panel";
    case "location_panel":
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

function selectV3Media(business: BusinessProfile, assetLibraryAssets: ApprovedAssetLibraryAsset[] = []): SelectedV3Media {
  // Real business photos first: public-safe always; privately stored scraped
  // photos under the protected-preview policy (publish requires attestation).
  const heroPhoto = business.photos.find((asset) => isProtectedPreviewEligibleMedia(asset));
  if (heroPhoto) {
    const eligibleGallery = business.photos.filter(isProtectedPreviewEligibleMedia).slice(0, 5).map((asset) => ({ url: asset.url, label: asset.alt || "Business photo" }));
    const requiresAttestation = !isPublicSafeMedia(heroPhoto) || business.photos.filter(isProtectedPreviewEligibleMedia).some((asset) => !isPublicSafeMedia(asset));
    return {
      kind: "media",
      heroUrl: heroPhoto.url,
      gallery: eligibleGallery.length ? eligibleGallery : [{ url: heroPhoto.url, label: heroPhoto.alt || "Business photo" }],
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
  if (business.vertical === "auto_services" || business.vertical === "auto_body") {
    const libraryMedia = selectAutomotiveLibraryMedia(business, assetLibraryAssets);
    if (libraryMedia) return libraryMedia;
  }
  if (business.vertical === "auto_body") {
    const gallery = [
      { url: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg", label: "Bodywork overview" },
      { url: "/generated-site-assets/auto-body/paint-refinish-closeup-v1.png", label: "Paint refinishing" },
      { url: "/generated-site-assets/auto-body/exterior-hail-dent-panel-v1.png", label: "Dent and hail damage" }
    ];
    return {
      kind: "media",
      heroUrl: gallery[0].url,
      gallery,
      decisions: [
        {
          id: `media_${business.siteId}_auto_context`,
          version: "media-asset-decision-v3",
          slotId: "home.hero.media",
          source: "curated_stock",
          rightsStatus: "approved",
          usageScope: "hero",
          sourceUrl: gallery[0].url,
          policyNotes: ["Curated generic auto-body media. Does not imply real business staff, location, or documented customer work."],
          mayImplyRealBusinessWork: false
        }
      ]
    };
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
        background: "#f5f4f0",
        surface: "#fffefa",
        text: "#16181a",
        muted: "#5c6065",
        primary: "#1f3a5f",
        primaryText: "#ffffff",
        accent: "#e0a325",
        border: "#dad8cf"
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
        background: "#f6f2ea",
        surface: "#fffdf8",
        text: "#171512",
        muted: "#665f55",
        primary: "#951f2f",
        primaryText: "#ffffff",
        accent: "#e0a325",
        border: "#ded6ca"
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
    return deck.serviceItems.map((item, index) => ({
      title: item.title,
      body: item.body,
      meta: String(index + 1).padStart(2, "0")
    }));
  }
  return serviceNamesForBusiness(business).map((service, index) => ({
    title: service,
    body: serviceBodyForBusiness(service, business),
    meta: String(index + 1).padStart(2, "0")
  }));
}

/**
 * Dedupes items by normalized title and renumbers metadata. Items are never
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
  return unique.map((item, index) => ({ ...item, meta: String(index + 1).padStart(2, "0") }));
}

function normalizeMediaItems(items: Array<{ url: string; label: string }>, count: number): Array<{ url: string; label: string }> {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, count);
}

const fallbackServicePools: Partial<Record<Vertical, string[]>> = {
  auto_body: ["Collision repair", "Paint refinishing", "Dent repair", "Auto glass"],
  auto_services: ["Flat repair", "New and used tires", "Tire rotation and balancing", "Brake service"],
  restaurant: ["Dine-in", "Takeout and pickup", "Catering"],
  home_services: ["Emergency service", "Repairs", "Maintenance"],
  beauty_salon: ["Cuts and styling", "Color services", "Treatments"]
};

function serviceNamesForBusiness(business: BusinessProfile) {
  const sourceServices = business.services.length ? business.services : business.serviceHighlights ?? [];
  const pool = fallbackServicePools[business.vertical] ?? [];
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
    names.push(service);
    if (names.length >= 4) break;
  }
  for (const service of [...pool, ...business.categories]) {
    if (names.length >= 3) break;
    if (!service.trim() || overlapsExisting(service)) continue;
    names.push(service);
  }
  return names;
}

function serviceBodyForBusiness(service: string, business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    if (/collision|body/i.test(service)) return "Visible body damage after an accident, including panels and bumpers.";
    if (/bumper/i.test(service)) return "Bumper cover damage, scuffs, cracks, or impact areas that need shop review.";
    if (/dent|hail|pdr/i.test(service)) return "Dent and hail needs when the visible damage fits that service.";
    if (/glass|windshield|window/i.test(service)) return "Windshield or window damage that needs shop attention.";
    if (/\bpaint\b|refinish/i.test(service)) return "Exterior paint work for scraped, repaired, or refinished surfaces.";
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
  return `${service} with a direct way to ask about availability and fit.`;
}

function processItemsForBusiness(business: BusinessProfile): StandardItemV3[] {
  const autoBodyItems = [
    {
      title: "Share the situation",
      body: "Start with the vehicle, the damaged area, whether it can be driven, and any photos you already have."
    },
    {
      title: "Confirm the fit",
      body: "The shop can route the request toward collision, paint, dent, glass, or a closer review."
    },
    {
      title: "Plan the visit",
      body: "Use the call to confirm timing, location, and the best way to keep the repair moving."
    },
    {
      title: "Bring the basics",
      body: "Vehicle details, insurance questions, photos, and availability help keep the first review clear."
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
  return {
    quote,
    attribution: attributionText?.trim() || "Customer review"
  };
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
function proofFactsForBusiness(business: BusinessProfile): VisualFactV3[] {
  const hoursSummary = hoursSummaryForBusiness(business);
  return [
    ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
    ...(business.address ? [{ label: "Location", value: locationLineForBusiness(business) }] : []),
    ...(hoursSummary ? [{ label: "Hours", value: hoursSummary }] : []),
    ...(business.serviceAreas.length && !business.address ? [{ label: "Serves", value: business.serviceAreas.slice(0, 2).join(", ") }] : [])
  ].slice(0, 4);
}

function contactFactsForBusiness(business: BusinessProfile, locationContext?: LocationCompileContextV3): VisualFactV3[] {
  const hoursSummary = hoursSummaryForBusiness(business);
  const fullFacts = () => {
    const facts: VisualFactV3[] = [
      ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
      ...(business.email ? [{ label: "Email", value: business.email, href: `mailto:${business.email}` }] : []),
      ...(business.address ? [{ label: "Address", value: formatAddress(business.address) }] : []),
      ...(hoursSummary ? [{ label: "Hours", value: hoursSummary }] : [])
    ];
    // Sparse-contact businesses pad the slot minimum with real navigational
    // facts, never synthesized filler.
    if (facts.length < 3) {
      const serviceNames = serviceNamesForBusiness(business).slice(0, 2);
      if (serviceNames.length) facts.push({ label: "Services", value: serviceNames.join(", "), href: "#services" });
    }
    if (facts.length < 3) facts.push({ label: "Message", value: "Use the form", href: "#contact" });
    if (facts.length < 3) facts.push({ label: "Questions", value: "Read the FAQ", href: "#faq" });
    return facts.slice(0, 4);
  };

  if (!locationContext?.hasLocationPanel) return fullFacts();

  const conversionFacts: VisualFactV3[] = [
    ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
    ...(business.email ? [{ label: "Email", value: business.email, href: `mailto:${business.email}` }] : []),
    { label: "Location", value: locationContext.locations.length > 1 ? "View locations" : "View details", href: "#location" },
    { label: "Message", value: "Use the form", href: "#contact" }
  ];
  return conversionFacts.length >= 3 ? conversionFacts.slice(0, 4) : fullFacts();
}

function faqItemsForBusiness(business: BusinessProfile): FaqItemV3[] {
  if (business.vertical === "auto_body") {
    return [
      { question: "What should I have ready when I call?", answer: "Vehicle year, make, model, the damaged area, and any photos you already have." },
      { question: "Can I ask about dent or hail repair?", answer: "Yes. Call with the damaged area, how it happened, and whether you already have photos." },
      { question: "Can glass damage be included?", answer: "For windshield or window damage, include which glass is affected and whether the vehicle can be driven." },
      { question: "How should I describe paint damage?", answer: "Mention scraped, repaired, or refinished surfaces and whether the damage affects one panel or several." }
    ];
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
    { question: "Can I ask a quick question first?", answer: "Yes. A short message or call is enough to confirm the right path." }
  ];
}

function mediaSlot(items: Array<{ url: string; label: string }>): MediaSlotV3 {
  return { items: items.map((item) => ({ url: item.url, label: item.label })), focalPoint: "center", caption: "none" };
}

function heroActionsForBusiness(business: BusinessProfile): VisualCtaV3[] {
  return [
    primaryCtaForBusiness(business),
    { label: "View services", href: "#services", style: "secondary" }
  ];
}

/**
 * Primary conversion action follows the vertical's goal: ordering for
 * restaurants, booking for appointment trades, phone-first otherwise.
 */
function primaryCtaForBusiness(business: BusinessProfile): VisualCtaV3 {
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
    ? { label: "Call now", href: `tel:${phoneHref(business.phone)}`, style: "primary" }
    : { label: "Send details", href: "#contact", style: "primary" };
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
  const services = compactServiceList(serviceItemsForBusiness(business));
  const location = locationLineForBusiness(business);
  if (business.vertical === "auto_body") {
    return `${business.name} handles ${services.toLowerCase()}${location ? ` in ${location}` : ""}. Call with the vehicle, visible damage, photos, and timing.`;
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
  const serviceText = serviceNamesForBusiness(business).join(" ").toLowerCase();
  const location = business.address?.city || locationLineForBusiness(business);
  const locationPrefix = location ? `${location} ` : "";
  const hasDent = /\b(dent|pdr|hail)\b/.test(serviceText);
  const hasPaint = /\bpaint|refinish\b/.test(serviceText);
  const hasGlass = /\bglass|windshield|window\b/.test(serviceText);
  if (hasDent && hasPaint && hasGlass) return `${locationPrefix}dents, paint, glass, and collision repair.`;
  if (hasDent && hasPaint) return `${locationPrefix}dents, paint, and collision repair.`;
  return `${locationPrefix}auto body repair without the guesswork.`;
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
  if (business.vertical === "auto_body") return "Collision, paint, dent, and glass repair.";
  if (business.vertical === "auto_services") return "Tires, repairs, and routine service.";
  if (business.vertical === "restaurant") return "The menu, and the ways to get it.";
  if (business.vertical === "home_services") return "Repairs, maintenance, and urgent fixes.";
  if (business.vertical === "beauty_salon") return "Cuts, color, and care.";
  return "Choose the service that fits the visit.";
}

function serviceIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Start with the visible damage, then call with the vehicle details and any photos you already have.";
  if (business.vertical === "auto_services") return "Straightforward tire and auto work with the price confirmed before anything starts.";
  if (business.vertical === "restaurant") return "Scan the main options, then call or order with the timing and group size in mind.";
  if (business.vertical === "beauty_salon") return "Pick the service closest to your goal, then share timing, references, and current hair details.";
  if (business.vertical === "home_services") return "Choose the issue that best matches the visit, then include location and timing when you reach out.";
  return "Pick the closest service, then send the details that affect availability, timing, and fit.";
}

function mediaHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Body panels, paint, dents, and glass.";
  if (business.vertical === "auto_services") return "Tires, wheels, and the work behind them.";
  return "A closer look at the work.";
}

// Deterministic fallbacks are fact-grounded and never meta: they describe the
// business and its work, not the website or how to use it. The LLM deck covers
// these slots in the normal path; fallbacks only render when the deck is absent.
function splitMediaFallbackHeading(business: BusinessProfile) {
  const primary = business.services[0];
  if (primary && business.services[1]) return `${primary} and ${business.services[1].toLowerCase()}, handled in-house.`;
  if (primary) return `${primary}, handled in-house.`;
  return mediaHeadingForBusiness(business);
}

function splitMediaFallbackBody(business: BusinessProfile) {
  const place = business.address?.city ? ` in ${business.address.city}` : "";
  const services = business.services.slice(0, 3).map((service) => service.toLowerCase()).join(", ");
  if (services) return `${business.name} handles ${services} from the shop${place}.`;
  return `${business.name} serves customers${place} from one location.`;
}

function galleryFallbackBody(business: BusinessProfile) {
  const place = business.address?.city ? ` in ${business.address.city}` : "";
  return `The kind of work ${business.name} handles${place}.`;
}

function faqHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Before you call, have the basics ready.";
  if (business.vertical === "auto_services") return "Common questions before a visit.";
  if (business.vertical === "restaurant") return "Good to know before you visit.";
  if (business.vertical === "home_services") return "Common questions before booking a visit.";
  if (business.vertical === "beauty_salon") return "Common questions before you book.";
  return "Common questions before a first visit.";
}

function seoTitleForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  return [business.name, business.categories[0], location].filter(Boolean).join(" | ");
}

function seoDescriptionForBusiness(business: BusinessProfile) {
  return `${business.name} provides ${compactServiceList(serviceItemsForBusiness(business)).toLowerCase()}${locationLineForBusiness(business) ? ` in ${locationLineForBusiness(business)}` : ""}.`;
}

function compactServiceList(services: Array<{ title: string }>) {
  return services.map((service) => service.title).slice(0, 4).join(", ");
}

function locationLineForBusiness(business: BusinessProfile) {
  return [business.address?.city, business.address?.region].filter(Boolean).join(", ");
}

function formatAddress(address: NonNullable<BusinessProfile["address"]>) {
  return [address.street, address.city, address.region].filter(Boolean).join(", ");
}

function hoursSummaryForBusiness(business: BusinessProfile) {
  return hoursSummaryForHours(business.hours);
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
