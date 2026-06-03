import { defaultDesignPlanForVertical } from "./layout-registry";
import type { AssetReference, BusinessProfile, MediaAssetDecisionV3, PageModel, SiteVersionV3, Theme } from "./models";

const compilerVersion = "generated-site-v3-compiler-v0";

export type GeneratedSiteV3CompileResult = {
  version: SiteVersionV3;
};

export function compileGeneratedSiteV3Site(input: {
  siteId: string;
  business: BusinessProfile;
  createdAt?: string;
}): GeneratedSiteV3CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const business = input.business;
  const media = selectV3Media(business);
  const theme = themeForV3Business(business, media.kind);
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: business.name,
    seo: {
      title: seoTitleForBusiness(business),
      description: seoDescriptionForBusiness(business),
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  const version: SiteVersionV3 = {
    id: `version_${input.siteId}_layout_v3`,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage],
    designPlan: defaultDesignPlanForVertical(business.vertical, theme),
    createdAt,
    theme,
    artifactRefs: [],
    mediaDecisions: media.decisions,
    artDirection: media.kind === "media"
      ? {
          version: "site-art-direction-v3",
          recipeId: "precision-service-v1",
          fontPairingId: "precision_grotesk",
          colorSystem: "high_contrast_neutral",
          spacingRhythm: "spacious",
          headerMode: "transparent_overlay",
          mediaTreatment: "editorial_crop",
          buttonSystem: "solid_with_quiet_secondary",
          cardTreatment: "minimal_surface",
          density: "balanced"
        }
      : {
          version: "site-art-direction-v3",
          recipeId: "quiet-boutique-v1",
          fontPairingId: "magazine_grotesk",
          colorSystem: "quiet_boutique",
          spacingRhythm: "spacious",
          headerMode: "solid_editorial",
          mediaTreatment: "text_first_fallback",
          buttonSystem: "understated",
          cardTreatment: "borderless",
          density: "open"
        },
    artDirectionDecision: {
      id: `art_${input.siteId}_layout_v3`,
      version: "art-direction-decision-v3",
      selectedRecipeId: media.kind === "media" ? "precision-service-v1" : "quiet-boutique-v1",
      rejectedRecipeIds: media.kind === "media" ? ["quiet-boutique-v1"] : ["precision-service-v1", "media-led-local-v1"],
      inputSignals: [
        business.vertical,
        media.kind === "media" ? "public-safe contextual media available" : "text-first fallback selected",
        business.phone ? "phone-first conversion available" : "generic contact conversion",
        business.address ? "location fact available" : "location unavailable"
      ],
      rationale:
        media.kind === "media"
          ? "Use a media-led local-service composition because the selected media is rights-safe and does not imply documented customer-specific work."
          : "Use a text-first editorial composition because no safe business-specific media should be implied.",
      validation: { status: "passed", issues: [] },
      tokenVersions: { fontPool: "v3-font-pool-v1", recipeCatalog: "v3-recipe-catalog-v1", componentControls: "v3-controls-v1" }
    },
    pageComposition: {
      id: `composition_${input.siteId}_layout_v3`,
      version: "page-composition-v3",
      pages: [
        {
          id: "home",
          slug: "",
          title: business.name,
          seo: legacyHomePage.seo,
          purpose: "homepage",
          sections: media.kind === "media" ? mediaPageSections(business, media) : textFirstPageSections(business)
        }
      ]
    }
  };
  return { version };
}

type SelectedV3Media =
  | {
      kind: "media";
      heroUrl: string;
      gallery: Array<{ url: string; label: string }>;
      decisions: MediaAssetDecisionV3[];
    }
  | {
      kind: "text";
      decisions: MediaAssetDecisionV3[];
    };

function mediaPageSections(business: BusinessProfile, media: Extract<SelectedV3Media, { kind: "media" }>): SiteVersionV3["pageComposition"]["pages"][number]["sections"] {
  const services = serviceItemsForBusiness(business);
  return [
    section("hero_v3", "hero.cinematic_overlay", "media_masthead", {
      eyebrow: eyebrowForBusiness(business),
      headline: headlineForBusiness(business, "media"),
      subheadline: subheadlineForBusiness(business),
      primaryCta: primaryCtaForBusiness(business),
      secondaryCta: { label: "See services", href: "#services" },
      mediaUrl: media.heroUrl,
      mediaCaption: mediaCaptionForBusiness(business)
    }),
    serviceSection(business, services),
    proofSection(business, "Shop details", proofIntroForBusiness(business)),
    section("media_v3", "media.asymmetric_gallery", "editorial_triptych", {
      heading: mediaHeadingForBusiness(business),
      intro: mediaIntroForBusiness(business),
      items: media.gallery
    }),
    faqSection(business),
    contactSection(business),
    ctaSection(business)
  ];
}

function textFirstPageSections(business: BusinessProfile): SiteVersionV3["pageComposition"]["pages"][number]["sections"] {
  const services = serviceItemsForBusiness(business);
  return [
    section("hero_v3", "hero.statement", "statement_split", {
      eyebrow: eyebrowForBusiness(business),
      headline: headlineForBusiness(business, "text"),
      subheadline: subheadlineForBusiness(business),
      primaryCta: primaryCtaForBusiness(business),
      secondaryCta: { label: "View services", href: "#services" },
      panelItems: [
        { label: "Services", value: compactServiceList(services) },
        { label: "Location", value: locationLineForBusiness(business) },
        { label: "How to start", value: business.phone ? "Call with the service you need" : "Send the details and timing" }
      ]
    }),
    serviceSection(business, services),
    proofSection(business, "Business details", proofIntroForBusiness(business)),
    faqSection(business),
    contactSection(business),
    ctaSection(business)
  ];
}

function serviceSection(business: BusinessProfile, services = serviceItemsForBusiness(business)) {
  const variant = business.vertical === "auto_body" ? "editorial_rows" : "bento_tiles";
  return section("services_v3", "services.editorial_index", variant, {
    eyebrow: "Services",
    heading: serviceHeadingForBusiness(business),
    intro: serviceIntroForBusiness(business),
    items: services
  });
}

function proofSection(business: BusinessProfile, eyebrow: string, intro: string) {
  return section("proof_v3", "proof.location_anchor", "local_anchor", {
    eyebrow,
    heading: proofHeadingForBusiness(business),
    intro,
    items: proofItemsForBusiness(business)
  });
}

function faqSection(business: BusinessProfile) {
  return section("faq_v3", "faq.editorial_list", "editorial_questions", {
    heading: faqHeadingForBusiness(business),
    intro: "A short first message is enough when it includes the practical details.",
    items: faqItemsForBusiness(business)
  });
}

function contactSection(business: BusinessProfile) {
  return section("contact_v3", "contact.split", "contact_form_split", {
    eyebrow: "Contact",
    heading: business.phone ? "Call or send a short message." : "Send a short message.",
    intro: "Include what you need, any timing constraints, and the best callback details.",
    actionItems: [
      ...(business.phone ? [{ label: "Call", value: formatPhone(business.phone), href: `tel:${phoneHref(business.phone)}` }] : []),
      ...(business.address ? [{ label: "Visit", value: formatAddress(business.address) }] : [])
    ]
  });
}

function ctaSection(business: BusinessProfile) {
  return section("cta_v3", "cta.editorial_close", "quiet_close", {
    heading: business.phone ? finalCtaHeadingForBusiness(business) : "Ready to send the details?",
    body: business.phone ? "Call now, or send the details before you visit." : "Send the details and ask about availability.",
    primaryCta: primaryCtaForBusiness(business)
  });
}

function selectV3Media(business: BusinessProfile): SelectedV3Media {
  const safePhoto = business.photos.find((asset) => isPublicSafeMedia(asset));
  if (safePhoto) {
    return {
      kind: "media",
      heroUrl: safePhoto.url,
      gallery: business.photos.filter(isPublicSafeMedia).slice(0, 3).map((asset) => ({ url: asset.url, label: asset.alt || "Business photo" })),
      decisions: [
        {
          id: `media_${business.siteId}_hero`,
          version: "media-asset-decision-v3",
          slotId: "home.hero.media",
          source: mediaSourceForAsset(safePhoto),
          rightsStatus: "approved",
          usageScope: "hero",
          sourceUrl: safePhoto.url,
          policyNotes: ["Selected from public-safe business media."],
          mayImplyRealBusinessWork: safePhoto.rightsStatus === "customer_granted"
        }
      ]
    };
  }
  if (business.vertical === "auto_body") {
    return {
      kind: "media",
      heroUrl: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg",
      gallery: [
        { url: "/generated-site-assets/auto-body/paint-refinish-closeup-v1.png", label: "Paint refinishing" },
        { url: "/generated-site-assets/auto-body/exterior-hail-dent-panel-v1.png", label: "Dent and hail damage" },
        { url: "/generated-site-assets/auto-body/glass-service-v1.jpg", label: "Auto glass" }
      ],
      decisions: [
        {
          id: `media_${business.siteId}_auto_context`,
          version: "media-asset-decision-v3",
          slotId: "home.hero.media",
          source: "curated_stock",
          rightsStatus: "approved",
          usageScope: "hero",
          sourceUrl: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg",
          policyNotes: ["Curated generic auto-body media. Does not imply real business staff, location, or documented customer work."],
          mayImplyRealBusinessWork: false
        }
      ]
    };
  }
  return {
    kind: "text",
    decisions: [
      {
        id: `media_${business.siteId}_text_fallback`,
        version: "media-asset-decision-v3",
        slotId: "home.hero.panel",
        source: "text_layout_fallback",
        rightsStatus: "approved",
        usageScope: "hero",
        policyNotes: ["Text-first layout selected because no approved public-safe media is available."],
        mayImplyRealBusinessWork: false
      }
    ]
  };
}

function isPublicSafeMedia(asset: AssetReference) {
  return asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe";
}

function mediaSourceForAsset(asset: AssetReference): MediaAssetDecisionV3["source"] {
  if (asset.source === "uploaded") return "first_party";
  if (asset.source === "licensed") return "curated_stock";
  if (asset.source === "generated") return "generated_ai";
  return "first_party";
}

function themeForV3Business(business: BusinessProfile, mediaKind: SelectedV3Media["kind"]): Theme {
  if (business.vertical === "auto_body") {
    return {
      paletteName: "v3-auto-precision",
      colors: {
        background: "#f6f2ea",
        surface: "#fffdf8",
        text: "#171512",
        muted: "#665f55",
        primary: "#951f2f",
        primaryText: "#ffffff",
        accent: "#e0a325",
        border: "#ded6ca"
      },
      typography: { heading: "precision_grotesk", body: "precision_grotesk" },
      radius: "sm",
      density: "spacious",
      mood: "editorial"
    };
  }
  return {
    paletteName: mediaKind === "media" ? "v3-local-media" : "v3-local-text-first",
    colors: {
      background: "#f3f6ef",
      surface: "#fffdf7",
      text: "#13231b",
      muted: "#5f6a61",
      primary: "#145c48",
      primaryText: "#ffffff",
      accent: "#c59d44",
      border: "#d9dfd3"
    },
    typography: { heading: "magazine_grotesk", body: "magazine_grotesk" },
    radius: "md",
    density: "spacious",
    mood: "editorial"
  };
}

function section(id: string, family: string, variant: string, props: Record<string, unknown>): SiteVersionV3["pageComposition"]["pages"][number]["sections"][number] {
  const isTextHero = variant === "statement_split";
  const isHero = family.startsWith("hero.");
  const isMedia = family.startsWith("media.");
  const isServices = family.startsWith("services.");
  const isProof = family.startsWith("proof.");
  const isContact = family.startsWith("contact.");
  const isCta = family.startsWith("cta.");
  const serviceLayout = variant === "bento_tiles" ? "card_grid" : "editorial_rows";
  return {
    id,
    family,
    variant,
    props,
    controls: {
      layout: isTextHero ? "two_column" : isHero ? "media_masthead" : isMedia || isProof ? "asymmetric_grid" : isServices ? serviceLayout : isCta ? "single_column" : "two_column",
      alignment: "split",
      width: isHero || isMedia ? "wide" : "contained",
      padding: "spacious",
      background: isContact ? "contrast" : isProof ? "surface" : isCta ? "brand" : "site_bg",
      mediaCrop: isMedia || (isHero && !isTextHero) ? "subject" : "none",
      density: "balanced"
    },
    slots: [],
    responsiveRules: [
      { breakpoint: "mobile", behavior: "stack", notes: ["Mobile composition stacks with the primary action preserved."] },
      { breakpoint: "desktop", behavior: isMedia || isHero ? "preserve_crop" : "reorder", notes: ["Desktop composition preserves section-specific anatomy."] }
    ],
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: {
      minimumValidSlots: ["heading"],
      omitWhenMissingFactKinds: [],
      blockWhenMissingFactKinds: [],
      gracefulDegradation: "Omit optional media or proof details rather than adding filler."
    }
  };
}

function serviceItemsForBusiness(business: BusinessProfile) {
  const limit = business.vertical === "auto_body" ? 6 : 4;
  return serviceNamesForBusiness(business).slice(0, limit).map((service) => ({
    title: service,
    body: serviceBodyForBusiness(service, business),
    meta: serviceMeta(service)
  }));
}

function serviceNamesForBusiness(business: BusinessProfile) {
  const services = business.services.length ? business.services : business.serviceHighlights ?? [];
  if (services.length) return services;
  if (business.vertical === "auto_body") return ["Collision repair", "Paint refinishing", "Dent repair", "Auto glass"];
  return business.categories.length ? business.categories : ["Local service"];
}

function serviceBodyForBusiness(service: string, business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    if (/collision|body/i.test(service)) return "Visible body damage after an accident, including panels and bumpers.";
    if (/bumper/i.test(service)) return "Bumper cover damage, scuffs, cracks, or impact areas that need shop review.";
    if (/dent|hail|pdr/i.test(service)) return "Dent and hail needs when the visible damage fits that service.";
    if (/glass|windshield|window/i.test(service)) return "Windshield or window damage that needs shop attention.";
    if (/\bpaint\b|refinish/i.test(service)) return "Exterior paint work for scraped, repaired, or refinished surfaces.";
  }
  if (business.vertical === "restaurant") return `${service} options for dining, pickup, or group orders.`;
  if (business.vertical === "home_services") return `${service} help for homes that need a clear appointment path.`;
  if (business.vertical === "beauty_salon") return `${service} appointments with room to share timing, goals, and references.`;
  if (business.vertical === "law_firm") return `${service} questions that start with the matter and the next deadline.`;
  return `${service} with a direct way to ask about availability and fit.`;
}

function serviceMeta(service: string) {
  if (/paintless|pdr/i.test(service)) return "PDR";
  if (/glass|windshield|window/i.test(service)) return "Glass";
  if (/bumper/i.test(service)) return "Bumper";
  const words = service.split(/\s+/).filter(Boolean);
  return (words[0] ?? "Service").slice(0, 12);
}

function proofItemsForBusiness(business: BusinessProfile) {
  return [
    ...(business.phone ? [{ label: "Phone", value: formatPhone(business.phone), detail: "Call with the service you need and any timing constraints." }] : []),
    ...(business.address ? [{ label: "Location", value: locationLineForBusiness(business), detail: "Use the address for directions before visiting." }] : []),
    { label: "Services", value: compactServiceList(serviceItemsForBusiness(business)), detail: "Start with the closest match, then include the details when you reach out." }
  ].slice(0, 3);
}

function faqItemsForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") {
    return [
      { title: "What should I have ready when I call?", body: "Vehicle year, make, model, the damaged area, and any photos you already have." },
      { title: "Can I ask about dent or hail repair?", body: "Yes. Call with the damaged area, how it happened, and whether you already have photos." },
      { title: "Can glass damage be included?", body: "For windshield or window damage, include which glass is affected and whether the vehicle can be driven." }
    ];
  }
  return [
    { title: "What should I include first?", body: "Share the service you need, timeline, location, and best callback details." },
    { title: "How should I choose the right service?", body: "Start with the outcome you want, then include any constraints that could affect timing or fit." },
    { title: "What happens after I reach out?", body: "You can expect a reply with availability, timing, or a quick follow-up question." }
  ];
}

function headlineForBusiness(business: BusinessProfile, mode: SelectedV3Media["kind"]) {
  if (business.vertical === "auto_body") return autoBodyHeroHeadline(business);
  if (mode === "media") return `A direct way to work with ${business.name}.`;
  return `Start with ${business.name}.`;
}

function subheadlineForBusiness(business: BusinessProfile) {
  const services = compactServiceList(serviceItemsForBusiness(business));
  const location = locationLineForBusiness(business);
  if (business.vertical === "auto_body") {
    return `${business.name} handles ${services.toLowerCase()}${location ? ` in ${location}` : ""}. Call with the vehicle, visible damage, photos, and timing.`;
  }
  return `${services} from ${business.name}${location ? ` in ${location}` : ""}.`;
}

function autoBodyHeroHeadline(business: BusinessProfile) {
  const serviceText = serviceNamesForBusiness(business).join(" ").toLowerCase();
  const location = business.address?.city || locationLineForBusiness(business);
  const locationPrefix = location ? `${location} ` : "";
  const hasDent = /\b(dent|pdr|hail)\b/.test(serviceText);
  const hasPaint = /\bpaint|refinish\b/.test(serviceText);
  const hasGlass = /\bglass|windshield|window\b/.test(serviceText);
  if (hasDent && hasPaint && hasGlass) return `${locationPrefix}dents, paint, glass, and collision repair.`;
  if (hasDent && hasPaint) return `${locationPrefix}dents, paint, and collision repair.`;
  return `${locationPrefix}auto body repair without the guesswork.`;
}

function eyebrowForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  const category = business.categories[0] ?? "Local business";
  return [location, category].filter(Boolean).join(" ");
}

function serviceHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Collision, paint, dent, and glass repair.";
  return "Choose the service that fits the visit.";
}

function proofHeadingForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  return location ? `Call or visit in ${location}.` : "Call directly before you visit.";
}

function mediaHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Body panels, paint, dents, and glass.";
  return "A closer look at the work.";
}

function mediaIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Use the photos as a quick guide to the kinds of visible vehicle damage to mention when you call.";
  return "Use the photos to decide what to ask about when you reach out.";
}

function serviceIntroForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Start with the visible damage, then call with the vehicle details and any photos you already have.";
  if (business.vertical === "restaurant") return "Scan the main options, then call or order with the timing and group size in mind.";
  if (business.vertical === "beauty_salon") return "Pick the service closest to your goal, then share timing, references, and current hair details.";
  if (business.vertical === "home_services") return "Choose the issue that best matches the visit, then include location and timing when you reach out.";
  return "Pick the closest service, then send the details that affect availability, timing, and fit.";
}

function proofIntroForBusiness(business: BusinessProfile) {
  if (business.address) return "Use the phone number and location before making the trip.";
  return "Use the phone number and service list to start with the right question.";
}

function faqHeadingForBusiness(business: BusinessProfile) {
  return business.vertical === "auto_body" ? "Before you call, have the basics ready." : "What to include in the first message.";
}

function finalCtaHeadingForBusiness(business: BusinessProfile) {
  if (business.vertical === "auto_body") return "Ready to talk through the repair?";
  if (business.vertical === "restaurant") return "Ready to call or order?";
  if (business.vertical === "beauty_salon") return "Ready to request an appointment?";
  return "Ready to call?";
}

function mediaCaptionForBusiness(business: BusinessProfile) {
  return business.vertical === "auto_body" ? "Exterior body and paint work." : "Service detail.";
}

function primaryCtaForBusiness(business: BusinessProfile) {
  return business.phone
    ? { label: "Call now", href: `tel:${phoneHref(business.phone)}` }
    : { label: "Send details", href: "#contact" };
}

function seoTitleForBusiness(business: BusinessProfile) {
  const location = locationLineForBusiness(business);
  return [business.name, business.categories[0], location].filter(Boolean).join(" | ");
}

function seoDescriptionForBusiness(business: BusinessProfile) {
  return `${business.name} provides ${compactServiceList(serviceItemsForBusiness(business)).toLowerCase()}${locationLineForBusiness(business) ? ` in ${locationLineForBusiness(business)}` : ""}.`;
}

function compactServiceList(services: Array<{ title: string }>) {
  return services.map((service) => service.title).slice(0, 6).join(", ");
}

function locationLineForBusiness(business: BusinessProfile) {
  return [business.address?.city, business.address?.region].filter(Boolean).join(", ");
}

function formatAddress(address: NonNullable<BusinessProfile["address"]>) {
  return [address.street, address.city, address.region].filter(Boolean).join(", ");
}

function phoneHref(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) return phone;
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

export const generatedSiteV3CompilerVersion = compilerVersion;
