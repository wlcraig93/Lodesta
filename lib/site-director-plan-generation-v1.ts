import { z } from "zod";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import {
  buildCatalogManifestV1,
  buildDirectorInputManifestV1,
  hashDirectorManifestV1,
  type CatalogManifestV1,
  type DirectorInputManifestV1
} from "./generated-site-v3-director-manifest";
import {
  sectionBlueprintVersionV1,
  type SectionBlueprintRoleV1,
  type SectionBlueprintTemplateOptionsV1,
  type SectionBlueprintV1
} from "./generated-site-v3-blueprint";
import type { SectionPresentationMapV3 } from "./generated-site-v3-art-direction-catalog";
import type { PresentationGuidanceV3 } from "./generated-site-v3-art-direction-catalog";
import type {
  CaseStudyTreatmentV3,
  ComparisonTreatmentV3,
  ContactCtaModeV3,
  ContactFormComplexityV3,
  ContactLayoutV3,
  ContactProofSidebarV3,
  EligibilityBandTreatmentV3,
  HeroCtaLayoutV3,
  HeroHeadlineScaleV3,
  HeroLayoutV3,
  HeroMediaTreatmentV3,
  HeroProofPlacementV3,
  IntroGridCardActionV3,
  IntroGridCardTreatmentV3,
  IntroGridCardToneV3,
  IntroGridHeadingLayoutV3,
  IntroGridMediaAspectV3,
  IntroGridMediaCropV3,
  IntroGridNumberDisplayV3,
  IntroGridPatternV3,
  LocationActionClusterV3,
  LocationHoursDisplayV3,
  LocationLayoutV3,
  LocationStatusBadgeV3,
  MediaCaptionModeV3,
  MediaCropSetV3,
  MediaPatternV3,
  NumberedStepsDensityV3,
  NumberedStepsMediaModeV3,
  NumberedStepsNumberStyleV3,
  NumberedStepsOrientationV3,
  NumberedStepsTreatmentV3,
  OfferBandTreatmentV3,
  SectionBackgroundOptionV3,
  SectionTemplateIdV3,
  ServiceIndexTreatmentV3,
  SplitMediaSideV3,
  TeamStoryTreatmentV3
} from "./generated-site-v3-visual-controls";
import type { SiteBundle } from "./models";
import { extractOpenAiResponseText, openAiErrorMessage } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import {
  siteDirectorPlanVersionV1,
  validateSiteDirectorPlanV1,
  type SiteDirectorPlanV1,
  type SiteDirectorRuntimeV1
} from "./site-director-plan-v1";
import { slugify } from "./slug";

const presentationDefault = "default" as const;
const nonePresentationRole = "none" as const;
const copyJobFieldMaxCharsV1 = 520;

const directorPlanSchema = z.object({
  strategy: z.object({
    rationale: z.string().min(20).max(800),
    creativeDiversityDirective: z.enum([
      "differentiate_sequence",
      "differentiate_presentations",
      "differentiate_controls",
      "stay_conservative"
    ]),
    geometryDiversityDirective: z.enum([
      "use_archetype_geometry",
      "differentiate_hero_services_contact",
      "stay_conservative_with_archetype_floor"
    ])
  }),
  globalControls: z.object({
    fontPosture: z.enum(["editorial", "utility", "expressive"]),
    colorPosture: z.enum(["brand_forward", "neutral", "high_contrast", "warm"]),
    buttonSystem: z.enum(["square", "pill", "text_link", "mixed"]),
    cardChrome: z.enum(["bordered", "elevated", "editorial", "quiet"]),
    figureTreatment: z.enum(["flush", "framed", "edge_to_edge"]),
    headingTreatment: z.enum(["standard", "display", "compact"]),
    sectionRhythm: z.enum(["compact", "balanced", "spacious", "varied"])
  }),
  nav: z.object({
    items: z.array(
      z.object({
        label: z.string().min(1).max(28),
        kind: z.enum(["anchor", "page", "dropdown"]),
        target: z.string().max(80).nullable(),
        children: z.array(z.object({ label: z.string().min(1).max(28), target: z.string().min(1).max(80) })).max(10)
      })
    ).min(3).max(7),
    primaryCta: z.object({ label: z.string().min(2).max(28), target: z.string().min(1).max(100) })
  }),
  home: z.object({
    sections: z.array(
      z.object({
        id: z.string().min(1).max(40),
        role: z.string().min(1).max(40),
        templateId: z.string().min(1).max(60),
        background: z.string().min(1).max(40),
        presentationRole: z.string().min(1).max(40),
        presentationValue: z.string().min(1).max(60),
        ctaRole: z.enum(["primary", "secondary", "contextual", "none"]),
        copyJob: z.object({
          point: z.string().min(6).max(copyJobFieldMaxCharsV1),
          proofToUse: z.string().min(3).max(copyJobFieldMaxCharsV1),
          customerQuestion: z.string().min(6).max(copyJobFieldMaxCharsV1),
          slotShape: z.string().min(6).max(copyJobFieldMaxCharsV1),
          avoid: z.string().min(3).max(copyJobFieldMaxCharsV1),
          genericRisk: z.string().min(6).max(copyJobFieldMaxCharsV1)
        }),
        cardTreatment: z.enum(["standard", "comparison", "feature_cards", "service_cards", "media_top_cards", "editorial_cards"]).nullable(),
        headingLayout: z.enum(["full_width", "split_header", "side_rail", "compact_top"]).nullable(),
        numberDisplay: z.enum(["none", "subtle_index", "badge"]).nullable(),
        cardAction: z.enum(["none", "text_link", "bottom_aligned_button", "full_width_button"]).nullable(),
        mediaAspect: z.enum(["none", "square", "4x3", "16x10", "portrait"]).nullable(),
        mediaCrop: z.enum(["center", "subject", "wide", "detail_zoom"]).nullable(),
        cardTone: z.enum(["uniform", "alternating_surface", "featured_first", "dark_feature"]).nullable(),
        gridPattern: z.enum(["equal_grid", "lead_card", "mixed_masonry", "two_by_two", "compact_rows"]).nullable(),
        stepTreatment: z.enum(["stepper_vertical", "checklist_cards", "numbered_ledger"]).nullable(),
        orientation: z.enum(["vertical", "horizontal", "timeline", "cards", "ledger"]).nullable(),
        numberStyle: z.enum(["none", "small_badge", "oversized", "connector"]).nullable(),
        mediaMode: z.enum(["none", "one_feature_image", "per_step_media"]).nullable(),
        stepDensity: z.enum(["compact", "balanced", "detailed"]).nullable(),
        mediaSide: z.enum(["left", "right"]).nullable(),
        heroAlign: z.enum(["left", "center"]).nullable(),
        heroLayout: z.enum(["classic_split", "media_left", "editorial_overlap", "card_overlay", "full_bleed_masthead", "text_first"]).nullable(),
        proofPlacement: z.enum(["below_copy", "side_panel", "bottom_strip", "none"]).nullable(),
        ctaLayout: z.enum(["inline", "stacked", "button_plus_text_link", "callout_card"]).nullable(),
        mediaTreatment: z.enum(["flush", "framed", "rounded_panel", "bleed", "collage_pair"]).nullable(),
        headlineScale: z.enum(["compact", "standard", "display"]).nullable(),
        locationLayout: z.enum(["map_left_hours_right", "hours_card_over_map", "map_top_hours_below", "compact_visit_card"]).nullable(),
        statusBadge: z.enum(["none", "open_now", "closed_until", "appointment_only"]).nullable(),
        hoursDisplay: z.enum(["today_first", "full_week", "compact_week", "expandable"]).nullable(),
        actionCluster: z.enum(["directions_call", "call_first", "appointment_first"]).nullable(),
        contactLayout: z.enum(["call_first", "form_first", "visit_first", "quote_card", "appointment_card"]).nullable(),
        formComplexity: z.enum(["none", "short", "detailed"]).nullable(),
        proofSidebar: z.enum(["none", "hours", "location", "trust_facts", "response_expectation"]).nullable(),
        ctaMode: z.enum(["phone", "booking", "estimate", "directions"]).nullable(),
        mediaPattern: z.enum(["lead_left", "lead_center", "strip", "wall", "alternating_rows"]).nullable(),
        captionMode: z.enum(["none", "overlay", "below", "category_label"]).nullable(),
        cropSet: z.enum(["consistent", "mixed_editorial", "detail_zoom"]).nullable(),
        eligibilityTreatment: z.enum(["logo_strip", "icon_cards", "statement_plus_list", "split_cta"]).nullable(),
        serviceIndexTreatment: z.enum(["categorized_menu", "dropdown_preview", "featured_services_plus_all"]).nullable(),
        caseStudyTreatment: z.enum(["before_after_pair", "story_card", "media_plus_results", "three_step_case"]).nullable(),
        comparisonTreatment: z.enum(["feature_compare", "table_rows", "pros_cons_cards"]).nullable(),
        teamStoryTreatment: z.enum(["portrait_split", "founder_card", "team_strip"]).nullable(),
        offerBandTreatment: z.enum(["coupon_panel", "financing_strip", "urgent_banner", "quiet_offer"]).nullable()
      })
    ).min(5).max(12)
  }),
  servicePages: z.array(
    z.object({
      serviceId: z.string().min(1).max(80),
      slug: z.string().min(1).max(90),
      strategy: z.enum(["dedicated", "grouped", "homepage_only"]),
      antiDoorwayRationale: z.string().min(10).max(400)
    })
  ).max(8),
  assets: z.array(
    z.object({
      assetId: z.string().min(1).max(120),
      use: z.enum(["hero", "service", "proof", "gallery", "logo", "background"]),
      sectionId: z.string().min(1).max(40).nullable(),
      rationale: z.string().min(10).max(240)
    })
  ).max(10),
  qaExpectations: z.array(z.string().min(10).max(180)).min(3).max(8)
});

type RawDirectorPlan = z.infer<typeof directorPlanSchema>;

export async function createOpenAiSiteDirectorPlanV1(input: {
  bundle: SiteBundle;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  strict?: boolean;
}): Promise<SiteDirectorRuntimeV1 | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.LODESTA_SITE_DIRECTOR === "off") {
    if (input.strict) throw new Error(!apiKey ? "OPENAI_API_KEY is not configured." : "LODESTA_SITE_DIRECTOR is off.");
    return undefined;
  }

  const model = process.env.LODESTA_SITE_DIRECTOR_MODEL ?? process.env.LODESTA_DESIGN_BRIEF_MODEL ?? "gpt-5-mini";
  const catalogManifest = buildCatalogManifestV1();
  const directorInputManifest = buildDirectorInputManifestV1(input.bundle);
  const planInput = {
    catalog: compactCatalogForPrompt(catalogManifest),
    business: directorInputManifest,
    existingCopyDeck: copyDeckSummaryForPrompt(input.bundle),
    instructions: {
      purpose:
        "Choose a premium small-business website plan from the bounded catalog. The renderer is fixed; you direct sequence, presentation choices, navigation, and section jobs.",
      hardRules: [
        "Use only template ids, presentation roles, presentation values, section ids, and assets from the provided input.",
        "Never invent credentials, insurance facts, awards, warranties, years in business, prices, or reviews.",
        "You own the creative structure: choose the home page sequence, section emphasis, presentation choices, nav shape, and CTA rhythm from the catalog instead of mirroring a fixed vertical recipe.",
        "Prefer fewer strong sections over filler. Every planned section needs a concrete copy job.",
        "Each copyJob is a structured copywriter brief for that exact rendered section: point, proof/facts to use, customer question answered, intended slot shape, phrases/claims to avoid, and what would make the copy feel generic.",
        "Use presentation guidance to choose geometry by business evidence and media strength; do not rotate variants just for variety.",
        "Set geometryDiversityDirective to use_archetype_geometry or differentiate_hero_services_contact unless source constraints require staying conservative; backed hero, service_index, and contact variants should visibly affect the site.",
        "A premium plan needs section rhythm, not one repeated motif. Avoid repeating the same visual move across consecutive sections: vary background tone, card chrome, media density, CTA weight, and proof placement when the catalog allows it.",
        "When the home page has six or more sections, choose sectionRhythm 'varied' unless there is a specific evidence-based reason not to. Use 'display' headingTreatment sparingly: it should make the hero memorable, not turn every section into the same poster.",
        "Use source-safe assets deliberately: hero/background wants hero_candidate landscape assets; service/proof cards want section_candidate or detail_only assets; avoid logo_like and too_small photos except for logo use.",
        "When an asset includes analysis metadata, treat imageKind, qualityScore, usableSlots, focalPoint, cropSuitability, and warnings as authoritative for placement and crop intent.",
        "Use template option fields only when they apply to the selected template; otherwise return null. Prefer full_width service headings, unnumbered service cards, filled media crops, bottom-aligned card actions, and varied premium geometry when evidence supports it.",
        "Services should not look like process steps. Avoid numbering services; reserve step language for process.",
        "Use a services dropdown when the business has five or more services.",
        "The plan must include hero, services, faq, contact, and location when the business has address/location evidence."
      ]
    }
  };
  const planInputHash = hashDirectorManifestV1(planInput);

  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are Lodesta's AI site director.",
              "Return a strict JSON plan that chooses from the provided catalog only.",
              "You do not write CSS or copy; you choose a bounded plan that the compiler can hydrate.",
              "Make the plan visually distinctive and evidence-aware while staying grounded.",
              "Use presentationRole='none' and presentationValue='default' when a section has no role-level presentation choice.",
              "Use background='default' unless a specific non-image background from the catalog clearly improves rhythm.",
              "Section ids should use compiler ids from the manifest, including hero, facts, story, services, service_index, process, about, media, gallery, case_study, testimonials, eligibility, comparison, team, offer, faq, cta_band, location, contact, pricing."
            ].join(" ")
          }
        ]
      },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(planInput) }] }
    ],
    text: {
      verbosity: "low" as const,
      format: {
        type: "json_schema" as const,
        name: "lodesta_site_director_plan_v1",
        strict: true,
        schema: siteDirectorResponseJsonSchema(catalogManifest, directorInputManifest)
      }
    }
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: openAiRequestSignal(120_000)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) throw new Error(openAiErrorMessage(payload) ?? `HTTP ${response.status}`);
    const text = extractOpenAiResponseText(payload);
    if (!text) throw new Error("OpenAI site director response did not include output text.");
    const rawPlan = directorPlanSchema.parse(JSON.parse(text));
    const plan = normalizeRawDirectorPlanV1(rawPlan, catalogManifest);
    const validation = validateSiteDirectorPlanV1({ plan, catalogManifest, directorInputManifest });
    if (!validation.ok) {
      throw new Error(`SiteDirectorPlanV1 validation failed: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    }
    return {
      version: "site-director-runtime-v1",
      source: "model",
      model,
      catalogSchemaHash: catalogManifest.catalogSchemaHash,
      businessDirectorInputHash: directorInputManifest.businessDirectorInputHash,
      planInputHash,
      catalogManifest,
      directorInputManifest,
      plan,
      validation: {
        status: "passed",
        issues: [],
        acceptedSectionBlueprints: validation.acceptedSectionBlueprints
      }
    };
  } catch (error) {
    if (input.strict) throw error;
    console.warn("Site director plan unavailable; explicit development fallback may use legacy compiler controls.", error instanceof Error ? error.message : error);
    return undefined;
  }
}

function normalizeRawDirectorPlanV1(rawPlan: RawDirectorPlan, catalogManifest: CatalogManifestV1): SiteDirectorPlanV1 {
  const assets = rawPlan.assets.map((asset) => ({
    assetId: asset.assetId,
    use: asset.use,
    ...(asset.sectionId ? { sectionId: asset.sectionId } : {}),
    rationale: asset.rationale
  }));
  const sections = rawPlan.home.sections.map((section) => rawSectionToBlueprintV1(section, catalogManifest));
  return {
    version: siteDirectorPlanVersionV1,
    strategy: rawPlan.strategy,
    globalControls: rawPlan.globalControls,
    nav: {
      primaryCta: rawPlan.nav.primaryCta,
      items: rawPlan.nav.items.map((item) => ({
        label: item.label,
        kind: item.kind,
        ...(item.target ? { target: item.target } : {}),
        ...(item.children.length ? { children: item.children } : {})
      }))
    },
    home: {
      sections: attachDirectorAssetsToBlueprintsV1(sections, assets)
    },
    servicePages: rawPlan.servicePages.map((page) => ({
      ...page,
      slug: normalizeServicePageSlugV1(page.slug)
    })),
    assets,
    qaExpectations: rawPlan.qaExpectations
  };
}

function attachDirectorAssetsToBlueprintsV1(
  sections: SectionBlueprintV1[],
  assets: ReadonlyArray<SiteDirectorPlanV1["assets"][number]>
): SectionBlueprintV1[] {
  if (!assets.length) return sections;
  return sections.map((section) => {
    const matchingAssets = assets.filter(
      (asset) => asset.sectionId === section.id || (!asset.sectionId && sectionMatchesAssetUseV1(section, asset.use))
    );
    if (!matchingAssets.length) return section;
    const existing = section.assetRefs ?? [];
    const seen = new Set(existing.map((assetRef) => `${assetRef.slot}:${assetRef.assetId}`));
    const additions = matchingAssets
      .map((asset) => ({
        slot: slotForDirectorAssetUseV1(section, asset.use),
        assetId: asset.assetId,
        cropIntent: cropIntentForDirectorAssetUseV1(asset.use)
      }))
      .filter((assetRef) => {
        const key = `${assetRef.slot}:${assetRef.assetId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return additions.length ? { ...section, assetRefs: [...existing, ...additions].slice(0, 4) } : section;
  });
}

function sectionMatchesAssetUseV1(section: SectionBlueprintV1, use: SiteDirectorPlanV1["assets"][number]["use"]): boolean {
  switch (use) {
    case "hero":
      return section.id === "hero" || section.role === "hero";
    case "service":
      return section.id === "services" || section.role === "services";
    case "proof":
      return section.id === "facts" || section.id === "testimonials" || section.role === "proof" || section.role === "highlights";
    case "gallery":
      return section.id === "gallery" || section.id === "media" || section.role === "media";
    case "background":
      return section.id === "hero" || section.role === "hero";
    case "logo":
      return false;
  }
}

function slotForDirectorAssetUseV1(
  section: SectionBlueprintV1,
  use: SiteDirectorPlanV1["assets"][number]["use"]
): NonNullable<SectionBlueprintV1["assetRefs"]>[number]["slot"] {
  if (use === "background") return "background";
  if (use === "logo") return "logo";
  if (use === "hero" && section.templateId === "hero_statement") return "background";
  return "media";
}

function cropIntentForDirectorAssetUseV1(
  use: SiteDirectorPlanV1["assets"][number]["use"]
): NonNullable<SectionBlueprintV1["assetRefs"]>[number]["cropIntent"] {
  switch (use) {
    case "hero":
    case "background":
      return "wide";
    case "logo":
      return "center";
    case "proof":
    case "service":
      return "subject";
    case "gallery":
    default:
      return "center";
  }
}

function normalizeServicePageSlugV1(slug: string): string {
  const trimmed = slug.trim().replace(/^\/+|\/+$/g, "");
  const withoutServicesPrefix = trimmed.replace(/^services\//i, "");
  return slugify(withoutServicesPrefix || trimmed || "service");
}

function rawSectionToBlueprintV1(
  section: RawDirectorPlan["home"]["sections"][number],
  catalogManifest: CatalogManifestV1
): SectionBlueprintV1 {
  const presentation = presentationForRawSectionV1(section, catalogManifest);
  const background = backgroundForRawSectionV1(section, catalogManifest);
  const templateOptions = templateOptionsForRawSectionV1(section);
  return {
    version: sectionBlueprintVersionV1,
    source: "site_director",
    id: section.id,
    role: section.role as SectionBlueprintRoleV1,
    templateId: section.templateId as SectionTemplateIdV3,
    background,
    ...(templateOptions ? { templateOptions } : {}),
    presentation,
    ctaRole: section.ctaRole,
    copyJob: section.copyJob,
    copyJobId: copyJobSummaryForBlueprintV1(section.copyJob)
  };
}

function copyJobSummaryForBlueprintV1(copyJob: RawDirectorPlan["home"]["sections"][number]["copyJob"]) {
  return [
    copyJob.point,
    copyJob.proofToUse ? `Use: ${copyJob.proofToUse}` : "",
    copyJob.customerQuestion ? `Answer: ${copyJob.customerQuestion}` : "",
    copyJob.genericRisk ? `Avoid generic: ${copyJob.genericRisk}` : ""
  ].filter(Boolean).join(" ");
}

function templateOptionsForRawSectionV1(section: RawDirectorPlan["home"]["sections"][number]): SectionBlueprintV1["templateOptions"] | undefined {
  const options: SectionBlueprintTemplateOptionsV1 = {};
  if (section.templateId === "intro_grid") {
    if (section.cardTreatment) options.cardTreatment = section.cardTreatment as IntroGridCardTreatmentV3;
    if (section.headingLayout) options.headingLayout = section.headingLayout as IntroGridHeadingLayoutV3;
    if (section.numberDisplay) options.numberDisplay = section.numberDisplay as IntroGridNumberDisplayV3;
    if (section.cardAction) options.cardAction = section.cardAction as IntroGridCardActionV3;
    if (section.mediaAspect) options.mediaAspect = section.mediaAspect as IntroGridMediaAspectV3;
    if (section.mediaCrop) options.mediaCrop = section.mediaCrop as IntroGridMediaCropV3;
    if (section.cardTone) options.cardTone = section.cardTone as IntroGridCardToneV3;
    if (section.gridPattern) options.gridPattern = section.gridPattern as IntroGridPatternV3;
  }
  if (section.templateId === "numbered_steps") {
    if (section.stepTreatment) options.stepTreatment = section.stepTreatment as NumberedStepsTreatmentV3;
    if (section.orientation) options.orientation = section.orientation as NumberedStepsOrientationV3;
    if (section.numberStyle) options.numberStyle = section.numberStyle as NumberedStepsNumberStyleV3;
    if (section.mediaMode) options.mediaMode = section.mediaMode as NumberedStepsMediaModeV3;
    if (section.stepDensity) options.stepDensity = section.stepDensity as NumberedStepsDensityV3;
  }
  if (section.templateId === "split_media" && section.mediaSide) options.mediaSide = section.mediaSide as SplitMediaSideV3;
  if (section.templateId === "hero_statement" && section.heroAlign) options.heroAlign = section.heroAlign;
  if (section.templateId === "hero_statement" || section.templateId === "hero_split") {
    if (section.heroLayout) options.heroLayout = section.heroLayout as HeroLayoutV3;
    if (section.proofPlacement) options.proofPlacement = section.proofPlacement as HeroProofPlacementV3;
    if (section.ctaLayout) options.ctaLayout = section.ctaLayout as HeroCtaLayoutV3;
    if (section.mediaTreatment) options.mediaTreatment = section.mediaTreatment as HeroMediaTreatmentV3;
    if (section.headlineScale) options.headlineScale = section.headlineScale as HeroHeadlineScaleV3;
  }
  if (section.templateId === "location_showcase") {
    if (section.locationLayout) options.locationLayout = section.locationLayout as LocationLayoutV3;
    if (section.statusBadge) options.statusBadge = section.statusBadge as LocationStatusBadgeV3;
    if (section.hoursDisplay) options.hoursDisplay = section.hoursDisplay as LocationHoursDisplayV3;
    if (section.actionCluster) options.actionCluster = section.actionCluster as LocationActionClusterV3;
  }
  if (section.templateId === "contact_split") {
    if (section.contactLayout) options.contactLayout = section.contactLayout as ContactLayoutV3;
    if (section.formComplexity) options.formComplexity = section.formComplexity as ContactFormComplexityV3;
    if (section.proofSidebar) options.proofSidebar = section.proofSidebar as ContactProofSidebarV3;
    if (section.ctaMode) options.ctaMode = section.ctaMode as ContactCtaModeV3;
  }
  if (section.templateId === "media_mosaic") {
    if (section.mediaPattern) options.mediaPattern = section.mediaPattern as MediaPatternV3;
    if (section.captionMode) options.captionMode = section.captionMode as MediaCaptionModeV3;
    if (section.cropSet) options.cropSet = section.cropSet as MediaCropSetV3;
  }
  if (section.templateId === "eligibility_band" && section.eligibilityTreatment) options.eligibilityTreatment = section.eligibilityTreatment as EligibilityBandTreatmentV3;
  if (section.templateId === "service_index" && section.serviceIndexTreatment) options.serviceIndexTreatment = section.serviceIndexTreatment as ServiceIndexTreatmentV3;
  if (section.templateId === "case_study_preview" && section.caseStudyTreatment) options.caseStudyTreatment = section.caseStudyTreatment as CaseStudyTreatmentV3;
  if (section.templateId === "comparison_table" && section.comparisonTreatment) options.comparisonTreatment = section.comparisonTreatment as ComparisonTreatmentV3;
  if (section.templateId === "team_story" && section.teamStoryTreatment) options.teamStoryTreatment = section.teamStoryTreatment as TeamStoryTreatmentV3;
  if (section.templateId === "offer_band" && section.offerBandTreatment) options.offerBandTreatment = section.offerBandTreatment as OfferBandTreatmentV3;
  return Object.keys(options).length ? options : undefined;
}

function presentationForRawSectionV1(
  section: RawDirectorPlan["home"]["sections"][number],
  catalogManifest: CatalogManifestV1
): SectionPresentationMapV3 | undefined {
  if (section.presentationRole === nonePresentationRole || section.presentationValue === presentationDefault) return undefined;
  const allowed = catalogManifest.modelSelectablePresentationsByRole[section.presentationRole as keyof SectionPresentationMapV3] as readonly string[] | undefined;
  if (!allowed?.includes(section.presentationValue)) return undefined;
  return { [section.presentationRole]: section.presentationValue } as SectionPresentationMapV3;
}

function backgroundForRawSectionV1(
  section: RawDirectorPlan["home"]["sections"][number],
  catalogManifest: CatalogManifestV1
): SectionBackgroundOptionV3 | undefined {
  if (section.background === "default") return undefined;
  const template = catalogManifest.templates.find((entry) => entry.id === section.templateId);
  if (!template?.allowedBackgrounds.includes(section.background)) return undefined;
  const [kind, token] = section.background.split(":");
  if (kind === "solid" || kind === "gradient") return { kind, token: token as never };
  return undefined;
}

function compactCatalogForPrompt(catalogManifest: CatalogManifestV1) {
  return {
    catalogSchemaHash: catalogManifest.catalogSchemaHash,
    templates: catalogManifest.templates
      .filter((template) => template.modelSelectable)
      .map((template) => ({
        id: template.id,
        label: template.label,
        rhythmRole: template.rhythmRole,
        visualDensity: template.visualDensity,
        visualWeight: template.visualWeight,
        requiredSlots: template.requiredSlots,
        optionalSlots: template.optionalSlots,
        itemCount: template.itemCount,
        mediaCount: template.mediaCount,
        factCount: template.factCount,
        allowedBackgrounds: template.allowedBackgrounds.filter((background) => background !== "image"),
        defaultBackground: template.defaultBackground,
        templateOptions: template.templateOptions,
        responsive: template.responsive
      })),
    modelSelectablePresentationsByRole: catalogManifest.modelSelectablePresentationsByRole,
    presentationGuidanceByRole: modelSelectablePresentationGuidanceForPrompt(catalogManifest),
    sectionIds: [
      "hero",
      "facts",
      "story",
      "services",
      "service_index",
      "process",
      "about",
      "media",
      "gallery",
      "case_study",
      "testimonials",
      "eligibility",
      "comparison",
      "team",
      "offer",
      "faq",
      "cta_band",
      "location",
      "contact",
      "pricing"
    ]
  };
}

function modelSelectablePresentationGuidanceForPrompt(catalogManifest: CatalogManifestV1) {
  const entries = Object.entries(catalogManifest.modelSelectablePresentationsByRole).map(([role, presentations]) => {
    const guidance = (catalogManifest.presentationGuidanceByRole[role as keyof typeof catalogManifest.presentationGuidanceByRole] ?? {}) as Record<string, PresentationGuidanceV3>;
    return [
      role,
      Object.fromEntries(
        presentations.map((presentation) => [
          presentation,
          guidance[presentation] ?? {
            label: presentation,
            visualEffect: "Renderer-backed presentation.",
            bestFor: "Use when it best matches the section content."
          }
        ])
      )
    ];
  });
  return Object.fromEntries(entries);
}

function copyDeckSummaryForPrompt(bundle: SiteBundle) {
  const deck = bundle.presenceAssessment.generatedCopyDeck;
  if (!deck) return undefined;
  return {
    hero: deck.hero.heading,
    serviceItems: deck.serviceItems.map((item) => item.title),
    processSteps: deck.processSteps.map((item) => item.title),
    faqs: deck.faqs.map((item) => item.question)
  };
}

function siteDirectorResponseJsonSchema(catalogManifest: CatalogManifestV1, directorInputManifest: DirectorInputManifestV1) {
  const templateIds = catalogManifest.modelSelectableTemplateIds;
  const backgrounds = Array.from(new Set(catalogManifest.templates.flatMap((template) => template.allowedBackgrounds))).filter(
    (background) => background !== "image"
  );
  const presentationRoles = [nonePresentationRole, ...Object.keys(catalogManifest.modelSelectablePresentationsByRole)];
  const presentationValues = Array.from(
    new Set([presentationDefault, ...Object.values(catalogManifest.modelSelectablePresentationsByRole).flat()])
  );
  const serviceIds = directorInputManifest.services.map((service) => service.id);
  const assetIds = directorInputManifest.assets.map((asset) => asset.id);
  return {
    type: "object",
    additionalProperties: false,
    required: ["strategy", "globalControls", "nav", "home", "servicePages", "assets", "qaExpectations"],
    properties: {
      strategy: {
        type: "object",
        additionalProperties: false,
        required: ["rationale", "creativeDiversityDirective", "geometryDiversityDirective"],
        properties: {
          rationale: { type: "string" },
          creativeDiversityDirective: {
            type: "string",
            enum: ["differentiate_sequence", "differentiate_presentations", "differentiate_controls", "stay_conservative"]
          },
          geometryDiversityDirective: {
            type: "string",
            enum: ["use_archetype_geometry", "differentiate_hero_services_contact", "stay_conservative_with_archetype_floor"]
          }
        }
      },
      globalControls: {
        type: "object",
        additionalProperties: false,
        required: ["fontPosture", "colorPosture", "buttonSystem", "cardChrome", "figureTreatment", "headingTreatment", "sectionRhythm"],
        properties: {
          fontPosture: { type: "string", enum: ["editorial", "utility", "expressive"] },
          colorPosture: { type: "string", enum: ["brand_forward", "neutral", "high_contrast", "warm"] },
          buttonSystem: { type: "string", enum: ["square", "pill", "text_link", "mixed"] },
          cardChrome: { type: "string", enum: ["bordered", "elevated", "editorial", "quiet"] },
          figureTreatment: { type: "string", enum: ["flush", "framed", "edge_to_edge"] },
          headingTreatment: { type: "string", enum: ["standard", "display", "compact"] },
          sectionRhythm: { type: "string", enum: ["compact", "balanced", "spacious", "varied"] }
        }
      },
      nav: {
        type: "object",
        additionalProperties: false,
        required: ["items", "primaryCta"],
        properties: {
          items: {
            type: "array",
            minItems: 3,
            maxItems: 7,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "kind", "target", "children"],
              properties: {
                label: { type: "string" },
                kind: { type: "string", enum: ["anchor", "page", "dropdown"] },
                target: { type: ["string", "null"] },
                children: {
                  type: "array",
                  maxItems: 10,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "target"],
                    properties: {
                      label: { type: "string" },
                      target: { type: "string" }
                    }
                  }
                }
              }
            }
          },
          primaryCta: {
            type: "object",
            additionalProperties: false,
            required: ["label", "target"],
            properties: { label: { type: "string" }, target: { type: "string" } }
          }
        }
      },
      home: {
        type: "object",
        additionalProperties: false,
        required: ["sections"],
        properties: {
          sections: {
            type: "array",
            minItems: 5,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "role",
                "templateId",
                "background",
                "presentationRole",
                "presentationValue",
                "ctaRole",
                "copyJob",
                "cardTreatment",
                "headingLayout",
                "numberDisplay",
                "cardAction",
                "mediaAspect",
                "mediaCrop",
                "cardTone",
                "gridPattern",
                "stepTreatment",
                "orientation",
                "numberStyle",
                "mediaMode",
                "stepDensity",
                "mediaSide",
                "heroAlign",
                "heroLayout",
                "proofPlacement",
                "ctaLayout",
                "mediaTreatment",
                "headlineScale",
                "locationLayout",
                "statusBadge",
                "hoursDisplay",
                "actionCluster",
                "contactLayout",
                "formComplexity",
                "proofSidebar",
                "ctaMode",
                "mediaPattern",
                "captionMode",
                "cropSet",
                "eligibilityTreatment",
                "serviceIndexTreatment",
                "caseStudyTreatment",
                "comparisonTreatment",
                "teamStoryTreatment",
                "offerBandTreatment"
              ],
              properties: {
                id: {
                  type: "string",
                  enum: [
                    "hero",
                    "facts",
                    "story",
                    "services",
                    "service_index",
                    "process",
                    "about",
                    "media",
                    "gallery",
                    "case_study",
                    "testimonials",
                    "eligibility",
                    "comparison",
                    "team",
                    "offer",
                    "faq",
                    "cta_band",
                    "location",
                    "contact",
                    "pricing"
                  ]
                },
                role: {
                  type: "string",
                  enum: ["hero", "story", "highlights", "services", "process", "proof", "media", "faq", "local", "contact", "conversion", "statement", "pricing", "feature"]
                },
                templateId: { type: "string", enum: templateIds },
                background: { type: "string", enum: ["default", ...backgrounds] },
                presentationRole: { type: "string", enum: presentationRoles },
                presentationValue: { type: "string", enum: presentationValues },
                ctaRole: { type: "string", enum: ["primary", "secondary", "contextual", "none"] },
                copyJob: {
                  type: "object",
                  additionalProperties: false,
                  required: ["point", "proofToUse", "customerQuestion", "slotShape", "avoid", "genericRisk"],
                  properties: {
                    point: { type: "string", maxLength: copyJobFieldMaxCharsV1 },
                    proofToUse: { type: "string", maxLength: copyJobFieldMaxCharsV1 },
                    customerQuestion: { type: "string", maxLength: copyJobFieldMaxCharsV1 },
                    slotShape: { type: "string", maxLength: copyJobFieldMaxCharsV1 },
                    avoid: { type: "string", maxLength: copyJobFieldMaxCharsV1 },
                    genericRisk: { type: "string", maxLength: copyJobFieldMaxCharsV1 }
                  }
                },
                cardTreatment: {
                  type: ["string", "null"],
                  enum: ["standard", "comparison", "feature_cards", "service_cards", "media_top_cards", "editorial_cards", null]
                },
                headingLayout: { type: ["string", "null"], enum: ["full_width", "split_header", "side_rail", "compact_top", null] },
                numberDisplay: { type: ["string", "null"], enum: ["none", "subtle_index", "badge", null] },
                cardAction: { type: ["string", "null"], enum: ["none", "text_link", "bottom_aligned_button", "full_width_button", null] },
                mediaAspect: { type: ["string", "null"], enum: ["none", "square", "4x3", "16x10", "portrait", null] },
                mediaCrop: { type: ["string", "null"], enum: ["center", "subject", "wide", "detail_zoom", null] },
                cardTone: { type: ["string", "null"], enum: ["uniform", "alternating_surface", "featured_first", "dark_feature", null] },
                gridPattern: { type: ["string", "null"], enum: ["equal_grid", "lead_card", "mixed_masonry", "two_by_two", "compact_rows", null] },
                stepTreatment: {
                  type: ["string", "null"],
                  enum: ["stepper_vertical", "checklist_cards", "numbered_ledger", null]
                },
                orientation: { type: ["string", "null"], enum: ["vertical", "horizontal", "timeline", "cards", "ledger", null] },
                numberStyle: { type: ["string", "null"], enum: ["none", "small_badge", "oversized", "connector", null] },
                mediaMode: { type: ["string", "null"], enum: ["none", "one_feature_image", "per_step_media", null] },
                stepDensity: { type: ["string", "null"], enum: ["compact", "balanced", "detailed", null] },
                mediaSide: {
                  type: ["string", "null"],
                  enum: ["left", "right", null]
                },
                heroAlign: {
                  type: ["string", "null"],
                  enum: ["left", "center", null]
                },
                heroLayout: { type: ["string", "null"], enum: ["classic_split", "media_left", "editorial_overlap", "card_overlay", "full_bleed_masthead", "text_first", null] },
                proofPlacement: { type: ["string", "null"], enum: ["below_copy", "side_panel", "bottom_strip", "none", null] },
                ctaLayout: { type: ["string", "null"], enum: ["inline", "stacked", "button_plus_text_link", "callout_card", null] },
                mediaTreatment: { type: ["string", "null"], enum: ["flush", "framed", "rounded_panel", "bleed", "collage_pair", null] },
                headlineScale: { type: ["string", "null"], enum: ["compact", "standard", "display", null] },
                locationLayout: { type: ["string", "null"], enum: ["map_left_hours_right", "hours_card_over_map", "map_top_hours_below", "compact_visit_card", null] },
                statusBadge: { type: ["string", "null"], enum: ["none", "open_now", "closed_until", "appointment_only", null] },
                hoursDisplay: { type: ["string", "null"], enum: ["today_first", "full_week", "compact_week", "expandable", null] },
                actionCluster: { type: ["string", "null"], enum: ["directions_call", "call_first", "appointment_first", null] },
                contactLayout: { type: ["string", "null"], enum: ["call_first", "form_first", "visit_first", "quote_card", "appointment_card", null] },
                formComplexity: { type: ["string", "null"], enum: ["none", "short", "detailed", null] },
                proofSidebar: { type: ["string", "null"], enum: ["none", "hours", "location", "trust_facts", "response_expectation", null] },
                ctaMode: { type: ["string", "null"], enum: ["phone", "booking", "estimate", "directions", null] },
                mediaPattern: { type: ["string", "null"], enum: ["lead_left", "lead_center", "strip", "wall", "alternating_rows", null] },
                captionMode: { type: ["string", "null"], enum: ["none", "overlay", "below", "category_label", null] },
                cropSet: { type: ["string", "null"], enum: ["consistent", "mixed_editorial", "detail_zoom", null] },
                eligibilityTreatment: { type: ["string", "null"], enum: ["logo_strip", "icon_cards", "statement_plus_list", "split_cta", null] },
                serviceIndexTreatment: { type: ["string", "null"], enum: ["categorized_menu", "dropdown_preview", "featured_services_plus_all", null] },
                caseStudyTreatment: { type: ["string", "null"], enum: ["before_after_pair", "story_card", "media_plus_results", "three_step_case", null] },
                comparisonTreatment: { type: ["string", "null"], enum: ["feature_compare", "table_rows", "pros_cons_cards", null] },
                teamStoryTreatment: { type: ["string", "null"], enum: ["portrait_split", "founder_card", "team_strip", null] },
                offerBandTreatment: { type: ["string", "null"], enum: ["coupon_panel", "financing_strip", "urgent_banner", "quiet_offer", null] }
              }
            }
          }
        }
      },
      servicePages: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["serviceId", "slug", "strategy", "antiDoorwayRationale"],
          properties: {
            serviceId: serviceIds.length ? { type: "string", enum: serviceIds } : { type: "string", enum: ["no_services_available"] },
            slug: { type: "string" },
            strategy: { type: "string", enum: ["dedicated", "grouped", "homepage_only"] },
            antiDoorwayRationale: { type: "string" }
          }
        }
      },
      assets: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["assetId", "use", "sectionId", "rationale"],
          properties: {
            assetId: assetIds.length ? { type: "string", enum: assetIds } : { type: "string", enum: ["no_assets_available"] },
            use: { type: "string", enum: ["hero", "service", "proof", "gallery", "logo", "background"] },
            sectionId: { type: ["string", "null"] },
            rationale: { type: "string" }
          }
        }
      },
      qaExpectations: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } }
    }
  };
}
