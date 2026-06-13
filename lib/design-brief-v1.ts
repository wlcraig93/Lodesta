import { z } from "zod";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import type { BusinessProfile, BusinessUnderstandingV2 } from "./models";
import {
  registerForVertical,
  resolveDesignControlsV3,
  validateDesignControlsV3,
  type DesignControlsV3,
  type DesignProfileV3
} from "./generated-site-v3-art-direction-catalog";
import { compositionIntentMenuV3, type CompositionPlanV3 } from "./generated-site-v3-composition-plan";
import { extractOpenAiResponseText, openAiErrorMessage } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";

/**
 * Model design brief (next-level plan, Part 2.4).
 *
 * The model reasons at the BRIEF level: one coherent argument about what this
 * business should feel like — a register, a posture, at most two control
 * overrides with rationale — validated against the typed schema and the
 * incompatibility table, then compiled deterministically into resolved
 * control values. Forty switches never reach the model; freeform never
 * reaches the renderer.
 *
 * The deterministic selector remains the fallback tier (no key, call failure,
 * invalid output), exactly like the copy pass.
 */

const overrideKeys = [
  "eyebrowTreatment",
  "cardChrome",
  "figureTreatment",
  "headingCase",
  "badgeStyle",
  "factHighlight",
  "ctaBandTone",
  "numberStyle"
] as const;

const briefSchema = z.object({
  register: z.enum(["punchy_retail", "steady_professional", "warm_boutique"]),
  brandPosture: z.enum(["accent_forward", "reserved"]),
  rationale: z.string().min(10).max(400),
  /** At most two notable expressions the brief argues for beyond the profile defaults. */
  overrides: z
    .array(
      z.object({
        control: z.enum(overrideKeys),
        value: z.string().min(1).max(40),
        why: z.string().min(1).max(200)
      })
    )
    .max(2),
  /**
   * Ordered middle-section plan from the fixed intent menu (workstream A).
   * Empty array means "no opinion" — the compiler keeps its deterministic
   * order. The compiler validates against the grammar either way.
   */
  compositionPlan: z
    .array(
      z.object({
        intent: z.enum(compositionIntentMenuV3),
        why: z.string().min(1).max(200)
      })
    )
    .max(10)
});

export type DesignBriefResult = {
  profile: DesignProfileV3;
  controls: DesignControlsV3;
  source: "model" | "deterministic_fallback";
};

const controlValueUniverse: Record<(typeof overrideKeys)[number], string[]> = {
  eyebrowTreatment: ["plain_caps", "accent_bar_chip", "filled_kicker"],
  cardChrome: ["bordered", "elevated", "accent_underline"],
  figureTreatment: ["flush", "framed_shadow"],
  headingCase: ["standard", "display_upper"],
  badgeStyle: ["square", "rounded", "tilted"],
  factHighlight: ["plain", "accent_value"],
  ctaBandTone: ["dark", "brand", "paper"],
  numberStyle: ["oversized", "outlined", "filled_chip"]
};

export async function createDesignBrief(input: {
  business: BusinessProfile;
  understanding?: BusinessUnderstandingV2;
  brandApplied: boolean;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<
  | { profile: DesignProfileV3; overrides: Partial<DesignControlsV3>; compositionPlan?: CompositionPlanV3; source: "model" }
  | undefined
> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.LODESTA_DESIGN_BRIEF === "off") return undefined;
  const model = process.env.LODESTA_DESIGN_BRIEF_MODEL ?? "gpt-5-mini";
  const context = {
    name: input.business.name,
    vertical: input.business.vertical,
    services: input.business.services.slice(0, 8),
    conversionGoal: input.understanding?.primaryConversionGoal,
    story: input.understanding?.businessStory?.summary,
    distinctives: input.understanding?.businessStory?.distinctives,
    brandCuesApplied: input.brandApplied,
    registers: {
      punchy_retail: "high-energy retail (tires, used cars): bold, declarative, accent-heavy",
      steady_professional: "calm competence (law, home services): restrained, trustworthy",
      warm_boutique: "inviting and sensory (salons, restaurants): soft chrome, warm pacing"
    },
    overrideVocabulary: controlValueUniverse,
    evidence: {
      photoCount: input.business.photos.length,
      serviceCount: input.business.services.length,
      hasStory: Boolean(input.understanding?.businessStory?.summary),
      hasAddress: Boolean(input.business.address),
      serviceAreaCount: input.business.serviceAreas.length
    },
    compositionIntentMenu: compositionIntentMenuV3,
    compositionExemplars: {
      media_led: ["facts", "gallery", "story", "services", "process", "testimonials", "faq", "cta_band", "location"],
      conversion_led: ["facts", "services", "process", "story", "faq", "cta_band", "location"],
      story_led: ["story", "about", "services", "gallery", "process", "faq", "cta_band", "location"]
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
              "You are an art director choosing a design direction for a small-business website.",
              "Pick the register and brand posture that fit THIS business, write one honest rationale sentence,",
              "and propose at most two control overrides ONLY when the business's story or services argue for them.",
              "Default posture is reserved unless real brand cues exist (brandCuesApplied).",
              "Also propose compositionPlan: order 4-10 middle sections from compositionIntentMenu so the page is shaped by THIS business's evidence",
              "(deep photo set leads with media, strong story leads with story, sparse evidence stays lean).",
              "Every entry needs a one-line evidence rationale. The exemplars are starting points, not rules — deviate when evidence argues for it.",
              "Hard constraints the validator will enforce: services/faq/cta_band always included when available, location included when the business has one,",
              "cta_band in the final three, no intent twice. Return an empty compositionPlan array if you have no strong opinion."
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
        name: "lodesta_design_brief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["register", "brandPosture", "rationale", "overrides", "compositionPlan"],
          properties: {
            register: { type: "string", enum: ["punchy_retail", "steady_professional", "warm_boutique"] },
            brandPosture: { type: "string", enum: ["accent_forward", "reserved"] },
            rationale: { type: "string" },
            overrides: {
              type: "array",
              maxItems: 2,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["control", "value", "why"],
                properties: {
                  control: { type: "string", enum: [...overrideKeys] },
                  value: { type: "string" },
                  why: { type: "string" }
                }
              }
            },
            compositionPlan: {
              type: "array",
              maxItems: 10,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["intent", "why"],
                properties: {
                  intent: { type: "string", enum: [...compositionIntentMenuV3] },
                  why: { type: "string" }
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
    if (!text) return undefined;
    const brief = briefSchema.parse(JSON.parse(text));

    // Posture honesty: accent_forward requires real brand cues regardless of
    // what the model argues, and respects the fleet kill-switch.
    const brandPosture =
      input.brandApplied && process.env.LODESTA_ACCENT_FORWARD !== "off" ? brief.brandPosture : "reserved";
    const profile: DesignProfileV3 = {
      register: brief.register,
      brandPosture,
      rationale: `model brief: ${brief.rationale}`
    };

    // Overrides: enum-validated values only; invalid overrides are dropped,
    // never guessed at.
    const overrides: Partial<DesignControlsV3> = {};
    for (const override of brief.overrides) {
      if (controlValueUniverse[override.control]?.includes(override.value)) {
        overrides[override.control] = override.value as never;
      }
    }

    // Fewer than four planned sections reads as "no strong opinion"; the
    // compiler's grammar validator re-checks everything against built
    // sections either way, with the deterministic order as the fallback.
    const compositionPlan: CompositionPlanV3 | undefined =
      brief.compositionPlan.length >= 4
        ? { version: "composition-plan-v1", sections: brief.compositionPlan, source: "model" }
        : undefined;

    return { profile, overrides, compositionPlan, source: "model" };
  } catch {
    return undefined;
  }
}

/**
 * Resolve a brief (model or deterministic) into validated controls. Override
 * combinations that trip the incompatibility table fall back to the pure
 * profile resolution — a brief can flavor the direction, never break it.
 */
export function resolveBrief(
  profile: DesignProfileV3,
  overrides: Partial<DesignControlsV3> | undefined,
  headerMode: string
): DesignControlsV3 {
  const base = resolveDesignControlsV3(profile);
  if (!overrides || !Object.keys(overrides).length) return base;
  const merged = { ...base, ...overrides };
  return validateDesignControlsV3(merged, { headerMode }).length ? base : merged;
}

export function deterministicProfileFallback(business: BusinessProfile, brandApplied: boolean, seededForward: boolean): DesignProfileV3 {
  const register = registerForVertical(business.vertical);
  const accentForwardEnabled = process.env.LODESTA_ACCENT_FORWARD !== "off";
  return {
    register,
    brandPosture:
      accentForwardEnabled && brandApplied && (register === "punchy_retail" || seededForward) ? "accent_forward" : "reserved",
    rationale: `deterministic: ${business.vertical} → ${register}; brand cues ${brandApplied ? "applied" : "absent"}.`
  };
}
