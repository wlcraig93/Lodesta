import { z } from "zod";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import type { BusinessProfile, BusinessUnderstandingV2 } from "./models";
import {
  registerForVertical,
  resolveDesignControlsV3,
  validateDesignControlsV3,
  modelSelectablePresentationsForRoleV3,
  validateSectionPresentationMapV3,
  type DesignControlsV3,
  type DesignProfileV3,
  type SectionPresentationMapV3
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
  "headerSurface",
  "ctaBandTone",
  "numberStyle"
] as const;

const presentationDefault = "default" as const;

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
    .max(10),
  /**
   * Catalog-bounded presentation direction. Empty object means "no strong
   * presentation opinion" and leaves the compiler's deterministic picks in
   * place for those roles.
   */
  presentationMap: z
    .object({
      services: z.enum([...modelSelectablePresentationsForRoleV3.services, presentationDefault]),
      process: z.enum([...modelSelectablePresentationsForRoleV3.process, presentationDefault]),
      faq: z.enum([...modelSelectablePresentationsForRoleV3.faq, presentationDefault]),
      factsStrip: z.enum([...modelSelectablePresentationsForRoleV3.factsStrip, presentationDefault]),
      heroFacts: z.enum([...modelSelectablePresentationsForRoleV3.heroFacts, presentationDefault]),
      contactFacts: z.enum([...modelSelectablePresentationsForRoleV3.contactFacts, presentationDefault]),
      gallery: z.enum([...modelSelectablePresentationsForRoleV3.gallery, presentationDefault]),
      quotes: z.enum([...modelSelectablePresentationsForRoleV3.quotes, presentationDefault])
    })
    .strict()
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
  headerSurface: ["neutral", "brand_bar"],
  ctaBandTone: ["dark", "brand", "paper"],
  numberStyle: ["oversized", "outlined", "filled_chip"]
};

export async function createDesignBrief(input: {
  business: BusinessProfile;
  understanding?: BusinessUnderstandingV2;
  brandApplied: boolean;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  strict?: boolean;
}): Promise<
  | {
      profile: DesignProfileV3;
      overrides: Partial<DesignControlsV3>;
      compositionPlan?: CompositionPlanV3;
      presentationMap?: SectionPresentationMapV3;
      source: "model";
    }
  | undefined
> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.LODESTA_DESIGN_BRIEF === "off") {
    if (input.strict) throw new Error(!apiKey ? "OPENAI_API_KEY is not configured." : "LODESTA_DESIGN_BRIEF is off.");
    return undefined;
  }
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
    presentationGuidance: {
      services:
        input.business.photos.length >= 4 && input.business.services.length >= 4
          ? "Rich first-party/source-safe media plus a broad service list: prefer premium_showcase, action_tiles, or another visually differentiated service treatment over a plain card_grid."
          : "Use card_grid only when it is the cleanest expression of sparse service evidence; otherwise choose a more differentiated bounded presentation.",
      process:
        "Process should feel like a real customer journey, not numbered service repetition. Avoid listing the same service taxonomy again."
    },
    compositionIntentMenu: compositionIntentMenuV3,
    compatiblePresentationsForRole: modelSelectablePresentationsForRoleV3,
    compositionExemplars: {
      media_led: ["facts", "gallery", "story", "services", "proof", "process", "faq", "cta_band", "location", "contact"],
      conversion_led: ["facts", "services", "proof", "contact", "process", "story", "faq", "cta_band", "location"],
      story_led: ["story", "about", "services", "proof", "contact", "gallery", "process", "faq", "cta_band", "location"]
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
              "Use proof for grounded trust, evidence, expectation-setting, or repair-scope bands when that section is available.",
              "Every entry needs a one-line evidence rationale. The exemplars are starting points, not rules — deviate when evidence argues for it.",
              "For estimate-driven services, place contact after enough service/proof context instead of burying the form at the very end.",
              "Also choose presentationMap values only from compatiblePresentationsForRole when the geometry helps this business; use default for any role where the compiler should decide.",
              "Use presentation choices to avoid template sameness: services do not always need the same card grid, process does not always need numbered rows,",
              "and gallery/facts treatments should match the amount and quality of source-safe evidence.",
              "Header surface is also a real art-direction choice: use brand_bar only when the brand/color evidence supports a confident topbar; otherwise keep neutral.",
              "When the input has several source-safe photos and several services, avoid plain card_grid unless there is a clear reason; choose a richer service presentation that makes the media and first service feel designed.",
              "Process presentation should not repeat the service list. Use it for judgment points, handoffs, proof checks, or visit rhythm.",
              "Hard constraints the validator will enforce: services/proof/faq/cta_band/contact always included when available, location included when the business has one,",
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
          required: ["register", "brandPosture", "rationale", "overrides", "compositionPlan", "presentationMap"],
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
            },
            presentationMap: {
              type: "object",
              additionalProperties: false,
              required: ["services", "process", "faq", "factsStrip", "heroFacts", "contactFacts", "gallery", "quotes"],
              properties: {
                services: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.services, presentationDefault] },
                process: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.process, presentationDefault] },
                faq: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.faq, presentationDefault] },
                factsStrip: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.factsStrip, presentationDefault] },
                heroFacts: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.heroFacts, presentationDefault] },
                contactFacts: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.contactFacts, presentationDefault] },
                gallery: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.gallery, presentationDefault] },
                quotes: { type: "string", enum: [...modelSelectablePresentationsForRoleV3.quotes, presentationDefault] }
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
    if (!text) throw new Error("OpenAI design brief response did not include output text.");
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
    const presentationChoices = Object.fromEntries(
      Object.entries(brief.presentationMap).filter(([, value]) => value !== presentationDefault)
    ) as SectionPresentationMapV3;
    const presentationMap: SectionPresentationMapV3 | undefined =
      Object.keys(presentationChoices).length && validateSectionPresentationMapV3(presentationChoices).length === 0
        ? presentationChoices
        : undefined;

    return { profile, overrides, compositionPlan, presentationMap, source: "model" };
  } catch (error) {
    if (input.strict) throw error;
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
