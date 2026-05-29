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
    };

export function applySuggestedEdit(bundle: SiteBundle, finding: OptimizationFinding) {
  const payload = parseSuggestedEditPayload(finding.suggestedEditPayload);
  if (!payload) return { ok: false as const, reason: "Finding does not include a one-click edit payload." };

  const draft = clonePublishedAsDraft(bundle);
  switch (payload.action) {
    case "update_page_metadata": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      page.seo.title = payload.title;
      page.seo.description = payload.description;
      break;
    }
    case "set_hero_cta": {
      const page = getPage(draft, payload.pageId);
      const section = page?.sections.find((candidate) => candidate.id === payload.sectionId && candidate.type === "hero");
      if (!section) return { ok: false as const, reason: "Target hero section was not found." };
      section.props.primaryCta = payload.cta;
      section.fieldPolicies.primaryCta ??= { editScope: "owner_choice", experimentEligible: true, factField: false };
      break;
    }
    case "add_contact_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      if (page.sections.some((section) => section.type === "contact")) break;
      page.sections.push(makeContactSection(bundle.businessProfile, payload));
      break;
    }
    case "add_cta_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      if (page.sections.some((section) => section.id === "cta_analytics_generated")) break;
      const section = makeCtaSection(payload);
      const insertAfterIndex = payload.insertAfterSectionId
        ? page.sections.findIndex((candidate) => candidate.id === payload.insertAfterSectionId)
        : -1;
      page.sections.splice(insertAfterIndex >= 0 ? insertAfterIndex + 1 : page.sections.length, 0, section);
      break;
    }
    case "add_trust_section": {
      const page = getPage(draft, payload.pageId);
      if (!page) return { ok: false as const, reason: "Target page was not found." };
      if (page.sections.some((section) => section.id === "trust_generated")) break;
      page.sections.splice(Math.min(1, page.sections.length), 0, {
        id: "trust_generated",
        type: "trust_bar",
        variant: "generated_proof",
        bindings: {},
        props: { items: payload.items },
        fieldPolicies: {
          items: { editScope: "system_only", experimentEligible: false, factField: true }
        }
      });
      break;
    }
    default: {
      const exhaustive: never = payload;
      return { ok: false as const, reason: `Unsupported edit payload: ${JSON.stringify(exhaustive)}` };
    }
  }

  finding.status = "applied";
  return { ok: true as const, draft, finding };
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
