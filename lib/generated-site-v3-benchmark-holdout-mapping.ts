import {
  generatedSiteV3BenchmarkReferences,
  type GeneratedSiteV3BenchmarkArchetype
} from "./generated-site-v3-benchmark-corpus";

export type GeneratedSiteV3HoldoutMappingConfidence = "strong" | "moderate" | "weak";

export type GeneratedSiteV3HoldoutMapping = {
  referenceId: string;
  archetype: GeneratedSiteV3BenchmarkArchetype;
  heroVariant: string;
  servicesVariant: string;
  mediaVariant: string;
  proofVariant: string;
  storyVariant: string;
  contactVariant: string;
  footerPattern: string;
  confidence: GeneratedSiteV3HoldoutMappingConfidence;
  mappingNotes: string[];
  blockerNotes: string[];
};

export const generatedSiteV3SelectableBenchmarkVariants = {
  hero: [
    "appointment_card_overlay",
    "editorial_scatter",
    "premium_object_stage",
    "architectural_split",
    "gallery_wall",
    "quiet_centerpiece",
    "media_masthead"
  ],
  services: ["editorial_rows", "bento_tiles", "showcase_grid", "program_rows", "hospitality_menu_preview", "portfolio_index", "plan_cards"],
  media: ["mosaic_wall", "immersive_media_band"],
  proof: ["local_anchor"],
  story: ["inset_feature"],
  contact: ["contact_form_split"],
  footer: ["standard_directory_footer"]
} as const;

export const generatedSiteV3BenchmarkHoldoutMappings: GeneratedSiteV3HoldoutMapping[] = [
  {
    referenceId: "framer:noksh",
    archetype: "quiet_editorial_professional",
    heroVariant: "quiet_centerpiece",
    servicesVariant: "portfolio_index",
    mediaVariant: "immersive_media_band",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "moderate",
    mappingNotes: ["Uses quiet text hierarchy, professional capability rows, and one large image band without custom CSS."],
    blockerNotes: ["Needs a true architectural image-spread/control pair to match the reference's slow image rhythm."]
  },
  {
    referenceId: "framer:elevate",
    archetype: "studio_portfolio_editorial",
    heroVariant: "editorial_scatter",
    servicesVariant: "editorial_rows",
    mediaVariant: "mosaic_wall",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "moderate",
    mappingNotes: ["Maps to editorial scatter, portfolio-style work cards, and asymmetric media with existing variants."],
    blockerNotes: ["Still needs stronger section-level negative-space controls and case-study depth."]
  },
  {
    referenceId: "framer:athletix",
    archetype: "venue_community_energy",
    heroVariant: "media_masthead",
    servicesVariant: "plan_cards",
    mediaVariant: "immersive_media_band",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "strong",
    mappingNotes: ["Venue and fitness references can use the existing media masthead plus plan cards or program rows and a large rhythm band."],
    blockerNotes: ["Motion and membership/schedule widgets are intentionally out of scope for generic V3."]
  },
  {
    referenceId: "framer:cassis",
    archetype: "restaurant_hospitality",
    heroVariant: "editorial_scatter",
    servicesVariant: "hospitality_menu_preview",
    mediaVariant: "immersive_media_band",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "strong",
    mappingNotes: ["Hospitality references map to scatter media, menu-preview offerings, and full-width atmosphere imagery."],
    blockerNotes: ["Full menu, reservation, and event-detail components are later vertical-specific work."]
  },
  {
    referenceId: "webflow:youga",
    archetype: "wellness_soft_service",
    heroVariant: "appointment_card_overlay",
    servicesVariant: "showcase_grid",
    mediaVariant: "mosaic_wall",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "moderate",
    mappingNotes: ["Wellness appointment pages can use the overlay request card, soft service showcase, and calm media grid."],
    blockerNotes: ["Class schedule/teacher modules are out of generic V3 and should not be faked."]
  },
  {
    referenceId: "webflow:pretty",
    archetype: "wellness_soft_service",
    heroVariant: "appointment_card_overlay",
    servicesVariant: "showcase_grid",
    mediaVariant: "mosaic_wall",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "weak",
    mappingNotes: ["The current mapping is structurally possible through wellness variants."],
    blockerNotes: ["The captured live demo appears to be a mismatched SaaS/product page, so this holdout should be replaced before using it as visual evidence."]
  },
  {
    referenceId: "webflow:fleety",
    archetype: "premium_media_led",
    heroVariant: "premium_object_stage",
    servicesVariant: "showcase_grid",
    mediaVariant: "immersive_media_band",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "strong",
    mappingNotes: ["Premium media-led pages map to object staging, visual service cards, and large image slabs."],
    blockerNotes: ["Fleet/inventory filtering and ecommerce flows are not part of generic V3."]
  },
  {
    referenceId: "webflow:adox-studio",
    archetype: "studio_portfolio_editorial",
    heroVariant: "editorial_scatter",
    servicesVariant: "editorial_rows",
    mediaVariant: "mosaic_wall",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "moderate",
    mappingNotes: ["Studio/agency structure maps to editorial hero, concise service rows, and asymmetric gallery rhythm."],
    blockerNotes: ["Reusable portfolio case-study cards and index sections remain missing."]
  },
  {
    referenceId: "webflow:brivex",
    archetype: "urgent_service_conversion",
    heroVariant: "appointment_card_overlay",
    servicesVariant: "editorial_rows",
    mediaVariant: "mosaic_wall",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "weak",
    mappingNotes: ["Service-conversion structure maps to the overlay action card and problem-led rows."],
    blockerNotes: ["Only marketplace-detail evidence is available in the current corpus; replace with a live demo before scoring visual parity."]
  },
  {
    referenceId: "squarespace:restaurant-category",
    archetype: "restaurant_hospitality",
    heroVariant: "editorial_scatter",
    servicesVariant: "hospitality_menu_preview",
    mediaVariant: "immersive_media_band",
    proofVariant: "local_anchor",
    storyVariant: "inset_feature",
    contactVariant: "contact_form_split",
    footerPattern: "standard_directory_footer",
    confidence: "weak",
    mappingNotes: ["The category-level restaurant reference maps to the same hospitality primitives as Camino/Cassis."],
    blockerNotes: ["A category page is useful for vocabulary but too weak for side-by-side visual scoring; replace with a concrete Squarespace template demo."]
  }
];

export function generatedSiteV3BenchmarkHoldoutReferences() {
  return generatedSiteV3BenchmarkReferences.filter((reference) => reference.set === "holdout");
}
