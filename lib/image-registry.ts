import type { AssetReference, BusinessProfile, Vertical } from "./models";

export type RegistryImageAsset = AssetReference & {
  vertical: Vertical;
  width: number;
  height: number;
  usageScope: "preclaim_preview" | "published_site";
  licenseNote: string;
  label: string;
};

const registry: Record<Vertical, RegistryImageAsset[]> = {
  restaurant: [
    asset("restaurant", "restaurant_hero_pizza", "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1600&q=80", "Pizza coming out of a restaurant oven", "Menu photography"),
    asset("restaurant", "restaurant_tacos", "https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=1200&q=80", "Fresh tacos on a restaurant table", "Signature dishes"),
    asset("restaurant", "restaurant_dining_room", "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1200&q=80", "Warm restaurant dining room ready for guests", "Dining room")
  ],
  auto_body: [
    asset("auto_body", "auto_body_ai_exterior_hail_dent_panel_hero", "/generated-site-assets/auto-body/exterior-hail-dent-panel-v1.png", "Exterior vehicle side panel with hail dents and a polished repaired body panel surface", "Hail and body panel repair", "generated"),
    asset("auto_body", "auto_body_ai_bodywork_collision_paintless_dent_hail_glass_hero", "/generated-site-assets/auto-body/bodywork-hero-v1.jpg", "Vehicle exterior body panel undergoing bodywork inside a body shop", "Body panel repair", "generated"),
    asset("auto_body", "auto_body_ai_paintless_dent_repair_hail_inspection", "/generated-site-assets/auto-body/pdr-closeup-v1.jpg", "Paintless dent repair inspection on a vehicle door panel", "Paintless dent repair", "generated"),
    asset("auto_body", "auto_body_ai_windshield_glass_service", "/generated-site-assets/auto-body/glass-service-v1.jpg", "Automotive glass service on a windshield in a body shop", "Automotive glass", "generated"),
    asset("auto_body", "auto_body_ai_finished_repair_shop_context_paint_body_panel", "/generated-site-assets/auto-body/finished-shop-context-v1.png", "Finished vehicle body panel in a clean auto body shop service bay", "Finished body-panel review", "generated"),
    asset("auto_body", "auto_body_ai_paint_refinish_body_panel_closeup", "/generated-site-assets/auto-body/paint-refinish-closeup-v1.png", "Automotive paint and body panel refinishing close-up", "Paint and refinish", "generated"),
    asset("auto_body", "auto_body_ai_before_after_panel_view", "/generated-site-assets/auto-body/before-after-body-panel-v1.png", "Before and after body-panel repair preview in a clean body shop", "Before-and-after panel view", "generated"),
    asset("auto_body", "auto_body_paint_spray_booth", "https://images.pexels.com/photos/6870314/pexels-photo-6870314.jpeg?auto=compress&cs=tinysrgb&w=1200", "Technician spray painting a vehicle body panel in a paint booth", "Paint and refinish"),
    asset("auto_body", "auto_body_finished_vehicle_exterior", "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80", "Clean repaired vehicle exterior", "Finished vehicle")
  ],
  beauty_salon: [
    asset("beauty_salon", "beauty_salon_hero", "https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&w=1600&q=80", "Nail polish service in a salon", "Nail service"),
    asset("beauty_salon", "beauty_salon_station", "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80", "Salon station prepared for hair service", "Salon station"),
    asset("beauty_salon", "beauty_salon_hair_detail", "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?auto=format&fit=crop&w=1200&q=80", "Close-up of styled hair color in a salon", "Hair color detail")
  ],
  med_spa: [
    asset("med_spa", "med_spa_hero", "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1600&q=80", "Calm treatment room prepared for a spa appointment", "Treatment environment")
  ],
  law_firm: [
    asset("law_firm", "law_firm_hero", "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1600&q=80", "Law office conference room prepared for a client meeting", "Authority setting"),
    asset("law_firm", "law_firm_documents", "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80", "Legal documents reviewed at a desk", "Document review"),
    asset("law_firm", "law_firm_consultation", "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1200&q=80", "Professional consultation across a table", "Consultation")
  ],
  dental: [
    asset("dental", "dental_hero", "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?auto=format&fit=crop&w=1600&q=80", "Modern dental treatment room with patient chair", "Clinical setting")
  ],
  home_services: [
    asset("home_services", "home_services_hero", "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1600&q=80", "Home service technician working on electrical equipment", "Service capability"),
    asset("home_services", "home_services_tools", "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=1200&q=80", "Professional tools arranged for home repair work", "Service tools"),
    asset("home_services", "home_services_interior_repair", "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1200&q=80", "Home repair work in progress inside a house", "In-home repair")
  ],
  fitness: [
    asset("fitness", "fitness_hero", "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1600&q=80", "Fitness studio with training equipment ready for class", "Training space")
  ],
  real_estate: [
    asset("real_estate", "real_estate_hero", "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1600&q=80", "Residential home exterior prepared for a listing", "Local property proof")
  ],
  landscaping: [
    asset("landscaping", "landscaping_hero", "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=1600&q=80", "Landscaped yard with trimmed lawn and garden beds", "Finished yard"),
    asset("landscaping", "landscaping_garden_work", "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=80", "Gardening tools and planting work in progress", "Garden work"),
    asset("landscaping", "landscaping_green_lawn", "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1200&q=80", "Green lawn and maintained landscape edge", "Lawn care")
  ],
  veterinary: [
    asset("veterinary", "veterinary_hero", "https://images.unsplash.com/photo-1576201836106-db1758fd1c97?auto=format&fit=crop&w=1600&q=80", "Veterinary exam room with pet care equipment", "Care environment")
  ],
  creative_studio: [
    asset("creative_studio", "creative_studio_hero", "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1600&q=80", "Creative studio workspace with camera and production tools", "Studio capability"),
    asset("creative_studio", "creative_studio_camera", "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=80", "Camera and lighting setup for portrait photography and commercial shoots", "Portrait and commercial shoots"),
    asset("creative_studio", "creative_studio_workspace", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80", "Creative workspace prepared for production", "Production workspace")
  ],
  general_local: [
    asset("general_local", "general_local_hero", "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=80", "Customer conversation in a professional local business setting", "Customer conversation"),
    asset("general_local", "general_local_interior", "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80", "Clean business interior with workstations", "Trust-building space")
  ]
};

export function imageAssetsForVertical(vertical: Vertical) {
  return registry[vertical]?.length ? registry[vertical] : registry.general_local;
}

export function heroImageAssetForVertical(vertical: Vertical) {
  return imageAssetsForVertical(vertical)[0] ?? registry.general_local[0];
}

export function heroImageAssetForBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">) {
  if (business.vertical === "auto_body") {
    const terms = imageContextTerms([business.name, ...business.categories, ...business.services]);
    const hasExteriorDamageContext = ["hail", "dent", "paint", "body", "collision"].some((term) => terms.has(term));
    const exteriorPanelHero = imageAssetsForVertical("auto_body").find((asset) => asset.id === "auto_body_ai_exterior_hail_dent_panel_hero");
    if (hasExteriorDamageContext && exteriorPanelHero) return exteriorPanelHero;
  }
  return rankedAssetsForBusiness(business)[0] ?? heroImageAssetForVertical(business.vertical);
}

export function galleryImageAssetsForVertical(vertical: Vertical) {
  const assets = imageAssetsForVertical(vertical);
  const fallback = registry.general_local;
  if (vertical !== "general_local" && assets.length >= 3) return assets.slice(0, 3);
  return [...assets, ...fallback].slice(0, 3);
}

export function galleryImageAssetsForBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">, limit = 3) {
  const assets = rankedAssetsForBusiness(business);
  if (business.vertical !== "general_local" && assets.length >= limit) return assets.slice(0, limit);
  return [...assets, ...registry.general_local].slice(0, limit);
}

export function registryAssetByUrl(url: string | undefined) {
  if (!url) return undefined;
  return Object.values(registry)
    .flat()
    .find((candidate) => candidate.url === url);
}

export function verticalImageRegistryCoverage() {
  return Object.fromEntries(Object.entries(registry).map(([vertical, assets]) => [vertical, assets.length]));
}

function asset(vertical: Vertical, id: string, url: string, alt: string, label: string, source: AssetReference["source"] = "licensed"): RegistryImageAsset {
  return {
    id,
    vertical,
    url,
    alt,
    label,
    source,
    rightsStatus: "preclaim_safe",
    usageScope: "preclaim_preview",
    width: 1600,
    height: 1000,
    licenseNote:
      source === "generated"
        ? "AI-generated category image for preview use. It is not a photo of this specific business, staff, vehicles, or customer work."
        : "Licensed stock source image. Verify and replace with customer-owned or generated slot-specific photography when available."
  };
}

function rankedAssetsForBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">) {
  const assets = imageAssetsForVertical(business.vertical);
  const terms = imageContextTerms([business.name, ...business.categories, ...business.services]);
  return assets
    .map((asset, index) => ({
      asset,
      index,
      score: imageAssetScore(asset, terms)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.asset);
}

function imageContextTerms(values: string[]) {
  const stopTerms = new Set([
    "a",
    "an",
    "and",
    "the",
    "for",
    "in",
    "near",
    "local",
    "business",
    "service",
    "services",
    "customer",
    "customers",
    "contact",
    "beauty",
    "salon",
    "restaurant",
    "cafe",
    "auto",
    "body",
    "home",
    "law",
    "firm"
  ]);
  return new Set(
    values
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
      .map((term) => term.replace(/s$/, ""))
      .filter((term) => term.length >= 3 && !stopTerms.has(term))
  );
}

function imageAssetScore(asset: RegistryImageAsset, terms: Set<string>) {
  const haystack = `${asset.label} ${asset.alt}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  let score = 0;
  for (const term of terms) {
    const singular = term.replace(/s$/, "");
    if (haystack.includes(term)) score += term.length >= 5 ? 4 : 2;
    if (singular !== term && haystack.includes(singular)) score += 2;
  }
  return score;
}
