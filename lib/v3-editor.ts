import type { EditableField } from "@/components/SectionEditorForm";
import { applyGeneratedSiteV3 } from "./generated-site-v3-pipeline";
import { getVisualSectionV3, type VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { markVersionOwnerTouched } from "./site-version-metadata";
import { assertSiteVersionV3, findPageByIdV3, type PageV3 } from "./site-version-v3";
import type { GeneratedCopyDeckV2, SectionInstanceV3, SiteBundle, SiteVersionV3 } from "./models";

export type EditableV3Section = {
  section: SectionInstanceV3;
  page: PageV3;
  visual: VisualSectionV3;
  fields: EditableField[];
};

export function editableV3Sections(bundle: SiteBundle, version: SiteVersionV3): EditableV3Section[] {
  const editable: EditableV3Section[] = [];
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = getVisualSectionV3(section.props);
      if (!visual) continue;
      const fields = editableFieldsForVisualSection(visual, bundle);
      if (fields.length) editable.push({ page, section, visual, fields });
    }
  }
  return editable;
}

export function designSectionsForV3(version: SiteVersionV3) {
  const home = version.pageComposition.pages.find((page) => page.slug === "") ?? version.pageComposition.pages[0];
  return (home?.sections ?? []).map((section) => {
    const visual = getVisualSectionV3(section.props);
    return {
      id: section.id,
      kind: visual?.templateId ?? section.family,
      label: visual ? copySlot(visual)?.heading ?? visual.templateId : section.family,
      preset: visual?.templateId ?? section.variant,
      presetOptions: [{ id: visual?.templateId ?? section.variant, label: visual?.templateId ?? section.variant }]
    };
  });
}

export function applyV3SectionUpdate(
  bundle: SiteBundle,
  input: { pageId: string; sectionId: string; props: Record<string, unknown> }
) {
  const draft = assertSiteVersionV3(
    bundle.siteModel.versions.find((version) => version.status === "draft") ?? clonePublishedAsDraftV3(bundle),
    "section update draft"
  );
  const page = findPageByIdV3(draft, input.pageId);
  const section = page?.sections.find((candidate) => candidate.id === input.sectionId);
  const visual = section ? getVisualSectionV3(section.props) : undefined;
  if (!page || !section || !visual) return { ok: false as const, reason: "Unknown site, page, or section" };

  const deck = ensureGeneratedCopyDeck(bundle);
  const mapped = applySourceCopyPatch({ deck, visual, section, props: input.props });
  if (!mapped.ok) return mapped;
  if ("primaryCta" in input.props && isValidCta(input.props.primaryCta)) {
    if (!(section.id === "hero" || visual.templateId === "hero_split" || visual.templateId === "hero_statement")) {
      return { ok: false as const, reason: "Primary CTA edits are only supported on the v3 hero section." };
    }
    bundle.presenceAssessment.v3CompilerOverrides = {
      ...bundle.presenceAssessment.v3CompilerOverrides,
      heroPrimaryCta: {
        label: input.props.primaryCta.label,
        href: input.props.primaryCta.href,
        style: "primary"
      }
    };
  }

  applyGeneratedSiteV3({ bundle });
  const updatedDraft = assertSiteVersionV3(bundle.siteModel.versions.find((version) => version.status === "draft"), "updated section draft");
  markVersionOwnerTouched(updatedDraft);
  return { ok: true as const, bundle };
}

function editableFieldsForVisualSection(visual: VisualSectionV3, bundle: SiteBundle): EditableField[] {
  const copy = copySlot(visual);
  const fields: EditableField[] = [];
  if (copy?.eyebrow) fields.push({ kind: "text", key: "eyebrow", label: "Eyebrow", value: copy.eyebrow, multiline: false });
  if (copy?.heading) fields.push({ kind: "text", key: "heading", label: "Heading", value: copy.heading, multiline: false });
  if (copy?.body) fields.push({ kind: "text", key: "body", label: "Body", value: copy.body, multiline: true });
  const primaryCta = copy?.actions?.[0] ?? actionSlot(visual)?.cta;
  if (primaryCta) {
    fields.push({
      kind: "cta",
      key: "primaryCta",
      label: "Primary action",
      value: { label: primaryCta.label, href: primaryCta.href, role: ctaRole(primaryCta.href) },
      options: ctaOptionsForBundle(bundle)
    });
  }
  return fields;
}

function applySourceCopyPatch(input: {
  deck: GeneratedCopyDeckV2;
  visual: VisualSectionV3;
  section: SectionInstanceV3;
  props: Record<string, unknown>;
}) {
  const heroLike = input.section.id === "hero" || input.visual.templateId === "hero_split" || input.visual.templateId === "hero_statement";
  const contactLike = input.visual.templateId === "contact_split";
  const faqLike = input.visual.templateId === "faq_list";
  const copy = heroLike ? input.deck.hero : contactLike ? input.deck.contactIntro : faqLike ? input.deck.processIntro : undefined;
  if (!copy) {
    return {
      ok: false as const,
      reason: `Section ${input.section.id} does not yet have a v3 source-copy mapping.`
    };
  }
  for (const [key, value] of Object.entries(input.props)) {
    if (key === "heading" && typeof value === "string") copy.heading = value;
    else if (key === "body" && typeof value === "string") copy.body = value;
    else if (key === "eyebrow" && heroLike && typeof value === "string") input.deck.hero.eyebrow = value;
    else if (key === "primaryCta") {
      if (!isValidCta(value)) return { ok: false as const, reason: "Primary CTA is missing visible text or destination." };
    } else {
      return { ok: false as const, reason: `Field ${key} is not editable by v3 owner controls.` };
    }
  }
  return { ok: true as const };
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
    seo: {
      title: `${business.name} | ${services[0] ?? "Local service"} in ${location}`.slice(0, 70),
      description: `${business.name} helps customers in ${location} with ${services.slice(0, 3).join(", ")}. Clear contact options and local details are built into the page.`.slice(0, 165)
    },
    groundingNotes: ["Deterministic v3 editor fallback copy."],
    voiceProfile: { pov: "brand_direct" }
  };
  bundle.presenceAssessment.generatedCopyDeck = deck;
  return deck;
}

function copySlot(visual: VisualSectionV3) {
  const slots = visual.slots as Record<string, unknown>;
  const candidate = slots.copy ?? slots.intro;
  return candidate && typeof candidate === "object" ? candidate as { eyebrow?: string; heading?: string; body?: string; actions?: Array<{ label: string; href: string }> } : undefined;
}

function actionSlot(visual: VisualSectionV3) {
  const action = (visual.slots as Record<string, unknown>).action;
  return action && typeof action === "object" ? action as { cta?: { label: string; href: string } } : undefined;
}

function isValidCta(value: unknown): value is { label: string; href: string } {
  return Boolean(value && typeof value === "object" && "label" in value && "href" in value && String(value.label).trim() && String(value.href).trim());
}

function ctaOptionsForBundle(bundle: SiteBundle) {
  const options = [{ label: "Contact", href: "#contact", role: "form" }];
  if (bundle.businessProfile.phone) options.unshift({ label: "Call Now", href: `tel:${bundle.businessProfile.phone}`, role: "tel" });
  if (bundle.businessProfile.bookingLinks[0]) options.push({ label: "Book Now", href: bundle.businessProfile.bookingLinks[0], role: "booking" });
  if (bundle.businessProfile.orderingLinks[0]) options.push({ label: "Order Online", href: bundle.businessProfile.orderingLinks[0], role: "ordering" });
  return options;
}

function ctaRole(href: string) {
  if (href.startsWith("tel:")) return "tel";
  if (href.includes("order")) return "ordering";
  if (href.includes("book") || href.includes("schedule")) return "booking";
  return "form";
}

function clonePublishedAsDraftV3(bundle: SiteBundle) {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) return existingDraft;
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(assertSiteVersionV3(published, "published version for draft clone"));
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  bundle.siteModel.versions.unshift(draft);
  return draft;
}
