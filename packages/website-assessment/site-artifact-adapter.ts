import type { SiteBuildArtifact, SitePublicBuildInput } from "@/packages/site-contracts";
import type {
  AssessmentCriterionInput,
  AssessmentCriterionStatus,
  AssessmentEvidence,
  VisualQuality,
  WebsiteAssessment
} from "./contracts";
import { buildWebsiteAssessment } from "./engine";
import { criterionDefinition } from "./rubric";
import { agentReadinessForArtifact } from "./agent-readiness-adapters";
import { evaluateArtifactVisualQuality } from "./visual-quality-artifact";
import { siteToolchainIdentity } from "@/packages/site-contracts/platform-manifest";
import {
  selectArtifactVisualRoutes
} from "./route-selection";
import { artifactVertical } from "./visual-quality-artifact";
import { siteInventoryForArtifact } from "./site-inventory";
import {
  assessmentReferenceAuthorityFor,
  assessmentServingContractFor
} from "./comparability";

export async function assessSiteArtifact(input: {
  artifact: SiteBuildArtifact;
  buildInput: SitePublicBuildInput;
  versionId?: string;
  assessmentId?: string;
  visualQuality?: VisualQuality;
  signal?: AbortSignal;
}): Promise<WebsiteAssessment> {
  const { artifact, buildInput } = input;
  if (artifact.publicBuildInputId !== buildInput.id) {
    throw new Error("Artifact assessment requires the exact public build input used at finalization.");
  }
  const generatedAt = new Date().toISOString();
  const findings = artifact.qa.findings;
  const finding = (pattern: RegExp) => findings.filter((item) => pattern.test(`${item.id} ${item.message}`));
  const declaredRoutePurposes = new Map(buildInput.intent.pageRequirements.map((route) => [
    route.slug ? `/${route.slug}` : "/",
    route.purpose
  ]));
  const routeBindings = new Map(artifact.routes.map((route) => [
    route.path,
    artifact.factBindings.filter((binding) => binding.route === route.path)
  ]));
  const routePurposes = new Map(artifact.routes.map((route) => [
    route.path,
    semanticRoutePurpose({
      path: route.path,
      title: route.title,
      declaredPurpose: declaredRoutePurposes.get(route.path),
      sourceFactIds: (routeBindings.get(route.path) ?? []).flatMap((binding) => binding.sourceFactIds),
      buildInput
    })
  ]));
  const serviceRoutes = artifact.routes.filter((route) => routePurposes.get(route.path) === "service");
  const aboutRoutes = artifact.routes.filter((route) =>
    routePurposes.get(route.path) === "about"
    || /(?:^|\/)about(?:\/|$)/i.test(route.path)
    || /\babout\b/i.test(route.title));
  const contactRoutes = artifact.routes.filter((route) =>
    ["contact", "location"].includes(routePurposes.get(route.path) ?? "")
    || /(?:^|\/)(?:contact|location)(?:\/|$)/i.test(route.path)
    || /\b(?:contact|location)\b/i.test(route.title));
  const formBindings = artifact.capabilityBindings.filter((binding) => binding.kind === "form");
  const verifiedContactValues = [buildInput.business.contacts.phone, buildInput.business.contacts.email].filter((value): value is string => Boolean(value));
  const renderedContactBindings = artifact.factBindings.filter((binding) => verifiedContactValues.some((value) => contactValueMatches(binding.text, value)));
  const screenshotKey = artifact.qa.screenshotKeys.find((key) => /mobile/i.test(key)) ?? artifact.qa.screenshotKeys[0];
  const screenshotExtra = screenshotKey ? { artifactKey: screenshotKey } : {};
  const currentBrowserEvidence = artifact.toolchainVersion === siteToolchainIdentity
    && artifact.qa.routesChecked > 0
    && artifact.qa.screenshotKeys.length > 0;
  const browserRuntimeFindings = finding(/render\.(?:console|page_error)/);
  const navigationFindings = finding(/functional\.navigation_reachability/);
  const navigationFailures = navigationFindings.filter((item) => /not reachable/i.test(item.message));
  const telEvidence = finding(/render\.tel_links/);
  const telCounts = telEvidence.reduce((total, item) => {
    const match = item.message.match(/links[^:]*:\s*(\d+).*matches:\s*(\d+)/i);
    return {
      total: total.total + Number(match?.[1] ?? 0),
      matches: total.matches + Number(match?.[2] ?? 0)
    };
  }, { total: 0, matches: 0 });
  const brokenLinkFindings = findings.filter((item) => item.id.startsWith("link."));
  const brokenImageFindings = artifactBrokenImageFindings(findings);
  const headingStructureFindings = artifactHeadingStructureFindings(findings);
  const axeCompleted = findings.some((item) => item.id === "accessibility.axe.complete");
  const orphanFindings = finding(/route\.orphan/);
  const serviceQualityFindings = finding(/route\.(?:thin_service_content|repetitive_content)|fact\.service_detail_source/);
  const altQualityFindings = finding(/render\.image_alt_quality/);
  const targetSizeFindings = finding(/render\.target_size/);
  const clippingOverlapFindings = finding(/render\.clipping_overlap/);
  const mobileGeometryFindings = finding(/render\.primary_geometry/)
    .filter((item) => /viewport:\s*mobile/i.test(item.message));
  const mobilePrimaryActionAboveFold = mobileGeometryFindings.length > 0
    && mobileGeometryFindings.every((item) => /primary action above fold:\s*true/i.test(item.message));
  const titleFailures = artifact.routes.filter((route) => !descriptiveRouteTitle(route.title, buildInput.business.name));
  const uniqueDescriptions = new Set(artifact.routes.map((route) => normalized(route.description)).filter(Boolean));
  const descriptionFailures = artifact.routes.filter((route) => route.description.trim().length < 50);
  const visibleArtifactText = artifact.factBindings.map((binding) => binding.text).join(" ");
  const visibleProof = /\b(?:review|testimonial|licensed|insured|certified|award|guarantee|warranty|founded|years? (?:of |in )?experience|family[- ]owned|accredit)\b/i.test(visibleArtifactText);
  const hourFactIds = new Set(buildInput.publicFacts.filter((fact) => fact.kind === "hours").map((fact) => fact.id));
  const renderedHoursBindings = artifact.factBindings.filter((binding) =>
    binding.origin === "sdk" && binding.sourceFactIds.some((factId) => hourFactIds.has(factId))
  );
  const phoneMismatchFindings = findings.filter((item) =>
    item.id === "fact.link_mismatch" && /\btel:/i.test(item.message));
  const hoursMismatchFindings = findings.filter((item) =>
    /^fact\.(?:sdk_value_mismatch|sensitive_unsupported|metadata_unsupported)$/.test(item.id)
    && /\b(?:hours?|opening|availability|24\s*\/\s*7|24 hours?)\b/i.test(item.message));
  const structuredDataMismatchFindings = findings.filter((item) =>
    /^fact\.structured_data_(?:missing|mismatch)$/.test(item.id));
  const unsupportedClaimFindings = findings.filter((item) =>
    /^fact\.(?:link_mismatch|sdk_fact_missing|sdk_value_mismatch|sensitive_unsupported|metadata_unsupported)$/.test(item.id));
  const unboundClaimFindings = findings.filter((item) =>
    item.id === "fact.undeclared_marker");
  const routeSelection = selectArtifactVisualRoutes(
    artifact.routes,
    buildInput.intent.pageRequirements
  );
  const criteria: AssessmentCriterionInput[] = [
    artifactResult("trust.business_identity", buildInput.business.name && (buildInput.business.contacts.phone || buildInput.business.contacts.email || buildInput.business.locations.length) ? "pass" : "warning", artifact, generatedAt, `Verified business identity: ${buildInput.business.name}; public contact or location facts: ${Boolean(buildInput.business.contacts.phone || buildInput.business.contacts.email || buildInput.business.locations.length)}.`),
    artifactResult(
      "truth.phone_consistency",
      !buildInput.business.contacts.phone ? "not_applicable" : phoneMismatchFindings.length ? "fail" : telCounts.total === 0 ? "warning" : telCounts.matches === telCounts.total ? "pass" : "fail",
      artifact,
      generatedAt,
      !buildInput.business.contacts.phone
        ? "No publish-eligible canonical phone fact was available."
        : `${telCounts.matches} of ${telCounts.total} retained tap-to-call observations matched the canonical phone number; ${phoneMismatchFindings.length} contradictory phone-link finding(s) were recorded.`
    ),
    artifactResult(
      "truth.hours_consistency",
      hourFactIds.size === 0 ? "not_applicable" : hoursMismatchFindings.length ? "fail" : "pass",
      artifact,
      generatedAt,
      hourFactIds.size === 0
        ? "No publish-eligible canonical hours fact was available."
        : `${hoursMismatchFindings.length} rendered-hours contradiction finding(s) were recorded against ${hourFactIds.size} canonical hours fact(s).`
    ),
    artifactResult(
      "truth.structured_data_consistency",
      structuredDataMismatchFindings.length ? "fail" : artifact.factBindings.some((binding) => binding.origin === "structured_data") ? "pass" : "warning",
      artifact,
      generatedAt,
      `${artifact.factBindings.filter((binding) => binding.origin === "structured_data").length} source-bound structured-data binding(s) and ${structuredDataMismatchFindings.length} structured-data mismatch finding(s) were retained.`
    ),
    artifactResult(
      "release.claim_binding",
      unsupportedClaimFindings.length ? "fail" : unboundClaimFindings.length ? "warning" : "pass",
      artifact,
      generatedAt,
      `${unsupportedClaimFindings.length} unsupported or contradictory factual claim finding(s) and ${unboundClaimFindings.length} unbound factual marker finding(s) were retained.`
    ),
    gateResult("functional.home_reachable", artifact.routes.some((route) => route.path === "/") && !finding(/route\.response/).length ? "pass" : "fail", artifact, generatedAt, "The finalized artifact contains a homepage and its browser gate returned a usable response.", "The homepage route or its browser response failed."),
    gateResult("functional.https", "unknown", artifact, generatedAt, "", "HTTPS is enforced at the public hostname boundary and cannot be proven from this unpublished artifact alone."),
    gateResult("functional.internal_destinations", artifact.qa.linksChecked > 0 && !brokenLinkFindings.length && !orphanFindings.length ? "pass" : brokenLinkFindings.length ? "fail" : artifact.qa.linksChecked || orphanFindings.length ? "warning" : "unknown", artifact, generatedAt, `${artifact.qa.linksChecked} link destination(s) passed the artifact browser gate.`, `${brokenLinkFindings.length} broken link finding(s) and ${orphanFindings.length} orphan-route advisory finding(s) were recorded.`),
    gateResult(
      "functional.navigation_reachability",
      navigationFailures.length ? "fail" : navigationFindings.length ? "pass" : "unknown",
      artifact,
      generatedAt,
      `${navigationFindings.length} route and viewport navigation-reachability observation(s) passed.`,
      navigationFailures.length
        ? `${navigationFailures.length} route and viewport navigation-reachability observation(s) failed.`
        : "The retained artifact predates interactive navigation-reachability evidence."
    ),
    gateResult("functional.primary_external_destinations", "unknown", artifact, generatedAt, "", "The retained artifact gate did not independently probe third-party destinations."),
    gateResult("functional.images_load", brokenImageFindings.length ? "fail" : "pass", artifact, generatedAt, "No broken image or asset finding was recorded across browser-gated routes.", `${brokenImageFindings.length} broken image or asset finding(s) were recorded.`),
    gateResult(
      "functional.browser_errors",
      browserRuntimeFindings.length ? "warning" : "pass",
      artifact,
      generatedAt,
      "No browser console or page error was recorded.",
      `${browserRuntimeFindings.length} browser runtime finding(s) were recorded.`
    ),
    gateResult("functional.form_path", formBindings.length === 0 ? "not_applicable" : finding(/capability\.form/).length ? "fail" : "pass", artifact, generatedAt, `${formBindings.length} managed form binding(s) passed static capability verification.`, `${finding(/capability\.form/).length} managed form capability finding(s) were recorded.`),

    gateResult("performance.mobile_viewport", "pass", artifact, generatedAt, "The trusted document compiler includes the responsive viewport contract.", ""),
    gateResult("performance.mobile_overflow", finding(/render\.(?:horizontal_overflow|mobile_navigation_overflow)/).length ? "fail" : "pass", artifact, generatedAt, "No page or primary-navigation overflow was recorded at the artifact browser-gate viewports.", `${finding(/render\.(?:horizontal_overflow|mobile_navigation_overflow)/).length} page or primary-navigation overflow finding(s) were recorded.`, screenshotExtra),
    gateResult(
      "performance.readable_text",
      finding(/render\.body_font/).length ? "warning" : currentBrowserEvidence ? "pass" : "unknown",
      artifact,
      generatedAt,
      "No retained body/control copy finding below the 16px product readability target was recorded.",
      finding(/render\.body_font/).length
        ? `${finding(/render\.body_font/).length} retained body-font advisory finding(s) were recorded.`
        : "This retained artifact predates the current readable-text browser evidence."
    ),
    gateResult(
      "responsive.target_size",
      targetSizeFindings.length ? "warning" : currentBrowserEvidence ? "pass" : "unknown",
      artifact,
      generatedAt,
      "No essential control below the 44×44px mobile target was recorded.",
      targetSizeFindings.length
        ? `${targetSizeFindings.length} retained target-size finding(s) were recorded.`
        : "This retained artifact predates target-geometry evidence.",
      screenshotExtra
    ),
    gateResult(
      "responsive.no_clipping_overlap",
      clippingOverlapFindings.length ? "fail" : currentBrowserEvidence ? "pass" : "unknown",
      artifact,
      generatedAt,
      "No important clipping or essential-control hit-test failure was recorded.",
      clippingOverlapFindings.length
        ? `${clippingOverlapFindings.length} retained clipping or hit-test finding(s) were recorded.`
        : "This retained artifact predates clipping and hit-test evidence.",
      screenshotExtra
    ),
    gateResult("performance.lcp", "unknown", artifact, generatedAt, "", "This ingestion-time artifact assessment has no field or independent lab LCP measurement."),
    gateResult("performance.inp", "unknown", artifact, generatedAt, "", "This ingestion-time artifact assessment has no field INP measurement."),
    gateResult("performance.cls", "unknown", artifact, generatedAt, "", "This ingestion-time artifact assessment has no field or independent lab CLS measurement."),

    artifactResult("discoverability.title", titleFailures.length ? "warning" : "pass", artifact, generatedAt, `${artifact.routes.length} route title(s) were checked; ${titleFailures.length} were generic, too short, or omitted the business name.`),
    artifactResult("discoverability.meta_description", descriptionFailures.length || uniqueDescriptions.size < artifact.routes.length || finding(/metadata\.description_duplicate/).length ? "warning" : "pass", artifact, generatedAt, `${artifact.routes.length} route description(s) were checked; ${descriptionFailures.length} were short and ${artifact.routes.length - uniqueDescriptions.size} were duplicated.`),
    artifactResult("discoverability.canonical", "unknown", artifact, generatedAt, "Canonical output is resolved at the public runtime boundary, not retained in this artifact assessment."),
    artifactResult("discoverability.robots", "unknown", artifact, generatedAt, "robots.txt behavior is resolved at the public-site boundary, not retained in this artifact assessment."),
    artifactResult("discoverability.sitemap", "unknown", artifact, generatedAt, "Sitemap behavior is resolved at the public-site boundary, not retained in this artifact assessment."),
    artifactResult("discoverability.local_schema", artifact.factBindings.some((binding) => binding.origin === "structured_data") ? "pass" : "fail", artifact, generatedAt, artifact.factBindings.some((binding) => binding.origin === "structured_data") ? "The artifact contains source-bound structured-data facts." : "No source-bound structured-data fact binding was retained."),

    artifactResult(
      "conversion.contact_path",
      formBindings.length || renderedContactBindings.length ? "pass" : verifiedContactValues.length ? "warning" : "fail",
      artifact,
      generatedAt,
      `${formBindings.length} managed form binding(s), ${renderedContactBindings.length} rendered contact fact binding(s), and ${verifiedContactValues.length} verified contact value(s) were checked.`
    ),
    artifactResult(
      "conversion.click_to_call",
      !buildInput.business.contacts.phone ? "not_applicable" : telCounts.matches ? "pass" : telEvidence.length ? "warning" : "unknown",
      artifact,
      generatedAt,
      !buildInput.business.contacts.phone
        ? "No publish-eligible canonical phone fact was available."
        : `${telCounts.total} tap-to-call link observation(s) were retained, including ${telCounts.matches} canonical-number match(es).`
    ),
    gateResult(
      "conversion.primary_action_above_fold",
      mobileGeometryFindings.length ? mobilePrimaryActionAboveFold ? "pass" : "fail" : "unknown",
      artifact,
      generatedAt,
      `${mobileGeometryFindings.length} mobile route measurement(s) retained an above-fold primary action.`,
      mobileGeometryFindings.length
        ? `${mobileGeometryFindings.filter((item) => !/primary action above fold:\s*true/i.test(item.message)).length} mobile route measurement(s) lacked an above-fold primary action.`
        : "The retained artifact predates primary-action geometry evidence.",
      screenshotExtra
    ),
    artifactResult("conversion.service_navigation", serviceRoutes.length >= 2 && !serviceRoutes.some((route) => orphanFindings.some((finding) => finding.route === route.path)) ? "pass" : serviceRoutes.length ? "warning" : "fail", artifact, generatedAt, `${serviceRoutes.length} dedicated service route(s) and ${orphanFindings.length} orphan-route advisory finding(s) were retained.`),
    artifactResult("conversion.contact_page", contactRoutes.length ? "pass" : "warning", artifact, generatedAt, `${contactRoutes.length} contact or location route(s) were retained.`),
    artifactResult("conversion.mobile_persistent_action", "unknown", artifact, generatedAt, "Persistent-action placement is not preserved as deterministic retained evidence."),

    artifactResult("local_content.service_detail", serviceRoutes.length >= 2 && !serviceQualityFindings.length ? "pass" : serviceRoutes.length ? "warning" : "fail", artifact, generatedAt, `${serviceRoutes.length} service route(s) and ${serviceQualityFindings.length} thin, repetitive, or missing-source-detail finding(s) were recorded.`),
    artifactResult("local_content.location_clarity", buildInput.business.locations.length || buildInput.business.serviceAreas.length ? "pass" : "fail", artifact, generatedAt, `${buildInput.business.locations.length} verified location(s) and ${buildInput.business.serviceAreas.length} verified service area(s) were available to the artifact.`),
    artifactResult(
      "local_content.service_area_depth",
      buildInput.business.serviceAreas.length >= 2
          ? "pass"
          : buildInput.business.serviceAreas.length
            ? "warning"
            : "unknown",
      artifact,
      generatedAt,
      `${buildInput.business.serviceAreas.length} verified service area(s) were available; no vertical assumption was applied.`
    ),
    artifactResult(
      "local_content.vertical_requirements",
      "not_applicable",
      artifact,
      generatedAt,
      "Vertical-specific requirements are not imposed by the authoring or assessment pipeline."
    ),
    artifactResult(
      "content.priority_intent_coverage",
      serviceRoutes.length && !serviceQualityFindings.length ? "pass" : serviceRoutes.length ? "warning" : "fail",
      artifact,
      generatedAt,
      `${serviceRoutes.length} semantic service-intent route(s) and ${serviceQualityFindings.length} retained service-content finding(s) were available.`
    ),
    artifactResult(
      "content.hours_presence",
      hourFactIds.size === 0 ? "not_applicable" : renderedHoursBindings.length ? "pass" : "warning",
      artifact,
      generatedAt,
      hourFactIds.size === 0
        ? "No publish-eligible canonical hours fact was available."
        : `${renderedHoursBindings.length} visible source-bound hours binding(s) were retained for ${hourFactIds.size} canonical hours fact(s).`
    ),

    artifactResult("trust.about", aboutRoutes.length ? "pass" : "warning", artifact, generatedAt, `${aboutRoutes.length} about route(s) were retained.`),
    artifactResult("trust.proof", buildInput.business.proof.length || visibleProof ? "pass" : "warning", artifact, generatedAt, `${buildInput.business.proof.length} confirmed proof item(s) and visible first-party proof language=${visibleProof} were available to the artifact.`),
    artifactResult("research.proof_availability", buildInput.business.proof.length ? "pass" : "warning", artifact, generatedAt, buildInput.business.proof.length
      ? `Source preparation supplied ${buildInput.business.proof.length} publish-eligible proof item(s).`
      : "Source preparation supplied no usable publish-eligible proof; rendered proof was assessed separately."),
    artifactResult("trust.privacy", "not_applicable", artifact, generatedAt, formBindings.length === 0 ? "No managed lead form was present." : "Privacy language is a platform-owned publication concern and is not authored or scored in candidate artifacts."),

    gateResult("accessibility.axe_critical", finding(/accessibility\.axe\.critical/).length ? "fail" : finding(/accessibility\.axe\.complete/).length ? "pass" : "unknown", artifact, generatedAt, "No critical axe-core finding was recorded across mobile browser-gated routes.", finding(/accessibility\.axe\.critical/).length ? `${finding(/accessibility\.axe\.critical/).length} critical axe-core finding(s) were recorded.` : "The retained artifact predates axe-core evidence."),
    gateResult("accessibility.axe_serious", finding(/accessibility\.axe\.serious|render\.contrast/).length ? "fail" : finding(/accessibility\.axe\.complete/).length ? "pass" : "unknown", artifact, generatedAt, "No serious axe-core or deterministic contrast finding was recorded across mobile browser-gated routes.", finding(/accessibility\.axe\.serious|render\.contrast/).length ? `${finding(/accessibility\.axe\.serious|render\.contrast/).length} serious accessibility or deterministic contrast finding(s) were recorded.` : "The retained artifact predates axe-core evidence."),
    artifactResult(
      "accessibility.image_alt",
      altQualityFindings.length ? "warning" : currentBrowserEvidence ? "pass" : "unknown",
      artifact,
      generatedAt,
      `Current retained browser evidence was checked for descriptive alt text on rendered business assets; ${altQualityFindings.length} rendered finding(s) were found.`
    ),
    gateResult(
      "accessibility.heading_structure",
      headingStructureFindings.length ? "fail" : axeCompleted ? "pass" : "unknown",
      artifact,
      generatedAt,
      "axe-core completed without a heading-order or primary-heading violation.",
      headingStructureFindings.length
        ? `${headingStructureFindings.length} heading-order or primary-heading violation(s) were recorded.`
        : "The retained artifact predates a complete axe-core heading audit."
    ),
    gateResult("accessibility.form_labels", formBindings.length === 0 ? "not_applicable" : finding(/capability\.form_label/).length ? "fail" : "pass", artifact, generatedAt, "All managed form fields passed the finalizer's label association check.", `${finding(/capability\.form_label/).length} form-label finding(s) were recorded.`)
  ];
  const location = buildInput.business.locations[0];
  const vertical = artifactVertical(artifact, buildInput);
  const agentReadiness = agentReadinessForArtifact({ artifact, buildInput, generatedAt });
  const visualQuality = input.visualQuality ?? await evaluateArtifactVisualQuality({
    artifact,
    buildInput,
    observedAt: generatedAt,
    signal: input.signal
  });
  return buildWebsiteAssessment({
    id: input.assessmentId,
    target: {
      kind: "site_artifact",
      sourceKey: `artifact:${artifact.id}`,
      siteId: artifact.siteId,
      artifactId: artifact.id,
      versionId: input.versionId
    },
    siteUnderstanding: {
      businessName: buildInput.business.name,
      primaryLocation: location ? [location.street, location.city, location.region, location.postalCode].filter(Boolean).join(", ") : buildInput.business.serviceAreas[0]?.label,
      services: buildInput.business.offerings.filter((offering) => offering.status === "confirmed" && offering.visibility === "public").map((offering) => offering.name),
      vertical: vertical.vertical,
      verticalConfidence: vertical.confidence,
      verticalEvidence: vertical.evidence,
      customerJourneys: inferredArtifactJourneys(buildInput)
    },
    canonicalFactAvailability: {
      businessName: Boolean(buildInput.business.name),
      phone: Boolean(buildInput.business.contacts.phone),
      email: Boolean(buildInput.business.contacts.email),
      address: buildInput.business.locations.length > 0,
      hours: buildInput.business.locations.some((item) => Boolean(item.hours)),
      coordinates: buildInput.business.locations.some((item) =>
        item.latitude !== undefined && item.longitude !== undefined
      ),
      serviceAreas: buildInput.business.serviceAreas.length > 0,
      proof: buildInput.business.proof.length > 0
    },
    referenceAuthority: assessmentReferenceAuthorityFor(buildInput),
    servingContract: assessmentServingContractFor({ targetKind: "site_artifact" }),
    routeSelection,
    siteInventory: siteInventoryForArtifact({ artifact, buildInput }),
    criteria,
    agentReadinessChecks: agentReadiness.checks,
    agentReadinessLimitations: agentReadiness.limitations,
    visualQuality,
    deterministicReleaseBlockers: artifact.qa.hardGate === "failed"
      ? artifact.qa.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => finding.id)
      : [],
    limitations: [
      "Assessed from retained ingestion and verification evidence; destination probes and field telemetry were not available.",
      "The existing artifact hard gate remains the release authority. This quality assessment is advisory.",
      artifact.qa.screenshotKeys.length ? "" : "No retained browser screenshot key was available."
    ].filter(Boolean),
    generatedAt,
    inputHashSource: {
      artifact,
      buildInputHash: buildInput.inputHash,
      visualQuality: {
        methodologyIdentity: visualQuality.methodologyIdentity,
        evaluatorIdentity: visualQuality.evaluator.identity,
        screenshotSetHash: visualQuality.evaluator.screenshotSetHash
      }
    }
  });
}

export function artifactBrokenImageFindings(findings: SiteBuildArtifact["qa"]["findings"]) {
  return findings.filter((item) => item.id === "render.broken_image" || item.id.startsWith("asset."));
}

export function artifactHeadingStructureFindings(findings: SiteBuildArtifact["qa"]["findings"]) {
  return findings.filter((item) => /^accessibility\.axe\.[^.]+\.(?:heading-order|page-has-heading-one)$/.test(item.id));
}

function semanticRoutePurpose(input: {
  path: string;
  title: string;
  declaredPurpose?: SitePublicBuildInput["intent"]["pageRequirements"][number]["purpose"];
  sourceFactIds: string[];
  buildInput: SitePublicBuildInput;
}) {
  if (input.declaredPurpose) return input.declaredPurpose;
  if (input.path === "/") return "home" as const;
  if (/(?:^|\/)(?:service-areas?|areas-served)(?:\/|$)/i.test(input.path)
    || /\b(?:service areas?|areas served)\b/i.test(input.title)) {
    return "location" as const;
  }
  if (/(?:^|\/)(?:contact|location)(?:\/|$)/i.test(input.path)
    || /\b(?:contact|location)\b/i.test(input.title)) {
    return "contact" as const;
  }
  if (/(?:^|\/)about(?:\/|$)/i.test(input.path) || /\babout\b/i.test(input.title)) {
    return "about" as const;
  }
  const routeText = normalized(`${input.path.replaceAll("-", " ")} ${input.title}`);
  const sourceFactIds = new Set(input.sourceFactIds);
  const matchesOffering = input.buildInput.business.offerings.some((offering) =>
    offering.sourceFactIds.some((factId) => sourceFactIds.has(factId))
    || meaningfulOfferingTerms(offering.name).some((term) => routeText.includes(term)));
  if (matchesOffering
    || /(?:^|\/)services?(?:\/|$)/i.test(input.path)
    || /\bservices?\b/i.test(input.title)) {
    return "service" as const;
  }
  return undefined;
}

function meaningfulOfferingTerms(value: string) {
  const normalizedValue = normalized(value);
  const withoutGenericSuffix = normalizedValue
    .replace(/\b(?:installation|replacement|repair|service|services)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set([normalizedValue, withoutGenericSuffix])]
    .filter((term) => term.length >= 5);
}

function gateResult(
  id: string,
  status: AssessmentCriterionStatus,
  artifact: SiteBuildArtifact,
  observedAt: string,
  passExplanation: string,
  otherExplanation: string,
  evidenceExtra: Partial<AssessmentEvidence> = {}
) {
  return artifactResult(
    id,
    status,
    artifact,
    observedAt,
    status === "pass" ? passExplanation : otherExplanation,
    "deterministic",
    evidenceExtra
  );
}

function artifactResult(
  id: string,
  status: AssessmentCriterionStatus,
  artifact: SiteBuildArtifact,
  observedAt: string,
  explanation: string,
  certainty: AssessmentCriterionInput["certainty"] = "deterministic",
  evidenceExtra: Partial<AssessmentEvidence> = {}
): AssessmentCriterionInput {
  const definition = criterionDefinition(id);
  return {
    id,
    dimensionId: definition.dimensionId,
    title: definition.title,
    status,
    impact: definition.impact,
    certainty,
    applicability: definition.applicability,
    explanation,
    businessConsequence: definition.businessConsequence,
    recommendation: definition.recommendation,
    evidence: [{
      id: `${id}.artifact`,
      kind: "artifact_gate",
      summary: `${explanation} Hard gate: ${artifact.qa.hardGate}; routes checked: ${artifact.qa.routesChecked}; links checked: ${artifact.qa.linksChecked}.`.slice(0, 2_000),
      observedAt,
      ...evidenceExtra
    }],
    pointsPossible: definition.points
  };
}

function inferredArtifactJourneys(buildInput: SitePublicBuildInput) {
  return [
    buildInput.business.contacts.phone ? "Call the business" : undefined,
    buildInput.forms.length ? "Submit an inquiry" : undefined,
    buildInput.business.offerings.some((offering) => offering.status === "confirmed" && offering.visibility === "public") ? "Evaluate a specific service" : undefined,
    buildInput.business.locations.length ? "Confirm location and hours" : undefined
  ].filter((value): value is string => Boolean(value));
}

function contactValueMatches(rendered: string, verified: string) {
  if (verified.includes("@")) return rendered.toLowerCase().includes(verified.toLowerCase());
  const renderedDigits = rendered.replace(/\D/g, "");
  const verifiedDigits = verified.replace(/\D/g, "");
  return verifiedDigits.length >= 7 && renderedDigits.includes(verifiedDigits);
}

function descriptiveRouteTitle(value: string, businessName: string) {
  const title = normalized(value);
  const business = normalizedBusinessNameForTitle(businessName);
  const abbreviatedBrand = value
    .split(/[|\-–—·]/)
    .map((segment) => normalized(segment))
    .find((segment) => segment.length >= 4 && business.startsWith(`${segment} `));
  return title.length >= 10
    && !/^(?:home|contact|services?|about|location)$/.test(title)
    && Boolean(business)
    && (title.includes(business) || Boolean(abbreviatedBrand));
}

function normalizedBusinessNameForTitle(value: string) {
  const parts = normalized(value).split(" ").filter(Boolean);
  const legalSuffixes = new Set(["co", "company", "corp", "corporation", "inc", "incorporated", "llc", "llp", "lp", "pc", "pllc"]);
  while (parts.length > 1 && legalSuffixes.has(parts.at(-1)!)) parts.pop();
  return parts.join(" ");
}

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
