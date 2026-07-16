import { createHash } from "node:crypto";
import { buildDesignSystemPlannerConstraintManifestV1 } from "./design-system-planner-constraints-v1";
import { buildDesignSystemCatalogManifestV1, buildDesignSystemPlannerInputManifestV1 } from "./design-system-planner-manifest-v1";
import { assertValidSectionBlueprintV1, sectionBlueprintVersionV1, type SectionBlueprintV1 } from "./generated-site-v3-blueprint";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import { slugify } from "./slug";
import {
  siteDirectorPlanVersionV1,
  validateSiteDirectorPlanV1,
  type SiteDirectorAssetAssignmentV1,
  type SiteDirectorGlobalControlsV1,
  type SiteDirectorPlanV1,
  type SiteDirectorRuntimeV1
} from "./site-director-plan-v1";
import type { ApprovedAssetLibraryAsset } from "./asset-library";
import type { BusinessBrandExpressionV1, SiteBundle } from "./models";
import {
  assignGeneratedSiteDesignSystemV1,
  type GeneratedSiteDesignSystemV1
} from "./generated-site-design-systems-v1";
import { testimonialEvidenceItemsV1, trustEvidenceItemsV1 } from "./evidence-ledger-v1";
import {
  generatedSiteVerticalQualityProfileForBusinessV1,
  serviceSemanticGroupForProfileV1
} from "./generated-site-v3-quality-profiles";

export function createDeterministicSiteDirectorPlanV1(input: {
  bundle: SiteBundle;
  assetLibraryAssets?: ApprovedAssetLibraryAsset[];
  createdAt?: string;
}): SiteDirectorRuntimeV1 {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const catalogManifest = buildDesignSystemCatalogManifestV1();
  const plannerInputManifest = buildDesignSystemPlannerInputManifestV1(input.bundle, input.assetLibraryAssets ?? []);
  const constraintManifest = buildDesignSystemPlannerConstraintManifestV1({
    catalogManifest,
    plannerInputManifest
  });
  const designSystemAssignment = assignGeneratedSiteDesignSystemV1({
    business: input.bundle.businessProfile,
    brandApplied: Boolean(input.bundle.presenceAssessment.brandCueReport?.applied),
    hasHeroMedia: (plannerInputManifest.mediaCandidates ?? []).some((asset) => asset.allowedUses.includes("hero"))
  });
  const plan = deterministicPlanForBundle(input.bundle, plannerInputManifest, designSystemAssignment.designSystem);
  const validation = validateSiteDirectorPlanV1({
    plan,
    catalogManifest,
    plannerInputManifest,
    constraintManifest
  });
  const planInputHash = hashJson({ plan, catalogSchemaHash: catalogManifest.catalogSchemaHash, businessPlannerInputHash: plannerInputManifest.businessPlannerInputHash });
  return {
    version: "site-director-runtime-v1",
    source: "deterministic",
    model: "deterministic-site-director-plan-v1",
    designSystem: {
      id: designSystemAssignment.designSystem.id,
      label: designSystemAssignment.designSystem.label,
      rationale: designSystemAssignment.reason,
      controls: plan.globalControls
    },
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "deterministic-site-director-plan-v1",
      producerVersion: "deterministic-site-director-plan-v1",
      modelId: "deterministic",
      createdAt,
      inputs: {
        businessPlannerInputHash: plannerInputManifest.businessPlannerInputHash,
        catalogSchemaHash: catalogManifest.catalogSchemaHash,
        vertical: input.bundle.businessProfile.vertical,
        brandExpression: input.bundle.presenceAssessment.businessUnderstanding?.brandExpression,
        evidenceLedger: input.bundle.presenceAssessment.evidenceLedgerV1
      }
    }),
    catalogSchemaHash: catalogManifest.catalogSchemaHash,
    businessPlannerInputHash: plannerInputManifest.businessPlannerInputHash,
    planInputHash,
    catalogManifest,
    plannerInputManifest,
    constraintManifest,
    plan,
    validation: {
      status: validation.ok ? "passed" : "failed",
      issues: validation.issues,
      acceptedSectionBlueprints: validation.acceptedSectionBlueprints
    }
  };
}

function deterministicPlanForBundle(
  bundle: SiteBundle,
  plannerInputManifest: ReturnType<typeof buildDesignSystemPlannerInputManifestV1>,
  designSystem: GeneratedSiteDesignSystemV1
): SiteDirectorPlanV1 {
  const business = bundle.businessProfile;
  const businessUnderstanding = bundle.presenceAssessment.businessUnderstanding;
  const expression = businessUnderstanding?.brandExpression;
  const hasBusinessStory = Boolean(businessUnderstanding?.businessStory?.summary.trim());
  const services = plannerInputManifest.services;
  const hasLocation = plannerInputManifest.locations.some((location) => location.hasAddress || location.serviceAreaCount > 0);
  const hasAddress = plannerInputManifest.locations.some((location) => location.hasAddress);
  const mediaCandidates = plannerInputManifest.mediaCandidates ?? [];
  const heroAsset = mediaCandidates.find((asset) => asset.allowedUses.includes("hero"));
  const proofAsset = mediaCandidates.find((asset) => asset.proofEligible && asset.allowedUses.includes("proof"));
  const distinctProofAsset = proofAsset?.id !== heroAsset?.id ? proofAsset : undefined;
  const contextAsset = mediaCandidates.find(
    (asset) => asset.id !== heroAsset?.id && !asset.proofEligible && asset.allowedUses.includes("context")
  );
  const trustEvidence = trustEvidenceItemsV1(bundle.presenceAssessment.evidenceLedgerV1);
  const testimonialEvidence = testimonialEvidenceItemsV1(bundle.presenceAssessment.evidenceLedgerV1);
  const renderedTestimonialEvidence = testimonialEvidence.slice(0, 3);
  const semanticServiceCount = semanticServiceCountForPlanV1(bundle, services.map((service) => service.label));
  const serviceTemplate = services.length >= 6 && semanticServiceCount >= 4
    ? designSystem.sectionPolicy.largeServicesTemplate
    : designSystem.sectionPolicy.compactServicesTemplate;
  const sections: SectionBlueprintV1[] = [
    blueprint({
      id: "hero",
      role: "hero",
      templateId: designSystem.sectionPolicy.heroTemplate,
      anchorId: "top",
      ctaRole: "primary",
      templateOptions: {
        heroLayout: designSystem.hero.heroLayout,
        proofPlacement: trustEvidence.length || testimonialEvidence.length ? designSystem.hero.proofPlacement : "none",
        ctaLayout: designSystem.hero.ctaLayout,
        mediaTreatment: designSystem.hero.mediaTreatment,
        headlineScale: designSystem.hero.headlineScale
      },
      copyJobId: "Lead with the business-specific promise, primary service fit, and the safest contact path."
    })
  ];
  if (trustEvidence.length >= 1) {
    sections.push(
      blueprint({
        id: "trust",
        role: "proof",
        templateId: "eligibility_band",
        anchorId: "proof",
        ctaRole: "none",
        copyJob: {
          point: "Present the strongest exact source-backed trust claims without broadening their meaning.",
          proofToUse: trustEvidence.slice(0, 4).map((item) => `${item.kind}: ${item.value.text}`).join(" | "),
          customerQuestion: "What concrete evidence makes this shop credible before I call?",
          slotShape: "Two to four short evidence facts with exact source wording.",
          avoid: "Do not turn credentials, warranties, insurance support, longevity, awards, or offers into stronger claims than the source text.",
          genericRisk: "Generic trust language would hide the source evidence and make the section interchangeable."
        },
        copyJobId: "Use exact source-backed credentials, warranty, insurance, longevity, award, or offer evidence as a compact trust band."
      })
    );
  }
  if (services.length) {
    sections.push(
      blueprint({
        id: "services",
        role: "services",
        templateId: serviceTemplate,
        anchorId: "services",
        ctaRole: "contextual",
        templateOptions: serviceTemplate === designSystem.sectionPolicy.largeServicesTemplate
          ? { serviceIndexTreatment: designSystem.services.largeFlatServiceTreatment }
          : designSystem.sectionPolicy.compactServicesTemplate === "intro_grid"
            ? { cardTreatment: "service_cards", headingLayout: "split_header", cardAction: "text_link" }
            : undefined,
        copyJobId: "Name the source-backed services plainly and make each card answer when that service is the right fit.",
        slotCounts: { items: serviceItemCountForTemplate(serviceTemplate, semanticServiceCount) }
      })
    );
  }
  sections.push(
    blueprint({
      id: "process",
      role: "process",
      templateId: "numbered_steps",
      anchorId: "process",
      ctaRole: "contextual",
      templateOptions:
        designSystem.id === "precision_shop_editorial"
          ? { stepTreatment: "numbered_ledger", orientation: "ledger", numberStyle: "oversized", stepDensity: "compact" }
          : { stepTreatment: "stepper_vertical", orientation: "vertical", numberStyle: "small_badge", stepDensity: "balanced" },
      copyJobId: "Explain the concrete customer decision path without repeating the service taxonomy."
    })
  );
  if (hasBusinessStory) {
    sections.push(
      blueprint({
        id: "about",
        role: "story",
        templateId: contextAsset ? "split_media" : "editorial_statement",
        anchorId: "about",
        ctaRole: "secondary",
        templateOptions: contextAsset ? { mediaSide: "right" } : undefined,
        assetRefs: contextAsset ? [{ slot: "media" as const, assetId: contextAsset.id, cropIntent: "subject" as const }] : undefined,
        copyJobId: "Tell the source-backed business story with specific history, ownership, or local-root details and no invented claims."
      })
    );
  }
  if (distinctProofAsset && designSystem.sectionPolicy.orderedSectionIds.includes("media")) {
    sections.push(
      blueprint({
        id: "media",
        role: "proof",
        templateId: "split_media",
        anchorId: "work",
        ctaRole: "none",
        templateOptions: { mediaSide: "right" },
        assetRefs: [{ slot: "media" as const, assetId: distinctProofAsset.id, cropIntent: "subject" as const }],
        copyJobId: "Use the selected proof-capable media to explain visible work quality without inventing before/after claims."
      })
    );
  }
  if (testimonialEvidence.length >= 2) {
    sections.push(
      blueprint({
        id: "testimonials",
        role: "proof",
        templateId: "quote_wall",
        anchorId: "reviews",
        ctaRole: "none",
        copyJob: {
          point: "Show exact first-party customer comments with their retained attribution.",
          proofToUse: renderedTestimonialEvidence.map((item) => item.id).join(", "),
          customerQuestion: "What have actual customers said about the work and service?",
          slotShape: "Two or three exact quotes with retained attribution.",
          avoid: "Do not paraphrase testimonials or invent customer identities, ratings, or outcomes.",
          genericRisk: "Summarized praise would be less credible than the exact source-backed quotes."
        },
        copyJobId: "Render exact source-backed first-party testimonials with page-level provenance.",
        slotCounts: { items: renderedTestimonialEvidence.length }
      })
    );
  }
  if (hasLocation) {
    sections.push(
      blueprint({
        id: "location",
        role: "local",
        templateId: hasAddress ? "location_showcase" : "service_area_showcase",
        anchorId: "location",
        ctaRole: "secondary",
        templateOptions: hasAddress
          ? { locationLayout: "map_left_hours_right", statusBadge: "open_now", hoursDisplay: "full_week", actionCluster: "directions_call" }
          : undefined,
        copyJobId: hasAddress
          ? "Show the address, hours context, and practical visit path from verified facts."
          : "Describe the verified service-area coverage without implying a physical storefront."
      })
    );
  }
  sections.push(
    blueprint({
      id: "faq",
      role: "faq",
      templateId: "faq_list",
      anchorId: "faq",
      ctaRole: "none",
      copyJobId: "Answer real pre-contact customer questions about the services, fit, timing, and next step."
    }),
    blueprint({
      id: "contact",
      role: "contact",
      templateId: "contact_split",
      anchorId: "contact",
      ctaRole: "primary",
      templateOptions: {
        contactLayout: designSystem.contact.contactLayout,
        formComplexity: business.vertical === "auto_body"
          ? "short"
          : designSystem.contact.contactLayout === "call_first" || designSystem.contact.contactLayout === "visit_first"
            ? "none"
            : "short",
        proofSidebar: trustEvidence.length || testimonialEvidence.length ? "trust_facts" : hasAddress ? "location" : "response_expectation",
        ctaMode: business.vertical === "auto_body"
          ? "estimate"
          : businessUnderstanding?.primaryConversionGoal === "booking_first"
            ? "booking"
            : businessUnderstanding?.primaryConversionGoal === "visit_first"
              ? "directions"
              : "phone"
      },
      copyJobId: "Close with the verified contact facts and the primary conversion path."
    })
  );

  const sectionOrder = new Map(designSystem.sectionPolicy.orderedSectionIds.map((id, index) => [id, index]));
  const orderedSections = sections
    .filter((section) => sectionOrder.has(section.id as (typeof designSystem.sectionPolicy.orderedSectionIds)[number]))
    .sort((left, right) => (sectionOrder.get(left.id as (typeof designSystem.sectionPolicy.orderedSectionIds)[number]) ?? 99) - (sectionOrder.get(right.id as (typeof designSystem.sectionPolicy.orderedSectionIds)[number]) ?? 99));

  return {
    version: siteDirectorPlanVersionV1,
    strategy: {
      rationale: `Deterministic design-system plan for ${business.vertical}: sections are selected from verified facts, media availability, and bounded brand expression.`
    },
    globalControls: globalControlsForDesignSystem(designSystem, expression),
    nav: {
      items: [
        ...(services.length ? [{ label: "Services", kind: "anchor" as const, target: "#services" }] : []),
        ...(hasLocation ? [{ label: hasAddress ? "Location" : "Service area", kind: "anchor" as const, target: "#location" }] : []),
        { label: "FAQ", kind: "anchor", target: "#faq" }
      ],
      primaryCta: business.vertical === "auto_body"
        ? { label: "Request an estimate", target: "#contact" }
        : { label: business.phone ? "Call now" : "Contact", target: business.phone ? `tel:${business.phone.replace(/[^\d+]/g, "")}` : "#contact" }
    },
    home: { sections: orderedSections },
    servicePages: servicePageProposals(bundle, services),
    assets: assetAssignments(heroAsset?.id, orderedSections.some((section) => section.id === "media") ? distinctProofAsset?.id : undefined),
    qaExpectations: [
      "No placeholder or internal-state copy.",
      "Every rendered service title is source-backed and customer-facing.",
      "Media is used only in slots allowed by asset analysis and media-floor policy."
    ]
  };
}

function serviceItemCountForTemplate(
  templateId: GeneratedSiteDesignSystemV1["sectionPolicy"]["compactServicesTemplate" | "largeServicesTemplate"],
  serviceCount: number
) {
  if (templateId === "service_index") return Math.min(Math.max(serviceCount, 4), 12);
  if (templateId === "side_intro_rows") return Math.min(Math.max(serviceCount, 3), 4);
  return Math.min(Math.max(serviceCount, 3), 6);
}

function semanticServiceCountForPlanV1(bundle: SiteBundle, services: string[]) {
  const profile = generatedSiteVerticalQualityProfileForBusinessV1(bundle.businessProfile);
  return new Set(
    services.map((service) => serviceSemanticGroupForProfileV1(profile, service)?.id ?? service.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
  ).size;
}

function servicePageProposals(
  bundle: SiteBundle,
  services: ReturnType<typeof buildDesignSystemPlannerInputManifestV1>["services"]
) {
  const evidenceByServiceId = new Map(
    services.map((service) => [service.id, dedicatedServiceEvidenceScore(bundle, service.label)])
  );
  const dedicatedServiceIds = new Set(
    [...services]
      .filter((service) => (evidenceByServiceId.get(service.id) ?? 0) >= 5)
      .sort((left, right) =>
        (evidenceByServiceId.get(right.id) ?? 0) - (evidenceByServiceId.get(left.id) ?? 0)
      )
      .slice(0, 4)
      .map((service) => service.id)
  );
  return services.map((service) => {
    const dedicated = dedicatedServiceIds.has(service.id);
    return {
      serviceId: service.id,
      slug: slugify(service.label),
      strategy: dedicated ? "dedicated" as const : "homepage_only" as const,
      antiDoorwayRationale: dedicated
        ? `Dedicated page is allowed because "${service.label}" has substantive source text beyond its service name.`
        : `Homepage-only because "${service.label}" does not have enough distinct source detail for a useful standalone page.`
    };
  });
}

function dedicatedServiceEvidenceScore(bundle: SiteBundle, serviceLabel: string) {
  const normalizedLabel = serviceLabel.toLowerCase().trim();
  const cleanedService = bundle.presenceAssessment.businessUnderstanding?.cleanedServices.find((service) => {
    const name = service.name.toLowerCase().trim();
    return name === normalizedLabel || name.includes(normalizedLabel) || normalizedLabel.includes(name);
  });
  if (!cleanedService || cleanedService.confidence < 0.7) return 0;
  const labelWords = new Set(normalizedLabel.split(/[^a-z0-9]+/).filter(Boolean));
  const evidenceWords = cleanedService.sourceText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !labelWords.has(word));
  return new Set(evidenceWords).size;
}

function globalControlsForDesignSystem(
  designSystem: GeneratedSiteDesignSystemV1,
  expression: BusinessBrandExpressionV1 | undefined
): SiteDirectorGlobalControlsV1 {
  const controls = designSystem.chassis.controls;
  return {
    fontPosture: expression?.fontPosture === "editorial" || expression?.fontPosture === "premium"
      ? "editorial"
      : expression?.fontPosture === "rounded"
        ? "expressive"
        : "utility",
    colorPosture: designSystem.chassis.colorSystem === "warm_neighborhood"
      ? "warm"
      : designSystem.chassis.colorSystem === "high_contrast_neutral" || designSystem.chassis.colorSystem === "auto_body_premium_no_media"
        ? "high_contrast"
        : expression?.paletteSeed.strategy === "logo_color"
          ? "brand_forward"
          : "neutral",
    buttonSystem: designSystem.chassis.buttonSystem === "rounded_primary"
      ? "pill"
      : designSystem.chassis.buttonSystem === "understated"
        ? "text_link"
        : designSystem.chassis.buttonSystem === "high_contrast_primary"
          ? "square"
          : "mixed",
    cardChrome: designSystem.chassis.cardTreatment === "soft_surface"
      ? "elevated"
      : designSystem.chassis.cardTreatment === "borderless"
        ? "quiet"
        : designSystem.chassis.cardTreatment === "hairline_surface"
          ? "bordered"
          : "editorial",
    figureTreatment: controls.figureTreatment === "framed_shadow" ? "framed" : "flush",
    headingTreatment: expression?.fontPosture === "condensed" || expression?.mood === "technical" ? "compact" : expression?.mood === "bold" ? "display" : "standard",
    sectionRhythm: designSystem.chassis.spacingRhythm === "compact"
      ? "compact"
      : designSystem.chassis.spacingRhythm === "cinematic"
        ? "varied"
        : designSystem.chassis.spacingRhythm === "spacious"
          ? "spacious"
          : "balanced"
  };
}

function blueprint(input: Omit<SectionBlueprintV1, "version" | "source">): SectionBlueprintV1 {
  return assertValidSectionBlueprintV1({ ...input, version: sectionBlueprintVersionV1, source: "deterministic" });
}

function assetAssignments(heroAssetId: string | undefined, proofAssetId: string | undefined): SiteDirectorAssetAssignmentV1[] {
  const assignments: SiteDirectorAssetAssignmentV1[] = [];
  if (heroAssetId) assignments.push({ assetId: heroAssetId, use: "hero", sectionId: "hero", rationale: "Highest-ranked safe media candidate anchors the hero." });
  if (proofAssetId && proofAssetId !== heroAssetId) assignments.push({ assetId: proofAssetId, use: "proof", sectionId: "media", rationale: "Proof-eligible media supports the mid-page proof section." });
  return assignments;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
