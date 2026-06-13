import type {
  BusinessProfile,
  BusinessUnderstandingV2,
  CleanedServiceV2,
  ConversionGoal,
  Experiment,
  ExperimentLearning,
  ExtensionModel,
  FieldProvenance,
  GenerationBrief,
  GenerationCostEstimate,
  NormalizedBusinessFacts,
  PresenceAssessment,
  CreativeMockupArtifact,
  RenderableFact,
  RenderInspectionResult,
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
import { heroImageAssetForBusiness } from "./image-registry";
import { computeSiteModelHash, makePendingGenerationQa } from "./site-version-metadata";
import { createBusinessFactGraph } from "./business-fact-graph";
import { withBusinessBundleFields } from "./business-model";
import { planGenerationCost } from "./generation-cost";
import { applyGeneratedSiteV3 } from "./generated-site-v3-pipeline";
import { activeSiteVersionV3 } from "./site-version-v3";
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

export function createSiteV3FromInput(input: IntakeInput): SiteBundle {
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
    ...(() => {
      const ranked = rankedLogoReferences(input.crawl?.assetReferences);
      const candidates = ranked.map((asset, index) => ({
        id: `asset_reference_logo_${index + 1}`,
        url: asset.url,
        alt: `${name} logo reference`,
        source: "website_reference" as const,
        rightsStatus: "reference_only" as const
      }));
      return {
        // Provisional pick by URL ranking; scraped-media re-decides from the
        // candidates' measured pixel dimensions at download time.
        logo: candidates[0],
        logoCandidates: candidates.length > 1 ? candidates : undefined
      };
    })(),
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
  const siteModel: SiteModel = {
    id: siteId,
    slug: siteSlug,
    pinList: [],
    theme: selectedTheme,
    versions: []
  };

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
    optimizationFindings: [],
    experiments: defaultExperimentsForBusiness(businessProfile, recipe, input.experimentLearnings),
    presenceAssessment
  });
  applyGeneratedSiteV3({ bundle, now });
  const activeInitialVersion = activeSiteVersionV3(bundle.siteModel, "generated intake bundle");
  presenceAssessment.businessFactGraph = createBusinessFactGraph({
    business: businessProfile,
    presence: presenceAssessment,
    observedAt: now
  });
  activeInitialVersion.generationQa = makePendingGenerationQa(computeSiteModelHash(bundle, activeInitialVersion));
  bundle.optimizationFindings = runAudit(businessProfile, siteModel);
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
    headline: generationBriefHeadline(input.business),
    subheadline: generationBriefSubheadline(input.business, input.recipe),
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

function generationBriefHeadline(business: BusinessProfile) {
  const service = business.services[0] ?? business.categories[0] ?? "local service";
  const place = business.address?.city ?? business.serviceAreas[0];
  return `${business.name} for ${service}${place ? ` in ${place}` : ""}`;
}

function generationBriefSubheadline(business: BusinessProfile, recipe: VerticalRecipe) {
  const action = recipe.primaryGoal === "calls" ? "Call" : recipe.primaryGoal === "booking_clicks" ? "Book" : recipe.primaryGoal === "order_clicks" ? "Order" : "Request service";
  const services = business.services.slice(0, 3).join(", ") || business.categories.slice(0, 2).join(", ") || "local services";
  return `${action} with clear next steps for ${services.toLowerCase()}.`;
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

/**
 * Logo extraction v3: rank crawled logo references by URL signals, then let
 * scraped-media download the top candidates and choose by MEASURED pixels
 * (`chooseAndStoreLogo`). URL scoring only orders the download attempts —
 * a 180px apple-touch icon legitimately beats a 32px favicon, so the old
 * blanket apple-touch penalty is now mild. Icon files still never qualify.
 * Returning an empty list is deliberate — a favicon-only site keeps the
 * typographic wordmark instead of rendering a bad mark.
 */
function rankedLogoReferences(
  references: CrawlAssessment["assetReferences"] | undefined,
  limit = 3
): CrawlAssessment["assetReferences"] {
  const logos = (references ?? []).filter((asset) => asset.kind === "logo");
  if (!logos.length) return [];
  return logos
    .map((asset) => {
      const url = asset.url.toLowerCase();
      let score = 0;
      if (/\.svg(\?|#|$)/.test(url)) score += 40;
      else if (/\.png(\?|#|$)/.test(url)) score += 30;
      else if (/\.webp(\?|#|$)/.test(url)) score += 25;
      else if (/\.jpe?g(\?|#|$)/.test(url)) score += 15;
      if (/\.ico(\?|#|$)/.test(url)) score -= 100;
      if (/favicon|site-icon/.test(url)) score -= 60;
      // Apple-touch icons are usually 180px brand marks: keep them above the
      // score-zero filter so measurement can judge them, ranked below any
      // real header logo. The generated icon alt must not double-penalize
      // them back out.
      const appleTouch = /apple-touch/.test(url);
      if (appleTouch) score -= 15;
      if (/logo/.test(url)) score += 25;
      if (asset.alt === "Website icon reference") score -= appleTouch ? 0 : 30;
      else if (asset.alt) score += 10;
      return { asset, score };
    })
    .sort((left, right) => right.score - left.score)
    .filter((entry) => entry.score > 0)
    .slice(0, limit)
    .map((entry) => entry.asset);
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
