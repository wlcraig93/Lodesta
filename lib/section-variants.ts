import type { SectionType } from "./models";

export type SectionVariantOption = {
  id: string;
  label: string;
};

const sectionVariantCatalog = {
  hero: [
    { id: "fullbleed_food", label: "Full-bleed visual" },
    { id: "conversion_split", label: "Conversion split" },
    { id: "proof_first", label: "Proof first" },
    { id: "compact", label: "Compact" }
  ],
  trust_bar: [
    { id: "rating_hours", label: "Ratings and hours" },
    { id: "proof_strip", label: "Proof strip" },
    { id: "credential_strip", label: "Credentials" }
  ],
  services: [
    { id: "feature_grid", label: "Feature grid" },
    { id: "service_cards", label: "Service cards" },
    { id: "compact_list", label: "Compact list" }
  ],
  gallery: [
    { id: "food_grid", label: "Image grid" },
    { id: "proof_grid", label: "Proof grid" },
    { id: "portfolio_grid", label: "Portfolio grid" }
  ],
  testimonials: [
    { id: "review_summary", label: "Review summary" },
    { id: "testimonial_cards", label: "Testimonial cards" }
  ],
  faq: [
    { id: "accordion_baseline", label: "Accordion baseline" },
    { id: "conversion_faq", label: "Conversion FAQ" }
  ],
  cta: [
    { id: "conversion_band", label: "Conversion band" },
    { id: "split_cta", label: "Split CTA" }
  ],
  contact: [
    { id: "form_and_facts", label: "Form and facts" },
    { id: "compact_contact", label: "Compact contact" }
  ],
  map: [
    { id: "service_area", label: "Service area" },
    { id: "map_card", label: "Map card" }
  ],
  menu_deals: [
    { id: "feature_grid", label: "Menu grid" },
    { id: "deal_cards", label: "Deal cards" },
    { id: "compact_menu", label: "Compact menu" }
  ],
  team: [
    { id: "credential_cards", label: "Credential cards" },
    { id: "team_grid", label: "Team grid" }
  ],
  press_video: [
    { id: "link_list", label: "Link list" },
    { id: "media_strip", label: "Media strip" }
  ],
  before_after: [
    { id: "proof_cards", label: "Proof cards" },
    { id: "comparison_grid", label: "Comparison grid" }
  ]
} satisfies Record<SectionType, SectionVariantOption[]>;

export function approvedVariantsForSection(type: SectionType, currentVariant?: string): SectionVariantOption[] {
  const variants = [...sectionVariantCatalog[type]];
  if (currentVariant && !variants.some((variant) => variant.id === currentVariant)) {
    variants.unshift({ id: currentVariant, label: humanizeVariant(currentVariant) });
  }
  return variants;
}

function humanizeVariant(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
