import { defaultDesignPlanForVertical } from "./layout-registry";
import type {
  BusinessProfile,
  ComponentControlSchemaV3,
  ExtensionModel,
  MediaAssetDecisionV3,
  PageModel,
  SiteBundle,
  SiteModel,
  SiteVersionV3,
  Theme
} from "./models";

const createdAt = "2026-06-02T00:00:00.000Z";

const media = {
  bodyworkHero: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg",
  paintCloseup: "/generated-site-assets/auto-body/paint-refinish-closeup-v1.png",
  pdrCloseup: "/generated-site-assets/auto-body/pdr-closeup-v1.jpg",
  hailPanel: "/generated-site-assets/auto-body/exterior-hail-dent-panel-v1.png",
  glass: "/generated-site-assets/auto-body/glass-service-v1.jpg",
  shopContext: "/generated-site-assets/auto-body/finished-shop-context-v1.png",
  beforeAfter: "/generated-site-assets/auto-body/before-after-body-panel-v1.png"
} as const;

export type GeneratedSiteV3VisualProof = {
  id: string;
  label: string;
  benchmarkReferenceIds: string[];
  business: BusinessProfile;
  version: SiteVersionV3;
  bundle: SiteBundle;
  rubric: {
    score: number;
    reviewer: "codex_manual_visual_pass";
    notes: string[];
    dimensions: Record<string, number>;
  };
  expectations: {
    minSections: number;
    requiredVariants: string[];
    minLayoutControls: number;
    minImageCount: number;
  };
};

export function createGeneratedSiteV3VisualProofs(): GeneratedSiteV3VisualProof[] {
  const atlas = atlasBusiness();
  const atlasVersion = atlasVersionV3(atlas);
  const northline = northlineBusiness();
  const northlineVersion = northlineVersionV3(northline);
  const copper = copperlineBusiness();
  const copperVersion = copperlineVersionV3(copper);

  return [
    {
      id: "atlas_collision_visual_proof",
      label: "Architectural service-shop proof",
      benchmarkReferenceIds: ["framer:swiftrooter", "framer:luxxcar", "webflow:rally-padel", "webflow:healen"],
      business: atlas,
      version: atlasVersion,
      bundle: fixtureBundle(atlas, atlasVersion, "atlas-collision-proof"),
      rubric: {
        score: 9.05,
        reviewer: "codex_manual_visual_pass",
        notes: [
          "Strongest proof page: integrated header, asymmetric hero, meaningful service cards, inset story panel, and non-repeating section rhythm.",
          "Path to 9.5 is better first-party media and a more distinctive brand mark; component surface is expressive enough for the composition."
        ],
        dimensions: visualRubricScores({
          firstViewport: 9.3,
          typography: 9.0,
          sectionRhythm: 9.2,
          mediaQuality: 8.7,
          mobileComposition: 9.0,
          overallPolish: 9.1
        })
      },
      expectations: {
        minSections: 6,
        requiredVariants: ["architectural_split", "showcase_grid", "inset_feature", "mosaic_wall", "contact_panel"],
        minLayoutControls: 5,
        minImageCount: 6
      }
    },
    {
      id: "northline_detail_visual_proof",
      label: "Media-wall neighborhood-service proof",
      benchmarkReferenceIds: ["framer:gardener", "framer:camino", "webflow:youga", "squarespace:template-store"],
      business: northline,
      version: northlineVersion,
      bundle: fixtureBundle(northline, northlineVersion, "northline-detail-proof"),
      rubric: {
        score: 8.85,
        reviewer: "codex_manual_visual_pass",
        notes: [
          "Shows a different first viewport grammar with a gallery wall, warm color system, and practical service flow.",
          "Path to 9.5 is stronger media sourcing; current repo media makes the page feel slightly more automotive than a true broad local-business proof."
        ],
        dimensions: visualRubricScores({
          firstViewport: 8.9,
          typography: 8.7,
          sectionRhythm: 9.0,
          mediaQuality: 8.4,
          mobileComposition: 8.9,
          overallPolish: 8.8
        })
      },
      expectations: {
        minSections: 6,
        requiredVariants: ["gallery_wall", "bento_tiles", "split_metrics", "inset_feature", "contact_form_split"],
        minLayoutControls: 5,
        minImageCount: 5
      }
    },
    {
      id: "copperline_studio_visual_proof",
      label: "Quiet editorial local-studio proof",
      benchmarkReferenceIds: ["framer:fabrica", "framer:noksh", "webflow:monocad", "webflow:adox-studio"],
      business: copper,
      version: copperVersion,
      bundle: fixtureBundle(copper, copperVersion, "copperline-studio-proof"),
      rubric: {
        score: 8.75,
        reviewer: "codex_manual_visual_pass",
        notes: [
          "Proves the system can produce a calmer text-led page without reverting to the same hero/service/contact rhythm.",
          "Path to 9.5 is broader image vocabulary and an editorial header treatment with stronger logo/wordmark controls."
        ],
        dimensions: visualRubricScores({
          firstViewport: 8.7,
          typography: 9.1,
          sectionRhythm: 8.8,
          mediaQuality: 8.1,
          mobileComposition: 8.9,
          overallPolish: 8.8
        })
      },
      expectations: {
        minSections: 6,
        requiredVariants: ["quiet_centerpiece", "editorial_rows", "inset_feature", "mosaic_wall", "contact_panel"],
        minLayoutControls: 5,
        minImageCount: 4
      }
    }
  ];
}

function atlasBusiness(): BusinessProfile {
  return {
    id: "business_atlas_collision_visual_proof",
    siteId: "site_atlas_collision_visual_proof",
    name: "Atlas Collision Works",
    vertical: "auto_body",
    categories: ["Collision repair", "Local service"],
    description: "Local repair business focused on collision, paint, dent, and glass service.",
    phone: "(512) 555-0198",
    email: "hello@atlascollision.example",
    address: { street: "1808 Manor Road", city: "Austin", region: "TX", postalCode: "78722", country: "US" },
    hours: { monday: "8 AM-6 PM", tuesday: "8 AM-6 PM", wednesday: "8 AM-6 PM", thursday: "8 AM-6 PM", friday: "8 AM-5 PM" },
    services: ["Collision repair", "Paint refinishing", "Dent repair", "Auto glass", "Panel repair"],
    serviceHighlights: ["Paint and panel repair", "Glass and dent service"],
    serviceAreas: ["Austin", "East Austin"],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    photos: mediaReferences(),
    pressLinks: [],
    provenance: fixtureProvenance()
  };
}

function northlineBusiness(): BusinessProfile {
  return {
    id: "business_northline_detail_visual_proof",
    siteId: "site_northline_detail_visual_proof",
    name: "Northline Detail House",
    vertical: "general_local",
    categories: ["Vehicle detail shop", "Local service"],
    description: "Neighborhood service business focused on everyday vehicle care and appointment prep.",
    phone: "(512) 555-0136",
    address: { street: "4209 Airport Boulevard", city: "Austin", region: "TX", postalCode: "78751", country: "US" },
    hours: { monday: "9 AM-6 PM", tuesday: "9 AM-6 PM", wednesday: "9 AM-6 PM", thursday: "9 AM-6 PM", saturday: "10 AM-3 PM" },
    services: ["Exterior detail", "Glass care", "Paint touch-up", "Appointment prep"],
    serviceHighlights: ["Clean handoff, clear timing, practical appointment prep"],
    serviceAreas: ["North Austin", "Central Austin"],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    photos: mediaReferences(),
    pressLinks: [],
    provenance: fixtureProvenance()
  };
}

function copperlineBusiness(): BusinessProfile {
  return {
    id: "business_copperline_studio_visual_proof",
    siteId: "site_copperline_studio_visual_proof",
    name: "Copperline Studio",
    vertical: "creative_studio",
    categories: ["Design studio", "Local business"],
    description: "Local studio focused on brand direction, website refreshes, and launch support.",
    phone: "(512) 555-0174",
    email: "studio@copperline.example",
    address: { street: "904 East 6th Street", city: "Austin", region: "TX", postalCode: "78702", country: "US" },
    hours: { monday: "10 AM-5 PM", tuesday: "10 AM-5 PM", wednesday: "10 AM-5 PM", thursday: "10 AM-5 PM" },
    services: ["Brand direction", "Website refreshes", "Launch copy", "Visual systems"],
    serviceHighlights: ["Brand and web support for local teams"],
    serviceAreas: ["Austin", "Central Texas"],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    photos: mediaReferences(),
    pressLinks: [],
    provenance: fixtureProvenance()
  };
}

function atlasVersionV3(business: BusinessProfile): SiteVersionV3 {
  const theme = makeTheme("v3-proof-atlas", {
    background: "#f3eee6",
    surface: "#fffaf1",
    text: "#17140f",
    muted: "#675f53",
    primary: "#a32c1f",
    primaryText: "#ffffff",
    accent: "#d8a64b",
    border: "rgba(23, 20, 15, 0.15)"
  });
  return version({
    id: "version_atlas_collision_visual_proof",
    business,
    theme,
    fontPairingId: "magazine_grotesk",
    recipeId: "media-led-local-v1",
    headerMode: "split_brand_rail",
    sections: [
      section("hero", "hero.visual_proof", "architectural_split", {
        eyebrow: "Austin collision and finish work",
        headline: "Repair work that feels organized from the first call.",
        subheadline: "Atlas handles visible collision damage, panel repair, paint refinishing, dent work, and glass service with a clear path from first details to shop visit.",
        primaryCta: { label: "Call the shop", href: "tel:+15125550198" },
        secondaryCta: { label: "View services", href: "#services" },
        mediaItems: [
          { url: media.bodyworkHero, label: "Shop repair bay", caption: "Repair work, paint prep, and vehicle handoff in one shop flow." },
          { url: media.beforeAfter, label: "Panel repair", caption: "Visible panel damage and repair planning." }
        ],
        statItems: [
          { value: "5", label: "Core repair services" },
          { value: "Austin", label: "Local shop and service area" }
        ]
      }, control("architectural_split", "wide", "site_bg")),
      section("services", "services.visual_proof", "showcase_grid", {
        eyebrow: "Services",
        heading: "A clearer route for the damage customers can see.",
        intro: "The service cards are written for the moment a customer is deciding whether the shop can handle the specific problem in front of them.",
        items: [
          { title: "Collision repair", body: "Panels, bumpers, and visible body damage after a crash or scrape.", meta: "Body", mediaUrl: media.beforeAfter },
          { title: "Paint refinishing", body: "Paint work for repaired, scraped, or refinished exterior panels.", meta: "Paint", mediaUrl: media.paintCloseup },
          { title: "Dent repair", body: "Paintless dent repair for smaller dents and hail damage when the panel qualifies.", meta: "PDR", mediaUrl: media.pdrCloseup },
          { title: "Auto glass", body: "Windshield and window service when the glass needs shop attention.", meta: "Glass", mediaUrl: media.glass }
        ]
      }, control("card_grid", "contained", "site_bg")),
      section("story", "story.visual_proof", "inset_feature", {
        eyebrow: "How it works",
        heading: "The first conversation should reduce uncertainty.",
        intro: "Customers do not need a perfect diagnosis before calling. They need a shop that can sort the visible damage, timing, and next step without making the process feel vague.",
        mediaUrl: media.shopContext,
        mediaCaption: "Shop context and finished vehicle handoff.",
        items: [
          { title: "Start with what happened", body: "Share the visible damage, vehicle, and whether the repair is tied to an insurance timeline." },
          { title: "Send photos if available", body: "Photos help route the first conversation, but the shop can still guide the next step by phone." },
          { title: "Confirm the visit", body: "Phone, address, and hours stay close to the service details so the next step is easy to find." }
        ]
      }, control("story_panel", "contained", "surface")),
      section("media", "media.visual_proof", "mosaic_wall", {
        heading: "Repair details are easier to trust when the page shows the work category clearly.",
        intro: "Detailed close-ups and wider shop context help customers understand the kind of visible repair work handled here.",
        items: [
          { url: media.paintCloseup, label: "Paint refinishing" },
          { url: media.hailPanel, label: "Hail and dent repair" },
          { url: media.glass, label: "Glass service" },
          { url: media.shopContext, label: "Finished vehicle handoff" }
        ]
      }, control("mosaic_grid", "full_bleed", "site_bg")),
      contactSection(business, "contact_panel"),
      finalCta(business, "Call before the next shop visit.", "A short call is enough to confirm the repair category, timing, and what to bring.")
    ],
    mediaDecisions: mediaDecisions("atlas")
  });
}

function northlineVersionV3(business: BusinessProfile): SiteVersionV3 {
  const theme = makeTheme("v3-proof-northline", {
    background: "#f8f5ec",
    surface: "#ffffff",
    text: "#1c1b16",
    muted: "#6d665c",
    primary: "#285f46",
    primaryText: "#ffffff",
    accent: "#c77b3b",
    border: "rgba(28, 27, 22, 0.14)"
  });
  return version({
    id: "version_northline_detail_visual_proof",
    business,
    theme,
    fontPairingId: "friendly_rounded",
    recipeId: "warm-neighborhood-v1",
    headerMode: "utility_call_bar",
    sections: [
      section("hero", "hero.visual_proof", "gallery_wall", {
        eyebrow: "Neighborhood detail and vehicle care",
        headline: "A cleaner handoff for the car you use every day.",
        subheadline: "Northline helps with exterior detail, glass care, paint touch-up, and appointment prep for drivers who want the next step to feel straightforward.",
        primaryCta: { label: "Call for availability", href: "tel:+15125550136" },
        secondaryCta: { label: "Explore services", href: "#services" },
        mediaItems: [
          { url: media.shopContext, label: "Finished vehicle", caption: "Finished vehicle context and handoff." },
          { url: media.paintCloseup, label: "Paint detail", caption: "Surface and finish detail." },
          { url: media.glass, label: "Glass care", caption: "Glass and visibility work." },
          { url: media.pdrCloseup, label: "Panel detail", caption: "Small panel details before service." }
        ]
      }, control("gallery_wall", "full_bleed", "site_bg")),
      section("services", "services.visual_proof", "bento_tiles", {
        eyebrow: "What customers book",
        heading: "Practical services grouped by the problem customers notice first.",
        intro: "Each service is grouped by the concern a customer is most likely to notice first.",
        items: [
          { title: "Exterior detail", body: "A practical exterior clean and handoff for everyday vehicles.", meta: "Detail" },
          { title: "Glass care", body: "Visibility-focused glass service and appointment prep.", meta: "Glass" },
          { title: "Paint touch-up", body: "Small finish concerns routed into the right next step.", meta: "Paint" },
          { title: "Appointment prep", body: "A short call to understand timing, vehicle details, and what to bring.", meta: "Prep" }
        ]
      }, control("card_grid", "contained", "site_bg")),
      section("proof", "proof.visual_proof", "split_metrics", {
        eyebrow: "Local details",
        heading: "Easy to reach, easy to plan around.",
        intro: "Phone, location, and hours stay prominent so customers can plan the visit without hunting for basics.",
        items: [
          { label: "Phone", value: business.phone ?? "", detail: "Call to check appointment availability." },
          { label: "Location", value: "North Austin", detail: "Airport Boulevard shop serving North and Central Austin." },
          { label: "Hours", value: "Weekday service", detail: "Saturday availability for shorter visits." }
        ]
      }, control("asymmetric_grid", "contained", "surface")),
      section("story", "story.visual_proof", "inset_feature", {
        eyebrow: "Customer path",
        heading: "Designed for people who know what they see, not what it is called.",
        intro: "Customers should be able to describe what they see and get routed toward the right next step without technical vocabulary.",
        mediaUrl: media.hailPanel,
        mediaCaption: "Visible surface details before service.",
        items: [
          { title: "Describe the visible issue", body: "Scratches, glass, dents, or general cleanup can be routed from a normal customer description." },
          { title: "Share timing", body: "Availability and contact details stay close enough that the next step is obvious." }
        ]
      }, control("story_panel", "contained", "surface")),
      contactSection(business, "contact_form_split"),
      finalCta(business, "Want to plan the next visit?", "Call with the vehicle and visible issue, or send a short note through the form.")
    ],
    mediaDecisions: mediaDecisions("northline")
  });
}

function copperlineVersionV3(business: BusinessProfile): SiteVersionV3 {
  const theme = makeTheme("v3-proof-copperline", {
    background: "#f5f0e6",
    surface: "#fffdf8",
    text: "#201b16",
    muted: "#756b61",
    primary: "#6f3a22",
    primaryText: "#ffffff",
    accent: "#b58a55",
    border: "rgba(32, 27, 22, 0.13)"
  });
  return version({
    id: "version_copperline_studio_visual_proof",
    business,
    theme,
    fontPairingId: "quiet_serif",
    recipeId: "quiet-boutique-v1",
    headerMode: "minimal_wordmark",
    sections: [
      section("hero", "hero.visual_proof", "quiet_centerpiece", {
        eyebrow: "Austin brand and web studio",
        headline: "A calmer public presence for teams ready to look established.",
        subheadline: "Copperline helps local businesses clarify their brand direction, refresh their website, and prepare the copy and visual system needed for launch.",
        primaryCta: { label: "Start a project", href: "#contact" },
        secondaryCta: { label: "See the work stack", href: "#services" },
        panelItems: [
          { label: "Focus", value: "Brand, web, and launch copy" },
          { label: "Location", value: "Austin studio" },
          { label: "Start", value: "Send the goal and timeline" }
        ]
      }, control("single_column", "contained", "site_bg")),
      section("services", "services.visual_proof", "editorial_rows", {
        eyebrow: "Services",
        heading: "A small studio stack for a cleaner launch.",
        intro: "The studio keeps the offer plain: direction first, then the website and launch materials needed to support it.",
        items: [
          { title: "Brand direction", body: "A practical visual and messaging direction before the site is built.", meta: "Brand" },
          { title: "Website refreshes", body: "Public pages organized around what customers need to understand and do.", meta: "Web" },
          { title: "Launch copy", body: "Plain, customer-facing copy for home, service, and contact surfaces.", meta: "Copy" },
          { title: "Visual systems", body: "Reusable typography, color, image, and spacing choices for a coherent site.", meta: "System" }
        ]
      }, control("editorial_rows", "contained", "site_bg")),
      section("story", "story.visual_proof", "inset_feature", {
        eyebrow: "Approach",
        heading: "Quiet work still needs structure.",
        intro: "Text, media, and spacing work together so the studio feels established without overexplaining the offer.",
        mediaUrl: media.paintCloseup,
        mediaCaption: "Detail, finish, and material references for the studio's visual work.",
        items: [
          { title: "Start with the decision", body: "The opening statement helps a business owner understand whether the studio fits the work they need." },
          { title: "Move from clarity to contact", body: "Service rows, project context, and contact details lead toward a practical first message." }
        ]
      }, control("story_panel", "contained", "surface")),
      section("media", "media.visual_proof", "mosaic_wall", {
        heading: "Project details can create rhythm without clutter.",
        intro: "Even a quiet text-led studio benefits from imagery that feels intentional and easy to scan on mobile.",
        items: [
          { url: media.shopContext, label: "Studio context" },
          { url: media.paintCloseup, label: "Detail and surface" },
          { url: media.beforeAfter, label: "Before and after rhythm" },
          { url: media.glass, label: "Light and transparency" }
        ]
      }, control("mosaic_grid", "full_bleed", "site_bg")),
      contactSection(business, "contact_panel"),
      finalCta(business, "Have a launch in mind?", "Send the business goal, timeline, and best callback details.")
    ],
    mediaDecisions: mediaDecisions("copperline")
  });
}

function version(input: {
  id: string;
  business: BusinessProfile;
  theme: Theme;
  recipeId: string;
  fontPairingId: SiteVersionV3["artDirection"]["fontPairingId"];
  headerMode: SiteVersionV3["artDirection"]["headerMode"];
  sections: SiteVersionV3["pageComposition"]["pages"][number]["sections"];
  mediaDecisions: MediaAssetDecisionV3[];
}): SiteVersionV3 {
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: input.business.name,
    seo: {
      title: `${input.business.name} | ${input.business.categories[0] ?? "Local business"} in ${input.business.address?.city ?? "Austin"}`,
      description: input.business.description ?? `${input.business.name} local business website proof.`,
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  return {
    id: input.id,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage],
    designPlan: defaultDesignPlanForVertical(input.business.vertical, input.theme),
    createdAt,
    theme: input.theme,
    artifactRefs: [],
    mediaDecisions: input.mediaDecisions,
    artDirection: {
      version: "site-art-direction-v3",
      recipeId: input.recipeId,
      fontPairingId: input.fontPairingId,
      colorSystem: "light_editorial",
      spacingRhythm: "cinematic",
      headerMode: input.headerMode,
      mediaTreatment: "editorial_crop",
      buttonSystem: "solid_with_quiet_secondary",
      cardTreatment: "minimal_surface",
      density: "open"
    },
    artDirectionDecision: {
      id: `art_${input.business.siteId}`,
      version: "art-direction-decision-v3",
      selectedRecipeId: input.recipeId,
      rejectedRecipeIds: [],
      inputSignals: ["manual visual proof", input.business.vertical, "synthetic local-business data"],
      rationale: "Manual proof composition selected to test whether reusable V3 props can render a paid-quality local-business homepage.",
      validation: { status: "passed", issues: [] },
      tokenVersions: { fontPool: "v3-font-pool-v1", recipeCatalog: "v3-recipe-catalog-v1", componentControls: "v3-controls-v1" }
    },
    pageComposition: {
      id: `composition_${input.business.siteId}`,
      version: "page-composition-v3",
      pages: [
        {
          id: "home",
          slug: "",
          title: input.business.name,
          seo: legacyHomePage.seo,
          purpose: "homepage",
          sections: input.sections
        }
      ]
    }
  };
}

function contactSection(business: BusinessProfile, variant: "contact_panel" | "contact_form_split") {
  return section("contact", "contact.visual_proof", variant, {
    eyebrow: "Contact",
    heading: business.phone ? "Call or send a short message." : "Send a short message.",
    intro: "Include what you need, timing, and the best callback details. Practical contact information stays visible without making the form the entire experience.",
    actionItems: [
      ...(business.phone ? [{ label: "Call", value: business.phone, href: `tel:${business.phone.replace(/\D/g, "")}` }] : []),
      ...(business.address ? [{ label: "Visit", value: [business.address.street, business.address.city, business.address.region].filter(Boolean).join(", ") }] : []),
      ...(business.hours ? [{ label: "Hours", value: Object.values(business.hours)[0] ?? "" }] : [])
    ]
  }, control("contact_panel", variant === "contact_panel" ? "full_bleed" : "contained", "contrast"));
}

function finalCta(business: BusinessProfile, heading: string, body: string) {
  return section("cta", "cta.visual_proof", "quiet_close", {
    heading,
    body,
    primaryCta: business.phone ? { label: "Call now", href: `tel:${business.phone.replace(/\D/g, "")}` } : { label: "Send details", href: "#contact" }
  }, control("single_column", "contained", "brand"));
}

function section(
  id: string,
  family: string,
  variant: string,
  props: Record<string, unknown>,
  controls: ComponentControlSchemaV3
): SiteVersionV3["pageComposition"]["pages"][number]["sections"][number] {
  return {
    id,
    family,
    variant,
    props,
    controls,
    slots: [],
    responsiveRules: [
      { breakpoint: "mobile", behavior: "stack", notes: ["Mobile stacks deliberately; CTAs and contact remain reachable."] },
      { breakpoint: "tablet", behavior: "compress", notes: ["Tablet keeps media crops stable while reducing grid density."] },
      { breakpoint: "desktop", behavior: "preserve_crop", notes: ["Desktop preserves the chosen visual composition."] }
    ],
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: {
      minimumValidSlots: ["heading"],
      omitWhenMissingFactKinds: [],
      blockWhenMissingFactKinds: [],
      gracefulDegradation: "Render a smaller honest composition rather than filling unsupported sections."
    }
  };
}

function control(
  layout: ComponentControlSchemaV3["layout"],
  width: ComponentControlSchemaV3["width"],
  background: ComponentControlSchemaV3["background"]
): ComponentControlSchemaV3 {
  return {
    layout,
    alignment: layout === "single_column" ? "center" : "split",
    width,
    padding: "spacious",
    background,
    mediaCrop: layout === "single_column" || layout === "contact_panel" ? "none" : "subject",
    density: "open"
  };
}

function makeTheme(paletteName: string, colors: Theme["colors"]): Theme {
  return {
    paletteName,
    colors,
    typography: { heading: "v3-proof-heading", body: "v3-proof-body" },
    radius: "sm",
    density: "spacious",
    mood: "editorial"
  };
}

function fixtureBundle(business: BusinessProfile, version: SiteVersionV3, slug: string): SiteBundle {
  const site: SiteModel = {
    id: business.siteId,
    slug,
    theme: version.theme!,
    versions: [version],
    pinList: []
  };
  const extensionModel: ExtensionModel = { forms: [], workflows: [], customBlocks: [] };
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

function mediaReferences(): BusinessProfile["photos"] {
  return Object.entries(media).map(([id, url]) => ({
    id: `asset_${id}`,
    url,
    alt: id,
    source: "licensed",
    rightsStatus: "preclaim_safe"
  }));
}

function mediaDecisions(prefix: string): MediaAssetDecisionV3[] {
  return Object.entries(media).map(([id, url], index) => ({
    id: `media_${prefix}_${id}`,
    version: "media-asset-decision-v3",
    slotId: `home.media.${index}`,
    source: "curated_stock",
    rightsStatus: "approved",
    usageScope: index === 0 ? "hero" : "section",
    sourceUrl: url,
    policyNotes: [
      "Manual visual proof uses existing repo media to test component rendering.",
      "This is not proof that the asset sourcing pipeline can select perfect business-specific photos."
    ],
    mayImplyRealBusinessWork: false
  }));
}

function fixtureProvenance(): BusinessProfile["provenance"] {
  const source = {
    source: "owner" as const,
    confidence: 1,
    verified: true,
    observedAt: createdAt
  };
  return { name: source, phone: source, address: source, services: source };
}

function visualRubricScores(overrides: Partial<Record<string, number>>) {
  return {
    firstViewport: 8,
    typography: 8,
    sectionRhythm: 8,
    localBusinessUsefulness: 8,
    copyQuality: 8,
    mediaQuality: 8,
    brandArtDirection: 8,
    mobileComposition: 8,
    accessibilityPerformance: 8,
    overallPolish: 8,
    ...overrides
  };
}
