import type {
  BusinessProfile,
  BusinessUnderstandingV2,
  CleanedServiceV2,
  ConversionGoal,
  Experiment,
  ExperimentLearning,
  ExtensionModel,
  FieldPolicy,
  FieldProvenance,
  GenerationBrief,
  GenerationCostEstimate,
  NormalizedBusinessFacts,
  PageModel,
  PresenceAssessment,
  CreativeMockupArtifact,
  RenderableFact,
  RenderInspectionResult,
  SectionModel,
  SiteAsset,
  SiteBundle,
  SiteModel,
  Theme,
  Vertical,
  VisualQaResult
} from "./models";
import type { CrawlAssessment, ExtractedBusinessFacts } from "./crawler";
import { sampleExtensionModel } from "./sample-data";
import { runAudit } from "./audit";
import { defaultServicesForVertical, verticalRecipes, type VerticalRecipe } from "./recipes";
import { evaluateCrawlAgainstStandard, evaluateSiteAgainstStandard } from "./standard-evaluation";
import { createCreativeBrief } from "./creative-brief";
import {
  createBrandAssessment,
  createDesignDirections,
  createPresenceQualityScore,
  selectedDesignDirection,
  type GenerationPlanningOverride
} from "./generation-planning";
import { createMockupAssets, createPromptOnlyMockupArtifacts } from "./image-generation";
import type { PublicPresenceEnrichment } from "./public-presence";
import { themeForPreset } from "./theme-presets";
import { createDeterministicVisualQa } from "./visual-qa";
import { applyExperimentLearningsToVariants, activeLearningFor } from "./experiment-learning";
import { galleryImageAssetsForBusiness, heroImageAssetForBusiness } from "./image-registry";
import { computeSiteModelHash, makePendingGenerationQa } from "./site-version-metadata";
import { createBusinessFactGraph } from "./business-fact-graph";
import { createGenerationPlanV2 } from "./generation-plan-v2";
import { applyClaimVerificationToPlan, verifyGenerationClaims } from "./claim-verification";
import { withBusinessBundleFields } from "./business-model";
import {
  defaultDesignPlanForVertical,
  designSchemaVersion,
  pageFromLegacySections,
  rendererVersion,
  repairLayoutDocument,
  validateLayoutDocument
} from "./layout-registry";
import { pruneUnsupportedCatalogSections } from "./section-catalog";
import { planGenerationCost } from "./generation-cost";
import {
  hoursRecordFromEntries,
  normalizeBusinessHours,
  normalizeServiceList,
  understandingVerticalConfidenceFloor
} from "./business-understanding-v2";
import { slugify } from "./slug";

export type IntakeInput = {
  url?: string;
  prompt?: string;
  identity?: {
    siteId?: string;
    slug?: string;
    businessProfileId?: string;
  };
  crawl?: CrawlAssessment;
  renderInspection?: RenderInspectionResult;
  aiPlanning?: GenerationPlanningOverride;
  understanding?: BusinessUnderstandingV2;
  mockupArtifacts?: CreativeMockupArtifact[];
  publicPresence?: PublicPresenceEnrichment;
  visualQa?: VisualQaResult;
  generationCostEstimate?: GenerationCostEstimate;
  experimentLearnings?: ExperimentLearning[];
};

export function inferVertical(input: IntakeInput): Vertical {
  const source = [
    input.url,
    input.prompt,
    input.crawl?.title,
    input.crawl?.metaDescription,
    input.crawl?.extractedFacts.name,
    ...(input.crawl?.extractedFacts.categories ?? []),
    ...(input.crawl?.extractedFacts.services ?? []),
    ...(input.publicPresence?.facts.categories ?? []),
    ...(input.publicPresence?.facts.services ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (source.includes("pizza") || source.includes("restaurant") || source.includes("cafe")) return "restaurant";
  if (source.includes("med spa") || source.includes("aesthetic") || source.includes("botox") || source.includes("laser facial")) return "med_spa";
  if (source.includes("landscap") || source.includes("lawn care")) return "landscaping";
  if (source.includes("veterinary") || source.includes("veterinarian") || source.includes("vet clinic")) return "veterinary";
  if (source.includes("dentist") || source.includes("dental")) return "dental";
  if (source.includes("plumb") || source.includes("hvac") || source.includes("electric")) return "home_services";
  if (/tire|wheel alignment|oil change|muffler|mechanic|transmission|brake (repair|service|shop)|smog check/.test(source)) return "auto_services";
  if (/\b(auto|automotive|collision|body shop|paint\s*(and|&)?\s*body|paint repair|dent repair|bumper|fender)\b/.test(source)) return "auto_body";
  if (source.includes("salon") || source.includes("nail") || source.includes("beauty")) return "beauty_salon";
  if (/\blaw\b|\blawyer\b|\battorney\b/.test(source)) return "law_firm";
  if (source.includes("fitness") || source.includes("gym") || source.includes("personal training")) return "fitness";
  if (source.includes("real estate") || source.includes("realtor") || source.includes("realty")) return "real_estate";
  if (source.includes("photography") || source.includes("photographer") || source.includes("photo studio") || source.includes("creative studio")) return "creative_studio";
  return "general_local";
}

export function createSiteFromInput(input: IntakeInput): SiteBundle {
  const understanding = input.understanding;
  const vertical =
    understanding && understanding.verticalConfidence >= understandingVerticalConfidenceFloor
      ? understanding.vertical
      : inferVertical(input);
  const facts = mergeExtractedFacts(input.crawl?.extractedFacts, durablePublicPresenceFacts(input.publicPresence));
  const sourceHostname = input.url ? new URL(input.url).hostname.replace(/^www\./, "") : undefined;
  const name = inferBusinessName(input, facts, sourceHostname);
  const baseSlug = slugify(name);
  const siteSlug = slugify(input.identity?.slug ?? baseSlug) || baseSlug || `site-${Date.now()}`;
  const siteId = input.identity?.siteId?.trim() || `site_${siteSlug}`;
  const identityKey = slugify(siteId) || siteSlug;
  const now = new Date().toISOString();
  const promptFacts = extractPromptFacts(input.prompt);
  const cleanedServices = understanding?.cleanedServices.length
    ? understanding.cleanedServices
    : normalizeServiceList(coalesceList(facts?.services, promptFacts.services));
  const serviceCandidates = removeBusinessNameServiceCandidates(
    dedupeServiceNames(
      removeBlockedPlaceholders(
        cleanedServices.length ? cleanedServices.map((service) => service.name) : defaultServicesForVertical(vertical)
      )
    ),
    name
  );
  const services = serviceCandidates.length ? serviceCandidates : defaultServicesForVertical(vertical);
  const servicePricingHighlights = cleanedServices
    .filter((service) => service.price && services.includes(service.name))
    .map((service) => `${service.name}: ${service.price}`);
  const serviceAreas = coalesceList(
    facts?.serviceAreas,
    promptFacts.serviceAreas,
    facts?.address?.city ? [facts.address.city] : []
  );
  const phone = facts?.phone ?? promptFacts.phone;
  const email = facts?.email ?? promptFacts.email;
  const address = facts?.address ?? promptFacts.address;
  const hoursEntries = understanding?.hours?.length
    ? understanding.hours
    : normalizeBusinessHours(facts?.hours ?? promptFacts.hours);
  const hours = hoursRecordFromEntries(hoursEntries);

  const businessProfile: BusinessProfile = {
    id: input.identity?.businessProfileId?.trim() || `bp_${identityKey}`,
    siteId,
    name,
    vertical,
    categories: coalesceList(rankCategoriesBySpecificity(facts?.categories, vertical), [verticalRecipes[vertical].label]),
    description: profileDescriptionForBusiness({ name, vertical, services, serviceAreas, sourceHostname }),
    phone,
    email,
    address,
    geo: facts?.geo,
    hours,
    services,
    serviceHighlights: unique([...(facts?.serviceHighlights ?? []), ...servicePricingHighlights]).slice(0, 8),
    serviceAreas,
    socialLinks: facts?.socialLinks ?? [],
    bookingLinks: facts?.bookingLinks ?? [],
    orderingLinks: facts?.orderingLinks ?? [],
    photos: (input.crawl?.assetReferences ?? [])
      .filter((asset) => asset.kind === "image")
      .slice(0, 8)
      .map((asset, index) => ({
        id: `asset_reference_${index + 1}`,
        url: asset.url,
        alt: asset.alt ?? "Website reference image",
        source: "website_reference" as const,
        rightsStatus: "reference_only" as const
      })),
    logo: input.crawl?.assetReferences.find((asset) => asset.kind === "logo")
      ? {
          id: "asset_reference_logo",
          url: input.crawl.assetReferences.find((asset) => asset.kind === "logo")?.url ?? "",
          alt: `${name} logo reference`,
          source: "website_reference" as const,
          rightsStatus: "reference_only" as const
        }
      : undefined,
    reviewsSummary: facts?.reviewsSummary,
    pressLinks: facts?.pressLinks ?? [],
    provenance: {
      ...buildProvenance(input, facts, promptFacts, now),
      ...durablePublicPresenceProvenance(input.publicPresence)
    }
  };

  const recipe = verticalRecipes[vertical];
  const normalizedBusinessFacts = createNormalizedBusinessFacts({
    name,
    vertical,
    services,
    serviceAreas,
    facts,
    promptFacts,
    sourceHostname,
    cleanedServices
  });
  const currentEvaluation = input.crawl ? evaluateCrawlAgainstStandard(input.crawl) : undefined;
  const brandAssessment = createBrandAssessment({
    business: businessProfile,
    recipe,
    crawl: input.crawl,
    renderInspection: input.renderInspection,
    currentEvaluation,
    aiPlanning: input.aiPlanning
  });
  const designDirections = createDesignDirections({
    business: businessProfile,
    recipe,
    crawl: input.crawl,
    renderInspection: input.renderInspection,
    currentEvaluation,
    aiPlanning: input.aiPlanning
  });
  const selectedDirection = selectedDesignDirection(designDirections);
  const selectedTheme = themeForPreset(vertical, selectedDirection.themePreset, themeForVertical(vertical, recipe.mood));
  const selectedDesignPlan = defaultDesignPlanForVertical(vertical, selectedTheme);
  const primaryCta =
    recipe.primaryGoal === "calls" && businessProfile.phone
      ? { label: "Call Now", href: `tel:${businessProfile.phone}`, role: "tel" }
      : recipe.primaryGoal === "booking_clicks" && businessProfile.bookingLinks[0]
        ? { label: "Book Now", href: businessProfile.bookingLinks[0], role: "booking" }
        : recipe.primaryGoal === "order_clicks" && businessProfile.orderingLinks[0]
          ? { label: "Order Online", href: businessProfile.orderingLinks[0], role: "ordering" }
          : {
              label:
                recipe.primaryGoal === "booking_clicks"
                  ? "Request Appointment"
                  : recipe.primaryGoal === "order_clicks"
                    ? "Start Order"
                    : fallbackFormCtaLabel(vertical),
              href: "#contact",
              role: "form"
            };

  const siteModel: SiteModel = {
    id: siteId,
    slug: siteSlug,
    pinList: [],
    theme: selectedTheme,
    versions: [
      {
        id: `version_${identityKey}_draft_1`,
        status: "draft" as const,
        rendererVersion,
        designSchemaVersion,
        designPlan: selectedDesignPlan,
        createdAt: now,
        ownerTouched: false,
        presentation: {
          mobileActionBehavior: "after_hero",
          reservedMobileActionSpace: true
        },
        pages: [
          pageFromLegacySections({
            id: "page_home",
            slug: "",
            title: "Home",
            seo: {
              title: `${name} | ${recipe.label}`,
              description: `${name} is a ${recipe.label.toLowerCase()} built for fast local action, clear trust signals, and simple customer contact.`,
              canonicalPath: "/"
            },
            vertical,
            sections: buildHomeSections({
              business: businessProfile,
              recipe,
              primaryCta,
              name,
              sectionOrder: selectedDirection.sectionEmphasis
            })
          }),
          pageFromLegacySections({
            id: "page_services",
            slug: "services",
            title: "Services",
            seo: {
              title: `Services | ${name}`,
              description: `Explore the primary services offered by ${name}, with clear calls to action for local customers.`,
              canonicalPath: "/services"
            },
            vertical,
            sections: buildServicesPageSections({ business: businessProfile, recipe, primaryCta, name })
          }),
          ...buildLocalSeoPages({ business: businessProfile, recipe, primaryCta, name })
        ]
      }
    ]
  };
  const initialGeneratedVersion = siteModel.versions[0];
  if (initialGeneratedVersion) {
    repairLayoutDocument(initialGeneratedVersion);
    const blockingLayoutIssues = validateLayoutDocument(initialGeneratedVersion).filter((issue) => issue.repairMode === "fatal_schema" || issue.repairMode === "operator_blocked");
    if (blockingLayoutIssues.length) {
      throw new Error(`Generated layout-v1 document failed validation: ${blockingLayoutIssues.map((issue) => issue.message).join("; ")}`);
    }
  }

  const presenceAssessment: PresenceAssessment = {
    siteId,
    sourceUrl: input.url,
    normalizedBusinessFacts,
    standardEvaluation: currentEvaluation,
    renderInspection: input.renderInspection,
    publicPresenceSignals: input.publicPresence?.signals.map((signal) => ({ ...signal, siteId })),
    generationCostEstimate:
      input.generationCostEstimate ??
      planGenerationCost({
        sourceUrl: input.url,
        crawl: input.crawl,
        sourceRenderInspection: input.renderInspection,
        publicPresence: input.publicPresence,
        plannedMockupImageCount: Math.max(1, Math.min(designDirections.length, 3)),
        sourceModelVisualQaRequested: Boolean(input.renderInspection?.screenshots.length),
        generatedModelVisualQaRequested: true,
        includeGeneratedRenderQa: true
      }),
    brandAssessment,
    designDirections,
    selectedDesignDirectionId: selectedDirection.id,
    generationPlanningSource: input.aiPlanning?.source ?? "deterministic_fallback",
    businessUnderstanding: input.understanding,
    technicalNotes: buildTechnicalNotes(input.crawl),
    visualNotes: buildVisualNotes(input.renderInspection),
    brandNotes: buildBrandNotes(input.crawl),
    publicPresenceNotes: buildPublicPresenceNotes(input.crawl, input.publicPresence),
    generationBrief: createGenerationBrief({ siteId, business: businessProfile, recipe, normalizedBusinessFacts })
  };
  presenceAssessment.creativeBrief = createCreativeBrief({
    business: businessProfile,
    recipe,
    crawl: input.crawl,
    generationBrief: presenceAssessment.generationBrief
  });

  const bundle: SiteBundle = withBusinessBundleFields({
    businessProfile,
    siteModel,
    extensionModel: {
      ...sampleExtensionModel,
      forms: sampleExtensionModel.forms.map((form) => ({
        ...form,
        siteId,
        name: formNameForVertical(vertical),
        fields: formFieldsForVertical(vertical, form.fields),
        submitLabel: submitLabelForVertical(vertical, recipe.primaryGoal)
      }))
    },
    optimizationFindings: runAudit(businessProfile, siteModel),
    experiments: defaultExperimentsForBusiness(businessProfile, recipe, input.experimentLearnings),
    presenceAssessment
  });
  const initialVersion = bundle.siteModel.versions[0];
  if (initialVersion) {
    presenceAssessment.businessFactGraph = createBusinessFactGraph({
      business: businessProfile,
      presence: presenceAssessment,
      observedAt: now
    });
    const catalogPruning = pruneUnsupportedCatalogSections({
      bundle,
      version: initialVersion,
      factGraph: presenceAssessment.businessFactGraph,
      primaryGoal: recipe.primaryGoal
    });
    if (catalogPruning.removedSections.length) {
      presenceAssessment.technicalNotes.push(
        `Section catalog omitted ${catalogPruning.removedSections.length} unsupported optional section${catalogPruning.removedSections.length === 1 ? "" : "s"} without safe source facts.`
      );
    }
    const v2Plan = createGenerationPlanV2({
      bundle,
      version: initialVersion,
      factGraph: presenceAssessment.businessFactGraph,
      createdAt: now
    });
    presenceAssessment.generationPlanV2 = applyClaimVerificationToPlan(
      v2Plan,
      verifyGenerationClaims({ version: initialVersion, factGraph: presenceAssessment.businessFactGraph })
    );
    const activeInitialVersion = bundle.siteModel.versions[0] ?? initialVersion;
    presenceAssessment.generationPlanV2 = applyClaimVerificationToPlan(
      createGenerationPlanV2({
        bundle,
        version: activeInitialVersion,
        factGraph: presenceAssessment.businessFactGraph,
        createdAt: now
      }),
      verifyGenerationClaims({ version: activeInitialVersion, factGraph: presenceAssessment.businessFactGraph })
    );
    activeInitialVersion.generationQa = makePendingGenerationQa(computeSiteModelHash(bundle, activeInitialVersion));
  }
  presenceAssessment.qualityScore = createPresenceQualityScore({
    business: businessProfile,
    recipe,
    crawl: input.crawl,
    renderInspection: input.renderInspection,
    currentEvaluation,
    generatedEvaluation: evaluateSiteAgainstStandard(bundle),
    aiPlanning: input.aiPlanning
  });
  presenceAssessment.mockupArtifacts =
    input.mockupArtifacts ?? createPromptOnlyMockupArtifacts({ bundle, directions: designDirections });
  presenceAssessment.assetInventory = buildAssetInventory({
    business: businessProfile,
    input,
    mockups: presenceAssessment.mockupArtifacts,
    now
  });
  presenceAssessment.visualQa =
    input.visualQa ?? createDeterministicVisualQa({ bundle, renderInspection: input.renderInspection });

  return bundle;
}

type Cta = { label: string; href: string; role: string };

type SectionBuildContext = {
  business: BusinessProfile;
  recipe: VerticalRecipe;
  primaryCta: Cta;
  name: string;
  sectionOrder?: SectionModel["type"][];
};

function buildHomeSections(context: SectionBuildContext): SectionModel[] {
  const sectionOrder = context.sectionOrder?.length ? context.sectionOrder : context.recipe.defaultSections;
  return sectionOrder.map((type, index) => sectionForType(type, context, "home", index));
}

function buildServicesPageSections(context: SectionBuildContext): SectionModel[] {
  return [
    {
      id: "services_page_hero",
      type: "hero",
      variant: "compact",
      props: {
        eyebrow: "Services",
        heading: `What ${context.name} can help with`,
        body: "Review the core services, then call or send details when the fit is clear.",
        primaryCta: context.primaryCta
      },
      bindings: {},
      fieldPolicies: {
        heading: policy("owner_freetext"),
        body: policy("owner_freetext"),
        primaryCta: policy("owner_choice", true)
      }
    },
    makeServicesSection(context, "services_page_grid", "Primary services", "Service details stay focused on what customers can request today."),
    makeFaqSection(context, "services_page_faq"),
    makeCtaSection(context, "services_page_cta")
  ];
}

function buildLocalSeoPages(context: SectionBuildContext): PageModel[] {
  const servicePages = unique(context.business.services)
    .slice(0, 6)
    .map((service) => buildServiceLandingPage(context, service));
  const areaPages = unique(
    [
      ...context.business.serviceAreas,
      context.business.address?.city ? `${context.business.address.city}${context.business.address.region ? `, ${context.business.address.region}` : ""}` : ""
    ].filter((area): area is string => Boolean(area))
  )
    .filter((area) => !/^local area$/i.test(area))
    .slice(0, 5)
    .map((area) => buildAreaLandingPage(context, area));

  return [...dedupePages(servicePages), ...dedupePages(areaPages)];
}

function defaultExperimentsForBusiness(
  business: BusinessProfile,
  recipe: VerticalRecipe,
  learnings: ExperimentLearning[] = []
): Experiment[] {
  const primaryMetric = experimentMetricForGoal(recipe.primaryGoal);
  const actionLabel = actionLabelForMetric(primaryMetric);
  return [
    makeExperimentCandidate({
      business,
      learnings,
      surface: "sticky_cta",
      primaryMetric,
      hypothesis: `A persistent mobile ${actionLabel} action increases ${actionLabel} conversions.`,
      variants: [
        { id: "control", label: "Inline CTAs only" },
        { id: "sticky_action", label: "Sticky mobile action" }
      ]
    }),
    makeExperimentCandidate({
      business,
      learnings,
      surface: "cta_placement",
      primaryMetric,
      hypothesis: "More prominent conversion actions above and after proof sections increase primary actions.",
      variants: [
        { id: "control", label: "Standard CTA prominence" },
        { id: "hero_cta_prominent", label: "Hero CTA emphasis" },
        { id: "cta_section_prominent", label: "Mid-page CTA emphasis" }
      ]
    }),
    makeExperimentCandidate({
      business,
      learnings,
      surface: "form_length",
      primaryMetric: "form_submits",
      hypothesis: "Shorter or contact-first forms reduce lead friction and increase form submissions.",
      variants: [
        { id: "control", label: "Standard form" },
        { id: "required_only", label: "Required fields only" },
        { id: "phone_first", label: "Phone-first field order" }
      ]
    }),
    makeExperimentCandidate({
      business,
      learnings,
      surface: "hero_layout",
      primaryMetric,
      hypothesis: "A more compact or proof-forward hero layout increases primary actions without changing claims.",
      variants: [
        { id: "control", label: "Standard hero layout" },
        { id: "compact_hero", label: "Compact above-fold hero" },
        { id: "media_first", label: "Visual proof first" }
      ]
    })
  ];
}

function makeExperimentCandidate(input: {
  business: BusinessProfile;
  learnings: ExperimentLearning[];
  surface: Experiment["surface"];
  primaryMetric: Experiment["primaryMetric"];
  hypothesis: string;
  variants: Array<Record<string, unknown>>;
}): Experiment {
  const variants = applyExperimentLearningsToVariants({
    cohort: input.business.vertical,
    surface: input.surface,
    primaryMetric: input.primaryMetric,
    learnings: input.learnings,
    variants: input.variants
  });
  const learning = activeLearningFor(input.learnings, {
    cohort: input.business.vertical,
    surface: input.surface,
    primaryMetric: input.primaryMetric
  });

  return {
    id: `exp_${input.surface}_${input.business.siteId}`,
    cohort: input.business.vertical,
    hypothesis: learning
      ? `${learning.winnerLabel} is the learned default for ${input.surface.replaceAll("_", " ")} with holdout validation available.`
      : input.hypothesis,
    surface: input.surface,
    variants,
    holdoutPercent: 0.1,
    primaryMetric: input.primaryMetric,
    status: "draft"
  };
}

function actionLabelForMetric(metric: Experiment["primaryMetric"]) {
  switch (metric) {
    case "tel_clicks":
      return "call";
    case "order_clicks":
      return "order";
    case "booking_clicks":
      return "booking";
    case "form_submits":
      return "form";
  }
}

function experimentMetricForGoal(goal: ConversionGoal): Experiment["primaryMetric"] {
  switch (goal) {
    case "calls":
    case "directions":
    case "store_visits":
      return "tel_clicks";
    case "booking_clicks":
      return "booking_clicks";
    case "order_clicks":
      return "order_clicks";
    case "forms":
    default:
      return "form_submits";
  }
}

function buildServiceLandingPage(context: SectionBuildContext, service: string): PageModel {
  const serviceSlug = slugify(service) || "service";
  const area = context.business.serviceAreas[0] ?? context.business.address?.city ?? "your area";
  return pageFromLegacySections({
    id: `page_service_${serviceSlug}`,
    slug: `services/${serviceSlug}`,
    title: service,
    seo: {
      title: `${service} | ${context.name}`,
      description: `${context.name} helps local customers with ${service.toLowerCase()} in ${area}. Get clear next steps, trust signals, and a direct way to contact the business.`,
      canonicalPath: `/services/${serviceSlug}`
    },
    vertical: context.business.vertical,
    sections: [
      makeLandingHeroSection(
        context,
        `service_${serviceSlug}_hero`,
        "Service",
        `${service} in ${area}`,
        `${serviceDescription(context.business.vertical, service)} Contact ${context.name} to confirm fit, timing, and next steps.`
      ),
      makeSingleServiceSection(context, `service_${serviceSlug}_detail`, service, area),
      makeTestimonialsSection(context, `service_${serviceSlug}_trust`),
      makeFaqSection(
        {
          ...context,
          business: { ...context.business, services: [service], serviceAreas: context.business.serviceAreas }
        },
        `service_${serviceSlug}_faq`
      ),
      makeContactSection(context, `service_${serviceSlug}_contact`)
    ]
  });
}

function buildAreaLandingPage(context: SectionBuildContext, area: string): PageModel {
  const areaSlug = slugify(area) || "service-area";
  return pageFromLegacySections({
    id: `page_area_${areaSlug}`,
    slug: `areas/${areaSlug}`,
    title: area,
    seo: {
      title: `${context.name} in ${area}`,
      description: `${context.name} serves customers in ${area} with ${context.business.services.slice(0, 3).join(", ") || context.recipe.label.toLowerCase()}. Service details and contact options are easy to find.`,
      canonicalPath: `/areas/${areaSlug}`
    },
    vertical: context.business.vertical,
    sections: [
      makeLandingHeroSection(
        context,
        `area_${areaSlug}_hero`,
        "Service area",
        `${context.name} in ${area}`,
        `Confirm current availability in ${area}, then choose the service that matches the need.`
      ),
      makeAreaServicesSection(context, `area_${areaSlug}_services`, area),
      makeMapSection(
        {
          ...context,
          business: { ...context.business, serviceAreas: [area, ...context.business.serviceAreas.filter((item) => item !== area)] }
        },
        `area_${areaSlug}_map`
      ),
      makeFaqSection(
        {
          ...context,
          business: { ...context.business, serviceAreas: [area] }
        },
        `area_${areaSlug}_faq`
      ),
      makeContactSection(context, `area_${areaSlug}_contact`)
    ]
  });
}

function makeLandingHeroSection(
  context: SectionBuildContext,
  id: string,
  eyebrow: string,
  heading: string,
  body: string
): SectionModel {
  return {
    id,
    type: "hero",
    variant: "compact",
    props: {
      eyebrow,
      heading,
      body,
      primaryCta: context.primaryCta,
      secondaryCta: context.business.phone && context.primaryCta.role !== "tel"
        ? { label: "Call Now", href: `tel:${context.business.phone}`, role: "tel" }
        : { label: "Ask a Question", href: "#contact", role: "form" }
    },
    bindings: {
      phone: "business.phone"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      primaryCta: policy("owner_choice", true),
      secondaryCta: policy("owner_choice", true),
      layout: policy("system_only", true)
    }
  };
}

function makeSingleServiceSection(context: SectionBuildContext, id: string, service: string, area: string): SectionModel {
  const audience = audiencePlural(context.business.vertical);
  return {
    id,
    type: "services",
    variant: "service_detail",
    props: {
      eyebrow: "Local service detail",
      heading: `${service} without extra friction`,
      body: `For ${area} ${audience}, ${service.toLowerCase()} requests should start with fit, timing, and next-step details.`,
      items: [
        {
          title: "What to ask about",
          description: serviceDescription(context.business.vertical, service)
        },
        {
          title: "Service fit",
          description: `Confirm whether ${service.toLowerCase()} matches the current need before scheduling or sending details.`
        },
        {
          title: "Best next action",
          description: nextActionDescription(context.recipe.primaryGoal)
        }
      ]
    },
    bindings: {
      services: "business.services",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}

function makeAreaServicesSection(context: SectionBuildContext, id: string, area: string): SectionModel {
  const audience = audiencePlural(context.business.vertical);
  return {
    id,
    type: "services",
    variant: "area_service_grid",
    props: {
      eyebrow: "Available nearby",
      heading: `Services for ${area} ${audience}`,
      body: "Choose the service that matches the need, then call or send details.",
      items: context.business.services.slice(0, 6).map((service) => ({
        title: service,
        description: `${serviceDescription(context.business.vertical, service)} Available for ${area} ${audience}.`
      }))
    },
    bindings: {
      services: "business.services",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      heading: policy("owner_freetext", false, true),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}

function dedupePages(pages: PageModel[]) {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.slug)) return false;
    seen.add(page.slug);
    return true;
  });
}

function sectionForType(type: SectionModel["type"], context: SectionBuildContext, prefix: string, index: number): SectionModel {
  const id = `${type}_${prefix}_${index + 1}`;
  switch (type) {
    case "hero":
      return makeHeroSection(context, "hero_home");
    case "trust_bar":
      return makeTrustBarSection(context, id);
    case "services":
      return makeServicesSection(context, id, servicesHeading(context), servicesBody(context));
    case "menu_deals":
      return makeServicesSection(context, id, "Menu favorites, ready to order", "Keep popular items, catering, and takeout paths close to the next click.", "menu_deals");
    case "gallery":
      return makeGallerySection(context, id);
    case "testimonials":
      return makeTestimonialsSection(context, id);
    case "faq":
      return makeFaqSection(context, id);
    case "cta":
      return makeCtaSection(context, id);
    case "contact":
      return makeContactSection(context, "contact_home");
    case "map":
      return makeMapSection(context, id);
    case "team":
      return makeTeamSection(context, id);
    case "press_video":
      return makePressVideoSection(context, id);
    case "before_after":
      return makeBeforeAfterSection(context, id);
  }
}

function makeHeroSection(context: SectionBuildContext, id: string): SectionModel {
  const secondaryCta = context.business.phone && context.primaryCta.role !== "tel"
    ? { label: "Call Now", href: `tel:${context.business.phone}`, role: "tel" }
    : { label: "Ask a Question", href: "#contact", role: "form" };
  return {
    id,
    type: "hero",
    variant: heroVariantForVertical(context.business.vertical),
    props: {
      eyebrow: heroEyebrow(context),
      heading: heroHeading(context),
      body: heroBody(context),
      primaryCta: context.primaryCta,
      secondaryCta,
      imageUrl: heroImageAssetForBusiness(context.business).url
    },
    bindings: {
      heading: "business.name",
      phone: "business.phone"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      primaryCta: policy("owner_choice", true),
      secondaryCta: policy("owner_choice", true),
      imageUrl: policy("owner_choice", false),
      layout: policy("system_only", true)
    }
  };
}

function makeTrustBarSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "trust_bar",
    variant: "local_signals",
    props: {
      items: trustItems(context)
    },
    bindings: {
      rating: "business.reviewsSummary.rating",
      hours: "business.hours",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      items: policy("system_only", false, true)
    }
  };
}

function makeServicesSection(
  context: SectionBuildContext,
  id: string,
  heading: string,
  body: string,
  type: "services" | "menu_deals" = "services"
): SectionModel {
  return {
    id,
    type,
    variant: type === "menu_deals" ? "menu_cards" : "feature_grid",
    props: {
      eyebrow: type === "menu_deals" ? "Menu and offers" : "Services",
      heading,
      body,
      items: context.business.services.slice(0, 6).map((service) => ({
        title: service,
        description: serviceDescription(context.business.vertical, service)
      }))
    },
    bindings: {
      services: "business.services"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice")
    }
  };
}

function makeGallerySection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "gallery",
    variant: galleryVariantForVertical(context.business.vertical),
    props: {
      eyebrow: "Visual proof",
      heading: galleryHeading(context.business.vertical),
      body: galleryBody(context.business.vertical),
      images: galleryImagesForBusiness(context.business)
    },
    bindings: {},
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      images: policy("owner_choice")
    }
  };
}

function makeTestimonialsSection(context: SectionBuildContext, id: string): SectionModel {
  const hasReviewSummary = Boolean(context.business.reviewsSummary?.rating || context.business.reviewsSummary?.count);
  return {
    id,
    type: "testimonials",
    variant: "review_summary",
    props: {
      eyebrow: "Trust",
      heading: hasReviewSummary ? "Public review profile" : "Proof customers can verify",
      body: hasReviewSummary
        ? `Public review signals help ${audiencePlural(context.business.vertical)} evaluate fit before taking the next step.`
        : "Clear services, contact details, and public proof points make the decision easier.",
      items: testimonialItems(context.business)
    },
    bindings: {
      rating: "business.reviewsSummary.rating",
      count: "business.reviewsSummary.count"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}

function makeFaqSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "faq",
    variant: "conversion_faq",
    props: {
      eyebrow: "Questions",
      heading: "Answers before customers call",
      items: faqItems(context)
    },
    bindings: {
      services: "business.services",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      items: policy("owner_freetext")
    }
  };
}

function makeCtaSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "cta",
    variant: "conversion_band",
    props: {
      eyebrow: "Next step",
      heading: ctaHeading(context),
      body: ctaBody(context),
      primaryCta: context.primaryCta,
      secondaryCta: context.primaryCta.role === "tel"
        ? { label: "Request Service", href: "#contact", role: "form" }
        : context.business.phone
          ? { label: "Call Instead", href: `tel:${context.business.phone}`, role: "tel" }
          : undefined
    },
    bindings: {
      phone: "business.phone"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      primaryCta: policy("owner_choice", true),
      secondaryCta: policy("owner_choice", true),
      layout: policy("system_only", true)
    }
  };
}

function makeContactSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "contact",
    variant: "split",
    props: {
      heading: `Contact ${context.name}`,
      body: contactBody(context),
      formId: "form_contact",
      primaryCta: context.primaryCta
    },
    bindings: {
      phone: "business.phone",
      address: "business.address",
      hours: "business.hours"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      formId: policy("owner_choice"),
      primaryCta: policy("owner_choice", true)
    }
  };
}

function makeMapSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "map",
    variant: "service_area",
    props: {
      eyebrow: "Where we help",
      heading: context.business.address?.city ? `${context.business.name} in ${context.business.address.city}` : "Local service area",
      body: "Use the contact details, hours, and service-area information before making the next call.",
      areas: context.business.serviceAreas.slice(0, 8)
    },
    bindings: {
      address: "business.address",
      serviceAreas: "business.serviceAreas",
      hours: "business.hours"
    },
    fieldPolicies: {
      heading: policy("owner_freetext", false, true),
      body: policy("owner_freetext"),
      areas: policy("owner_choice", false, true)
    }
  };
}

function makeTeamSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "team",
    variant: "credential_cards",
    props: {
      eyebrow: "People",
      heading: teamHeading(context.business.vertical),
      body: "Team content should introduce the people customers will meet without inventing private details.",
      items: teamItems(context.business.vertical)
    },
    bindings: {},
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_freetext", false, true)
    }
  };
}

function makePressVideoSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "press_video",
    variant: "link_list",
    props: {
      eyebrow: "Around the web",
      heading: "Bring outside proof onto the site",
      body: "Real press, video, and social links give customers another way to check the business.",
      links: [...context.business.pressLinks, ...context.business.socialLinks].slice(0, 4).map((href, index) => ({
        label: index === 0 ? "Primary profile" : `Proof link ${index + 1}`,
        href
      }))
    },
    bindings: {
      socialLinks: "business.socialLinks",
      pressLinks: "business.pressLinks"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      links: policy("owner_choice", false, true)
    }
  };
}

function makeBeforeAfterSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "before_after",
    variant: "proof_cards",
    props: {
      eyebrow: "Before and after",
      heading: beforeAfterHeading(context.business.vertical),
      body: "Project examples show the kind of work customers can ask about.",
      items: context.business.services.slice(0, 3).map((service) => ({
        title: service,
        beforeLabel: "Problem",
        afterLabel: "Resolved",
        description: `Use ${service.toLowerCase()} examples to connect the service to a concrete customer need.`
      }))
    },
    bindings: {
      services: "business.services"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}


function inferBusinessName(input: IntakeInput, facts?: ExtractedBusinessFacts, hostname?: string) {
  return normalizeBusinessNameForIntake(extractPromptName(input.prompt) ?? facts?.name) ?? titleCaseHost(hostname) ?? "Sample Local Business";
}

function extractPromptName(prompt?: string) {
  if (!prompt) return undefined;
  const match =
    prompt.match(/\b(?:called|named)\s+([A-Z][A-Za-z0-9'&.\- ]{2,80})(?:[.,]| that | which | with | services?:| phone:?|$)/) ??
    prompt.match(/\bfor\s+(?:a|an|the)?\s*([A-Z][A-Za-z0-9'&.\- ]{2,80})(?:[.,]| that | which | with | services?:| phone:?|$)/);
  return cleanPromptName(match?.[1]);
}

function cleanPromptName(value?: string) {
  return value
    ?.replace(/\s+(?:in|near|around|serving|based in)\s+[A-Z][A-Za-z .'-]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseHost(hostname?: string) {
  if (!hostname) return undefined;
  return hostname
    .split(".")[0]
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractPromptFacts(prompt?: string) {
  const phone = prompt?.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0];
  const email = prompt?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const location = prompt?.match(/\b(?:in|near|around|serving|based in)\s+([A-Z][A-Za-z .'-]{2,60})(?:[.,]| with | services?:| phone:?|$)/)?.[1];
  const serviceMatch = prompt?.match(/services?:\s*([^.]*)/i);
  const serviceText = serviceMatch?.[1]?.split(/\b(?:phone|email)\s*:/i)[0];
  const services = serviceText
    ?.split(/,| and /)
    .map((service) => normalizeServiceName(service.trim()))
    .filter(Boolean);
  const serviceAreaMatch = prompt?.match(/service areas?:\s*([^.]*)/i);
  const serviceAreas = serviceAreaMatch?.[1]
    ?.split(/,| and /)
    .map((area) => area.trim())
    .filter(Boolean);
  const address = parsePromptAddress(prompt);
  const hours = parsePromptHours(prompt);
  return {
    phone: phone ? normalizePromptPhone(phone) : undefined,
    email: email?.toLowerCase(),
    address,
    hours,
    services,
    serviceAreas: serviceAreas?.length ? serviceAreas : location ? [location.trim()] : undefined
  };
}

function parsePromptAddress(prompt?: string) {
  const value = prompt?.match(/\baddress:\s*([^.;\n]+)/i)?.[1]?.trim();
  if (!value) return undefined;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const [street, city, regionPostal] = parts;
  const regionPostalMatch = regionPostal?.match(/^([A-Z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)$/i);
  return {
    street,
    city,
    region: regionPostalMatch?.[1]?.toUpperCase() ?? regionPostal,
    postalCode: regionPostalMatch?.[2],
    country: "US"
  };
}

function parsePromptHours(prompt?: string) {
  const value = prompt?.match(/\bhours:\s*([^.\n]+)/i)?.[1]?.trim();
  if (!value) return undefined;
  const entries = value.split(/;|,/).map((entry) => entry.trim()).filter(Boolean);
  const hours = Object.fromEntries(
    entries.flatMap((entry) => {
      const match = entry.match(/^([A-Za-z][A-Za-z -]{1,24}):?\s+(.+)$/);
      return match ? [[match[1].trim(), match[2].trim()]] : [];
    })
  );
  return Object.keys(hours).length ? hours : undefined;
}

function normalizeServiceName(value: string) {
  if (!value) return value;
  if (/[a-z]/.test(value)) return titleCase(value);
  return value;
}

function normalizePromptPhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

function coalesceList(...lists: Array<string[] | undefined>) {
  for (const list of lists) {
    const cleaned = unique((list ?? []).map((item) => item.trim()).filter(Boolean));
    if (cleaned.length > 0) return cleaned;
  }
  return [];
}

function removeBlockedPlaceholders(values: string[]) {
  const blocked = new Set(["local area", "core service", "local support"]);
  return values.filter((value) => !blocked.has(value.trim().toLowerCase()));
}

function dedupeServiceNames(values: string[]) {
  const genericTailWords = new Set(["tray", "trays", "option", "options", "service", "services", "request", "requests"]);
  const cleaned: string[] = [];
  for (const value of values) {
    const normalized = normalizeServiceForDedupe(value);
    if (!normalized) continue;
    const duplicateIndex = cleaned.findIndex((existing) => {
      const existingNormalized = normalizeServiceForDedupe(existing);
      if (existingNormalized === normalized) return true;
      if (existingNormalized && normalized.startsWith(`${existingNormalized} `)) {
        const extraWords = normalized.slice(existingNormalized.length).trim().split(/\s+/);
        return extraWords.every((word) => genericTailWords.has(word));
      }
      if (existingNormalized && existingNormalized.startsWith(`${normalized} `)) {
        const extraWords = existingNormalized.slice(normalized.length).trim().split(/\s+/);
        return extraWords.every((word) => genericTailWords.has(word));
      }
      return false;
    });
    if (duplicateIndex >= 0) {
      if (value.length < cleaned[duplicateIndex]!.length) cleaned[duplicateIndex] = value;
      continue;
    }
    cleaned.push(value);
  }
  return cleaned;
}

function removeBusinessNameServiceCandidates(values: string[], businessName: string) {
  return values.filter((service) => !serviceLooksLikeBusinessName(service, businessName));
}

function serviceLooksLikeBusinessName(service: string, businessName: string) {
  const normalizedService = normalizeServiceForDedupe(service);
  const normalizedBusiness = normalizeServiceForDedupe(businessName);
  if (!normalizedService || !normalizedBusiness) return false;
  if (normalizedService === normalizedBusiness) return true;
  if (normalizedService.includes(normalizedBusiness) || normalizedBusiness.includes(normalizedService)) return normalizedService.length > 12;
  const brandWords = normalizedBusiness
    .split(/\s+/)
    .filter((word) => !/^(auto|automotive|repair|body|paint|collision|service|services|shop|company|co|llc|inc)$/.test(word));
  const brandPhrase = brandWords.slice(0, 2).join(" ");
  return brandPhrase.length >= 4 && normalizedService.includes(brandPhrase);
}

function normalizeServiceForDedupe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function createNormalizedBusinessFacts(input: {
  name: string;
  vertical: Vertical;
  services: string[];
  serviceAreas: string[];
  facts?: ExtractedBusinessFacts;
  promptFacts: ReturnType<typeof extractPromptFacts>;
  sourceHostname?: string;
  cleanedServices?: CleanedServiceV2[];
}): NormalizedBusinessFacts {
  // Cleaned service names ("10 Minute Flat Repair") must keep the source
  // backing of the raw strings they were derived from ("10 Minute Flat Repair
  // Starting At $25"), or the cleanup pass silently strips provenance.
  const cleanedByName = new Map((input.cleanedServices ?? []).map((service) => [service.name.toLowerCase(), service]));
  const rawCrawlServices = input.facts?.services ?? [];
  const rawPromptServices = input.promptFacts.services ?? [];
  const serviceProvenance = (service: string): { source: "crawl" | "prompt" | "system_default"; confidence: "high" | "medium" | "low" } => {
    if (rawCrawlServices.includes(service)) return { source: "crawl", confidence: "high" };
    if (rawPromptServices.includes(service)) return { source: "prompt", confidence: "high" };
    const cleaned = cleanedByName.get(service.toLowerCase());
    if (cleaned) {
      if (rawCrawlServices.includes(cleaned.sourceText)) return { source: "crawl", confidence: "high" };
      if (rawPromptServices.includes(cleaned.sourceText)) return { source: "prompt", confidence: "high" };
      return { source: "crawl", confidence: "medium" };
    }
    return { source: "system_default", confidence: "low" };
  };
  const observedCategories = input.facts?.categories ?? [];
  const categories = observedCategories.length ? observedCategories : [input.vertical.replace("_", " ")];
  const blockedPlaceholders = ["Local area", "Core service", "Local support"]
    .filter((text) => !input.services.includes(text) && !input.serviceAreas.includes(text))
    .map((text) => ({ text, reason: "Suppressed generic intake fallback from visible generated copy." }));
  const proofSignals: RenderableFact[] = [];
  if (input.facts?.reviewsSummary?.rating && !isGoogleDerivedReviewSummary(input.facts.reviewsSummary)) {
    proofSignals.push(fact("reviews.rating", `${input.facts.reviewsSummary.rating}`, "crawl", "medium"));
  }
  if (input.facts?.reviewsSummary?.count && !isGoogleDerivedReviewSummary(input.facts.reviewsSummary)) {
    proofSignals.push(fact("reviews.count", `${input.facts.reviewsSummary.count}`, "crawl", "medium"));
  }
  if (input.facts?.address?.city) proofSignals.push(fact("address.city", input.facts.address.city, "crawl", "high"));
  if (input.facts?.phone ?? input.promptFacts.phone) proofSignals.push(fact("phone", input.facts?.phone ?? input.promptFacts.phone ?? "", input.facts?.phone ? "crawl" : "prompt", "high"));

  return {
    name: fact("name", input.name, input.facts?.name ? "crawl" : input.sourceHostname ? "crawl" : "prompt", "high"),
    vertical: fact("vertical", input.vertical, input.vertical === "general_local" ? "system_default" : "crawl", input.vertical === "general_local" ? "low" : "medium"),
    categories: categories.map((category) => fact("categories", category, observedCategories.includes(category) ? "crawl" : "system_default", observedCategories.includes(category) ? "high" : "low")),
    description: input.facts?.description ? fact("description", input.facts.description, "crawl", "medium") : undefined,
    phone: input.facts?.phone || input.promptFacts.phone ? fact("phone", input.facts?.phone ?? input.promptFacts.phone ?? "", input.facts?.phone ? "crawl" : "prompt", "high") : undefined,
    email: input.facts?.email || input.promptFacts.email ? fact("email", input.facts?.email ?? input.promptFacts.email ?? "", input.facts?.email ? "crawl" : "prompt", "high") : undefined,
    address: input.facts?.address ? fact("address", formatAddress(input.facts.address), "crawl", "medium") : undefined,
    hours: input.facts?.hours ? fact("hours", Object.entries(input.facts.hours).map(([day, value]) => `${day}: ${value}`), "crawl", "medium") : undefined,
    services: input.services.map((service) => {
      const provenance = serviceProvenance(service);
      return fact("services", service, provenance.source, provenance.confidence);
    }),
    serviceAreas: input.serviceAreas.map((area) => fact("serviceAreas", area, (input.facts?.serviceAreas ?? []).includes(area) || input.facts?.address?.city === area ? "crawl" : "prompt", "medium")),
    proofSignals,
    uncertainFacts: [],
    blockedPlaceholders
  };
}

function createGenerationBrief(input: {
  siteId: string;
  business: BusinessProfile;
  recipe: VerticalRecipe;
  normalizedBusinessFacts: NormalizedBusinessFacts;
}): GenerationBrief {
  const heroAsset = heroImageAssetForBusiness(input.business);
  const renderableFacts = [
    input.normalizedBusinessFacts.name,
    input.normalizedBusinessFacts.vertical,
    ...input.normalizedBusinessFacts.categories,
    ...(input.normalizedBusinessFacts.description ? [input.normalizedBusinessFacts.description] : []),
    ...(input.normalizedBusinessFacts.phone ? [input.normalizedBusinessFacts.phone] : []),
    ...(input.normalizedBusinessFacts.email ? [input.normalizedBusinessFacts.email] : []),
    ...(input.normalizedBusinessFacts.address ? [input.normalizedBusinessFacts.address] : []),
    ...(input.normalizedBusinessFacts.hours ? [input.normalizedBusinessFacts.hours] : []),
    ...input.normalizedBusinessFacts.services,
    ...input.normalizedBusinessFacts.serviceAreas,
    ...input.normalizedBusinessFacts.proofSignals
  ];

  return {
    siteId: input.siteId,
    businessName: input.business.name,
    vertical: input.business.vertical,
    primaryGoal: input.recipe.primaryGoal,
    headline: heroHeading({ business: input.business, recipe: input.recipe, primaryCta: { label: "", href: "", role: "form" }, name: input.business.name }),
    subheadline: heroBody({ business: input.business, recipe: input.recipe, primaryCta: { label: "", href: "", role: "form" }, name: input.business.name }),
    proofSignals: input.normalizedBusinessFacts.proofSignals.map((proof) => String(proof.value)),
    renderableFacts,
    blockedClaims: input.normalizedBusinessFacts.blockedPlaceholders,
    imageStrategy: {
      vertical: input.business.vertical,
      preferredAssetId: heroAsset.id,
      fallbackAssetId: heroAsset.id,
      notes: ["Use curated preclaim-safe registry imagery until customer-owned photos are approved."]
    }
  };
}

function fact(
  field: string,
  value: string | string[],
  source: RenderableFact["source"],
  confidence: RenderableFact["confidence"]
): RenderableFact {
  return { field, value, source, confidence };
}

function formatAddress(address: NonNullable<ExtractedBusinessFacts["address"]>) {
  return [address.street, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ");
}


function formNameForVertical(vertical: Vertical) {
  return "Contact request";
}

function formFieldsForVertical(vertical: Vertical, fallback: ExtensionModel["forms"][number]["fields"]): ExtensionModel["forms"][number]["fields"] {
  return [
    { id: "name", label: "Name", type: "text", required: true },
    { id: "phone", label: "Phone", type: "phone", required: false },
    { id: "email", label: "Email", type: "email", required: false },
    { id: "message", label: "Message", type: "textarea", required: true }
  ];
}

function submitLabelForVertical(vertical: Vertical, goal: ConversionGoal) {
  return "Send message";
}

function submitLabelForGoal(goal: ConversionGoal) {
  switch (goal) {
    case "calls":
      return "Request a call";
    case "forms":
      return "Send request";
    case "booking_clicks":
      return "Request appointment";
    case "order_clicks":
      return "Start order";
    case "directions":
    case "store_visits":
      return "Ask for details";
  }
}

function fallbackFormCtaLabel(vertical: Vertical) {
  const labels: Partial<Record<Vertical, string>> = {
    law_firm: "Request Consultation",
    med_spa: "Request Consultation",
    dental: "Request Appointment",
    veterinary: "Request Appointment",
    beauty_salon: "Request Appointment",
    fitness: "Request First Visit",
    real_estate: "Send Inquiry",
    creative_studio: "Send Inquiry",
    restaurant: "Start Order",
    home_services: "Request Service"
  };
  return labels[vertical] ?? "Request a Quote";
}

function policy(editScope: FieldPolicy["editScope"], experimentEligible = false, factField = false): FieldPolicy {
  return { editScope, experimentEligible, factField };
}

function themeForVertical(vertical: Vertical, mood: Theme["mood"]): Theme {
  const palettes: Record<Vertical, Theme["colors"]> = {
    restaurant: {
      background: "#fff8f0",
      surface: "#ffffff",
      text: "#261c16",
      muted: "#6f625a",
      primary: "#b93b23",
      primaryText: "#ffffff",
      accent: "#e7ad45",
      border: "#eadbc9"
    },
    auto_body: {
      background: "#f6f8fb",
      surface: "#ffffff",
      text: "#162033",
      muted: "#5c6878",
      primary: "#164a63",
      primaryText: "#ffffff",
      accent: "#d8b252",
      border: "#d7e0e8"
    },
    auto_services: {
      background: "#f7f6f2",
      surface: "#ffffff",
      text: "#1a1c1e",
      muted: "#5d6166",
      primary: "#1f3a5f",
      primaryText: "#ffffff",
      accent: "#e0a325",
      border: "#dcdcd4"
    },
    beauty_salon: {
      background: "#fbf7fa",
      surface: "#ffffff",
      text: "#251924",
      muted: "#755f70",
      primary: "#7c315e",
      primaryText: "#ffffff",
      accent: "#d8a7bd",
      border: "#ead8e4"
    },
    med_spa: {
      background: "#f7fbfa",
      surface: "#ffffff",
      text: "#152422",
      muted: "#60716d",
      primary: "#2d7068",
      primaryText: "#ffffff",
      accent: "#b7cdbf",
      border: "#d9e8e4"
    },
    law_firm: {
      background: "#f7f7f4",
      surface: "#ffffff",
      text: "#16181f",
      muted: "#626875",
      primary: "#1c2e4a",
      primaryText: "#ffffff",
      accent: "#bda05b",
      border: "#dfe1dc"
    },
    dental: {
      background: "#f5fbff",
      surface: "#ffffff",
      text: "#132434",
      muted: "#5d7180",
      primary: "#176b88",
      primaryText: "#ffffff",
      accent: "#8bc6ce",
      border: "#d6e8ef"
    },
    home_services: {
      background: "#f8faf7",
      surface: "#ffffff",
      text: "#172033",
      muted: "#667085",
      primary: "#173f35",
      primaryText: "#ffffff",
      accent: "#c9a34d",
      border: "#dce5df"
    },
    fitness: {
      background: "#f8f7f3",
      surface: "#ffffff",
      text: "#17191b",
      muted: "#666b72",
      primary: "#1f5f58",
      primaryText: "#ffffff",
      accent: "#e26d3d",
      border: "#dddcd4"
    },
    real_estate: {
      background: "#f8f8f5",
      surface: "#ffffff",
      text: "#17202a",
      muted: "#64707a",
      primary: "#243f53",
      primaryText: "#ffffff",
      accent: "#c4a15d",
      border: "#deded6"
    },
    landscaping: {
      background: "#f8f6ef",
      surface: "#ffffff",
      text: "#1f271d",
      muted: "#6f6a5d",
      primary: "#315f36",
      primaryText: "#ffffff",
      accent: "#c0773e",
      border: "#e4ddcf"
    },
    veterinary: {
      background: "#fff9f1",
      surface: "#ffffff",
      text: "#22211c",
      muted: "#716b60",
      primary: "#506a45",
      primaryText: "#ffffff",
      accent: "#d49c57",
      border: "#eadfce"
    },
    creative_studio: {
      background: "#f9f8f6",
      surface: "#ffffff",
      text: "#171717",
      muted: "#666666",
      primary: "#222222",
      primaryText: "#ffffff",
      accent: "#b7a17a",
      border: "#ded8cf"
    },
    general_local: {
      background: "#f8faf7",
      surface: "#ffffff",
      text: "#172033",
      muted: "#667085",
      primary: "#173f35",
      primaryText: "#ffffff",
      accent: "#c9a34d",
      border: "#dce5df"
    }
  };

  return {
    paletteName: `${vertical}-${mood}-launch`,
    colors: palettes[vertical],
    typography: {
      heading: "var(--font-display)",
      body: "var(--font-body)"
    },
    radius: "sm",
    density: "standard",
    mood
  };
}

function heroVariantForVertical(vertical: Vertical) {
  const variants: Partial<Record<Vertical, string>> = {
    restaurant: "fullbleed_food",
    beauty_salon: "gallery_forward",
    creative_studio: "portfolio_forward",
    law_firm: "authority_split",
    home_services: "emergency_action",
    auto_body: "estimate_focused"
  };
  return variants[vertical] ?? "conversion_focused";
}

function heroEyebrow(context: SectionBuildContext) {
  const city = cleanDisplayPlace(context.business.address?.city ?? context.business.serviceAreas[0]);
  const category = context.business.categories[0] ?? context.recipe.label;
  return city ? `${category} in ${city}` : category;
}

function heroHeading(context: SectionBuildContext) {
  if (context.business.vertical === "restaurant") return restaurantHeroHeading(context);
  if (context.business.vertical === "landscaping" || context.business.vertical === "creative_studio") {
    return serviceLedHeroHeading(context);
  }
  const headings: Partial<Record<Vertical, string>> = {
    auto_body: "Collision repair with clear damage details.",
    beauty_salon: "Book the look without the back-and-forth.",
    med_spa: "A polished path from interest to consultation.",
    law_firm: professionalServicesHeroHeading(context),
    dental: "Make the next appointment easy.",
    home_services: "Fast help, clear service areas, easy contact.",
    fitness: "Turn interest into a first visit.",
    real_estate: "Make local expertise easy to trust.",
    landscaping: "Project scope made easy to quote.",
    veterinary: "Help pet owners act quickly and confidently.",
    creative_studio: "Portfolio-led project inquiries."
  };
  return headings[context.business.vertical] ?? `${context.name} makes it easy to take the next step.`;
}

function heroBody(context: SectionBuildContext) {
  const serviceList = context.business.services.slice(0, 3).join(", ");
  const area = cleanDisplayPlace(context.business.serviceAreas[0] ?? context.business.address?.city);
  const locationPhrase = area ? ` for ${audiencePlural(context.business.vertical)} in ${area}` : "";
  if (context.business.vertical === "auto_body") {
    const services = serviceList || "repair services";
    const areaPhrase = area ? ` for ${area} drivers` : "";
    return `${services} with quote request and call options up front${areaPhrase}.`;
  }
  if (context.business.vertical === "restaurant") {
    return restaurantHeroBody(context, area);
  }
  if (context.business.vertical === "law_firm") {
    return `Request a consultation with ${context.name}, or call to share the matter type and preferred follow-up${area ? ` in ${area}` : ""}.`;
  }
  if (context.business.vertical === "beauty_salon") {
    return `${serviceList || "Salon services"} with booking and call options up front${locationPhrase}.`;
  }
  if (context.business.vertical === "home_services") {
    return `${serviceList || "Home services"} with service-area details and call options up front${locationPhrase}.`;
  }
  if (context.business.vertical === "landscaping") {
    return `Share project scope with ${context.name}, check service area, or request a quote${area ? ` in ${area}` : ""}.`;
  }
  if (context.business.vertical === "creative_studio") {
    return `Send a brief to ${context.name}, compare portfolio context, or ask about timing${area ? ` in ${area}` : ""}.`;
  }
  const servicePhrase = serviceList || context.recipe.label.toLowerCase();
  return `${servicePhrase} with clear next steps and contact options up front${locationPhrase}.`;
}

function serviceLedHeroHeading(context: SectionBuildContext) {
  const services = context.business.services.slice(0, context.business.vertical === "creative_studio" ? 2 : 3);
  if (services.length) return `${readableList(services)}.`;
  return context.business.vertical === "creative_studio" ? "Portfolio-led project inquiries." : "Project scope made easy to quote.";
}

function restaurantHeroHeading(context: SectionBuildContext) {
  const services = context.business.services.slice(0, 3);
  if (services.length) return `${readableList(services)}.`;
  const category = context.business.categories[0]?.replace(/\s*restaurant$/i, " favorites");
  return category ? `${category}.` : `${context.name} is ready for online ordering.`;
}

function restaurantHeroBody(context: SectionBuildContext, area?: string) {
  const hasTakeout = context.business.services.some((service) => /\b(takeout|pickup|to go)\b/i.test(service));
  const hasCatering = context.business.services.some((service) => /\bcatering\b/i.test(service));
  const location = area ? ` in ${area}` : "";
  if (context.business.orderingLinks.length && context.business.phone) {
    const callReason = hasCatering ? "catering questions" : "menu questions";
    const visitReason = hasTakeout ? "pickup" : "a visit";
    return `Order online from ${context.name}, call with ${callReason}, or check hours before ${visitReason}${location}.`;
  }
  if (context.business.orderingLinks.length) return `Order online from ${context.name} and check the menu before the next visit${location}.`;
  if (context.business.phone) return `Call ${context.name} with menu questions, catering needs, or visit timing${location}.`;
  return `Menu highlights and next-step details are easy to scan${location}.`;
}

function professionalServicesHeroHeading(context: SectionBuildContext) {
  const area = cleanDisplayPlace(context.business.serviceAreas[0] ?? context.business.address?.city);
  const location = area ? ` in ${area}` : "";
  const services = context.business.vertical === "law_firm"
    ? context.business.services.slice(0, 2).map(lawPracticeHeroLabel)
    : context.business.services.slice(0, 2);
  if (context.business.vertical === "law_firm" && services.length >= 2) return `${services[0]} & ${services[1]}.`;
  if (services.length) return `${readableList(services)}${location}.`;
  return `${context.name}${location}.`;
}

function lawPracticeHeroLabel(service: string, index: number) {
  const label = service
    .replace(/\b(attorney|lawyer)\b/gi, "law")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return index === 0 ? sentenceCap(label) : label;
}

function servicesHeading(context: SectionBuildContext) {
  const primary = context.business.services[0];
  const secondary = context.business.services[1];
  if (primary && secondary) return `${primary} and ${secondary}`;
  if (primary) return primary;
  return `${context.recipe.label} services`;
}

function servicesBody(context: SectionBuildContext) {
  const area = cleanDisplayPlace(context.business.serviceAreas[0] ?? context.business.address?.city);
  const areaPhrase = area ? ` in ${area}` : "";
  const audience = audiencePlural(context.business.vertical);
  if (context.business.vertical === "auto_body") {
    return `Compare the repair services customers can request today, then choose the fastest way to reach the shop${areaPhrase}.`;
  }
  if (context.business.vertical === "law_firm") {
    return `Practice areas are listed plainly so clients can choose a consultation path${areaPhrase}.`;
  }
  if (context.business.vertical === "landscaping") {
    return `Compare outdoor services, then send project scope and location for a quote${areaPhrase}.`;
  }
  if (context.business.vertical === "creative_studio") {
    return `Match the project type to a simple inquiry path before sending a brief${areaPhrase}.`;
  }
  return `Clear service details and direct contact options help ${audience} decide whether ${context.name} is the right fit${areaPhrase}.`;
}

function galleryImagesForBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">) {
  return galleryImageAssetsForBusiness(business).map((asset) => ({
    url: asset.url,
    alt: asset.alt,
    label: asset.label
  }));
}

function galleryVariantForVertical(vertical: Vertical) {
  if (vertical === "creative_studio" || vertical === "beauty_salon") return "portfolio_grid";
  if (vertical === "restaurant") return "food_grid";
  return "proof_grid";
}

function galleryHeading(vertical: Vertical) {
  const headings: Partial<Record<Vertical, string>> = {
    restaurant: "Photos that make ordering easier",
    beauty_salon: "A closer look before booking",
    creative_studio: "Portfolio quality up front",
    landscaping: "Project context before the quote",
    auto_body: "Damage and finish details matter"
  };
  return headings[vertical] ?? "Visual proof that supports the next action";
}

function galleryBody(vertical: Vertical) {
  const bodies: Partial<Record<Vertical, string>> = {
    restaurant: "Dish and dining-room photos give guests a clear look before they order, pick up, or ask about catering.",
    beauty_salon: "Use visual references to compare style, finish, and booking fit before taking the next step.",
    creative_studio: "Portfolio images make the creative style clear before someone sends a brief.",
    landscaping: "Project photos help homeowners understand fit, scope, and the kind of work to discuss.",
    auto_body: "Repair visuals help drivers understand the shop's work before they call.",
    home_services: "Service photos give homeowners context before they request help.",
    law_firm: "A restrained visual section supports trust without adding unsupported claims."
  };
  return bodies[vertical] ?? "Relevant photos give customers context before they choose a next step.";
}

function trustItems(context: SectionBuildContext) {
  const items: string[] = [];
  const reviewSummary = isGoogleDerivedReviewSummary(context.business.reviewsSummary) ? undefined : context.business.reviewsSummary;
  if (reviewSummary?.rating) {
    items.push(`${reviewSummary.rating} rating`);
  }
  if (reviewSummary?.count) {
    items.push(`${reviewSummary.count} reviews`);
  }
  if (context.business.serviceAreas[0]) {
    items.push(`Serves ${cleanDisplayPlace(context.business.serviceAreas[0])}`);
  }
  if (context.business.phone) {
    items.push(callTrustLabel(context.business.vertical));
  }
  for (const signal of context.recipe.trustSignals) {
    if (items.length >= 4) break;
    const safeSignal = safeTrustSignal(signal, context);
    if (safeSignal) items.push(safeSignal);
  }
  return unique(items).slice(0, 4);
}

function safeTrustSignal(signal: string, context: SectionBuildContext) {
  const normalized = signal.toLowerCase();
  if (normalized.includes("rating")) return context.business.reviewsSummary?.rating ? `${context.business.reviewsSummary.rating} public rating` : undefined;
  if (normalized.includes("review") && context.business.reviewsSummary?.count) return `${context.business.reviewsSummary.count} public reviews`;
  if (normalized.includes("photo") || normalized.includes("before")) return photoTrustLabel(context.business.vertical);
  if (normalized.includes("credential") || normalized.includes("certification") || normalized.includes("licensed") || normalized.includes("insured") || normalized.includes("insurance")) return undefined;
  if (normalized.includes("response")) return "Direct contact";
  if (normalized.includes("social")) return context.business.socialLinks.length ? "Social profile detected" : undefined;
  if (normalized.includes("years")) return undefined;
  return undefined;
}

function serviceDescription(vertical: Vertical, service: string) {
  const lowered = service.toLowerCase();
  if (vertical === "restaurant") return restaurantServiceDescription(lowered);
  if (vertical === "landscaping") return landscapingServiceDescription(lowered);
  if (vertical === "creative_studio") return creativeServiceDescription(lowered);
  if (vertical === "auto_body") return autoBodyServiceDescription(lowered);
  if (vertical === "home_services") return homeServicesServiceDescription(lowered);
  if (vertical === "beauty_salon") return beautyServiceDescription(lowered);
  if (vertical === "law_firm") return lawFirmServiceDescription(lowered);
  const descriptions: Partial<Record<Vertical, string>> = {
    med_spa: `Use the consultation path to ask about fit and next steps for ${lowered}.`,
    dental: `Check appointment options and patient next steps for ${lowered}.`,
    fitness: `Check schedule, first-visit fit, and membership context for ${lowered}.`,
    real_estate: `Connect ${lowered} to local market context and a direct inquiry path.`,
    veterinary: `Check care fit and appointment options for ${lowered}.`
  };
  return descriptions[vertical] ?? `Review fit, timing, and next steps for ${lowered}.`;
}

function autoBodyServiceDescription(loweredService: string) {
  if (loweredService.includes("collision")) return "Start with damage photos, vehicle context, and timing so the shop can understand the collision repair need.";
  if (loweredService.includes("paint")) return "Share affected panels, finish concerns, and timing so paint repair questions start with useful detail.";
  if (loweredService.includes("bumper")) return "Send bumper damage details and contact preferences so the next step is clear before the call.";
  if (loweredService.includes("dent")) return "Describe the dent location and severity so repair fit can be confirmed quickly.";
  return `Send photos, vehicle context, and timing details for ${loweredService}.`;
}

function homeServicesServiceDescription(loweredService: string) {
  if (loweredService.includes("hvac")) return "Share the system issue, location, and timing so service fit can be confirmed quickly.";
  if (loweredService.includes("plumb")) return "Start with the fixture or leak context, urgency, and address details before the call.";
  if (loweredService.includes("electric")) return "Send the electrical issue, access notes, and timing so the request starts with the right context.";
  if (loweredService.includes("repair")) return "Describe the issue, location, and timing so the team can route the service request.";
  return `Confirm location, timing, and service context for ${loweredService}.`;
}

function beautyServiceDescription(loweredService: string) {
  if (loweredService.includes("color")) return "Share color goals, current hair context, and timing before requesting an appointment.";
  if (loweredService.includes("cut")) return "Compare cut goals and availability, then send preferred timing or call the salon.";
  if (loweredService.includes("styl")) return "Start with the occasion, style reference, and timing so booking fit is clear.";
  if (loweredService.includes("nail")) return "Compare finish, service type, and appointment timing before booking.";
  return `Share style goals, timing, and booking context for ${loweredService}.`;
}

function lawFirmServiceDescription(loweredService: string) {
  if (loweredService.includes("estate")) return "Start with the planning need and preferred follow-up so the consultation request is clear.";
  if (loweredService.includes("business")) return "Share the business matter type, timing, and best contact path for consultation follow-up.";
  if (loweredService.includes("injury")) return "Send matter context and contact preferences so the office can confirm next steps.";
  return `Share the matter type, timing, and preferred follow-up for ${loweredService}.`;
}

function restaurantServiceDescription(loweredService: string) {
  if (loweredService.includes("catering")) return "Catering trays and group orders stay close to online ordering and a quick call.";
  if (loweredService.includes("takeout") || loweredService.includes("pickup")) return "Takeout options are easy to scan before guests order ahead.";
  if (loweredService.includes("breakfast") || loweredService.includes("taco")) return "Taco favorites are presented clearly for quick online ordering.";
  if (loweredService.includes("delivery")) return "Delivery details stay close to the menu and ordering path.";
  return "Menu favorites are easy to scan before guests choose how to order.";
}

function landscapingServiceDescription(loweredService: string) {
  if (loweredService.includes("lawn")) return "Routine lawn care details stay close to service-area and quote options.";
  if (loweredService.includes("design")) return "Landscape design inquiries start with scope, location, and timing.";
  if (loweredService.includes("cleanup") || loweredService.includes("seasonal")) return "Seasonal cleanup requests can include property details and preferred timing.";
  return "Outdoor project requests can include scope, location, and quote details.";
}

function creativeServiceDescription(loweredService: string) {
  if (loweredService.includes("portrait")) return "Portrait session inquiries can include style, timing, and usage notes.";
  if (loweredService.includes("commercial")) return "Commercial shoot requests can include brief, usage, timeline, and deliverables.";
  if (loweredService.includes("project") || loweredService.includes("inquir")) return "Project inquiries can start with context, timeline, and contact details.";
  return "Creative inquiries can include brief, timing, and project context.";
}

function callTrustLabel(vertical: Vertical) {
  const labels: Partial<Record<Vertical, string>> = {
    restaurant: "Call the restaurant",
    law_firm: "Call the office",
    dental: "Call the practice",
    med_spa: "Call the clinic",
    veterinary: "Call the clinic",
    beauty_salon: "Call the salon",
    auto_body: "Call the shop",
    home_services: "Call for service",
    landscaping: "Call about a project"
  };
  return labels[vertical] ?? "Direct phone line";
}

function photoTrustLabel(vertical: Vertical) {
  const labels: Partial<Record<Vertical, string>> = {
    restaurant: "Food photos",
    beauty_salon: "Style photos",
    creative_studio: "Portfolio images",
    landscaping: "Project photos",
    auto_body: "Repair photos",
    home_services: "Service photos"
  };
  return labels[vertical] ?? "Relevant photos";
}

function cleanDisplayPlace(value: string | undefined) {
  return value?.trim().replace(/[.,;:]+$/g, "");
}

function readableList(values: string[]) {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] ?? "";
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function sentenceCap(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function testimonialItems(business: BusinessProfile) {
  const items = [];
  const reviewSummary = isGoogleDerivedReviewSummary(business.reviewsSummary) ? undefined : business.reviewsSummary;
  if (reviewSummary?.rating || reviewSummary?.count) {
    return [
      {
        quote: [
          reviewSummary.rating ? `${reviewSummary.rating} average rating` : undefined,
          reviewSummary.count ? `${reviewSummary.count} public reviews` : undefined
        ]
          .filter(Boolean)
          .join(" across "),
        author: "Review profile"
      }
    ];
  }
  items.push(
    {
      quote: "Clear services and direct contact options help customers decide what to do next.",
      author: "Customer decision path"
    },
    {
      quote: "Project examples, public profiles, and service details can support the next action.",
      author: "Conversion standard"
    }
  );
  return items.slice(0, 3);
}

function faqItems(context: SectionBuildContext) {
  const service = context.business.services[0] ?? context.recipe.label;
  const area = context.business.serviceAreas[0] ?? context.business.address?.city;
  const audience = audiencePlural(context.business.vertical);
  return [
    {
      question: area ? `Do you help ${audience} in ${area}?` : `Do you help local ${audience}?`,
      answer: `Yes. Contact ${context.business.name} to confirm the current service area and the best next step.`
    },
    {
      question: `How do customers get started with ${service}?`,
      answer: context.business.phone ? "Call the business or send the request details through the form." : "Send the request details through the form."
    },
    {
      question: "What details should customers check before contacting the business?",
      answer: "Confirm current availability, service fit, timing, and any details needed for the next step."
    }
  ];
}

function ctaHeading(context: SectionBuildContext) {
  if (context.business.vertical === "law_firm" || context.business.vertical === "med_spa") {
    return "Ready to request a consultation?";
  }
  if (context.business.vertical === "dental" || context.business.vertical === "veterinary" || context.business.vertical === "beauty_salon") {
    return "Ready to book?";
  }
  if (context.business.vertical === "restaurant") return "Ready to order?";
  if (context.business.vertical === "fitness") return "Ready for a first visit?";
  if (context.business.vertical === "real_estate" || context.business.vertical === "creative_studio") return "Ready to send an inquiry?";
  if (context.recipe.primaryGoal === "calls") return "Ready to talk now?";
  if (context.recipe.primaryGoal === "directions" || context.recipe.primaryGoal === "store_visits") return "Ready to visit?";
  return "Ready to request an estimate?";
}

function ctaBody(context: SectionBuildContext) {
  const bodies: Partial<Record<Vertical, string>> = {
    restaurant: "Choose the ordering link for the fastest path, or call with catering and pickup questions.",
    auto_body: "Send repair details once, then let the shop confirm fit, timing, and next steps.",
    law_firm: "Use the consultation path to share the matter type and preferred way to follow up.",
    beauty_salon: "Book the service that fits, or call the salon with timing and style questions.",
    home_services: "Call or send the request details so the team can confirm service fit and timing.",
    landscaping: "Share the project scope and location so the team can confirm the best next step.",
    creative_studio: "Send the brief, timeline, and project context so the studio can respond clearly.",
    dental: "Choose the appointment path or call the practice with patient questions.",
    veterinary: "Choose the appointment path or call the clinic with care questions.",
    med_spa: "Start with a consultation request so the team can confirm fit before booking."
  };
  return bodies[context.business.vertical] ?? nextActionDescription(context.recipe.primaryGoal);
}

function contactBody(context: SectionBuildContext) {
  const bodies: Partial<Record<Vertical, string>> = {
    restaurant: "Send catering, pickup, or ordering questions directly to the restaurant.",
    auto_body: "Send repair details, vehicle context, and timing so the shop can follow up.",
    law_firm: "Share the matter type and preferred contact details for a consultation request.",
    beauty_salon: "Share the service, timing, and style notes before booking or calling.",
    home_services: "Send the service need, location, and timing so the team can respond.",
    landscaping: "Share project scope, property details, and timing for a quote request.",
    creative_studio: "Send project context, timeline, and contact details for an inquiry.",
    dental: "Share patient questions and preferred appointment timing.",
    veterinary: "Share care questions and preferred appointment timing.",
    med_spa: "Share goals, timing, and consultation preferences."
  };
  return bodies[context.business.vertical] ?? nextActionDescription(context.recipe.primaryGoal);
}

function nextActionDescription(goal: ConversionGoal) {
  switch (goal) {
    case "calls":
      return "Call to confirm availability, service fit, and timing.";
    case "booking_clicks":
      return "Open the booking flow after checking the service details.";
    case "order_clicks":
      return "Keep menu context and ordering links close together so hungry visitors do not have to search.";
    case "directions":
    case "store_visits":
      return "Check the location, hours, and directions before visiting.";
    case "forms":
    default:
      return "Send the request details, timing, and contact preferences through the form.";
  }
}

function teamHeading(vertical: Vertical) {
  const headings: Partial<Record<Vertical, string>> = {
    law_firm: "Credentials should be visible before the consultation",
    dental: "Help new patients meet the team",
    med_spa: "Provider expertise belongs near the booking path",
    veterinary: "Trust starts with the care team",
    fitness: "Trainer proof turns interest into action"
  };
  return headings[vertical] ?? "Show the people behind the business";
}

function teamItems(vertical: Vertical) {
  const role = vertical === "law_firm"
    ? "Attorney profile"
    : vertical === "dental"
      ? "Provider bio"
      : vertical === "fitness"
        ? "Coach profile"
        : "Team profile";
  return [
    {
      title: role,
      description: "Explain the customer-facing role and how that person helps with the service."
    },
    {
      title: "Owner story",
      description: "Share the local context and service philosophy when that information is available."
    },
    {
      title: "Customer-facing expertise",
      description: "Use this slot for care philosophy, process, or service approach."
    }
  ];
}

function beforeAfterHeading(vertical: Vertical) {
  const headings: Partial<Record<Vertical, string>> = {
    auto_body: "Before-and-after proof belongs above the estimate form",
    med_spa: "Results need verified before-and-after context",
    landscaping: "Project proof turns interest into quote requests"
  };
  return headings[vertical] ?? "Show the outcome customers are buying";
}

function audiencePlural(vertical: Vertical) {
  const labels: Partial<Record<Vertical, string>> = {
    law_firm: "clients",
    dental: "patients",
    veterinary: "pet owners",
    restaurant: "guests",
    fitness: "members",
    real_estate: "clients",
    creative_studio: "clients"
  };
  return labels[vertical] ?? "customers";
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function mergeExtractedFacts(
  websiteFacts?: ExtractedBusinessFacts,
  publicFacts?: PublicPresenceEnrichment["facts"]
): ExtractedBusinessFacts | undefined {
  if (!websiteFacts && !publicFacts) return undefined;
  return {
    name: selectMergedBusinessName(websiteFacts?.name, publicFacts?.name),
    description: websiteFacts?.description ?? publicFacts?.description,
    phone: websiteFacts?.phone ?? publicFacts?.phone,
    email: websiteFacts?.email ?? publicFacts?.email,
    address: websiteFacts?.address ?? publicFacts?.address,
    geo: websiteFacts?.geo ?? publicFacts?.geo,
    hours: websiteFacts?.hours ?? publicFacts?.hours,
    categories: rankCategoriesBySpecificity(unique([...(publicFacts?.categories ?? []), ...(websiteFacts?.categories ?? [])])).slice(0, 8),
    services: unique([...(websiteFacts?.services ?? []), ...(publicFacts?.services ?? [])]).slice(0, 12),
    serviceHighlights: unique([...(websiteFacts?.serviceHighlights ?? []), ...(publicFacts?.serviceHighlights ?? [])]).slice(0, 8),
    serviceAreas: unique([...(websiteFacts?.serviceAreas ?? []), ...(publicFacts?.serviceAreas ?? [])]).slice(0, 12),
    socialLinks: unique([...(websiteFacts?.socialLinks ?? []), ...(publicFacts?.socialLinks ?? [])]).slice(0, 10),
    bookingLinks: unique([...(websiteFacts?.bookingLinks ?? []), ...(publicFacts?.bookingLinks ?? [])]).slice(0, 6),
    orderingLinks: unique([...(websiteFacts?.orderingLinks ?? []), ...(publicFacts?.orderingLinks ?? [])]).slice(0, 6),
    pressLinks: unique([...(websiteFacts?.pressLinks ?? []), ...(publicFacts?.pressLinks ?? [])]).slice(0, 8),
    reviewsSummary: websiteFacts?.reviewsSummary ?? publicFacts?.reviewsSummary
  };
}

function durablePublicPresenceFacts(publicPresence: PublicPresenceEnrichment | undefined): PublicPresenceEnrichment["facts"] | undefined {
  if (!publicPresence) return undefined;
  return publicPresence.facts;
}

function durablePublicPresenceProvenance(publicPresence: PublicPresenceEnrichment | undefined): Record<string, FieldProvenance> {
  if (!publicPresence) return {};
  return publicPresence.provenance;
}

function isGoogleDerivedReviewSummary(summary: BusinessProfile["reviewsSummary"] | ExtractedBusinessFacts["reviewsSummary"] | undefined) {
  return summary?.sources.includes("google_places") ?? false;
}

function selectMergedBusinessName(websiteName?: string, publicName?: string) {
  const cleanedWebsiteName = normalizeBusinessNameForIntake(websiteName);
  const cleanedPublicName = normalizeBusinessNameForIntake(publicName);
  if (!cleanedWebsiteName) return cleanedPublicName;
  if (!cleanedPublicName) return cleanedWebsiteName;
  if (businessNameLooksLikeSlogan(cleanedWebsiteName) && !businessNameLooksLikeSlogan(cleanedPublicName)) return cleanedPublicName;
  return cleanedWebsiteName;
}

function normalizeBusinessNameForIntake(value?: string) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  const candidates = cleaned
    .split(/\s+(?:[|\u2013\u2014-])\s+/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length >= 2)
    .filter((candidate) => !/^(home|about us|contact us|contact|gallery|portfolio|privacy policy|terms)$/i.test(candidate));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return cleaned;
  const businessLike = candidates.filter((candidate) => !businessNameLooksLikeSlogan(candidate));
  return businessLike[businessLike.length - 1] ?? candidates[candidates.length - 1] ?? cleaned;
}

function businessNameLooksLikeSlogan(value: string) {
  return /[!?]/.test(value) || /\b(done right|welcome|official site|quality|best|affordable|professional)\b/i.test(value);
}

function buildProvenance(
  input: IntakeInput,
  facts: ExtractedBusinessFacts | undefined,
  promptFacts: ReturnType<typeof extractPromptFacts>,
  observedAt: string
): Record<string, FieldProvenance> {
  const source = input.url ? ("website" as const) : ("manual" as const);
  const sourceUrl = input.url;
  return {
    name: { source, sourceUrl, confidence: facts?.name ? 0.82 : 0.65, verified: false, observedAt },
    phone: { source, sourceUrl, confidence: facts?.phone || promptFacts.phone ? 0.78 : 0.45, verified: false, observedAt },
    address: { source, sourceUrl, confidence: facts?.address || promptFacts.address ? 0.72 : 0.25, verified: false, observedAt },
    geo: { source, sourceUrl, confidence: facts?.geo ? 0.72 : 0.25, verified: false, observedAt },
    hours: { source, sourceUrl, confidence: facts?.hours || promptFacts.hours ? 0.7 : 0.25, verified: false, observedAt },
    services: { source, sourceUrl, confidence: facts?.services?.length || promptFacts.services?.length ? 0.65 : 0.45, verified: false, observedAt },
    reviewsSummary: { source, sourceUrl, confidence: facts?.reviewsSummary ? 0.65 : 0.25, verified: false, observedAt },
    description: {
      source: input.prompt ? "manual" : "other",
      sourceUrl,
      confidence: 0.55,
      verified: false,
      observedAt
    }
  };
}

function profileDescriptionForBusiness(input: {
  name: string;
  vertical: Vertical;
  services: string[];
  serviceAreas: string[];
  sourceHostname?: string;
}) {
  const services = input.services.slice(0, 3).join(", ");
  const area = input.serviceAreas.slice(0, 2).join(" and ");
  const category = input.vertical.replace(/_/g, " ");
  const servicePhrase = services || category;
  const areaPhrase = area && area !== "Local area" ? ` in ${area}` : "";
  const sourcePhrase = input.sourceHostname ? ` based on public facts from ${input.sourceHostname}` : "";
  return `${input.name} is a ${category} profile focused on ${servicePhrase}${areaPhrase}${sourcePhrase}. Key business details remain owner-verified before publishing.`;
}

function buildTechnicalNotes(crawl?: CrawlAssessment) {
  if (!crawl) return ["Crawl adapter will inspect metadata, schema, sitemap, robots, links, and mobile basics."];
  const pageSummaryCount = crawl.pageSummaries?.length ?? 0;
  return [
    `Fetched ${crawl.finalUrl ?? crawl.url} with status ${crawl.status ?? "unknown"}.`,
    `Initial technical/conversion quality score: ${crawl.score.percent}/100 (${crawl.score.grade}).`,
    `${pageSummaryCount} crawl page summar${pageSummaryCount === 1 ? "y" : "ies"} captured for homepage, service, contact, menu, and trust-signal context.`,
    `${crawl.formReferences.length} form reference${crawl.formReferences.length === 1 ? "" : "s"} and ${crawl.linkReferences.length} link reference${crawl.linkReferences.length === 1 ? "" : "s"} were captured for import context.`,
    crawl.hasLocalBusinessSchema ? "LocalBusiness-style schema was detected." : "LocalBusiness structured data was not detected.",
    crawl.hasViewportMeta ? "Mobile viewport meta tag was detected." : "Mobile viewport meta tag was not detected.",
    crawl.hasTelLink ? "Click-to-call tel link was detected." : "Click-to-call tel link was not detected.",
    crawl.robotsFound ? "robots.txt was detected." : "robots.txt was not detected.",
    crawl.sitemapFound ? "sitemap.xml was detected." : "sitemap.xml was not detected.",
    ...crawl.findings
  ];
}

function buildBrandNotes(crawl?: CrawlAssessment) {
  if (!crawl) return ["Generated mockups should guide creative direction, then compile into structured sections."];
  return [
    `${crawl.assetReferences.length} website asset references were captured as public source inputs for internal preview context.`,
    "Generated mockups should preserve recognizable brand cues while retaining provenance for source material."
  ];
}

function buildVisualNotes(renderInspection?: RenderInspectionResult) {
  if (!renderInspection) {
    return ["Screenshot analysis will identify CTA clarity, visual hierarchy, brand cues, and mobile usability."];
  }
  const failed = renderInspection.findings.filter((finding) => finding.severity === "fail").length;
  const warnings = renderInspection.findings.filter((finding) => finding.severity === "warning").length;
  return [
    `Render inspection used ${renderInspection.adapter} with ${renderInspection.screenshots.length} screenshot artifact${renderInspection.screenshots.length === 1 ? "" : "s"}.`,
    `${failed} render failures and ${warnings} render warnings were detected for CTA, form, tel, blank-page, and above-fold checks.`,
    ...(renderInspection.unavailableReason ? [`Browser screenshot capture fallback reason: ${renderInspection.unavailableReason}`] : [])
  ];
}

function buildPublicPresenceNotes(crawl?: CrawlAssessment, publicPresence?: PublicPresenceEnrichment) {
  if (!crawl && !publicPresence) return ["Public presence data is ingested with provenance and verified on claim."];
  const officialNotes = publicPresence?.signals.length
    ? [
        `${publicPresence.signals.length} official/public presence candidate${publicPresence.signals.length === 1 ? "" : "s"} captured from ${publicPresence.provider}.`
      ]
    : (publicPresence?.notes ?? []).slice(0, 1);
  if (!crawl) {
    return [...officialNotes, "Official/public facts remain unverified until claim; owner-truth fields are confirmed before publishing or sync."];
  }
  const pageSummaryCount = crawl.pageSummaries?.length ?? 0;
  return [
    `${crawl.extractedFacts.socialLinks.length} social links, ${crawl.extractedFacts.bookingLinks.length} booking links, ${crawl.extractedFacts.orderingLinks.length} ordering links, and ${crawl.linkReferences.length} crawl links were detected across ${pageSummaryCount || 1} crawl page${pageSummaryCount === 1 ? "" : "s"}.`,
    ...officialNotes,
    "Facts from website/schema remain unverified until claim; owner-truth fields are confirmed before publishing or sync."
  ];
}

function buildAssetInventory({
  business,
  input,
  mockups,
  now
}: {
  business: BusinessProfile;
  input: IntakeInput;
  mockups: CreativeMockupArtifact[];
  now: string;
}): SiteAsset[] {
  const websiteProvenance = input.url
    ? {
        source: "website" as const,
        sourceUrl: input.url,
        confidence: 0.7,
        verified: false,
        observedAt: now
      }
    : undefined;
  const referencedPhotos = business.photos.map((asset, index) => ({
    id: `${business.siteId}_asset_photo_reference_${index + 1}`,
    siteId: business.siteId,
    kind: "photo" as const,
    url: asset.url,
    alt: asset.alt,
    source: asset.source,
    rightsStatus: asset.rightsStatus,
    usageScope: "reference_only" as const,
    ownerApproved: false,
    provenance: websiteProvenance,
    metadata: { referenceAssetId: asset.id, preclaimUse: "reference_only" },
    createdAt: now
  }));
  const logo: SiteAsset[] = business.logo
    ? [
        {
          id: `${business.siteId}_asset_logo_reference`,
          siteId: business.siteId,
          kind: "logo",
          url: business.logo.url,
          alt: business.logo.alt,
          source: business.logo.source,
          rightsStatus: business.logo.rightsStatus,
          usageScope: "reference_only",
          ownerApproved: false,
          provenance: websiteProvenance,
          metadata: { referenceAssetId: business.logo.id, preclaimUse: "reference_only" },
          createdAt: now
        }
      ]
    : [];
  const screenshots: SiteAsset[] =
    input.renderInspection?.screenshots.map((screenshot) => ({
      id: `${business.siteId}_asset_current_screenshot_${screenshot.viewport}`,
      siteId: business.siteId,
      kind: "screenshot",
      url: screenshot.path,
      alt: `Current site ${screenshot.viewport} screenshot`,
      source: "website_reference",
      rightsStatus: "reference_only",
      usageScope: "internal_planning",
      ownerApproved: false,
      provenance: websiteProvenance,
      metadata: {
        viewport: screenshot.viewport,
        width: screenshot.width,
        height: screenshot.height,
        bytes: screenshot.bytes,
        capturedAt: screenshot.capturedAt
      },
      createdAt: now
    })) ?? [];

  return [...referencedPhotos, ...logo, ...screenshots, ...createMockupAssets(mockups)];
}

function unique(items: string[]) {
  return Array.from(new Set(items));
}

function rankCategoriesBySpecificity(values: string[] | undefined, vertical?: Vertical) {
  return unique(values ?? [])
    .filter((value) => !/^(local business|business|point of interest|establishment|food|web page|webpage|website)$/i.test(value.trim()))
    .map((value, index) => ({ value, index, score: categorySpecificityScore(value) + verticalCategoryAffinity(value, vertical) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.value);
}

/**
 * Scraped category lists mix what the business IS with what directories filed
 * it under ("auto parts store" for a tire shop). The surfaced category must
 * describe the service business, so vertical-consistent labels outrank
 * retail/generic ones.
 */
const verticalCategoryKeywords: Partial<Record<Vertical, RegExp>> = {
  auto_services: /tire|wheel|auto (repair|service|care)|car repair|mechanic|brake|alignment|oil change/i,
  auto_body: /auto body|collision|body shop|paint|dent/i,
  home_services: /plumb|hvac|electric|handyman|home (repair|service)|drain|water heater/i,
  restaurant: /restaurant|diner|cafe|kitchen|grill|pizzeria|taqueria|bakery|bar(?!ber)/i,
  beauty_salon: /salon|hair|barber|beauty|stylist/i,
  med_spa: /med ?spa|aesthetic|skin|laser|wellness/i
};

function verticalCategoryAffinity(value: string, vertical?: Vertical) {
  if (!vertical) return 0;
  const keywords = verticalCategoryKeywords[vertical];
  if (keywords?.test(value)) return 120;
  if (/parts store|supply|^store$|^service$|wholesale|retail/i.test(value.trim())) return -80;
  return 0;
}

function categorySpecificityScore(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length * 8 + value.length;
}
