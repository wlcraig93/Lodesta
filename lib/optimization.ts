import type { BusinessProfile, OptimizationFinding, SiteBundle } from "./models";
import { applyGeneratedSiteV3 } from "./generated-site-v3-pipeline";
import { markVersionOwnerTouched } from "./site-version-metadata";
import { assertSiteVersionV3, findPageByIdV3, type PageV3 } from "./site-version-v3";
import type { GeneratedCopyDeckV2 } from "./models";

type SuggestedEditPayload =
  | {
      action: "update_page_metadata";
      pageId: string;
      title: string;
      description: string;
    }
  | {
      action: "set_hero_cta";
      pageId: string;
      sectionId: string;
      cta: { label: string; href: string; role: string };
    }
  | {
      action: "add_contact_section";
      pageId: string;
      heading: string;
      formId?: string;
      primaryCta?: { label: string; href: string; role: string };
    }
  | {
      action: "add_cta_section";
      pageId: string;
      insertAfterSectionId?: string;
      heading: string;
      body?: string;
      primaryCta: { label: string; href: string; role: string };
    }
  | {
      action: "add_trust_section";
      pageId: string;
      items: string[];
    }
  | {
      action: "add_faq_section";
      pageId: string;
      items: Array<{ question: string; answer: string }>;
    };

export type OptimizationChangeSummary = {
  action: SuggestedEditPayload["action"];
  pageId: string;
  pageTitle?: string;
  sectionId?: string;
  summary: string;
  before?: string;
  after?: string;
};

export function applySuggestedEdit(bundle: SiteBundle, finding: OptimizationFinding) {
  const payload = parseSuggestedEditPayload(finding.suggestedEditPayload);
  if (!payload) return { ok: false as const, reason: "Finding does not include a one-click edit payload." };

  const draft = assertSiteVersionV3(clonePublishedAsDraft(bundle), "optimization draft");
  let changeSummary: OptimizationChangeSummary;
  switch (payload.action) {
    case "update_page_metadata": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      changeSummary = {
        action: payload.action,
        pageId: page.id,
        pageTitle: page.title,
        summary: `Updated SEO title and description for ${page.title}.`,
        before: `${page.seo.title} — ${page.seo.description}`,
        after: `${payload.title} — ${payload.description}`
      };
      page.seo.title = payload.title;
      page.seo.description = payload.description;
      break;
    }
    case "add_faq_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      if (!payload.items.length) return { ok: false as const, reason: "FAQ edit did not include any questions." };
      const deck = ensureGeneratedCopyDeck(bundle);
      deck.faqs = payload.items.map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim()
      })).filter((item) => item.question && item.answer);
      if (!deck.faqs.length) return { ok: false as const, reason: "FAQ edit did not include usable questions." };
      applyGeneratedSiteV3({ bundle });
      const updatedDraft = assertSiteVersionV3(
        bundle.siteModel.versions.find((version) => version.status === "draft"),
        "optimization FAQ draft"
      );
      changeSummary = {
        action: payload.action,
        pageId: page.id,
        pageTitle: page.title,
        sectionId: "faq",
        summary: `Added ${deck.faqs.length} FAQ questions to ${page.title}.`
      };
      markVersionOwnerTouched(updatedDraft);
      finding.status = "applied";
      return { ok: true as const, draft: updatedDraft, finding, changeSummary };
    }
    case "set_hero_cta":
    case "add_contact_section":
    case "add_cta_section":
    case "add_trust_section":
      return { ok: false as const, reason: `One-click action ${payload.action} needs a v3 compiler-backed mapping before it can be applied.` };
    default: {
      const exhaustive: never = payload;
      return { ok: false as const, reason: `Unsupported edit payload: ${JSON.stringify(exhaustive)}` };
    }
  }

  markVersionOwnerTouched(draft);
  finding.status = "applied";
  return { ok: true as const, draft, finding, changeSummary };
}

export function preserveFindingLifecycle(
  nextFindings: OptimizationFinding[],
  previousFindings: OptimizationFinding[]
) {
  const lifecycleById = new Map(
    previousFindings
      .filter((finding) => finding.status === "applied" || finding.status === "dismissed")
      .map((finding) => [finding.id, finding.status])
  );
  return nextFindings.map((finding) => {
    const status = lifecycleById.get(finding.id);
    return status ? { ...finding, status } : finding;
  });
}

export function clonePublishedAsDraft(bundle: SiteBundle) {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) return existingDraft;
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(published);
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  bundle.siteModel.versions.unshift(draft);
  return draft;
}

export function primaryCtaForBusiness(business: BusinessProfile) {
  if (business.orderingLinks[0]) return { label: "Order Online", href: business.orderingLinks[0], role: "ordering" };
  if (business.bookingLinks[0]) return { label: "Book Now", href: business.bookingLinks[0], role: "booking" };
  if (business.phone) return { label: "Call Now", href: `tel:${business.phone}`, role: "tel" };
  return { label: "Request Information", href: "#contact", role: "form" };
}

export function strongerMetadataForPage(business: BusinessProfile, page: PageV3) {
  const location = business.address?.city || business.serviceAreas[0] || "nearby customers";
  const service = business.services[0] || business.categories[0] || "Local Service";
  const titleBase = page.slug ? `${page.title} | ${business.name}` : `${business.name} | ${service} in ${location}`;
  const title = titleBase.length >= 25 ? titleBase : `${titleBase} | ${location}`;
  const description = `${business.name} helps customers in ${location} with ${business.services.slice(0, 3).join(", ") || service}. Clear contact options, verified business facts, and local trust signals are built into every page.`;
  return {
    title: title.slice(0, 70),
    description: description.slice(0, 165)
  };
}

function parseSuggestedEditPayload(payload: Record<string, unknown> | undefined): SuggestedEditPayload | null {
  if (!payload || typeof payload.action !== "string") return null;
  return payload as SuggestedEditPayload;
}

function getPage(version: ReturnType<typeof assertSiteVersionV3>, pageId: string) {
  return findPageByIdV3(version, pageId);
}

function ensureGeneratedCopyDeck(bundle: SiteBundle): GeneratedCopyDeckV2 {
  if (bundle.presenceAssessment.generatedCopyDeck) return bundle.presenceAssessment.generatedCopyDeck;
  const business = bundle.businessProfile;
  const services = business.services.length ? business.services : [business.categories[0] ?? "Local service"];
  const description = business.description ?? `${business.name} provides local service with clear contact options.`;
  const deck: GeneratedCopyDeckV2 = {
    version: "generated-copy-deck-v2",
    source: "openai",
    hero: {
      eyebrow: business.categories[0] ?? business.vertical,
      heading: `${business.name} in ${business.address?.city ?? business.serviceAreas[0] ?? "your area"}`,
      body: description
    },
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
    seo: { title: `${business.name} | ${services[0] ?? "Local service"}`, description: description.slice(0, 165) },
    groundingNotes: ["Deterministic v3 optimization fallback copy."],
    voiceProfile: { pov: "brand_direct" }
  };
  bundle.presenceAssessment.generatedCopyDeck = deck;
  return deck;
}
