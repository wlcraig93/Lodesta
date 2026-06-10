import { defaultDesignPlanForVertical } from "./layout-registry";
import type {
  BusinessProfile,
  ComponentControlSchemaV3,
  ExtensionModel,
  MediaAssetDecisionV3,
  PageModel,
  SectionInstanceV3,
  SiteArtDirectionV3,
  SiteBundle,
  SiteModel,
  SiteVersionV3,
  Theme
} from "./models";
import type {
  ActionSlotV3,
  CopySlotV3,
  FaqItemV3,
  ImageBackgroundV3,
  MediaSlotV3,
  NonImageBackgroundV3,
  QuoteItemV3,
  StandardItemV3,
  VisualSectionV3
} from "./generated-site-v3-visual-controls";
import { withVisualSectionV3 } from "./generated-site-v3-visual-controls";
import {
  activeSectionGeometryTemplateOrderV3,
  activeSectionTemplateOrderV3,
  sectionTemplateCatalogV3,
  sectionPurposeDefinitionV3,
  sectionTemplateForPurposeV3,
  type SectionGeometryTemplateIdV3,
  type SectionPurposeTemplateIdV3
} from "./generated-site-v3-section-templates";

const createdAt = "2026-06-03T00:00:00.000Z";
const canonicalRecipeId = "canonical_editorial";

const media = {
  hero: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg",
  workshop: "/generated-site-assets/auto-body/finished-shop-context-v1.png",
  detail: "/generated-site-assets/auto-body/paint-refinish-closeup-v1.png",
  panel: "/generated-site-assets/auto-body/before-after-body-panel-v1.png",
  glass: "/generated-site-assets/auto-body/glass-service-v1.jpg",
  texture: "/generated-site-assets/auto-body/pdr-closeup-v1.jpg",
  exterior: "/generated-site-assets/auto-body/exterior-hail-dent-panel-v1.png"
} as const;

const canonicalSectionBackgroundsV3: Record<"light" | "page" | "subtleGradient" | "brandGradient", NonImageBackgroundV3> = {
  light: { kind: "solid", token: "surface" },
  page: { kind: "solid", token: "page" },
  subtleGradient: { kind: "gradient", token: "subtle" },
  brandGradient: { kind: "gradient", token: "brand" }
};

function canonicalImageBackgroundV3(url: string): ImageBackgroundV3 {
  return { kind: "image", url, focalPoint: "center" };
}

type BusinessShell = {
  id: string;
  vertical: BusinessProfile["vertical"];
  name: string;
  category: string;
  description: string;
  city: string;
  region: string;
  street: string;
  services: string[];
  serviceHighlights: string[];
  serviceAreas: string[];
  proof: [string, string, string, string];
  email?: string;
};

export const canonicalPageSectionPurposeOrderV3 = [
  "hero.split",
  "proof.facts_strip",
  "story.split_media",
  "highlights.grid",
  "feature.band",
  "pricing.packages",
  "services.rows",
  "media.feature",
  "media.gallery",
  "proof.quote_wall",
  "process.steps",
  "faq.list",
  "proof.facts_cta",
  "statement.editorial",
  "local.location_panel",
  "contact.split"
] as const satisfies readonly SectionPurposeTemplateIdV3[];

export const canonicalActiveSectionTemplateOrderV3 = activeSectionGeometryTemplateOrderV3;
export const canonicalActiveSectionTemplateVariantOrderV3 = [] as const;

export { activeSectionGeometryTemplateOrderV3, activeSectionTemplateOrderV3, sectionTemplateCatalogV3 };

type CanonicalPageSectionTemplateInstanceV3 = {
  purposeId: SectionPurposeTemplateIdV3;
  sectionTemplateId: SectionGeometryTemplateIdV3;
  visualSection: VisualSectionV3;
  controls: ComponentControlSchemaV3;
};

const businessShells: BusinessShell[] = [
  {
    id: "auto_body",
    vertical: "auto_body",
    name: "Meridian Body Works",
    category: "Auto body shop",
    description: "Local repair shop for visible body, paint, glass, and exterior damage.",
    city: "Austin",
    region: "TX",
    street: "1808 Manor Road",
    services: ["Collision repair", "Paint refinishing", "Dent repair", "Glass service"],
    serviceHighlights: ["Collision repair", "Paint refinishing", "Dent repair", "Glass service"],
    serviceAreas: ["Austin", "East Austin"],
    proof: ["Same-week intake", "Paint and panel focus", "Direct phone handoff", "Local shop team"],
    email: "hello@meridianbody.example"
  },
  {
    id: "home_service",
    vertical: "home_services",
    name: "Harbor Home Service",
    category: "Home service team",
    description: "Neighborhood service team for small repairs, maintenance visits, and home projects.",
    city: "Denver",
    region: "CO",
    street: "2417 South Broadway",
    services: ["Repair visits", "Maintenance plans", "Fixture installs", "Project walkthroughs"],
    serviceHighlights: ["Repair visits", "Maintenance plans", "Fixture installs", "Project walkthroughs"],
    serviceAreas: ["Denver", "Englewood"],
    proof: ["Phone-first scheduling", "Home-ready crews", "Clear arrival windows", "Plain project notes"]
  },
  {
    id: "restaurant",
    vertical: "restaurant",
    name: "Alder & Hearth Cafe",
    category: "Restaurant and cafe",
    description: "All-day neighborhood cafe with counter service, seasonal plates, and group pickup.",
    city: "Portland",
    region: "OR",
    street: "909 East Burnside Street",
    services: ["Breakfast", "Lunch", "Coffee", "Group orders"],
    serviceHighlights: ["Morning counter", "Seasonal lunch", "Coffee bar", "Group pickup"],
    serviceAreas: ["Portland", "Central Eastside"],
    proof: ["Open daily", "Counter and pickup", "Seasonal menu", "Neighborhood location"],
    email: "orders@alderhearth.example"
  },
  {
    id: "beauty_salon",
    vertical: "beauty_salon",
    name: "Willow Chair Studio",
    category: "Beauty salon",
    description: "Independent salon for cuts, color, styling, and simple appointment planning.",
    city: "Minneapolis",
    region: "MN",
    street: "324 Lyndale Avenue",
    services: ["Cuts", "Color", "Styling", "Consults"],
    serviceHighlights: ["Cuts", "Color", "Event styling", "Consults"],
    serviceAreas: ["Minneapolis", "North Loop"],
    proof: ["By-appointment studio", "Focused color work", "Simple consults", "Calm salon setting"],
    email: "studio@willowchair.example"
  },
  {
    id: "med_spa",
    vertical: "med_spa",
    name: "Northline Skin Clinic",
    category: "Skin clinic",
    description: "Clinic-style aesthetic care with consults, treatment planning, and follow-up visits.",
    city: "Scottsdale",
    region: "AZ",
    street: "4112 North Marshall Way",
    services: ["Skin consults", "Facials", "Injectables", "Treatment plans"],
    serviceHighlights: ["Skin consults", "Treatment plans", "Follow-up visits", "Membership care"],
    serviceAreas: ["Scottsdale", "Phoenix"],
    proof: ["Consult-led care", "Private treatment rooms", "Clear preparation notes", "Follow-up support"],
    email: "care@northlineskin.example"
  },
  {
    id: "law_firm",
    vertical: "law_firm",
    name: "Cedarline Legal",
    category: "Local law office",
    description: "Local legal office for consultations, planning matters, and next-step guidance.",
    city: "Raleigh",
    region: "NC",
    street: "212 South Dawson Street",
    services: ["Consultations", "Estate planning", "Business matters", "Document review"],
    serviceHighlights: ["Consultations", "Estate planning", "Business matters", "Document review"],
    serviceAreas: ["Raleigh", "Wake County"],
    proof: ["Consultation-first", "Plain-language review", "Local office access", "Defined next steps"],
    email: "hello@cedarlinelegal.example"
  },
  {
    id: "dental",
    vertical: "dental",
    name: "Lakeview Dental Room",
    category: "Dental office",
    description: "Neighborhood dental care for cleanings, evaluations, treatment planning, and urgent needs.",
    city: "Madison",
    region: "WI",
    street: "706 Williamson Street",
    services: ["Cleanings", "New patient visits", "Treatment planning", "Urgent dental care"],
    serviceHighlights: ["Cleanings", "New patient visits", "Treatment planning", "Urgent care"],
    serviceAreas: ["Madison", "Monona"],
    proof: ["New patient intake", "Clear treatment plans", "Family scheduling", "Local dental team"],
    email: "care@lakeviewdental.example"
  },
  {
    id: "fitness",
    vertical: "fitness",
    name: "Forma Wellness Club",
    category: "Fitness and wellness studio",
    description: "Small-format training and recovery studio with classes, coaching, and wellness sessions.",
    city: "Nashville",
    region: "TN",
    street: "1207 Villa Place",
    services: ["Small-group training", "Private coaching", "Recovery sessions", "Intro consults"],
    serviceHighlights: ["Small groups", "Private coaching", "Recovery sessions", "Intro consults"],
    serviceAreas: ["Nashville", "Wedgewood-Houston"],
    proof: ["Small groups", "Coach-led sessions", "Recovery support", "Easy intro call"]
  },
  {
    id: "real_estate",
    vertical: "real_estate",
    name: "Pine & State Realty",
    category: "Real estate team",
    description: "Local real estate team for buyer consults, listing preparation, and market guidance.",
    city: "Boise",
    region: "ID",
    street: "510 West Main Street",
    services: ["Buyer consults", "Listing prep", "Market reviews", "Neighborhood tours"],
    serviceHighlights: ["Buyer consults", "Listing prep", "Market reviews", "Neighborhood tours"],
    serviceAreas: ["Boise", "Garden City"],
    proof: ["Local market focus", "Listing prep support", "Clear showing plans", "Direct agent handoff"],
    email: "team@pinestate.example"
  },
  {
    id: "landscaping",
    vertical: "landscaping",
    name: "Fieldstone Landscape",
    category: "Landscape company",
    description: "Outdoor service team for cleanups, planting, seasonal work, and landscape refreshes.",
    city: "Columbus",
    region: "OH",
    street: "1770 King Avenue",
    services: ["Seasonal cleanups", "Planting", "Mulch and beds", "Outdoor refreshes"],
    serviceHighlights: ["Seasonal cleanups", "Planting", "Mulch and beds", "Outdoor refreshes"],
    serviceAreas: ["Columbus", "Upper Arlington"],
    proof: ["Seasonal scheduling", "Outdoor-ready crews", "Clear property notes", "Local service routes"]
  },
  {
    id: "veterinary",
    vertical: "veterinary",
    name: "Juniper Veterinary Care",
    category: "Veterinary clinic",
    description: "Local veterinary clinic for wellness visits, sick visits, vaccination, and care planning.",
    city: "Bend",
    region: "OR",
    street: "1304 Northwest Galveston Avenue",
    services: ["Wellness visits", "Sick visits", "Vaccinations", "Care planning"],
    serviceHighlights: ["Wellness visits", "Sick visits", "Vaccinations", "Care planning"],
    serviceAreas: ["Bend", "Redmond"],
    proof: ["Clinic visit planning", "Care reminders", "Local vet team", "Phone triage"],
    email: "care@junipervet.example"
  },
  {
    id: "creative_studio",
    vertical: "creative_studio",
    name: "Slate Room Studio",
    category: "Professional studio",
    description: "Independent studio for brand direction, launch materials, and website refreshes.",
    city: "Chicago",
    region: "IL",
    street: "612 West Lake Street",
    services: ["Brand direction", "Website refreshes", "Launch materials", "Creative retainers"],
    serviceHighlights: ["Brand direction", "Website refreshes", "Launch materials", "Creative retainers"],
    serviceAreas: ["Chicago", "Remote"],
    proof: ["Studio consults", "Launch-ready files", "Flexible scopes", "Chicago base"],
    email: "studio@slateroom.example"
  },
  {
    id: "cleaning",
    vertical: "home_services",
    name: "Brightline Cleaning Co.",
    category: "Cleaning service",
    description: "Local cleaning service for recurring home care, move-outs, and targeted deep cleans.",
    city: "Charlotte",
    region: "NC",
    street: "1418 Central Avenue",
    services: ["Recurring cleaning", "Deep cleaning", "Move-out cleaning", "Add-on visits"],
    serviceHighlights: ["Recurring cleaning", "Deep cleaning", "Move-out cleaning", "Add-on visits"],
    serviceAreas: ["Charlotte", "NoDa"],
    proof: ["Recurring schedules", "Home-ready teams", "Simple visit notes", "Direct booking calls"]
  },
  {
    id: "bakery",
    vertical: "restaurant",
    name: "Flourline Bakery",
    category: "Bakery",
    description: "Neighborhood bakery for daily pastry, custom orders, coffee, and pickup.",
    city: "Sacramento",
    region: "CA",
    street: "1722 J Street",
    services: ["Daily pastry", "Custom cakes", "Coffee", "Pickup orders"],
    serviceHighlights: ["Daily pastry", "Custom cakes", "Coffee bar", "Pickup orders"],
    serviceAreas: ["Sacramento", "Midtown"],
    proof: ["Daily bakery case", "Pickup planning", "Custom order notes", "Local storefront"],
    email: "orders@flourline.example"
  },
  {
    id: "tutoring",
    vertical: "general_local",
    name: "Summit Learning Room",
    category: "Tutoring center",
    description: "Local tutoring center for subject support, test prep, and academic planning.",
    city: "Ann Arbor",
    region: "MI",
    street: "223 East Liberty Street",
    services: ["Subject tutoring", "Test prep", "Study planning", "Parent consults"],
    serviceHighlights: ["Subject tutoring", "Test prep", "Study planning", "Parent consults"],
    serviceAreas: ["Ann Arbor", "Ypsilanti"],
    proof: ["Student-first intake", "Flexible sessions", "Progress notes", "Local learning space"],
    email: "learn@summitroom.example"
  },
  {
    id: "pet_grooming",
    vertical: "general_local",
    name: "Oak & Leash Grooming",
    category: "Pet grooming studio",
    description: "Local grooming studio for bath visits, coat care, nail trims, and simple scheduling.",
    city: "Asheville",
    region: "NC",
    street: "88 Haywood Road",
    services: ["Bath visits", "Coat care", "Nail trims", "Puppy intros"],
    serviceHighlights: ["Bath visits", "Coat care", "Nail trims", "Puppy intros"],
    serviceAreas: ["Asheville", "West Asheville"],
    proof: ["Calm appointment flow", "Coat notes", "Direct phone scheduling", "Neighborhood studio"]
  }
];

export type CanonicalVisualGrammarQaSiteResultV3 = {
  siteId: string;
  shellId: string;
  screenshots: Array<{ viewport: string; path?: string; bytes?: number }>;
  deterministicFindings: Array<{ id: string; severity: "pass" | "warning" | "fail"; evidence: string; viewport?: string }>;
  visualSafetyScore: number;
  polishNotes: string[];
};

export type GeneratedSiteV3CanonicalVisualGrammarSite = {
  id: string;
  label: string;
  recipeId: typeof canonicalRecipeId;
  shellId: string;
  business: BusinessProfile;
  version: SiteVersionV3;
  bundle: SiteBundle;
  expectations: {
    minSections: number;
    minImageCount: number;
    expectedHeaderVisualMode: "solid" | "transparent_overlay";
    expectedPagePurposes: readonly SectionPurposeTemplateIdV3[];
    expectedSectionTemplates: readonly SectionGeometryTemplateIdV3[];
  };
};

export function createGeneratedSiteV3CanonicalVisualGrammarSites(): GeneratedSiteV3CanonicalVisualGrammarSite[] {
  return businessShells.map((shell, shellIndex) => {
    const business = businessForShell(shell, shellIndex);
    const pageSectionTemplates = canonicalPageSectionTemplates(shell, business, shellIndex);
    const version = versionForCanonicalSite(business, shell, shellIndex, pageSectionTemplates);
    return {
      id: `${canonicalRecipeId}_${shell.id}`,
      label: `Canonical editorial / ${shell.name}`,
      recipeId: canonicalRecipeId,
      shellId: shell.id,
      business,
      version,
      bundle: fixtureBundle(business, version, `canonical-${shell.id}`),
      expectations: {
        minSections: pageSectionTemplates.length,
        minImageCount: 2,
        expectedHeaderVisualMode: expectedHeaderVisualModeForCanonicalSections(pageSectionTemplates),
        expectedPagePurposes: pageSectionTemplates.map((section) => section.purposeId),
        expectedSectionTemplates: pageSectionTemplates.map((section) => section.sectionTemplateId)
      }
    };
  });
}

function expectedHeaderVisualModeForCanonicalSections(sections: readonly CanonicalPageSectionTemplateInstanceV3[]): "solid" | "transparent_overlay" {
  const firstSection = sections[0];
  return firstSection?.visualSection.options.background.kind === "image" ? "transparent_overlay" : "solid";
}

function versionForCanonicalSite(
  business: BusinessProfile,
  shell: BusinessShell,
  shellIndex: number,
  pageSectionTemplates: CanonicalPageSectionTemplateInstanceV3[]
): SiteVersionV3 {
  const theme = canonicalTheme();
  const sections = pageSectionTemplates.map(templateSection);
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: business.name,
    seo: {
      title: `${business.name} | ${shell.category} in ${shell.city}`,
      description: business.description ?? `${business.name} local website.`,
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  return {
    id: `version_${business.siteId}`,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage],
    designPlan: defaultDesignPlanForVertical(business.vertical, theme),
    createdAt,
    theme,
    artifactRefs: [],
    mediaDecisions: mediaDecisions(shell.id),
    artDirection: canonicalArtDirection(),
    artDirectionDecision: {
      id: `art_${business.siteId}`,
      version: "art-direction-decision-v3",
      selectedRecipeId: canonicalRecipeId,
      rejectedRecipeIds: [],
      inputSignals: ["generic local business", "canonical section-template library", shell.vertical],
      rationale: "Selected to exercise a small reusable V3 section-template library across many local-business categories.",
      validation: { status: "passed", issues: [] },
      tokenVersions: { fontPool: "v3-font-pool-v1", recipeCatalog: "canonical-visual-grammar-v1", componentControls: "visual-section-v3" }
    },
    pageComposition: {
      id: `composition_${business.siteId}`,
      version: "page-composition-v3",
      pages: [
        {
          id: "home",
          slug: "",
          title: business.name,
          seo: legacyHomePage.seo,
          purpose: "homepage",
          sections
        }
      ]
    }
  };
}

function canonicalPageSectionTemplates(
  shell: BusinessShell,
  business: BusinessProfile,
  shellIndex: number
): CanonicalPageSectionTemplateInstanceV3[] {
  const heroPurposeId = heroPurposeForShell(shell, shellIndex);
  return [
    canonicalSectionTemplate(heroPurposeId, heroSectionForPurpose(heroPurposeId, shell, business, shellIndex), control("two_column", "wide", "site_bg")),
    canonicalSectionTemplate("proof.facts_strip", factsStripSection(shell, business), control("single_column", "wide", "surface")),
    canonicalSectionTemplate("story.split_media", textMediaSplitSection(shell, shellIndex), control("two_column", "wide", "surface")),
    canonicalSectionTemplate("highlights.grid", introGridSection(shell), control("card_grid", "wide", "surface")),
    canonicalSectionTemplate("feature.band", featureBandSection(shell, business), control("two_column", "wide", "contrast")),
    canonicalSectionTemplate("pricing.packages", pricingIntroGridSection(shell), control("card_grid", "wide", "surface")),
    canonicalSectionTemplate("services.rows", servicesRowsSection(shell), control("editorial_rows", "wide", "site_bg")),
    canonicalSectionTemplate("media.feature", mediaFeatureSection(shell, shellIndex), control("two_column", "wide", "surface")),
    canonicalSectionTemplate("media.gallery", mediaMosaicSection(shell, shellIndex), control("two_column", "wide", "site_bg")),
    canonicalSectionTemplate("proof.quote_wall", quoteWallSection(shell), control("card_grid", "wide", "surface")),
    canonicalSectionTemplate("process.steps", processStepsSection(shell), control("editorial_rows", "wide", "surface")),
    canonicalSectionTemplate("faq.list", faqListSection(shell), control("editorial_rows", "wide", "surface")),
    canonicalSectionTemplate("proof.facts_cta", factsCtaSection(shell, business), control("two_column", "wide", "surface")),
    canonicalSectionTemplate("statement.editorial", editorialStatementSection(shell, business), control("single_column", "wide", "site_bg")),
    canonicalSectionTemplate("local.location_panel", locationPanelSection(shell, business), control("two_column", "wide", "surface")),
    canonicalSectionTemplate("contact.split", contactSplitSection(shell, business), control("two_column", "wide", "contrast"))
  ];
}

function canonicalSectionTemplate(
  purposeId: SectionPurposeTemplateIdV3,
  visualSection: VisualSectionV3,
  controls: ComponentControlSchemaV3
): CanonicalPageSectionTemplateInstanceV3 {
  return {
    purposeId,
    sectionTemplateId: sectionTemplateForPurposeV3(purposeId),
    visualSection,
    controls
  };
}

function heroPurposeForShell(shell: BusinessShell, shellIndex: number): Extract<SectionPurposeTemplateIdV3, "hero.split" | "hero.statement" | "hero.image_statement"> {
  if (shell.id === "restaurant" || shell.id === "bakery" || shellIndex % 7 === 2) return "hero.image_statement";
  if (shell.id === "law_firm" || shell.id === "creative_studio" || shellIndex % 7 === 5) return "hero.statement";
  return "hero.split";
}

function heroSectionForPurpose(
  purposeId: Extract<SectionPurposeTemplateIdV3, "hero.split" | "hero.statement" | "hero.image_statement">,
  shell: BusinessShell,
  business: BusinessProfile,
  shellIndex: number
): VisualSectionV3 {
  if (purposeId === "hero.image_statement") return heroImageStatementSection(shell, business, shellIndex);
  if (purposeId === "hero.statement") return heroStatementSection(shell, business);
  return heroSplitSection(shell, business, shellIndex);
}

function heroSplitSection(shell: BusinessShell, business: BusinessProfile, shellIndex: number): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "hero_split",
    options: { background: canonicalSectionBackgroundsV3.page },
    slots: {
      copy: copySlot({
        eyebrow: `${shell.city} ${shell.category}`,
        heading: heroHeading(shell),
        body: heroBody(shell),
        actions: [
          { label: business.phone ? "Call now" : "Start a request", href: business.phone ? `tel:${phoneDigits(business.phone)}` : "#contact", style: "primary" },
          { label: "View services", href: "#services", style: "secondary" }
        ]
      }),
      media: mediaSlot(rotatedMedia(shellIndex).slice(0, 1)),
      facts: { items: factItems(shell, business) }
    }
  };
}

function heroImageStatementSection(shell: BusinessShell, business: BusinessProfile, shellIndex: number): VisualSectionV3 {
  const centered = shell.id === "restaurant" || shell.id === "bakery";
  return {
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align: centered ? "center" : "left", background: canonicalImageBackgroundV3(rotatedMedia(shellIndex)[0]?.url ?? media.hero) },
    slots: {
      copy: copySlot({
        eyebrow: `${shell.city} ${shell.category}`,
        heading: heroHeading(shell),
        body: heroBody(shell),
        actions: [
          { label: business.phone ? "Call now" : "Start a request", href: business.phone ? `tel:${phoneDigits(business.phone)}` : "#contact", style: "primary" },
          { label: "View services", href: "#services", style: "secondary" }
        ]
      })
    }
  };
}

function heroStatementSection(shell: BusinessShell, business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align: "center", background: canonicalSectionBackgroundsV3.subtleGradient },
    slots: {
      copy: copySlot({
        eyebrow: `${shell.city} ${shell.category}`,
        heading: heroHeading(shell),
        body: heroBody(shell),
        actions: [
          { label: business.phone ? "Call now" : "Start a request", href: business.phone ? `tel:${phoneDigits(business.phone)}` : "#contact", style: "primary" },
          { label: "View services", href: "#services", style: "secondary" }
        ]
      }),
      facts: { items: factItems(shell, business) }
    }
  };
}

function textMediaSplitSection(shell: BusinessShell, shellIndex: number): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "split_media",
    anchorId: "proof",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient, mediaSide: shellIndex % 2 === 0 ? "left" : "right" },
    slots: {
      copy: copySlot({
        eyebrow: "Approach",
        heading: storyHeading(shell),
        body: `${shell.description} Visitors can move from first impression to contact without losing the service details they came to compare.`,
        actions: [{ label: "Talk through timing", href: "#contact", style: "text" }]
      }),
      media: mediaSlot(rotatedMedia(shellIndex + 2).slice(0, 1))
    }
  };
}

function introGridSection(shell: BusinessShell): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "intro_grid",
    anchorId: "highlights",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient, cardTreatment: "standard" },
    slots: {
      intro: copySlot({
        eyebrow: "Highlights",
        heading: "Three details worth making obvious.",
        body: `${shell.name} gives visitors a quick read on the service fit, the contact path, and the local details before they keep reading.`
      }),
      items: { items: highlightItems(shell) }
    }
  };
}

function featureBandSection(shell: BusinessShell, business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "feature_band",
    options: { background: canonicalSectionBackgroundsV3.brandGradient },
    slots: {
      copy: copySlot({
        eyebrow: "Good fit",
        heading: "A direct path for the most common request.",
        body: `${shell.name} keeps the first conversation focused on ${shell.serviceHighlights.slice(0, 2).join(" and ").toLowerCase()}, then routes the details clearly.`,
        actions: [{ label: business.phone ? "Call now" : "Contact", href: business.phone ? `tel:${phoneDigits(business.phone)}` : "#contact", style: "secondary" }]
      }),
      facts: { items: featureFacts(shell) }
    }
  };
}

function servicesRowsSection(shell: BusinessShell): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "services",
    options: { background: canonicalSectionBackgroundsV3.light },
    slots: {
      intro: copySlot({
        eyebrow: "Services",
        heading: "Main services, easy to compare.",
        body: `${shell.name} keeps the primary options short, scannable, and close to the contact path.`
      }),
      items: { items: shell.serviceHighlights.map((title, index) => ({
        title,
        body: serviceBody(shell, index),
        meta: String(index + 1).padStart(2, "0")
      })) }
    }
  };
}

function mediaFeatureSection(shell: BusinessShell, shellIndex: number): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "media_feature",
    options: { background: canonicalSectionBackgroundsV3.light },
    slots: {
      copy: copySlot({
        eyebrow: "Setting",
        heading: "A clearer look at how the work fits.",
        body: `${shell.name} can show the service context at a wider scale while keeping the surrounding details short and useful.`
      }),
      media: mediaSlot(rotatedMedia(shellIndex + 4).slice(0, 1), "below")
    }
  };
}

function mediaMosaicSection(shell: BusinessShell, shellIndex: number): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "media_mosaic",
    options: { background: canonicalSectionBackgroundsV3.light },
    slots: {
      copy: copySlot({
        eyebrow: "Gallery",
        heading: "A few views, held in one clean frame.",
        body: `${shell.name} can show a small set of visual details without turning the page into a loose image dump.`
      }),
      media: mediaSlot(rotatedMedia(shellIndex + 5).slice(0, 3), "below")
    }
  };
}

function quoteWallSection(shell: BusinessShell): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "quote_wall",
    anchorId: "proof",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient },
    slots: {
      intro: copySlot({
        eyebrow: "Proof points",
        heading: "Three signals that reduce hesitation.",
        body: `${shell.name} can make the local fit easier to judge before a visitor decides to call.`
      }),
      items: { items: quoteItems(shell) }
    }
  };
}

function pricingIntroGridSection(shell: BusinessShell): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "intro_grid",
    anchorId: "services",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient, cardTreatment: "comparison" },
    slots: {
      intro: copySlot({
        eyebrow: "Service paths",
        heading: "A simple way to compare the likely fit.",
        body: `Not every visitor needs the same next step. ${shell.name} can separate first calls, recurring needs, and larger requests without inventing prices.`
      }),
      items: { items: pricingItems(shell) }
    }
  };
}

function processStepsSection(shell: BusinessShell): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "side_intro_rows",
    anchorId: "process",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient },
    slots: {
      intro: copySlot({
        eyebrow: "Process",
        heading: "A simple path from first question to next step.",
        body: `${shell.name} keeps the flow short: explain the situation, confirm the right service path, and keep contact details close.`
      }),
      items: { items: processItems(shell) }
    }
  };
}

function faqListSection(shell: BusinessShell): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "faq_list",
    anchorId: "faq",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient },
    slots: {
      intro: copySlot({
        eyebrow: "Questions",
        heading: "Common questions, answered without clutter.",
        body: `${shell.name} can keep practical visitor questions close to the conversion path without crowding the next step.`
      }),
      items: { items: faqItems(shell) }
    }
  };
}

function factsStripSection(shell: BusinessShell, business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "facts_strip",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient },
    slots: { facts: { items: factItems(shell, business) } }
  };
}

function factsCtaSection(shell: BusinessShell, business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "facts_cta",
    options: { background: canonicalSectionBackgroundsV3.subtleGradient },
    slots: {
      facts: { items: requestFacts(shell) },
      action: actionSlot({
        title: "Ready to route the request.",
        body: `${shell.name} can start with the service, timing, and contact details that matter most.`,
        cta: { label: business.phone ? "Call now" : "Contact", href: business.phone ? `tel:${phoneDigits(business.phone)}` : "#contact" }
      })
    }
  };
}

function editorialStatementSection(shell: BusinessShell, business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "editorial_statement",
    options: { background: canonicalSectionBackgroundsV3.light },
    slots: {
      copy: copySlot({
        eyebrow: "Next step",
        heading: "The next step should feel easy.",
        body: `${shell.name} can keep the request simple, the contact path visible, and the surrounding details calm.`,
        actions: [{ label: business.phone ? "Call now" : "Contact", href: business.phone ? `tel:${phoneDigits(business.phone)}` : "#contact", style: "primary" }]
      })
    }
  };
}

function locationPanelSection(shell: BusinessShell, business: BusinessProfile): VisualSectionV3 {
  const addressLine = business.address ? [business.address.street, business.address.city, business.address.region].filter(Boolean).join(", ") : undefined;
  return {
    version: "visual-section-v3",
    templateId: "location_panel",
    anchorId: "location",
    options: { background: canonicalSectionBackgroundsV3.light },
    slots: {
      copy: copySlot({
        eyebrow: "Location",
        heading: "Find the right local starting point.",
        body: `${shell.name} keeps location and coverage details close to the final contact path.`
      }),
      locations: {
        locations: [
          {
            id: `loc_${shell.id}`,
            label: business.address?.city ?? shell.serviceAreas[0] ?? shell.name,
            role: "primary",
            isPrimary: true,
            addressLine,
            localityLine: [business.address?.city, business.address?.region].filter(Boolean).join(", ") || undefined,
            phone: business.phone,
            email: business.email,
            hoursSummary: "Call to confirm",
            serviceAreas: shell.serviceAreas,
            directionsUrl: addressLine ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine)}` : undefined,
            mapEmbedIntent: addressLine ? { kind: "address", address: addressLine } : undefined
          }
        ]
      }
    }
  };
}

function contactSplitSection(shell: BusinessShell, business: BusinessProfile): VisualSectionV3 {
  return {
    version: "visual-section-v3",
    templateId: "contact_split",
    anchorId: "contact",
    options: { background: canonicalSectionBackgroundsV3.brandGradient },
    slots: {
      copy: copySlot({
        eyebrow: "Contact",
        heading: `Start with ${shell.name}.`,
        body: "Use the direct contact details and include the timing, service, or question you want the team to route first.",
        actions: [{ label: business.phone ? "Call now" : "Send details", href: business.phone ? `tel:${phoneDigits(business.phone)}` : `mailto:${business.email ?? ""}`, style: "primary" }]
      }),
      contact: { facts: contactFacts(shell, business) }
    }
  };
}

function copySlot(content: CopySlotV3): CopySlotV3 {
  return content;
}

function mediaSlot(items: MediaSlotV3["items"], caption: MediaSlotV3["caption"] = "none"): MediaSlotV3 {
  return { items, focalPoint: "center", caption };
}

function actionSlot(content: ActionSlotV3): ActionSlotV3 {
  return content;
}

function businessForShell(shell: BusinessShell, shellIndex: number): BusinessProfile {
  const phone = `(512) 555-${String(2000 + shellIndex * 13).padStart(4, "0")}`;
  return {
    id: `business_${canonicalRecipeId}_${shell.id}`,
    siteId: `site_${canonicalRecipeId}_${shell.id}`,
    name: shell.name,
    vertical: shell.vertical,
    categories: [shell.category, "Local business"],
    description: shell.description,
    phone,
    email: shell.email,
    address: { street: shell.street, city: shell.city, region: shell.region, postalCode: "00000", country: "US" },
    hours: { monday: "9 AM-5 PM", tuesday: "9 AM-5 PM", wednesday: "9 AM-5 PM", thursday: "9 AM-5 PM", friday: "9 AM-4 PM" },
    services: shell.services,
    serviceHighlights: shell.serviceHighlights,
    serviceAreas: shell.serviceAreas,
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    photos: mediaReferences(),
    pressLinks: [],
    provenance: fixtureProvenance()
  };
}

function canonicalArtDirection(): SiteArtDirectionV3 {
  return {
    version: "site-art-direction-v3",
    recipeId: canonicalRecipeId,
    fontPairingId: "editorial_serif_clean_sans",
    colorSystem: "light_editorial",
    spacingRhythm: "cinematic",
    headerMode: "minimal_wordmark",
    mediaTreatment: "editorial_crop",
    buttonSystem: "solid_with_quiet_secondary",
    cardTreatment: "hairline_surface",
    density: "open"
  };
}

function canonicalTheme(): Theme {
  return {
    paletteName: "canonical-editorial-local",
    colors: {
      background: "#f4efe5",
      surface: "#fffdf7",
      text: "#17130f",
      muted: "#62594d",
      primary: "#075f66",
      primaryText: "#ffffff",
      accent: "#b45e3d",
      border: "rgba(23, 19, 15, 0.16)"
    },
    typography: { heading: "canonical-editorial-heading", body: "canonical-editorial-body" },
    radius: "sm",
    density: "spacious",
    mood: "editorial"
  };
}

function templateSection(instance: CanonicalPageSectionTemplateInstanceV3): SectionInstanceV3 {
  const purpose = sectionPurposeDefinitionV3(instance.purposeId);
  return {
    id: sectionIdForPurpose(instance.purposeId),
    family: purpose.family,
    variant: instance.sectionTemplateId,
    props: withVisualSectionV3(
      {
        renderPath: "canonical_section_template"
      },
      instance.visualSection
    ),
    controls: instance.controls,
    slots: [],
    responsiveRules: responsiveRulesForTemplate(instance.sectionTemplateId),
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: {
      minimumValidSlots: ["heading"],
      omitWhenMissingFactKinds: [],
      blockWhenMissingFactKinds: [],
      gracefulDegradation: "Render the canonical section with honest local-business content."
    }
  };
}

function sectionIdForPurpose(purposeId: SectionPurposeTemplateIdV3) {
  switch (purposeId) {
    case "hero.split":
    case "hero.statement":
    case "hero.image_statement":
      return "hero";
    case "proof.facts_strip":
      return "facts";
    case "story.split_media":
      return "story";
    case "highlights.grid":
      return "highlights";
    case "feature.band":
      return "feature";
    case "services.rows":
      return "services";
    case "media.feature":
      return "media";
    case "media.gallery":
      return "gallery";
    case "proof.quote_wall":
      return "quotes";
    case "pricing.packages":
      return "packages";
    case "process.steps":
      return "process";
    case "faq.list":
      return "faq";
    case "proof.facts_cta":
      return "proof";
    case "statement.editorial":
      return "statement";
    case "local.location_panel":
      return "location";
    case "contact.split":
      return "contact";
  }
}

function responsiveRulesForTemplate(templateId: SectionGeometryTemplateIdV3): SectionInstanceV3["responsiveRules"] {
  const stacksAtTablet = new Set<SectionGeometryTemplateIdV3>([
    "hero_split",
    "hero_statement",
    "split_media",
    "intro_grid",
    "side_intro_rows",
    "feature_band",
    "media_feature",
    "media_mosaic",
    "quote_wall",
    "faq_list",
    "location_panel"
  ]);
  return [
    { breakpoint: "mobile", behavior: "stack", notes: [`${templateId} stacks to one column and preserves source order.`] },
    {
      breakpoint: "tablet",
      behavior: stacksAtTablet.has(templateId) ? "stack" : "compress",
      notes: [
        templateId === "hero_split" || templateId === "split_media" || templateId === "media_feature"
          ? `${templateId} stacks copy and media into full tablet rows to avoid edge-clipped media.`
          : `${templateId} preserves the section relationship with bounded columns.`
      ]
    },
    { breakpoint: "desktop", behavior: "preserve_crop", notes: [`${templateId} preserves the desktop section geometry.`] }
  ];
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
    mediaCrop: background === "media" ? "wide" : "subject",
    density: "open"
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
    id: `media_${canonicalRecipeId}_${prefix}_${id}`,
    version: "media-asset-decision-v3",
    slotId: `home.media.${index}`,
    source: "curated_stock",
    rightsStatus: "approved",
    usageScope: index === 0 ? "hero" : "section",
    sourceUrl: url,
    policyNotes: [
      "Canonical section-template verification uses existing repo media to verify layout, crop, contrast, and responsiveness.",
      "The asset is not treated as business-specific proof."
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

function rotatedMedia(offset: number) {
  const items = [
    { url: media.hero, label: "Workspace overview", caption: "Primary service context" },
    { url: media.workshop, label: "Service setting", caption: "Workspace and visit flow" },
    { url: media.detail, label: "Detail closeup", caption: "Focused service detail" },
    { url: media.panel, label: "Project detail", caption: "Practical work detail" },
    { url: media.glass, label: "Service detail", caption: "Clean section texture" },
    { url: media.texture, label: "Surface detail", caption: "Close crop for rhythm" },
    { url: media.exterior, label: "Exterior context", caption: "Local storefront context" }
  ];
  return items.map((_, index) => items[(index + offset) % items.length]);
}

function factItems(shell: BusinessShell, business: BusinessProfile) {
  return [
    { label: "Call", value: business.phone ?? "Contact", href: business.phone ? `tel:${phoneDigits(business.phone)}` : "#contact" },
    { label: "Location", value: `${shell.city}, ${shell.region}` },
    { label: "Services", value: String(shell.services.length) },
    { label: "Area", value: shell.serviceAreas.join(" and ") }
  ];
}

function contactFacts(shell: BusinessShell, business: BusinessProfile) {
  return [
    { label: "Phone", value: business.phone ?? "Use contact form", href: business.phone ? `tel:${phoneDigits(business.phone)}` : undefined },
    ...(business.email ? [{ label: "Email", value: business.email, href: `mailto:${business.email}` }] : []),
    { label: "Address", value: `${shell.street}, ${shell.city}` },
    { label: "Hours", value: "Weekdays, 9 AM-5 PM" }
  ];
}

function phoneDigits(value: string) {
  return `+1${value.replace(/\D/g, "")}`;
}

function heroHeading(shell: BusinessShell) {
  const primary = shell.serviceHighlights[0] ?? shell.services[0] ?? "Local service";
  return `${primary} with a clearer first step.`;
}

function heroBody(shell: BusinessShell) {
  return `${shell.description} Clear service paths, calm details, and direct contact options keep the first step easy to understand.`;
}

function featureFacts(shell: BusinessShell) {
  return [
    { label: "Common start", value: shell.serviceHighlights[0] ?? shell.services[0] ?? "Service request" },
    { label: "Best detail", value: "Service and timing" },
    { label: "Local area", value: shell.serviceAreas.join(" and ") }
  ];
}

function storyHeading(shell: BusinessShell) {
  return `A composed first impression for ${shell.name}.`;
}

function serviceBody(shell: BusinessShell, index: number) {
  const proof = shell.proof[index % shell.proof.length];
  const service = shell.serviceHighlights[index] ?? shell.services[index] ?? "the right service";
  return `${proof}. Visitors can compare ${service.toLowerCase()} and keep the contact path close.`;
}

function highlightItems(shell: BusinessShell): StandardItemV3[] {
  return [
    {
      title: shell.proof[0],
      body: `Useful when the first question is whether ${shell.serviceHighlights[0]?.toLowerCase() ?? "the right service"} is a match.`,
      meta: "01"
    },
    {
      title: shell.proof[1],
      body: `Helps the offer make sense before someone needs a long first call.`,
      meta: "02"
    },
    {
      title: shell.proof[2],
      body: `Keeps the handoff simple for people ready to call or send details.`,
      meta: "03"
    }
  ];
}

function quoteItems(shell: BusinessShell): QuoteItemV3[] {
  return [
    {
      quote: `A visitor can quickly see whether ${shell.serviceHighlights[0]?.toLowerCase() ?? "the first service"} fits the reason they landed here.`,
      attribution: shell.proof[0],
      context: "Signal"
    },
    {
      quote: "The page gives enough context to start a focused conversation without asking people to decode the whole business.",
      attribution: shell.proof[1],
      context: "Clarity"
    },
    {
      quote: `The direct contact path stays visible for people who already know what they need from ${shell.name}.`,
      attribution: shell.proof[2],
      context: "Handoff"
    }
  ];
}

function pricingItems(shell: BusinessShell): StandardItemV3[] {
  return [
    {
      title: "First request",
      body: `Best for visitors comparing ${shell.serviceHighlights[0]?.toLowerCase() ?? "a primary service"} and deciding whether to call.`,
      meta: "Start"
    },
    {
      title: "Planned visit",
      body: `Best when timing, location, and service fit matter more than a same-day answer.`,
      meta: "Plan"
    },
    {
      title: "Larger need",
      body: `Best when the request may involve more than one service path or a longer conversation.`,
      meta: "Compare"
    }
  ];
}

function processItems(shell: BusinessShell): StandardItemV3[] {
  return [
    {
      title: "Share the situation",
      body: `Start with the service, timing, or question that brought you to ${shell.name}.`,
      meta: "01"
    },
    {
      title: "Confirm the fit",
      body: `The team can route the request toward ${shell.serviceHighlights.slice(0, 2).join(" or ").toLowerCase()} without adding extra back-and-forth.`,
      meta: "02"
    },
    {
      title: "Keep the next step close",
      body: `Contact details stay visible so ${shell.serviceAreas[0] ?? shell.city} visitors can move from browsing to a clear next step.`,
      meta: "03"
    }
  ];
}

function faqItems(shell: BusinessShell): FaqItemV3[] {
  return [
    {
      question: "What should I include first?",
      answer: `Share the service, timing, and the best contact path so ${shell.name} can route the request cleanly.`
    },
    {
      question: "Can I call before deciding?",
      answer: "Yes. A short call is the fastest way to confirm whether the request is a good fit."
    },
    {
      question: "What area do you serve?",
      answer: `${shell.name} is centered on ${shell.city} and nearby ${shell.serviceAreas.join(" and ")} requests.`
    },
    {
      question: "What happens after I reach out?",
      answer: `The team can confirm the service path, timing, and any details needed for ${shell.serviceHighlights[0]?.toLowerCase() ?? "the next step"}.`
    }
  ];
}

function requestFacts(shell: BusinessShell) {
  return [
    { label: "Best first note", value: shell.serviceHighlights.slice(0, 2).join(" or ") },
    { label: "Include", value: "Timing and contact" },
    { label: "Local area", value: shell.serviceAreas.join(" and ") }
  ];
}
