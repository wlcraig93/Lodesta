import { defaultDesignPlanForVertical } from "./layout-registry";
import type {
  AssetReference,
  BusinessLocationRecord,
  BusinessProfile,
  ComponentControlSchemaV3,
  MediaAssetDecisionV3,
  PageModel,
  SectionInstanceV3,
  SiteBundle,
  SiteLocationBinding,
  SiteVersionV3,
  Theme
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
  type VisualSectionV3
} from "./generated-site-v3-visual-controls";
import { withBusinessBundleFields } from "./business-model";

const compilerVersion = "generated-site-v3-compiler-v1-minimal-template-options";

const backgrounds = {
  page: { kind: "solid", token: "page" },
  surface: { kind: "solid", token: "surface" },
  subtleGradient: { kind: "gradient", token: "subtle" },
  brandGradient: { kind: "gradient", token: "brand" }
} satisfies Record<string, SectionBackgroundOptionV3>;

export type GeneratedSiteV3CompileResult = {
  version: SiteVersionV3;
  compositionReport: GeneratedSiteV3CompositionReport;
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

export type GeneratedSiteV3CompositionReport = {
  version: "generated-site-v3-composition-report-v1";
  selectedRecipe: "auto_body_v1";
  recipeSelection: {
    selectedRecipe: "auto_body_v1";
    reason: string;
    signals: string[];
  };
  evidence: GeneratedSiteV3EvidenceSignals;
  decisions: GeneratedSiteV3CompositionDecision[];
};

export function compileGeneratedSiteV3Site(input: {
  bundle: SiteBundle;
  createdAt?: string;
} | {
  siteId: string;
  business: BusinessProfile;
  createdAt?: string;
}): GeneratedSiteV3CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const bundle = withBusinessBundleFields("bundle" in input ? input.bundle : temporaryBundleForProfile(input.business, input.siteId));
  const business = bundle.businessProfile;
  const siteId = business.siteId;
  const locationContext = locationCompileContextForBundle(bundle);
  const media = selectV3Media(business);
  const theme = themeForV3Business(business, media.kind);
  const composition = autoBodyV1PageSections(business, media, locationContext);
  const pageSections = composition.sections;
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: business.name,
    seo: {
      title: seoTitleForBusiness(business),
      description: seoDescriptionForBusiness(business),
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  const version: SiteVersionV3 = {
    id: `version_${siteId}_layout_v3`,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage],
    designPlan: defaultDesignPlanForVertical(business.vertical, theme),
    createdAt,
    theme,
    artifactRefs: [],
    mediaDecisions: media.decisions,
    artDirection: media.kind === "media"
      ? {
          version: "site-art-direction-v3",
          recipeId: "precision-service-v1",
          fontPairingId: "precision_grotesk",
          colorSystem: "high_contrast_neutral",
          spacingRhythm: "spacious",
          headerMode: "solid_editorial",
          mediaTreatment: "editorial_crop",
          buttonSystem: "solid_with_quiet_secondary",
          cardTreatment: "minimal_surface",
          density: "balanced"
        }
      : {
          version: "site-art-direction-v3",
          recipeId: "quiet-boutique-v1",
          fontPairingId: "magazine_grotesk",
          colorSystem: "quiet_boutique",
          spacingRhythm: "spacious",
          headerMode: "solid_editorial",
          mediaTreatment: "text_first_fallback",
          buttonSystem: "understated",
          cardTreatment: "borderless",
          density: "open"
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
        }
      ]
    }
  };
  return { version, compositionReport: composition.report };
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
      gallery: Array<{ url: string; label: string }>;
      decisions: MediaAssetDecisionV3[];
    }
  | {
      kind: "text";
      decisions: MediaAssetDecisionV3[];
    };

type AutoBodyV1Composition = {
  sections: SectionInstanceV3[];
  report: GeneratedSiteV3CompositionReport;
};

type LocationCompileContextV3 = {
  locations: RenderableLocationV3[];
  primaryLocation?: RenderableLocationV3;
  hasLocationPanel: boolean;
  hasPhysicalLocation: boolean;
};

function autoBodyV1PageSections(business: BusinessProfile, media: SelectedV3Media, locationContext: LocationCompileContextV3): AutoBodyV1Composition {
  const services = serviceItemsForBusiness(business);
  const gallery = galleryForSelectedMedia(media);
  const evidence = classifyAutoBodyV3Evidence(business, media, gallery, services, locationContext);
  const decisions: GeneratedSiteV3CompositionDecision[] = [
    {
      id: "recipe.auto_body_v1",
      status: "included",
      sectionRole: "recipe",
      evidenceSignal: "recipe",
      reason: "auto_body_v1 is the active deterministic V3 recipe for the first vertical pressure test.",
      selectedOptions: { recipeId: "auto_body_v1" }
    }
  ];
  const sections: SectionInstanceV3[] = [];

  const include = (id: string, family: string, sectionRole: string, evidenceSignal: GeneratedSiteV3CompositionDecision["evidenceSignal"], reason: string, section: VisualSectionV3) => {
    sections.push(visualSection(id, family, section));
    decisions.push(includedDecision(sectionRole, evidenceSignal, reason, section));
  };
  const skip = (sectionRole: string, evidenceSignal: keyof GeneratedSiteV3EvidenceSignals, reason: string) => {
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
    include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "Safe hero media is available, so the recipe uses hero_split.", heroSplitSection(business, gallery));
  } else {
    include("hero", "hero.section_template", "hero", "hasSafeHeroMedia", "No safe hero media is available, so the recipe uses hero_statement.", heroStatementSection(business));
  }

  include("facts", "proof.section_template", "facts_strip", "hasCredentialTrustProof", "Facts strip is required and uses contact/service proof that is safe to render.", factsStripSection(business));

  if (evidence.hasSafeHeroMedia) {
    const heroTemplateId = sections[0]?.variant === "hero_split" ? "hero_split" : "hero_statement";
    include(
      "story",
      "story.section_template",
      "story_split_media",
      "hasSafeHeroMedia",
      "Safe media is available, so the recipe adds one supporting split-media story section.",
      splitMediaSection(business, gallery, splitMediaSideForOccurrence(heroTemplateId, 0))
    );
  } else {
    skip("story_split_media", "hasSafeHeroMedia", "Skipped split_media because no safe media is available.");
  }

  if (evidence.serviceCount >= 4) {
    include("services", "services.section_template", "services", "serviceCount", "Four or more service items fit the side_intro_rows service geometry.", serviceRowsSection(business, services));
  } else {
    include("services", "services.section_template", "services", "serviceCount", "Exactly three service cards, or sparse services normalized to three cards, fit intro_grid.", introGridSection(business, services, "standard"));
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

  include("process", "process.section_template", "process_steps", "serviceCount", "Process is required in auto_body_v1 and uses deterministic row geometry.", processRowsSection(business));

  if (evidence.safeMediaCount >= 4) {
    include("gallery", "media.section_template", "media_gallery", "safeMediaCount", "Four or more safe media items select media_mosaic.", mediaMosaicSection(business, gallery));
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

  include("faq", "faq.section_template", "faq", "serviceCount", "FAQ is required in auto_body_v1.", faqListSection(business));

  if (locationContext.hasLocationPanel) {
    include("location", "local.section_template", "location_panel", "hasLocationPanel", "First-party location facts are available, so the recipe adds a dedicated location panel before contact.", locationPanelSection(business, locationContext));
  } else {
    skip("location_panel", "hasLocationPanel", "Skipped location_panel because no first-party location or service-area facts were available.");
  }

  include("contact", "contact.section_template", "contact", "hasPhone", "Contact is required in auto_body_v1 and normalizes sparse contact data.", contactSplitSection(business, locationContext));

  return {
    sections,
    report: {
      version: "generated-site-v3-composition-report-v1",
      selectedRecipe: "auto_body_v1",
      recipeSelection: {
        selectedRecipe: "auto_body_v1",
        reason: "Auto body is the first deterministic V3 page-recipe pressure test.",
        signals: [
          business.vertical,
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

function heroSplitSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "hero_split",
    options: { background: backgrounds.page },
    slots: {
      copy: {
        eyebrow: eyebrowForBusiness(business),
        heading: headlineForBusiness(business, "media"),
        body: subheadlineForBusiness(business),
        actions: heroActionsForBusiness(business)
      },
      media: mediaSlot(gallery.slice(0, 1)),
      facts: { items: proofFactsForBusiness(business) }
    }
  };
}

function heroStatementSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align: "center", background: backgrounds.subtleGradient },
    slots: {
      copy: {
        eyebrow: eyebrowForBusiness(business),
        heading: headlineForBusiness(business, "text"),
        body: subheadlineForBusiness(business),
        actions: heroActionsForBusiness(business)
      },
      facts: { items: proofFactsForBusiness(business) }
    }
  };
}

function splitMediaSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>, mediaSide: "left" | "right" = "left"): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "split_media",
    anchorId: "proof",
    options: { background: backgrounds.subtleGradient, mediaSide },
    slots: {
      copy: {
        eyebrow: "Approach",
        heading: `A composed first step for ${business.name}.`,
        body: `${business.name} gives visitors a clear read on services, location, and how to start before they reach out.`,
        actions: [{ label: business.phone ? "Talk through timing" : "Send the details", href: business.phone ? `tel:${phoneHref(business.phone)}` : "#contact", style: "text" }]
      },
      media: mediaSlot(gallery.slice(1, 2).length ? gallery.slice(1, 2) : gallery.slice(0, 1))
    }
  };
}

function introGridSection(business: BusinessProfile, services: StandardItemV3[], cardTreatment: "standard" | "comparison"): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "intro_grid",
    anchorId: "services",
    options: { background: backgrounds.subtleGradient, cardTreatment },
    slots: {
      intro: {
        eyebrow: "Services",
        heading: serviceHeadingForBusiness(business),
        body: serviceIntroForBusiness(business)
      },
      items: { items: normalizeStandardItems(services, 3) }
    }
  };
}

function serviceRowsSection(business: BusinessProfile, services: StandardItemV3[]): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "services",
    options: { background: backgrounds.surface },
    slots: {
      intro: {
        eyebrow: "Service fit",
        heading: "Compare the common paths before the first call.",
        body: `${business.name} keeps the main options short and close to the contact path.`
      },
      items: { items: normalizeStandardItems(services, 4) }
    }
  };
}

function processRowsSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "process",
    options: { background: backgrounds.surface },
    slots: {
      intro: {
        eyebrow: "Process",
        heading: "A simple path from first call to shop review.",
        body: business.vertical === "auto_body" ? "Keep the first conversation practical: vehicle, damage area, photos, timing, and preferred contact." : "Keep the first conversation focused on timing, fit, and contact details."
      },
      items: { items: processItemsForBusiness(business) }
    }
  };
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
        body: mediaIntroForBusiness(business)
      },
      media: mediaSlot(gallery.slice(2, 3).length ? gallery.slice(2, 3) : gallery.slice(0, 1))
    }
  };
}

function mediaMosaicSection(business: BusinessProfile, gallery: Array<{ url: string; label: string }>): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "media_mosaic",
    options: { background: backgrounds.surface },
    slots: {
      copy: {
        eyebrow: "Gallery",
        heading: "A few views in one clean frame.",
        body: mediaIntroForBusiness(business)
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

function faqListSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "faq_list",
    anchorId: "faq",
    options: { background: backgrounds.subtleGradient },
    slots: {
      intro: {
        eyebrow: "Questions",
        heading: faqHeadingForBusiness(business),
        body: "A short first message is enough when it includes the practical details."
      },
      items: { items: faqItemsForBusiness(business) }
    }
  };
}

function factsStripSection(business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "facts_strip",
    options: { background: backgrounds.subtleGradient },
    slots: { facts: { items: proofFactsForBusiness(business) } }
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

function locationPanelSection(business: BusinessProfile, locationContext: LocationCompileContextV3): VisualSectionV3 {
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
        heading: locationCount > 1 ? "Choose the right location before you reach out." : hasPhysicalLocation ? "Location, hours, and directions." : "Coverage details before you reach out.",
        body: hasPhysicalLocation
          ? `${business.name} keeps the practical visit details close to the contact path.`
          : `${business.name} serves the listed areas and can confirm fit when you call or send details.`
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

function contactSplitSection(business: BusinessProfile, locationContext?: LocationCompileContextV3): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "contact_split",
    anchorId: "contact",
    options: { background: backgrounds.brandGradient },
    slots: {
      copy: {
        eyebrow: "Contact",
        heading: business.phone ? "Call or send a short message." : "Send a short message.",
        body: "Include what you need, any timing constraints, and the best callback details.",
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

function selectV3Media(business: BusinessProfile): SelectedV3Media {
  const safePhoto = business.photos.find((asset) => isPublicSafeMedia(asset));
  if (safePhoto) {
    const safeGallery = business.photos.filter(isPublicSafeMedia).slice(0, 4).map((asset) => ({ url: asset.url, label: asset.alt || "Business photo" }));
    return {
      kind: "media",
      heroUrl: safePhoto.url,
      gallery: safeGallery.length ? safeGallery : [{ url: safePhoto.url, label: safePhoto.alt || "Business photo" }],
      decisions: [
        {
          id: `media_${business.siteId}_hero`,
          version: "media-asset-decision-v3",
          slotId: "home.hero.media",
          source: mediaSourceForAsset(safePhoto),
          rightsStatus: "approved",
          usageScope: "hero",
          sourceUrl: safePhoto.url,
          policyNotes: ["Selected from public-safe business media."],
          mayImplyRealBusinessWork: safePhoto.rightsStatus === "customer_granted"
        }
      ]
    };
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

function isPublicSafeMedia(asset: AssetReference) {
  return asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe";
}

function mediaSourceForAsset(asset: AssetReference): MediaAssetDecisionV3["source"] {
  if (asset.source === "uploaded") return "first_party";
  if (asset.source === "licensed") return "curated_stock";
  if (asset.source === "generated") return "generated_ai";
  return "first_party";
}

function themeForV3Business(business: BusinessProfile, mediaKind: SelectedV3Media["kind"]): Theme {
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

function serviceItemsForBusiness(business: BusinessProfile): StandardItemV3[] {
  return serviceNamesForBusiness(business).map((service, index) => ({
    title: service,
    body: serviceBodyForBusiness(service, business),
    meta: String(index + 1).padStart(2, "0")
  }));
}

function normalizeStandardItems(items: StandardItemV3[], count: number): StandardItemV3[] {
  const fallback = items.length ? items : [{ title: "Local service", body: "A clear way to ask about availability and fit.", meta: "01" }];
  return Array.from({ length: count }, (_, index) => {
    const item = fallback[index % fallback.length];
    return { ...item, meta: String(index + 1).padStart(2, "0") };
  });
}

function normalizeMediaItems(items: Array<{ url: string; label: string }>, count: number): Array<{ url: string; label: string }> {
  const fallback = items.length ? items : [{ url: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg", label: "Business photo" }];
  return Array.from({ length: count }, (_, index) => fallback[index % fallback.length]);
}

function normalizeFacts(items: VisualFactV3[], min: number, max: number): VisualFactV3[] {
  const fallback: VisualFactV3[] = [
    { label: "Services", value: "Available" },
    { label: "Start", value: "Call or send details" },
    { label: "Fit", value: "Confirmed by the team" },
    { label: "Area", value: "Local" }
  ];
  const merged = [...items];
  for (const fact of fallback) {
    if (merged.length >= min) break;
    if (!merged.some((item) => item.label === fact.label)) merged.push(fact);
  }
  return merged.slice(0, max);
}

function serviceNamesForBusiness(business: BusinessProfile) {
  const services = business.services.length ? business.services : business.serviceHighlights ?? [];
  if (services.length) return services.slice(0, 4);
  if (business.vertical === "auto_body") return ["Collision repair", "Paint refinishing", "Dent repair", "Auto glass"];
  return business.categories.length ? business.categories.slice(0, 4) : ["Local service", "Availability", "Consultation", "Follow-up"];
}

function serviceBodyForBusiness(service: string, business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    if (/collision|body/i.test(service)) return "Visible body damage after an accident, including panels and bumpers.";
    if (/bumper/i.test(service)) return "Bumper cover damage, scuffs, cracks, or impact areas that need shop review.";
    if (/dent|hail|pdr/i.test(service)) return "Dent and hail needs when the visible damage fits that service.";
    if (/glass|windshield|window/i.test(service)) return "Windshield or window damage that needs shop attention.";
    if (/\bpaint\b|refinish/i.test(service)) return "Exterior paint work for scraped, repaired, or refinished surfaces.";
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
  const genericItems = [
    { title: "Share the situation", body: "Start with the service, timing, location, and best contact details." },
    { title: "Confirm the fit", body: "The team can route the request and ask one or two practical follow-up questions." },
    { title: "Plan the visit", body: "Use the call or message to confirm availability and the right next action." }
  ];
  return normalizeStandardItems((business.vertical === "auto_body" ? autoBodyItems : genericItems).map((item, index) => ({ ...item, meta: String(index + 1).padStart(2, "0") })), 4);
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

function proofFactsForBusiness(business: BusinessProfile): VisualFactV3[] {
  return normalizeFacts([
    ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
    ...(business.address ? [{ label: "Location", value: locationLineForBusiness(business) }] : []),
    { label: "Services", value: String(serviceNamesForBusiness(business).length) },
    { label: "Start", value: business.phone ? "Call directly" : "Send details" }
  ], 3, 4);
}

function contactFactsForBusiness(business: BusinessProfile, locationContext?: LocationCompileContextV3): VisualFactV3[] {
  const fullFacts = () => normalizeFacts([
    ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
    ...(business.email ? [{ label: "Email", value: business.email, href: `mailto:${business.email}` }] : []),
    ...(business.address ? [{ label: "Address", value: formatAddress(business.address) }] : []),
    { label: "Hours", value: hoursSummaryForBusiness(business) }
  ], 3, 4);

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

function primaryCtaForBusiness(business: BusinessProfile): VisualCtaV3 {
  return business.phone
    ? { label: "Call now", href: `tel:${phoneHref(business.phone)}`, style: "primary" }
    : { label: "Send details", href: "#contact", style: "primary" };
}

function headlineForBusiness(business: BusinessProfile, mode: SelectedV3Media["kind"]) {
  if (business.vertical === "auto_body") return autoBodyHeroHeadline(business);
  if (mode === "media") return `A direct way to work with ${business.name}.`;
  return `Start with ${business.name}.`;
}

function subheadlineForBusiness(business: BusinessProfile) {
  const services = compactServiceList(serviceItemsForBusiness(business));
  const location = locationLineForBusiness(business);
  if (business.vertical === "auto_body") {
    return `${business.name} handles ${services.toLowerCase()}${location ? ` in ${location}` : ""}. Call with the vehicle, visible damage, photos, and timing.`;
  }
  return `${services} from ${business.name}${location ? ` in ${location}` : ""}.`;
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

function eyebrowForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  const category = business.categories[0] ?? "Local business";
  return [location, category].filter(Boolean).join(" ");
}

function serviceHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Collision, paint, dent, and glass repair.";
  return "Choose the service that fits the visit.";
}

function serviceIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Start with the visible damage, then call with the vehicle details and any photos you already have.";
  if (business.vertical === "restaurant") return "Scan the main options, then call or order with the timing and group size in mind.";
  if (business.vertical === "beauty_salon") return "Pick the service closest to your goal, then share timing, references, and current hair details.";
  if (business.vertical === "home_services") return "Choose the issue that best matches the visit, then include location and timing when you reach out.";
  return "Pick the closest service, then send the details that affect availability, timing, and fit.";
}

function mediaHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Body panels, paint, dents, and glass.";
  return "A closer look at the work.";
}

function mediaIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Use the photos as a quick guide to the kinds of visible vehicle damage to mention when you call.";
  return "Use the photos to decide what to ask about when you reach out.";
}

function faqHeadingForBusiness(business: BusinessProfile) {
  return business.vertical === "auto_body" ? "Before you call, have the basics ready." : "What to include in the first message.";
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
  if (!hours || !Object.keys(hours).length) return "Call to confirm";
  const firstOpenDay = Object.entries(hours).find(([, value]) => value && !/closed/i.test(value));
  if (!firstOpenDay) return "Call to confirm";
  return firstOpenDay[1];
}

function hoursEntriesForHours(hours: BusinessProfile["hours"] | undefined) {
  if (!hours) return [];
  return Object.entries(hours)
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label: titleCaseDay(label), value }));
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
