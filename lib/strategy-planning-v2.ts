import { createHash } from "node:crypto";
import type { ConversionGoal, GenerationArtifactV2, SiteBundle, SiteVersion, Vertical } from "./models";

export type VerticalClassificationReportV2 = {
  selectedVertical: Vertical;
  confidence: number;
  evidence: string[];
  source: "business_profile" | "compiled_blueprint" | "fallback";
};

export type ConversionPathReportV2 = {
  primaryGoal: ConversionGoal;
  primaryActions: Array<{ label: string; href: string; source: string }>;
  rationale: string;
};

export type InformationArchitectureReportV2 = {
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    sections: Array<{ id: string; family: string; role: string }>;
  }>;
  layoutDiversity: string[];
  notes: string[];
};

export type StrategyPlanningV2Result = {
  skillId: "strategy.information-architecture";
  skillVersion: "direct-module-v1";
  versionId?: string;
  verticalClassification: VerticalClassificationReportV2;
  conversionPath: ConversionPathReportV2;
  informationArchitecture: InformationArchitectureReportV2;
  artifacts: GenerationArtifactV2[];
  summary: string;
};

export function runStrategyPlanningAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): StrategyPlanningV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const verticalClassification = classifyVertical(input.bundle, version);
  const conversionPath = conversionPathFor(input.bundle, version);
  const informationArchitecture = informationArchitectureFor(version);
  const artifacts = strategyArtifacts({
    siteId: input.siteId ?? input.bundle.businessProfile.siteId,
    versionId: version?.id,
    verticalClassification,
    conversionPath,
    informationArchitecture,
    createdAt: input.createdAt
  });

  return {
    skillId: "strategy.information-architecture",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    verticalClassification,
    conversionPath,
    informationArchitecture,
    artifacts,
    summary: `${verticalClassification.selectedVertical} strategy with ${informationArchitecture.pages.length} page${informationArchitecture.pages.length === 1 ? "" : "s"} and ${conversionPath.primaryActions.length} primary action${conversionPath.primaryActions.length === 1 ? "" : "s"}.`
  };
}

function classifyVertical(bundle: SiteBundle, version: SiteVersion | undefined): VerticalClassificationReportV2 {
  if (version?.rendererVersion === "layout-v2") {
    return {
      selectedVertical: version.blueprint.vertical,
      confidence: 0.92,
      evidence: [`Blueprint vertical: ${version.blueprint.vertical}`, ...bundle.businessProfile.categories.slice(0, 3), ...bundle.businessProfile.services.slice(0, 3)],
      source: "compiled_blueprint"
    };
  }
  return {
    selectedVertical: bundle.businessProfile.vertical,
    confidence: bundle.businessProfile.categories.length || bundle.businessProfile.services.length ? 0.78 : 0.5,
    evidence: [...bundle.businessProfile.categories.slice(0, 3), ...bundle.businessProfile.services.slice(0, 3)],
    source: "business_profile"
  };
}

function conversionPathFor(bundle: SiteBundle, version: SiteVersion | undefined): ConversionPathReportV2 {
  const primaryGoal = version?.rendererVersion === "layout-v2" ? version.blueprint.primaryGoal : goalForVertical(bundle.businessProfile.vertical);
  const primaryActions = primaryActionsForVersion(bundle, version);
  return {
    primaryGoal,
    primaryActions,
    rationale: `Use ${primaryGoal} as the primary conversion path because it matches the business vertical and available contact/order facts.`
  };
}

function informationArchitectureFor(version: SiteVersion | undefined): InformationArchitectureReportV2 {
  if (version?.rendererVersion === "layout-v2") {
    const pages = version.compiledPages.map((page) => ({
      id: page.id,
      slug: page.slug,
      title: page.title,
      sections: page.sections.map((section) => ({
        id: section.id,
        family: section.family,
        role: section.family.startsWith("hero.") ? "primary" : section.family === "contact.location_hours" ? "contact" : section.family.startsWith("cta.") ? "conversion" : "supporting"
      }))
    }));
    return {
      pages,
      layoutDiversity: Array.from(new Set(pages.flatMap((page) => page.sections.map((section) => section.family.split(".")[0] ?? section.family)))),
      notes: ["Compiled V2 pages are canonical for public rendering."]
    };
  }
  const pages = version?.pages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    sections: page.layoutSections.map((section) => ({ id: section.id, family: section.preset, role: section.kind }))
  })) ?? [];
  return {
    pages,
    layoutDiversity: Array.from(new Set(pages.flatMap((page) => page.sections.map((section) => section.role)))),
    notes: ["Legacy pages are projected through layout sections."]
  };
}

function strategyArtifacts(input: {
  siteId: string;
  versionId?: string;
  verticalClassification: VerticalClassificationReportV2;
  conversionPath: ConversionPathReportV2;
  informationArchitecture: InformationArchitectureReportV2;
  createdAt?: string;
}): GenerationArtifactV2[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return [
    strategyArtifact(input.siteId, "vertical_classification_report", "strategy.vertical-classifier", "vertical-classification-report-v2", { versionId: input.versionId, verticalClassification: input.verticalClassification }, createdAt),
    strategyArtifact(input.siteId, "conversion_path_report", "strategy.conversion-path", "conversion-path-report-v2", { versionId: input.versionId, conversionPath: input.conversionPath }, createdAt),
    strategyArtifact(input.siteId, "information_architecture_report", "strategy.information-architecture", "information-architecture-report-v2", { versionId: input.versionId, informationArchitecture: input.informationArchitecture }, createdAt)
  ];
}

function strategyArtifact(
  siteId: string,
  artifactType: GenerationArtifactV2["artifactType"],
  producerId: string,
  artifactVersion: string,
  payload: Record<string, unknown>,
  createdAt: string
): GenerationArtifactV2 {
  const contentHash = hashPayload(payload);
  return {
    id: `artifact_${siteId}_${artifactType}_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "managed_site_candidate",
    artifactType,
    artifactVersion,
    producerId,
    producerVersion: "direct-module-v1",
    sourceFactIds: [],
    contentHash,
    payload,
    createdAt
  };
}

function goalForVertical(vertical: Vertical): ConversionGoal {
  if (vertical === "restaurant") return "order_clicks";
  if (vertical === "home_services") return "forms";
  return "calls";
}

function primaryActionsForVersion(bundle: SiteBundle, version: SiteVersion | undefined) {
  const actions: Array<{ label: string; href: string; source: string }> = [];
  if (version?.rendererVersion === "layout-v2") {
    for (const page of version.compiledPages) {
      for (const section of page.sections) {
        for (const cta of ctasInValue(section.props)) actions.push({ ...cta, source: section.id });
      }
    }
  }
  if (!actions.length && bundle.businessProfile.phone) actions.push({ label: "Call", href: `tel:${bundle.businessProfile.phone}`, source: "business_profile" });
  if (!actions.length && bundle.businessProfile.orderingLinks[0]) actions.push({ label: "Order", href: bundle.businessProfile.orderingLinks[0], source: "business_profile" });
  return actions.slice(0, 5);
}

function ctasInValue(value: unknown): Array<{ label: string; href: string }> {
  if (Array.isArray(value)) return value.flatMap(ctasInValue);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const own = typeof record.label === "string" && typeof record.href === "string" ? [{ label: record.label, href: record.href }] : [];
  return [...own, ...Object.values(record).flatMap(ctasInValue)];
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
