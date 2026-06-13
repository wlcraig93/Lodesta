import type { GeneratedCopyDeckV2, OptimizationFinding, SiteBundle, SiteVersionV3 } from "./models";
import {
  guardrailIssueMessages,
  validateAiEditOutcome,
  type EditorGuardrailIssue
} from "./editor-guardrails";
import { applyGeneratedSiteV3 } from "./generated-site-v3-pipeline";
import { markVersionOwnerTouched } from "./site-version-metadata";
import { assertSiteVersionV3 } from "./site-version-v3";

export type AiEditOperation = {
  type:
    | "rewrite_hero"
    | "add_section"
    | "update_cta"
    | "apply_theme"
    | "add_service"
    | "run_audit"
    | "no_op";
  label: string;
  pageId?: string;
  sectionId?: string;
  details?: Record<string, string | number | boolean>;
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

export function applyAiEditToBundle(bundle: SiteBundle, userMessage: string): AiEditResult {
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
  const draft = clonePublishedAsDraft(bundle);
  const lower = message.toLowerCase();
  const operations: AiEditOperation[] = [];
  const warnings: string[] = [];
  let needsRecompile = false;

  const addedServices = extractRequestedServices(message);
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
        type: "add_service",
        label: `Added ${newServices.join(", ")} to the structured service list.`,
        details: { count: newServices.length }
      });
    }
  }

  if (mentionsHero(lower)) {
    const deck = ensureGeneratedCopyDeck(bundle);
    deck.hero = directHeroCopyForBundle(bundle);
    needsRecompile = true;
    operations.push({
      type: "rewrite_hero",
      label: "Rewrote the hero copy from the v3 source copy deck.",
      pageId: "home",
      sectionId: "hero"
    });
  }

  if (mentionsCta(lower)) {
    const cta = callCtaForBundle(bundle);
    if (cta) {
      bundle.presenceAssessment.v3CompilerOverrides = {
        ...bundle.presenceAssessment.v3CompilerOverrides,
        heroPrimaryCta: cta
      };
      needsRecompile = true;
      operations.push({
        type: "update_cta",
        label: "Set the hero primary CTA to call.",
        pageId: "home",
        sectionId: "hero",
        details: { href: cta.href }
      });
    } else {
      warnings.push("CTA edits need a verified phone number before a call CTA can be applied.");
    }
  }

  if (needsRecompile) {
    applyGeneratedSiteV3({ bundle });
    const updatedDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
    if (updatedDraft) markVersionOwnerTouched(assertSiteVersionV3(updatedDraft, "AI editor updated draft"));
  }

  if (mentionsTheme(lower)) warnings.push("Theme edits need a v3 compiler-backed design override before they can be applied.");
  if (mentionsSection(lower)) warnings.push("Section insertion/removal needs a v3 compiler-backed composition override before it can be applied.");
  if (mentionsAudit(lower)) operations.push({ type: "run_audit", label: "Requested a fresh audit after the draft change." });
  if (operations.length === 0) operations.push({ type: "no_op", label: "No supported v3 structured edit was detected." });

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
    mutated: operations.some((operation) => operation.type !== "run_audit" && operation.type !== "no_op"),
    draftVersionId: bundle.siteModel.versions.find((version) => version.status === "draft")?.id ?? draft.id,
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

function callCtaForBundle(bundle: SiteBundle) {
  const phone = bundle.businessProfile.phone?.trim();
  if (!phone) return undefined;
  return { label: "Call now", href: `tel:${phone.replace(/[^\d+]/g, "")}`, style: "primary" as const };
}

function extractRequestedServices(message: string) {
  const match =
    message.match(/\badd (?:a |an )?service(?: called| named| for|:)?\s+([^.;]+)/i) ??
    message.match(/\binclude (?:a |an )?service(?: called| named| for|:)?\s+([^.;]+)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,| and /)
    .map((service) => cleanService(service))
    .filter((service): service is string => Boolean(service));
}

function cleanService(value: string) {
  return value.replace(/\b(on|to|for) (the )?(site|website|page)$/i, "").trim();
}

function mentionsHero(message: string) {
  return /\b(hero|headline|above the fold|top section|first section|copy|rewrite|make it)\b/.test(message);
}

function mentionsTheme(message: string) {
  return /\b(theme|color|palette|premium|warm|bold|clinical|modern|green|blue|contrast)\b/.test(message);
}

function mentionsCta(message: string) {
  return /\b(cta|button|call now|book|booking|order|quote|estimate|request service|contact button)\b/.test(message);
}

function mentionsAudit(message: string) {
  return /\b(audit|check|score|qa|review)\b/.test(message);
}

function mentionsSection(message: string) {
  return /\b(add|remove|insert|hide|show).*\b(section|faq|gallery|testimonials?|reviews?|map|service area|team|press|video|final cta)\b/.test(message);
}

function sameText(left: string, right: string) {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function responseMessage(operations: AiEditOperation[], warnings: string[]) {
  const applied = operations.filter((operation) => operation.type !== "no_op").map((operation) => operation.label);
  if (applied.length && warnings.length) return `${applied.join(" ")} ${warnings.join(" ")}`;
  if (applied.length) return applied.join(" ");
  if (warnings.length) return warnings.join(" ");
  return "No supported v3 edit was detected.";
}
