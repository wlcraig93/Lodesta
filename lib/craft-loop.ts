import { z } from "zod";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import type { GenerationQaMetadata, SiteBundle, SiteVersion } from "./models";
import {
  compatiblePresentationsForRoleV3,
  resolveDesignControlsV3,
  validateDesignControlsV3,
  validateSectionPresentationMapV3,
  type ArtDirectionSectionRoleV3,
  type DesignControlsV3
} from "./generated-site-v3-art-direction-catalog";
import { inspectGeneratedSiteBundleRender } from "./generated-site-render-inspection";
import { buildGenerationScorecard } from "./generation-scorecard";
import { createOpenAiVisualQa } from "./visual-qa";
import { extractOpenAiResponseText, openAiErrorMessage } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";

/**
 * Shadow craft loop, Tier-1 (next-level plan, Part 3).
 *
 * Generate → critique → mutate → re-render → re-score, with every mutation a
 * typed IR action — never freeform. SHADOW mode: the loop runs on a CLONE of
 * the version, records what it would have done and whether the result clears
 * every hard gate, and never alters the served candidate. Promotion to live
 * follows the scorecard promotion contract.
 *
 * Tier-1 vocabulary: swap_presentation, adjust_profile_control. The
 * change_hero_variant action is declared but its precondition (target hero
 * satisfiable with the same approved slots and media) currently always fails
 * post-compile, so it records precondition_failed rather than mutating —
 * hero variation requires a recompile path that lands with Tier 2.
 *
 * Hygiene (from the plan): mutation ids, allowed-target paths, before/after
 * diffs, max mutations per iteration, oscillation detection, replay
 * snapshots, and the repair guard verbatim: never mutate published,
 * owner-approved, or owner-touched versions.
 */

const maxMutationsPerIteration = 3;
const maxIterations = 2;

const mutationSchema = z.object({
  action: z.enum(["swap_presentation", "adjust_profile_control", "change_hero_variant"]),
  /** swap_presentation: section role. adjust_profile_control: control key. */
  target: z.string().min(1).max(60),
  value: z.string().min(1).max(60),
  rationale: z.string().min(1).max(300),
  expectedDimension: z.enum(["visual_design", "brand_identity", "content_quality", "mobile_experience"])
});

const criticSchema = z.object({
  mutations: z.array(mutationSchema).max(maxMutationsPerIteration)
});

export type CraftMutation = z.infer<typeof mutationSchema> & {
  id: string;
  applied: boolean;
  note: string;
  before?: string;
  after?: string;
};

export type CraftLoopIteration = {
  index: number;
  mutations: CraftMutation[];
  blockersAfter: number;
  craftBefore?: number;
  craftAfter?: number;
  wouldAccept: boolean;
};

export type CraftLoopReport = {
  version: "craft-loop-v1";
  mode: "shadow";
  skipped?: string;
  iterations: CraftLoopIteration[];
  replay: {
    qaRunIds: string[];
    criticModel?: string;
    artDirectionBeforeHash: string;
  };
  evaluatedAt: string;
};

const controlKeys: Array<keyof DesignControlsV3> = [
  "eyebrowTreatment",
  "cardChrome",
  "figureTreatment",
  "headingCase",
  "badgeStyle",
  "factHighlight",
  "headerSurface"
];

const controlValueUniverse: Record<keyof DesignControlsV3, string[]> = {
  eyebrowTreatment: ["plain_caps", "accent_bar_chip", "filled_kicker"],
  cardChrome: ["bordered", "elevated", "accent_underline"],
  figureTreatment: ["flush", "framed_shadow"],
  headingCase: ["standard", "display_upper"],
  badgeStyle: ["square", "rounded", "tilted"],
  factHighlight: ["plain", "accent_value"],
  headerSurface: ["neutral", "brand_bar"]
};

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16);
}

async function criticMutations(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  qa: GenerationQaMetadata;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<{ mutations: z.infer<typeof mutationSchema>[]; model?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { mutations: [] };
  const model = process.env.LODESTA_CRAFT_LOOP_MODEL ?? "gpt-5-mini";
  const artDirection = (input.version as { artDirection?: Record<string, unknown> }).artDirection ?? {};
  const context = {
    craft: input.qa.qualityReport?.craft,
    visualFindings: (input.qa.visualQa?.findings ?? []).slice(0, 10).map((finding) => ({
      severity: finding.severity,
      category: finding.defectCategory,
      evidence: finding.evidence.slice(0, 160)
    })),
    artDirection: {
      controls: (artDirection as { controls?: unknown }).controls,
      designProfile: (artDirection as { designProfile?: unknown }).designProfile,
      sectionPresentation: (artDirection as { sectionPresentation?: unknown }).sectionPresentation
    },
    vocabulary: {
      adjust_profile_control: controlValueUniverse,
      swap_presentation: compatiblePresentationsForRoleV3
    }
  };
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are a design critic for generated small-business websites. Given QA findings and the current art direction, propose at most",
              String(maxMutationsPerIteration),
              "typed mutations that would most improve visual design. Only use actions/targets/values from the provided vocabulary.",
              "Propose nothing when the design already reads well — an empty list is a valid answer."
            ].join(" ")
          }
        ]
      },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(context) }] }
    ],
    text: {
      verbosity: "low" as const,
      format: {
        type: "json_schema" as const,
        name: "lodesta_craft_mutations",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["mutations"],
          properties: {
            mutations: {
              type: "array",
              maxItems: maxMutationsPerIteration,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["action", "target", "value", "rationale", "expectedDimension"],
                properties: {
                  action: { type: "string", enum: ["swap_presentation", "adjust_profile_control", "change_hero_variant"] },
                  target: { type: "string" },
                  value: { type: "string" },
                  rationale: { type: "string" },
                  expectedDimension: {
                    type: "string",
                    enum: ["visual_design", "brand_identity", "content_quality", "mobile_experience"]
                  }
                }
              }
            }
          }
        }
      }
    }
  };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: openAiRequestSignal()
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) throw new Error(openAiErrorMessage(payload) ?? `HTTP ${response.status}`);
    const text = extractOpenAiResponseText(payload);
    if (!text) return { mutations: [], model };
    return { mutations: criticSchema.parse(JSON.parse(text)).mutations, model };
  } catch {
    return { mutations: [], model };
  }
}

/** Applies one mutation to the cloned artDirection; returns the audit record. Exported for the verify suite. */
export function applyMutation(
  artDirection: Record<string, unknown>,
  mutation: z.infer<typeof mutationSchema>,
  appliedSoFar: CraftMutation[]
): CraftMutation {
  const record: CraftMutation = {
    ...mutation,
    id: `craftmut_${hashString(`${mutation.action}:${mutation.target}:${mutation.value}`)}`,
    applied: false,
    note: ""
  };

  // Oscillation: a mutation that reverts an earlier mutation ends the loop upstream.
  const reverts = appliedSoFar.some(
    (prior) => prior.applied && prior.target === mutation.target && prior.before === mutation.value
  );
  if (reverts) {
    record.note = "oscillation: reverts a prior mutation";
    return record;
  }

  if (mutation.action === "adjust_profile_control") {
    const key = mutation.target as keyof DesignControlsV3;
    if (!controlKeys.includes(key) || !controlValueUniverse[key]?.includes(mutation.value)) {
      record.note = `invalid control target/value`;
      return record;
    }
    const controls = { ...((artDirection.controls as DesignControlsV3 | undefined) ?? resolveDesignControlsV3({ register: "steady_professional", brandPosture: "reserved" })) };
    record.before = controls[key];
    controls[key] = mutation.value as never;
    const violations = validateDesignControlsV3(controls, { headerMode: String(artDirection.headerMode ?? "solid_editorial") });
    if (violations.length) {
      record.note = `incompatible: ${violations[0]}`;
      return record;
    }
    artDirection.controls = controls;
    record.after = mutation.value;
    record.applied = true;
    record.note = "applied";
    return record;
  }

  if (mutation.action === "swap_presentation") {
    const role = mutation.target as ArtDirectionSectionRoleV3;
    const map = { ...((artDirection.sectionPresentation as Record<string, string> | undefined) ?? {}) };
    record.before = map[role];
    map[role] = mutation.value;
    const violations = validateSectionPresentationMapV3(map);
    if (violations.length) {
      record.note = `incompatible: ${violations[0].reason}`;
      return record;
    }
    artDirection.sectionPresentation = map;
    record.after = mutation.value;
    record.applied = true;
    record.note = "applied";
    return record;
  }

  // change_hero_variant: precondition — the target hero must be satisfiable
  // with the same approved slots and media. Post-compile mutation cannot
  // guarantee that today (hero assembly is a compile-time decision), so the
  // precondition fails closed until the Tier-2 recompile path exists.
  record.note = "precondition_failed: hero variant changes require the recompile path (Tier 2)";
  return record;
}

export async function runShadowCraftLoop(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  qa: GenerationQaMetadata;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<CraftLoopReport | undefined> {
  if (process.env.LODESTA_CRAFT_LOOP !== "shadow") return undefined;
  const version = input.version;
  const artDirectionBefore = JSON.stringify((version as { artDirection?: unknown }).artDirection ?? {});
  const base: CraftLoopReport = {
    version: "craft-loop-v1",
    mode: "shadow",
    iterations: [],
    replay: { qaRunIds: [], artDirectionBeforeHash: hashString(artDirectionBefore) },
    evaluatedAt: new Date().toISOString()
  };

  // Repair guard, inherited verbatim.
  if (version.status === "published" || version.ownerTouched || version.ownerApprovedAt) {
    return { ...base, skipped: "guard: published/owner-approved/owner-touched versions are never mutated" };
  }
  if (version.rendererVersion !== "layout-v3") {
    return { ...base, skipped: "layout-v3 only" };
  }

  const appliedHistory: CraftMutation[] = [];
  let working = structuredClone(version);
  let craftBefore = input.qa.qualityReport?.craft;

  for (let index = 0; index < maxIterations; index += 1) {
    const critic = await criticMutations({ bundle: input.bundle, version: working, qa: input.qa, telemetry: input.telemetry, spanId: input.spanId });
    base.replay.criticModel = critic.model;
    if (!critic.mutations.length) break;

    const clone = structuredClone(working);
    const artDirection = (clone as { artDirection: Record<string, unknown> }).artDirection;
    const records = critic.mutations.map((mutation) => applyMutation(artDirection, mutation, appliedHistory));
    const anyApplied = records.some((record) => record.applied);
    const oscillated = records.some((record) => record.note.startsWith("oscillation"));
    appliedHistory.push(...records);

    if (!anyApplied) {
      base.iterations.push({ index, mutations: records, blockersAfter: input.qa.blockers.length, craftBefore, wouldAccept: false });
      if (oscillated) break;
      continue;
    }

    // Re-render + re-score the clone; every iteration faces the full gate stack.
    const qaRunId = `craftloop_${crypto.randomUUID().replace(/-/g, "")}`;
    base.replay.qaRunIds.push(qaRunId);
    const inspection = await inspectGeneratedSiteBundleRender({ bundle: input.bundle, version: clone, qaRunId });
    const blockersAfter = inspection.findings.filter((finding) => finding.severity === "fail").length;
    let craftAfter: number | undefined;
    if (!inspection.unavailableReason && !blockersAfter && process.env.OPENAI_API_KEY) {
      const rescore = await createOpenAiVisualQa({
        bundle: input.bundle,
        renderInspection: inspection,
        telemetry: input.telemetry,
        spanId: input.spanId,
        modelReview: { allowed: true, reason: "craft-loop shadow re-score" }
      });
      craftAfter = rescore.source === "openai" ? (rescore.score?.craft ?? rescore.score?.overall) : undefined;
    }

    const scorecardAfter = buildGenerationScorecard({
      qualityReport: input.qa.qualityReport
        ? { ...input.qa.qualityReport, craft: craftAfter ?? input.qa.qualityReport.craft }
        : undefined,
      blockers: [],
      warnings: [],
      brandCueApplied: input.bundle.presenceAssessment.brandCueReport?.applied
    });
    const wouldAccept =
      blockersAfter === 0 && (craftAfter === undefined || craftBefore === undefined || craftAfter >= craftBefore);

    base.iterations.push({
      index,
      mutations: records,
      blockersAfter,
      craftBefore,
      craftAfter: craftAfter ?? scorecardAfter.dimensions.find((d) => d.id === "visual_design")?.score,
      wouldAccept
    });

    if (oscillated) break;
    if (wouldAccept) {
      working = clone;
      craftBefore = craftAfter ?? craftBefore;
    }
  }

  return base;
}
