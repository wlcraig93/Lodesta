import type { StandardCriterion } from "./models";

export const standardCriteria: StandardCriterion[] = [
  {
    id: "technical.https",
    layer: "technical_seo",
    vertical: "universal",
    title: "Site is served over HTTPS",
    checkMethod: "crawl",
    threshold: { protocol: "https:" },
    businessConsequence: "Browsers can warn visitors away from insecure sites before they call, book, or submit a form.",
    generationRule: "Serve every published customer site over HTTPS through Railway or Cloudflare for SaaS.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "technical.healthy_response",
    layer: "technical_seo",
    vertical: "universal",
    title: "Site returns a healthy HTML response",
    checkMethod: "crawl",
    threshold: { statusBelow: 400, htmlRequired: true },
    businessConsequence: "Customers and search engines may see errors before the business gets a chance to convert them.",
    generationRule: "Published sites must serve cacheable HTML with a successful status for every public page.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "technical.mobile_viewport",
    layer: "technical_seo",
    vertical: "universal",
    title: "Mobile viewport is configured",
    checkMethod: "crawl",
    threshold: { viewportMetaRequired: true },
    businessConsequence: "Mobile visitors can see a zoomed-out desktop page and leave before contacting the business.",
    generationRule: "Render a viewport meta tag and responsive layout for every generated site.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.title.unique",
    layer: "technical_seo",
    vertical: "universal",
    title: "Every page has a unique title and meta description",
    checkMethod: "crawl",
    threshold: { titleMinChars: 25, descriptionMinChars: 80 },
    businessConsequence: "Weak search snippets lower local search click-through.",
    generationRule: "Generate page-specific title and meta description from business profile, service, and location.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.meta_description",
    layer: "technical_seo",
    vertical: "universal",
    title: "Every page has a useful meta description",
    checkMethod: "crawl",
    threshold: { descriptionMinChars: 80 },
    businessConsequence: "Weak snippets reduce local search click-through even when the page ranks.",
    generationRule: "Generate page-specific meta descriptions from business facts, services, and location.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.canonical",
    layer: "technical_seo",
    vertical: "universal",
    title: "Canonical URL is present",
    checkMethod: "crawl",
    threshold: { canonicalRequired: true },
    businessConsequence: "Duplicate URL variants can dilute crawl signals and confuse indexing.",
    generationRule: "Render a canonical URL for every public page based on the mapped domain and page path.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.clean_urls",
    layer: "technical_seo",
    vertical: "universal",
    title: "Public URLs are clean and readable",
    checkMethod: "crawl",
    threshold: { avoidFileExtensions: true, avoidQueryCanonical: true },
    businessConsequence: "Messy URL patterns weaken trust and make service/location pages harder to understand and share.",
    generationRule: "Render extensionless page slugs from the structured page model and keep canonical paths query-free.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.robots_txt",
    layer: "technical_seo",
    vertical: "universal",
    title: "robots.txt is present",
    checkMethod: "crawl",
    threshold: { robotsTxtRequired: true },
    businessConsequence: "A missing robots file is a maintenance signal and limits control over crawl behavior.",
    generationRule: "Serve robots.txt for published sites and disallow tokenized pre-claim previews.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.sitemap",
    layer: "technical_seo",
    vertical: "universal",
    title: "XML sitemap is present",
    checkMethod: "crawl",
    threshold: { sitemapRequired: true },
    businessConsequence: "Search engines may discover service and location pages more slowly.",
    generationRule: "Generate sitemap.xml from the published structured page model.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.local_business_schema",
    layer: "technical_seo",
    vertical: "universal",
    title: "LocalBusiness structured data is present",
    checkMethod: "dom",
    threshold: { requiredFields: ["name", "telephone", "address", "openingHours"] },
    businessConsequence: "Search engines have weaker structured understanding of the business.",
    generationRule: "Render LocalBusiness JSON-LD from verified BusinessProfile fields.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "seo.service_location_pages",
    layer: "content_structure",
    vertical: "universal",
    title: "Service and location landing pages exist",
    checkMethod: "dom",
    threshold: { servicePagesRecommended: true, areaPagesRecommended: true },
    businessConsequence: "A thin two-page site misses specific local-search intent for services and towns the business serves.",
    generationRule: "Generate dedicated pages for primary services and service areas from the structured BusinessProfile.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "conversion.mobile_click_to_call",
    layer: "conversion",
    vertical: "universal",
    title: "Mobile visitors can tap to call",
    checkMethod: "dom",
    threshold: { requiredHrefPrefix: "tel:" },
    businessConsequence: "Mobile callers are lost when the phone number is not tappable.",
    generationRule: "Render a text phone link and a sticky mobile call action when phone is known.",
    auditEligible: true,
    experimentEligible: true
  },
  {
    id: "conversion.lead_form",
    layer: "conversion",
    vertical: "universal",
    title: "A lead/contact form exists",
    checkMethod: "dom",
    threshold: { minimumForms: 1 },
    businessConsequence: "Visitors who do not want to call have no low-friction way to become leads.",
    generationRule: "Render a contact form by default and store submissions as flexible JSON payloads.",
    auditEligible: true,
    experimentEligible: true
  },
  {
    id: "conversion.primary_action_above_fold",
    layer: "conversion",
    vertical: "universal",
    title: "Primary action is visible above the fold",
    checkMethod: "render",
    threshold: { maxYDesktop: 720, maxYMobile: 620 },
    businessConsequence: "Visitors do not immediately know what action to take.",
    generationRule: "Place the primary CTA in the hero and repeat it after trust proof.",
    auditEligible: true,
    experimentEligible: true
  },
  {
    id: "conversion.mobile_sticky_action",
    layer: "conversion",
    vertical: "universal",
    title: "Mobile sticky action is available",
    checkMethod: "render",
    threshold: { mobileOnly: true },
    businessConsequence: "The conversion action scrolls out of reach on mobile.",
    generationRule: "Use sticky mobile CTA for call, booking, order, or form-first businesses.",
    auditEligible: true,
    experimentEligible: true
  },
  {
    id: "trust.reviews_visible",
    layer: "trust",
    vertical: "universal",
    title: "Reviews or trust proof are visible",
    checkMethod: "vision",
    threshold: { minimumSignals: 1 },
    businessConsequence: "Visitors lack confidence that the business is credible.",
    generationRule: "Surface ratings, review count, testimonials, years in business, or credentials near conversion paths.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "accessibility.image_alt",
    layer: "technical_seo",
    vertical: "universal",
    title: "Images include useful alt text",
    checkMethod: "crawl",
    threshold: { missingAltAllowed: 0 },
    businessConsequence: "Missing alt text hurts accessibility and weakens image-search context.",
    generationRule: "Every generated, licensed, uploaded, or customer-granted image receives descriptive alt text.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.home_services.emergency_cta",
    layer: "content_structure",
    vertical: "home_services",
    title: "Home services sites expose emergency call paths",
    checkMethod: "dom",
    threshold: { emergencySignalRequired: true },
    businessConsequence: "Emergency-intent visitors may leave for a faster competitor.",
    generationRule: "If the business offers urgent service, include emergency service language and call CTA.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.auto_body.before_after",
    layer: "content_structure",
    vertical: "auto_body",
    title: "Auto body sites include before and after proof",
    checkMethod: "vision",
    threshold: { galleryRecommended: true },
    businessConsequence: "Prospects cannot quickly verify quality of repair work.",
    generationRule: "Include a before/after gallery or project proof section.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.restaurant.order_path",
    layer: "content_structure",
    vertical: "restaurant",
    title: "Restaurants expose menu and order/reservation paths",
    checkMethod: "dom",
    threshold: { menuRequired: true, orderOrReserveRequired: true },
    businessConsequence: "Hungry visitors cannot quickly decide or transact.",
    generationRule: "Prioritize menu, order/reserve CTA, hours, location, and real food imagery.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.beauty_salon.gallery_booking",
    layer: "content_structure",
    vertical: "beauty_salon",
    title: "Beauty salons lead with work samples and booking",
    checkMethod: "vision",
    threshold: { galleryRequired: true, bookingPathRequired: true },
    businessConsequence: "Style-driven visitors need to see the work and book quickly before comparing another salon.",
    generationRule: "Use a gallery-forward hero or gallery section and a booking-first CTA.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.med_spa.credentials_results",
    layer: "content_structure",
    vertical: "med_spa",
    title: "Med spas show treatments, credentials, and result proof",
    checkMethod: "vision",
    threshold: { treatmentsRequired: true, credentialsRequired: true, resultProofRecommended: true },
    businessConsequence: "High-consideration aesthetic services need clinical trust before visitors request a consultation.",
    generationRule: "Include treatments, provider credentials, before/after proof, reviews, and consultation CTA.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.law_firm.practice_credibility",
    layer: "content_structure",
    vertical: "law_firm",
    title: "Law firms prioritize practice areas and attorney credibility",
    checkMethod: "dom",
    threshold: { practiceAreasRequired: true, attorneyProofRequired: true, galleryAvoided: true },
    businessConsequence: "Legal prospects need confidence and a relevant practice path, not generic visual filler.",
    generationRule: "Use practice areas, attorney/team credentials, testimonials or results, and consultation CTA; avoid decorative galleries.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.dental.new_patient_path",
    layer: "content_structure",
    vertical: "dental",
    title: "Dental practices answer new-patient concerns",
    checkMethod: "dom",
    threshold: { servicesRequired: true, teamRequired: true, insuranceOrNewPatientCopyRecommended: true },
    businessConsequence: "New patients hesitate when they cannot evaluate services, insurance, team, and booking steps.",
    generationRule: "Include services, team, reviews, location, appointment CTA, and new-patient or insurance guidance.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.fitness.trial_schedule",
    layer: "content_structure",
    vertical: "fitness",
    title: "Fitness sites expose trial, classes, and instructors",
    checkMethod: "dom",
    threshold: { trialPathRequired: true, classOrServiceInfoRequired: true, trainerProofRecommended: true },
    businessConsequence: "Prospects need to understand the workout and try it before committing.",
    generationRule: "Lead with trial/join CTA, class or service structure, trainers, social proof, and location.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.real_estate.valuation_contact",
    layer: "content_structure",
    vertical: "real_estate",
    title: "Real estate agents expose valuation and local expertise",
    checkMethod: "dom",
    threshold: { valuationOrContactPathRequired: true, localExpertiseRequired: true },
    businessConsequence: "Sellers and buyers convert when the agent gives a clear reason to make contact now.",
    generationRule: "Use a valuation/contact CTA, local expertise proof, testimonials, and listing or service context.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.landscaping.project_gallery",
    layer: "content_structure",
    vertical: "landscaping",
    title: "Landscaping sites show project proof and service area",
    checkMethod: "vision",
    threshold: { projectGalleryRequired: true, quotePathRequired: true, serviceAreaRequired: true },
    businessConsequence: "Homeowners need visual proof, local coverage, and a low-friction quote path.",
    generationRule: "Include services, project gallery, service area, reviews, and quote CTA.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.veterinary.team_new_patient",
    layer: "content_structure",
    vertical: "veterinary",
    title: "Veterinary clinics show care team and appointment paths",
    checkMethod: "dom",
    threshold: { servicesRequired: true, teamRequired: true, appointmentPathRequired: true },
    businessConsequence: "Pet owners need to trust the care team and know how to book or call.",
    generationRule: "Include services, vet/team proof, new-patient information, reviews, hours, and appointment CTA.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.creative_studio.portfolio_first",
    layer: "content_structure",
    vertical: "creative_studio",
    title: "Creative studios lead with portfolio proof",
    checkMethod: "vision",
    threshold: { portfolioRequired: true, inquiryPathRequired: true },
    businessConsequence: "Creative buyers evaluate the work before they read the copy.",
    generationRule: "Use portfolio/gallery-forward layout, packages or services, testimonials, and inquiry CTA.",
    auditEligible: true,
    experimentEligible: false
  },
  {
    id: "content.general_local.local_spine",
    layer: "content_structure",
    vertical: "general_local",
    title: "General local sites include the local conversion spine",
    checkMethod: "dom",
    threshold: { servicesRequired: true, trustRequired: true, contactRequired: true },
    businessConsequence: "Visitors need to know what the business does, why to trust it, and how to contact it.",
    generationRule: "Include hero CTA, services, trust proof, local signals, contact form, and footer NAP.",
    auditEligible: true,
    experimentEligible: false
  }
];

export function getAuditEligibleCriteria() {
  return standardCriteria.filter((criterion) => criterion.auditEligible);
}

export function getStandardCriterion(id: string) {
  return standardCriteria.find((criterion) => criterion.id === id);
}

export function getCriteriaForVertical(vertical: StandardCriterion["vertical"]) {
  return standardCriteria.filter((criterion) => criterion.vertical === "universal" || criterion.vertical === vertical);
}
