import type { BusinessProfile, CreativeBrief, Vertical } from "./models";
import type { CrawlAssessment } from "./crawler";
import type { VerticalRecipe } from "./recipes";

type CreativeBriefInput = {
  business: BusinessProfile;
  recipe: VerticalRecipe;
  crawl?: CrawlAssessment;
};

export function createCreativeBrief({ business, recipe, crawl }: CreativeBriefInput): CreativeBrief {
  const primaryAction = actionForGoal(recipe.primaryGoal);
  const visualEmphasis = visualEmphasisForVertical(business.vertical);
  const weakPoints = crawl?.findings.slice(0, 4) ?? [];
  const brandCues = [
    business.categories[0],
    business.address?.city ? `${business.address.city} market` : undefined,
    crawl?.title ? `Existing title language: ${crawl.title}` : undefined,
    crawl?.assetReferences.some((asset) => asset.kind === "logo") ? "Existing logo detected as reference only" : undefined,
    business.reviewsSummary?.rating ? `${business.reviewsSummary.rating} review signal` : undefined
  ].filter((item): item is string => Boolean(item));

  return {
    designIntent: `${business.name} should feel ${recipe.mood}, ${visualEmphasis}, and built around the primary action: ${primaryAction}.`,
    mockupPrompt: [
      `Create a high-fidelity marketing website mockup direction for ${business.name}, a ${recipe.label}.`,
      `Optimize the first viewport for ${primaryAction}; include clear local trust proof, services, and contact path.`,
      `Use ${recipe.mood} styling with strong hierarchy, mobile-first conversion mechanics, and varied section rhythm.`,
      "Do not reproduce scraped photos, logos, or marketing copy; use generated or licensed placeholder visuals and fresh copy from facts only.",
      weakPoints.length ? `Address current-site weaknesses: ${weakPoints.join("; ")}.` : "Assume the current site needs stronger mobile conversion and local SEO clarity."
    ].join(" "),
    visualInspectionChecklist: [
      "Primary CTA is visible without scrolling on mobile and desktop.",
      "Phone, booking, ordering, or form path is visually dominant and tappable.",
      "Typography hierarchy makes business category, location, and offer scannable in five seconds.",
      "Trust proof appears before the visitor reaches the contact section.",
      "Mobile layout avoids cramped CTAs, hidden contact paths, and oversized hero media.",
      "Generated visual direction preserves recognizable public source brand cues with provenance."
    ],
    assetStrategy: [
      "Internal previews may use public customer website facts, copy, photos, logos, and screenshots with provenance.",
      "Owner approval remains the control for what becomes hosted published site content.",
      "Keep private credentials and access-controlled material out of generated content."
    ],
    brandCuesToPreserve: brandCues.length ? brandCues : ["Business name", "Primary category", "Local service area"]
  };
}

function actionForGoal(goal: VerticalRecipe["primaryGoal"]) {
  switch (goal) {
    case "calls":
      return "phone calls";
    case "forms":
      return "lead form submissions";
    case "booking_clicks":
      return "booking clicks";
    case "order_clicks":
      return "online ordering clicks";
    case "directions":
    case "store_visits":
      return "store visits";
  }
}

function visualEmphasisForVertical(vertical: Vertical) {
  switch (vertical) {
    case "restaurant":
      return "photo-rich and appetite-driven";
    case "auto_body":
      return "calm, credible, and proof-heavy";
    case "beauty_salon":
    case "creative_studio":
      return "portfolio-forward";
    case "med_spa":
    case "dental":
      return "clinical but warm";
    case "law_firm":
      return "authoritative and restrained";
    case "home_services":
      return "urgent, practical, and service-area clear";
    case "fitness":
      return "energetic and action-oriented";
    case "real_estate":
      return "personal-brand-forward and locally credible";
    case "landscaping":
      return "project-proof-driven";
    case "veterinary":
      return "warm and reassuring";
    case "general_local":
      return "clear, local, and trust-first";
  }
}
