import type { ConversionGoal, SectionType, Theme, Vertical } from "./models";

/**
 * Synthesized fallback services used when a source provides none. These are
 * unverified claims: the quality gate blocks non-generic verticals that render
 * them, and they never earn service landing pages.
 */
export function defaultServicesForVertical(vertical: Vertical) {
  const defaults: Record<Vertical, string[]> = {
    restaurant: ["Menu", "Online ordering", "Catering"],
    auto_body: ["Collision repair", "Paint repair", "Dent repair"],
    auto_services: ["Flat repair", "New and used tires", "Brake service"],
    beauty_salon: ["Services and pricing", "Online booking", "Gallery"],
    med_spa: ["Consultations", "Treatments", "Before and after results"],
    law_firm: ["Practice areas", "Consultations", "Client intake"],
    dental: ["Preventive care", "New patient visits", "Cosmetic dentistry"],
    home_services: ["Emergency service", "Repairs", "Maintenance"],
    fitness: ["Classes", "Memberships", "Personal training"],
    real_estate: ["Listings", "Home valuation", "Buyer and seller consultations"],
    landscaping: ["Lawn care", "Landscape design", "Seasonal cleanup"],
    veterinary: ["Wellness exams", "Vaccinations", "New patient visits"],
    creative_studio: ["Portfolio", "Session booking", "Project inquiries"],
    general_local: []
  };
  return defaults[vertical];
}

export type VerticalRecipe = {
  vertical: Vertical;
  label: string;
  primaryGoal: ConversionGoal;
  mood: Theme["mood"];
  defaultSections: SectionType[];
  trustSignals: string[];
  integrations: string[];
};

export const verticalRecipes: Record<Vertical, VerticalRecipe> = {
  restaurant: {
    vertical: "restaurant",
    label: "Restaurant / Cafe",
    primaryGoal: "order_clicks",
    mood: "warm",
    defaultSections: ["hero", "menu_deals", "gallery", "trust_bar", "contact", "testimonials", "cta"],
    trustSignals: ["rating", "real food photos", "years in business"],
    integrations: ["Toast", "Square", "OpenTable", "Resy"]
  },
  auto_body: {
    vertical: "auto_body",
    label: "Auto Body & Repair",
    primaryGoal: "forms",
    mood: "utilitarian",
    defaultSections: ["hero", "services", "before_after", "trust_bar", "testimonials", "contact", "cta"],
    trustSignals: ["insurance accepted", "certifications", "before and after proof"],
    integrations: ["estimate form", "call tracking"]
  },
  auto_services: {
    vertical: "auto_services",
    label: "Tire & Auto Service",
    primaryGoal: "calls",
    mood: "utilitarian",
    defaultSections: ["hero", "services", "trust_bar", "testimonials", "contact", "cta"],
    trustSignals: ["fast turnaround", "fair pricing", "reviews"],
    integrations: ["call tracking", "appointment form"]
  },
  beauty_salon: {
    vertical: "beauty_salon",
    label: "Beauty Salon",
    primaryGoal: "booking_clicks",
    mood: "premium",
    defaultSections: ["hero", "gallery", "services", "testimonials", "contact", "cta"],
    trustSignals: ["photos of work", "reviews", "social following"],
    integrations: ["Booksy", "Vagaro", "Square Appointments", "Fresha"]
  },
  med_spa: {
    vertical: "med_spa",
    label: "Med Spa & Aesthetics",
    primaryGoal: "booking_clicks",
    mood: "clinical",
    defaultSections: ["hero", "services", "before_after", "team", "testimonials", "contact", "cta"],
    trustSignals: ["provider credentials", "before and after", "reviews"],
    integrations: ["booking", "financing widget"]
  },
  law_firm: {
    vertical: "law_firm",
    label: "Law Firm",
    primaryGoal: "forms",
    mood: "utilitarian",
    defaultSections: ["hero", "services", "team", "trust_bar", "testimonials", "contact", "cta"],
    trustSignals: ["bar credentials", "case results", "testimonials"],
    integrations: ["intake form", "call tracking"]
  },
  dental: {
    vertical: "dental",
    label: "Dental Practice",
    primaryGoal: "booking_clicks",
    mood: "clinical",
    defaultSections: ["hero", "services", "team", "trust_bar", "testimonials", "contact", "cta"],
    trustSignals: ["insurance accepted", "team bios", "reviews"],
    integrations: ["booking", "insurance verification"]
  },
  home_services: {
    vertical: "home_services",
    label: "Home Services",
    primaryGoal: "calls",
    mood: "utilitarian",
    defaultSections: ["hero", "services", "trust_bar", "map", "testimonials", "contact", "cta"],
    trustSignals: ["licensed and insured", "response time", "reviews"],
    integrations: ["quote form", "service area map", "call tracking"]
  },
  fitness: {
    vertical: "fitness",
    label: "Fitness Studio / Gym",
    primaryGoal: "booking_clicks",
    mood: "bold",
    defaultSections: ["hero", "services", "team", "testimonials", "contact", "cta"],
    trustSignals: ["member results", "trainer bios", "reviews"],
    integrations: ["Mindbody", "ClassPass", "scheduling"]
  },
  real_estate: {
    vertical: "real_estate",
    label: "Real Estate Agent",
    primaryGoal: "forms",
    mood: "premium",
    defaultSections: ["hero", "services", "trust_bar", "testimonials", "contact", "cta"],
    trustSignals: ["sales stats", "testimonials", "local expertise"],
    integrations: ["IDX", "valuation form", "CRM"]
  },
  landscaping: {
    vertical: "landscaping",
    label: "Landscaping / Lawn Care",
    primaryGoal: "forms",
    mood: "warm",
    defaultSections: ["hero", "services", "gallery", "map", "testimonials", "contact", "cta"],
    trustSignals: ["project photos", "reviews", "service area"],
    integrations: ["quote form", "seasonal scheduling"]
  },
  veterinary: {
    vertical: "veterinary",
    label: "Veterinary Clinic",
    primaryGoal: "booking_clicks",
    mood: "warm",
    defaultSections: ["hero", "services", "team", "trust_bar", "testimonials", "contact", "cta"],
    trustSignals: ["vet credentials", "reviews", "accepting new patients"],
    integrations: ["booking", "pet portal"]
  },
  creative_studio: {
    vertical: "creative_studio",
    label: "Photography / Creative Studio",
    primaryGoal: "forms",
    mood: "editorial",
    defaultSections: ["hero", "gallery", "services", "testimonials", "contact", "cta"],
    trustSignals: ["portfolio quality", "testimonials", "featured-in"],
    integrations: ["inquiry form", "booking"]
  },
  general_local: {
    vertical: "general_local",
    label: "Local Business",
    primaryGoal: "calls",
    mood: "warm",
    defaultSections: ["hero", "services", "trust_bar", "testimonials", "contact", "cta"],
    trustSignals: ["reviews", "real photos", "years in business"],
    integrations: ["contact form", "call tracking"]
  }
};
