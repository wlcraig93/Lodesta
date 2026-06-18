import type {
  GenerationQaBlocker,
  GenerationQaRepairTarget,
  GenerationQaWarning,
  GenerationScorecard,
  RenderInspectionSummary,
  RenderSectionInspection,
  VisualQaResult
} from "./models";

type FindingSource = GenerationQaRepairTarget["source"];

export function buildGenerationRepairTargets(input: {
  blockers: GenerationQaBlocker[];
  warnings: GenerationQaWarning[];
  scorecard?: GenerationScorecard;
  inspectionSummary?: RenderInspectionSummary;
  visualQa?: VisualQaResult;
}): GenerationQaRepairTarget[] {
  const targets: GenerationQaRepairTarget[] = [];
  const push = (target: GenerationQaRepairTarget) => {
    if (targets.some((item) => item.id === target.id)) return;
    targets.push(target);
  };

  for (const blocker of input.blockers) push(classifyTextFinding("blocker", blocker.id, blocker.title, blocker.detail, blocker.viewport));
  for (const warning of input.warnings) push(classifyTextFinding("warning", warning.id, warning.title, warning.detail, warning.viewport));

  for (const dimension of input.scorecard?.dimensions ?? []) {
    for (const finding of dimension.findings) {
      push(
        classifyTextFinding(
          "scorecard",
          `${dimension.id}:${finding.id}`,
          finding.title,
          finding.detail,
          finding.viewport,
          finding.severity === "blocking" || finding.severity === "major" ? "high" : "medium"
        )
      );
    }
  }

  for (const finding of input.visualQa?.findings ?? []) {
    if (finding.severity === "pass") continue;
    push(
      classifyTextFinding(
        "visual_qa",
        `visual:${finding.id}`,
        finding.title,
        finding.evidence,
        finding.viewport,
        finding.severity === "fail" ? "high" : "medium"
      )
    );
  }

  for (const section of sectionInspections(input.inspectionSummary)) {
    for (const finding of section.findings) {
      if (finding.severity === "pass") continue;
      push(
        withSection(
          classifyTextFinding(
            "render_inspection",
            `section:${section.viewport}:${section.sectionIndex}:${finding.id}`,
            finding.title,
            finding.evidence,
            section.viewport,
            finding.severity === "fail" ? "high" : "medium"
          ),
          section
        )
      );
    }
  }

  return targets.sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority));
}

function classifyTextFinding(
  source: FindingSource,
  findingId: string,
  title: string,
  detail: string,
  viewport?: GenerationQaRepairTarget["viewport"],
  priority: GenerationQaRepairTarget["priority"] = "medium"
): GenerationQaRepairTarget {
  const text = `${findingId} ${title} ${detail}`;
  const target = targetForText(text);
  return {
    id: `repair_${source}_${slug(findingId)}_${target}`,
    source,
    findingId,
    title,
    detail,
    viewport,
    target,
    activation: activationForTarget(target, text),
    priority: priorityForTarget(target, text, priority)
  };
}

function targetForText(text: string): GenerationQaRepairTarget["target"] {
  if (/media_suitability|proof[_ -]?media|proof_section_fallback|logo tile|text[_ -]?overlay|collage|composite|mismatched before|section_media_overflow/i.test(text)) {
    return "asset_crop";
  }
  if (/form_affordance|contact_fact_wrap|email.+wrap|service_index_visual_flatness|flat service|identical bordered text rows/i.test(text)) {
    return "template_geometry";
  }
  if (/service_semantic_dedupe|duplicate service bod(?:y|ies)|same body sentence|service body copy/i.test(text)) {
    return "copy_slot";
  }
  if (/repeated_section_rhythm|layout_diversity|sequence|variant|presentation|control|rhythm/i.test(text)) {
    return "director_plan";
  }
  if (/scorecard_[a-z_]+_below_gate|Quality dimension below gate|Dimension [a-z_]+ scored|rubric|calibration/i.test(text)) {
    return "score_calibration";
  }
  if (/copy_taste|tentative phrasing|weak copy|hedging/i.test(text)) {
    return "copy_slot";
  }
  if (/claim|unsupported|grounding|source|hallucination|fact|rights|policy|insurance|deductible|warranty|credential/i.test(text)) {
    return "source_evidence";
  }
  if (/low_fill|blank[_ -]?space|section_fill|occupied composition|empty fill/i.test(text)) {
    return "director_plan";
  }
  if (/section_quality/i.test(text) && !/render\.section|blank_layout|unreadable|cramped|overlap|layout|alignment|cta|below[_ -]?fold|card|button|mobile|horizontal|hero_h1|oversized|heading_overflow/i.test(text)) {
    return "director_plan";
  }
  if (/section_quality|render\.section|low_fill|cramped|overlap|layout|alignment|cta|below[_ -]?fold|card|button|mobile|horizontal|hero_h1|oversized|heading_overflow/i.test(text)) {
    return "template_geometry";
  }
  if (/copy|generic|heading|placeholder|template|internal|visitor|phrasing|taxonomy|sentence|text|content|hero_h1/i.test(text)) {
    return /overflow|line|fit|cramped|wrap/i.test(text) ? "copy_slot" : "copy_slot";
  }
  if (/image|media|crop|photo|figure|blank|loaded|upscaled|logo|background/i.test(text)) {
    return "asset_crop";
  }
  if (/score|rubric|calibration|dimension/i.test(text)) return "score_calibration";
  return "director_plan";
}

function activationForTarget(target: GenerationQaRepairTarget["target"], text: string): GenerationQaRepairTarget["activation"] {
  if (target === "copy_slot" && /copy_taste|tentative phrasing|weak copy|hedging/i.test(text)) return "telemetry_only";
  if (target === "copy_slot" || target === "asset_crop") return "live";
  if (target === "template_geometry") return "live";
  if (target === "director_plan") {
    return /repeated_section_rhythm|layout_diversity|sequence|variant|presentation|control|rhythm/i.test(text) ? "live" : "telemetry_only";
  }
  if (target === "source_evidence" || target === "score_calibration") return "telemetry_only";
  return "telemetry_only";
}

function priorityForTarget(
  target: GenerationQaRepairTarget["target"],
  text: string,
  fallback: GenerationQaRepairTarget["priority"]
): GenerationQaRepairTarget["priority"] {
  if (/blocking|fail|fatal|unsupported|policy|horizontal_overflow|contrast|broken|generic|placeholder|repeated[_ -]?media|page[_ -]?repeated[_ -]?media|primary[_ -]?cta|nav|navigation|reconciliation|media_suitability|proof[_ -]?media|form_affordance|service_semantic/i.test(text)) return "high";
  if (target === "source_evidence" || target === "template_geometry") return "high";
  if (target === "director_plan") return "medium";
  return fallback;
}

function withSection(target: GenerationQaRepairTarget, section: RenderSectionInspection): GenerationQaRepairTarget {
  const matchingFinding = section.findings.find((finding) => target.findingId.endsWith(finding.id));
  return {
    ...target,
    sectionId: section.sectionId,
    templateId: section.templateId,
    viewport: section.viewport,
    slotId: matchingFinding?.slotRole,
    copyPart: matchingFinding?.copyPart,
    itemIndex: matchingFinding?.itemIndex ?? matchingFinding?.mediaIndex ?? matchingFinding?.factIndex ?? matchingFinding?.actionIndex
  };
}

function sectionInspections(summary: RenderInspectionSummary | undefined): RenderSectionInspection[] {
  return Object.values(summary?.metricsByViewport ?? {}).flatMap((metrics) => metrics?.sectionInspections ?? []);
}

function priorityRank(priority: GenerationQaRepairTarget["priority"]) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "finding";
}
