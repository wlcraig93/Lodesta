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
  "factHighlight"
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
    .max(2)
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
  factHighlight: ["plain", "accent_value"]
};

export async function createDesignBrief(input: {
  business: BusinessProfile;
  understanding?: BusinessUnderstandingV2;
  brandApplied: boolean;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
}): Promise<{ profile: DesignProfileV3; overrides: Partial<DesignControlsV3>; source: "model" } | undefined> {
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
    overrideVocabulary: controlValueUniverse
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
              "Default posture is reserved unless real brand cues exist (brandCuesApplied)."
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
          required: ["register", "brandPosture", "rationale", "overrides"],
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
    return { profile, overrides, source: "model" };
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
