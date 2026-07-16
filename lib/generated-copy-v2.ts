import { z } from "zod";
import { refreshSiteDossierCopyBriefV1 } from "./site-dossier-v1";
import type { BusinessProfile, BusinessUnderstandingV2, GeneratedCopyDeckV2, SiteBundle } from "./models";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import { extractOpenAiUsage, sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";
import { elapsedOpenAiCallMs, extractOpenAiResponseText, openAiErrorMessage, openAiResponseIncompleteReason } from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import { generationFailure, type GenerationFailureCode } from "./generation-failure";
import {
  generatedSiteVerticalQualityProfileForBusinessV1,
  serviceSemanticGroupForProfileV1
} from "./generated-site-v3-quality-profiles";
import { copyPhrasePolicyForBusinessV1, copyPhrasePolicyPromptV1, copyPhrasePolicyViolationsV1 } from "./copy-phrase-policy-v1";
import { autoBodyServiceDescriptionV1 } from "./auto-body-service-copy-v1";
import { trustEvidenceItemsV1, type SiteEvidenceLedgerV1 } from "./evidence-ledger-v1";

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
  { pattern: /\b(this website|this site was|generated (site|preview)|placeholder|lorem ipsum)\b/i, reason: "Generation meta language is visible." }
];
const unverifiableClaimPattern = /\b(award[- ]winning|certified|guaranteed|#1|best in|(?:free|complimentary)\s+(?:repair\s+)?(?:estimate|quote|consultation))\b/i;

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
    .slice(0, 4);
  if (!pageWorthy.length) return undefined;

  const body = {
    model: args.model,
    reasoning: { effort: "low" },
    // Full landing pages (hero + detail + 4 FAQs + SEO each) need headroom
    // or the fallback can truncate and waste the call.
    max_output_tokens: 7000,
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
            servicePages: { type: "array", minItems: 1, maxItems: 4, items: servicePageItemJsonSchema }
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
      signal: openAiRequestSignal(generatedCopyDeckRequestTimeoutMs, args.input.signal)
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
    const parsed = z.object({ servicePages: z.array(servicePageSchemaV2).min(1).max(4) }).parse(JSON.parse(text) as unknown);
    const candidate: GeneratedCopyDeckV2 = { ...args.deck, servicePages: parsed.servicePages };
    return lintGeneratedCopyDeck(candidate, {
      businessName: business.name,
      business,
      approvedClaimTexts: approvedClaimTextsForBundleV1(args.input.bundle)
    }).length
      ? undefined
      : parsed.servicePages;
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

export function lintGeneratedCopyDeck(
  deck: GeneratedCopyDeckV2,
  context?: { businessName?: string; business?: BusinessProfile; approvedClaimTexts?: string[] }
): string[] {
  const violations: string[] = [];
  const texts = collectDeckTexts(deck);
  const approvedClaimTexts = approvedClaimTextsV1(context?.business, context?.approvedClaimTexts);
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
    if (unverifiableClaimPattern.test(withProtectedApprovedClaimsV1(text, approvedClaimTexts).value)) {
      violations.push(`Unverifiable superlative, credential, warranty, or offer claim. Text: "${text.slice(0, 80)}"`);
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
  const groundedServiceMinimum = context?.business
    ? Math.min(3, uniqueServiceTitlesBySemanticGroup(context.business.services, context.business).length)
    : 3;
  if (deck.serviceItems.length < groundedServiceMinimum) {
    violations.push(`Fewer than ${groundedServiceMinimum} grounded service items remained after service-title validation.`);
  }
  if (context?.business) violations.push(...factConsistencyViolations(deck, context.business, approvedClaimTexts));
  if (context?.business) violations.push(...copyPhrasePolicyViolationsV1(deck, context.business));
  return violations;
}

function factConsistencyViolations(deck: GeneratedCopyDeckV2, business: BusinessProfile, approvedClaimTexts: string[] = []): string[] {
  const violations: string[] = [];
  const hoursByDay = businessHoursByDay(business.hours);
  const sourceText = normalizeFactText({
    phone: business.phone,
    email: business.email,
    address: business.address,
    hours: business.hours,
    services: business.services,
    serviceHighlights: business.serviceHighlights,
    serviceAreas: business.serviceAreas,
    credentials: business.credentials,
    offers: business.offers,
    approvedClaimTexts
  });
  const allowedServices = business.services.map(normalizeFactText).filter(Boolean);
  const serviceClaims = [
    ...deck.serviceItems.map((item) => item.title),
    ...(deck.servicePages ?? []).map((page) => page.serviceName)
  ];
  for (const service of serviceClaims) {
    const normalized = normalizeFactText(service);
    if (normalized && allowedServices.length && !allowedServices.some((allowed) => serviceClaimBackedByFact(normalized, allowed))) {
      violations.push(`Unsupported service claim: "${service}" is not in the business fact service list.`);
    }
  }

  for (const text of collectDeckTexts(deck)) {
    for (const phone of text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? []) {
      if (normalizeDigits(phone) !== normalizeDigits(business.phone ?? "")) {
        violations.push(`Unsupported phone claim: "${phone}" is not the business phone fact.`);
      }
    }
    for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
      if (email.toLowerCase() !== (business.email ?? "").toLowerCase()) {
        violations.push(`Unsupported email claim: "${email}" is not the business email fact.`);
      }
    }
    for (const amount of text.match(/\$\s*\d[\d,]*(?:\.\d{2})?/g) ?? []) {
      if (!sourceText.includes(normalizeFactText(amount))) {
        violations.push(`Unsupported price claim: "${amount}" is not present in business facts.`);
      }
    }
    for (const offer of text.match(/\b(?:free|complimentary)\s+(?:repair\s+)?(?:estimate|quote|consultation)\b/gi) ?? []) {
      if (!sourceText.includes(normalizeFactText(offer))) {
        violations.push(`Unsupported offer claim: "${offer}" is not present in approved business facts.`);
      }
    }
    const dayClaim = text.match(/\b(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i)?.[0];
    const normalizedDay = dayClaim ? normalizeWeekday(dayClaim) : undefined;
    const dayHours = normalizedDay ? hoursByDay.get(normalizedDay) : undefined;
    if (normalizedDay && !dayHours) {
      violations.push(`Unsupported hours/day claim: "${dayClaim}" is not present in business hours facts.`);
    }
    if (normalizedDay && dayHours && /\bclosed\b/i.test(dayHours) && /\b(open|available|pickup|walk-?in|appointment|service)\b/i.test(text)) {
      violations.push(`Unsupported hours/day availability claim: "${dayClaim}" is closed in business hours facts.`);
    }
    for (const time of text.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi) ?? []) {
      if (!sourceText.includes(normalizeFactText(time))) {
        violations.push(`Unsupported time claim: "${time}" is not present in business hours facts.`);
      }
    }
  }
  return [...new Set(violations)];
}

function normalizeFactText(value: unknown): string {
  return JSON.stringify(value ?? "")
    .toLowerCase()
    .replace(/\ba\.?m\.?\b/g, "am")
    .replace(/\bp\.?m\.?\b/g, "pm")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigits(value: string) {
  return value.replace(/\D+/g, "").replace(/^1(?=\d{10}$)/, "");
}

function serviceClaimBackedByFact(claim: string, fact: string) {
  if (claim === fact) return true;
  if (claim.includes(fact) || fact.includes(claim)) return true;
  const claimTokens = serviceTokens(claim);
  if (!claimTokens.length) return false;
  const factTokens = new Set(serviceTokens(fact));
  const overlap = claimTokens.filter((token) => factTokens.has(token)).length;
  return overlap >= Math.min(2, claimTokens.length) && overlap / claimTokens.length >= 0.5;
}

function serviceTokens(value: string) {
  const stop = new Set(["and", "or", "the", "for", "with", "service", "services"]);
  return value.split(" ").filter((token) => token.length >= 3 && !stop.has(token));
}

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Weekday = (typeof weekdays)[number];

function businessHoursByDay(hours: Record<string, string> | undefined) {
  const byDay = new Map<Weekday, string>();
  for (const [label, value] of Object.entries(hours ?? {})) {
    const days = weekdaysForHoursLabel(`${label} ${value}`);
    for (const day of days) byDay.set(day, value);
  }
  return byDay;
}

function weekdaysForHoursLabel(label: string): Weekday[] {
  const text = label.toLowerCase();
  const direct = weekdays.filter((day) => text.includes(day) || text.includes(day.slice(0, 3)));
  const range = text.match(/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b\s*(?:[–—-]|to)\s*\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i);
  if (!range) return direct;
  const start = normalizeWeekday(range[1]);
  const end = normalizeWeekday(range[2]);
  if (!start || !end) return direct;
  const startIndex = weekdays.indexOf(start);
  const endIndex = weekdays.indexOf(end);
  if (startIndex < 0 || endIndex < 0) return direct;
  if (startIndex <= endIndex) return weekdays.slice(startIndex, endIndex + 1);
  return [...weekdays.slice(startIndex), ...weekdays.slice(0, endIndex + 1)];
}

function normalizeWeekday(value: string): Weekday | undefined {
  const key = value.toLowerCase().slice(0, 3);
  return weekdays.find((day) => day.startsWith(key));
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

export type GeneratedCopyDeckInput = {
  bundle: SiteBundle;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
  failureMode?: "return_undefined" | "throw";
  regenerationFeedback?: string[];
};

export async function createOpenAiGeneratedCopyDeck(
  input: GeneratedCopyDeckInput
): Promise<GeneratedCopyDeckV2 | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return handleCopyDeckFailure(input, new Error("OPENAI_API_KEY is not configured."), "copy_unavailable");
  }
  const runtimeSettings = await getOpenAiRuntimeSettings();
  const business = input.bundle.businessProfile;
  const understanding = input.bundle.presenceAssessment.businessUnderstanding;
  const siteDirectorPlan = input.bundle.presenceAssessment.siteDirectorPlanV1;
  const siteDossier = refreshSiteDossierCopyBriefV1(input.bundle);
  input.bundle.presenceAssessment.siteDossierV1 = siteDossier;
  const copyBrief = siteDossier.copyBrief;
  const model = runtimeSettings.settings.generationModel;
  const conflictedYears = claimConflictYearsForCopyV1(input.bundle.presenceAssessment.evidenceLedgerV1);
  const approvedClaimTexts = approvedClaimTextsForBundleV1(input.bundle);
  const baseCopyContext = {
    ...copyDeckContext(business, understanding, siteDirectorPlan, siteDossier, input.bundle.presenceAssessment.evidenceLedgerV1),
    copyBrief,
    copyPhrasePolicy: copyPhrasePolicyPromptV1(copyPhrasePolicyForBusinessV1(business)),
    voiceProfile: copyBrief.voiceProfile,
    voiceRegisterGuidance: copyBrief.voiceGuidance
  };

  const buildBody = (maxOutputTokens: number, copyContext: typeof baseCopyContext & { copyRegenerationFeedback?: string[] }) => ({
    model,
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
              "Ground every sentence in the provided verified facts. Never invent offers, prices, years in business, ownership structure, family-owned claims, values claims, credentials, reviews, awards, warranties, or guarantees.",
              "Start with copyPlan before writing slots: define the site argument, proof hierarchy, structured section jobs, CTA rhythm, and repetition risks. Every sectionJob must include point, proofToUse, customerQuestion, slotShape, avoid, genericRisk, and slotJobs for the rendered slots it owns.",
              "When a SiteDirectorPlanV1 is provided, write the copy deck to fit that exact planned page: section order, selected geometry, CTA roles, copy jobs, navigation, and service-page strategy. Do not invent a different structure.",
              "Write specific, concrete copy about what the business actually does, in plain confident language a local customer would trust.",
              "Exact-claim rule: never include exact email addresses, phone numbers, dollar amounts, clock times, dates, days, guarantees, certifications, awards, or #1/best claims unless the exact value appears in allowedExactClaims or verifiedFacts. If the exact value is not listed, use general language such as published hours, current pricing, call, visit, or contact instead.",
              "When rules.claimConflicts is present, every listed value is blocked from customer-facing copy until owner review. Preserve the conflict-free substance, but never choose a side or repeat a blocked value.",
              "Write to fit the planned rendered slots: concise headings, tight card bodies, and complete sentences. The schema allows headroom so strong copy is not rejected; do not use that headroom as permission to ramble.",
              "serviceItems.title and servicePages.serviceName must be exact or near-exact services from verifiedFacts.services or rules.serviceTitleOptions. Do not use amenities, party size, dietary questions, payment questions, contact logistics, or generic customer concerns as service titles.",
              "For each serviceItems.body, use only the scope explicitly stated by that service's verifiedFacts.services sourceText. If sourceText only names the service, describe the service at that same broad level. Never add parts, procedures, inspection steps, materials, eligibility conditions, or promised outcomes from general trade knowledge.",
              "Every major heading must sound like it belongs on this exact business's website. Never use generic headings like 'Our approach', 'What we do', 'How it works', 'Ready to get started', 'Services', or 'Choose the service'.",
              "Avoid generated local-service filler such as 'clear next steps', 'focused help', 'help after', 'practical support', or 'need a shop to look at the damage'. Say the concrete vehicle condition, repair work, visit detail, or source-backed claim/self-pay fact instead.",
              "Do not let every section become intake instructions. Service, proof, process, and media sections should mostly describe the work, standards, visible outcomes, and practical customer decisions; reserve 'send photos', 'share details', and call-prep language for contact or quote sections.",
              "processIntro/processSteps: describe the real decision path and quality checks. Do not dump the service taxonomy into step titles or bodies. Never repeat four or more service names in the process section; each step must have a distinct job such as inspection, estimate/claim path, repair work, quality check, pickup.",
              "Never write copy about how to contact a business or what to include in a message; write about the services, the work, and practical customer questions (pricing expectations only if a verified price exists, turnaround, what to bring, walk-ins).",
              "Voice: write in the requested voiceProfile point of view. first_plural speaks as the business ('we', 'our shop'); first_singular speaks as the individual ('I'); brand_direct uses the business name sparingly and confident declarative statements. Never write like a third-party directory describing the business.",
              "Never write meta copy about the website itself or instruct visitors how to use it (no 'use the photos', 'fill out the form', 'this site shows').",
              "Never mention source information, provided facts, extracted data, the dossier, or any other provenance mechanism in customer-facing copy. State only the supported business fact itself.",
              "When copyPhrasePolicy is present, treat its constrained phrases as banned same-vertical constructions. Do not paraphrase them closely; choose a different concrete angle supported by facts.",
              "splitMedia: a short approach/working-with-us section shown beside an approved supporting business image. Do not assume the image is a workshop, employee, process, or completed job; keep the copy grounded in verified facts.",
              "gallery: a short intro for a photo gallery of the work — about the work in the photos, never about the photos as photos.",
              "splitMedia and gallery must have distinct headlines, distinct bodies, and distinct section jobs. Never reuse the same phrase, angle, or sentence across those two sections.",
              "about: when businessStory is provided, write the about section as the story's centerpiece — founders, family, history, personalities, told warmly and concretely in the business voice. Real names and details from the story verbatim. Null only when there is no story.",
              "Never include internal labels, vertical slugs, scraped key names, live open/closed status, or meta commentary about the website.",
              "FAQ answers must answer real customer questions about the trade, not questions about messaging the business.",
              "groundingNotes must list which provided facts each major claim relies on.",
              "When siteDossier is provided, use it for source-specific emphasis and vocabulary. Treat review evidence as private positioning input only: never quote, attribute, or originate claims from third-party review text or ratings.",
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
            text: JSON.stringify(copyContext)
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
  type CopyDeckGenerationResult = {
    text: string;
    generatedAt: string;
    copyContext: typeof baseCopyContext & { copyRegenerationFeedback?: string[] };
  };
  const generateCopyDeckText = async (copyRegenerationFeedback?: string[]): Promise<CopyDeckGenerationResult> => {
    const copyContext =
      copyRegenerationFeedback?.length
        ? { ...baseCopyContext, copyRegenerationFeedback: copyRegenerationFeedback.slice(0, 8) }
        : baseCopyContext;
    let text: string | undefined;
    let lastError: unknown;
    let generatedAt = new Date().toISOString();

    for (let attempt = 0; attempt < tokenBudgets.length; attempt += 1) {
      const body = buildBody(tokenBudgets[attempt], copyContext);
      const startedAt = new Date().toISOString();
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: openAiRequestSignal(generatedCopyDeckRequestTimeoutMs, input.signal)
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        const endedAt = new Date().toISOString();
        generatedAt = endedAt;
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
          throw copyDeckError(
            openAiErrorMessage(payload) ?? `OpenAI copy deck generation failed with status ${response.status}`,
            copyFailureCodeForHttpPayload(payload)
          );
        }
        if (incompleteReason) {
          lastError = copyDeckError(`OpenAI copy deck response was incomplete (${incompleteReason}).`, "copy_incomplete_response");
          continue;
        }
        text = extractOpenAiResponseText(payload);
        if (!text) throw copyDeckError("OpenAI copy deck response did not include output text.", "copy_empty_output");
        break;
      } catch (error) {
        lastError = copyDeckTypedError(error);
        break;
      }
    }

    if (!text) {
      throw lastError instanceof Error ? lastError : copyDeckError("OpenAI copy deck generation failed.", "copy_unavailable");
    }
    return { text, generatedAt, copyContext };
  };

  const parseCopyDeckGeneration = (generation: CopyDeckGenerationResult): GeneratedCopyDeckV2 => {
    let parsed: z.infer<typeof copyDeckSchema>;
    try {
      parsed = copyDeckSchema.parse(JSON.parse(generation.text) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) throw copyDeckError(`OpenAI copy deck returned invalid JSON: ${error.message}`, "copy_invalid_json");
      if (error instanceof z.ZodError) {
        throw generationFailure(error, {
          stage: "copy",
          code: "copy_validation_failed",
          message: `OpenAI copy deck failed schema validation: ${error.issues.map((issue) => issue.message).join("; ")}`,
          validationIssues: error.issues
        });
      }
      throw error;
    }
    return {
      version: "generated-copy-deck-v2",
      source: "openai",
      provenance: createRegenerableArtifactProvenanceV1({
        producerId: "generated-copy-deck-v2",
        producerVersion: "generated-copy-deck-v2",
        modelId: model,
        createdAt: generation.generatedAt,
        inputs: { copyContext: generation.copyContext }
      }),
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
      voiceProfile: copyBrief.voiceProfile,
      servicePages: parsed.servicePages ?? undefined
    };
  };

  try {
    const retryFeedback = input.regenerationFeedback?.filter(Boolean).slice(0, 12);
    let deckForLint = prepareGeneratedCopyDeckForLint(parseCopyDeckGeneration(await generateCopyDeckText(retryFeedback)), business, {
      conflictedYears,
      approvedClaimTexts
    });
    let violations = lintGeneratedCopyDeck(deckForLint, { businessName: business.name, business, approvedClaimTexts });
    if (violations.some(isCopyPhrasePolicyViolation)) {
      const phraseFeedback = copyRegenerationFeedbackForViolations(violations);
      deckForLint = prepareGeneratedCopyDeckForLint(
        parseCopyDeckGeneration(await generateCopyDeckText([...(retryFeedback ?? []), ...phraseFeedback])),
        business,
        { conflictedYears, approvedClaimTexts }
      );
      violations = lintGeneratedCopyDeck(deckForLint, { businessName: business.name, business, approvedClaimTexts });
    }
    if (violations.length) {
      throw generationFailure(new Error(`Generated copy deck failed content lint: ${violations.join(" | ")}`), {
        stage: "copy",
        code: "copy_lint_rejected",
        validationIssues: violations
      });
    }
    const finalDeck = deckForLint;
    if (!finalDeck.servicePages?.length) {
      // The combined call omits servicePages often enough to make multi-page
      // output unreliable; a dedicated follow-up call is cheap and targeted.
      finalDeck.servicePages = await createServicePagesFallback({ input, apiKey, model, deck: finalDeck });
    }
    return prepareGeneratedCopyDeckForLint(finalDeck, business, { conflictedYears, approvedClaimTexts });
  } catch (error) {
    return handleCopyDeckFailure(input, error, copyFailureCodeForError(error));
  }
}

function isCopyPhrasePolicyViolation(violation: string) {
  return /^Copy phrase policy\b/.test(violation);
}

function copyRegenerationFeedbackForViolations(violations: string[]): string[] {
  const phrasePolicyViolations = violations.filter(isCopyPhrasePolicyViolation);
  if (!phrasePolicyViolations.length) return [];
  return [
    "The previous copy deck failed the versioned same-vertical phrase policy. Rewrite the full deck with different sentence structures and more business-specific service detail.",
    ...phrasePolicyViolations
  ];
}

function handleCopyDeckFailure(input: GeneratedCopyDeckInput, error: unknown, code: GenerationFailureCode) {
  const failure = generationFailure(error, {
    stage: "copy",
    code
  });
  if (input.failureMode === "throw") throw failure;
  console.warn(
    `OpenAI copy deck unavailable; canonical generation will fail unless the caller explicitly enabled development fallback. ${failure.detail.message}`
  );
  return undefined;
}

function copyDeckError(message: string, code: GenerationFailureCode) {
  const error = new Error(message) as Error & { generationFailureCode?: GenerationFailureCode };
  error.generationFailureCode = code;
  return error;
}

function copyDeckTypedError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return copyDeckError(error.message || "OpenAI copy deck request timed out.", "copy_timeout");
  return error;
}

function copyFailureCodeForError(error: unknown): GenerationFailureCode {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: { code?: string } }).detail;
    if (typeof detail?.code === "string") return detail.code as GenerationFailureCode;
  }
  if (error instanceof Error && "generationFailureCode" in error) {
    const code = (error as Error & { generationFailureCode?: GenerationFailureCode }).generationFailureCode;
    if (code) return code;
  }
  if (error instanceof SyntaxError) return "copy_invalid_json";
  if (error instanceof z.ZodError) return "copy_validation_failed";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("abort") || message.includes("timed out") || message.includes("timeout")) return "copy_timeout";
  if (message.includes("refusal") || message.includes("refused")) return "copy_refusal";
  if (message.includes("lint")) return "copy_lint_rejected";
  if (message.includes("json")) return "copy_invalid_json";
  if (message.includes("validation")) return "copy_validation_failed";
  if (message.includes("output text") || message.includes("empty")) return "copy_empty_output";
  return "copy_unavailable";
}

function copyFailureCodeForHttpPayload(payload: unknown): GenerationFailureCode {
  const message = openAiErrorMessage(payload)?.toLowerCase() ?? "";
  if (message.includes("refusal") || message.includes("refused") || message.includes("safety")) return "copy_refusal";
  return "copy_http_error";
}

function sanitizeCorruptGlyphs(deck: GeneratedCopyDeckV2): GeneratedCopyDeckV2 {
  return sanitizeValue(structuredClone(deck)) as GeneratedCopyDeckV2;
}

export function prepareGeneratedCopyDeckForLint(
  deck: GeneratedCopyDeckV2,
  business: BusinessProfile,
  options: { conflictedYears?: string[]; approvedClaimTexts?: string[] } = {}
): GeneratedCopyDeckV2 {
  const conflictSafe = stripConflictedYearsFromCopyV1(deck, options.conflictedYears ?? []);
  const canonicalName = canonicalizeBusinessNameReferencesV1(conflictSafe, business.name);
  return withCompleteBodySentences(
    repairUnsupportedFactClaims(
      repairGeneratedCopyDeckForSlotFit(sanitizeCorruptGlyphs(canonicalName), business),
      business,
      options.approvedClaimTexts
    )
  );
}

function canonicalizeBusinessNameReferencesV1<T>(value: T, businessName: string): T {
  const tokens = businessName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return value;
  const pattern = new RegExp(`\\b${tokens.map(escapeRegexV1).join("[\\s-]*")}\\b`, "gi");
  return mapCopyStringsV1(value, (text) => text.replace(pattern, businessName));
}

function stripConflictedYearsFromCopyV1<T>(value: T, years: string[]): T {
  if (!years.length) return value;
  const yearPattern = years.map(escapeRegexV1).join("|");
  const precededYear = new RegExp(`\\s+\\b(?:in|since)\\s+(?:${yearPattern})\\b`, "gi");
  const remainingYear = new RegExp(`\\b(?:${yearPattern})\\b`, "g");
  return mapCopyStringsV1(value, (text) =>
    text
      .replace(precededYear, "")
      .replace(remainingYear, "")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

function mapCopyStringsV1<T>(value: T, map: (text: string) => string): T {
  if (typeof value === "string") return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapCopyStringsV1(item, map)) as T;
  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = mapCopyStringsV1(item, map);
    return copy as T;
  }
  return value;
}

function escapeRegexV1(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      .replace(/\breview the estimate route\b/gi, "review the repair estimate")
      .replace(
        /\ba detailed repair estimate supports the decision between an insurance claim and self-pay work\b/gi,
        "Review the proposed repair work and decide whether to use insurance or pay directly"
      )
      .replace(
        /\bthe estimate provides the basis for reviewing the repair work\b/gi,
        "Use the estimate to review the proposed repair work"
      )
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

function repairUnsupportedFactClaims(deck: GeneratedCopyDeckV2, business: BusinessProfile, approvedClaimTexts: string[] = []): GeneratedCopyDeckV2 {
  const context = factClaimRepairContext(business, approvedClaimTexts);
  const repaired = repairUnsupportedServiceTitles(structuredClone(deck), business);
  return repairUnsupportedFactClaimsInValue(repaired, context) as GeneratedCopyDeckV2;
}

type FactClaimRepairContext = {
  sourceText: string;
  approvedClaimTexts: string[];
  allowedWeekdays: Set<Weekday>;
  allowedEmail?: string;
  allowedEmailLower?: string;
  allowedPhone?: string;
  allowedPhoneDigits?: string;
};

function factClaimRepairContext(business: BusinessProfile, approvedClaimTexts: string[] = []): FactClaimRepairContext {
  const email = business.email?.trim();
  const phone = business.phone?.trim();
  const hoursByDay = businessHoursByDay(business.hours);
  const approvedClaims = approvedClaimTextsV1(business, approvedClaimTexts);
  return {
    sourceText: normalizeFactText({
      phone: business.phone,
      email: business.email,
      address: business.address,
      hours: business.hours,
      services: business.services,
      serviceHighlights: business.serviceHighlights,
      serviceAreas: business.serviceAreas,
      credentials: business.credentials,
      offers: business.offers,
      approvedClaimTexts: approvedClaims
    }),
    approvedClaimTexts: approvedClaims,
    allowedWeekdays: new Set([...hoursByDay.entries()].filter(([, hours]) => !/\bclosed\b/i.test(hours)).map(([day]) => day)),
    allowedEmail: email || undefined,
    allowedEmailLower: email?.toLowerCase(),
    allowedPhone: phone || undefined,
    allowedPhoneDigits: phone ? normalizeDigits(phone) : undefined
  };
}

function repairUnsupportedServiceTitles(deck: GeneratedCopyDeckV2, business: BusinessProfile): GeneratedCopyDeckV2 {
  const allowedServices = uniqueServiceTitlesBySemanticGroup(business.services, business);
  if (!allowedServices.length) return deck;
  const repairServiceItems = (items: GeneratedCopyDeckV2["serviceItems"]): GeneratedCopyDeckV2["serviceItems"] => {
    const used = new Set<string>();
    const repaired = items.flatMap((item) => {
      const title = repairTitle(item.title, used, allowedServices, business);
      return title ? [{ ...item, title }] : [];
    });
    if (business.vertical !== "auto_body") return repaired;
    return allowedServices.slice(0, 6).map((service) => {
      const semanticKey = serviceTitleSemanticKey(service, business);
      const modelItem = repaired.find((item) => serviceTitleSemanticKey(item.title, business) === semanticKey);
      return {
        title: service,
        body: modelItem?.body ?? autoBodyServiceDescriptionV1(service)
      };
    });
  };
  const repairServicePages = <T extends { serviceName: string }>(items: T[] | undefined): T[] | undefined => {
    if (!items) return undefined;
    const used = new Set<string>();
    return items.flatMap((item) => {
      const serviceName = repairTitle(item.serviceName, used, allowedServices, business);
      return serviceName ? [{ ...item, serviceName }] : [];
    });
  };

  deck.serviceItems = repairServiceItems(deck.serviceItems);
  deck.servicePages = repairServicePages(deck.servicePages);
  return deck;
}

function repairTitle(
  title: string,
  used: Set<string>,
  allowedServices: string[],
  business: BusinessProfile
): string | undefined {
  const normalized = normalizeFactText(title);
  const semanticKey = serviceTitleSemanticKey(title, business);
  if (normalized && allowedServices.some((service) => serviceClaimBackedByFact(normalized, normalizeFactText(service)))) {
    if (!used.has(semanticKey)) {
      used.add(semanticKey);
      return title;
    }
  }
  // Reassigning an invalid or duplicate title to another service also reassigns
  // its body, creating a grounded-looking but semantically false pairing. Drop
  // the item and let the minimum-count lint reject a sparse deck instead.
  return undefined;
}

function uniqueServiceTitlesBySemanticGroup(services: string[], business: BusinessProfile): string[] {
  const seen = new Set<string>();
  return services
    .map((service) => service.trim())
    .filter(Boolean)
    .filter((service) => {
      const key = serviceTitleSemanticKey(service, business);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function serviceTitleSemanticKey(title: string, business: BusinessProfile): string {
  const profile = generatedSiteVerticalQualityProfileForBusinessV1(business);
  return serviceSemanticGroupForProfileV1(profile, title)?.id ?? normalizeFactText(title);
}

function repairUnsupportedFactClaimsInValue(value: unknown, context: FactClaimRepairContext): unknown {
  if (typeof value === "string") return repairUnsupportedFactClaimsInText(value, context);
  if (Array.isArray(value)) return value.map((item) => repairUnsupportedFactClaimsInValue(item, context));
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      (value as Record<string, unknown>)[key] = repairUnsupportedFactClaimsInValue((value as Record<string, unknown>)[key], context);
    }
  }
  return value;
}

function repairUnsupportedFactClaimsInText(value: string, context: FactClaimRepairContext): string {
  const protectedClaims = withProtectedApprovedClaimsV1(value, context.approvedClaimTexts);
  let repaired = protectedClaims.value
    .replace(/\baward[- ]winning\b/gi, "local")
    .replace(/\bcertified\b/gi, "experienced")
    .replace(/\bguaranteed\b/gi, "confirmed")
    .replace(/#\s*1\b/gi, "local")
    .replace(/\bbest in\b/gi, "serving")
    .replace(/\b(?:free|complimentary)\s+(?:repair\s+)?(estimate|quote|consultation)\b/gi, "$1");
  repaired = protectedClaims.restore(repaired);

  repaired = repaired.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => {
    if (context.allowedEmailLower && email.toLowerCase() === context.allowedEmailLower) return email;
    return context.allowedEmail ?? "the team";
  });

  repaired = repaired.replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, (phone) => {
    if (context.allowedPhoneDigits && normalizeDigits(phone) === context.allowedPhoneDigits) return phone;
    return context.allowedPhone ?? "the business";
  });

  repaired = repaired.replace(/\$\s*\d[\d,]*(?:\.\d{2})?/g, (amount) => {
    return context.sourceText.includes(normalizeFactText(amount)) ? amount : "current pricing";
  });

  repaired = repaired.replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, (time) => {
    return context.sourceText.includes(normalizeFactText(time)) ? time : "published hours";
  });

  repaired = repaired.replace(/\b(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi, (day) => {
    const normalized = normalizeWeekday(day);
    return normalized && context.allowedWeekdays.has(normalized) ? day : "published service days";
  });

  return repaired
    .replace(/\bcurrent pricing\s*,\s*current pricing\b/gi, "current pricing")
    .replace(/\bpublished hours\s*,\s*published hours\b/gi, "published hours")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*([,;:])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type SiteDirectorRuntime = SiteBundle["presenceAssessment"]["siteDirectorPlanV1"];

function copyDeckContext(
  business: BusinessProfile,
  understanding: BusinessUnderstandingV2 | undefined,
  siteDirectorPlan?: SiteDirectorRuntime,
  siteDossier?: SiteBundle["presenceAssessment"]["siteDossierV1"],
  evidenceLedger?: SiteEvidenceLedgerV1
) {
  // The plan→copy brief: in canonical generation SiteDirectorPlanV1 owns the
  // rendered structure, so copy is written to the exact section sequence and
  // copy jobs that will hydrate.
  const acceptedDirectorPlan = siteDirectorPlan?.validation.status === "passed" ? siteDirectorPlan.plan : undefined;
  const plan = acceptedDirectorPlan
    ? {
        source: "site_director_v1",
        rationale: acceptedDirectorPlan.strategy.rationale,
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
    : undefined;
  return {
    plan,
    verifiedFacts: {
      businessName: business.name,
      verticalLabel: business.categories[0],
      city: business.address?.city,
      region: business.address?.region,
      street: business.address?.street,
      phone: business.phone,
      email: business.email,
      phoneAvailable: Boolean(business.phone),
      services: understanding?.cleanedServices.length
        ? understanding.cleanedServices.map((service) => ({
            name: service.name,
            price: service.price,
            sourceText: service.sourceText
          }))
        : business.services.map((service) => ({ name: service })),
      serviceHighlights: business.serviceHighlights ?? [],
      hours: business.hours,
      serviceAreas: business.serviceAreas,
      reviewsSummary: business.reviewsSummary,
      description: business.description,
      trustClaims: trustEvidenceItemsV1(evidenceLedger).map((item) => ({
        kind: item.kind,
        text: item.value.text,
        displayText: item.value.displayText,
        sourceUrl: item.source.url
      }))
    },
    understanding: understanding
      ? {
          vertical: understanding.vertical,
          detectedSubverticals: understanding.detectedSubverticals,
          businessStory: conflictSafeBusinessStoryForCopyV1(understanding.businessStory, claimConflictYearsForCopyV1(evidenceLedger)),
          primaryConversionGoal: understanding.primaryConversionGoal,
          urgentServiceSignals: understanding.urgentServiceSignals,
          notes: understanding.notes
        }
      : undefined,
    siteDossier: siteDossier
      ? {
          version: siteDossier.version,
          contentHash: siteDossier.contentHash,
          sourcePageCount: siteDossier.sourcePageCount,
          proseCharCount: siteDossier.proseCharCount,
          reviewEvidenceCount: siteDossier.reviewEvidence.length
        }
      : undefined,
    rules: {
      faqCount: 4,
      serviceItemRange: [3, 6],
      processStepRange: [3, 4],
      conversionStyle: conversionStyleForBusiness(business),
      verticalPlaybook: verticalCopyPlaybook(business),
      allowedExactClaims: allowedExactClaimsForCopy(business, understanding),
      serviceTitleOptions: business.services,
      claimConflicts: evidenceLedger?.conflicts ?? []
    }
  };
}

function claimConflictYearsForCopyV1(evidenceLedger: SiteEvidenceLedgerV1 | undefined) {
  return [...new Set((evidenceLedger?.conflicts ?? []).filter((conflict) => conflict.kind === "years_in_business").flatMap((conflict) => conflict.values))];
}

function approvedClaimTextsForBundleV1(bundle: SiteBundle) {
  return approvedClaimTextsV1(
    bundle.businessProfile,
    trustEvidenceItemsV1(bundle.presenceAssessment.evidenceLedgerV1)
      .flatMap((item) => [item.value.text, item.value.displayText])
      .filter((value): value is string => Boolean(value))
  );
}

function approvedClaimTextsV1(business: BusinessProfile | undefined, claims: string[] = []) {
  return [...new Set([...(business?.credentials ?? []), ...(business?.offers ?? []), ...claims].map((claim) => claim.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
}

function withProtectedApprovedClaimsV1(value: string, approvedClaimTexts: string[]) {
  let protectedValue = value;
  const replacements: Array<{ token: string; value: string }> = [];
  for (const claim of approvedClaimTexts) {
    if (!unverifiableClaimPattern.test(claim)) continue;
    const pattern = new RegExp(claim.trim().split(/\s+/).map(escapeRegexV1).join("\\s+"), "gi");
    protectedValue = protectedValue.replace(pattern, (matched) => {
      const token = `__LODESTA_APPROVED_CLAIM_${replacements.length}__`;
      replacements.push({ token, value: matched });
      return token;
    });
  }
  return {
    value: protectedValue,
    restore: (text: string) => replacements.reduce((result, replacement) => result.replaceAll(replacement.token, replacement.value), text)
  };
}

function conflictSafeBusinessStoryForCopyV1(
  story: BusinessUnderstandingV2["businessStory"],
  conflictedYears: string[]
) {
  if (!story || !conflictedYears.length) return story;
  return stripConflictedYearsFromCopyV1(story, conflictedYears);
}

function allowedExactClaimsForCopy(business: BusinessProfile, understanding: BusinessUnderstandingV2 | undefined) {
  return {
    phone: business.phone,
    email: business.email,
    hours: business.hours,
    prices: [
      ...(understanding?.cleanedServices ?? []).map((service) => service.price).filter(Boolean),
      ...(business.serviceHighlights ?? []).filter((highlight) => /\$\s*\d/.test(highlight)),
      ...(business.offers ?? []).filter((offer) => /\$\s*\d/.test(offer))
    ]
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
