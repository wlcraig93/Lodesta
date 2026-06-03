import { createHash } from "node:crypto";
import type {
  ClaimCategoryV2,
  GeneratedSiteV2Mode,
  GenerationQaBlocker,
  GenerationQaReadiness,
  SectionFamilyContractV2,
  Vertical,
  VerticalPlaybookV2
} from "./models";

export const defaultGeneratedSiteV2Mode: GeneratedSiteV2Mode = "all_canonical";

export function getGeneratedSiteV2Mode(env: NodeJS.ProcessEnv = process.env): GeneratedSiteV2Mode {
  const value = env.GENERATED_SITE_V2_MODE;
  if (
    value === "off" ||
    value === "fixture_only" ||
    value === "operator_allowlist" ||
    value === "auto_body_canonical" ||
    value === "supported_verticals_canonical" ||
    value === "all_canonical"
  ) return value;
  return defaultGeneratedSiteV2Mode;
}

export function isGeneratedSiteV2Allowed(input: {
  mode?: GeneratedSiteV2Mode;
  vertical?: Vertical;
  sourceHost?: string;
  fixture?: boolean;
  explicitOperatorRequest?: boolean;
  allowlistHosts?: string[];
}): boolean {
  const mode = input.mode ?? getGeneratedSiteV2Mode();
  if (mode === "off") return false;
  if (input.fixture) return true;
  if (mode === "fixture_only") return false;
  if (mode === "operator_allowlist") {
    if (!input.explicitOperatorRequest) return false;
    if (!input.sourceHost) return true;
    return input.allowlistHosts?.includes(input.sourceHost) ?? false;
  }
  if (mode === "supported_verticals_canonical") {
    return isSupportedGeneratedSiteV2Vertical(input.vertical);
  }
  if (mode === "all_canonical") return true;
  return input.vertical === "auto_body";
}

export const supportedGeneratedSiteV2Verticals: Vertical[] = ["auto_body", "restaurant", "home_services"];

export function isSupportedGeneratedSiteV2Vertical(vertical: Vertical | undefined): vertical is "auto_body" | "restaurant" | "home_services" {
  return Boolean(vertical && supportedGeneratedSiteV2Verticals.includes(vertical));
}

export function generatedSiteV2AllowlistHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.GENERATED_SITE_V2_ALLOWLIST_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function deriveGenerationQaReadinessV2(input: {
  blockers: GenerationQaBlocker[];
  checked: boolean;
  unavailable?: boolean;
}): GenerationQaReadiness {
  if (input.unavailable) return "unavailable";
  if (!input.checked) return "pending";
  return input.blockers.some((blocker) => blocker.severity !== "warning") ? "blocked" : "ready";
}

export function normalizeClaimTextV2(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?'"()\[\]{}]+|[.,;:!?'"()\[\]{}]+$/g, "")
    .toLowerCase();
}

export function claimIdV2(input: {
  sourceFactIds: string[];
  category: ClaimCategoryV2;
  normalizedClaimValue: string;
}) {
  const payload = JSON.stringify({
    sourceFactIds: [...input.sourceFactIds].sort(),
    category: input.category,
    normalizedClaimValue: normalizeClaimTextV2(input.normalizedClaimValue)
  });
  return `claim_${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}

export function googlePlaceLinkAction(input: { siteId: string; placeId: string; source?: string }) {
  const params = new URLSearchParams({
    siteId: input.siteId,
    placeId: input.placeId
  });
  if (input.source) params.set("source", input.source);
  return `/api/places/google-link?${params.toString()}`;
}

export const autoBodyPlaybookV2: VerticalPlaybookV2 = {
  id: "auto_body",
  version: "auto-body-playbook-v1",
  serviceTaxonomy: [
    "collision repair",
    "paint and body work",
    "dent repair",
    "frame or structural repair",
    "paint matching",
    "insurance coordination",
    "repair estimates"
  ],
  contentPriorities: [
    "make the estimate path obvious",
    "surface services only when supported by source facts",
    "explain the repair process without inventing certifications",
    "make phone and location easy to act on"
  ],
  trustSignals: [
    "before-and-after proof when rights-safe assets exist",
    "first-party testimonials when available",
    "years in business only when sourced",
    "insurance coordination only when sourced"
  ],
  forbiddenClaims: ["pricing", "warranty", "credentials", "emergency", "regulated"],
  proofRules: [
    "omit Google rating and review count from durable output",
    "use live Google proof only through compliant runtime UI",
    "prefer first-party proof and crawl-sourced evidence"
  ],
  ctaStrategy: "Prioritize call and estimate request CTAs. Directions are secondary.",
  visualDirection: [
    "precision service",
    "confident automotive craft",
    "high-contrast but not aggressive",
    "proof-rich below the hero"
  ]
};

export const autoBodySectionContractsV2: SectionFamilyContractV2[] = [
  {
    id: "hero.estimate_intake",
    verticals: ["auto_body"],
    requiredFactKinds: ["name", "service", "phone"],
    optionalFactKinds: ["address", "photo", "proof_signal"],
    copySlots: ["headline", "subheadline", "primaryCta", "secondaryCta"],
    assetSlots: ["heroMedia", "brandMark"],
    layoutVariants: ["editorial_split", "overlay_media", "split_media", "centered_statement", "media_masthead", "brand_panel", "statement_cardless"],
    responsiveBehavior: "reorder",
    qaRisks: ["unsupported hero claim", "header collision", "mobile cta overflow"]
  },
  {
    id: "services.matrix",
    verticals: ["auto_body"],
    requiredFactKinds: ["service"],
    optionalFactKinds: ["photo", "proof_signal"],
    copySlots: ["heading", "intro", "serviceItems"],
    assetSlots: ["serviceMedia"],
    layoutVariants: ["capability_showcase", "editorial_service_list", "featured_service_board", "feature_matrix", "media_list", "service_matrix", "compact_service_index"],
    responsiveBehavior: "stack",
    qaRisks: ["invented service", "repeated shallow cards"]
  },
  {
    id: "media.service_gallery",
    verticals: ["auto_body"],
    requiredFactKinds: ["service"],
    optionalFactKinds: ["photo"],
    copySlots: ["heading", "intro", "captions"],
    assetSlots: ["serviceMedia", "proofMedia"],
    layoutVariants: ["editorial_media_triptych"],
    responsiveBehavior: "stack",
    qaRisks: ["fake shop-specific photo implication", "broken image", "repeated stock-like media"]
  },
  {
    id: "proof.trust_band",
    verticals: ["auto_body"],
    requiredFactKinds: [],
    optionalFactKinds: ["proof_signal", "photo", "press_link"],
    copySlots: ["heading", "proofItems"],
    assetSlots: ["proofMedia"],
    layoutVariants: ["shop_profile", "source_stack", "metric_band", "proof_strip", "location_anchor"],
    responsiveBehavior: "compress",
    qaRisks: ["Google proof leakage", "unsupported rating claim"]
  },
  {
    id: "process.repair_steps",
    verticals: ["auto_body"],
    requiredFactKinds: ["service"],
    optionalFactKinds: ["hours", "photo"],
    copySlots: ["heading", "steps"],
    assetSlots: ["processMedia"],
    layoutVariants: ["damage_intake_board", "horizontal_timeline", "numbered_steps", "split_steps", "checklist_panel"],
    responsiveBehavior: "stack",
    qaRisks: ["process claims that imply unsupported turnaround times"]
  },
  {
    id: "guidance.insurance_estimate",
    verticals: ["auto_body"],
    requiredFactKinds: [],
    optionalFactKinds: ["service", "phone"],
    copySlots: ["heading", "body", "cta"],
    assetSlots: [],
    layoutVariants: ["callout", "split_guidance"],
    responsiveBehavior: "stack",
    qaRisks: ["unsupported insurance coordination claim"]
  },
  {
    id: "faq.repair_questions",
    verticals: ["auto_body"],
    requiredFactKinds: ["service"],
    optionalFactKinds: ["phone"],
    copySlots: ["heading", "intro", "questions"],
    assetSlots: [],
    layoutVariants: ["source_grounded_list"],
    responsiveBehavior: "stack",
    qaRisks: ["unsupported service claim", "thin generic FAQ copy"]
  },
  {
    id: "contact.location_hours",
    verticals: ["auto_body"],
    requiredFactKinds: ["phone", "address"],
    optionalFactKinds: ["hours", "geo"],
    copySlots: ["heading", "hoursFallback", "directionsCta"],
    assetSlots: ["mapPreview"],
    layoutVariants: ["contact_panel", "map_split"],
    responsiveBehavior: "stack",
    qaRisks: ["false known-hours implication", "missing phone or address"]
  },
  {
    id: "cta.final_band",
    verticals: ["auto_body"],
    requiredFactKinds: ["phone"],
    optionalFactKinds: ["service", "address"],
    copySlots: ["heading", "body", "primaryCta"],
    assetSlots: [],
    layoutVariants: ["solid_band", "media_overlay"],
    responsiveBehavior: "stack",
    qaRisks: ["generic filler CTA"]
  },
  {
    id: "footer.standard",
    verticals: ["auto_body"],
    requiredFactKinds: ["name", "phone", "address"],
    optionalFactKinds: ["hours", "social_link"],
    copySlots: ["businessSummary"],
    assetSlots: ["brandMark"],
    layoutVariants: ["standard"],
    responsiveBehavior: "stack",
    qaRisks: ["stale hours", "unsupported social proof"]
  }
];

export const restaurantPlaybookV2: VerticalPlaybookV2 = {
  id: "restaurant",
  version: "restaurant-playbook-v1",
  serviceTaxonomy: [
    "dine-in service",
    "takeout",
    "online ordering",
    "catering",
    "private events",
    "delivery"
  ],
  contentPriorities: [
    "make the ordering path and phone path obvious",
    "surface menu or service highlights only when supported by source facts",
    "make hours and location easy to scan",
    "avoid invented cuisine, awards, delivery promises, or review claims"
  ],
  trustSignals: [
    "dish and dining-room visuals when rights-safe assets exist",
    "first-party testimonials when available",
    "catering or event support only when sourced",
    "Google proof only through compliant live surfaces"
  ],
  forbiddenClaims: ["pricing", "reviews", "credentials", "regulated"],
  proofRules: [
    "do not cache or statically render Google rating or review count",
    "prefer first-party menu, ordering, and contact facts",
    "omit claims about freshness, awards, or cuisine specificity unless sourced"
  ],
  ctaStrategy: "Prioritize ordering, calling, and catering inquiry actions based on available facts.",
  visualDirection: [
    "warm local hospitality",
    "food-forward but utility clear",
    "menu-first scanning",
    "easy mobile ordering path"
  ]
};

export const restaurantSectionContractsV2: SectionFamilyContractV2[] = [
  {
    id: "hero.order_path",
    verticals: ["restaurant"],
    requiredFactKinds: ["name", "category"],
    optionalFactKinds: ["service", "phone", "ordering_link", "hours", "photo"],
    copySlots: ["headline", "subheadline", "primaryCta", "secondaryCta"],
    assetSlots: ["heroMedia", "brandMark"],
    layoutVariants: ["editorial_split", "overlay_media", "split_media", "centered_statement", "media_masthead", "brand_panel", "statement_cardless"],
    responsiveBehavior: "reorder",
    qaRisks: ["unsupported cuisine claim", "missing mobile order path", "header collision"]
  },
  {
    id: "menu.highlights",
    verticals: ["restaurant"],
    requiredFactKinds: ["service"],
    optionalFactKinds: ["photo", "ordering_link"],
    copySlots: ["heading", "intro", "highlightItems"],
    assetSlots: ["menuMedia"],
    layoutVariants: ["editorial_grid", "menu_cards"],
    responsiveBehavior: "stack",
    qaRisks: ["invented menu item", "pricing claim without source", "repeated shallow cards"]
  },
  {
    id: "media.service_gallery",
    verticals: ["restaurant"],
    requiredFactKinds: [],
    optionalFactKinds: ["service", "photo", "ordering_link"],
    copySlots: ["heading", "intro", "captions"],
    assetSlots: ["serviceMedia", "menuMedia"],
    layoutVariants: ["editorial_media_triptych", "full_bleed_story", "media_grid"],
    responsiveBehavior: "stack",
    qaRisks: ["fake business-specific photo implication", "broken image", "dense mobile overlay text"]
  },
  {
    id: "proof.trust_band",
    verticals: ["restaurant"],
    requiredFactKinds: [],
    optionalFactKinds: ["proof_signal", "photo", "press_link"],
    copySlots: ["heading", "proofItems"],
    assetSlots: ["proofMedia"],
    layoutVariants: ["proof_strip", "metric_band"],
    responsiveBehavior: "compress",
    qaRisks: ["Google proof leakage", "unsupported review claim"]
  },
  {
    id: "process.order_steps",
    verticals: ["restaurant"],
    requiredFactKinds: [],
    optionalFactKinds: ["ordering_link", "booking_link", "phone", "service"],
    copySlots: ["heading", "steps"],
    assetSlots: [],
    layoutVariants: ["horizontal_timeline", "numbered_steps", "split_steps", "checklist_panel"],
    responsiveBehavior: "stack",
    qaRisks: ["unsupported ordering method", "invented reservation path"]
  },
  {
    id: "contact.location_hours",
    verticals: ["restaurant"],
    requiredFactKinds: ["phone", "address"],
    optionalFactKinds: ["hours", "geo", "ordering_link"],
    copySlots: ["heading", "hoursFallback", "directionsCta"],
    assetSlots: ["mapPreview"],
    layoutVariants: ["contact_panel", "map_split"],
    responsiveBehavior: "stack",
    qaRisks: ["false known-hours implication", "missing phone or address"]
  },
  {
    id: "cta.final_band",
    verticals: ["restaurant"],
    requiredFactKinds: [],
    optionalFactKinds: ["phone", "ordering_link", "service"],
    copySlots: ["heading", "body", "primaryCta"],
    assetSlots: [],
    layoutVariants: ["solid_band", "media_overlay"],
    responsiveBehavior: "stack",
    qaRisks: ["generic filler CTA", "unsupported order claim"]
  }
];

export const homeServicesPlaybookV2: VerticalPlaybookV2 = {
  id: "home_services",
  version: "home-services-playbook-v1",
  serviceTaxonomy: [
    "repairs",
    "maintenance",
    "installation",
    "inspection",
    "emergency service",
    "service-area coverage"
  ],
  contentPriorities: [
    "make the request-service path obvious",
    "surface service areas when available",
    "separate emergency claims from ordinary service unless sourced",
    "make phone contact prominent without inventing response times"
  ],
  trustSignals: [
    "service photos when rights-safe assets exist",
    "licenses, insurance, warranties, and emergency availability only when sourced",
    "service-area proof from first-party or crawl data",
    "Google proof only through compliant live surfaces"
  ],
  forbiddenClaims: ["pricing", "warranty", "credentials", "emergency", "regulated"],
  proofRules: [
    "do not claim emergency service unless a durable fact supports it",
    "do not statically render Google rating or review count",
    "prefer concrete service and coverage facts over generic trust copy"
  ],
  ctaStrategy: "Prioritize call and service-request actions. Directions are secondary unless there is a public location.",
  visualDirection: [
    "clear service utility",
    "calm professional confidence",
    "coverage and service scanning",
    "high-friction mobile contact reduction"
  ]
};

export const homeServicesSectionContractsV2: SectionFamilyContractV2[] = [
  {
    id: "hero.service_request",
    verticals: ["home_services"],
    requiredFactKinds: ["name", "service", "phone"],
    optionalFactKinds: ["service_area", "hours", "photo"],
    copySlots: ["headline", "subheadline", "primaryCta", "secondaryCta"],
    assetSlots: ["heroMedia", "brandMark"],
    layoutVariants: ["editorial_split", "overlay_media", "split_media", "centered_statement", "media_masthead", "brand_panel", "statement_cardless"],
    responsiveBehavior: "reorder",
    qaRisks: ["unsupported emergency claim", "header collision", "mobile cta overflow"]
  },
  {
    id: "services.matrix",
    verticals: ["home_services"],
    requiredFactKinds: ["service"],
    optionalFactKinds: ["service_area", "photo", "proof_signal"],
    copySlots: ["heading", "intro", "serviceItems"],
    assetSlots: ["serviceMedia"],
    layoutVariants: ["capability_showcase", "editorial_service_list", "featured_service_board", "feature_matrix", "media_list", "service_matrix", "compact_service_index"],
    responsiveBehavior: "stack",
    qaRisks: ["invented service", "repeated shallow cards"]
  },
  {
    id: "coverage.service_area",
    verticals: ["home_services"],
    requiredFactKinds: [],
    optionalFactKinds: ["service_area", "address", "geo"],
    copySlots: ["heading", "body", "areas"],
    assetSlots: ["mapPreview"],
    layoutVariants: ["coverage_band", "area_grid"],
    responsiveBehavior: "stack",
    qaRisks: ["invented service area", "unsupported travel promise"]
  },
  {
    id: "media.service_gallery",
    verticals: ["home_services"],
    requiredFactKinds: [],
    optionalFactKinds: ["service", "service_area", "photo"],
    copySlots: ["heading", "intro", "captions"],
    assetSlots: ["serviceMedia", "proofMedia"],
    layoutVariants: ["editorial_media_triptych", "full_bleed_story", "media_grid"],
    responsiveBehavior: "stack",
    qaRisks: ["fake business-specific photo implication", "broken image", "dense mobile overlay text"]
  },
  {
    id: "process.service_steps",
    verticals: ["home_services"],
    requiredFactKinds: ["service"],
    optionalFactKinds: ["phone", "hours"],
    copySlots: ["heading", "steps"],
    assetSlots: [],
    layoutVariants: ["horizontal_timeline", "numbered_steps", "split_steps", "checklist_panel"],
    responsiveBehavior: "stack",
    qaRisks: ["unsupported response-time claim", "unsupported emergency claim"]
  },
  {
    id: "contact.location_hours",
    verticals: ["home_services"],
    requiredFactKinds: ["phone"],
    optionalFactKinds: ["address", "hours", "service_area"],
    copySlots: ["heading", "hoursFallback", "directionsCta"],
    assetSlots: ["mapPreview"],
    layoutVariants: ["contact_panel", "map_split"],
    responsiveBehavior: "stack",
    qaRisks: ["false known-hours implication", "missing phone"]
  },
  {
    id: "cta.final_band",
    verticals: ["home_services"],
    requiredFactKinds: ["phone"],
    optionalFactKinds: ["service", "service_area"],
    copySlots: ["heading", "body", "primaryCta"],
    assetSlots: [],
    layoutVariants: ["solid_band", "media_overlay"],
    responsiveBehavior: "stack",
    qaRisks: ["generic filler CTA", "unsupported urgency claim"]
  }
];

export const generalLocalPlaybookV2: VerticalPlaybookV2 = {
  id: "general_local",
  version: "general-local-playbook-v1",
  serviceTaxonomy: [
    "primary service",
    "consultation",
    "appointment",
    "quote request",
    "local contact",
    "service-area or location details"
  ],
  contentPriorities: [
    "make the next contact step obvious",
    "render only source-backed services and location facts",
    "prefer a smaller honest site over filler",
    "explain contact, service fit, and local context without inventing claims"
  ],
  trustSignals: [
    "first-party proof when sourced",
    "location and contact facts",
    "public profile proof only through compliant live or linked surfaces",
    "rights-safe media only"
  ],
  forbiddenClaims: ["pricing", "warranty", "credentials", "emergency", "regulated"],
  proofRules: [
    "do not invent industry-specific credentials",
    "do not statically render Google rating or review count",
    "omit sections that lack source-backed facts"
  ],
  ctaStrategy: "Prioritize the clearest available contact action. If phone is missing, use a form/contact request path.",
  visualDirection: [
    "clean local-business utility",
    "strong hierarchy",
    "specific fact-led sections",
    "responsive contact-first layout"
  ]
};

const horizontalSectionVerticals: Vertical[] = [
  "restaurant",
  "auto_body",
  "beauty_salon",
  "med_spa",
  "law_firm",
  "dental",
  "home_services",
  "fitness",
  "real_estate",
  "landscaping",
  "veterinary",
  "creative_studio",
  "general_local"
];

export const generalLocalSectionContractsV2: SectionFamilyContractV2[] = [
  {
    id: "hero.local_action",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: ["name"],
    optionalFactKinds: ["service", "phone", "address", "service_area", "photo"],
    copySlots: ["headline", "subheadline", "primaryCta", "secondaryCta"],
    assetSlots: ["heroMedia", "brandMark"],
    layoutVariants: ["editorial_split", "overlay_media", "split_media", "centered_statement", "media_masthead", "brand_panel", "statement_cardless"],
    responsiveBehavior: "reorder",
    qaRisks: ["generic filler headline", "header collision", "unsupported service claim"]
  },
  {
    id: "services.matrix",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: [],
    optionalFactKinds: ["service", "photo", "proof_signal"],
    copySlots: ["heading", "intro", "serviceItems"],
    assetSlots: ["serviceMedia"],
    layoutVariants: ["capability_showcase", "editorial_service_list", "featured_service_board", "feature_matrix", "media_list", "service_matrix", "compact_service_index"],
    responsiveBehavior: "stack",
    qaRisks: ["invented service", "repeated shallow cards"]
  },
  {
    id: "media.service_gallery",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: [],
    optionalFactKinds: ["service", "photo", "proof_signal"],
    copySlots: ["heading", "intro", "captions"],
    assetSlots: ["serviceMedia", "proofMedia"],
    layoutVariants: ["editorial_media_triptych", "full_bleed_story", "media_grid"],
    responsiveBehavior: "stack",
    qaRisks: ["fake business-specific photo implication", "broken image", "dense mobile overlay text"]
  },
  {
    id: "coverage.service_area",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: [],
    optionalFactKinds: ["service_area", "address", "geo"],
    copySlots: ["heading", "body", "areas"],
    assetSlots: ["mapPreview"],
    layoutVariants: ["coverage_band", "area_grid", "location_anchor"],
    responsiveBehavior: "stack",
    qaRisks: ["invented service area", "unsupported travel promise"]
  },
  {
    id: "contact.location_hours",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: [],
    optionalFactKinds: ["phone", "address", "hours", "service_area"],
    copySlots: ["heading", "hoursFallback", "directionsCta"],
    assetSlots: ["mapPreview"],
    layoutVariants: ["contact_panel", "map_split"],
    responsiveBehavior: "stack",
    qaRisks: ["false known-hours implication", "missing contact path"]
  },
  {
    id: "process.service_steps",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: [],
    optionalFactKinds: ["service", "phone", "hours"],
    copySlots: ["heading", "steps"],
    assetSlots: [],
    layoutVariants: ["horizontal_timeline", "numbered_steps", "split_steps", "checklist_panel"],
    responsiveBehavior: "stack",
    qaRisks: ["template process copy", "unsupported response-time claim"]
  },
  {
    id: "faq.repair_questions",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: ["name"],
    optionalFactKinds: ["service", "phone", "hours"],
    copySlots: ["heading", "intro", "questions"],
    assetSlots: [],
    layoutVariants: ["source_grounded_list"],
    responsiveBehavior: "stack",
    qaRisks: ["unsupported claim", "thin generic FAQ copy"]
  },
  {
    id: "faq.local_questions",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: ["name"],
    optionalFactKinds: ["service", "phone", "hours", "address", "service_area"],
    copySlots: ["heading", "intro", "questions"],
    assetSlots: [],
    layoutVariants: ["source_grounded_list"],
    responsiveBehavior: "stack",
    qaRisks: ["unsupported claim", "thin generic FAQ copy", "template-facing language"]
  },
  {
    id: "cta.final_band",
    verticals: horizontalSectionVerticals,
    requiredFactKinds: ["name"],
    optionalFactKinds: ["phone", "service", "address"],
    copySlots: ["heading", "body", "primaryCta"],
    assetSlots: [],
    layoutVariants: ["solid_band", "media_overlay"],
    responsiveBehavior: "stack",
    qaRisks: ["generic filler CTA", "unsupported local claim"]
  }
];

export const generatedSiteV2SectionContracts = [
  ...autoBodySectionContractsV2,
  ...restaurantSectionContractsV2,
  ...homeServicesSectionContractsV2,
  ...generalLocalSectionContractsV2
] as const;
