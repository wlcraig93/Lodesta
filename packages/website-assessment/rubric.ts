import { createHash } from "node:crypto";
import type {
  AssessmentApplicability,
  AssessmentDimensionId,
  AssessmentImpact
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

export const minimumScoreCoverage = 0.7;
export const minimumVerticalConfidence = 0.8;
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
  { id: "functional_integrity", label: "Functional integrity", weight: 15 },
  { id: "mobile_performance", label: "Mobile performance", weight: 15 },
  { id: "discoverability", label: "Search discoverability", weight: 15 },
  { id: "conversion", label: "Conversion readiness", weight: 20 },
  { id: "local_content", label: "Local content depth", weight: 15 },
  { id: "trust", label: "Trust and credibility", weight: 10 },
  { id: "automated_accessibility", label: "Automated accessibility", weight: 10 }
] as const;

export type AssessmentCriterionDefinition = {
  id: string;
  dimensionId: AssessmentDimensionId;
  title: string;
  impact: AssessmentImpact;
  applicability: AssessmentApplicability;
  businessConsequence: string;
  recommendation: string;
  points: number;
};

function criterion(
  id: string,
  dimensionId: AssessmentDimensionId,
  title: string,
  impact: AssessmentImpact,
  businessConsequence: string,
  recommendation: string,
  points = 1,
  applicability: AssessmentApplicability = "universal"
): AssessmentCriterionDefinition {
  return { id, dimensionId, title, impact, applicability, businessConsequence, recommendation, points };
}

export const assessmentCriteria: ReadonlyArray<AssessmentCriterionDefinition> = [
  criterion("functional.home_reachable", "functional_integrity", "Homepage returns a usable response", "critical", "Customers and search engines cannot use a site that does not load.", "Restore a successful HTTPS response for the canonical homepage.", 2),
  criterion("functional.https", "functional_integrity", "The website is served over HTTPS", "critical", "An insecure connection triggers browser warnings, weakens trust, and can expose customer data.", "Serve every public route over HTTPS and redirect HTTP requests to the canonical secure URL.", 2),
  criterion("functional.internal_destinations", "functional_integrity", "Internal links reach valid destinations", "critical", "Broken internal paths interrupt customer journeys and waste search-engine crawl capacity.", "Repair or redirect every broken internal destination.", 2),
  criterion("functional.primary_external_destinations", "functional_integrity", "Primary booking and ordering links work", "major", "A broken booking or ordering handoff loses customers at the point of intent.", "Replace or repair unavailable primary external destinations."),
  criterion("functional.images_load", "functional_integrity", "Visible images load", "major", "Broken imagery weakens credibility and can hide important service information.", "Replace missing image sources and verify each responsive image variant."),
  criterion("functional.browser_errors", "functional_integrity", "Pages avoid material browser errors", "minor", "Browser errors can signal hidden interaction failures and create an unreliable experience.", "Resolve recurring console and page errors on customer-facing routes."),
  criterion("functional.form_path", "functional_integrity", "Lead forms expose a valid submission path", "critical", "A form that cannot submit silently loses high-intent leads.", "Use a validated Lodesta form binding or a verified first-party submission endpoint.", 2),

  criterion("performance.mobile_viewport", "mobile_performance", "Pages declare a mobile viewport", "major", "Without a mobile viewport, pages render poorly on phones.", "Add a responsive viewport declaration to every page."),
  criterion("performance.mobile_overflow", "mobile_performance", "Mobile pages avoid horizontal overflow", "major", "Horizontal scrolling hides content and makes the site feel broken.", "Constrain wide elements and verify the layout at phone widths."),
  criterion("performance.readable_text", "mobile_performance", "Mobile body text is readable", "minor", "Small text makes service details and calls to action harder to use.", "Keep essential mobile text at a readable size and line length."),
  criterion("performance.lcp", "mobile_performance", "Largest Contentful Paint is healthy", "major", "Slow primary content increases abandonment before customers understand the offer.", "Reduce server delay, image weight, and render-blocking work to bring LCP within 2.5 seconds.", 2),
  criterion("performance.inp", "mobile_performance", "Interaction to Next Paint is healthy", "major", "Sluggish interactions make calls, menus, and forms feel unresponsive.", "Reduce long main-thread tasks and third-party script work to bring INP within 200 ms."),
  criterion("performance.cls", "mobile_performance", "Cumulative Layout Shift is healthy", "major", "Unexpected movement causes mis-clicks and undermines trust.", "Reserve media dimensions and stabilize late-loading content to keep CLS within 0.1."),

  criterion("discoverability.title", "discoverability", "Pages use descriptive titles", "major", "Weak or missing titles make pages harder to understand in search results.", "Give each important page a specific title describing the service and market."),
  criterion("discoverability.meta_description", "discoverability", "Pages provide useful search descriptions", "minor", "Missing descriptions reduce control over how the business is presented in search.", "Write a distinct, useful description for each important page."),
  criterion("discoverability.canonical", "discoverability", "The homepage declares a canonical URL", "minor", "Ambiguous canonical URLs can split indexing signals.", "Declare the preferred canonical HTTPS URL."),
  criterion("discoverability.robots", "discoverability", "robots.txt is available and permits the assessed page", "major", "Accidental crawl restrictions can keep the site out of search.", "Publish a valid robots.txt and allow important public routes."),
  criterion("discoverability.sitemap", "discoverability", "An XML sitemap is discoverable", "minor", "A sitemap helps search engines consistently discover service and location pages.", "Publish and reference an XML sitemap containing canonical public routes."),
  criterion("discoverability.local_schema", "discoverability", "Local business structured data is present", "minor", "Missing structured data makes business identity and local facts harder for search engines to interpret.", "Add accurate LocalBusiness-compatible JSON-LD bound to verified business facts."),

  criterion("conversion.contact_path", "conversion", "A direct contact path is available", "critical", "High-intent visitors leave when they cannot quickly call, book, order, or inquire.", "Expose at least one working primary contact action on every important journey.", 2),
  criterion("conversion.click_to_call", "conversion", "Phone customers can tap to call", "major", "Mobile customers abandon when a displayed phone number is not directly actionable.", "Expose the verified business phone number as a tel: link on mobile.", 1, "business_specific"),
  criterion("conversion.primary_action_above_fold", "conversion", "A primary action appears in the first mobile viewport", "major", "Visitors may leave before discovering how to contact or book.", "Place the primary action near the main value proposition."),
  criterion("conversion.service_navigation", "conversion", "Services are represented by navigable pages", "major", "Customers cannot evaluate fit when offerings are buried on a generic homepage.", "Create and link useful service pages for the business's core offerings.", 2),
  criterion("conversion.contact_page", "conversion", "A contact or location page is easy to reach", "major", "Customers need a reliable destination for contact details, hours, and directions.", "Publish and link a dedicated contact or location page."),
  criterion("conversion.mobile_persistent_action", "conversion", "A persistent mobile action is available", "advisory", "A persistent action can shorten the path from evaluation to contact.", "Consider a restrained sticky call, book, or request action on mobile."),

  criterion("local_content.service_detail", "local_content", "Core services have substantive detail", "major", "Thin service coverage gives customers and search engines little reason to choose the business.", "Explain scope, customer fit, process, and differentiators for each core service.", 2),
  criterion("local_content.location_clarity", "local_content", "The primary service location or area is clear", "major", "Customers cannot confidently act if they are unsure whether the business serves them.", "State the verified location or service area in prominent site content."),
  criterion("local_content.service_area_depth", "local_content", "Local service coverage is specific", "minor", "Generic location mentions do not answer local intent or establish market relevance.", "Add factual, non-duplicative content for the markets actually served.", 1, "business_specific"),
  criterion("local_content.vertical_requirements", "local_content", "Vertical-specific customer questions are covered", "minor", "Missing category-specific details force customers to call for basic qualification.", "Cover the decision criteria customers expect for this business category.", 1, "vertical"),

  criterion("trust.business_identity", "trust", "Business identity and contact facts are visible", "major", "Unclear business identity makes the site feel anonymous or unreliable.", "Display verified business name and contact facts consistently."),
  criterion("trust.about", "trust", "The site explains who is behind the business", "minor", "Local customers use people, history, and approach to judge credibility.", "Add a factual about section or page grounded in verified business information."),
  criterion("trust.proof", "trust", "Credibility proof is visible", "minor", "Without relevant proof, customers have less confidence choosing the business.", "Show verified reviews, credentials, years, affiliations, or work examples without inventing claims."),
  criterion("trust.privacy", "trust", "Lead collection is paired with a privacy path", "major", "Collecting personal information without an accessible privacy explanation reduces trust and creates compliance risk.", "Link a clear privacy policy anywhere personal information is collected."),

  criterion("accessibility.axe_critical", "automated_accessibility", "No critical automated accessibility violations are detected", "critical", "Critical accessibility barriers can prevent customers from completing core tasks.", "Resolve every critical automated accessibility violation and verify with assistive technology.", 2),
  criterion("accessibility.axe_serious", "automated_accessibility", "No serious automated accessibility violations are detected", "major", "Serious accessibility defects make important content or controls unusable for some customers.", "Resolve serious automated violations, prioritizing forms, navigation, contrast, and names.", 2),
  criterion("accessibility.image_alt", "automated_accessibility", "Meaningful images provide alternative text", "major", "Missing alternative text hides useful information from screen-reader users.", "Add concise alternative text to meaningful images and empty alt text to decorative images."),
  criterion("accessibility.heading_structure", "automated_accessibility", "Headings form a usable page outline", "minor", "A weak outline makes pages harder to navigate with assistive technology.", "Use one descriptive primary heading and a logical nested heading order."),
  criterion("accessibility.form_labels", "automated_accessibility", "Form controls have accessible names", "critical", "Unlabelled fields prevent some customers from completing an inquiry.", "Associate every field with a visible label or an equivalent accessible name.", 2)
] as const;

export const artifactAssessmentCalibrationManifest = {
  version: "artifact-calibration@2026-07-24",
  readableText: {
    pass: "current retained browser evidence with no sub-16px body/control finding",
    warning: "retained sub-16px body/control finding",
    tinyTextReportingPx: 12,
    sampleSpecificFailureFloor: false
  },
  serviceDetail: "substantive distinct service routes without thin or repetitive-content findings",
  imageAlt: "descriptive retained rendered evidence; non-empty alone receives no credit",
  objectiveFunctionalFindings: ["render.managed_content_clipped", "render.empty_control"],
  orphanRoutes: "advisory",
  fieldMetricsWithoutIndependentEvidence: "unknown"
} as const;

export const websiteAssessmentRubricIdentity = contentIdentity("local-business-rubric", {
  dimensions: assessmentDimensions,
  criteria: assessmentCriteria,
  artifactCalibration: artifactAssessmentCalibrationManifest,
  agentReadiness: agentReadinessCheckDefinitions,
  visualQuality: visualQualityCheckDefinitions
});
export const websiteAssessmentScannerManifest = {
  detector: "canonical-public-and-artifact-scanner",
  artifactCalibration: artifactAssessmentCalibrationManifest,
  visualQuality: {
    methodologyIdentity: visualQualityMethodologyIdentity,
    evaluatorIdentity: visualQualityEvaluatorIdentity,
    promptIdentity: visualQualityPromptIdentity,
    maximumRoutes: 3,
    screenshotViewports: ["desktop", "mobile"],
    homepageMeasurementViewports: ["desktop", "tablet", "mobile"],
    singleBoundedModelRequest: true,
    maximumContactSheetWidth: 1_600,
    maximumContactSheetHeight: 4_096,
    maximumImageBytes: 20_000_000,
    modelFailureIsAdvisory: true,
    publicFindingMinimumConfidence: 0.9
  },
  readiness: {
    maximumDedicatedSameOriginProbes: 12,
    reusedResources: ["robots_txt", "html_home"],
    requestedResources: [
      "markdown_home",
      "llms_txt",
      "web_bot_auth",
      "agent_skills",
      "api_catalog",
      "oauth_authorization_server",
      "oauth_protected_resource",
      "mcp_server_card",
      "ucp",
      "acp"
    ],
    maximumResponseBytes: 65_536,
    requestTimeoutMs: 10_000,
    requestStartSpacingMs: 500,
    maximumRedirects: 5,
    protocolDocuments: "content-type-and-bounded-schema-validated",
    markdownParity: { pass: 0.8, warning: 0.5 },
    semanticContentSource: "initial-html-response",
    directAnswersRequireQuestionSignals: true,
    blockedAnswerAndUserTriggeredAgentsAreMajorFindings: true,
    inferredPublicFindingMinimumConfidence: 0.85,
    capabilityChecksDefaultToNotApplicable: true,
    commerceRequiresOnDomainTransaction: true
  }
} as const;
export const websiteAssessmentScannerIdentity = contentIdentity("website-assessment-scanner", {
  methodologyIdentity: agentReadinessMethodologyIdentity,
  visualQualityMethodologyIdentity,
  visualQualityEvaluatorIdentity,
  manifest: websiteAssessmentScannerManifest
});
export const websiteAssessmentProducerIdentity = contentIdentity("lodesta-website-assessment", {
  rubricIdentity: websiteAssessmentRubricIdentity,
  scannerIdentity: websiteAssessmentScannerIdentity
});

export function criterionDefinition(id: string) {
  const definition = assessmentCriteria.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown website assessment criterion: ${id}`);
  return definition;
}

function contentIdentity(name: string, value: unknown) {
  return `${name}@sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
