import type {
  BusinessProfile,
  ComponentControlSchemaV3,
  SectionInstanceV3,
  SiteAsset,
  SiteVersionV3
} from "./models";
import type { EvidenceLedger } from "./evidence-ledger";
import { copySlotValue, validateSiteCopyForPlan, type GenerationPlan, type SiteCopy } from "./generation-contracts";
import {
  compileVisualSectionV3,
  withVisualSectionV3,
  type FaqItemV3,
  type RenderableLocationV3,
  type StandardItemV3,
  type VisualFactV3,
  type VisualSectionV3
} from "./generated-site-v3-visual-controls";
import { canonicalBusinessHours } from "./business-fact-normalization";

export function compileSite(input: {
  business: BusinessProfile;
  plan: GenerationPlan;
  copy: SiteCopy;
  evidence: EvidenceLedger;
  assets: SiteAsset[];
  createdAt?: string;
}): SiteVersionV3 {
  const validation = validateSiteCopyForPlan(input.plan, input.copy);
  if (!validation.ok) throw new Error(`Cannot compile invalid site copy: ${validation.issues.join(" ")}`);
  const pages = input.plan.pages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    purpose: page.purpose,
    seo: {
      title: page.slug ? `${page.title} | ${input.business.name}` : `${input.business.name} | Auto Body Repair`,
      description: page.slug
        ? `${page.title} from ${input.business.name}. Review the repair approach and request an estimate.`
        : `${input.business.name} provides ${input.business.services.slice(0, 3).join(", ").toLowerCase()}. Request an estimate.`,
      canonicalPath: page.slug ? `/${page.slug}` : "/"
    },
    sections: page.sections.map((section) => compileSection({ ...input, section }))
  }));
  const designSystem = input.plan.designSystem;
  const mediaLed = designSystem === "precision_shop_editorial";
  return {
    id: `version_${input.business.siteId}_${Date.now()}`,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    createdAt: input.createdAt ?? new Date().toISOString(),
    theme: input.plan.brandTokens,
    presentation: { mobileActionBehavior: "disabled", reservedMobileActionSpace: false },
    artifactRefs: [],
    mediaDecisions: input.assets.flatMap((asset) => asset.url ? [{
      id: `media_${asset.id}`,
      version: "media-asset-decision-v3" as const,
      slotId: asset.id,
      source: asset.source === "website_reference" || asset.source === "uploaded" ? "first_party" as const : asset.source === "generated" ? "generated_ai" as const : "curated_stock" as const,
      rightsStatus: asset.rightsStatus === "customer_granted" ? "approved" as const : asset.rightsStatus === "preclaim_safe" ? "preclaim_safe" as const : "owner_attestation_required" as const,
      usageScope: input.plan.pages.some((page) => page.sections.some((section) => section.mediaAssetId === asset.id)) ? "hero" as const : "not_public" as const,
      sourceUrl: asset.url,
      policyNotes: ["Selected by the canonical generation plan."],
      mayImplyRealBusinessWork: asset.source === "website_reference" || asset.source === "uploaded"
    }] : []),
    artDirection: {
      version: "site-art-direction-v3",
      recipeId: designSystem,
      fontPairingId: mediaLed ? "precision_grotesk" : "display_sans_humanist",
      colorSystem: mediaLed ? "light_editorial" : "warm_neighborhood",
      spacingRhythm: mediaLed ? "spacious" : "standard",
      headerMode: mediaLed ? "solid_editorial" : "compact_sticky",
      mediaTreatment: mediaLed ? "editorial_crop" : "media_independent",
      buttonSystem: mediaLed ? "understated" : "solid_with_quiet_secondary",
      cardTreatment: mediaLed ? "hairline_surface" : "minimal_surface",
      density: "balanced",
      navPlan: {
        source: "generation_plan",
        items: input.plan.navigation.items.map((item) => ({ label: item.label, target: item.target, kind: item.kind })),
        primaryCta: input.plan.navigation.primaryCta
      }
    },
    pageComposition: { id: `composition_${input.business.siteId}`, version: "page-composition-v3", pages }
  };
}

function compileSection(input: {
  business: BusinessProfile;
  plan: GenerationPlan;
  copy: SiteCopy;
  evidence: EvidenceLedger;
  assets: SiteAsset[];
  section: GenerationPlan["pages"][number]["sections"][number];
}) {
  const { section } = input;
  const prefix = section.id;
  const heading = () => copySlotValue(input.copy, `${prefix}.heading`);
  const body = () => copySlotValue(input.copy, `${prefix}.body`);
  const background = { kind: "solid" as const, token: section.templateId === "contact_split" ? "dark" as const : section.id.includes("process") ? "surface" as const : "page" as const };
  let visual: VisualSectionV3;
  if (section.templateId === "hero_split") {
    const asset = input.assets.find((candidate) => candidate.id === section.mediaAssetId && candidate.url);
    if (!asset?.url) throw new Error(`Hero section ${section.id} references missing media ${section.mediaAssetId}.`);
    visual = {
      version: "visual-section-v3",
      templateId: "hero_split",
      options: { background: { kind: "solid", token: "page" }, heroLayout: "classic_split", proofPlacement: "none", ctaLayout: "button_plus_text_link", mediaTreatment: "rounded_panel", headlineScale: "compact" },
      slots: {
        copy: { eyebrow: copySlotValue(input.copy, `${prefix}.eyebrow`), heading: heading(), body: body(), actions: primaryActions(input.business) },
        media: { items: [{ url: asset.url, label: asset.alt, cropIntent: "subject" }], caption: "none" }
      },
      anchorId: "top"
    };
  } else if (section.templateId === "hero_statement") {
    visual = {
      version: "visual-section-v3",
      templateId: "hero_statement",
      options: { align: "left", background, heroLayout: "no_media_editorial", proofPlacement: "none", ctaLayout: "button_plus_text_link", mediaTreatment: "flush", headlineScale: "compact" },
      slots: { copy: { eyebrow: copySlotValue(input.copy, `${prefix}.eyebrow`), heading: heading(), body: body(), actions: primaryActions(input.business) } },
      anchorId: section.id === "home.hero" ? "top" : undefined
    };
  } else if (section.templateId === "side_intro_rows") {
    const items = indexedItems(input.copy, prefix);
    visual = { version: "visual-section-v3", templateId: "side_intro_rows", options: { background }, slots: { intro: { heading: heading(), body: body() }, items: { items } }, anchorId: section.id === "home.services" ? "services" : undefined };
  } else if (section.templateId === "service_index") {
    visual = { version: "visual-section-v3", templateId: "service_index", options: { background, serviceIndexTreatment: "featured_services_plus_all" }, slots: { intro: { heading: heading(), body: body() }, items: { items: indexedItems(input.copy, prefix) } }, anchorId: "services" };
  } else if (section.templateId === "numbered_steps") {
    const items = indexedItems(input.copy, prefix).map((item, index) => ({ ...item, meta: String(index + 1).padStart(2, "0") }));
    visual = { version: "visual-section-v3", templateId: "numbered_steps", options: { background, stepTreatment: "numbered_ledger", orientation: "ledger", numberStyle: "oversized", mediaMode: "none", stepDensity: "balanced" }, slots: { intro: { heading: heading(), body: body() }, items: { items } }, anchorId: "process" };
  } else if (section.templateId === "quote_wall") {
    const items = section.evidenceIds.flatMap((id) => {
      const item = input.evidence.items.find((candidate) => candidate.id === id && candidate.kind === "testimonial" && candidate.publicText);
      return item?.publicText ? [{ quote: item.publicText, attribution: item.attribution, sourceHref: item.source.url }] : [];
    });
    visual = { version: "visual-section-v3", templateId: "quote_wall", options: { background }, slots: { intro: { heading: heading(), body: body() }, items: { items } }, anchorId: "reviews" };
  } else if (section.templateId === "faq_list") {
    visual = { version: "visual-section-v3", templateId: "faq_list", options: { background }, slots: { intro: { heading: heading(), body: body() }, items: { items: indexedFaq(input.copy, prefix) } }, anchorId: section.id === "home.faq" ? "faq" : undefined };
  } else if (section.templateId === "location_showcase") {
    visual = { version: "visual-section-v3", templateId: "location_showcase", options: { background, locationLayout: "map_left_hours_right", statusBadge: "none", hoursDisplay: "full_week", actionCluster: "directions_call" }, slots: { copy: { heading: heading(), body: body() }, locations: { locations: [locationForBusiness(input.business)] } }, anchorId: "location" };
  } else if (section.templateId === "service_area_showcase") {
    visual = { version: "visual-section-v3", templateId: "service_area_showcase", options: { background }, slots: { copy: { heading: heading(), body: body() }, facts: { items: input.business.serviceAreas.map((value) => ({ label: "Service area", value })) }, action: { title: "Discuss your repair", cta: primaryActions(input.business)[0] } }, anchorId: "location" };
  } else {
    visual = { version: "visual-section-v3", templateId: "contact_split", options: { background, contactLayout: "quote_card", formComplexity: "short", proofSidebar: input.business.address ? "location" : "response_expectation", ctaMode: "estimate" }, slots: { copy: { heading: heading(), body: body() }, contact: { facts: contactFacts(input.business) }, action: { title: "Request an estimate", body: "Share the damage details and the shop will explain the next step.", cta: primaryActions(input.business)[0] } }, anchorId: "contact" };
  }
  const compiled = compileVisualSectionV3(visual);
  const errors = compiled.violations.filter((violation) => violation.severity === "error");
  if (errors.length) throw new Error(`Visual section ${section.id} is invalid: ${errors.map((error) => error.message).join(" ")}`);
  return sectionInstance(section.id, compiled.section);
}

function sectionInstance(id: string, visual: VisualSectionV3): SectionInstanceV3 {
  const controls: ComponentControlSchemaV3 = {
    layout: visual.templateId === "hero_split" ? "architectural_split" : visual.templateId === "contact_split" ? "contact_panel" : visual.templateId === "side_intro_rows" || visual.templateId === "numbered_steps" || visual.templateId === "service_index" ? "editorial_rows" : "single_column",
    alignment: "start",
    width: visual.templateId === "hero_split" ? "wide" : "contained",
    padding: visual.templateId === "hero_split" ? "spacious" : "standard",
    background: visual.options.background.kind === "image" ? "media" : visual.options.background.token === "dark" ? "contrast" : visual.options.background.token === "surface" ? "surface" : "site_bg",
    mediaCrop: visual.templateId === "hero_split" ? "subject" : "none",
    density: "balanced"
  };
  return {
    id,
    family: visual.templateId,
    variant: visual.templateId,
    props: withVisualSectionV3({}, visual),
    controls,
    slots: [],
    responsiveRules: [{ breakpoint: "mobile", behavior: "stack", notes: ["Design-system mobile stack."] }],
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: { minimumValidSlots: [], omitWhenMissingFactKinds: [], blockWhenMissingFactKinds: [], gracefulDegradation: "The planner omits unsupported sections before compilation." }
  };
}

function indexedItems(copy: SiteCopy, prefix: string): StandardItemV3[] {
  const titles = copy.slots.filter((slot) => slot.slotId.startsWith(`${prefix}.`) && slot.slotId.endsWith(".title"));
  return titles.map((title) => ({ title: title.value, body: copySlotValue(copy, title.slotId.replace(/\.title$/, ".body")) }));
}

function indexedFaq(copy: SiteCopy, prefix: string): FaqItemV3[] {
  const questions = copy.slots.filter((slot) => slot.slotId.startsWith(`${prefix}.`) && slot.slotId.endsWith(".question"));
  return questions.map((question) => ({ question: question.value, answer: copySlotValue(copy, question.slotId.replace(/\.question$/, ".answer")) }));
}

function primaryActions(business: BusinessProfile) {
  return [
    { label: "Request an estimate", href: "#contact", style: "primary" as const },
    ...(business.phone ? [{ label: "Call the shop", href: `tel:${business.phone.replace(/[^\d+]/g, "")}`, style: "secondary" as const }] : [])
  ];
}

function contactFacts(business: BusinessProfile): VisualFactV3[] {
  const facts: VisualFactV3[] = [
    ...(business.phone ? [{ label: "Phone", value: business.phone, href: `tel:${business.phone.replace(/[^\d+]/g, "")}` }] : []),
    ...(business.address ? [{ label: "Address", value: addressLine(business) }] : []),
    ...(canonicalBusinessHours(business.hours).length ? [{ label: "Hours", value: canonicalBusinessHours(business.hours).slice(0, 2).map(({ label, value }) => `${label}: ${value}`).join("; ") }] : []),
    ...(business.email ? [{ label: "Email", value: business.email, href: `mailto:${business.email}` }] : []),
    ...business.serviceAreas.slice(0, 1).map((value) => ({ label: "Service area", value })),
    ...business.services.slice(0, 2).map((value) => ({ label: "Service", value })),
    ...business.categories.slice(0, 1).map((value) => ({ label: "Category", value })),
    { label: "Business", value: business.name }
  ];
  return facts.slice(0, 4);
}

function locationForBusiness(business: BusinessProfile): RenderableLocationV3 {
  return {
    id: `location_${business.siteId}`,
    label: business.name,
    role: "primary",
    isPrimary: true,
    addressLine: business.address?.street,
    localityLine: [business.address?.city, business.address?.region, business.address?.postalCode].filter(Boolean).join(", "),
    phone: business.phone,
    email: business.email,
    hours: canonicalBusinessHours(business.hours),
    serviceAreas: business.serviceAreas,
    directionsUrl: business.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine(business))}` : undefined,
    mapEmbedIntent: business.address ? { kind: "address", address: addressLine(business) } : undefined
  };
}

function addressLine(business: BusinessProfile) {
  return [business.address?.street, business.address?.city, business.address?.region, business.address?.postalCode].filter(Boolean).join(", ");
}
