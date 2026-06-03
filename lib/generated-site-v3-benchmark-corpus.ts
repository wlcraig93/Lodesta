export type GeneratedSiteV3BenchmarkProvider = "framer" | "webflow" | "squarespace";

export type GeneratedSiteV3BenchmarkCategory =
  | "local_service"
  | "restaurant"
  | "salon_wellness"
  | "professional_service"
  | "studio_agency"
  | "home_services"
  | "venue_fitness"
  | "premium_media_led";

export type GeneratedSiteV3BenchmarkSet = "representative" | "holdout" | "corpus";

export type GeneratedSiteV3BenchmarkScreenshotType = "live_demo" | "marketplace_detail" | "template_store_category";

export type GeneratedSiteV3BenchmarkArchetype =
  | "urgent_service_conversion"
  | "warm_neighborhood_service"
  | "premium_media_led"
  | "restaurant_hospitality"
  | "quiet_editorial_professional"
  | "studio_portfolio_editorial"
  | "wellness_soft_service"
  | "venue_community_energy"
  | "minimal_professional_grid";

export type GeneratedSiteV3BenchmarkAnalysis = {
  heroType: string;
  headerBehavior: string;
  mediaRhythm: string[];
  sectionTypes: string[];
  servicePresentation: string;
  proofContactFooter: string;
  mobileBehavior: string;
  requiredV3Controls: string[];
  outOfScopeFeatures: string[];
};

export type GeneratedSiteV3BenchmarkReference = {
  id: string;
  provider: GeneratedSiteV3BenchmarkProvider;
  title: string;
  sourceUrl: string;
  screenshotUrl: string;
  screenshotType: GeneratedSiteV3BenchmarkScreenshotType;
  category: GeneratedSiteV3BenchmarkCategory;
  secondaryCategories: GeneratedSiteV3BenchmarkCategory[];
  archetype: GeneratedSiteV3BenchmarkArchetype;
  set: GeneratedSiteV3BenchmarkSet;
  qualityLens: string;
  analysis: GeneratedSiteV3BenchmarkAnalysis;
};

export const generatedSiteV3BenchmarkCollectedAt = "2026-06-03";

export const generatedSiteV3BenchmarkArchetypes: Array<{
  id: GeneratedSiteV3BenchmarkArchetype;
  label: string;
  reusableQuestion: string;
}> = [
  {
    id: "urgent_service_conversion",
    label: "Urgent Service Conversion",
    reusableQuestion: "Can V3 create a service page where the first viewport makes the action obvious without looking like a form template?"
  },
  {
    id: "warm_neighborhood_service",
    label: "Warm Neighborhood Service",
    reusableQuestion: "Can V3 make practical local services feel human, approachable, and image-friendly?"
  },
  {
    id: "premium_media_led",
    label: "Premium Media Led",
    reusableQuestion: "Can V3 use cinematic media, dark/light contrast, and controlled density without becoming generic luxury UI?"
  },
  {
    id: "restaurant_hospitality",
    label: "Restaurant Hospitality",
    reusableQuestion: "Can V3 sell atmosphere and appetite with media rhythm before vertical menu widgets exist?"
  },
  {
    id: "quiet_editorial_professional",
    label: "Quiet Editorial Professional",
    reusableQuestion: "Can V3 create restrained professional pages with enough composition to avoid bland corporate grids?"
  },
  {
    id: "studio_portfolio_editorial",
    label: "Studio Portfolio Editorial",
    reusableQuestion: "Can V3 support asymmetric image/text rhythm and portfolio-like pacing with reusable controls?"
  },
  {
    id: "wellness_soft_service",
    label: "Wellness Soft Service",
    reusableQuestion: "Can V3 handle softer palettes, calm typography, and appointment-friendly structure without sameness?"
  },
  {
    id: "venue_community_energy",
    label: "Venue Community Energy",
    reusableQuestion: "Can V3 express movement, membership, class/event energy, and strong mobile CTAs?"
  },
  {
    id: "minimal_professional_grid",
    label: "Minimal Professional Grid",
    reusableQuestion: "Can V3 make a text-forward site feel premium through grid, spacing, and typography alone?"
  }
];

export const generatedSiteV3BenchmarkReferences: GeneratedSiteV3BenchmarkReference[] = [
  framer({
    id: "framer:swiftrooter",
    title: "SwiftRooter",
    url: "https://swiftrooter.framer.website/",
    category: "local_service",
    secondaryCategories: ["home_services"],
    archetype: "urgent_service_conversion",
    set: "representative",
    qualityLens: "Direct service-business conversion with a polished first viewport and practical next-step rhythm.",
    analysis: serviceConversionAnalysis("overlay media hero", "transparent-to-solid service header", "phone, service area, CTA, and footer contact grid")
  }),
  framer({
    id: "framer:gardener",
    title: "Gardener",
    url: "https://gardener.framer.media",
    category: "home_services",
    secondaryCategories: ["local_service"],
    archetype: "warm_neighborhood_service",
    set: "representative",
    qualityLens: "Warm local-service pacing with approachable imagery and less utility-first density.",
    analysis: warmServiceAnalysis("friendly image-led hero", "solid editorial header", "service cards, natural images, simple contact close")
  }),
  framer({
    id: "framer:camino",
    title: "Camino",
    url: "https://camino-template.framer.website",
    category: "restaurant",
    secondaryCategories: ["premium_media_led"],
    archetype: "restaurant_hospitality",
    set: "representative",
    qualityLens: "Hospitality page that sells atmosphere through photography and pacing before details.",
    analysis: hospitalityAnalysis("large atmospheric hero", "minimal restaurant header", "menu/reservation widgets")
  }),
  framer({
    id: "framer:luxxcar",
    title: "LuxxCar",
    url: "https://luxxcar.framer.website/",
    category: "premium_media_led",
    secondaryCategories: ["local_service"],
    archetype: "premium_media_led",
    set: "representative",
    qualityLens: "Premium vehicle-service composition with bold media, contrast, and higher art-direction pressure.",
    analysis: premiumMediaAnalysis("cinematic vehicle hero", "dark overlay header", "inventory/ecommerce-like booking")
  }),
  framer({
    id: "framer:fabrica",
    title: "Fabrica",
    url: "https://fabrica.framer.media/?utm_source=framer",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "studio_portfolio_editorial",
    set: "representative",
    qualityLens: "Refined studio page with editorial whitespace, controlled density, and careful image rhythm.",
    analysis: studioAnalysis("quiet editorial split", "minimal wordmark header", "portfolio/case-study detail pages")
  }),
  framer({
    id: "framer:perform",
    title: "Perform",
    url: "https://perform.framer.website/",
    category: "venue_fitness",
    secondaryCategories: ["local_service"],
    archetype: "venue_community_energy",
    set: "representative",
    qualityLens: "Personal-service fitness page with a strong action path and energetic first viewport.",
    analysis: venueAnalysis("coach-led action hero", "compact sticky header", "program schedules and bookings")
  }),
  webflow({
    id: "webflow:healen",
    title: "Healen",
    sourceUrl: "https://webflow.com/templates/html/healen-website-template",
    screenshotUrl: "https://healen.webflow.io/",
    category: "salon_wellness",
    secondaryCategories: ["professional_service"],
    archetype: "wellness_soft_service",
    set: "representative",
    qualityLens: "Health/service softness with careful hierarchy and lower-contrast surfaces.",
    analysis: wellnessAnalysis("soft split hero", "calm solid header", "appointment and practitioner widgets")
  }),
  webflow({
    id: "webflow:rally-padel",
    title: "Rally Padel",
    sourceUrl: "https://webflow.com/templates/html/rally-padel-website-template",
    screenshotUrl: "https://rally-padel-template.webflow.io/",
    category: "venue_fitness",
    secondaryCategories: ["premium_media_led"],
    archetype: "venue_community_energy",
    set: "representative",
    qualityLens: "Sport/venue energy with large media blocks, movement cues, and strong section pacing.",
    analysis: venueAnalysis("sport media masthead", "transparent-to-solid venue header", "event/class schedules")
  }),
  framer({
    id: "framer:noksh",
    title: "Noksh",
    url: "https://noksh.framer.website/?via=diversekit",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "quiet_editorial_professional",
    set: "holdout",
    qualityLens: "Architecture/studio restraint with large images and slow editorial rhythm.",
    analysis: quietProfessionalAnalysis("architectural image spread", "minimal wordmark header", "project pages")
  }),
  framer({
    id: "framer:elevate",
    title: "Elevate",
    url: "https://elevate-template.framer.website/",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "studio_portfolio_editorial",
    set: "holdout",
    qualityLens: "Agency homepage polish with clearer density and reusable media/content blocks.",
    analysis: studioAnalysis("asymmetric agency hero", "solid editorial header", "case studies and pricing")
  }),
  framer({
    id: "framer:athletix",
    title: "Athletix",
    url: "https://athletix.framer.website/",
    category: "venue_fitness",
    secondaryCategories: ["premium_media_led"],
    archetype: "venue_community_energy",
    set: "holdout",
    qualityLens: "Fitness/athletic art direction with bolder type and media-led motion expectations.",
    analysis: venueAnalysis("bold fitness masthead", "overlay header", "program membership widgets")
  }),
  framer({
    id: "framer:cassis",
    title: "Cassis",
    url: "https://cassis.framer.website",
    category: "restaurant",
    secondaryCategories: ["premium_media_led"],
    archetype: "restaurant_hospitality",
    set: "holdout",
    qualityLens: "Restaurant/hospitality reference for restrained food-and-space image rhythm.",
    analysis: hospitalityAnalysis("restaurant image centerpiece", "minimal restaurant header", "menu and reservations")
  }),
  webflow({
    id: "webflow:youga",
    title: "Youga",
    sourceUrl: "https://webflow.com/templates/html/youga-website-template",
    screenshotUrl: "https://yoouga.webflow.io/",
    category: "salon_wellness",
    secondaryCategories: ["venue_fitness"],
    archetype: "wellness_soft_service",
    set: "holdout",
    qualityLens: "Wellness pacing and mobile-friendly compression with calm service hierarchy.",
    analysis: wellnessAnalysis("centered wellness hero", "soft sticky header", "class schedules")
  }),
  webflow({
    id: "webflow:pretty",
    title: "Pretty",
    sourceUrl: "https://webflow.com/templates/html/pretty-website-template",
    screenshotUrl: "https://ovo-pretty.webflow.io/",
    category: "salon_wellness",
    secondaryCategories: ["local_service"],
    archetype: "wellness_soft_service",
    set: "holdout",
    qualityLens: "Beauty/local-service polish with softer surfaces and editorial service presentation.",
    analysis: wellnessAnalysis("beauty image hero", "boutique header", "service menu/pricing")
  }),
  webflow({
    id: "webflow:fleety",
    title: "Fleety",
    sourceUrl: "https://webflow.com/templates/html/fleety-website-template",
    screenshotUrl: "https://fleety-template.webflow.io/",
    category: "premium_media_led",
    secondaryCategories: ["professional_service"],
    archetype: "premium_media_led",
    set: "holdout",
    qualityLens: "Vehicle/transport media-led page useful for testing premium motion and dark surfaces.",
    analysis: premiumMediaAnalysis("transport media masthead", "compact dark header", "inventory/search widgets")
  }),
  webflow({
    id: "webflow:adox-studio",
    title: "Adox Studio",
    sourceUrl: "https://webflow.com/templates/html/adox-studio-website-template",
    screenshotUrl: "https://adoxstudio.webflow.io/",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "studio_portfolio_editorial",
    set: "holdout",
    qualityLens: "Studio/agency layout density with asymmetric sections and portfolio-style media pacing.",
    analysis: studioAnalysis("asymmetric studio hero", "minimal sticky header", "portfolio CMS pages")
  }),
  webflow({
    id: "webflow:brivex",
    title: "Brivex",
    sourceUrl: "https://webflow.com/templates/html/brivex-website-template",
    screenshotUrl: "https://webflow.com/templates/html/brivex-website-template",
    screenshotType: "marketplace_detail",
    category: "home_services",
    secondaryCategories: ["local_service"],
    archetype: "urgent_service_conversion",
    set: "holdout",
    qualityLens: "Home/service reference retained as a holdout even when only the marketplace detail page is available.",
    analysis: serviceConversionAnalysis("service split hero", "solid service header", "vertical-specific calculators")
  }),
  webflow({
    id: "webflow:monocad",
    title: "Monocad",
    sourceUrl: "https://webflow.com/templates/html/monocad-website-template",
    screenshotUrl: "https://monocad-portfolio-template.webflow.io/",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "quiet_editorial_professional",
    set: "corpus",
    qualityLens: "Architecture/editorial grid patterns and full-bleed media rhythm.",
    analysis: quietProfessionalAnalysis("large editorial image grid", "minimal professional header", "project pages")
  }),
  squarespace({
    id: "squarespace:restaurant-category",
    title: "Squarespace Restaurant Templates",
    url: "https://www.squarespace.com/templates?category=restaurants",
    category: "restaurant",
    secondaryCategories: ["premium_media_led"],
    archetype: "restaurant_hospitality",
    set: "holdout",
    qualityLens: "Template-store category reference for hospitality pacing, media hierarchy, and restrained local essentials.",
    analysis: hospitalityAnalysis("template-store restaurant grid", "marketplace category header", "template browsing")
  }),
  framer({
    id: "framer:vectura",
    title: "Vectura",
    url: "https://vectura.framer.website/?utm_source=framer",
    category: "premium_media_led",
    secondaryCategories: ["professional_service"],
    archetype: "premium_media_led",
    set: "corpus",
    qualityLens: "Premium hero/media reference for dark surfaces, strong CTA contrast, and cinematic object crops.",
    analysis: premiumMediaAnalysis("object-led cinematic hero", "dark overlay header", "product configurators")
  }),
  framer({
    id: "framer:revo",
    title: "Revo",
    url: "https://revo-template.framer.website/",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "minimal_professional_grid",
    set: "corpus",
    qualityLens: "Crisp professional grid reference for type scale, cards, and no-media polish.",
    analysis: minimalGridAnalysis("text-first professional hero", "compact solid header", "SaaS/product widgets")
  }),
  framer({
    id: "framer:metzger",
    title: "Metzger",
    url: "https://metzger.framer.website/",
    category: "professional_service",
    secondaryCategories: ["local_service"],
    archetype: "quiet_editorial_professional",
    set: "corpus",
    qualityLens: "Professional-service restraint with typographic hierarchy and polished neutral sections.",
    analysis: quietProfessionalAnalysis("professional split hero", "solid professional header", "team/case pages")
  }),
  framer({
    id: "framer:remote-by-modula",
    title: "Remote by Modula",
    url: "https://remotebymodula.framer.website/",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "minimal_professional_grid",
    set: "corpus",
    qualityLens: "Minimal professional rhythm useful for sparse-data pages that still need polish.",
    analysis: minimalGridAnalysis("sparse grid hero", "minimal header", "job/product content")
  }),
  framer({
    id: "framer:mariven",
    title: "Mariven",
    url: "https://mariven.framer.website/",
    category: "salon_wellness",
    secondaryCategories: ["premium_media_led"],
    archetype: "wellness_soft_service",
    set: "corpus",
    qualityLens: "Soft lifestyle art direction and quiet service pacing useful for beauty/wellness sites.",
    analysis: wellnessAnalysis("lifestyle media hero", "boutique header", "product/ecommerce")
  }),
  framer({
    id: "framer:draftr",
    title: "Draftr",
    url: "https://draftr-wbs.framer.website",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "studio_portfolio_editorial",
    set: "corpus",
    qualityLens: "Studio/editorial reference for asymmetry, text density, and non-card section rhythm.",
    analysis: studioAnalysis("editorial agency hero", "minimal header", "case-study pages")
  }),
  framer({
    id: "framer:dreelio",
    title: "Dreelio",
    url: "https://dreelio.framer.website/",
    category: "studio_agency",
    secondaryCategories: ["premium_media_led"],
    archetype: "studio_portfolio_editorial",
    set: "corpus",
    qualityLens: "Media/creative reference for dynamic layouts and stronger image sequencing.",
    analysis: studioAnalysis("media collage hero", "solid editorial header", "video-heavy portfolio")
  }),
  framer({
    id: "framer:fieldwork",
    title: "Fieldwork",
    url: "https://fieldwork.framer.website/",
    category: "home_services",
    secondaryCategories: ["local_service"],
    archetype: "warm_neighborhood_service",
    set: "corpus",
    qualityLens: "Field/local-service warmth with organic imagery and approachable section pacing.",
    analysis: warmServiceAnalysis("field-service media hero", "solid service header", "project/gallery pages")
  }),
  framer({
    id: "framer:pearl",
    title: "Pearl",
    url: "https://pearl.framer.website",
    category: "salon_wellness",
    secondaryCategories: ["premium_media_led"],
    archetype: "wellness_soft_service",
    set: "corpus",
    qualityLens: "Boutique/wellness visual language with soft typography and premium imagery.",
    analysis: wellnessAnalysis("boutique centerpiece hero", "minimal boutique header", "commerce/product pages")
  }),
  framer({
    id: "framer:finns",
    title: "Finns",
    url: "https://finns.framer.website/",
    category: "restaurant",
    secondaryCategories: ["premium_media_led"],
    archetype: "restaurant_hospitality",
    set: "corpus",
    qualityLens: "Restaurant-like hospitality rhythm with social/visual energy and strong media pacing.",
    analysis: hospitalityAnalysis("hospitality image hero", "venue header", "menu/event widgets")
  }),
  framer({
    id: "framer:arpeggio",
    title: "Arpeggio",
    url: "https://arpeggio.framer.website",
    category: "restaurant",
    secondaryCategories: ["venue_fitness"],
    archetype: "restaurant_hospitality",
    set: "corpus",
    qualityLens: "Atmospheric hospitality reference with editorial pacing and event-like detail sections.",
    analysis: hospitalityAnalysis("atmospheric centered hero", "minimal hospitality header", "event/audio widgets")
  }),
  webflow({
    id: "webflow:portfolio-starter",
    title: "Portfolio Starter",
    sourceUrl: "https://webflow.com/templates/html/portfolio-starter-website-template",
    screenshotUrl: "https://portfolio-starter-template.webflow.io/",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "minimal_professional_grid",
    set: "corpus",
    qualityLens: "Minimal grid discipline, crisp section boundaries, and constrained controls.",
    analysis: minimalGridAnalysis("minimal portfolio hero", "plain wordmark header", "portfolio CMS")
  }),
  webflow({
    id: "webflow:people-work",
    title: "People Work",
    sourceUrl: "https://webflow.com/templates/html/people-work-website-template",
    screenshotUrl: "https://people-work-webflow-108-template.webflow.io/",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "quiet_editorial_professional",
    set: "corpus",
    qualityLens: "Professional/service reference with confident type and practical conversion hierarchy.",
    analysis: quietProfessionalAnalysis("professional service hero", "solid professional header", "consulting pages")
  }),
  webflow({
    id: "webflow:calmlyss",
    title: "Calmlyss",
    sourceUrl: "https://webflow.com/templates/html/calmlyss-website-template",
    screenshotUrl: "https://calmlyss.webflow.io/",
    category: "salon_wellness",
    secondaryCategories: ["professional_service"],
    archetype: "wellness_soft_service",
    set: "corpus",
    qualityLens: "Calm service reference for whitespace, softer cards, and therapy/wellness pacing.",
    analysis: wellnessAnalysis("calm split hero", "soft sticky header", "appointment/practitioner pages")
  }),
  webflow({
    id: "webflow:offsites",
    title: "Offsites",
    sourceUrl: "https://webflow.com/templates/html/offsites-website-template",
    screenshotUrl: "https://kitpro-offsites.webflow.io/",
    category: "venue_fitness",
    secondaryCategories: ["professional_service"],
    archetype: "venue_community_energy",
    set: "corpus",
    qualityLens: "Venue/event reference for group activity, schedule-like content, and high-utility conversion.",
    analysis: venueAnalysis("event venue hero", "compact event header", "event/booking pages")
  }),
  webflow({
    id: "webflow:bestra",
    title: "Bestra",
    sourceUrl: "https://webflow.com/templates/html/bestra-website-template",
    screenshotUrl: "https://bestra-128.webflow.io/",
    category: "professional_service",
    secondaryCategories: ["premium_media_led"],
    archetype: "minimal_professional_grid",
    set: "corpus",
    qualityLens: "Professional grid reference with polished density and conversion sections.",
    analysis: minimalGridAnalysis("professional grid hero", "compact solid header", "pricing/product pages")
  }),
  webflow({
    id: "webflow:jore",
    title: "Jore",
    sourceUrl: "https://webflow.com/templates/html/jore-website-template",
    screenshotUrl: "https://jores-template.webflow.io/",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "quiet_editorial_professional",
    set: "corpus",
    qualityLens: "Quiet professional composition with elegant type and simple section rhythm.",
    analysis: quietProfessionalAnalysis("professional editorial hero", "minimal solid header", "case/pricing pages")
  }),
  webflow({
    id: "webflow:collected",
    title: "Collected",
    sourceUrl: "https://webflow.com/templates/html/collected-website-template",
    screenshotUrl: "https://collected-template.webflow.io/",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "studio_portfolio_editorial",
    set: "corpus",
    qualityLens: "Studio/creative composition with image sequencing and portfolio-like rhythm.",
    analysis: studioAnalysis("portfolio collection hero", "minimal header", "portfolio CMS")
  }),
  webflow({
    id: "webflow:orlix-studio",
    title: "Orlix Studio",
    sourceUrl: "https://webflow.com/templates/html/orlix-studio-website-template",
    screenshotUrl: "https://orlix-studio.webflow.io/",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "studio_portfolio_editorial",
    set: "corpus",
    qualityLens: "Agency/studio page for testing asymmetry, portfolio cards, and non-repeated sections.",
    analysis: studioAnalysis("studio portfolio hero", "solid editorial header", "project pages")
  }),
  webflow({
    id: "webflow:teracle",
    title: "Teracle",
    sourceUrl: "https://webflow.com/templates/html/teracle-website-template",
    screenshotUrl: "https://webflow.com/templates/html/teracle-website-template",
    screenshotType: "marketplace_detail",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "minimal_professional_grid",
    set: "corpus",
    qualityLens: "Marketplace-detail reference for professional layout controls when live demo discovery is unavailable.",
    analysis: minimalGridAnalysis("professional product hero", "marketplace detail header", "SaaS/product widgets")
  }),
  webflow({
    id: "webflow:reelup",
    title: "Reelup",
    sourceUrl: "https://webflow.com/templates/html/reelup-website-template",
    screenshotUrl: "https://webflow.com/templates/html/reelup-website-template",
    screenshotType: "marketplace_detail",
    category: "studio_agency",
    secondaryCategories: ["premium_media_led"],
    archetype: "studio_portfolio_editorial",
    set: "corpus",
    qualityLens: "Marketplace-detail reference for media-led studio patterns and stronger visual rhythm.",
    analysis: studioAnalysis("media studio hero", "marketplace detail header", "video widgets")
  }),
  webflow({
    id: "webflow:olyyx",
    title: "Olyyx",
    sourceUrl: "https://webflow.com/templates/html/olyyx-website-template",
    screenshotUrl: "https://webflow.com/templates/html/olyyx-website-template",
    screenshotType: "marketplace_detail",
    category: "studio_agency",
    secondaryCategories: ["professional_service"],
    archetype: "studio_portfolio_editorial",
    set: "corpus",
    qualityLens: "Marketplace-detail reference for studio/agency polish and portfolio density.",
    analysis: studioAnalysis("agency media hero", "marketplace detail header", "portfolio widgets")
  }),
  webflow({
    id: "webflow:conicorn",
    title: "Conicorn",
    sourceUrl: "https://webflow.com/templates/html/conicorn-website-template",
    screenshotUrl: "https://webflow.com/templates/html/conicorn-website-template",
    screenshotType: "marketplace_detail",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "minimal_professional_grid",
    set: "corpus",
    qualityLens: "Marketplace-detail reference for professional grid, typography, and conversion density.",
    analysis: minimalGridAnalysis("professional grid hero", "marketplace detail header", "product pages")
  }),
  squarespace({
    id: "squarespace:template-store",
    title: "Squarespace Template Store",
    url: "https://www.squarespace.com/templates",
    category: "premium_media_led",
    secondaryCategories: ["restaurant", "salon_wellness", "professional_service"],
    archetype: "premium_media_led",
    set: "corpus",
    qualityLens: "Broad template-system reference for strong media rhythm, local essentials, and restrained customization.",
    analysis: premiumMediaAnalysis("template-store media grid", "marketplace header", "template browsing")
  }),
  squarespace({
    id: "squarespace:health-beauty-category",
    title: "Squarespace Health And Beauty Templates",
    url: "https://www.squarespace.com/templates?category=health-and-beauty",
    category: "salon_wellness",
    secondaryCategories: ["local_service"],
    archetype: "wellness_soft_service",
    set: "corpus",
    qualityLens: "Template-store category reference for softer wellness imagery and low-friction local conversion.",
    analysis: wellnessAnalysis("template-store wellness grid", "marketplace category header", "template browsing")
  }),
  squarespace({
    id: "squarespace:professional-services-category",
    title: "Squarespace Professional Services Templates",
    url: "https://www.squarespace.com/templates?category=professional-services",
    category: "professional_service",
    secondaryCategories: ["studio_agency"],
    archetype: "quiet_editorial_professional",
    set: "corpus",
    qualityLens: "Template-store category reference for professional-site restraint and page-system simplicity.",
    analysis: quietProfessionalAnalysis("template-store professional grid", "marketplace category header", "template browsing")
  }),
  squarespace({
    id: "squarespace:local-business-category",
    title: "Squarespace Local Business Templates",
    url: "https://www.squarespace.com/templates?category=local-business",
    category: "local_service",
    secondaryCategories: ["home_services", "professional_service"],
    archetype: "warm_neighborhood_service",
    set: "corpus",
    qualityLens: "Template-store category reference for local essentials, simple section rhythm, and approachable polish.",
    analysis: warmServiceAnalysis("template-store local-business grid", "marketplace category header", "template browsing")
  })
];

export function generatedSiteV3BenchmarkSummary(references = generatedSiteV3BenchmarkReferences) {
  return {
    total: references.length,
    byProvider: countBy(references, (reference) => reference.provider),
    byCategory: countBy(references, (reference) => reference.category),
    byArchetype: countBy(references, (reference) => reference.archetype),
    bySet: countBy(references, (reference) => reference.set),
    screenshotTypes: countBy(references, (reference) => reference.screenshotType)
  };
}

function framer(input: Omit<GeneratedSiteV3BenchmarkReference, "provider" | "sourceUrl" | "screenshotUrl" | "screenshotType"> & { url: string }) {
  const { url, ...rest } = input;
  return { ...rest, provider: "framer" as const, sourceUrl: url, screenshotUrl: url, screenshotType: "live_demo" as const };
}

function webflow(
  input: Omit<GeneratedSiteV3BenchmarkReference, "provider" | "screenshotType"> & {
    screenshotType?: GeneratedSiteV3BenchmarkScreenshotType;
  }
) {
  return { screenshotType: "live_demo" as const, ...input, provider: "webflow" as const };
}

function squarespace(input: Omit<GeneratedSiteV3BenchmarkReference, "provider" | "sourceUrl" | "screenshotUrl" | "screenshotType"> & { url: string }) {
  const { url, ...rest } = input;
  return {
    ...rest,
    provider: "squarespace" as const,
    sourceUrl: url,
    screenshotUrl: url,
    screenshotType: "template_store_category" as const
  };
}

function serviceConversionAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["first-viewport media", "service proof band", "practical contact close"],
    sectionTypes: ["hero", "service index", "process", "proof/contact", "footer"],
    servicePresentation: "Customer problem mapped to service rows or cards with direct CTA proximity.",
    proofContactFooter: "Phone, address/service area, trust cues, and footer facts must be visible without a deep hunt.",
    mobileBehavior: "CTA remains reachable, media crops hold subject, and service cards collapse into scannable rows.",
    requiredV3Controls: ["hero.mediaPosition", "hero.ctaCluster", "section.density", "service.cardEmphasis", "contact.factGrid", "footer.localFacts"],
    outOfScopeFeatures: [outOfScope]
  };
}

function warmServiceAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["warm hero image", "alternating service/media bands", "soft contact section"],
    sectionTypes: ["hero", "service tiles", "story panel", "local context", "contact", "footer"],
    servicePresentation: "Services feel approachable through natural-language cards and optional small media.",
    proofContactFooter: "Local facts and contact paths are integrated into a warm footer rather than a detached utility block.",
    mobileBehavior: "Single-column stack keeps image above service context and avoids excessive card repetition.",
    requiredV3Controls: ["palette.warmth", "media.cropTone", "section.surfaceMode", "service.tileShape", "story.mediaSide", "footer.hoursMode"],
    outOfScopeFeatures: [outOfScope]
  };
}

function hospitalityAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["atmospheric hero", "full-bleed food/space media", "reservation/contact close"],
    sectionTypes: ["hero", "menu preview", "experience/story", "gallery", "location", "footer"],
    servicePresentation: "Offerings are presented as atmosphere/menu/story rather than utilitarian service cards.",
    proofContactFooter: "Reservations, hours, address, and social proof should be close to the media story.",
    mobileBehavior: "Hero image stays tall, menu previews simplify, and reservation CTA stays prominent.",
    requiredV3Controls: ["hero.atmosphere", "media.fullBleed", "section.captionStyle", "offer.menuPreview", "contact.reservationMode", "footer.hoursAddress"],
    outOfScopeFeatures: [outOfScope]
  };
}

function premiumMediaAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["cinematic hero", "large image slabs", "high-contrast content bands"],
    sectionTypes: ["hero", "feature media", "service/showcase", "metrics", "contact", "footer"],
    servicePresentation: "Services are shown as premium capabilities with strong media and sparse explanatory copy.",
    proofContactFooter: "Contact and trust cues need high contrast without looking like generic dark SaaS UI.",
    mobileBehavior: "Large media becomes controlled vertical crops with concise CTA grouping.",
    requiredV3Controls: ["hero.overlayStrength", "media.aspectRatio", "palette.contrast", "section.fullBleed", "service.showcaseMode", "button.highContrast"],
    outOfScopeFeatures: [outOfScope]
  };
}

function studioAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["editorial hero", "asymmetric portfolio rows", "image/text alternation"],
    sectionTypes: ["hero", "selected work", "capabilities", "process/story", "contact", "footer"],
    servicePresentation: "Capabilities are concise and paired with work-like media rather than generic cards.",
    proofContactFooter: "Footer can be minimal, but contact and credibility must remain explicit.",
    mobileBehavior: "Asymmetric desktop layouts collapse into deliberate editorial sequencing, not random stacking.",
    requiredV3Controls: ["grid.asymmetry", "media.overlap", "section.rhythm", "capability.listStyle", "typography.displayScale", "footer.minimalMode"],
    outOfScopeFeatures: [outOfScope]
  };
}

function wellnessAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["soft hero media", "calm service surfaces", "appointment/contact close"],
    sectionTypes: ["hero", "services", "practitioner/story", "process", "contact", "footer"],
    servicePresentation: "Services should feel calm and readable with prices/durations optional but not required.",
    proofContactFooter: "Hours, appointment guidance, and location should be practical without breaking the calm tone.",
    mobileBehavior: "Whitespace compresses carefully, type remains readable, and CTA labels stay concrete.",
    requiredV3Controls: ["palette.softness", "fontPairing.calm", "section.rounding", "service.priceMeta", "contact.appointmentMode", "media.softCrop"],
    outOfScopeFeatures: [outOfScope]
  };
}

function venueAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["energetic hero", "program/class bands", "community media"],
    sectionTypes: ["hero", "programs", "schedule preview", "community/story", "contact", "footer"],
    servicePresentation: "Offerings are classes, memberships, events, or programs with action-oriented CTAs.",
    proofContactFooter: "Location, hours, membership/action path, and social/community proof need clear placement.",
    mobileBehavior: "Program cards become compact rows and CTA remains visible without horizontal overflow.",
    requiredV3Controls: ["hero.energyLevel", "media.motionSafe", "program.cardDensity", "schedule.preview", "cta.stickyMobile", "footer.venueFacts"],
    outOfScopeFeatures: [outOfScope]
  };
}

function quietProfessionalAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["large quiet hero", "editorial text bands", "select media moments"],
    sectionTypes: ["hero", "capabilities", "case/story", "team/proof", "contact", "footer"],
    servicePresentation: "Services are structured as professional capabilities with concise support copy.",
    proofContactFooter: "Credibility, location, and contact should be explicit even when the visual style is restrained.",
    mobileBehavior: "Editorial scale reduces gracefully and wide images become stable, readable crops.",
    requiredV3Controls: ["typography.editorialScale", "grid.columnSpan", "section.whiteSpace", "media.caption", "proof.quietMode", "contact.inlineFacts"],
    outOfScopeFeatures: [outOfScope]
  };
}

function minimalGridAnalysis(heroType: string, headerBehavior: string, outOfScope: string): GeneratedSiteV3BenchmarkAnalysis {
  return {
    heroType,
    headerBehavior,
    mediaRhythm: ["text-led hero", "strict grid sections", "optional minimal media"],
    sectionTypes: ["hero", "capabilities grid", "proof/metrics", "process", "contact", "footer"],
    servicePresentation: "Services are shown through crisp grid modules with strong type hierarchy.",
    proofContactFooter: "Practical facts must be visible without requiring heavy media or vertical widgets.",
    mobileBehavior: "Grid collapses into readable, evenly spaced rows with no cramped cards.",
    requiredV3Controls: ["grid.trackCount", "grid.ruleStyle", "typography.scale", "section.borderMode", "service.gridDensity", "contact.minimalMode"],
    outOfScopeFeatures: [outOfScope]
  };
}

function countBy<T extends Record<string, unknown>>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
