import { z } from "zod";
import { registerForVertical } from "./generated-site-v3-art-direction-catalog";
import type { BusinessProfile, BusinessUnderstandingV2, GeneratedCopyDeckV2, SiteBundle , GeneratedCopyVoiceProfileV2 } from "./models";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import { extractOpenAiUsage, sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";
import { elapsedOpenAiCallMs, extractOpenAiResponseText, openAiErrorMessage, openAiResponseIncompleteReason } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";

const generatedCopyDeckRequestTimeoutMs = 180_000;

const shortTextMaxV2 = 180;
const mediumTextMaxV2 = 360;
const bodyTextMaxV2 = 900;
const seoTitleMaxV2 = 140;
const seoDescriptionMaxV2 = 320;

const copyBlock = (headingMax: number, bodyMax: number) =>
  z.object({
    heading: z.string().min(8).max(headingMax),
    body: z.string().min(20).max(bodyMax)
  });

const servicePageSchemaV2 = z.object({
  serviceName: z.string().min(3).max(shortTextMaxV2),
  hero: z.object({ heading: z.string().min(10).max(shortTextMaxV2), body: z.string().min(30).max(bodyTextMaxV2) }),
  detail: z.object({ heading: z.string().min(8).max(shortTextMaxV2), body: z.string().min(60).max(bodyTextMaxV2) }),
  faqs: z
    .array(z.object({ question: z.string().min(10).max(shortTextMaxV2), answer: z.string().min(20).max(bodyTextMaxV2) }))
    .length(4),
  seo: z.object({ title: z.string().min(10).max(seoTitleMaxV2), description: z.string().min(40).max(seoDescriptionMaxV2) })
});

const copySlotJobSchemaV2 = z.object({
  slotId: z.string().min(2).max(80),
  point: z.string().min(8).max(bodyTextMaxV2),
  proofToUse: z.string().min(3).max(bodyTextMaxV2).optional(),
  customerQuestion: z.string().min(6).max(bodyTextMaxV2).optional(),
  slotShape: z.string().min(6).max(bodyTextMaxV2).optional(),
  avoid: z.string().min(3).max(bodyTextMaxV2).optional(),
  genericRisk: z.string().min(6).max(bodyTextMaxV2).optional()
});

const copyPlanSchemaV2 = z.object({
  siteArgument: z.string().min(20).max(bodyTextMaxV2),
  proofHierarchy: z.array(z.string().min(3).max(mediumTextMaxV2)).min(2).max(6),
  sectionJobs: z
    .array(
      z.object({
        sectionId: z.string().min(2).max(40),
        point: z.string().min(8).max(bodyTextMaxV2),
        proofToUse: z.string().min(3).max(bodyTextMaxV2).optional(),
        customerQuestion: z.string().min(6).max(bodyTextMaxV2).optional(),
        slotShape: z.string().min(6).max(bodyTextMaxV2).optional(),
        avoid: z.string().min(3).max(bodyTextMaxV2).optional(),
        genericRisk: z.string().min(6).max(bodyTextMaxV2).optional(),
        slotJobs: z.array(copySlotJobSchemaV2).min(1).max(8).optional()
      })
    )
    .min(5)
    .max(12),
  ctaRhythm: z.string().min(20).max(bodyTextMaxV2),
  repetitionRisks: z.array(z.string().min(6).max(mediumTextMaxV2)).min(2).max(8)
});

const copyDeckSchema = z.object({
  copyPlan: copyPlanSchemaV2,
  hero: z.object({
    eyebrow: z.string().min(3).max(shortTextMaxV2).nullable(),
    heading: z.string().min(10).max(shortTextMaxV2),
    body: z.string().min(30).max(bodyTextMaxV2)
  }),
  servicesIntro: copyBlock(shortTextMaxV2, bodyTextMaxV2),
  serviceItems: z
    .array(
      z.object({
        title: z.string().min(3).max(shortTextMaxV2),
        body: z.string().min(20).max(bodyTextMaxV2)
      })
    )
    .min(3)
    .max(6),
  processIntro: copyBlock(shortTextMaxV2, bodyTextMaxV2),
  processSteps: z
    .array(
      z.object({
        title: z.string().min(4).max(shortTextMaxV2),
        body: z.string().min(20).max(bodyTextMaxV2)
      })
    )
    .min(3)
    .max(4),
  faqs: z
    .array(
      z.object({
        question: z.string().min(10).max(shortTextMaxV2),
        answer: z.string().min(20).max(bodyTextMaxV2)
      })
    )
    .length(4),
  locationIntro: copyBlock(shortTextMaxV2, bodyTextMaxV2).nullable(),
  contactIntro: copyBlock(shortTextMaxV2, bodyTextMaxV2),
  splitMedia: z.object({ heading: z.string().min(10).max(shortTextMaxV2), body: z.string().min(40).max(bodyTextMaxV2) }),
  about: z.object({ heading: z.string().min(8).max(shortTextMaxV2), body: z.string().min(60).max(bodyTextMaxV2) }).nullable(),
  gallery: z.object({ heading: z.string().min(8).max(shortTextMaxV2), body: z.string().min(30).max(bodyTextMaxV2) }),
  seo: z.object({
    title: z.string().min(10).max(seoTitleMaxV2),
    description: z.string().min(40).max(seoDescriptionMaxV2)
  }),
  groundingNotes: z.array(z.string().min(1).max(bodyTextMaxV2)).min(1).max(8),
  servicePages: z.null()
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

const genericHeadingPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^our approach\.?$/i, reason: "Generic section heading." },
  { pattern: /^what we do\.?$/i, reason: "Generic section heading." },
  { pattern: /^how it works\.?$/i, reason: "Generic section heading." },
  { pattern: /^ready to get started\.?$/i, reason: "Generic section heading." },
  { pattern: /^get started\.?$/i, reason: "Generic section heading." },
  { pattern: /^services\.?$/i, reason: "Generic section heading." },
  { pattern: /^choose the service/i, reason: "Generic section heading." },
  { pattern: /^common questions\.?$/i, reason: "Generic section heading." },
  { pattern: /^clear next steps\b/i, reason: "Generic process heading." },
  { pattern: /^focused help\b/i, reason: "Generic service heading." },
  { pattern: /\bhelp after\b/i, reason: "Generic service heading." }
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
  const dedicatedDirectorServices = dedicatedServiceNamesFromDirectorPlan(args.input.bundle);
  if (args.input.bundle.presenceAssessment.siteDirectorPlanV1?.validation.status === "passed" && !dedicatedDirectorServices.length) {
    return undefined;
  }
  const pageWorthy = (understanding?.cleanedServices ?? [])
    .filter((service) => !dedicatedDirectorServices.length || serviceMatchesDirectorDedicatedPage(service.name, dedicatedDirectorServices))
    .filter((service) => Boolean(service.sourceText?.trim()))
    .slice(0, 2);
  if (!pageWorthy.length) return undefined;

  const body = {
    model: args.model,
    reasoning: { effort: "low" },
    // Two full landing pages (hero + detail + 4 FAQs + SEO each) overran 2200
    // and truncated; the fallback is non-fatal but a clipped page still wasted
    // the call. Headroom keeps both pages whole.
    max_output_tokens: 4000,
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
      signal: openAiRequestSignal(generatedCopyDeckRequestTimeoutMs)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    const incompleteReason = response.ok ? openAiResponseIncompleteReason(payload) : undefined;
    await args.input.telemetry?.recordModelCall({
      spanId: args.input.spanId,
      provider: "openai",
      model: body.model,
      endpoint: "/v1/responses",
      operation: "generated_service_pages_fallback",
      status: response.ok && !incompleteReason ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok
        ? incompleteReason
          ? `Incomplete response (${incompleteReason})`
          : undefined
        : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    if (!response.ok) return undefined;
    // A truncated fallback would ship a clipped landing page; drop it and stay
    // single-page rather than persist a fragment.
    if (incompleteReason) return undefined;
    const text = extractOpenAiResponseText(payload);
    if (!text) return undefined;
    const parsed = z.object({ servicePages: z.array(servicePageSchemaV2).min(1).max(2) }).parse(JSON.parse(text) as unknown);
    const candidate: GeneratedCopyDeckV2 = { ...args.deck, servicePages: parsed.servicePages };
    return lintGeneratedCopyDeck(candidate).length ? undefined : parsed.servicePages;
  } catch {
    return undefined;
  }
}

function dedicatedServiceNamesFromDirectorPlan(bundle: SiteBundle): string[] {
  const runtime = bundle.presenceAssessment.siteDirectorPlanV1;
  if (runtime?.validation.status !== "passed") return [];
  const dedicatedIds = new Set(
    runtime.plan.servicePages
      .filter((proposal) => proposal.strategy === "dedicated")
      .map((proposal) => proposal.serviceId)
  );
  if (!dedicatedIds.size) return [];
  return bundle.businessProfile.services.filter((service, index) => dedicatedIds.has(`service_${index + 1}`));
}

function serviceMatchesDirectorDedicatedPage(serviceName: string, dedicatedServices: readonly string[]): boolean {
  const normalized = serviceName.toLowerCase();
  return dedicatedServices.some((dedicatedService) => {
    const dedicated = dedicatedService.toLowerCase();
    return normalized.includes(dedicated) || dedicated.includes(normalized);
  });
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

/**
 * Scripts that never appear correctly in US local-business English copy. A
 * stray glyph from one of these ranges is the signature of a truncated or
 * corrupt model response (a clipped multi-byte token decoding to e.g. a CJK
 * ideograph) — the exact "...when the修" defect. Latin (incl. accents),
 * punctuation, and symbols are all allowed; only foreign scripts and the
 * Unicode replacement char trip this.
 */
const disallowedScriptPattern =
  /[�Ѐ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿　-ヿ㐀-䶿一-鿿가-힯豈-﫿]/gu;

export function lintGeneratedCopyDeck(deck: GeneratedCopyDeckV2, context?: { businessName?: string }): string[] {
  const violations: string[] = [];
  const texts = collectDeckTexts(deck);
  for (const heading of collectDeckHeadings(deck)) {
    for (const generic of genericHeadingPatterns) {
      if (generic.pattern.test(heading.trim())) {
        violations.push(`${generic.reason} Text: "${heading.slice(0, 80)}"`);
      }
    }
  }
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
    const stray = text.match(disallowedScriptPattern);
    if (stray) {
      violations.push(`Corrupt/foreign character "${stray[0]}" — likely a truncated model response. Text: "${text.slice(0, 80)}"`);
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
  // Customer-facing text only. Internal planning fields intentionally include
  // words such as "guaranteed" in avoid/risk instructions and must not trip
  // public-copy claim guards.
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

function collectDeckHeadings(deck: GeneratedCopyDeckV2): string[] {
  return [
    deck.hero.heading,
    deck.servicesIntro.heading,
    ...deck.serviceItems.map((item) => item.title),
    deck.processIntro.heading,
    ...deck.processSteps.map((step) => step.title),
    ...deck.faqs.map((faq) => faq.question),
    deck.locationIntro?.heading ?? "",
    deck.contactIntro.heading,
    deck.splitMedia.heading,
    deck.about?.heading ?? "",
    deck.gallery.heading,
    ...(deck.servicePages ?? []).flatMap((page) => [
      page.hero.heading,
      page.detail.heading,
      ...page.faqs.map((faq) => faq.question)
    ])
  ].filter(Boolean);
}

/** Body-type fields (full sentences expected), used for completeness checks. */
function collectDeckBodies(deck: GeneratedCopyDeckV2): string[] {
  return [
    deck.hero.body,
    deck.servicesIntro.body,
    ...deck.serviceItems.map((item) => item.body),
    deck.processIntro.body,
    ...deck.processSteps.map((step) => step.body),
    ...deck.faqs.map((faq) => faq.answer),
    deck.locationIntro?.body ?? "",
    deck.contactIntro.body,
    deck.splitMedia.body,
    deck.about?.body ?? "",
    deck.gallery.body,
    ...(deck.servicePages ?? []).flatMap((page) => [page.hero.body, page.detail.body, ...page.faqs.map((faq) => faq.answer)])
  ].filter(Boolean);
}

// Taste defects that are grammatical and factual — so they sail past the
// correctness lint — but read as low-quality automated copy: hedging instead of
// confidence, internal taxonomy leaking into prose, and clipped sentences.
// These are *guidance* for the editor pass, not hard blockers: forcing a retry
// would risk dropping to template copy, whereas the editor rewrites in place.
const hedgePatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bwhen the\b[^.?!]{0,40}\bis a (good )?fit\b/i, reason: "Hedged service description ('when the … is a fit')." },
  { pattern: /\bmay not need\b/i, reason: "Hedging ('may not need')." },
  { pattern: /\bfocused option\b/i, reason: "Vague filler ('focused option')." },
  { pattern: /\b(where|as) applicable\b/i, reason: "Hedging ('where/as applicable')." },
  { pattern: /\bif (it|that|they) (is|are|fit|fits)\b/i, reason: "Conditional hedging ('if it fits')." },
  { pattern: /\bcan (talk through|discuss|help with)\b/i, reason: "Tentative phrasing ('can talk through')." },
  { pattern: /\bwith room for\b/i, reason: "Noncommittal phrasing ('with room for')." },
  { pattern: /\bclear next steps\b/i, reason: "Generic process-speak ('clear next steps')." },
  { pattern: /\bfocused help\b/i, reason: "Generic local-service phrasing ('focused help')." },
  { pattern: /\bhelp after\b/i, reason: "Generic local-service phrasing ('help after')." },
  { pattern: /\bpractical support\b/i, reason: "Generic local-service phrasing ('practical support')." },
  { pattern: /\bneed a shop to look at\b/i, reason: "Directory-style phrasing ('need a shop to look at')." },
  { pattern: /\bavailable from\b/i, reason: "Awkward generated phrasing ('available from')." }
];
const taxonomyPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brepair categor(y|ies)\b/i, reason: "Internal taxonomy in prose ('repair category')." },
  { pattern: /\brepair path\b/i, reason: "Internal taxonomy in prose ('repair path')." },
  { pattern: /\brepair conversation\b/i, reason: "Internal process phrasing ('repair conversation')." },
  { pattern: /\bestimate conversation\b/i, reason: "Internal process phrasing ('estimate conversation')." },
  { pattern: /\bthe repair type\b/i, reason: "Internal taxonomy in prose ('the repair type')." },
  { pattern: /\binto the right\b[^.?!]{0,24}\bpath\b/i, reason: "Process-speak ('into the right … path')." }
];

/**
 * Detect taste defects across the deck. Returns short human-readable issues used
 * to (a) decide whether the editor pass is worth running and (b) tell the editor
 * exactly what to fix. Deliberately high-precision: every pattern here matched a
 * real low-quality generation, not a hypothetical.
 */
export function detectCopyTasteIssuesInTexts(texts: string[], bodies: string[] = texts): string[] {
  const issues: string[] = [];
  for (const text of texts) {
    for (const hedge of hedgePatterns) {
      if (hedge.pattern.test(text)) issues.push(`${hedge.reason} Text: "${text.slice(0, 70)}"`);
    }
    for (const taxonomy of taxonomyPatterns) {
      if (taxonomy.pattern.test(text)) issues.push(`${taxonomy.reason} Text: "${text.slice(0, 70)}"`);
    }
  }
  for (const body of bodies) {
    if (!/[.!?…"')\]]\s*$/.test(body)) {
      issues.push(`Body does not end in a complete sentence. Text: "${body.slice(-70)}"`);
    }
  }
  return issues;
}

export function detectCopyTasteIssues(deck: GeneratedCopyDeckV2): string[] {
  return detectCopyTasteIssuesInTexts(collectDeckTexts(deck), collectDeckBodies(deck));
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
  const siteDirectorPlan = input.bundle.presenceAssessment.siteDirectorPlanV1;
  const designBrief = input.bundle.presenceAssessment.designBrief;

  const buildBody = (maxOutputTokens: number) => ({
    model: runtimeSettings.settings.generationModel,
    reasoning: { effort: "low" },
    max_output_tokens: maxOutputTokens,
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
              "Start with copyPlan before writing slots: define the site argument, proof hierarchy, structured section jobs, CTA rhythm, and repetition risks. Every sectionJob must include point, proofToUse, customerQuestion, slotShape, avoid, genericRisk, and slotJobs for the rendered slots it owns.",
              "When a SiteDirectorPlanV1 is provided, write the copy deck to fit that exact planned page: section order, selected geometry, CTA roles, copy jobs, navigation, and service-page strategy. Do not invent a different structure.",
              "Write specific, concrete copy about what the business actually does, in plain confident language a local customer would trust.",
              "Write to fit the planned rendered slots: concise headings, tight card bodies, and complete sentences. The schema allows headroom so strong copy is not rejected; do not use that headroom as permission to ramble.",
              "Every major heading must sound like it belongs on this exact business's website. Never use generic headings like 'Our approach', 'What we do', 'How it works', 'Ready to get started', 'Services', or 'Choose the service'.",
              "Avoid generated local-service filler such as 'clear next steps', 'focused help', 'help after', 'practical support', or 'need a shop to look at the damage'. Say the concrete vehicle condition, repair work, visit detail, or source-backed claim/self-pay fact instead.",
              "Do not let every section become intake instructions. Service, proof, process, and media sections should mostly describe the work, standards, visible outcomes, and practical customer decisions; reserve 'send photos', 'share details', and call-prep language for contact or quote sections.",
              "processIntro/processSteps: describe the real decision path and quality checks. Do not dump the service taxonomy into step titles or bodies. Never repeat four or more service names in the process section; each step must have a distinct job such as inspection, estimate/claim path, repair work, quality check, pickup.",
              "Never write copy about how to contact a business or what to include in a message; write about the services, the work, and practical customer questions (pricing expectations only if a verified price exists, turnaround, what to bring, walk-ins).",
              "Voice: write in the requested voiceProfile point of view. first_plural speaks as the business ('we', 'our shop'); first_singular speaks as the individual ('I'); brand_direct uses the business name sparingly and confident declarative statements. Never write like a third-party directory describing the business.",
              "Never write meta copy about the website itself or instruct visitors how to use it (no 'use the photos', 'fill out the form', 'this site shows').",
              "splitMedia: a short approach/working-with-us section shown beside a workshop photo — what working with this business is actually like, grounded in facts.",
              "gallery: a short intro for a photo gallery of the work — about the work in the photos, never about the photos as photos.",
              "splitMedia and gallery must have distinct headlines, distinct bodies, and distinct section jobs. Never reuse the same phrase, angle, or sentence across those two sections.",
              "about: when businessStory is provided, write the about section as the story's centerpiece — founders, family, history, personalities, told warmly and concretely in the business voice. Real names and details from the story verbatim. Null only when there is no story.",
              "Never include internal labels, vertical slugs, scraped key names, live open/closed status, or meta commentary about the website.",
              "FAQ answers must answer real customer questions about the trade, not questions about messaging the business.",
              "groundingNotes must list which provided facts each major claim relies on.",
              "Set servicePages to null in this homepage copy deck. Dedicated service pages are generated separately by a smaller service-page call."
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
              ...copyDeckContext(business, understanding, siteDirectorPlan, designBrief),
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
  });

  // 3200 truncated the full single-page deck mid-string in the field, shipping a
  // clipped hero body that ended in a stray glyph. The deck needs materially
  // more room; an incomplete (token-capped) response retries once with a larger
  // budget before we fall back to deterministic template copy.
  const tokenBudgets = [5000, 7000];
  const model = runtimeSettings.settings.generationModel;
  let text: string | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < tokenBudgets.length; attempt += 1) {
    const body = buildBody(tokenBudgets[attempt]);
    const startedAt = new Date().toISOString();
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: openAiRequestSignal(generatedCopyDeckRequestTimeoutMs)
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      const endedAt = new Date().toISOString();
      const incompleteReason = response.ok ? openAiResponseIncompleteReason(payload) : undefined;
      await input.telemetry?.recordModelCall({
        spanId: input.spanId,
        provider: "openai",
        model: body.model,
        endpoint: "/v1/responses",
        operation: "generated_copy_deck",
        status: response.ok && !incompleteReason ? "completed" : "failed",
        requestJson: sanitizeTelemetryPayload(body),
        responseJson: sanitizeTelemetryPayload(payload),
        ...extractOpenAiUsage(payload),
        errorMessage: response.ok
          ? incompleteReason
            ? `Incomplete response (${incompleteReason})`
            : undefined
          : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
        startedAt,
        endedAt,
        durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
      });
      if (!response.ok) {
        // HTTP/refusal errors are not budget-retryable.
        throw new Error(openAiErrorMessage(payload) ?? `OpenAI copy deck generation failed with status ${response.status}`);
      }
      if (incompleteReason) {
        lastError = new Error(`OpenAI copy deck response was incomplete (${incompleteReason}).`);
        continue;
      }
      text = extractOpenAiResponseText(payload);
      if (!text) throw new Error("OpenAI copy deck response did not include output text.");
      break;
    } catch (error) {
      lastError = error;
      break;
    }
  }

  try {
    if (!text) {
      throw lastError instanceof Error ? lastError : new Error("OpenAI copy deck generation failed.");
    }
    const parsed = copyDeckSchema.parse(JSON.parse(text) as unknown);
    const deck: GeneratedCopyDeckV2 = {
      version: "generated-copy-deck-v2",
      source: "openai",
      copyPlan: parsed.copyPlan,
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
    const deckForLint = withCompleteBodySentences(repairGeneratedCopyDeckForSlotFit(sanitizeCorruptGlyphs(deck), business));
    const violations = lintGeneratedCopyDeck(deckForLint, { businessName: business.name });
    if (violations.length) {
      throw new Error(`Generated copy deck failed content lint: ${violations.join(" | ")}`);
    }
    // Editor pass: the draft is correct and grounded but low-effort generation
    // leaves hedging, taxonomy-speak, and repetition that the correctness lint
    // can't see. Rewrite in place against an editorial rubric when taste issues
    // are present, keeping the result only if it lints clean and is measurably
    // tighter. Runs before servicePages so the pages derive from edited copy.
    const editedDeck = await refineGeneratedCopyDeck({ input, apiKey, model, deck: deckForLint, business, understanding, siteDirectorPlan, designBrief });
    const finalDeck = editedDeck ?? deckForLint;
    if (!finalDeck.servicePages?.length) {
      // The combined call omits servicePages often enough to make multi-page
      // output unreliable; a dedicated follow-up call is cheap and targeted.
      finalDeck.servicePages = await createServicePagesFallback({ input, apiKey, model, deck: finalDeck });
    }
    return withCompleteBodySentences(repairGeneratedCopyDeckForSlotFit(finalDeck, business));
  } catch (error) {
    console.warn(
      `OpenAI copy deck unavailable; canonical generation will fail unless the caller explicitly enabled development fallback. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

function sanitizeCorruptGlyphs(deck: GeneratedCopyDeckV2): GeneratedCopyDeckV2 {
  return sanitizeValue(structuredClone(deck)) as GeneratedCopyDeckV2;
}

function withCompleteBodySentences(deck: GeneratedCopyDeckV2): GeneratedCopyDeckV2 {
  const normalized = structuredClone(deck);
  const complete = (value: string) => completeSentence(value);
  normalized.hero.body = complete(normalized.hero.body);
  normalized.servicesIntro.body = complete(normalized.servicesIntro.body);
  normalized.serviceItems = normalized.serviceItems.map((item) => ({ ...item, body: complete(item.body) }));
  normalized.processIntro.body = complete(normalized.processIntro.body);
  normalized.processSteps = normalized.processSteps.map((step) => ({ ...step, body: complete(step.body) }));
  normalized.faqs = normalized.faqs.map((faq) => ({ ...faq, answer: complete(faq.answer) }));
  if (normalized.locationIntro) normalized.locationIntro.body = complete(normalized.locationIntro.body);
  normalized.contactIntro.body = complete(normalized.contactIntro.body);
  normalized.splitMedia.body = complete(normalized.splitMedia.body);
  if (normalized.about) normalized.about.body = complete(normalized.about.body);
  normalized.gallery.body = complete(normalized.gallery.body);
  normalized.servicePages = normalized.servicePages?.map((page) => ({
    ...page,
    hero: { ...page.hero, body: complete(page.hero.body) },
    detail: { ...page.detail, body: complete(page.detail.body) },
    faqs: page.faqs.map((faq) => ({ ...faq, answer: complete(faq.answer) }))
  }));
  return normalized;
}

function repairGeneratedCopyDeckForSlotFit(deck: GeneratedCopyDeckV2, business: BusinessProfile): GeneratedCopyDeckV2 {
  if (business.vertical !== "auto_body") return deck;
  const repaired = structuredClone(deck);
  const city = business.address?.city?.trim();
  if (isListHeavyAutoBodyHeading(repaired.hero.heading) || repaired.hero.heading.length > 56) {
    repaired.hero.heading = `${city ? `${city} ` : ""}auto body repair that looks right again.`;
  }
  if (isListHeavyAutoBodyHeading(repaired.servicesIntro.heading)) {
    repaired.servicesIntro.heading = "The visible damage is only the start.";
  }
  if (/^(inspection|estimate|quote|repair|pickup|drop[-\s]?off|from exterior damage)\b/i.test(repaired.processIntro.heading)) {
    repaired.processIntro.heading = "From first look to finished pickup.";
  }
  return polishAutoBodyGeneratedCopy(repaired);
}

function polishAutoBodyGeneratedCopy<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/\bcan ask\b/gi, "can call")
      .replace(/\bneed a shop to look at the damage\b/gi, "want the damage reviewed")
      .replace(/\bclear next steps\b/gi, "a clear plan")
      .replace(/\bfocused option\b/gi, "repair choice")
      .replace(/\bfocused help\b/gi, "direct repair help")
      .replace(/\bhelp after damage\b/gi, "repair help after a hit")
      .replace(/\bcan talk through\b/gi, "will review")
      .replace(/\bcan discuss\b/gi, "will review")
      .replace(/\bcan help with\b/gi, "handles")
      .replace(/\brepair categor(y|ies)\b/gi, "repair work")
      .replace(/\brepair path\b/gi, "repair plan")
      .replace(/\brepair conversation\b/gi, "repair estimate")
      .replace(/\bestimate conversation\b/gi, "estimate")
      .replace(/\bthe repair type\b/gi, "the repair") as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => polishAutoBodyGeneratedCopy(item)) as T;
  }
  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = polishAutoBodyGeneratedCopy(item);
    }
    return copy as T;
  }
  return value;
}

function isListHeavyAutoBodyHeading(value: string): boolean {
  const normalized = value.toLowerCase();
  const terms = normalized.match(/\b(collision|dent|dents|hail|paint|refinish|scratch|bumper|panel|glass|pdr)\b/g) ?? [];
  return terms.length >= 3 && /,|\band\b/.test(normalized);
}

function completeSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/[.!?…"')\]]\s*$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(disallowedScriptPattern, "").replace(/\s{2,}/g, " ").trim();
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      (value as Record<string, unknown>)[key] = sanitizeValue((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Editorial second pass. Takes the lint-clean draft and rewrites weak copy
 * against a strict rubric — kill hedging, drop internal taxonomy, de-repeat,
 * finish every sentence — while preserving facts and voice. Returns the refined
 * deck only when it lints clean and has strictly fewer taste issues than the
 * draft; otherwise returns undefined so the caller keeps the draft. One call,
 * skipped entirely when the draft already reads clean.
 */
async function refineGeneratedCopyDeck(args: {
  input: GeneratedCopyDeckInput;
  apiKey: string;
  model: string;
  deck: GeneratedCopyDeckV2;
  business: BusinessProfile;
  understanding: BusinessUnderstandingV2 | undefined;
  siteDirectorPlan?: SiteDirectorRuntime;
  designBrief?: DesignBrief;
}): Promise<GeneratedCopyDeckV2 | undefined> {
  const { input, apiKey, model, deck, business, understanding, siteDirectorPlan, designBrief } = args;
  const issues = detectCopyTasteIssues(deck);
  if (!issues.length) return undefined;

  const draftForEditing = { ...deck, servicePages: undefined };
  const body = {
    model,
    reasoning: { effort: "medium" },
    max_output_tokens: 6000,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are a senior conversion copywriter editing a draft homepage copy deck for a US local small business website.",
              "Return only schema-valid JSON through Structured Outputs: the full improved deck in the same shape as the draft.",
              "Rewrite weak copy to be specific, confident, and benefit-led. Cut hedging entirely — no 'when the … is a fit', 'may not need', 'can talk through', 'with room for', 'where applicable'. State what the business does and what the customer gets.",
              "Replace generic headings ('Our approach', 'What we do', 'How it works', 'Ready to get started', 'Services') with concrete headings tied to this business, vertical, and customer situation.",
              "Preserve the SiteDirectorPlanV1 structure when it is provided. Improve the words inside the planned section jobs; do not redirect the page to a different section strategy.",
              "Preserve and sharpen copyPlan first: every rewritten slot must follow the siteArgument, proofHierarchy, sectionJobs, CTA rhythm, and repetitionRisks.",
              "Never narrate internal process or category taxonomy ('repair category', 'repair path', 'repair conversation', 'estimate conversation', 'the repair type'). Name the real customer outcome instead.",
              "Eliminate repeated phrasing across sections; each section must earn its place with distinct, concrete language. Vary sentence openings.",
              "Every sentence must end complete — never clip mid-thought.",
              "Preserve the voiceProfile point of view exactly. Preserve every fact; invent nothing — no offers, prices, years in business, credentials, reviews, awards, or guarantees. Do not add claims not supported by the draft.",
              "Keep copy concise enough for the same rendered slot shape. If a block is already strong, keep it unchanged.",
              "Set servicePages to null — service landing pages are generated separately."
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
              facts: copyDeckContext(business, understanding, siteDirectorPlan, designBrief),
              voiceProfile: deck.voiceProfile,
              voiceRegisterGuidance: registerGuidance(deck.voiceProfile.register),
              issuesToFix: issues.slice(0, 20),
              draft: draftForEditing
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
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal(generatedCopyDeckRequestTimeoutMs)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    const incompleteReason = response.ok ? openAiResponseIncompleteReason(payload) : undefined;
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model: body.model,
      endpoint: "/v1/responses",
      operation: "generated_copy_deck_editor",
      status: response.ok && !incompleteReason ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok
        ? incompleteReason
          ? `Incomplete response (${incompleteReason})`
          : undefined
        : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    if (!response.ok || incompleteReason) return undefined;
    const text = extractOpenAiResponseText(payload);
    if (!text) return undefined;
    const parsed = copyDeckSchema.parse(JSON.parse(text) as unknown);
    const refined: GeneratedCopyDeckV2 = withCompleteBodySentences(sanitizeCorruptGlyphs({
      version: "generated-copy-deck-v2",
      source: "openai",
      copyPlan: parsed.copyPlan,
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
      voiceProfile: deck.voiceProfile,
      servicePages: undefined
    }));
    // Keep the edit only if it is clean and measurably tighter than the draft.
    if (lintGeneratedCopyDeck(refined, { businessName: business.name }).length) return undefined;
    if (detectCopyTasteIssues(refined).length >= issues.length) return undefined;
    return refined;
  } catch {
    return undefined;
  }
}

type DesignBrief = SiteBundle["presenceAssessment"]["designBrief"];
type SiteDirectorRuntime = SiteBundle["presenceAssessment"]["siteDirectorPlanV1"];

function copyDeckContext(
  business: BusinessProfile,
  understanding: BusinessUnderstandingV2 | undefined,
  siteDirectorPlan?: SiteDirectorRuntime,
  designBrief?: DesignBrief
) {
  // The plan→copy brief: in canonical generation SiteDirectorPlanV1 owns the
  // rendered structure, so copy is written to the exact section sequence and
  // copy jobs that will hydrate. DesignBriefV1 is kept as legacy/dev context
  // only when a director plan is absent.
  const acceptedDirectorPlan = siteDirectorPlan?.validation.status === "passed" ? siteDirectorPlan.plan : undefined;
  const plan = acceptedDirectorPlan
    ? {
        source: "site_director_v1",
        rationale: acceptedDirectorPlan.strategy.rationale,
        creativeDiversityDirective: acceptedDirectorPlan.strategy.creativeDiversityDirective,
        globalControls: acceptedDirectorPlan.globalControls,
        nav: acceptedDirectorPlan.nav,
        sectionOrder: acceptedDirectorPlan.home.sections.map((section) => ({
          id: section.id,
          role: section.role,
          templateId: section.templateId,
          presentation: section.presentation,
          background: section.background,
          ctaRole: section.ctaRole,
          copyJob: section.copyJob ?? section.copyJobId,
          assetRefs: section.assetRefs
        }))
      }
    : designBrief
      ? {
          source: "legacy_design_brief",
          register: designBrief.profile.register,
          directionRationale: designBrief.profile.rationale,
          sectionOrder: designBrief.compositionPlan?.sections.map((section) => section.intent),
          presentationMap: designBrief.presentationMap
        }
      : undefined;
  return {
    plan,
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
      serviceItemRange: [3, 6],
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
      return [
        "Auto body/collision: write for a driver with visible vehicle damage, not for a generic local-business directory.",
        "Strong section angles include what happened to the car, which panels/paint/trim need review, how driveability affects timing, and what the shop needs to inspect in person.",
        "Homepage service cards may be 3-6 concrete cards. Prefer customer-situation titles like 'Dents, hail marks, and panel damage' or 'Paint match and refinish work' over raw categories like 'Collision repair'.",
        "Service-card bodies must not repeat 'We repair', 'We provide', 'We answer', or 'tied to the damage'. Start each card from the driver's situation, the affected panel/paint/trim, or what the shop checks first.",
        "Process headings should name the step in shop terms: inspection, teardown, paint/body work, parts, drop-off timing, pickup timing. Never say 'clear next steps', 'focused help', or 'help after damage'. Do not use awkward instructions like 'show the damage from three angles'.",
        "Estimate, quote, insurance, self-pay, makes/models, certifications, warranties, OEM parts, rental/towing, and insurer names are allowed only when directly present in verified facts.",
        "Never use internal taxonomy like 'repair category', 'repair path', 'repair conversation', 'estimate conversation', 'repair type', or generic headings like 'Our approach'."
      ].join(" ");
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

const copySlotJobJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["slotId", "point", "proofToUse", "customerQuestion", "slotShape", "avoid", "genericRisk"],
  properties: {
    slotId: { type: "string", minLength: 2, maxLength: 80 },
    point: { type: "string", minLength: 8, maxLength: bodyTextMaxV2 },
    proofToUse: { type: "string", minLength: 3, maxLength: bodyTextMaxV2 },
    customerQuestion: { type: "string", minLength: 6, maxLength: bodyTextMaxV2 },
    slotShape: { type: "string", minLength: 6, maxLength: bodyTextMaxV2 },
    avoid: { type: "string", minLength: 3, maxLength: bodyTextMaxV2 },
    genericRisk: { type: "string", minLength: 6, maxLength: bodyTextMaxV2 }
  }
} as const;

const copyPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["siteArgument", "proofHierarchy", "sectionJobs", "ctaRhythm", "repetitionRisks"],
  properties: {
    siteArgument: { type: "string", minLength: 20, maxLength: bodyTextMaxV2 },
    proofHierarchy: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: { type: "string", minLength: 3, maxLength: mediumTextMaxV2 }
    },
    sectionJobs: {
      type: "array",
      minItems: 5,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sectionId", "point", "proofToUse", "customerQuestion", "slotShape", "avoid", "genericRisk", "slotJobs"],
        properties: {
          sectionId: { type: "string", minLength: 2, maxLength: 40 },
          point: { type: "string", minLength: 8, maxLength: bodyTextMaxV2 },
          proofToUse: { type: "string", minLength: 3, maxLength: bodyTextMaxV2 },
          customerQuestion: { type: "string", minLength: 6, maxLength: bodyTextMaxV2 },
          slotShape: { type: "string", minLength: 6, maxLength: bodyTextMaxV2 },
          avoid: { type: "string", minLength: 3, maxLength: bodyTextMaxV2 },
          genericRisk: { type: "string", minLength: 6, maxLength: bodyTextMaxV2 },
          slotJobs: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: copySlotJobJsonSchema
          }
        }
      }
    },
    ctaRhythm: { type: "string", minLength: 20, maxLength: bodyTextMaxV2 },
    repetitionRisks: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: { type: "string", minLength: 6, maxLength: mediumTextMaxV2 }
    }
  }
} as const;

const servicePageItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["serviceName", "hero", "detail", "faqs", "seo"],
  properties: {
    serviceName: { type: "string", minLength: 3, maxLength: shortTextMaxV2 },
    hero: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", minLength: 10, maxLength: shortTextMaxV2 },
        body: { type: "string", minLength: 30, maxLength: bodyTextMaxV2 }
      }
    },
    detail: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", minLength: 8, maxLength: shortTextMaxV2 },
        body: { type: "string", minLength: 60, maxLength: bodyTextMaxV2 }
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
          question: { type: "string", minLength: 10, maxLength: shortTextMaxV2 },
          answer: { type: "string", minLength: 20, maxLength: bodyTextMaxV2 }
        }
      }
    },
    seo: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description"],
      properties: {
        title: { type: "string", minLength: 10, maxLength: seoTitleMaxV2 },
        description: { type: "string", minLength: 40, maxLength: seoDescriptionMaxV2 }
      }
    }
  }
} as const;

const copyDeckResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "copyPlan",
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
    copyPlan: copyPlanJsonSchema,
    hero: {
      type: "object",
      additionalProperties: false,
      required: ["eyebrow", "heading", "body"],
      properties: {
        eyebrow: { type: ["string", "null"], minLength: 3, maxLength: shortTextMaxV2 },
        heading: { type: "string", minLength: 10, maxLength: shortTextMaxV2 },
        body: { type: "string", minLength: 30, maxLength: bodyTextMaxV2 }
      }
    },
    servicesIntro: copyBlockJsonSchema(shortTextMaxV2, bodyTextMaxV2),
    serviceItems: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: {
          title: { type: "string", minLength: 3, maxLength: shortTextMaxV2 },
          body: { type: "string", minLength: 20, maxLength: bodyTextMaxV2 }
        }
      }
    },
    processIntro: copyBlockJsonSchema(shortTextMaxV2, bodyTextMaxV2),
    processSteps: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: {
          title: { type: "string", minLength: 4, maxLength: shortTextMaxV2 },
          body: { type: "string", minLength: 20, maxLength: bodyTextMaxV2 }
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
          question: { type: "string", minLength: 10, maxLength: shortTextMaxV2 },
          answer: { type: "string", minLength: 20, maxLength: bodyTextMaxV2 }
        }
      }
    },
    locationIntro: {
      anyOf: [copyBlockJsonSchema(shortTextMaxV2, bodyTextMaxV2), { type: "null" }]
    },
    contactIntro: copyBlockJsonSchema(shortTextMaxV2, bodyTextMaxV2),
    splitMedia: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", minLength: 10, maxLength: shortTextMaxV2 },
        body: { type: "string", minLength: 40, maxLength: bodyTextMaxV2 }
      }
    },
    about: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["heading", "body"],
          properties: {
            heading: { type: "string", minLength: 8, maxLength: shortTextMaxV2 },
            body: { type: "string", minLength: 60, maxLength: bodyTextMaxV2 }
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
        heading: { type: "string", minLength: 8, maxLength: shortTextMaxV2 },
        body: { type: "string", minLength: 30, maxLength: bodyTextMaxV2 }
      }
    },
    seo: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description"],
      properties: {
        title: { type: "string", minLength: 10, maxLength: seoTitleMaxV2 },
        description: { type: "string", minLength: 40, maxLength: seoDescriptionMaxV2 }
      }
    },
    groundingNotes: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: bodyTextMaxV2 } },
    servicePages: { type: "null" }
  }
};
