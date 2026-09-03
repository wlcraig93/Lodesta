import { createHash } from "node:crypto";
import type {
  AssessmentAggregation,
  AssessmentApplicability,
  AssessmentControlOwner,
  AssessmentDimensionId,
  AssessmentEvidenceTier,
  AssessmentEvaluatorType,
  AssessmentImpact,
  AssessmentReleaseDisposition,
  AssessmentScopeUnit
} from "./contracts";
import {
  agentReadinessCheckDefinitions,
  agentReadinessMethodologyIdentity
} from "./agent-readiness";
import {
  visualQualityCheckDefinitions,
  visualQualityEvaluatorIdentity,
  visualQualityMethodologyIdentity,
  visualQualityPromptIdentity
} from "./visual-quality";
import {
  websiteHealthRouteSelectionIdentity,
  websiteHealthRouteSelectionPolicy
} from "./route-selection";

export const minimumVerticalConfidence = 0.8;
export const minimumScoreCoverage = 0.85;
export const websiteAssessmentScoringPolicy = {
  points: { critical: 4, major: 2, minor: 1, advisory: 0 },
  statusCredit: { pass: 1, warning: 0.5, fail: 0 },
  excludedStatuses: ["unknown", "not_applicable"],
  unscoredCriteriaExcludedFromCoverage: true,
  dimensions: {
    states: ["scored", "not_yet_scored", "insufficient_evidence", "not_applicable"],
    capMinimumAssessedCriteria: 3,
    capMinimumAssessedPossiblePoints: 6,
    capMinimumSiteEvidenceCoverage: 0.7
  },
  caps: {
    deterministicReleaseBlocker: 49,
    dimensionBelow50: 69,
    dimensionBelow70: 79,
    coverage: [
      { minimumInclusive: 0, maximumExclusive: 0.5, cap: 49 },
      { minimumInclusive: 0.5, maximumExclusive: 0.7, cap: 69 },
      { minimumInclusive: 0.7, maximumExclusive: 0.85, cap: 79 },
      { minimumInclusive: 0.85, maximumInclusive: 1, cap: null }
    ]
  },
  bands: [
    { minimumInclusive: 90, band: "excellent" },
    { minimumInclusive: 80, band: "strong" },
    { minimumInclusive: 70, band: "serviceable" },
    { minimumInclusive: 50, band: "weak" },
    { minimumInclusive: 0, band: "poor" }
  ],
  confidence: "telemetry_only",
  inferredCalibration: "criterion_level_registry_identity",
  publicGrade: "withheld_until_product_owner_approval"
} as const;

export const serviceAreaOptionalVerticals: ReadonlySet<string> = new Set([
  "restaurant",
  "beauty_salon",
  "med_spa",
  "dental",
  "fitness",
  "veterinary"
]);

export const assessmentDimensions: ReadonlyArray<{
  id: AssessmentDimensionId;
  label: string;
  weight: number;
}> = [
  { id: "business_truth", label: "Business truth", weight: 10 },
  { id: "functional_integrity", label: "Functional integrity", weight: 15 },
  { id: "responsive_usability", label: "Responsive usability", weight: 10 },
  { id: "performance", label: "Performance", weight: 7 },
  { id: "accessibility", label: "Accessibility", weight: 8 },
  { id: "search_answer_discoverability", label: "SEO and AEO discoverability", weight: 10 },
  { id: "content_intent_coverage", label: "Content and intent coverage", weight: 10 },
  { id: "trust_proof", label: "Trust and proof", weight: 10 },
  { id: "conversion_usability", label: "Conversion usability", weight: 12 },
  { id: "visual_editorial_craft", label: "Visual and editorial craft", weight: 8 }
] as const;

export type AssessmentCriterionDefinition = {
  id: string;
  definitionIdentity: `criterion@sha256:${string}`;
  dimensionId: AssessmentDimensionId;
  topics: string[];
  title: string;
  impact: AssessmentImpact;
  applicability: AssessmentApplicability;
  applicabilityRules: {
    targets: Array<"public_url" | "site_artifact" | "published_site">;
    verticals?: string[];
    capability?: string;
    requiredCanonicalFacts?: Array<
      "businessName" | "phone" | "email" | "address" | "hours" | "coordinates" | "serviceAreas" | "proof"
    >;
  };
  evaluatorType: AssessmentEvaluatorType;
  deterministicPrecedence: boolean;
  controlOwner: AssessmentControlOwner;
  releaseDisposition: AssessmentReleaseDisposition;
  scoreEligible: boolean;
  publicEligible: boolean;
  scopeUnit: AssessmentScopeUnit;
  aggregation: AssessmentAggregation;
  evidenceTier: AssessmentEvidenceTier;
  anchors: {
    pass: string;
    warning: string;
    fail: string;
  };
  calibrationIdentity?: `calibration@sha256:${string}`;
  evidenceRequirements: string[];
  businessConsequence: string;
  recommendation: string;
  points: number;
};

type CriterionOptions = {
  topics?: string[];
  applicability?: AssessmentApplicability;
  applicabilityRules?: Partial<AssessmentCriterionDefinition["applicabilityRules"]>;
  evaluatorType?: AssessmentEvaluatorType;
  deterministicPrecedence?: boolean;
  controlOwner?: AssessmentControlOwner;
  releaseDisposition?: AssessmentReleaseDisposition;
  scoreEligible?: boolean;
  publicEligible?: boolean;
  scopeUnit?: AssessmentScopeUnit;
  aggregation?: AssessmentAggregation;
  evidenceTier?: AssessmentEvidenceTier;
  anchors?: AssessmentCriterionDefinition["anchors"];
  calibrationIdentity?: `calibration@sha256:${string}`;
  evidenceRequirements?: string[];
};

function criterion(
  id: string,
  dimensionId: AssessmentDimensionId,
  title: string,
  impact: AssessmentImpact,
  businessConsequence: string,
  recommendation: string,
  options: CriterionOptions = {}
): AssessmentCriterionDefinition {
  const evaluatorType = options.evaluatorType ?? "deterministic";
  const scopeUnit = options.scopeUnit ?? defaultScopeUnit(id);
  const definitionBase = {
    id,
    dimensionId,
    topics: options.topics ?? [id.split(".")[0] ?? dimensionId],
    title,
    impact,
    applicability: options.applicability ?? "universal",
    applicabilityRules: {
      targets: options.applicabilityRules?.targets
        ?? ["public_url", "site_artifact", "published_site"],
      ...(options.applicabilityRules?.verticals
        ? { verticals: options.applicabilityRules.verticals }
        : {}),
      ...(options.applicabilityRules?.capability
        ? { capability: options.applicabilityRules.capability }
        : {}),
      ...(options.applicabilityRules?.requiredCanonicalFacts
        ? { requiredCanonicalFacts: options.applicabilityRules.requiredCanonicalFacts }
        : {})
    },
    evaluatorType,
    deterministicPrecedence: options.deterministicPrecedence ?? evaluatorType !== "human",
    controlOwner: options.controlOwner ?? "site_author",
    releaseDisposition: options.releaseDisposition ?? "advisory",
    scoreEligible: options.scoreEligible ?? impact !== "advisory",
    publicEligible: options.publicEligible ?? evaluatorType === "deterministic",
    scopeUnit,
    aggregation: options.aggregation ?? defaultAggregation(scopeUnit, evaluatorType),
    evidenceTier: options.evidenceTier ?? defaultEvidenceTier(id, evaluatorType),
    anchors: options.anchors ?? defaultAnchors(title, recommendation),
    ...(options.calibrationIdentity ? { calibrationIdentity: options.calibrationIdentity } : {}),
    evidenceRequirements: options.evidenceRequirements ?? ["retained criterion-specific evidence"],
    businessConsequence,
    recommendation,
    points: websiteAssessmentScoringPolicy.points[impact]
  };
  if (definitionBase.aggregation === "worst_case"
    && evaluatorType !== "deterministic"
    && !options.calibrationIdentity) {
    throw new Error(`Worst-case aggregation requires deterministic evidence or criterion calibration: ${id}`);
  }
  return {
    ...definitionBase,
    definitionIdentity: contentIdentity("criterion", definitionBase) as `criterion@sha256:${string}`
  };
}

const baseCriteria: AssessmentCriterionDefinition[] = [
  criterion("trust.business_identity", "business_truth", "Business identity and contact facts are visible and consistent", "major", "Unclear or inconsistent business identity makes the site feel unreliable and can misdirect customers.", "Display publish-eligible business name and contact facts consistently.", { applicability: "business_specific", controlOwner: "shared", topics: ["nap", "identity"] }),
  criterion("truth.phone_consistency", "business_truth", "Rendered phone numbers match the canonical business number", "critical", "A contradictory phone number sends customer calls to the wrong destination.", "Render only the publish-eligible canonical phone number.", { applicability: "business_specific", applicabilityRules: { requiredCanonicalFacts: ["phone"] }, controlOwner: "shared", releaseDisposition: "blocking", topics: ["phone", "factual_consistency"] }),
  criterion("truth.hours_consistency", "business_truth", "Rendered business hours do not contradict canonical hours", "critical", "Incorrect hours cause failed visits and missed calls.", "Render canonical hours exactly, or omit hours when no publish-eligible fact exists.", { applicability: "business_specific", applicabilityRules: { requiredCanonicalFacts: ["hours"] }, controlOwner: "shared", releaseDisposition: "blocking", topics: ["hours", "factual_consistency"] }),
  criterion("truth.structured_data_consistency", "business_truth", "Machine-readable business facts match canonical visible facts", "critical", "Conflicting structured data weakens trust and can propagate incorrect answers.", "Emit structured data only from publish-eligible canonical facts.", { applicability: "business_specific", controlOwner: "lodesta_platform", releaseDisposition: "blocking", topics: ["structured_data", "factual_consistency"] }),
  criterion("release.claim_binding", "business_truth", "Generated factual and credibility claims are bound to canonical evidence", "critical", "Unsupported availability, credential, guarantee, longevity, contact, or metadata claims can mislead customers even when the rest of the site is polished.", "Bind each specific generated claim to a compatible publish-eligible fact or omit it.", { applicability: "business_specific", applicabilityRules: { targets: ["site_artifact"] }, controlOwner: "site_author", releaseDisposition: "blocking", scoreEligible: false, publicEligible: false, topics: ["claim_support", "fact_binding"] }),

  criterion("functional.home_reachable", "functional_integrity", "Homepage returns a usable response", "critical", "Customers and search engines cannot use a site that does not load.", "Restore a successful HTTPS response for the canonical homepage.", { releaseDisposition: "blocking", controlOwner: "shared" }),
  criterion("functional.https", "functional_integrity", "The website is served over HTTPS", "critical", "An insecure connection triggers browser warnings, weakens trust, and can expose customer data.", "Serve every public route over HTTPS and redirect HTTP requests to the canonical secure URL.", { releaseDisposition: "blocking", controlOwner: "lodesta_platform", applicabilityRules: { targets: ["public_url", "published_site"] } }),
  criterion("functional.internal_destinations", "functional_integrity", "Internal links reach valid destinations", "critical", "Broken internal paths interrupt customer journeys and waste search-engine crawl capacity.", "Repair or redirect every broken internal destination.", { releaseDisposition: "blocking" }),
  criterion("functional.navigation_reachability", "functional_integrity", "Primary navigation destinations are visibly reachable", "critical", "A destination that exists but cannot be activated is functionally unavailable to customers.", "Provide a visible, hit-testable link or interactive disclosure path to every primary destination at each breakpoint.", { releaseDisposition: "advisory", topics: ["navigation", "interaction"], evidenceRequirements: ["interactive hit-testing at desktop and mobile breakpoints", "disclosure activation evidence"] }),
  criterion("functional.primary_external_destinations", "functional_integrity", "Primary booking and ordering links work", "major", "A broken booking or ordering handoff loses customers at the point of intent.", "Replace or repair unavailable primary external destinations.", { releaseDisposition: "blocking", applicability: "capability", applicabilityRules: { capability: "external_booking_or_ordering" } }),
  criterion("functional.images_load", "functional_integrity", "Visible images load", "major", "Broken imagery weakens credibility and can hide important service information.", "Replace missing image sources and verify each responsive image variant.", { releaseDisposition: "blocking" }),
  criterion("functional.browser_errors", "functional_integrity", "Pages avoid material browser errors", "minor", "Browser errors can signal hidden interaction failures and create an unreliable experience.", "Resolve recurring console and page errors on customer-facing routes.", { releaseDisposition: "blocking", controlOwner: "shared" }),
  criterion("functional.form_path", "functional_integrity", "Lead forms expose a valid submission path", "critical", "A form that cannot submit silently loses high-intent leads.", "Use a validated Lodesta form binding or a verified first-party submission endpoint.", { releaseDisposition: "blocking", applicability: "capability", applicabilityRules: { capability: "lead_form" }, controlOwner: "shared" }),

  criterion("performance.mobile_viewport", "responsive_usability", "Pages declare a mobile viewport", "major", "Without a mobile viewport, pages render poorly on phones.", "Add a responsive viewport declaration to every page.", { controlOwner: "shared" }),
  criterion("performance.mobile_overflow", "responsive_usability", "Mobile pages avoid horizontal overflow", "major", "Horizontal scrolling hides content and makes the site feel broken.", "Constrain wide elements and verify the layout at phone widths.", { releaseDisposition: "blocking", topics: ["overflow", "mobile"] }),
  criterion("performance.readable_text", "responsive_usability", "Mobile body text is readable", "minor", "Small text makes service details and calls to action harder to use.", "Keep essential mobile text at a readable size and line length.", { topics: ["typography", "mobile"], evidenceRequirements: ["computed font sizes and line lengths at native viewport dimensions"] }),
  criterion("responsive.target_size", "responsive_usability", "Interactive targets are comfortably usable on touch screens", "major", "Small or crowded targets create mis-taps and make navigation difficult.", "Increase target size and spacing for essential mobile controls.", { topics: ["touch_target", "mobile"], evidenceRequirements: ["computed control geometry at 390×844"] }),
  criterion("responsive.no_clipping_overlap", "responsive_usability", "Content and controls avoid clipping and overlap", "major", "Clipped or obscured content can hide key information and actions.", "Repair responsive layout constraints that clip or cover visible content.", { releaseDisposition: "blocking", topics: ["clipping", "overlap"], evidenceRequirements: ["browser geometry and hit-testing at required viewports"] }),

  criterion("performance.lcp", "performance", "Largest Contentful Paint is healthy", "major", "Slow primary content increases abandonment before customers understand the offer.", "Reduce server delay, image weight, and render-blocking work to bring LCP within 2.5 seconds.", { controlOwner: "shared", applicabilityRules: { targets: ["public_url", "published_site"] }, evidenceRequirements: ["field metric or independent lab measurement"] }),
  criterion("performance.inp", "performance", "Interaction to Next Paint is healthy", "major", "Sluggish interactions make calls, menus, and forms feel unresponsive.", "Reduce long main-thread tasks and third-party script work to bring INP within 200 ms.", { controlOwner: "shared", applicabilityRules: { targets: ["public_url", "published_site"] }, evidenceRequirements: ["field metric or supported interaction lab measurement"] }),
  criterion("performance.cls", "performance", "Cumulative Layout Shift is healthy", "major", "Unexpected movement causes mis-clicks and undermines trust.", "Reserve media dimensions and stabilize late-loading content to keep CLS within 0.1.", { controlOwner: "shared", applicabilityRules: { targets: ["public_url", "published_site"] }, evidenceRequirements: ["field metric or independent lab measurement"] }),

  criterion("accessibility.axe_critical", "accessibility", "No critical automated accessibility violations are detected", "critical", "Critical accessibility barriers can prevent customers from completing core tasks.", "Resolve every critical automated accessibility violation and verify with assistive technology.", { releaseDisposition: "blocking" }),
  criterion("accessibility.axe_serious", "accessibility", "No serious automated accessibility violations are detected", "major", "Serious accessibility defects make important content or controls unusable for some customers.", "Resolve serious automated violations, prioritizing forms, navigation, contrast, and names."),
  criterion("accessibility.image_alt", "accessibility", "Meaningful images provide alternative text", "major", "Missing alternative text hides useful information from screen-reader users.", "Add concise alternative text to meaningful images and empty alt text to decorative images."),
  criterion("accessibility.heading_structure", "accessibility", "Headings form a usable page outline", "minor", "A weak outline makes pages harder to navigate with assistive technology.", "Use one descriptive primary heading and a logical nested heading order."),
  criterion("accessibility.form_labels", "accessibility", "Form controls have accessible names", "critical", "Unlabelled fields prevent some customers from completing an inquiry.", "Associate every field with a visible label or an equivalent accessible name.", { releaseDisposition: "blocking", applicability: "capability", applicabilityRules: { capability: "lead_form" } }),

  criterion("discoverability.title", "search_answer_discoverability", "Pages use descriptive, distinct titles", "major", "Weak or missing titles make pages harder to understand in search results.", "Give each important page a specific title describing the service and market.", { controlOwner: "shared" }),
  criterion("discoverability.meta_description", "search_answer_discoverability", "Pages provide useful, distinct search descriptions", "minor", "Missing or duplicated descriptions reduce control over how the business appears in search.", "Write a distinct, useful description for each important page.", { controlOwner: "shared" }),
  criterion("discoverability.canonical", "search_answer_discoverability", "The homepage declares a canonical URL", "minor", "Ambiguous canonical URLs can split indexing signals.", "Declare the preferred canonical HTTPS URL.", { controlOwner: "lodesta_platform", applicabilityRules: { targets: ["public_url", "published_site"] } }),
  criterion("discoverability.robots", "search_answer_discoverability", "robots.txt is available and permits important pages", "major", "Accidental crawl restrictions can keep the site out of search and answer systems.", "Publish a valid robots.txt and allow important public routes.", { controlOwner: "lodesta_platform", applicabilityRules: { targets: ["public_url", "published_site"] } }),
  criterion("discoverability.sitemap", "search_answer_discoverability", "An XML sitemap is discoverable", "minor", "A sitemap helps search and answer systems consistently discover important pages.", "Publish and reference an XML sitemap containing canonical public routes.", { controlOwner: "lodesta_platform", applicabilityRules: { targets: ["public_url", "published_site"] } }),
  criterion("discoverability.local_schema", "search_answer_discoverability", "Local business structured data is present", "minor", "Missing structured data makes business identity and local facts harder for machines to interpret.", "Add accurate LocalBusiness-compatible JSON-LD bound to verified business facts.", { controlOwner: "lodesta_platform" }),

  criterion("local_content.service_detail", "content_intent_coverage", "Core services have substantive detail", "major", "Thin service coverage gives customers and search engines little reason to choose the business.", "Explain scope, customer fit, process, and differentiators for each core service."),
  criterion("local_content.location_clarity", "content_intent_coverage", "The primary service location or area is clear", "major", "Customers cannot confidently act if they are unsure whether the business serves them.", "State the verified location or service area in prominent site content.", { applicability: "business_specific", controlOwner: "shared" }),
  criterion("local_content.service_area_depth", "content_intent_coverage", "Local service coverage is specific", "minor", "Generic location mentions do not answer local intent or establish market relevance.", "Add factual, non-duplicative content for the markets actually served.", { applicability: "business_specific", applicabilityRules: { requiredCanonicalFacts: ["serviceAreas"] }, controlOwner: "shared" }),
  criterion("local_content.vertical_requirements", "content_intent_coverage", "Vertical-specific customer questions are covered", "minor", "Missing category-specific details force customers to call for basic qualification.", "Cover the decision criteria customers expect for this business category.", { applicability: "vertical", evaluatorType: "model", scoreEligible: false, publicEligible: false, topics: ["vertical", "decision_support"] }),
  criterion("content.five_second_clarity", "content_intent_coverage", "The business, service, and market are clear within five seconds", "major", "Visitors may leave when the opening does not quickly establish who the business helps and what it offers.", "Make the opening identify the business, primary offer, customer need, and market with a clear action.", { evaluatorType: "model", scoreEligible: false, publicEligible: false, topics: ["clarity", "hero"], scopeUnit: "page", aggregation: "fraction_passing", anchors: { pass: "The complete opening unit makes the business, primary offer, relevant customer need or value, market, and truthful next action immediately clear.", warning: "The opening becomes clear only after reading supporting material, or one important element is vague or weakly prioritized.", fail: "The opening could plausibly belong to many unrelated businesses or leaves the primary offer, market, or next action materially unclear." } }),
  criterion("content.priority_intent_coverage", "content_intent_coverage", "The highest-priority customer intent has a substantive destination", "major", "A missing priority journey leaves the most valuable customer question unanswered.", "Publish and link substantive content for the highest-priority intent in SiteIntent.", { applicability: "business_specific", applicabilityRules: { targets: ["site_artifact", "published_site"] }, evidenceRequirements: ["retained SiteIntent priority slot and rendered semantic route evidence"], scopeUnit: "route_family", aggregation: "any_failure" }),
  criterion("content.decision_support", "content_intent_coverage", "Service content supports a customer decision", "major", "Generic service descriptions do not help customers judge fit, scope, process, or next steps.", "Add specific scope, qualification, process, proof, and next-step information.", { evaluatorType: "model", scoreEligible: false, publicEligible: false, topics: ["service_detail", "decision_support"], scopeUnit: "route_family", aggregation: "fraction_passing", anchors: { pass: "The assessed service routes give customers specific, evidence-grounded help judging fit, scope, process, proof, and next steps.", warning: "The routes provide useful service information but leave one or more important decision questions generic, repetitive, or incomplete.", fail: "The routes are predominantly boilerplate, duplicative, or too thin to help a customer judge fit or take the next step." } }),
  criterion("content.route_family_distinctiveness", "content_intent_coverage", "Route families provide distinct customer value", "major", "A large site built from repeated shells can look complete while giving customers little additional help.", "Give each retained route a distinct customer question, evidence set, or decision-support job; consolidate routes that cannot earn one.", { evaluatorType: "model", scoreEligible: false, publicEligible: false, topics: ["route_family", "distinctiveness", "content_depth"], scopeUnit: "route_family", aggregation: "fraction_passing", anchors: { pass: "Each assessed route earns its existence through a distinct customer question, evidence set, or decision-support purpose.", warning: "Most routes are useful, but some repeat the same structure or argument without enough additional customer value.", fail: "The route family is substantially composed of interchangeable pages whose primary difference is substituted service or location wording." } }),
  criterion("content.hours_presence", "content_intent_coverage", "Verified business hours are available when applicable", "advisory", "Customers may have to leave the site to learn when the business is available.", "Display publish-eligible canonical hours in clear local-time notation.", { applicability: "business_specific", applicabilityRules: { requiredCanonicalFacts: ["hours"] }, controlOwner: "shared", topics: ["hours", "coverage"] }),

  criterion("trust.about", "trust_proof", "The site explains who is behind the business", "minor", "Local customers use people, history, and approach to judge credibility.", "Add a factual about section or page grounded in verified business information.", { controlOwner: "shared" }),
  criterion("trust.proof", "trust_proof", "Credibility proof is visible", "minor", "Without relevant proof, customers have less confidence choosing the business.", "Show verified reviews, credentials, years, affiliations, or work examples without inventing claims.", { applicability: "business_specific", applicabilityRules: { requiredCanonicalFacts: ["proof"] }, controlOwner: "shared" }),
  criterion("research.proof_availability", "trust_proof", "Source research supplied usable verified proof", "advisory", "When research supplies no usable proof, the author has less factual material for reducing customer hesitation.", "Improve source coverage or obtain owner-confirmed proof before making specific credibility claims.", { applicability: "business_specific", controlOwner: "source_research", scoreEligible: false, publicEligible: false, topics: ["source_research", "proof", "input_completeness"] }),
  criterion("trust.proof_specificity", "trust_proof", "Proof is specific and placed near the decision it supports", "major", "Vague or isolated proof does little to reduce hesitation at important decisions.", "Use verified, attributable proof near relevant services and calls to action.", { applicability: "business_specific", applicabilityRules: { requiredCanonicalFacts: ["proof"] }, evaluatorType: "model", controlOwner: "shared", scoreEligible: false, publicEligible: false }),
  criterion("trust.privacy", "trust_proof", "Lead collection is paired with a privacy path", "major", "Collecting personal information without an accessible privacy explanation reduces trust and creates compliance risk.", "Link a clear privacy policy anywhere personal information is collected.", { applicability: "capability", applicabilityRules: { capability: "lead_form" }, controlOwner: "lodesta_platform" }),

  criterion("conversion.contact_path", "conversion_usability", "A direct contact path is available", "critical", "High-intent visitors leave when they cannot quickly call, book, order, or inquire.", "Expose at least one working primary contact action on every important journey.", { releaseDisposition: "blocking", controlOwner: "shared" }),
  criterion("conversion.click_to_call", "conversion_usability", "Phone customers can tap the canonical number to call", "major", "Mobile customers abandon or reach the wrong business when the phone number is absent, inert, or contradictory.", "Expose the verified canonical phone number as a tel: link on mobile.", { applicability: "business_specific", applicabilityRules: { requiredCanonicalFacts: ["phone"] }, controlOwner: "shared", topics: ["phone", "tap_to_call"], evidenceRequirements: ["retained tel-link count and canonical-number match"] }),
  criterion("conversion.primary_action_above_fold", "conversion_usability", "A primary action appears in the first mobile viewport", "major", "Visitors may leave before discovering how to contact or book.", "Place the primary action near the main value proposition.", { evidenceRequirements: ["native mobile viewport action geometry"] }),
  criterion("conversion.service_navigation", "conversion_usability", "Services are represented by navigable destinations", "major", "Customers cannot evaluate fit when offerings are buried on a generic homepage.", "Create and link useful destinations for the business's core offerings."),
  criterion("conversion.contact_page", "conversion_usability", "A contact or location destination is easy to reach", "major", "Customers need a reliable destination for contact details, hours, and directions.", "Publish and link a dedicated contact or location destination."),
  criterion("conversion.mobile_persistent_action", "conversion_usability", "A persistent mobile action is available", "advisory", "A persistent action can shorten the path from evaluation to contact.", "Consider a restrained sticky call, book, or request action on mobile."),

  criterion("copy.opening_specificity", "visual_editorial_craft", "Opening copy is specific to this business", "major", "Generic opening language weakens differentiation and makes otherwise polished work feel generated.", "Use source-earned category, market, customer-situation, proof, or differentiator language that nearby competitors could not adopt unchanged.", { evaluatorType: "human", scoreEligible: false, publicEligible: false, topics: ["copy_quality", "opening", "specificity"], scopeUnit: "page", aggregation: "fraction_passing", evidenceTier: "human", anchors: { pass: "The opening is unmistakably specific to this business and passes the counterfactual-swap test.", warning: "The opening is clear but relies partly on reusable local-business language or underuses available differentiating evidence.", fail: "The opening is primarily generic, slogan-led, or interchangeable with nearby competitors." } }),
  criterion("copy.customer_decision_language", "visual_editorial_craft", "Copy uses concrete customer language and supports decisions", "major", "Polished but vague copy can increase reading without reducing customer uncertainty.", "Use ordinary customer situations and concrete scope, process, proof, and next-step language.", { evaluatorType: "human", scoreEligible: false, publicEligible: false, topics: ["copy_quality", "decision_support", "customer_language"], scopeUnit: "route_family", aggregation: "fraction_passing", evidenceTier: "human", anchors: { pass: "The assessed routes use concrete customer language and answer the questions needed to judge fit and act.", warning: "The copy is readable and accurate but leaves recurring decision questions vague or relies on broad process language.", fail: "The copy is dominated by internal, abstract, repetitive, or promotional language that does not help customers decide." } }),
  criterion("copy.cross_route_coherence", "visual_editorial_craft", "Copy remains coherent without becoming repetitive across routes", "minor", "Voice drift and repeated arguments make a multi-page site feel assembled rather than authored.", "Maintain one recognizable voice while giving each route a distinct message and purpose.", { evaluatorType: "human", scoreEligible: false, publicEligible: false, topics: ["copy_quality", "route_family", "coherence"], scopeUnit: "route_family", aggregation: "fraction_passing", evidenceTier: "human", anchors: { pass: "The route family has a coherent voice and argument while each route contributes distinct, useful language.", warning: "Voice is mostly consistent, but several routes repeat phrasing, structure, or calls to action too closely.", fail: "The site shows material voice drift or extensive repeated copy across important routes." } }),
  criterion("copy.action_truthfulness", "visual_editorial_craft", "Calls to action are specific and capability-truthful", "major", "An attractive but unsupported action misleads high-intent customers at the point of conversion.", "Name the real next step and bind it to an available call, form, booking, ordering, or approved external destination.", { evaluatorType: "human", scoreEligible: false, publicEligible: false, topics: ["copy_quality", "cta", "capability"], scopeUnit: "capability", aggregation: "any_failure", evidenceTier: "human", anchors: { pass: "Every assessed primary action names a real, available next step in clear customer language.", warning: "Actions are truthful but one or more labels are generic, weakly prioritized, or imprecise about the next step.", fail: "A primary action implies an unavailable capability, destination, timing, outcome, or transaction." } }),
];

const duplicateAgentIds = new Set([
  "agent.basic.home_reachable",
  "agent.basic.https",
  "agent.discoverability.robots",
  "agent.discoverability.sitemap"
]);

const agentCriteria = agentReadinessCheckDefinitions
  .filter((definition) => !duplicateAgentIds.has(definition.id))
  .map((definition) => criterion(
    definition.id,
    agentDimension(definition.groupId, definition.id),
    definition.title,
    definition.impact,
    definition.businessConsequence,
    definition.recommendation,
    {
      applicability: definition.applicability,
      evaluatorType: definition.groupId === "answer_quality" ? "model" : "deterministic",
      controlOwner: "shared",
      scoreEligible: false,
      publicEligible: false,
      topics: ["agent_readiness", definition.groupId],
      applicabilityRules: definition.applicability === "capability"
        ? { capability: definition.groupId }
        : undefined
    }
  ));

const visualCriteria = visualQualityCheckDefinitions.map((definition) => criterion(
  definition.id,
  "visual_editorial_craft",
  definition.title,
  definition.impact,
  definition.businessConsequence,
  definition.recommendation,
  {
    applicability: definition.applicability,
    evaluatorType: "model",
    scoreEligible: false,
    publicEligible: false,
    topics: ["visual_quality", definition.groupId],
    evidenceRequirements: ["native viewport-framed screenshot evidence", "criterion-level calibrated evaluator"]
  }
));

export const assessmentCriteria: ReadonlyArray<AssessmentCriterionDefinition> = [
  ...baseCriteria,
  ...agentCriteria,
  ...visualCriteria
] as const;

const duplicateCriterionIds = duplicates(assessmentCriteria.map((definition) => definition.id));
if (duplicateCriterionIds.length) {
  throw new Error(`Duplicate website health criterion IDs: ${duplicateCriterionIds.join(", ")}`);
}
const dimensionWeightTotal = assessmentDimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
if (dimensionWeightTotal !== 100) {
  throw new Error(`Website health dimension weights must total 100; received ${dimensionWeightTotal}.`);
}

export const artifactAssessmentCalibrationManifest = {
  version: "artifact-calibration@2026-07-27",
  readableText: "computed browser font-size and line-length measurements take precedence",
  serviceDetail: "substantive distinct semantic service routes without thin or repetitive-content findings",
  imageAlt: "descriptive retained rendered evidence; non-empty alone receives no credit",
  objectiveFunctionalFindings: [
    "render.managed_content_clipped",
    "render.empty_control",
    "functional.navigation_reachability"
  ],
  navigationReachability: {
    releaseDisposition: "advisory",
    disclosureDestinationScope: "primary navigation links plus links revealed within header disclosures and declared header menus",
    promotionRequires: "all retained current-toolchain artifacts plus fixture corpus; all known failures detected and zero manually labeled false blocks"
  },
  visualInference: "unscored until criterion-level calibration identity is present",
  orphanRoutes: "advisory",
  fieldMetricsWithoutIndependentEvidence: "unknown"
} as const;

export const websiteAssessmentRubricIdentity = contentIdentity("website-health-rubric", {
  dimensions: assessmentDimensions,
  criteria: assessmentCriteria,
  scoringPolicy: websiteAssessmentScoringPolicy,
  artifactCalibration: artifactAssessmentCalibrationManifest
});

export const websiteAssessmentScannerManifest = {
  detector: "canonical-website-health-scanner",
  routeSelection: websiteHealthRouteSelectionPolicy,
  artifactCalibration: artifactAssessmentCalibrationManifest,
  artifactInterpretation: {
    semanticRoutePurpose: "declared intent path, then retained offering bindings and route title/path semantics",
    phoneConsistency: "retained tap-to-call observations and contradictory tel links only",
    hoursConsistency: "canonical-hours-specific contradiction evidence only",
    structuredDataConsistency: "platform structured-data bindings and structured-data-specific mismatch evidence only"
  },
  visualQuality: {
    methodologyIdentity: visualQualityMethodologyIdentity,
    evaluatorIdentity: visualQualityEvaluatorIdentity,
    promptIdentity: visualQualityPromptIdentity,
    viewports: websiteHealthRouteSelectionPolicy.viewportPolicy,
    frames: websiteHealthRouteSelectionPolicy.framePolicy,
    deterministicMeasurements: [
      "font_size",
      "line_length",
      "contrast",
      "overflow",
      "clipping",
      "overlap",
      "target_size",
      "hit_testing",
      "primary_heading_action_geometry",
      "cross_viewport_presence_order"
    ],
    deterministicPrecedence: true,
    modelScope: [
      "hierarchy",
      "composition",
      "brand_coherence",
      "imagery_treatment",
      "density",
      "pacing",
      "distinctiveness",
      "residual_polish"
    ],
    malformedFullPageStripsRejected: true,
    modelFailureIsAdvisory: true
  },
  readiness: {
    methodologyIdentity: agentReadinessMethodologyIdentity,
    maximumDedicatedSameOriginProbes: 12,
    maximumResponseBytes: 65_536,
    requestTimeoutMs: 10_000,
    requestStartSpacingMs: 500,
    maximumRedirects: 5
  }
} as const;

export const websiteAssessmentScannerIdentity = contentIdentity(
  "website-health-scanner",
  websiteAssessmentScannerManifest
);
export const websiteAssessmentProducerIdentity = contentIdentity("lodesta-website-health", {
  rubricIdentity: websiteAssessmentRubricIdentity,
  scannerIdentity: websiteAssessmentScannerIdentity,
  routeSelectionIdentity: websiteHealthRouteSelectionIdentity
});

export function criterionDefinition(id: string) {
  const definition = assessmentCriteria.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown website health criterion: ${id}`);
  return definition;
}

function agentDimension(groupId: string, id: string): AssessmentDimensionId {
  if (id === "agent.answer.entity_consistency") return "business_truth";
  if (groupId === "answer_quality") return "content_intent_coverage";
  return "search_answer_discoverability";
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicatesFound = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicatesFound.add(value);
    seen.add(value);
  }
  return [...duplicatesFound];
}

function defaultScopeUnit(id: string): AssessmentScopeUnit {
  if (/form|booking|ordering|protocol|commerce|capability/.test(id)) return "capability";
  if (/route|service_detail|service_navigation|intent_coverage/.test(id)) return "route_family";
  if (/render|responsive|mobile|typography|heading|image|title|description|visual/.test(id)) return "page";
  return "site";
}

function defaultAggregation(
  scopeUnit: AssessmentScopeUnit,
  evaluatorType: AssessmentEvaluatorType
): AssessmentAggregation {
  if (scopeUnit === "site" || scopeUnit === "capability") return "site_wide";
  return evaluatorType === "deterministic" ? "any_failure" : "fraction_passing";
}

function defaultEvidenceTier(id: string, evaluatorType: AssessmentEvaluatorType): AssessmentEvidenceTier {
  if (evaluatorType === "human") return "human";
  if (evaluatorType === "model") return "model";
  if (/render|responsive|mobile|images_load|browser|axe|heading|form_labels|navigation_reachability/.test(id)) {
    return "browser";
  }
  return "deterministic";
}

function defaultAnchors(title: string, recommendation: string) {
  return {
    pass: `Retained evidence supports the criterion: ${title}.`,
    warning: `Retained evidence shows a limited or inconsistent opportunity. ${recommendation}`,
    fail: `Retained evidence shows a clear material failure. ${recommendation}`
  };
}

function contentIdentity(name: string, value: unknown) {
  return `${name}@sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
