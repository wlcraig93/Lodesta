import type { GeneratedCopyDeckV2, OptimizationFinding, SiteBundle, SiteVersionV3 } from "./models";
import { z } from "zod";
import {
  guardrailIssueMessages,
  validateAiEditOutcome,
  type EditorGuardrailIssue
} from "./editor-guardrails";
import { applyGeneratedSiteV3 } from "./generated-site-v3-pipeline";
import { markVersionOwnerTouched } from "./site-version-metadata";
import { assertSiteVersionV3 } from "./site-version-v3";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import { openAiRequestSignal } from "./openai-timeout";
import { extractOpenAiResponseText, openAiErrorMessage } from "./openai-generation";
import { createOpenAiGeneratedCopyDeck } from "./generated-copy-v2";
import { refreshSiteDossierCopyBriefV1 } from "./site-dossier-v1";

export type AiEditOperation = {
  type:
    | "owner_safe_mutation"
    | "fact_edit"
    | "run_audit"
    | "declined"
    | "no_op";
  label: string;
  pageId?: string;
  sectionId?: string;
  mutations?: OwnerSafeAiMutation[];
  details?: Record<string, string | number | boolean>;
};

export type OwnerSafeAiMutation = {
  action: "rewrite_section_copy";
  target: "hero.heading" | "hero.body" | "about.body";
  value: string;
  rationale: string;
};

export type AiEditResult = {
  ok: boolean;
  message: string;
  mutated: boolean;
  draftVersionId?: string;
  operations: AiEditOperation[];
  warnings: string[];
  guardrailIssues?: EditorGuardrailIssue[];
  guardrailWarnings?: EditorGuardrailIssue[];
  findings?: OptimizationFinding[];
  bundle?: SiteBundle;
};

const editIntentKinds = [
  "add_services",
  "hero_copy",
  "cta",
  "design_system",
  "section_structure",
  "media",
  "audit",
  "unsupported"
] as const;

const editFontPostures = ["utility", "editorial", "condensed", "rounded", "premium"] as const;
const editPaletteModes = ["brand", "neutral"] as const;
const editVoiceRegisters = ["direct", "warm", "premium", "technical", "plainspoken"] as const;
const editSectionIds = ["trust", "media", "process", "about", "testimonials"] as const;
const editCtaModes = ["call", "form", "booking"] as const;
const editFocalPoints = ["center", "top", "bottom", "left", "right"] as const;

type AiEditIntentKind = (typeof editIntentKinds)[number];

const editIntentClassificationSchema = z.object({
  intents: z.array(z.enum(editIntentKinds)).min(1).max(8),
  serviceNames: z.array(z.string().min(1).max(80)).max(12).default([]),
  fontPosture: z.enum(editFontPostures).nullable(),
  paletteMode: z.enum(editPaletteModes).nullable(),
  voiceRegister: z.enum(editVoiceRegisters).nullable(),
  sectionChange: z.object({
    action: z.enum(["hide", "show"]),
    sectionIds: z.array(z.enum(editSectionIds)).min(1).max(editSectionIds.length)
  }).nullable(),
  ctaMode: z.enum(editCtaModes).nullable(),
  mediaAssetId: z.string().min(1).max(160).nullable(),
  mediaFocalPoint: z.enum(editFocalPoints).nullable(),
  rationale: z.string().min(1).max(360)
});

const editIntentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intents", "serviceNames", "fontPosture", "paletteMode", "voiceRegister", "sectionChange", "ctaMode", "mediaAssetId", "mediaFocalPoint", "rationale"],
  properties: {
    intents: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", enum: editIntentKinds }
    },
    serviceNames: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 80 }
    },
    fontPosture: { anyOf: [{ type: "string", enum: editFontPostures }, { type: "null" }] },
    paletteMode: { anyOf: [{ type: "string", enum: editPaletteModes }, { type: "null" }] },
    voiceRegister: { anyOf: [{ type: "string", enum: editVoiceRegisters }, { type: "null" }] },
    sectionChange: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "sectionIds"],
          properties: {
            action: { type: "string", enum: ["hide", "show"] },
            sectionIds: { type: "array", minItems: 1, maxItems: editSectionIds.length, items: { type: "string", enum: editSectionIds } }
          }
        },
        { type: "null" }
      ]
    },
    ctaMode: { anyOf: [{ type: "string", enum: editCtaModes }, { type: "null" }] },
    mediaAssetId: { anyOf: [{ type: "string", minLength: 1, maxLength: 160 }, { type: "null" }] },
    mediaFocalPoint: { anyOf: [{ type: "string", enum: editFocalPoints }, { type: "null" }] },
    rationale: { type: "string", minLength: 1, maxLength: 360 }
  }
} as const;

export type AiEditIntentClassification = z.infer<typeof editIntentClassificationSchema> & {
  source: "openai" | "unavailable";
};

export async function applyAiEditToBundle(
  bundle: SiteBundle,
  userMessage: string,
  options?: { classification?: AiEditIntentClassification }
): Promise<AiEditResult> {
  const message = userMessage.trim();
  if (!message) {
    return {
      ok: false,
      message: "Tell the assistant what to change, add, or check.",
      mutated: false,
      operations: [],
      warnings: []
    };
  }

  const beforeBundle = structuredClone(bundle);
  let draft: SiteVersionV3 | undefined;
  const classification = options?.classification ?? await classifyAiEditIntent(bundle, message);
  const intents = new Set<AiEditIntentKind>(classification.intents);
  const operations: AiEditOperation[] = [];
  const warnings: string[] = [];
  const declined: AiEditOperation[] = [];
  let needsRecompile = false;
  let ownerKnobApplied = false;
  const ownerEdits = {
    ...bundle.presenceAssessment.ownerDesignSystemEditsV1,
    version: "owner-design-system-edits-v1" as const,
    updatedAt: new Date().toISOString()
  };

  const addedServices = intents.has("add_services") ? classification.serviceNames.map(cleanService).filter((service): service is string => Boolean(service)) : [];
  if (addedServices.length) {
    const newServices = addedServices.filter((service) => !bundle.businessProfile.services.some((existing) => sameText(existing, service)));
    if (newServices.length) {
      bundle.businessProfile.services = [...bundle.businessProfile.services, ...newServices].slice(0, 24);
      bundle.businessProfile.provenance.services = {
        source: "manual",
        confidence: 0.7,
        verified: false,
        observedAt: new Date().toISOString()
      };
      needsRecompile = true;
      operations.push({
        type: "fact_edit",
        label: `Added ${newServices.join(", ")} to the structured service list.`,
        details: { count: newServices.length }
      });
    }
  }

  if (intents.has("hero_copy")) {
    const deck = ensureGeneratedCopyDeck(bundle);
    const hero = directHeroCopyForBundle(bundle);
    deck.hero = hero;
    needsRecompile = true;
    operations.push({
      type: "owner_safe_mutation",
      label: "Rewrote the hero copy through the owner-safe mutation subset.",
      pageId: "home",
      sectionId: "hero",
      mutations: [
        {
          action: "rewrite_section_copy",
          target: "hero.heading",
          value: hero.heading,
          rationale: "Owner requested a clearer hero message."
        },
        {
          action: "rewrite_section_copy",
          target: "hero.body",
          value: hero.body,
          rationale: "Owner requested a clearer hero message."
        }
      ]
    });
  }

  if (intents.has("cta")) {
    const cta = classification.ctaMode ? heroCtaForMode(bundle, classification.ctaMode) : undefined;
    if (cta) {
      bundle.presenceAssessment.v3CompilerOverrides = {
        ...bundle.presenceAssessment.v3CompilerOverrides,
        heroPrimaryCta: { ...cta, style: "primary" }
      };
      needsRecompile = true;
      ownerKnobApplied = true;
      operations.push({
        type: "owner_safe_mutation",
        label: `Changed the primary action to ${cta.label}.`,
        pageId: "home",
        sectionId: "hero",
        details: { ctaMode: classification.ctaMode ?? "form" }
      });
    } else {
      declined.push({
        type: "declined",
        label: "That CTA request needs a verified phone, booking destination, or the existing contact form.",
        pageId: "home",
        sectionId: "hero"
      });
    }
  }

  if (intents.has("design_system")) {
    let appliedDesignKnob = false;
    if (classification.fontPosture) {
      ownerEdits.fontPosture = classification.fontPosture;
      appliedDesignKnob = true;
    }
    if (classification.paletteMode) {
      ownerEdits.paletteMode = classification.paletteMode;
      appliedDesignKnob = true;
    }
    if (classification.voiceRegister) {
      const previousVoiceRegister = ownerEdits.voiceRegister;
      ownerEdits.voiceRegister = classification.voiceRegister;
      bundle.presenceAssessment.ownerDesignSystemEditsV1 = ownerEdits;
      bundle.presenceAssessment.siteDossierV1 = refreshSiteDossierCopyBriefV1(bundle);
      try {
        const rewrittenDeck = await createOpenAiGeneratedCopyDeck({
          bundle,
          failureMode: "throw",
          regenerationFeedback: [
            `Owner requested the ${classification.voiceRegister} voice register. Rewrite the full copy deck in that register while preserving exact source grounding and the assigned section jobs.`
          ]
        });
        if (rewrittenDeck) bundle.presenceAssessment.generatedCopyDeck = rewrittenDeck;
        appliedDesignKnob = true;
      } catch {
        if (previousVoiceRegister) ownerEdits.voiceRegister = previousVoiceRegister;
        else delete ownerEdits.voiceRegister;
        declined.push({
          type: "declined",
          label: "The voice rewrite could not be completed safely and needs concierge review."
        });
      }
    }
    if (appliedDesignKnob) {
      bundle.presenceAssessment.ownerDesignSystemEditsV1 = ownerEdits;
      needsRecompile = true;
      ownerKnobApplied = true;
      operations.push({
        type: "owner_safe_mutation",
        label: "Applied the requested font, palette, or voice setting within the assigned design system.",
        details: {
          ...(classification.fontPosture ? { fontPosture: classification.fontPosture } : {}),
          ...(classification.paletteMode ? { paletteMode: classification.paletteMode } : {}),
          ...(classification.voiceRegister ? { voiceRegister: classification.voiceRegister } : {})
        }
      });
    } else if (!classification.voiceRegister) {
      declined.push({
        type: "declined",
        label: "Cross-system layout, arbitrary colors, and free-form styling remain concierge-only."
      });
    }
  }
  if (intents.has("section_structure")) {
    const sectionChange = classification.sectionChange;
    const plannedSectionIds = new Set(
      bundle.presenceAssessment.siteDirectorPlanV1?.validation.acceptedSectionBlueprints.map((blueprint) => blueprint.id) ?? []
    );
    const eligibleSectionIds = sectionChange?.sectionIds.filter((sectionId) => plannedSectionIds.has(sectionId)) ?? [];
    if (sectionChange && eligibleSectionIds.length) {
      const hidden = new Set(ownerEdits.hiddenSectionIds ?? []);
      for (const sectionId of eligibleSectionIds) {
        if (sectionChange.action === "hide") hidden.add(sectionId);
        else hidden.delete(sectionId);
      }
      ownerEdits.hiddenSectionIds = [...hidden].sort();
      bundle.presenceAssessment.ownerDesignSystemEditsV1 = ownerEdits;
      needsRecompile = true;
      ownerKnobApplied = true;
      operations.push({
        type: "owner_safe_mutation",
        label: `${sectionChange.action === "hide" ? "Hid" : "Showed"} ${eligibleSectionIds.join(", ")} within the assigned design system.`,
        details: { action: sectionChange.action, sections: eligibleSectionIds.join(",") }
      });
    } else {
      declined.push({
        type: "declined",
        label: "Only optional sections already allowed by this business's evidence-backed design-system plan can be shown or hidden."
      });
    }
  }
  if (intents.has("media")) {
    const mediaCandidate = bundle.presenceAssessment.siteDirectorPlanV1?.plannerInputManifest.mediaCandidates?.find(
      (candidate) => candidate.id === classification.mediaAssetId && candidate.allowedUses.includes("hero")
    );
    if (mediaCandidate) {
      ownerEdits.heroMediaAssetId = mediaCandidate.id;
      if (classification.mediaFocalPoint) ownerEdits.heroMediaFocalPoint = classification.mediaFocalPoint;
      bundle.presenceAssessment.ownerDesignSystemEditsV1 = ownerEdits;
      needsRecompile = true;
      ownerKnobApplied = true;
      operations.push({
        type: "owner_safe_mutation",
        label: "Changed the hero media using a source asset that clears the design system's hero floor.",
        pageId: "home",
        sectionId: "hero",
        details: { assetId: mediaCandidate.id, focalPoint: classification.mediaFocalPoint ?? "source" }
      });
    } else {
      declined.push({
        type: "declined",
        label: "The requested image does not clear this design system's hero-media floor."
      });
    }
  }

  if (ownerKnobApplied) bundle.presenceAssessment.ownerDesignSystemEditsV1 = ownerEdits;
  if (needsRecompile) {
    draft = clonePublishedAsDraft(bundle);
    bundle.presenceAssessment.siteDossierV1 = refreshSiteDossierCopyBriefV1(bundle);
    applyGeneratedSiteV3({ bundle });
    const updatedDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
    if (updatedDraft) markVersionOwnerTouched(assertSiteVersionV3(updatedDraft, "AI editor updated draft"));
  }
  if (intents.has("unsupported")) {
    declined.push({
      type: "declined",
      label: "That request does not map to the current owner-safe design-system knob surface."
    });
  }
  if (intents.has("audit")) operations.push({ type: "run_audit", label: "Requested a fresh audit after the draft change." });
  operations.push(...declined);
  warnings.push(...declined.map((operation) => operation.label));
  if (operations.length === 0) operations.push({ type: "no_op", label: "No supported owner-safe edit was detected." });
  if (!needsRecompile && !operations.some((operation) => operation.type === "fact_edit" || operation.type === "run_audit") && declined.length) {
    return {
      ok: false,
      message: "That request is outside the owner-safe AI edit subset and needs concierge review.",
      mutated: false,
      operations,
      warnings
    };
  }

  const guardrails = validateAiEditOutcome(beforeBundle, bundle);
  if (!guardrails.ok) {
    Object.assign(bundle, structuredClone(beforeBundle));
    return {
      ok: false,
      message: guardrails.reason,
      mutated: false,
      operations,
      warnings: guardrailIssueMessages(guardrails.issues),
      guardrailIssues: guardrails.issues
    };
  }
  warnings.push(...guardrailIssueMessages(guardrails.warnings));

  return {
    ok: true,
    message: responseMessage(operations, warnings),
    mutated: operations.some(isMutatingOperation),
    draftVersionId: bundle.siteModel.versions.find((version) => version.status === "draft")?.id ?? draft?.id,
    operations,
    warnings,
    guardrailWarnings: guardrails.warnings,
    bundle
  };
}

function clonePublishedAsDraft(bundle: SiteBundle): SiteVersionV3 {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) {
    const draft = assertSiteVersionV3(existingDraft, "AI editor draft");
    draft.theme ??= structuredClone(bundle.siteModel.theme);
    return draft;
  }
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(assertSiteVersionV3(published, "AI editor published version"));
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  draft.theme ??= structuredClone(bundle.siteModel.theme);
  bundle.siteModel.versions.unshift(draft);
  return draft;
}

function ensureGeneratedCopyDeck(bundle: SiteBundle): GeneratedCopyDeckV2 {
  if (bundle.presenceAssessment.generatedCopyDeck) return bundle.presenceAssessment.generatedCopyDeck;
  const business = bundle.businessProfile;
  const services = business.services.length ? business.services : [business.categories[0] ?? "Local service"];
  const description = business.description ?? `${business.name} provides local service with clear contact options.`;
  const location = business.address?.city ?? business.serviceAreas.find((area) => !/^local area$/i.test(area)) ?? "your area";
  const deck: GeneratedCopyDeckV2 = {
    version: "generated-copy-deck-v2",
    source: "openai",
    hero: directHeroCopyForBundle(bundle),
    servicesIntro: { heading: "Services", body: `Core services include ${services.slice(0, 3).join(", ")}.` },
    serviceItems: services.slice(0, 4).map((service) => ({ title: service, body: `${business.name} can help with ${service}.` })),
    processIntro: { heading: "How it works", body: "Reach out with the details and the team will confirm the next step." },
    processSteps: [
      { title: "Share details", body: "Send the service, timing, and location." },
      { title: "Confirm fit", body: "The business confirms availability and next steps." },
      { title: "Get help", body: "Use the agreed service path." }
    ],
    faqs: [
      { question: "How do I get started?", answer: "Use the primary contact option and include the service you need." },
      { question: "Where do you serve?", answer: business.serviceAreas.join(", ") || "Contact the business to confirm service area." },
      { question: "Can I verify details first?", answer: "Yes. Confirm service, location, and timing before starting." },
      { question: "What should I include?", answer: "Include the service, timeline, and best way to reach you." }
    ],
    contactIntro: { heading: `Contact ${business.name}`, body: "Use the contact options to ask a question or request service." },
    splitMedia: { heading: business.name, body: description },
    gallery: { heading: "Gallery", body: "A visual overview of the business context." },
    seo: {
      title: `${business.name} | ${services[0] ?? "Local service"} in ${location}`.slice(0, 70),
      description: `${business.name} helps customers in ${location} with ${services.slice(0, 3).join(", ")}. Clear contact options and local details are built into the page.`.slice(0, 165)
    },
    groundingNotes: ["Deterministic v3 AI editor fallback copy."],
    voiceProfile: { pov: "brand_direct" }
  };
  bundle.presenceAssessment.generatedCopyDeck = deck;
  return deck;
}

function directHeroCopyForBundle(bundle: SiteBundle): GeneratedCopyDeckV2["hero"] {
  const business = bundle.businessProfile;
  const service = business.services[0] ?? business.categories[0] ?? "local service";
  const location = business.address?.city ?? business.serviceAreas.find((area) => !/^local area$/i.test(area)) ?? "your area";
  return {
    eyebrow: business.categories[0] ?? business.vertical,
    heading: `${business.name} for ${service} in ${location}.`,
    body: business.phone
      ? `Call ${business.name} for a clear answer on ${service.toLowerCase()}, timing, and next steps.`
      : `${business.name} helps with ${service.toLowerCase()} using a clear contact path.`
  };
}

function heroCtaForMode(bundle: SiteBundle, mode: (typeof editCtaModes)[number]) {
  if (mode === "call" && bundle.businessProfile.phone) {
    return { label: "Call the shop", href: `tel:${bundle.businessProfile.phone}` };
  }
  if (mode === "booking" && bundle.businessProfile.bookingLinks[0]) {
    return { label: "Book now", href: bundle.businessProfile.bookingLinks[0] };
  }
  if (mode === "form") return { label: "Request an estimate", href: "#contact" };
  return undefined;
}

async function classifyAiEditIntent(bundle: SiteBundle, message: string): Promise<AiEditIntentClassification> {
  if (!process.env.OPENAI_API_KEY) return unavailableEditIntentClassification();
  try {
    const runtimeSettings = await getOpenAiRuntimeSettings();
    const body = {
      model: runtimeSettings.settings.generationModel,
      reasoning: { effort: "minimal" },
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Classify an owner website-edit request onto Lodesta's constrained knob surface.",
                "Return only schema-valid JSON.",
                "Use add_services only for explicit requests to add named services to the business fact list.",
                "Use hero_copy for requests to rewrite, clarify, shorten, or make the hero/headline/top copy more direct.",
                "Use cta for a primary button request and set ctaMode to call, form, or booking only when that destination exists in the supplied business context.",
                "Use design_system only for bounded font posture, brand-versus-neutral palette, or full-copy voice changes. Populate the corresponding field and leave unrelated fields null.",
                "A request for cross-system layout, arbitrary CSS, or a specific unlisted color is unsupported, not design_system.",
                "Use section_structure only to hide or show the optional supplied section ids. Reordering or inserting an unlisted section is unsupported.",
                "Use media for a hero image or crop/focal-point request. Select mediaAssetId only from heroEligibleMedia and set mediaFocalPoint only when requested.",
                "Use audit for requests to check, review, QA, audit, or score the draft.",
                "Use unsupported when the request cannot map to these knobs. Multiple intents are allowed. Every optional output field must be null unless the owner explicitly requested it."
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
                request: message,
                business: {
                  name: bundle.businessProfile.name,
                  vertical: bundle.businessProfile.vertical,
                  services: bundle.businessProfile.services,
                  hasPhone: Boolean(bundle.businessProfile.phone),
                  hasBooking: Boolean(bundle.businessProfile.bookingLinks[0])
                },
                optionalSections: bundle.presenceAssessment.siteDirectorPlanV1?.validation.acceptedSectionBlueprints
                  .map((blueprint) => blueprint.id)
                  .filter((sectionId) => (editSectionIds as readonly string[]).includes(sectionId)) ?? [],
                heroEligibleMedia: bundle.presenceAssessment.siteDirectorPlanV1?.plannerInputManifest.mediaCandidates
                  ?.filter((candidate) => candidate.allowedUses.includes("hero"))
                  .map((candidate) => ({ id: candidate.id, tags: candidate.tags, source: candidate.source })) ?? [],
                allowedIntents: editIntentKinds
              })
            }
          ]
        }
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "lodesta_owner_edit_intent",
          strict: true,
          schema: editIntentJsonSchema
        }
      }
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal()
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) throw new Error(openAiErrorMessage(payload) ?? `OpenAI owner edit intent failed with status ${response.status}`);
    const text = extractOpenAiResponseText(payload);
    if (!text) throw new Error("OpenAI owner edit intent response did not include output text.");
    const parsed = editIntentClassificationSchema.parse(JSON.parse(text));
    return { ...parsed, source: "openai" };
  } catch {
    return unavailableEditIntentClassification();
  }
}

function unavailableEditIntentClassification(): AiEditIntentClassification {
  return {
    intents: ["unsupported"],
    serviceNames: [],
    fontPosture: null,
    paletteMode: null,
    voiceRegister: null,
    sectionChange: null,
    ctaMode: null,
    mediaAssetId: null,
    mediaFocalPoint: null,
    rationale: "Model intent classification was unavailable; the request requires concierge review instead of regex guessing.",
    source: "unavailable"
  };
}

function cleanService(value: string) {
  return value.replace(/\b(on|to|for) (the )?(site|website|page)$/i, "").trim();
}


function sameText(left: string, right: string) {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function responseMessage(operations: AiEditOperation[], warnings: string[]) {
  const applied = operations.filter((operation) => operation.type !== "no_op" && operation.type !== "declined").map((operation) => operation.label);
  if (applied.length && warnings.length) return `${applied.join(" ")} ${warnings.join(" ")}`;
  if (applied.length) return applied.join(" ");
  if (warnings.length) return warnings.join(" ");
  return "No supported owner-safe edit was detected.";
}

function isMutatingOperation(operation: AiEditOperation) {
  return operation.type === "owner_safe_mutation" || operation.type === "fact_edit";
}
