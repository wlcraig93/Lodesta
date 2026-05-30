import type { BusinessProfile, OptimizationFinding, PageModel, SectionModel, SiteBundle, SiteVersion } from "./models";

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

  const draft = clonePublishedAsDraft(bundle);
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
    case "set_hero_cta": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      const section = page.sections.find((candidate) => candidate.id === payload.sectionId && candidate.type === "hero");
      if (!section) return { ok: false as const, reason: "Target hero section was not found." };
      const previousCta = section.props.primaryCta as { label?: string; href?: string } | undefined;
      changeSummary = {
        action: payload.action,
        pageId: page.id,
        pageTitle: page.title,
        sectionId: section.id,
        summary: `Updated the hero primary CTA on ${page.title}.`,
        before: formatCta(previousCta),
        after: formatCta(payload.cta)
      };
      section.props.primaryCta = payload.cta;
      section.fieldPolicies.primaryCta ??= { editScope: "owner_choice", experimentEligible: true, factField: false };
      break;
    }
    case "add_contact_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      const existing = page.sections.find((section) => section.type === "contact");
      if (existing) {
        changeSummary = {
          action: payload.action,
          pageId: page.id,
          pageTitle: page.title,
          sectionId: existing.id,
          summary: `${page.title} already has a contact section; no duplicate section was added.`
        };
        break;
      }
      const section = makeContactSection(bundle.businessProfile, payload);
      page.sections.push(section);
      changeSummary = {
        action: payload.action,
        pageId: page.id,
        pageTitle: page.title,
        sectionId: section.id,
        summary: `Added a contact section to ${page.title}.`,
        after: payload.heading
      };
      break;
    }
    case "add_cta_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      if (page.sections.some((section) => section.id === "cta_analytics_generated")) {
        changeSummary = {
          action: payload.action,
          pageId: page.id,
          pageTitle: page.title,
          sectionId: "cta_analytics_generated",
          summary: `${page.title} already has the recommended CTA section; no duplicate section was added.`
        };
        break;
      }
      const section = makeCtaSection(payload);
      const insertAfterIndex = payload.insertAfterSectionId
        ? page.sections.findIndex((candidate) => candidate.id === payload.insertAfterSectionId)
        : -1;
      page.sections.splice(insertAfterIndex >= 0 ? insertAfterIndex + 1 : page.sections.length, 0, section);
      changeSummary = {
        action: payload.action,
        pageId: page.id,
        pageTitle: page.title,
        sectionId: section.id,
        summary: `Added a recommended CTA section to ${page.title}.`,
        after: `${payload.heading} ${formatCta(payload.primaryCta)}`
      };
      break;
    }
    case "add_trust_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      if (page.sections.some((section) => section.id === "trust_generated")) {
        changeSummary = {
          action: payload.action,
          pageId: page.id,
          pageTitle: page.title,
          sectionId: "trust_generated",
          summary: `${page.title} already has the generated trust section; no duplicate section was added.`
        };
        break;
      }
      const section: SectionModel = {
        id: "trust_generated",
        type: "trust_bar",
        variant: "generated_proof",
        bindings: {},
        props: { items: payload.items },
        fieldPolicies: {
          items: { editScope: "system_only", experimentEligible: false, factField: true }
        }
      };
      page.sections.splice(Math.min(1, page.sections.length), 0, section);
      changeSummary = {
        action: payload.action,
        pageId: page.id,
        pageTitle: page.title,
        sectionId: section.id,
        summary: `Added a trust section to ${page.title}.`,
        after: payload.items.join(", ")
      };
      break;
    }
    case "add_faq_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      const existing = page.sections.find((section) => section.type === "faq");
      if (existing) {
        changeSummary = {
          action: payload.action,
          pageId: page.id,
          pageTitle: page.title,
          sectionId: existing.id,
          summary: `${page.title} already has an FAQ section; no duplicate section was added.`
        };
        break;
      }
      const section = makeFaqSection(payload);
      page.sections.push(section);
      changeSummary = {
        action: payload.action,
        pageId: page.id,
        pageTitle: page.title,
        sectionId: section.id,
        summary: `Added an FAQ section to ${page.title}.`,
        after: `${payload.items.length} question${payload.items.length === 1 ? "" : "s"}`
      };
      break;
    }
    default: {
      const exhaustive: never = payload;
      return { ok: false as const, reason: `Unsupported edit payload: ${JSON.stringify(exhaustive)}` };
    }
  }

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

function makeCtaSection(payload: Extract<SuggestedEditPayload, { action: "add_cta_section" }>): SectionModel {
  return {
    id: "cta_analytics_generated",
    type: "cta",
    variant: "analytics_recommendation",
    bindings: {},
    props: {
      eyebrow: "Recommended next step",
      heading: payload.heading,
      body: payload.body ?? "This action was recommended from recent behavior patterns.",
      primaryCta: payload.primaryCta
    },
    fieldPolicies: {
      heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
      body: { editScope: "owner_freetext", experimentEligible: false, factField: false },
      primaryCta: { editScope: "owner_choice", experimentEligible: true, factField: false },
      layout: { editScope: "system_only", experimentEligible: true, factField: false }
    }
  };
}

function makeFaqSection(payload: Extract<SuggestedEditPayload, { action: "add_faq_section" }>): SectionModel {
  return {
    id: "faq_generated",
    type: "faq",
    variant: "conversion_faq",
    bindings: {},
    props: {
      eyebrow: "Questions",
      heading: "Common questions before you reach out",
      items: payload.items
    },
    fieldPolicies: {
      eyebrow: { editScope: "owner_freetext", experimentEligible: false, factField: false },
      heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
      items: { editScope: "owner_freetext", experimentEligible: false, factField: true }
    }
  };
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

export function strongerMetadataForPage(business: BusinessProfile, page: PageModel) {
  const location = business.address?.city || business.serviceAreas[0] || "Local Area";
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

function formatCta(cta: { label?: string; href?: string } | undefined) {
  if (!cta?.label && !cta?.href) return "No primary CTA";
  return `${cta.label ?? "CTA"} -> ${cta.href ?? "no href"}`;
}

function getPage(version: SiteVersion, pageId: string) {
  return version.pages.find((page) => page.id === pageId);
}

function makeContactSection(
  business: BusinessProfile,
  payload: Extract<SuggestedEditPayload, { action: "add_contact_section" }>
): SectionModel {
  return {
    id: "contact_generated",
    type: "contact",
    variant: "split",
    bindings: {
      phone: "business.phone",
      address: "business.address",
      hours: "business.hours"
    },
    props: {
      heading: payload.heading,
      formId: payload.formId ?? "form_contact",
      primaryCta: payload.primaryCta ?? primaryCtaForBusiness(business)
    },
    fieldPolicies: {
      heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
      formId: { editScope: "owner_choice", experimentEligible: false, factField: false },
      primaryCta: { editScope: "owner_choice", experimentEligible: true, factField: false }
    }
  };
}
