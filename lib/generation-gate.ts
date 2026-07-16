import type {
  GenerationQaBlocker,
  GenerationQaMetadata,
  GenerationQaWarning,
  RenderInspectionResult,
  SiteBundle,
  SiteVersion,
  SiteVersionV3,
  VisualQaResult
} from "./models";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import { buildGeneratedSiteQaMetadata } from "./generated-site-qa";
import {
  detectInternalStateCopy,
  detectMalformedServiceTitle,
  findDuplicateTitles,
  isFillerFact,
  sentenceOverlapRatio,
  servicePageMaxOverlapRatio
} from "./generation-objective-signals";
import type { GeneratedSiteQualitySignalsV3 } from "./generated-site-v3-nav";

export type GenerationGateInput = {
  bundle: SiteBundle;
  version: SiteVersion;
  inspection: RenderInspectionResult;
  qaRunId: string;
  visualQa?: VisualQaResult;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
};

export function runGenerationGate(input: GenerationGateInput): GenerationQaMetadata {
  const base = buildGeneratedSiteQaMetadata({
    bundle: input.bundle,
    version: input.version,
    inspection: input.inspection,
    qaRunId: input.qaRunId,
    visualQa: input.visualQa,
    qualitySignals: input.qualitySignals
  });
  const objectiveBlockers = input.version.rendererVersion === "layout-v3"
    ? generationObjectiveBlockersV3(input.bundle, input.version)
    : [];
  const blockers = dedupeById([...base.blockers, ...objectiveBlockers, ...visualJudgeBlockers(input.visualQa)]);
  return {
    ...base,
    schemaVersion: "generation-qa-v4",
    readiness: blockers.length ? "blocked" : base.readiness,
    blockers,
    warnings: dedupeById([...base.warnings, ...visualJudgeWarnings(input.visualQa)])
  };
}

function visualJudgeBlockers(visualQa: VisualQaResult | undefined): GenerationQaBlocker[] {
  if (!visualQa) return [];
  if (visualQa.verdict === "ship") return [];
  if (visualQa.verdict === "not_evaluated") {
    return [
      {
        id: "visual_judge_unavailable",
        title: "Visual judgment was not completed",
        detail: visualQa.limitations[0] ?? visualQa.summary,
        category: "needs_operator_review",
        severity: "blocking"
      }
    ];
  }
  const topFinding = visualQa.findings.find((finding) => finding.severity === "fail") ?? visualQa.findings[0];
  return [
    {
      id: "visual_judge_needs_regen",
      title: "Visual judgment requires revision",
      detail: [
        typeof visualQa.craftScore === "number" ? `Craft score: ${visualQa.craftScore}.` : undefined,
        topFinding?.evidence ? `Top finding: ${topFinding.evidence}` : visualQa.summary
      ].filter(Boolean).join(" "),
      category: "quality_failed",
      severity: "blocking"
    }
  ];
}

function visualJudgeWarnings(visualQa: VisualQaResult | undefined): GenerationQaWarning[] {
  return (visualQa?.findings ?? []).map((finding) => ({
    id: `visual_${finding.id}`,
    title: finding.title,
    detail: finding.evidence,
    viewport: finding.viewport
  }));
}

export function generationObjectiveBlockersV3(bundle: SiteBundle, version: SiteVersionV3): GenerationQaBlocker[] {
  return [
    ...internalStateBlockers(version),
    ...serviceTitleBlockers(version),
    ...fillerFactBlockers(version),
    ...doorwayBlockers(version),
    ...sourceGroundingBlockers(bundle, version)
  ];
}

function internalStateBlockers(version: SiteVersionV3): GenerationQaBlocker[] {
  const blockers: GenerationQaBlocker[] = [];
  for (const text of allRenderedText(version)) {
    const reason = detectInternalStateCopy(text);
    if (!reason) continue;
    blockers.push({
      id: "gate_internal_state_visible",
      title: "Internal generation state is visible",
      detail: `${reason} Matched: "${truncate(text)}".`,
      category: "claim_unsupported",
      severity: "blocking"
    });
  }
  return dedupeById(blockers);
}

function serviceTitleBlockers(version: SiteVersionV3): GenerationQaBlocker[] {
  const serviceTitleGroups = collectServiceTitleGroups(version);
  const serviceTitles = serviceTitleGroups.flatMap((group) => group.titles).filter((value) => value.length <= 120);
  const malformed = serviceTitles.filter((title) => detectMalformedServiceTitle(title));
  const duplicate = serviceTitleGroups.flatMap((group) => findDuplicateTitles(group.titles));
  const blockers: GenerationQaBlocker[] = [];
  if (malformed.length) {
    blockers.push({
      id: "gate_malformed_service_title",
      title: "Malformed service title rendered",
      detail: `Service title copy must be clean customer-facing names. Examples: ${malformed.slice(0, 4).map((title) => `"${title}"`).join(", ")}.`,
      category: "quality_failed",
      severity: "blocking"
    });
  }
  if (duplicate.length) {
    blockers.push({
      id: "gate_duplicate_service_titles",
      title: "Duplicate service titles rendered",
      detail: `Duplicate service titles: ${duplicate.slice(0, 6).join(", ")}.`,
      category: "quality_failed",
      severity: "blocking"
    });
  }
  return blockers;
}

function fillerFactBlockers(version: SiteVersionV3): GenerationQaBlocker[] {
  const facts = collectFactLikePairs(version).filter((fact) => isFillerFact(fact.label, fact.value));
  if (!facts.length) return [];
  return [
    {
      id: "gate_filler_facts_visible",
      title: "Filler facts rendered",
      detail: `Filler facts rendered instead of real business proof: ${facts.slice(0, 6).map((fact) => `${fact.label}: ${fact.value}`).join("; ")}.`,
      category: "claim_unsupported",
      severity: "blocking"
    }
  ];
}

function doorwayBlockers(version: SiteVersionV3): GenerationQaBlocker[] {
  const servicePages = version.pageComposition.pages.filter((page) => page.purpose === "service_landing");
  if (servicePages.length < 2) return [];
  const blockers: GenerationQaBlocker[] = [];
  const pageTexts = servicePages.map((page) => ({
    slug: page.slug,
    texts: page.sections
      .filter((section) => isDistinctiveServicePageSection(section.id, getVisualSectionV3(section.props)?.templateId))
      .flatMap((section) => textValues(section.props))
  }));
  for (let index = 0; index < pageTexts.length; index += 1) {
    for (let other = index + 1; other < pageTexts.length; other += 1) {
      const overlap = sentenceOverlapRatio(pageTexts[index].texts, pageTexts[other].texts);
      if (overlap < servicePageMaxOverlapRatio) continue;
      blockers.push({
        id: `gate_doorway_overlap_${pageTexts[index].slug || "home"}_${pageTexts[other].slug || "home"}`.replace(/[^a-z0-9_]+/gi, "_"),
        title: "Service pages are near duplicates",
        detail: `/${pageTexts[index].slug} repeats ${(overlap * 100).toFixed(0)}% of its substantive sentences from /${pageTexts[other].slug}.`,
        category: "quality_failed",
        severity: "blocking"
      });
    }
  }
  return blockers;
}

function sourceGroundingBlockers(bundle: SiteBundle, version: SiteVersionV3): GenerationQaBlocker[] {
  const rendered = allRenderedText(version).join(" ").toLowerCase();
  const blockers: GenerationQaBlocker[] = [];
  if (bundle.businessProfile.phone && !rendered.includes(bundle.businessProfile.phone.replace(/\D/g, "").slice(-7))) {
    const digitText = rendered.replace(/\D/g, "");
    if (!digitText.includes(bundle.businessProfile.phone.replace(/\D/g, "").slice(-7))) {
      blockers.push({
        id: "gate_phone_not_rendered",
        title: "Source-backed phone number is not rendered",
        detail: "A business with a source-backed phone number must render it in the generated site.",
        category: "data_incomplete",
        severity: "blocking"
      });
    }
  }
  if (bundle.businessProfile.services.length) {
    const renderedServiceCount = bundle.businessProfile.services.filter((service) => rendered.includes(service.toLowerCase())).length;
    if (renderedServiceCount === 0) {
      blockers.push({
        id: "gate_services_not_grounded",
        title: "Source-backed services are not rendered",
        detail: "A business with extracted services must render at least one source-backed service name.",
        category: "data_incomplete",
        severity: "blocking"
      });
    }
  }
  return blockers;
}

function allRenderedText(version: SiteVersionV3) {
  return version.pageComposition.pages.flatMap((page) => page.sections.flatMap((section) => textValues(section.props)));
}

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(textValues);
  return Object.values(value).flatMap(textValues);
}

function collectServiceTitleGroups(version: SiteVersionV3) {
  return version.pageComposition.pages.flatMap((page) =>
    page.sections
      .filter((section) => section.id === "services" || section.id === "service_index" || section.id.endsWith("_related_services"))
      .map((section) => ({
        sectionId: `${page.id}:${section.id}`,
        titles: collectKeyedStrings(getVisualSectionV3(section.props)?.slots, ["title", "serviceName"])
      }))
      .filter((group) => group.titles.length)
  );
}

const sharedServicePageTemplateIds = new Set([
  "contact_split",
  "facts_cta",
  "facts_strip",
  "location_directory",
  "location_showcase",
  "numbered_steps",
  "service_area_showcase",
  "service_index",
  "side_intro_rows"
]);

function isDistinctiveServicePageSection(sectionId: string, templateId: string | undefined) {
  if (/(?:_process|_local_details|_related_services|_contact)$/.test(sectionId)) return false;
  return Boolean(templateId && !sharedServicePageTemplateIds.has(templateId));
}

function collectKeyedStrings(value: unknown, keys: string[]) {
  const matches: string[] = [];
  const wanted = new Set(keys);
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (wanted.has(key) && typeof nested === "string") matches.push(nested);
      visit(nested);
    }
  };
  visit(value);
  return matches;
}

function collectFactLikePairs(version: SiteVersionV3) {
  const pairs: Array<{ label: string; value: string }> = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.label === "string" && typeof record.value === "string") {
      pairs.push({ label: record.label, value: record.value });
    }
    Object.values(record).forEach(visit);
  };
  visit(version.pageComposition);
  return pairs;
}

function dedupeById<T extends GenerationQaBlocker | GenerationQaWarning>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function truncate(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}
