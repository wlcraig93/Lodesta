import type { BusinessProfile, ExtensionModel, PageModel, SiteBundle, SiteModel, SiteVersionV3 } from "./models";
import { defaultDesignPlanForVertical } from "./layout-registry";

const createdAt = "2026-06-02T00:00:00.000Z";

export type GeneratedSiteV3Prototype = {
  id: string;
  label: string;
  business: BusinessProfile;
  version: SiteVersionV3;
  bundle: SiteBundle;
  expectations: {
    minSections: number;
    requiredFamilies: string[];
    forbiddenCopy: string[];
  };
};

export function createGeneratedSiteV3GoldenPrototypes(): GeneratedSiteV3Prototype[] {
  const autoBusiness = precisionAutoBusinessV3;
  const autoVersion = precisionAutoVersionV3(autoBusiness);
  const studioBusiness = northLoopStudioBusinessV3;
  const studioVersion = northLoopStudioVersionV3(studioBusiness);
  return [
    {
      id: "precision_auto_v3",
      label: "V3 auto-service horizontal prototype",
      business: autoBusiness,
      version: autoVersion,
      bundle: fixtureBundle(autoBusiness, autoVersion),
      expectations: {
        minSections: 7,
        requiredFamilies: ["hero.cinematic_overlay", "services.editorial_index", "proof.location_anchor", "media.asymmetric_gallery", "faq.editorial_list", "contact.split", "cta.editorial_close"],
        forbiddenCopy: [
          "template",
          "source-backed",
          "source facts",
          "profile details",
          "these general visuals",
          "conversation",
          "starting point",
          "homepage",
          "generic contact form",
          "horizontal visual layer",
          "prototype",
          "v3",
          "call path",
          "kept close",
          "text-first layout",
          "confirmed business information"
        ]
      }
    },
    {
      id: "north_loop_studio_v3",
      label: "V3 text-first professional-service prototype",
      business: studioBusiness,
      version: studioVersion,
      bundle: fixtureBundle(studioBusiness, studioVersion),
      expectations: {
        minSections: 6,
        requiredFamilies: ["hero.statement", "services.editorial_index", "proof.location_anchor", "faq.editorial_list", "contact.split", "cta.editorial_close"],
        forbiddenCopy: [
          "template",
          "source-backed",
          "source facts",
          "profile details",
          "these general visuals",
          "conversation",
          "starting point",
          "homepage",
          "generic contact form",
          "horizontal visual layer",
          "prototype",
          "v3",
          "call path",
          "kept close",
          "text-first layout",
          "confirmed business information"
        ]
      }
    }
  ];
}

const precisionAutoBusinessV3: BusinessProfile = {
  id: "business_precision_auto_v3",
  siteId: "site_precision_auto_v3",
  name: "Precision Paint & Body",
  vertical: "auto_body",
  categories: ["Auto body shop", "Collision repair"],
  description: "Synthetic V3 prototype for auto body repair.",
  phone: "(512) 555-0188",
  address: {
    street: "2400 East 5th Street",
    city: "Austin",
    region: "TX",
    postalCode: "78702",
    country: "US"
  },
  services: ["Collision repair", "Paint refinishing", "Dent repair", "Auto glass"],
  serviceHighlights: ["Paintless dent repair for smaller dents", "Windshield and window service"],
  serviceAreas: ["Austin", "East Austin"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: {
    name: fixtureProvenance(),
    phone: fixtureProvenance(),
    address: fixtureProvenance(),
    services: fixtureProvenance()
  }
};

const northLoopStudioBusinessV3: BusinessProfile = {
  id: "business_north_loop_studio_v3",
  siteId: "site_north_loop_studio_v3",
  name: "North Loop Studio",
  vertical: "creative_studio",
  categories: ["Creative studio", "Brand design"],
  description: "Synthetic V3 prototype for a local creative studio.",
  phone: "(512) 555-0142",
  address: {
    street: "812 North Loop Boulevard",
    city: "Austin",
    region: "TX",
    postalCode: "78753",
    country: "US"
  },
  services: ["Brand identity", "Website design", "Launch support", "Creative direction"],
  serviceHighlights: ["Brand and web projects for local teams", "Launch support for service businesses"],
  serviceAreas: ["Austin", "Central Texas"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: {
    name: fixtureProvenance(),
    phone: fixtureProvenance(),
    address: fixtureProvenance(),
    services: fixtureProvenance()
  }
};

function precisionAutoVersionV3(business: BusinessProfile): SiteVersionV3 {
  const theme = {
    paletteName: "v3-precision-light",
    colors: {
      background: "#f6f2ea",
      surface: "#ffffff",
      text: "#171512",
      muted: "#665f55",
      primary: "#951f2f",
      primaryText: "#ffffff",
      accent: "#e0a325",
      border: "#ded6ca"
    },
    typography: {
      heading: "precision_grotesk",
      body: "precision_grotesk"
    },
    radius: "sm",
    density: "spacious",
    mood: "editorial"
  } as const;
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: business.name,
    seo: {
      title: `${business.name} | Collision repair in Austin`,
      description: "Synthetic V3 prototype for collision repair, dent repair, paint refinishing, and auto glass.",
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  return {
    id: "version_precision_auto_v3",
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage],
    designPlan: defaultDesignPlanForVertical(business.vertical, theme),
    createdAt,
    theme,
    artifactRefs: [],
    mediaDecisions: [
      {
        id: "media_precision_auto_hero",
        version: "media-asset-decision-v3",
        slotId: "home.hero.media",
        source: "curated_stock",
        rightsStatus: "approved",
        usageScope: "hero",
        sourceUrl: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg",
        policyNotes: ["Curated preclaim-safe auto body context image.", "Does not imply real Precision Paint & Body staff or documented work."],
        mayImplyRealBusinessWork: false
      }
    ],
    artDirection: {
      version: "site-art-direction-v3",
      recipeId: "precision-service-v1",
      fontPairingId: "precision_grotesk",
      colorSystem: "light_editorial",
      spacingRhythm: "spacious",
      headerMode: "transparent_overlay",
      mediaTreatment: "editorial_crop",
      buttonSystem: "solid_with_quiet_secondary",
      cardTreatment: "minimal_surface",
      density: "balanced"
    },
    artDirectionDecision: {
      id: "art_precision_auto_v3",
      version: "art-direction-decision-v3",
      selectedRecipeId: "precision-service-v1",
      rejectedRecipeIds: ["editorial-service-light-v1", "media-led-local-v1"],
      inputSignals: ["service business", "clear source facts", "usable auto-body media", "phone-first conversion"],
      rationale: "Use a crisp service-business composition with an integrated media hero, reduced headline weight, and clear contact path.",
      validation: { status: "passed", issues: [] },
      tokenVersions: { fontPool: "v3-font-pool-v1", recipeCatalog: "v3-recipe-catalog-v1", componentControls: "v3-controls-v1" }
    },
    pageComposition: {
      id: "composition_precision_auto_v3",
      version: "page-composition-v3",
      pages: [
        {
          id: "home",
          slug: "",
          title: business.name,
          seo: legacyHomePage.seo,
          purpose: "homepage",
          sections: [
            section("hero_v3", "hero.cinematic_overlay", "media_masthead", {
              eyebrow: "Austin collision and paint repair",
              headline: "Collision repair without the guesswork.",
              subheadline: "Call for collision, paint, dent, and glass repair in Austin. Share the vehicle, visible damage, and timing before you visit.",
              primaryCta: { label: "Call for repair help", href: "tel:+15125550188" },
              secondaryCta: { label: "See services", href: "#services" },
              mediaUrl: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg",
              mediaCaption: "Exterior panel repair and refinishing."
            }),
            section("services_v3", "services.editorial_index", "editorial_rows", {
              eyebrow: "Services",
              heading: "Collision, paint, dent, and glass repair.",
              intro: "Call with the visible damage, vehicle details, and any photos you already have.",
              items: [
                { title: "Collision repair", body: "Visible body damage after an accident, including panels and bumpers.", meta: "Body" },
                { title: "Paint refinishing", body: "Exterior paint work for scraped, repaired, or refinished panels.", meta: "Paint" },
                { title: "Dent repair", body: "Paintless dent repair for smaller dents and hail damage when the damage fits.", meta: "PDR" },
                { title: "Auto glass", body: "Windshield and window service for glass damage that needs shop attention.", meta: "Glass" }
              ]
            }),
            section("proof_v3", "proof.location_anchor", "local_anchor", {
              eyebrow: "Shop details",
              heading: "Call the Austin shop or plan the visit.",
              intro: "Phone, location, and core services stay easy to find before customers reach out.",
              items: [
                { label: "Phone", value: business.phone ?? "", detail: "Call with the vehicle and visible damage." },
                { label: "Location", value: "Austin, TX", detail: "Use the address before visiting." },
                { label: "Services", value: "Collision, paint, dents, glass", detail: "Start with the closest match." }
              ]
            }),
            section("media_v3", "media.asymmetric_gallery", "editorial_triptych", {
              heading: "Body panels, paint finish, dents, and glass.",
              intro: "Use the photos as a quick guide to the kind of visible vehicle damage to mention when calling.",
              items: [
                { url: "/generated-site-assets/auto-body/paint-refinish-closeup-v1.png", label: "Paint refinishing" },
                { url: "/generated-site-assets/auto-body/exterior-hail-dent-panel-v1.png", label: "Dent and hail damage" },
                { url: "/generated-site-assets/auto-body/glass-service-v1.jpg", label: "Auto glass" }
              ]
            }),
            section("faq_v3", "faq.editorial_list", "editorial_questions", {
              heading: "Before you call, have the basics ready.",
              intro: "A short first message is enough when it includes the vehicle and the visible damage.",
              items: [
                { title: "What should I have ready when I call?", body: "Vehicle year, make, model, the damaged area, and any photos you already have." },
                { title: "Do dent and hail needs fit?", body: "Dent and hail-related repair needs can be discussed when the visible damage matches the shop's supported services." },
                { title: "Can glass damage be included?", body: "Auto glass is listed with the repair services, so customers can include glass damage when they call." }
              ]
            }),
            section("contact_v3", "contact.split", "contact_form_split", {
              eyebrow: "Contact",
              heading: "Call the shop or send a short message.",
              intro: "Include the vehicle, visible damage, photos if available, and the best callback details."
            }),
            section("cta_v3", "cta.editorial_close", "quiet_close", {
              heading: "Ready to talk through the damage?",
              body: "Call now, or send the details and ask for the next available repair step.",
              primaryCta: { label: "Call the shop", href: "tel:+15125550188" }
            })
          ]
        }
      ]
    }
  };
}

function northLoopStudioVersionV3(business: BusinessProfile): SiteVersionV3 {
  const theme = {
    paletteName: "v3-north-loop-studio",
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
    typography: {
      heading: "magazine_grotesk",
      body: "magazine_grotesk"
    },
    radius: "md",
    density: "spacious",
    mood: "editorial"
  } as const;
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: business.name,
    seo: {
      title: `${business.name} | Brand and website design in Austin`,
      description: "Synthetic V3 prototype for brand identity, website design, launch support, and creative direction.",
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  return {
    id: "version_north_loop_studio_v3",
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage],
    designPlan: defaultDesignPlanForVertical(business.vertical, theme),
    createdAt,
    theme,
    artifactRefs: [],
    mediaDecisions: [
      {
        id: "media_north_loop_text_fallback",
        version: "media-asset-decision-v3",
        slotId: "home.hero.panel",
        source: "text_layout_fallback",
        rightsStatus: "approved",
        usageScope: "hero",
        policyNotes: ["Text-first layout selected because no approved first-party or curated media is available."],
        mayImplyRealBusinessWork: false
      }
    ],
    artDirection: {
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
      id: "art_north_loop_studio_v3",
      version: "art-direction-decision-v3",
      selectedRecipeId: "quiet-boutique-v1",
      rejectedRecipeIds: ["precision-service-v1", "media-led-local-v1"],
      inputSignals: ["professional service", "no approved media", "form-first conversion", "short service catalog"],
      rationale: "Use a text-first editorial service layout with a high-contrast highlight panel instead of weak or deceptive imagery.",
      validation: { status: "passed", issues: [] },
      tokenVersions: { fontPool: "v3-font-pool-v1", recipeCatalog: "v3-recipe-catalog-v1", componentControls: "v3-controls-v1" }
    },
    pageComposition: {
      id: "composition_north_loop_studio_v3",
      version: "page-composition-v3",
      pages: [
        {
          id: "home",
          slug: "",
          title: business.name,
          seo: legacyHomePage.seo,
          purpose: "homepage",
          sections: [
            section("hero_v3", "hero.statement", "statement_split", {
              eyebrow: "Austin brand and web studio",
              headline: "Clearer brand direction for local teams.",
              subheadline: "Brand identity, website design, creative direction, and launch support for service businesses that need a clearer public presence.",
              primaryCta: { label: "Start a project", href: "#contact" },
              secondaryCta: { label: "View services", href: "#services" },
              panelItems: [
                { label: "Services", value: "Brand, web, and launch support" },
                { label: "Location", value: "Austin studio serving Central Texas" },
                { label: "How to start", value: "Send the project goal and timeline" }
              ]
            }),
            section("services_v3", "services.editorial_index", "bento_tiles", {
              eyebrow: "Services",
              heading: "A practical creative stack for getting a business online.",
              intro: "Brand clarity, web design, launch assets, and creative direction stay grouped into one practical engagement.",
              items: [
                { title: "Brand identity", body: "Naming support, visual direction, and identity systems for small teams.", meta: "Brand" },
                { title: "Website design", body: "Public websites and landing pages shaped around calls, forms, and customer inquiries.", meta: "Web" },
                { title: "Launch support", body: "Copy, handoff assets, and launch details that help the new presence go live.", meta: "Launch" },
                { title: "Creative direction", body: "Campaign and visual guidance for businesses refreshing how they show up.", meta: "Direction" }
              ]
            }),
            section("proof_v3", "proof.location_anchor", "local_anchor", {
              eyebrow: "Studio details",
              heading: "Start with the project and timeline.",
              intro: "Share the work you need, the deadline, and the best way to follow up.",
              items: [
                { label: "Phone", value: business.phone ?? "", detail: "Use when a project needs a direct first call." },
                { label: "Location", value: "Austin, TX", detail: "Local studio serving Austin and Central Texas." },
                { label: "Focus", value: "Brand and web", detail: "Brand systems, web design, and creative direction." }
              ]
            }),
            section("faq_v3", "faq.editorial_list", "editorial_questions", {
              heading: "What to include in the first message.",
              intro: "The best first note is short and specific enough to route the project.",
              items: [
                { title: "What kind of project is it?", body: "Share whether the work is brand identity, website design, launch support, or creative direction." },
                { title: "What timeline matters?", body: "Include the target launch window or deadline so the studio can respond with the right scope." },
                { title: "What already exists?", body: "Mention any current website, brand assets, copy, or business materials that should carry forward." }
              ]
            }),
            section("contact_v3", "contact.split", "contact_form_split", {
              eyebrow: "Contact",
              heading: "Send the project goal.",
              intro: "Share the business, project type, timeline, and best callback details."
            }),
            section("cta_v3", "cta.editorial_close", "quiet_close", {
              heading: "Have a launch in mind?",
              body: "Send the goal and timeline so the studio can help decide the right first step.",
              primaryCta: { label: "Start a project", href: "#contact" }
            })
          ]
        }
      ]
    }
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
      { breakpoint: "mobile", behavior: "stack", notes: ["Mobile composition stacks with CTA and contact path preserved."] },
      { breakpoint: "desktop", behavior: "preserve_crop", notes: ["Desktop crop preserves service subject."] }
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

function fixtureBundle(business: BusinessProfile, version: SiteVersionV3): SiteBundle {
  const site: SiteModel = {
    id: business.siteId,
    slug: "precision-paint-body-v3",
    theme: version.theme!,
    versions: [version],
    pinList: []
  };
  const extensionModel: ExtensionModel = {
    forms: [],
    workflows: [],
    customBlocks: []
  };
  return {
    businessProfile: business,
    siteModel: site,
    extensionModel,
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: business.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function fixtureProvenance() {
  return {
    source: "owner" as const,
    confidence: 1,
    verified: true,
    observedAt: createdAt
  };
}
