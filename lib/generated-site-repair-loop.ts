import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { extractOpenAiUsage, sanitizeTelemetryPayload } from "./agent-telemetry";
import { isDynamicHoursStatus } from "./business-understanding-v2";
import { scanSensitiveClaims } from "./editor-guardrails";
import {
  type VisualMediaItemV3,
  type VisualSectionV3,
  getVisualSectionV3,
  withVisualSectionV3
} from "./generated-site-v3-visual-controls";
import { detectInternalStateCopy, findDuplicateTitles, isFillerFact } from "./generation-quality-v2";
import {
  generatedSiteVerticalQualityProfileForBusinessV1,
  mediaSuitabilityForProfileV1
} from "./generated-site-v3-quality-profiles";
import type {
  AssetReference,
  GenerationQaMetadata,
  GenerationQaRepairPatch,
  GenerationQaRepairTarget,
  SiteBundle,
  SiteVersion,
  SiteVersionV3
} from "./models";
import { elapsedOpenAiCallMs, extractOpenAiResponseText, openAiErrorMessage } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import { getOpenAiRuntimeSettings } from "./operator-settings";

export type GeneratedSiteRepairMode = "normal_generation" | "operator_premium_generation";

export function maxGeneratedSiteRepairPasses(mode: GeneratedSiteRepairMode) {
  return mode === "operator_premium_generation" ? 2 : 1;
}

export function orderedLiveRepairTargets(qa: GenerationQaMetadata): GenerationQaRepairTarget[] {
  const order: Record<GenerationQaRepairTarget["target"], number> = {
    director_plan: 0,
    asset_crop: 1,
    template_geometry: 2,
    copy_slot: 3,
    source_evidence: 9,
    score_calibration: 9
  };
  return (qa.repairTargets ?? [])
    .filter((target) => target.activation === "live")
    .sort((left, right) => order[left.target] - order[right.target] || priorityRank(right.priority) - priorityRank(left.priority));
}

export function patchWasApplied(patch: GenerationQaRepairPatch): GenerationQaRepairPatch {
  return { ...patch, status: "applied", rejectionReason: undefined };
}

export function patchWasRejected(
  patch: GenerationQaRepairPatch,
  reason: string,
  introducedBlockerIds: string[] = []
): GenerationQaRepairPatch {
  return {
    ...patch,
    status: "rejected",
    rejectionReason: reason,
    introducedBlockerIds
  };
}

export function applyMechanicalGeneratedSiteCleanupPatches(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  pass: number;
}): GenerationQaRepairPatch[] {
  if (input.version.rendererVersion !== "layout-v3") return [];
  const version = input.version as SiteVersionV3;
  const patches: GenerationQaRepairPatch[] = [];

  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = getVisualSectionV3(section.props);
      if (!visual) continue;
      const next = structuredClone(visual) as VisualSectionV3;
      const summaries: string[] = [];
      const slots = next.slots as Record<string, unknown>;

      if (dedupeItemsSlot(slots)) summaries.push("deduped repeated items");
      if (removeFillerFacts(slots)) summaries.push("removed filler facts");
      if (stripInternalEyebrow(slots)) summaries.push("removed internal eyebrow copy");
      if (dropStaleLocationHours(slots)) summaries.push("dropped stale stored hours status");

      if (!summaries.length) continue;
      section.props = withVisualSectionV3({ ...section.props }, next);
      patches.push({
        id: repairPatchId("mechanical", input.pass, section.id, patches.length),
        version: "generation-repair-patch-v1",
        pass: input.pass,
        targetId: `mechanical_cleanup_${section.id}`,
        target: "copy_slot",
        kind: "mechanical_cleanup",
        status: "applied",
        sourceFindingId: "mechanical_cleanup",
        sectionId: section.id,
        templateId: next.templateId,
        beforeSummary: "Section contained duplicated, filler, stale, or internal stored content.",
        afterSummary: summaries.join("; "),
        mutationSummary: `Repaired ${section.id} (${next.templateId}): ${summaries.join("; ")}.`
      });
    }
  }

  return patches;
}

export async function applyGeneratedSiteRepairTarget(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  target: GenerationQaRepairTarget;
  pass: number;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<GenerationQaRepairPatch | undefined> {
  if (input.version.rendererVersion !== "layout-v3") return undefined;
  if (input.target.activation !== "live") return undefined;
  if (input.target.target === "director_plan") return applyDirectorPlanRepair(input);
  if (input.target.target === "template_geometry") return applyTemplateGeometryRepair(input);
  if (input.target.target === "asset_crop") return applyAssetCropRepair(input);
  if (input.target.target === "copy_slot") return applyCopySlotRepair(input);
  return undefined;
}

function applyTemplateGeometryRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  target: GenerationQaRepairTarget;
  pass: number;
}): GenerationQaRepairPatch | undefined {
  const version = input.version as SiteVersionV3;
  const targetSection = findSection(version, input.target.sectionId) ?? firstRepairableGeometrySection(version, input.target);
  if (!targetSection) return undefined;
  const visual = getVisualSectionV3(targetSection.props);
  if (!visual) return undefined;
  const next = structuredClone(visual) as VisualSectionV3;
  const before = summarizeVisualOptions(next);
  const changed = applySafeTemplateGeometryChange(next, input.target);
  if (!changed) return undefined;
  targetSection.props = withVisualSectionV3({ ...targetSection.props }, next);
  syncDirectorPlanSectionOptions(input.bundle, targetSection.id, next);
  return {
    id: repairPatchId("geometry", input.pass, targetSection.id, 0),
    version: "generation-repair-patch-v1",
    pass: input.pass,
    targetId: input.target.id,
    target: input.target.target,
    kind: "template_geometry",
    status: "applied",
    sourceFindingId: input.target.findingId,
    sectionId: targetSection.id,
    templateId: next.templateId,
    slotId: input.target.slotId,
    copyPart: input.target.copyPart,
    itemIndex: input.target.itemIndex,
    viewport: input.target.viewport,
    beforeSummary: before,
    afterSummary: summarizeVisualOptions(next),
    mutationSummary: `Adjusted safe geometry options for ${targetSection.id} (${next.templateId}).`
  };
}

function applyDirectorPlanRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  target: GenerationQaRepairTarget;
  pass: number;
}): GenerationQaRepairPatch | undefined {
  const version = input.version as SiteVersionV3;
  const targetSection = findSection(version, input.target.sectionId) ?? firstRepairableRhythmSection(version);
  if (!targetSection) return undefined;
  const visual = getVisualSectionV3(targetSection.props);
  if (!visual) return undefined;
  const next = structuredClone(visual) as VisualSectionV3;
  const before = summarizeVisualOptions(next);
  const changed = applySafeDirectorVisualChange(next, input.target);
  if (!changed) return undefined;
  targetSection.props = withVisualSectionV3({ ...targetSection.props }, next);
  syncDirectorPlanSectionOptions(input.bundle, targetSection.id, next);
  return {
    id: repairPatchId("director", input.pass, targetSection.id, 0),
    version: "generation-repair-patch-v1",
    pass: input.pass,
    targetId: input.target.id,
    target: input.target.target,
    kind: "director_plan",
    status: "applied",
    sourceFindingId: input.target.findingId,
    sectionId: targetSection.id,
    templateId: next.templateId,
    slotId: input.target.slotId,
    copyPart: input.target.copyPart,
    itemIndex: input.target.itemIndex,
    viewport: input.target.viewport,
    beforeSummary: before,
    afterSummary: summarizeVisualOptions(next),
    mutationSummary: `Adjusted bounded director controls for ${targetSection.id} (${next.templateId}).`
  };
}

async function applyCopySlotRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  target: GenerationQaRepairTarget;
  pass: number;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<GenerationQaRepairPatch | undefined> {
  const version = input.version as SiteVersionV3;
  const located = findCopySlotRef(version, input.target);
  if (!located) return undefined;
  const original = located.ref.read();
  const repair = await createOpenAiCopySlotRepair({
    bundle: input.bundle,
    target: input.target,
    original,
    slotSummary: located.ref.summary,
    telemetry: input.telemetry,
    spanId: input.spanId
  });
  const basePatch: GenerationQaRepairPatch = {
    id: repairPatchId("copy", input.pass, located.section.id, input.target.itemIndex ?? 0),
    version: "generation-repair-patch-v1",
    pass: input.pass,
    targetId: input.target.id,
    target: input.target.target,
    kind: "copy_slot",
    status: "applied",
    sourceFindingId: input.target.findingId,
    sectionId: located.section.id,
    templateId: located.visual.templateId,
    slotId: input.target.slotId,
    copyPart: input.target.copyPart,
    itemIndex: input.target.itemIndex,
    viewport: input.target.viewport,
    beforeSummary: summarizeText(original),
    mutationSummary: `Rewrote ${located.ref.summary} for ${located.section.id}.`
  };
  if (!repair.ok) return patchWasRejected(basePatch, repair.reason);
  located.ref.write(repair.text);
  located.section.props = withVisualSectionV3({ ...located.section.props }, located.visual);
  return {
    ...basePatch,
    afterSummary: summarizeText(repair.text)
  };
}

function applyAssetCropRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  target: GenerationQaRepairTarget;
  pass: number;
}): GenerationQaRepairPatch | undefined {
  const version = input.version as SiteVersionV3;
  const targetSection = findSection(version, input.target.sectionId);
  if (!targetSection) return undefined;
  const visual = getVisualSectionV3(targetSection.props);
  if (!visual) return undefined;
  const next = structuredClone(visual) as VisualSectionV3;
  const before = summarizeVisualMedia(next);
  const changed = applySafeAssetCropChange(next, input.bundle.businessProfile.photos, input.target, input.bundle.businessProfile);
  if (!changed) return undefined;
  targetSection.props = withVisualSectionV3({ ...targetSection.props }, next);
  return {
    id: repairPatchId("asset", input.pass, targetSection.id, input.target.itemIndex ?? 0),
    version: "generation-repair-patch-v1",
    pass: input.pass,
    targetId: input.target.id,
    target: input.target.target,
    kind: "asset_crop",
    status: "applied",
    sourceFindingId: input.target.findingId,
    sectionId: targetSection.id,
    templateId: next.templateId,
    slotId: input.target.slotId,
    copyPart: input.target.copyPart,
    itemIndex: input.target.itemIndex,
    viewport: input.target.viewport,
    beforeSummary: before,
    afterSummary: summarizeVisualMedia(next),
    mutationSummary: `Adjusted source-safe media crop/selection for ${targetSection.id} (${next.templateId}).`
  };
}

type SectionRef = SiteVersionV3["pageComposition"]["pages"][number]["sections"][number];

type CopySlotRef = {
  summary: string;
  read: () => string;
  write: (value: string) => void;
};

function findCopySlotRef(version: SiteVersionV3, target: GenerationQaRepairTarget): { section: SectionRef; visual: VisualSectionV3; ref: CopySlotRef } | undefined {
  const sections = target.sectionId ? [findSection(version, target.sectionId)].filter(Boolean) as SectionRef[] : allSections(version);
  for (const section of sections) {
    const visual = getVisualSectionV3(section.props);
    if (!visual) continue;
    const refs = copyRefsForVisual(visual, target);
    const specific = refs.find((ref) => ref.summary.includes(`${target.slotId ?? ""}.`) && (!target.copyPart || ref.summary.endsWith(`.${target.copyPart}`)));
    const matching = specific ?? refs.find((ref) => isGenericOrProblemText(ref.read()) || target.detail.includes(ref.read().slice(0, 24))) ?? refs[0];
    if (matching) return { section, visual, ref: matching };
  }
  return undefined;
}

function copyRefsForVisual(visual: VisualSectionV3, target: GenerationQaRepairTarget): CopySlotRef[] {
  const refs: CopySlotRef[] = [];
  const slots = visual.slots as Record<string, unknown>;
  for (const [slotId, slot] of Object.entries(slots)) {
    if (target.slotId && slotId !== target.slotId && !(target.slotId === "text" && (slotId === "copy" || slotId === "intro"))) continue;
    collectCopyRefsFromValue(slot, slotId, target, refs);
  }
  return refs;
}

function collectCopyRefsFromValue(value: unknown, path: string, target: GenerationQaRepairTarget, refs: CopySlotRef[]) {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) {
    record.items.forEach((item, index) => {
      if (typeof target.itemIndex === "number" && target.itemIndex !== index) return;
      collectCopyRefsFromValue(item, `${path}.items.${index}`, target, refs);
    });
    return;
  }
  const fieldPreference = target.copyPart ? [target.copyPart] : ["heading", "title", "question", "body", "answer", "eyebrow"];
  for (const field of fieldPreference) {
    if (typeof record[field] !== "string") continue;
    refs.push({
      summary: `${path}.${field}`,
      read: () => String(record[field] ?? ""),
      write: (next) => {
        record[field] = next;
      }
    });
  }
}

async function createOpenAiCopySlotRepair(input: {
  bundle: SiteBundle;
  target: GenerationQaRepairTarget;
  original: string;
  slotSummary: string;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "OPENAI_API_KEY is not configured for targeted copy repair." };
  const runtime = await getOpenAiRuntimeSettings();
  const allowedFacts = businessFactsForRepair(input.bundle);
  const body = {
    model: runtime.settings.generationModel,
    reasoning: { effort: "low" },
    max_output_tokens: 700,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "Rewrite one customer-facing website copy slot for a US local business.",
              "Return schema-valid JSON only.",
              "Fix the QA finding without changing the site strategy.",
              "Use only the supplied facts. Do not invent years in business, credentials, insurance terms, pricing, guarantees, reviews, awards, discounts, or legal/medical/financial advice.",
              "Be concrete and concise. If the source facts are thin, use honest process/proof language rather than fake specificity.",
              "Do not write meta copy about the website, photos, forms, sections, visitors, or generation process."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              businessName: input.bundle.businessProfile.name,
              vertical: input.bundle.businessProfile.vertical,
              slot: input.slotSummary,
              originalText: input.original,
              finding: {
                title: input.target.title,
                detail: input.target.detail,
                viewport: input.target.viewport
              },
              allowedFacts
            })
          }
        ]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_copy_slot_repair_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["text", "grounding"],
          properties: {
            text: { type: "string", minLength: 3 },
            grounding: { type: "string", minLength: 3 }
          }
        }
      }
    }
  };
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal(90_000)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model: body.model,
      endpoint: "/v1/responses",
      operation: "generated_copy_slot_repair",
      status: response.ok ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok ? undefined : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    if (!response.ok) return { ok: false, reason: openAiErrorMessage(payload) ?? `OpenAI copy-slot repair failed with status ${response.status}.` };
    const text = extractOpenAiResponseText(payload);
    if (!text) return { ok: false, reason: "OpenAI copy-slot repair returned no output text." };
    const parsed = JSON.parse(text) as { text?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return { ok: false, reason: "OpenAI copy-slot repair returned invalid text." };
    const next = parsed.text.replace(/\s+/g, " ").trim();
    const policyIssue = copyRepairPolicyIssue(next, allowedFacts);
    if (policyIssue) return { ok: false, reason: policyIssue };
    return { ok: true, text: next };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function copyRepairPolicyIssue(text: string, allowedFacts: string) {
  const sensitive = scanSensitiveClaims(text, { path: "Targeted copy repair" });
  const blocking = sensitive.find((issue) => issue.severity === "block") ?? sensitive.find((issue) => issue.severity === "warning");
  if (blocking) return blocking.detail;
  if (isGenericOrProblemText(text)) return "Rewritten copy still matches generic or internal-copy patterns.";
  const facts = allowedFacts.toLowerCase();
  if (/\b\d{1,3}\+?\s*(years?|yrs?)\b/i.test(text) && !/\b\d{1,3}\+?\s*(years?|yrs?)\b/i.test(facts)) return "Rewritten copy invented years-in-business specificity.";
  if (/\$\s?\d|\b\d+\s?%|\bfree\b/i.test(text) && !/\$\s?\d|\b\d+\s?%|\bfree\b/i.test(facts)) return "Rewritten copy introduced pricing or offer specificity without support.";
  if (/\b(insurance|claim|deductible|drp|adjuster)\b/i.test(text) && !/\b(insurance|claim|deductible|drp|adjuster)\b/i.test(facts)) {
    return "Rewritten copy introduced insurance/claims specificity without support.";
  }
  return undefined;
}

function businessFactsForRepair(bundle: SiteBundle) {
  const business = bundle.businessProfile;
  const understanding = bundle.presenceAssessment.businessUnderstanding;
  const facts = {
    name: business.name,
    vertical: business.vertical,
    services: business.services,
    address: business.address,
    phone: business.phone,
    email: business.email,
    bookingLinks: business.bookingLinks,
    hours: business.hours,
    serviceAreas: business.serviceAreas,
    story: understanding?.businessStory,
    cleanedServices: understanding?.cleanedServices?.map((service) => service.name),
    sourceBackedFields: understanding?.factConfidence?.filter((fact) => fact.sourceBacked && fact.confidence >= 0.7).map((fact) => fact.field)
  };
  return JSON.stringify(facts);
}

function applySafeDirectorVisualChange(section: VisualSectionV3, target: GenerationQaRepairTarget) {
  let changed = false;
  const options = section.options as Record<string, unknown>;
  if (section.templateId === "intro_grid") {
    if (options.headingLayout === "side_rail") {
      options.headingLayout = "full_width";
      changed = true;
    }
    if (options.numberDisplay !== "none") {
      options.numberDisplay = "none";
      changed = true;
    }
    if (options.cardAction !== "bottom_aligned_button" && /cta|button|card|alignment|cramped|layout|rhythm|variant/i.test(`${target.title} ${target.detail}`)) {
      options.cardAction = "bottom_aligned_button";
      changed = true;
    }
  }
  if (section.templateId === "numbered_steps" && /services|service/i.test(`${target.title} ${target.detail}`)) {
    if (options.numberStyle !== "none") {
      options.numberStyle = "none";
      changed = true;
    }
  }
  if (section.templateId === "location_showcase") {
    if (options.locationLayout !== "map_top_hours_below") {
      options.locationLayout = "map_top_hours_below";
      changed = true;
    }
    if (options.hoursDisplay !== "today_first") {
      options.hoursDisplay = "today_first";
      changed = true;
    }
  }
  return changed;
}

function applySafeTemplateGeometryChange(section: VisualSectionV3, target: GenerationQaRepairTarget) {
  let changed = false;
  const options = section.options as Record<string, unknown>;
  const text = `${target.findingId} ${target.title} ${target.detail}`;

  if (section.templateId === "hero_split" || section.templateId === "hero_statement") {
    if (/h1|heading|oversized|overflow|line|fit|below[_ -]?fold|cta|primary/i.test(text)) {
      if (options.headlineScale === "display") {
        options.headlineScale = "standard";
        changed = true;
      }
      if (options.ctaLayout === "stacked" || options.ctaLayout === "callout_card") {
        options.ctaLayout = "button_plus_text_link";
        changed = true;
      }
      if (options.heroLayout === "full_bleed_masthead") {
        options.heroLayout = "card_overlay";
        changed = true;
      }
      if (options.mediaTreatment === "bleed" || options.mediaTreatment === "collage_pair") {
        options.mediaTreatment = "framed";
        changed = true;
      }
      if (options.proofPlacement === "side_panel") {
        options.proofPlacement = "bottom_strip";
        changed = true;
      }
    }
  }

  if (section.templateId === "service_index") {
    if (/service|cramped|card|text|title|layout|section_quality/i.test(text) && options.serviceIndexTreatment !== "dropdown_preview") {
      options.serviceIndexTreatment = "dropdown_preview";
      changed = true;
    }
  }

  return changed || applySafeDirectorVisualChange(section, target);
}

function syncDirectorPlanSectionOptions(bundle: SiteBundle, sectionId: string, visual: VisualSectionV3) {
  const runtime = bundle.presenceAssessment.siteDirectorPlanV1;
  if (!runtime || runtime.validation.status !== "passed") return;
  const blueprint = runtime.plan.home.sections.find((section) => section.id === sectionId || section.anchorId === visual.anchorId);
  if (!blueprint) return;
  blueprint.templateOptions = {
    ...(blueprint.templateOptions ?? {}),
    ...(visual.options as Record<string, unknown>)
  };
  const validationBlueprint = runtime.validation.acceptedSectionBlueprints.find((section) => section.id === blueprint.id);
  if (validationBlueprint) validationBlueprint.templateOptions = blueprint.templateOptions;
}

function applySafeAssetCropChange(
  section: VisualSectionV3,
  photos: AssetReference[],
  target: GenerationQaRepairTarget,
  business: SiteBundle["businessProfile"]
) {
  let changed = false;
  const options = section.options as Record<string, unknown>;
  if (section.templateId === "intro_grid") {
    if (options.mediaCrop !== "detail_zoom") {
      options.mediaCrop = "detail_zoom";
      changed = true;
    }
    if (!options.mediaAspect || options.mediaAspect === "none") {
      options.mediaAspect = "4x3";
      changed = true;
    }
  }
  const mediaItems = mediaItemsForSection(section);
  const index = typeof target.itemIndex === "number" ? target.itemIndex : 0;
  const item = mediaItems[index] ?? mediaItems[0];
  if (item && item.cropIntent !== "subject") {
    item.cropIntent = "subject";
    changed = true;
  }
  const replacement = safeReplacementPhoto(photos, item?.url, business, section);
  if (item && replacement && /blank|broken|loaded|gap|wrong|poor|image/i.test(`${target.title} ${target.detail}`)) {
    item.url = replacement.url;
    item.label = replacement.alt || item.label;
    item.cropIntent = cropIntentForAsset(replacement);
    changed = true;
  }
  return changed;
}

function mediaItemsForSection(section: VisualSectionV3): VisualMediaItemV3[] {
  const slots = section.slots as Record<string, unknown>;
  const media = slots.media;
  if (media && typeof media === "object" && Array.isArray((media as { items?: unknown }).items)) {
    return (media as { items: VisualMediaItemV3[] }).items;
  }
  const items = slots.items;
  if (items && typeof items === "object" && Array.isArray((items as { items?: unknown }).items)) {
    return (items as { items: Array<{ mediaUrl?: string; title?: string }> }).items
      .filter((item) => item.mediaUrl)
      .map((item) => ({
        url: String(item.mediaUrl),
        label: item.title ?? "Section media",
        cropIntent: "subject" as const
      }));
  }
  return [];
}

function safeReplacementPhoto(
  photos: AssetReference[],
  currentUrl: string | undefined,
  business: SiteBundle["businessProfile"],
  section: VisualSectionV3
) {
  const profile = generatedSiteVerticalQualityProfileForBusinessV1(business);
  const slot = section.anchorId === "proof" || section.templateId === "case_study_preview" || section.templateId === "proof_pair" ? "proof" : "service";
  return photos
    .filter((photo) => (photo.rightsStatus === "customer_granted" || photo.rightsStatus === "preclaim_safe") && photo.source !== "placeholder")
    .filter((photo) => !currentUrl || photo.url !== currentUrl)
    .filter((photo) => mediaSuitabilityForProfileV1({ profile, business, item: { url: photo.url, label: photo.alt }, slot }).allowed)
    .sort((left, right) => (right.analysisV1?.qualityScore ?? 0) - (left.analysisV1?.qualityScore ?? 0))[0];
}

function cropIntentForAsset(asset: AssetReference): VisualMediaItemV3["cropIntent"] {
  const crop = asset.analysisV1?.recommendedCropIntent;
  if (crop === "portrait" || crop === "wide" || crop === "center" || crop === "subject") return crop;
  return "subject";
}

function findSection(version: SiteVersionV3, sectionId?: string): SectionRef | undefined {
  if (!sectionId) return undefined;
  return allSections(version).find((section) => section.id === sectionId);
}

function allSections(version: SiteVersionV3): SectionRef[] {
  return version.pageComposition.pages.flatMap((page) => page.sections);
}

function firstRepairableRhythmSection(version: SiteVersionV3): SectionRef | undefined {
  return allSections(version).find((section) => {
    const visual = getVisualSectionV3(section.props);
    return visual?.templateId === "intro_grid" || visual?.templateId === "numbered_steps" || visual?.templateId === "location_showcase";
  });
}

function firstRepairableGeometrySection(version: SiteVersionV3, target: GenerationQaRepairTarget): SectionRef | undefined {
  const text = `${target.findingId} ${target.title} ${target.detail}`;
  return allSections(version).find((section) => {
    const visual = getVisualSectionV3(section.props);
    if (!visual) return false;
    if (/hero|h1|heading|below[_ -]?fold|primary[_ -]?cta/i.test(text)) return visual.templateId === "hero_split" || visual.templateId === "hero_statement";
    if (/service|cramped|card|section_quality/i.test(text)) return visual.templateId === "service_index" || section.id === "services";
    return visual.templateId === "hero_split" || visual.templateId === "hero_statement" || visual.templateId === "service_index";
  });
}

function summarizeVisualOptions(section: VisualSectionV3) {
  return JSON.stringify({ templateId: section.templateId, options: section.options }).slice(0, 500);
}

function summarizeVisualMedia(section: VisualSectionV3) {
  return JSON.stringify({ templateId: section.templateId, media: mediaItemsForSection(section).map((item) => ({ url: item.url, cropIntent: item.cropIntent })) }).slice(0, 500);
}

function summarizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

const genericRepairCopyPatterns = [
  /\b(this website|this site|generated|placeholder|template|visitor|section)\b/i,
  /^our approach\.?$/i,
  /^what we do\.?$/i,
  /^how it works\.?$/i,
  /^ready to get started\.?$/i,
  /^services\.?$/i,
  /\bclear next steps\b/i,
  /\bfocused help\b/i,
  /\bhelp after\b/i,
  /\bpractical support\b/i
];

function isGenericOrProblemText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return genericRepairCopyPatterns.some((pattern) => pattern.test(text));
}

function repairPatchId(kind: string, pass: number, sectionId: string, index: number) {
  return `repair_patch_${kind}_${pass}_${sectionId}_${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function priorityRank(priority: GenerationQaRepairTarget["priority"]) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function dedupeItemsSlot(slots: Record<string, unknown>): boolean {
  const itemsSlot = slots.items;
  if (!itemsSlot || typeof itemsSlot !== "object" || !("items" in itemsSlot)) return false;
  const list = (itemsSlot as { items: unknown }).items;
  if (!Array.isArray(list)) return false;
  const titles = list.map((item) => titleForItem(item) ?? "");
  if (!findDuplicateTitles(titles.filter(Boolean)).length) return false;
  const seen = new Set<string>();
  const deduped = list.filter((item) => {
    const key = (titleForItem(item) ?? "").toLowerCase().trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  (itemsSlot as { items: unknown }).items = deduped.map((item, index) =>
    item && typeof item === "object" && "meta" in (item as Record<string, unknown>)
      ? { ...(item as Record<string, unknown>), meta: String(index + 1).padStart(2, "0") }
      : item
  );
  return true;
}

function titleForItem(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (typeof record.title === "string") return record.title;
  if (typeof record.question === "string") return record.question;
  return undefined;
}

function removeFillerFacts(slots: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of ["facts", "contact"]) {
    const slot = slots[key];
    if (!slot || typeof slot !== "object") continue;
    const record = slot as Record<string, unknown>;
    const listKey = Array.isArray(record.items) ? "items" : Array.isArray(record.facts) ? "facts" : undefined;
    if (!listKey) continue;
    const list = record[listKey] as unknown[];
    const filtered = list.filter((fact) => {
      if (!fact || typeof fact !== "object") return true;
      const label = (fact as { label?: unknown }).label;
      const value = (fact as { value?: unknown }).value;
      return !(typeof label === "string" && typeof value === "string" && isFillerFact(label, value));
    });
    if (filtered.length !== list.length) {
      record[listKey] = filtered;
      changed = true;
    }
  }
  return changed;
}

function stripInternalEyebrow(slots: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of ["copy", "intro"]) {
    const slot = slots[key];
    if (!slot || typeof slot !== "object") continue;
    const record = slot as Record<string, unknown>;
    if (typeof record.eyebrow === "string" && detectInternalStateCopy(record.eyebrow)) {
      delete record.eyebrow;
      changed = true;
    }
  }
  return changed;
}

function dropStaleLocationHours(slots: Record<string, unknown>): boolean {
  const locationsSlot = slots.locations;
  if (!locationsSlot || typeof locationsSlot !== "object" || !("locations" in locationsSlot)) return false;
  const list = (locationsSlot as { locations: unknown }).locations;
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (const location of list) {
    if (!location || typeof location !== "object") continue;
    const record = location as Record<string, unknown>;
    if (!Array.isArray(record.hours)) continue;
    const filtered = record.hours.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const value = (entry as { value?: unknown }).value;
      const label = (entry as { label?: unknown }).label;
      if (typeof value !== "string") return false;
      if (isDynamicHoursStatus(value)) return false;
      if (typeof label === "string" && /^hours?[_\s-]*\d*$/i.test(label)) return false;
      return true;
    });
    if (filtered.length !== record.hours.length) {
      record.hours = filtered;
      changed = true;
    }
  }
  return changed;
}
