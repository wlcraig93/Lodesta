import type { BusinessProfile, ExtensionModel, SiteBundle, SiteModel, SiteVersion, Theme } from "./models";
import { runAudit } from "./audit";
import { createCreativeBrief } from "./creative-brief";
import { verticalRecipes } from "./recipes";
import { compileGeneratedSiteV3Site } from "./generated-site-v3-compiler";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";

const observedAt = new Date("2026-05-28T00:00:00.000Z").toISOString();

export const sampleBusinessProfile: BusinessProfile = {
  id: "bp_joes_pizza",
  siteId: "site_joes_pizza",
  name: "Joe's Pizza",
  vertical: "restaurant",
  categories: ["Pizza restaurant", "Italian restaurant", "Local restaurant"],
  description: "Neighborhood pizza, pasta, and family dinners with online ordering and dine-in service.",
  phone: "+15551234567",
  email: "hello@joespizza.example",
  address: {
    street: "123 Main Street",
    city: "Austin",
    region: "TX",
    postalCode: "78701",
    country: "US"
  },
  geo: {
    latitude: 30.2672,
    longitude: -97.7431
  },
  hours: {
    Monday: "11:00 AM - 9:00 PM",
    Tuesday: "11:00 AM - 9:00 PM",
    Wednesday: "11:00 AM - 9:00 PM",
    Thursday: "11:00 AM - 9:00 PM",
    Friday: "11:00 AM - 10:00 PM",
    Saturday: "11:00 AM - 10:00 PM",
    Sunday: "12:00 PM - 8:00 PM"
  },
  services: ["Pizza", "Pasta", "Catering", "Dine-in", "Takeout"],
  serviceAreas: ["Austin", "Downtown Austin", "East Austin"],
  socialLinks: ["https://instagram.com/example"],
  bookingLinks: [],
  orderingLinks: ["https://toast.example/joes-pizza"],
  photos: [
    {
      id: "asset_generated_pizza",
      url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1600&q=80",
      alt: "Fresh pizza on a wooden table",
      source: "licensed",
      rightsStatus: "preclaim_safe"
    }
  ],
  reviewsSummary: {
    rating: 4.7,
    count: 328,
    sources: ["google_reference"]
  },
  pressLinks: [],
  provenance: {
    name: { source: "website", confidence: 0.92, verified: false, observedAt },
    phone: { source: "website", confidence: 0.86, verified: false, observedAt },
    address: { source: "google", confidence: 0.81, verified: false, observedAt },
    hours: { source: "google", confidence: 0.75, verified: false, observedAt },
    services: { source: "website", confidence: 0.78, verified: false, observedAt }
  }
};

type SampleVersionShell = {
  id: string;
  status: SiteVersion["status"];
  createdAt: string;
  theme?: Theme;
  presentation?: SiteVersion["presentation"];
};
type SampleSiteModelShell = Omit<SiteModel, "versions"> & { versions: SampleVersionShell[] };

export const sampleSiteModel: SiteModel = hydrateSampleSiteModel({
  id: "site_joes_pizza",
  slug: "joes-pizza",
  pinList: [],
  theme: {
    paletteName: "tomato-market",
    colors: {
      background: "#fffaf4",
      surface: "#ffffff",
      text: "#201714",
      muted: "#6f625d",
      primary: "#b82218",
      primaryText: "#ffffff",
      accent: "#f4b942",
      border: "#eadfd2"
    },
    typography: {
      heading: "var(--font-display)",
      body: "var(--font-body)"
    },
    radius: "sm",
    density: "standard",
    mood: "warm"
  },
  versions: [
    {
      id: "version_joes_pizza_published",
      status: "published",
      createdAt: observedAt,
      presentation: {
        mobileActionBehavior: "after_hero",
        reservedMobileActionSpace: true
      }
    }
  ]
});

export const sampleExtensionModel: ExtensionModel = {
  forms: [
    {
      id: "form_contact",
      siteId: "site_joes_pizza",
      name: "Catering and contact",
      submitLabel: "Send request",
      fields: [
        { id: "name", label: "Name", type: "text", required: true },
        { id: "email", label: "Email", type: "email", required: true },
        { id: "phone", label: "Phone", type: "phone", required: false },
        { id: "message", label: "How can we help?", type: "textarea", required: true }
      ]
    }
  ],
  workflows: [
    {
      id: "workflow_contact_email",
      trigger: "inquiry_created",
      destination: "email",
      config: { to: "owner@example.com" }
    }
  ],
  inboundSettings: {
    captureMode: "form_only",
    aiHandlingMode: "classify_only",
    notificationMode: "all_inquiries"
  },
  customBlocks: []
};

function hydrateSampleSiteModel(siteModel: SampleSiteModelShell): SiteModel {
  const model: SiteModel = {
    ...siteModel,
    versions: siteModel.versions.map((version) => {
      const compiledV3 = compileGeneratedSiteV3Site({
        siteId: siteModel.id,
        business: sampleBusinessProfile,
        createdAt: version.createdAt
      }).version;
      applySampleHeroCopy(compiledV3);
      return {
        ...compiledV3,
        id: version.id,
        status: version.status,
        createdAt: version.createdAt,
        presentation: version.presentation ?? compiledV3.presentation,
        theme: compiledV3.theme,
      };
    })
  };
  return model;
}

function applySampleHeroCopy(version: Extract<SiteVersion, { rendererVersion: "layout-v3" }>) {
  const hero = version.pageComposition.pages[0]?.sections[0];
  const visualSection = hero ? getVisualSectionV3(hero.props) : undefined;
  if (!visualSection || (visualSection.templateId !== "hero_split" && visualSection.templateId !== "hero_statement")) return;
  visualSection.slots.copy.eyebrow = "Austin pizza, pasta, and family dinners";
  visualSection.slots.copy.heading = "Pizza night should be easy.";
  visualSection.slots.copy.body =
    "Fresh pies, generous pasta, and quick takeout from a neighborhood restaurant built around real food and fast service.";
}

export const sampleSiteBundle: SiteBundle = {
  businessProfile: sampleBusinessProfile,
  siteModel: sampleSiteModel,
  extensionModel: sampleExtensionModel,
  optimizationFindings: runAudit(sampleBusinessProfile, sampleSiteModel),
  experiments: [
    {
      id: "exp_sticky_cta_restaurant",
      cohort: "restaurant",
      hypothesis: "A persistent mobile order action increases online-order clicks.",
      surface: "sticky_cta",
      variants: [
        { id: "control", label: "Inline CTAs only" },
        { id: "sticky_order", label: "Sticky mobile order bar" }
      ],
      holdoutPercent: 0.1,
      primaryMetric: "order_clicks",
      status: "draft"
    },
    {
      id: "exp_cta_placement_restaurant",
      cohort: "restaurant",
      hypothesis: "More prominent order CTAs increase online-order clicks.",
      surface: "cta_placement",
      variants: [
        { id: "control", label: "Standard CTA prominence" },
        { id: "hero_cta_prominent", label: "Hero CTA emphasis" },
        { id: "cta_section_prominent", label: "Mid-page CTA emphasis" }
      ],
      holdoutPercent: 0.1,
      primaryMetric: "order_clicks",
      status: "draft"
    },
    {
      id: "exp_form_length_restaurant",
      cohort: "restaurant",
      hypothesis: "Shorter or contact-first forms increase catering form submissions.",
      surface: "form_length",
      variants: [
        { id: "control", label: "Standard form" },
        { id: "required_only", label: "Required fields only" },
        { id: "phone_first", label: "Phone-first field order" }
      ],
      holdoutPercent: 0.1,
      primaryMetric: "form_submits",
      status: "draft"
    },
    {
      id: "exp_hero_layout_restaurant",
      cohort: "restaurant",
      hypothesis: "A compact or visual-first hero increases online-order clicks without changing claims.",
      surface: "hero_layout",
      variants: [
        { id: "control", label: "Standard hero layout" },
        { id: "compact_hero", label: "Compact above-fold hero" },
        { id: "media_first", label: "Visual proof first" }
      ],
      holdoutPercent: 0.1,
      primaryMetric: "order_clicks",
      status: "draft"
    }
  ],
  presenceAssessment: {
    siteId: "site_joes_pizza",
    sourceUrl: "https://example.com",
    technicalNotes: ["Current site will be checked for metadata, schema, sitemap, and mobile performance."],
    visualNotes: ["Screenshots are used for brand and UX inspection, not copied into the live preview."],
    brandNotes: ["Warm food-led direction with stronger mobile order action."],
    publicPresenceNotes: ["Ratings and review counts are treated as sourced facts requiring provenance."],
    creativeBrief: createCreativeBrief({
      business: sampleBusinessProfile,
      recipe: verticalRecipes.restaurant
    })
  }
};

export function getPublishedVersion(siteModel: SiteModel) {
  return siteModel.versions.find((version) => version.status === "published") ?? siteModel.versions[0];
}

export function getEditingVersion(siteModel: SiteModel) {
  return siteModel.versions.find((version) => version.status === "draft") ?? getPublishedVersion(siteModel);
}
