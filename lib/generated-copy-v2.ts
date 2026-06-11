import { z } from "zod";
import { registerForVertical } from "./generated-site-v3-art-direction-catalog";
import type { BusinessProfile, BusinessUnderstandingV2, GeneratedCopyDeckV2, SiteBundle , GeneratedCopyVoiceProfileV2 } from "./models";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import { extractOpenAiUsage, sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";
import { elapsedOpenAiCallMs, extractOpenAiResponseText, openAiErrorMessage } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";

const copyBlock = (headingMax: number, bodyMax: number) =>
  z.object({
    heading: z.string().min(8).max(headingMax),
    body: z.string().min(20).max(bodyMax)
  });

const servicePageSchemaV2 = z.object({
  serviceName: z.string().min(3).max(70),
  hero: z.object({ heading: z.string().min(10).max(90), body: z.string().min(30).max(230) }),
  detail: z.object({ heading: z.string().min(8).max(80), body: z.string().min(60).max(420) }),
  faqs: z
    .array(z.object({ question: z.string().min(10).max(90), answer: z.string().min(20).max(220) }))
    .length(4),
  seo: z.object({ title: z.string().min(10).max(70), description: z.string().min(40).max(165) })
});

const copyDeckSchema = z.object({
  hero: z.object({
    eyebrow: z.string().min(3).max(60).nullable(),
    heading: z.string().min(10).max(90),
    body: z.string().min(30).max(230)
  }),
  servicesIntro: copyBlock(80, 200),
  serviceItems: z
    .array(
      z.object({
        title: z.string().min(3).max(60),
        body: z.string().min(20).max(170)
      })
    )
    .min(3)
    .max(4),
  processIntro: copyBlock(80, 200),
  processSteps: z
    .array(
      z.object({
        title: z.string().min(4).max(50),
        body: z.string().min(20).max(170)
      })
    )
    .min(3)
    .max(4),
  faqs: z
    .array(
      z.object({
        question: z.string().min(10).max(90),
        answer: z.string().min(20).max(220)
      })
    )
    .length(4),
  locationIntro: copyBlock(80, 200).nullable(),
  contactIntro: copyBlock(80, 200),
  splitMedia: z.object({ heading: z.string().min(10).max(80), body: z.string().min(40).max(230) }),
  about: z.object({ heading: z.string().min(8).max(80), body: z.string().min(60).max(420) }).nullable(),
  gallery: z.object({ heading: z.string().min(8).max(70), body: z.string().min(30).max(180) }),
  seo: z.object({
    title: z.string().min(10).max(70),
    description: z.string().min(40).max(165)
  }),
  groundingNotes: z.array(z.string().min(1).max(200)).min(1).max(8),
  servicePages: z.array(servicePageSchemaV2).max(4).nullable()
});

/**
 * Content that must never reach customer-facing copy: internal vertical slugs,
 * raw scraped label keys, live status strings, and meta filler about the
 * generation process itself.
 */
const bannedCopyPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgeneral[ _]local\b/i, reason: "Internal vertical slug is visible." },
  { pattern: /\b(auto_services|auto_body|home_services|med_spa|law_firm|real_estate|beauty_salon|creative_studio)\b/, reason: "Internal vertical slug is visible." },
  { pattern: /\bhours?[_\s]?\d\b/i, reason: "Raw scraped hours label is visible." },
  { pattern: /\b(currently closed|currently open|open again on|we'?re currently)\b/i, reason: "Live status string stored as permanent copy." },
  { pattern: /\bservices?\s*:\s*\d+\b/i, reason: "Filler service-count fact is visible." },
  { pattern: /\b(this website|this site was|generated (site|preview)|placeholder|lorem ipsum)\b/i, reason: "Generation meta language is visible." },
  { pattern: /\b(award[- ]winning|certified|guaranteed|#1|best in)\b/i, reason: "Unverifiable superlative or credential claim." }
];

/**
 * Targeted follow-up when the combined deck call returns no service pages but
 * page-worthy (source-backed) services exist. Failure is non-fatal: the site
 * ships single-page rather than blocking on the extra call.
 */
async function createServicePagesFallback(args: {
  input: GeneratedCopyDeckInput;
  apiKey: string;
  model: string;
  deck: GeneratedCopyDeckV2;
}): Promise<GeneratedCopyDeckV2["servicePages"]> {
  const business = args.input.bundle.businessProfile;
  const understanding = args.input.bundle.presenceAssessment.businessUnderstanding;
  const pageWorthy = (understanding?.cleanedServices ?? [])
    .filter((service) => Boolean(service.sourceText?.trim()))
    .slice(0, 2);
  if (!pageWorthy.length) return undefined;

  const body = {
    model: args.model,
    reasoning: { effort: "low" },
    max_output_tokens: 2200,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You write dedicated service landing pages for a US local small business website.",
              "Return only schema-valid JSON through Structured Outputs.",
              "Ground every sentence in the provided verified facts. Never invent offers, prices, years, credentials, reviews, or guarantees.",
              "Each page must take a genuinely different angle from the provided homepage copy: different sentences, different FAQs, service-specific detail. Do not recycle homepage sentences.",
              "Write a page for each listed service. FAQs answer real customer questions about that specific service."
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
              businessName: business.name,
              location: business.address?.city ?? undefined,
              phone: business.phone ?? undefined,
              services: pageWorthy.map((service) => ({
                name: service.name,
                price: service.price ?? undefined,
                sourceText: service.sourceText
              })),
              homepageCopy: {
                hero: args.deck.hero,
                servicesIntro: args.deck.servicesIntro,
                faqs: args.deck.faqs
              }
            })
          }
        ]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_service_pages_v2",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["servicePages"],
          properties: {
            servicePages: { type: "array", minItems: 1, maxItems: 2, items: servicePageItemJsonSchema }
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
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal()
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    await args.input.telemetry?.recordModelCall({
      spanId: args.input.spanId,
      provider: "openai",
      model: body.model,
      endpoint: "/v1/responses",
      operation: "generated_service_pages_fallback",
      status: response.ok ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok ? undefined : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    if (!response.ok) return undefined;
    const text = extractOpenAiResponseText(payload);
    if (!text) return undefined;
    const parsed = z.object({ servicePages: z.array(servicePageSchemaV2).min(1).max(2) }).parse(JSON.parse(text) as unknown);
    const candidate: GeneratedCopyDeckV2 = { ...args.deck, servicePages: parsed.servicePages };
    return lintGeneratedCopyDeck(candidate).length ? undefined : parsed.servicePages;
  } catch {
    return undefined;
  }
}

/** Default voice per vertical; owners can change the profile later. */
export function voiceProfileForBusiness(business: Pick<BusinessProfile, "vertical">): GeneratedCopyVoiceProfileV2 {
  const register = registerForVertical(business.vertical);
  switch (business.vertical) {
    case "beauty_salon":
    case "med_spa":
    case "creative_studio":
      return { pov: "brand_direct", register };
    default:
      return { pov: "first_plural", register };
  }
}

/** Register-specific tone guidance injected into the deck prompt. */
export function registerGuidance(register: GeneratedCopyVoiceProfileV2["register"]): string {
  switch (register) {
    case "punchy_retail":
      return "Voice register: punchy retail. Short declarative headlines with energy ('Low prices on tires, wheels & lift kits.'). Section heads may carry personality ('Five ways we get you rolling.'). Verbs over adjectives. Never invent claims to sound energetic — energy comes from rhythm, not superlatives.";
    case "warm_boutique":
      return "Voice register: warm boutique. Inviting, sensory, unhurried. Headlines read like a welcome, not a pitch.";
    default:
      return "Voice register: steady professional. Clear, calm, competence-forward. No hype.";
  }
}

/**
 * Meta-site copy that talks about the website or instructs visitors how to use
 * it instead of speaking as the business. Never customer-shippable.
 */
const metaInstructionalPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\buse the photos?\b/i, reason: "Meta-instructional copy about the site's own photos." },
  { pattern: /\bdecide what to ask\b/i, reason: "Meta-instructional copy telling visitors how to inquire." },
  { pattern: /\b(reach out|contact us) using the\b/i, reason: "Meta-instructional copy about the site's own form." },
  { pattern: /\bfill (out|in) the form\b/i, reason: "Meta-instructional copy about the site's own form." },
  { pattern: /\bcomposed first (step|stop)\b/i, reason: "Template filler heading." },
  { pattern: /\bone clean frame\b/i, reason: "Template filler heading." },
  { pattern: /\bgives visitors\b/i, reason: "Copy describes the website instead of the business." },
  { pattern: /\bthis (web)?site\b/i, reason: "Copy refers to the website itself." },
  { pattern: /\bbefore (you|they) reach out\b/i, reason: "Meta copy about inquiring instead of the trade." }
];

/** Standalone detector shared with the quality gate. */
export function detectMetaInstructionalCopy(text: string): string | undefined {
  for (const entry of metaInstructionalPatterns) {
    if (entry.pattern.test(text)) return entry.reason;
  }
  return undefined;
}

export function lintGeneratedCopyDeck(deck: GeneratedCopyDeckV2, context?: { businessName?: string }): string[] {
  const violations: string[] = [];
  const texts = collectDeckTexts(deck);
  for (const text of texts) {
    for (const banned of bannedCopyPatterns) {
      if (banned.pattern.test(text)) {
        violations.push(`${banned.reason} Text: "${text.slice(0, 80)}"`);
      }
    }
    for (const meta of metaInstructionalPatterns) {
      if (meta.pattern.test(text)) {
        violations.push(`${meta.reason} Text: "${text.slice(0, 80)}"`);
      }
    }
  }
  // Third-person directory sludge: the business name as sentence subject over
  // and over reads like a listing, not the business speaking. Voice-profile
  // aware: brand_direct tolerates more brand-name usage than first-person.
  const businessName = context?.businessName?.trim();
  if (businessName) {
    const bodies = [deck.hero.body, deck.servicesIntro.body, deck.splitMedia.body, deck.contactIntro.body];
    const nameSubjectCount = bodies.filter((body) => body.toLowerCase().startsWith(businessName.toLowerCase())).length;
    const limit = deck.voiceProfile.pov === "brand_direct" ? 3 : 1;
    if (nameSubjectCount > limit) {
      violations.push(`Third-person drift: ${nameSubjectCount} section bodies open with the business name (limit ${limit} for ${deck.voiceProfile.pov}).`);
    }
    if (deck.voiceProfile.pov !== "brand_direct") {
      const firstPerson = deck.voiceProfile.pov === "first_singular" ? /\b(i|my|me)\b/i : /\b(we|our|us)\b/i;
      const present = bodies.some((body) => firstPerson.test(body));
      if (!present) {
        violations.push(`Voice mismatch: profile is ${deck.voiceProfile.pov} but no section body uses first-person language.`);
      }
    }
  }
  const stepTitles = deck.processSteps.map((step) => step.title.toLowerCase().trim());
  if (new Set(stepTitles).size !== stepTitles.length) violations.push("Process steps contain duplicate titles.");
  const faqQuestions = deck.faqs.map((faq) => faq.question.toLowerCase().trim());
  if (new Set(faqQuestions).size !== faqQuestions.length) violations.push("FAQs contain duplicate questions.");
  const serviceTitles = deck.serviceItems.map((item) => item.title.toLowerCase().trim());
  if (new Set(serviceTitles).size !== serviceTitles.length) violations.push("Service items contain duplicate titles.");
  return violations;
}

function collectDeckTexts(deck: GeneratedCopyDeckV2): string[] {
  return [
    deck.hero.eyebrow ?? "",
    deck.hero.heading,
    deck.hero.body,
    deck.servicesIntro.heading,
    deck.servicesIntro.body,
    ...deck.serviceItems.flatMap((item) => [item.title, item.body]),
    deck.processIntro.heading,
    deck.processIntro.body,
    ...deck.processSteps.flatMap((step) => [step.title, step.body]),
    ...deck.faqs.flatMap((faq) => [faq.question, faq.answer]),
    deck.locationIntro?.heading ?? "",
    deck.locationIntro?.body ?? "",
    deck.contactIntro.heading,
    deck.contactIntro.body,
    deck.splitMedia.heading,
    deck.splitMedia.body,
    deck.about?.heading ?? "",
    deck.about?.body ?? "",
    deck.gallery.heading,
    deck.gallery.body,
    deck.seo.title,
    deck.seo.description,
    ...(deck.servicePages ?? []).flatMap((page) => [
      page.serviceName,
      page.hero.heading,
      page.hero.body,
      page.detail.heading,
      page.detail.body,
      ...page.faqs.flatMap((faq) => [faq.question, faq.answer]),
      page.seo.title,
      page.seo.description
    ])
  ].filter(Boolean);
}

export type GeneratedCopyDeckInput = {
  bundle: SiteBundle;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
};

export async function createOpenAiGeneratedCopyDeck(
  input: GeneratedCopyDeckInput
): Promise<GeneratedCopyDeckV2 | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const runtimeSettings = await getOpenAiRuntimeSettings();
  const business = input.bundle.businessProfile;
  const understanding = input.bundle.presenceAssessment.businessUnderstanding;

  const body = {
    model: runtimeSettings.settings.generationModel,
    reasoning: { effort: "low" },
    max_output_tokens: 3200,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You write customer-facing homepage copy for a US local small business website generated by Lodesta.",
              "Return only schema-valid JSON through Structured Outputs.",
              "Ground every sentence in the provided verified facts. Never invent offers, prices, years in business, credentials, reviews, awards, or guarantees.",
              "Write specific, concrete copy about what the business actually does, in plain confident language a local customer would trust.",
              "Never write copy about how to contact a business or what to include in a message; write about the services, the work, and practical customer questions (pricing expectations only if a verified price exists, turnaround, what to bring, walk-ins).",
              "Voice: write in the requested voiceProfile point of view. first_plural speaks as the business ('we', 'our shop'); first_singular speaks as the individual ('I'); brand_direct uses the business name sparingly and confident declarative statements. Never write like a third-party directory describing the business.",
              "Never write meta copy about the website itself or instruct visitors how to use it (no 'use the photos', 'fill out the form', 'this site shows').",
              "splitMedia: a short approach/working-with-us section shown beside a workshop photo — what working with this business is actually like, grounded in facts.",
              "gallery: a short intro for a photo gallery of the work — about the work in the photos, never about the photos as photos.",
              "about: when businessStory is provided, write the about section as the story's centerpiece — founders, family, history, personalities, told warmly and concretely in the business voice. Real names and details from the story verbatim. Null only when there is no story.",
              "Never include internal labels, vertical slugs, scraped key names, live open/closed status, or meta commentary about the website.",
              "FAQ answers must answer real customer questions about the trade, not questions about messaging the business.",
              "groundingNotes must list which provided facts each major claim relies on.",
              "servicePages: write a landing page only for verified services with enough distinct material for a genuinely different page (different angle, different FAQs, no recycled homepage sentences). When in doubt, write fewer pages or set servicePages to null — thin near-duplicate pages are worse than none."
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
              ...copyDeckContext(business, understanding),
              voiceProfile: voiceProfileForBusiness(business),
              voiceRegisterGuidance: registerGuidance(voiceProfileForBusiness(business).register)
            })
          }
        ]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_generated_copy_deck_v2",
        strict: true,
        schema: copyDeckResponseJsonSchema
      }
    }
  };

  const startedAt = new Date().toISOString();
  let recorded = false;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal()
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model: body.model,
      endpoint: "/v1/responses",
      operation: "generated_copy_deck",
      status: response.ok ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok ? undefined : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    recorded = true;
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload) ?? `OpenAI copy deck generation failed with status ${response.status}`);
    }
    const text = extractOpenAiResponseText(payload);
    if (!text) throw new Error("OpenAI copy deck response did not include output text.");
    const parsed = copyDeckSchema.parse(JSON.parse(text) as unknown);
    const deck: GeneratedCopyDeckV2 = {
      version: "generated-copy-deck-v2",
      source: "openai",
      hero: {
        eyebrow: parsed.hero.eyebrow ?? undefined,
        heading: parsed.hero.heading,
        body: parsed.hero.body
      },
      servicesIntro: parsed.servicesIntro,
      serviceItems: parsed.serviceItems,
      processIntro: parsed.processIntro,
      processSteps: parsed.processSteps,
      faqs: parsed.faqs,
      locationIntro: parsed.locationIntro ?? undefined,
      contactIntro: parsed.contactIntro,
      splitMedia: parsed.splitMedia,
      about: parsed.about ?? undefined,
      gallery: parsed.gallery,
      seo: parsed.seo,
      groundingNotes: parsed.groundingNotes,
      voiceProfile: voiceProfileForBusiness(business),
      servicePages: parsed.servicePages ?? undefined
    };
    const violations = lintGeneratedCopyDeck(deck, { businessName: business.name });
    if (violations.length) {
      throw new Error(`Generated copy deck failed content lint: ${violations.join(" | ")}`);
    }
    if (!deck.servicePages?.length) {
      // The combined call omits servicePages often enough to make multi-page
      // output unreliable; a dedicated follow-up call is cheap and targeted.
      deck.servicePages = await createServicePagesFallback({ input, apiKey, model: body.model, deck });
    }
    return deck;
  } catch (error) {
    if (!recorded) {
      const endedAt = new Date().toISOString();
      await input.telemetry?.recordModelCall({
        spanId: input.spanId,
        provider: "openai",
        model: body.model,
        endpoint: "/v1/responses",
        operation: "generated_copy_deck",
        status: "failed",
        requestJson: sanitizeTelemetryPayload(body),
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
      });
    }
    console.warn(
      `OpenAI copy deck unavailable; deterministic template copy will be used and gated. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

function copyDeckContext(business: BusinessProfile, understanding: BusinessUnderstandingV2 | undefined) {
  return {
    verifiedFacts: {
      businessName: business.name,
      verticalLabel: business.categories[0],
      city: business.address?.city,
      region: business.address?.region,
      street: business.address?.street,
      phoneAvailable: Boolean(business.phone),
      services: understanding?.cleanedServices.length
        ? understanding.cleanedServices.map((service) => ({ name: service.name, price: service.price }))
        : business.services.map((service) => ({ name: service })),
      serviceHighlights: business.serviceHighlights ?? [],
      hours: business.hours,
      serviceAreas: business.serviceAreas,
      reviewsSummary: business.reviewsSummary,
      description: business.description
    },
    understanding: understanding
      ? {
          vertical: understanding.vertical,
          detectedSubverticals: understanding.detectedSubverticals,
          businessStory: understanding.businessStory,
          primaryConversionGoal: understanding.primaryConversionGoal,
          urgentServiceSignals: understanding.urgentServiceSignals,
          notes: understanding.notes
        }
      : undefined,
    rules: {
      faqCount: 4,
      serviceItemRange: [3, 4],
      processStepRange: [3, 4],
      conversionStyle: conversionStyleForBusiness(business),
      verticalPlaybook: verticalCopyPlaybook(business)
    }
  };
}

function conversionStyleForBusiness(business: BusinessProfile) {
  if (business.vertical === "restaurant" && business.orderingLinks[0]) return "order_first";
  if (
    (business.vertical === "beauty_salon" || business.vertical === "med_spa" || business.vertical === "dental" || business.vertical === "fitness" || business.vertical === "veterinary") &&
    business.bookingLinks[0]
  ) {
    return "booking_first";
  }
  return business.phone ? "call_first" : "form_first";
}

function verticalCopyPlaybook(business: BusinessProfile): string {
  switch (business.vertical) {
    case "auto_services":
      return "Tire/auto service: emphasize speed (while-you-wait), price-before-work, and walk-in friendliness. FAQs answer repair-vs-replace, timing, and appointments.";
    case "auto_body":
      return "Auto body: emphasize practical intake (vehicle, damage, photos), insurance familiarity only if source-backed, and clear repair categories.";
    case "restaurant":
      return "Restaurant: lead with the food and ways to get it (dine-in, pickup, catering). Warm, appetizing, concrete. Never invent dishes, prices, or cuisine claims not in the source facts.";
    case "home_services":
      return "Home services: emphasize response time, clear estimates before work, and tidy completed work. FAQs cover emergencies, pricing transparency, and what to have ready.";
    case "beauty_salon":
      return "Salon: emphasize booking ease, consultation for big changes, and stylist expertise. Never make beauty-outcome guarantees or health claims.";
    default:
      return "General local service: concrete, factual, conversion-focused copy grounded in the provided facts.";
  }
}

const copyBlockJsonSchema = (headingMax: number, bodyMax: number) => ({
  type: "object",
  additionalProperties: false,
  required: ["heading", "body"],
  properties: {
    heading: { type: "string", minLength: 8, maxLength: headingMax },
    body: { type: "string", minLength: 20, maxLength: bodyMax }
  }
});

const servicePageItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["serviceName", "hero", "detail", "faqs", "seo"],
  properties: {
    serviceName: { type: "string", minLength: 3, maxLength: 70 },
    hero: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", minLength: 10, maxLength: 90 },
        body: { type: "string", minLength: 30, maxLength: 230 }
      }
    },
    detail: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", minLength: 8, maxLength: 80 },
        body: { type: "string", minLength: 60, maxLength: 420 }
      }
    },
    faqs: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string", minLength: 10, maxLength: 90 },
          answer: { type: "string", minLength: 20, maxLength: 220 }
        }
      }
    },
    seo: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description"],
      properties: {
        title: { type: "string", minLength: 10, maxLength: 70 },
        description: { type: "string", minLength: 40, maxLength: 165 }
      }
    }
  }
} as const;

const copyDeckResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "hero",
    "servicesIntro",
    "serviceItems",
    "processIntro",
    "processSteps",
    "faqs",
    "locationIntro",
    "contactIntro",
    "splitMedia",
    "about",
    "gallery",
    "seo",
    "groundingNotes",
    "servicePages"
  ],
  properties: {
    hero: {
      type: "object",
      additionalProperties: false,
      required: ["eyebrow", "heading", "body"],
      properties: {
        eyebrow: { type: ["string", "null"], minLength: 3, maxLength: 60 },
        heading: { type: "string", minLength: 10, maxLength: 90 },
        body: { type: "string", minLength: 30, maxLength: 230 }
      }
    },
    servicesIntro: copyBlockJsonSchema(80, 200),
    serviceItems: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: {
          title: { type: "string", minLength: 3, maxLength: 60 },
          body: { type: "string", minLength: 20, maxLength: 170 }
        }
      }
    },
    processIntro: copyBlockJsonSchema(80, 200),
    processSteps: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: {
          title: { type: "string", minLength: 4, maxLength: 50 },
          body: { type: "string", minLength: 20, maxLength: 170 }
        }
      }
    },
    faqs: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string", minLength: 10, maxLength: 90 },
          answer: { type: "string", minLength: 20, maxLength: 220 }
        }
      }
    },
    locationIntro: {
      anyOf: [copyBlockJsonSchema(80, 200), { type: "null" }]
    },
    contactIntro: copyBlockJsonSchema(80, 200),
    splitMedia: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", minLength: 10, maxLength: 80 },
        body: { type: "string", minLength: 40, maxLength: 230 }
      }
    },
    about: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["heading", "body"],
          properties: {
            heading: { type: "string", minLength: 8, maxLength: 80 },
            body: { type: "string", minLength: 60, maxLength: 420 }
          }
        },
        { type: "null" }
      ]
    },
    gallery: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", minLength: 8, maxLength: 70 },
        body: { type: "string", minLength: 30, maxLength: 180 }
      }
    },
    seo: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description"],
      properties: {
        title: { type: "string", minLength: 10, maxLength: 70 },
        description: { type: "string", minLength: 40, maxLength: 165 }
      }
    },
    groundingNotes: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 200 } },
    servicePages: {
      anyOf: [
        {
          type: "array",
          maxItems: 4,
          items: servicePageItemJsonSchema
        },
        { type: "null" }
      ]
    }
  }
};
