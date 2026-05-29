import type { BusinessProfile, ExtensionModel, SiteBundle, SiteModel } from "./models";
import { runAudit } from "./audit";
import { createCreativeBrief } from "./creative-brief";
import { verticalRecipes } from "./recipes";

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

export const sampleSiteModel: SiteModel = {
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
      pages: [
        {
          id: "page_home",
          slug: "",
          title: "Home",
          seo: {
            title: "Joe's Pizza | Pizza, Pasta, and Takeout in Austin",
            description:
              "Order pizza, pasta, catering, and family dinners from Joe's Pizza in Austin. Dine in, take out, or order online today.",
            canonicalPath: "/"
          },
          sections: [
            {
              id: "hero_home",
              type: "hero",
              variant: "fullbleed_food",
              bindings: {
                heading: "business.name",
                phone: "business.phone"
              },
              props: {
                eyebrow: "Austin pizza, pasta, and family dinners",
                heading: "Pizza night should be easy.",
                body:
                  "Fresh pies, generous pasta, and quick takeout from a neighborhood restaurant built around real food and fast service.",
                primaryCta: { label: "Order Online", href: "https://toast.example/joes-pizza", role: "ordering" },
                secondaryCta: { label: "Call Now", href: "tel:+15551234567", role: "tel" },
                imageUrl:
                  "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1600&q=80"
              },
              fieldPolicies: {
                heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                primaryCta: { editScope: "owner_choice", experimentEligible: true, factField: false },
                layout: { editScope: "system_only", experimentEligible: true, factField: false }
              }
            },
            {
              id: "trust_home",
              type: "trust_bar",
              variant: "rating_hours",
              bindings: {
                rating: "business.reviewsSummary.rating",
                hours: "business.hours"
              },
              props: {
                items: ["4.7 Google rating", "Open daily", "Takeout and catering", "Downtown Austin"]
              },
              fieldPolicies: {
                items: { editScope: "system_only", experimentEligible: false, factField: true }
              }
            },
            {
              id: "menu_home",
              type: "menu_deals",
              variant: "feature_grid",
              bindings: {
                services: "business.services"
              },
              props: {
                heading: "Favorites that make ordering simple",
                items: [
                  { title: "Classic Pepperoni", description: "Crisp crust, tomato sauce, mozzarella, and pepperoni." },
                  { title: "Family Pasta Tray", description: "Baked pasta sized for weeknight dinners and small parties." },
                  { title: "Catering Packs", description: "Pizza, salad, and pasta bundles for offices and events." }
                ]
              },
              fieldPolicies: {
                items: { editScope: "owner_choice", experimentEligible: false, factField: false }
              }
            },
            {
              id: "gallery_home",
              type: "gallery",
              variant: "food_grid",
              bindings: {},
              props: {
                eyebrow: "Visual proof",
                heading: "Food photos should make ordering easier",
                body: "The sample uses licensed imagery. Customer-owned photos can replace these after claim.",
                images: [
                  {
                    url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1600&q=80",
                    alt: "Fresh pizza on a wooden table",
                    label: "Menu photography"
                  },
                  {
                    url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
                    alt: "Restaurant dining room",
                    label: "Dine-in experience"
                  },
                  {
                    url: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80",
                    alt: "Fresh ingredients",
                    label: "Ingredient story"
                  }
                ]
              },
              fieldPolicies: {
                heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                body: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                images: { editScope: "owner_choice", experimentEligible: false, factField: false }
              }
            },
            {
              id: "contact_home",
              type: "contact",
              variant: "split",
              bindings: {
                phone: "business.phone",
                address: "business.address",
                hours: "business.hours"
              },
              props: {
                heading: "Order, visit, or ask about catering",
                formId: "form_contact",
                primaryCta: { label: "Call Joe's Pizza", href: "tel:+15551234567", role: "tel" }
              },
              fieldPolicies: {
                formId: { editScope: "owner_choice", experimentEligible: false, factField: false },
                primaryCta: { editScope: "owner_choice", experimentEligible: true, factField: false }
              }
            },
            {
              id: "testimonials_home",
              type: "testimonials",
              variant: "review_summary",
              bindings: {
                rating: "business.reviewsSummary.rating",
                count: "business.reviewsSummary.count"
              },
              props: {
                eyebrow: "Trust",
                heading: "Proof customers can verify",
                body: "Review summaries, customer proof, and owner-approved excerpts reduce hesitation.",
                items: [
                  {
                    quote: "Review profile detected at 4.7 stars across 328 reviews.",
                    author: "Verified review profile"
                  },
                  {
                    quote: "Add owner-approved review excerpts here after claim so trust proof stays accurate.",
                    author: "Owner verification needed"
                  },
                  {
                    quote: "Use this section for catering proof, local press, or customer outcomes.",
                    author: "Conversion standard"
                  }
                ]
              },
              fieldPolicies: {
                heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                body: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                items: { editScope: "owner_choice", experimentEligible: false, factField: true }
              }
            },
            {
              id: "cta_home",
              type: "cta",
              variant: "conversion_band",
              bindings: {
                phone: "business.phone"
              },
              props: {
                eyebrow: "Next step",
                heading: "Ready for pizza night?",
                body: "The primary action repeats after menu, proof, and location context so ready visitors can act quickly.",
                primaryCta: { label: "Order Online", href: "https://toast.example/joes-pizza", role: "ordering" },
                secondaryCta: { label: "Call Instead", href: "tel:+15551234567", role: "tel" }
              },
              fieldPolicies: {
                heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                body: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                primaryCta: { editScope: "owner_choice", experimentEligible: true, factField: false },
                secondaryCta: { editScope: "owner_choice", experimentEligible: true, factField: false },
                layout: { editScope: "system_only", experimentEligible: true, factField: false }
              }
            }
          ]
        },
        {
          id: "page_menu",
          slug: "menu",
          title: "Menu",
          seo: {
            title: "Menu | Joe's Pizza Austin",
            description: "See popular pizzas, pasta trays, catering packs, and takeout options from Joe's Pizza in Austin.",
            canonicalPath: "/menu"
          },
          sections: [
            {
              id: "menu_page_hero",
              type: "hero",
              variant: "compact",
              props: {
                eyebrow: "Menu",
                heading: "Pizza, pasta, and catering without the wait.",
                body: "Use online ordering for the fastest pickup experience.",
                primaryCta: { label: "Order Online", href: "https://toast.example/joes-pizza", role: "ordering" }
              },
              bindings: {},
              fieldPolicies: {
                heading: { editScope: "owner_freetext", experimentEligible: false, factField: false },
                primaryCta: { editScope: "owner_choice", experimentEligible: true, factField: false }
              }
            },
            {
              id: "menu_page_grid",
              type: "menu_deals",
              variant: "feature_grid",
              props: {
                heading: "Popular picks",
                items: [
                  { title: "Margherita", description: "Tomato, mozzarella, basil, olive oil." },
                  { title: "Sausage & Peppers", description: "Italian sausage, roasted peppers, mozzarella." },
                  { title: "Catering Salad", description: "Greens, tomatoes, olives, and house dressing." }
                ]
              },
              bindings: {},
              fieldPolicies: {
                items: { editScope: "owner_choice", experimentEligible: false, factField: false }
              }
            }
          ]
        }
      ]
    }
  ]
};

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
      trigger: "form_submission",
      destination: "email",
      config: { to: "owner@example.com" }
    }
  ],
  customBlocks: []
};

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
      status: "running"
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
