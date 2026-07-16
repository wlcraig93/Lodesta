import type { Vertical } from "./models";

export type VerticalClassificationInput = {
  url?: string;
  prompt?: string;
  title?: string;
  description?: string;
  name?: string;
  categories?: string[];
  services?: string[];
};

const localBusinessSchemaTypes: Record<Vertical, string> = {
  restaurant: "Restaurant",
  home_services: "HomeAndConstructionBusiness",
  auto_services: "LocalBusiness",
  auto_body: "AutoBodyShop",
  beauty_salon: "BeautySalon",
  med_spa: "LocalBusiness",
  law_firm: "LegalService",
  dental: "Dentist",
  fitness: "LocalBusiness",
  real_estate: "LocalBusiness",
  landscaping: "HomeAndConstructionBusiness",
  veterinary: "VeterinaryCare",
  creative_studio: "LocalBusiness",
  general_local: "LocalBusiness"
};

export function localBusinessSchemaTypeForVertical(vertical: Vertical) {
  return localBusinessSchemaTypes[vertical];
}

/** Cheap classification for reports and model-unavailable fixture paths. */
export function inferVertical(input: VerticalClassificationInput): Vertical {
  const source = [
    input.url,
    input.prompt,
    input.title,
    input.description,
    input.name,
    ...(input.categories ?? []),
    ...(input.services ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");

  if (/\b(pizza|restaurant|cafe)\b/.test(source)) return "restaurant";
  if (/\b(med spa|aesthetic|botox|laser facial)\b/.test(source)) return "med_spa";
  if (/\b(landscap|lawn care)\w*\b/.test(source)) return "landscaping";
  if (/\b(veterinary|veterinarian|vet clinic)\b/.test(source)) return "veterinary";
  if (/\b(dentist|dental)\b/.test(source)) return "dental";
  if (/\b(auto body|automotive collision|collision repair|body shop|paint\s*(?:and|&)?\s*body|paint repair|dent repair|bumper repair|fender repair)\b/.test(source)) return "auto_body";
  if (/\b(plumb|hvac|electric)\w*\b/.test(source)) return "home_services";
  if (/\b(tire|wheel alignment|oil change|muffler|mechanic|transmission|brake (?:repair|service|shop)|smog check)\b/.test(source)) return "auto_services";
  if (/\b(salon|nail|beauty)\b/.test(source)) return "beauty_salon";
  if (/\b(law firm|lawyer|attorney)\b/.test(source)) return "law_firm";
  if (/\b(fitness|gym|personal training)\b/.test(source)) return "fitness";
  if (/\b(real estate|realtor|realty)\b/.test(source)) return "real_estate";
  if (/\b(photography|photographer|photo studio|creative studio)\b/.test(source)) return "creative_studio";
  return "general_local";
}
