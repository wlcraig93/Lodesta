import { createHash } from "node:crypto";
import type { BrandAssessment, GenerationArtifactV2, SiteBundle, SiteVersion } from "./models";

export type BrandCueReportV2 = {
  id: string;
  cues: string[];
  colorSignals: string[];
  typographySignals: string[];
  imageStyleSignals: string[];
  toneSignals: string[];
  sourceNotes: string[];
  rightsPolicy: {
    sourceAssetsReferenceOnly: boolean;
    generatedBrandMarkAllowed: false;
    publicUseRequiresOwnerOrPolicyApproval: boolean;
  };
  confidence: number;
};

export type BrandDirectionReportV2 = {
  id: string;
  strategy: "modernized_brand" | "conversion_optimized" | "premium_redesign";
  label: string;
  rationale: string;
  designTokenHints: {
    typography: string[];
    color: string[];
    media: string[];
    header: string[];
  };
  preservationRules: string[];
  riskNotes: string[];
};

export type BrandDirectionV2Result = {
  skillId: "brand.direction";
  skillVersion: "direct-module-v1";
  versionId?: string;
  cueReport: BrandCueReportV2;
  directionReport: BrandDirectionReportV2;
  artifacts: GenerationArtifactV2[];
  summary: string;
};

export function runBrandDirectionV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): BrandDirectionV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const cueReport = brandCueReportV2(input.bundle);
  const directionReport = brandDirectionReportV2(input.bundle, cueReport, version);
  const artifacts = brandDirectionArtifactsV2({
    siteId: input.siteId ?? input.bundle.businessProfile.siteId,
    versionId: version?.id,
    cueReport,
    directionReport,
    createdAt: input.createdAt
  });

  return {
    skillId: "brand.direction",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    cueReport,
    directionReport,
    artifacts,
    summary: `${directionReport.label} brand direction prepared from ${cueReport.cues.length} cue${cueReport.cues.length === 1 ? "" : "s"}; brand mark generation remains approval-gated.`
  };
}

function brandCueReportV2(bundle: SiteBundle): BrandCueReportV2 {
  const assessment = bundle.presenceAssessment.brandAssessment;
  const business = bundle.businessProfile;
  const fallbackCues = [
    business.name,
    business.categories[0],
    business.address?.city,
    business.serviceAreas[0],
    business.logo?.alt ? `Logo reference: ${business.logo.alt}` : undefined
  ].filter((cue): cue is string => Boolean(cue));
  const sourceNotes = [
    ...(assessment?.sourceNotes ?? []),
    business.logo ? `Logo asset ${business.logo.id} is ${business.logo.rightsStatus}.` : undefined,
    business.photos.length ? `${business.photos.length} photo reference${business.photos.length === 1 ? "" : "s"} available.` : undefined
  ].filter((note): note is string => Boolean(note));

  return {
    id: `brand_cues_${business.siteId}`,
    cues: nonEmptyUnique(assessment?.cues, fallbackCues.length ? fallbackCues : [business.name]).slice(0, 12),
    colorSignals: nonEmptyUnique(assessment?.colorSignals, colorSignalsForVertical(business.vertical)).slice(0, 8),
    typographySignals: nonEmptyUnique(assessment?.typographySignals, typographySignalsForVertical(business.vertical)).slice(0, 8),
    imageStyleSignals: nonEmptyUnique(assessment?.imageStyleSignals, imageSignalsForVertical(business.vertical)).slice(0, 8),
    toneSignals: nonEmptyUnique(assessment?.toneSignals, toneSignalsForVertical(business.vertical)).slice(0, 8),
    sourceNotes: sourceNotes.length ? sourceNotes.slice(0, 10) : ["No explicit source brand assessment exists; using business profile and vertical defaults."],
    rightsPolicy: {
      sourceAssetsReferenceOnly: true,
      generatedBrandMarkAllowed: false,
      publicUseRequiresOwnerOrPolicyApproval: true
    },
    confidence: clampConfidence(assessment?.confidence ?? (fallbackCues.length >= 2 ? 0.62 : 0.42))
  };
}

function brandDirectionReportV2(bundle: SiteBundle, cues: BrandCueReportV2, version: SiteVersion | undefined): BrandDirectionReportV2 {
  const selected = bundle.presenceAssessment.designDirections?.find((direction) => direction.selected) ?? bundle.presenceAssessment.designDirections?.[0];
  const strategy = selected?.strategy ?? defaultStrategyForVertical(bundle.businessProfile.vertical);
  return {
    id: `brand_direction_${bundle.businessProfile.siteId}`,
    strategy,
    label: selected?.label ?? labelForStrategy(strategy),
    rationale:
      selected?.rationale ??
      "Use recognizable local-business cues while improving hierarchy, trust placement, responsive header behavior, and conversion clarity.",
    designTokenHints: {
      typography: version?.rendererVersion === "layout-v2"
        ? [`Current heading stack: ${version.siteDesignSystem.typography.headingFamily}`, `Scale: ${version.siteDesignSystem.typography.scale}`]
        : cues.typographySignals,
      color: version?.rendererVersion === "layout-v2"
        ? [`Primary ${version.siteDesignSystem.color.primary}`, `Accent ${version.siteDesignSystem.color.accent}`]
        : cues.colorSignals,
      media: cues.imageStyleSignals,
      header: version?.rendererVersion === "layout-v2"
        ? [`Header mode: ${version.siteDesignSystem.header.mode}`, `Mobile behavior: ${version.siteDesignSystem.header.mobileBehavior}`]
        : ["Hero-aware header, no detached banner treatment."]
    },
    preservationRules: [
      ...(brandAssessment(bundle)?.preservationRules ?? []),
      "Use source logos, favicons, and artwork as reference material only unless rights are owner-approved.",
      "Do not copy or imitate trademarked marks; generated brand marks require separate product/legal approval.",
      "Keep business name, address, phone, hours, services, and credentials tied to source-aware facts."
    ].slice(0, 10),
    riskNotes: [
      cues.confidence < 0.55 ? "Brand confidence is low; prefer restrained design tokens over strong reinterpretation." : undefined,
      bundle.businessProfile.logo?.rightsStatus === "reference_only" ? "Logo is reference-only and must not be embedded as public durable artwork." : undefined,
      "Brand direction artifacts are planning inputs; renderer changes must still pass V2 compiler, claim, policy, and visual QA."
    ].filter((note): note is string => Boolean(note))
  };
}

function brandDirectionArtifactsV2(input: {
  siteId: string;
  versionId?: string;
  cueReport: BrandCueReportV2;
  directionReport: BrandDirectionReportV2;
  createdAt?: string;
}): GenerationArtifactV2[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const cuePayload = {
    versionId: input.versionId,
    cueReport: input.cueReport
  };
  const directionPayload = {
    versionId: input.versionId,
    directionReport: input.directionReport
  };
  const cueHash = hashPayload(cuePayload);
  const directionHash = hashPayload(directionPayload);
  return [
    {
      id: `artifact_${input.siteId}_brand_cues_${cueHash.slice(0, 16)}`,
      siteId: input.siteId,
      scope: "managed_site_candidate",
      artifactType: "brand_cue_report",
      artifactVersion: "brand-cue-report-v2",
      producerId: "brand.cue-extraction",
      producerVersion: "direct-module-v1",
      sourceFactIds: [],
      contentHash: cueHash,
      payload: cuePayload,
      createdAt
    },
    {
      id: `artifact_${input.siteId}_brand_direction_${directionHash.slice(0, 16)}`,
      siteId: input.siteId,
      scope: "managed_site_candidate",
      artifactType: "brand_direction_report",
      artifactVersion: "brand-direction-report-v2",
      producerId: "brand.direction",
      producerVersion: "direct-module-v1",
      siteDesignSystemVersion: "site-design-system-v2",
      sourceFactIds: [],
      contentHash: directionHash,
      payload: directionPayload,
      createdAt
    }
  ];
}

function brandAssessment(bundle: SiteBundle): BrandAssessment | undefined {
  return bundle.presenceAssessment.brandAssessment;
}

function nonEmptyUnique(primary: string[] | undefined, fallback: string[]) {
  const values = (primary?.length ? primary : fallback).map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(values));
}

function defaultStrategyForVertical(vertical: SiteBundle["businessProfile"]["vertical"]): BrandDirectionReportV2["strategy"] {
  if (vertical === "restaurant") return "premium_redesign";
  return "modernized_brand";
}

function labelForStrategy(strategy: BrandDirectionReportV2["strategy"]) {
  if (strategy === "conversion_optimized") return "Conversion-optimized";
  if (strategy === "premium_redesign") return "Premium redesign";
  return "Modernized brand";
}

function colorSignalsForVertical(vertical: SiteBundle["businessProfile"]["vertical"]) {
  if (vertical === "restaurant") return ["warm accent", "high-contrast menu readability", "food-safe neutral backgrounds"];
  if (vertical === "auto_body") return ["confident primary color", "clean neutral surface", "high contrast for service CTAs"];
  if (vertical === "home_services") return ["utility-forward primary color", "bright service surface", "clear CTA contrast"];
  return ["local-business primary color", "neutral surface", "accessible CTA contrast"];
}

function typographySignalsForVertical(vertical: SiteBundle["businessProfile"]["vertical"]) {
  if (vertical === "restaurant") return ["editorial heading option", "scan-friendly body text", "menu-label clarity"];
  return ["strong service heading", "plain-language body text", "compact CTA labels"];
}

function imageSignalsForVertical(vertical: SiteBundle["businessProfile"]["vertical"]) {
  if (vertical === "restaurant") return ["food or interior media when rights-safe", "menu detail crops", "warm service context"];
  if (vertical === "auto_body") return ["shop, vehicle, or repair-process media when rights-safe", "wide hero crop", "proof-oriented detail shots"];
  if (vertical === "home_services") return ["crew, equipment, or service-context media when rights-safe", "bright practical crops", "local coverage context"];
  return ["rights-safe local business media", "clear subject crop", "non-stock-like context"];
}

function toneSignalsForVertical(vertical: SiteBundle["businessProfile"]["vertical"]) {
  if (vertical === "restaurant") return ["inviting", "specific", "order-ready"];
  if (vertical === "auto_body") return ["clear", "practical", "trust-building"];
  if (vertical === "home_services") return ["direct", "helpful", "service-oriented"];
  return ["clear", "local", "conversion-focused"];
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.4));
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
