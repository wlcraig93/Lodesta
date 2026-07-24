import type { SiteBuildArtifact, SitePublicBuildInput } from "@/packages/site-contracts";
import type {
  AssessmentCriterionInput,
  AssessmentCriterionStatus,
  AssessmentEvidence,
  WebsiteAssessment
} from "./contracts";
import { buildWebsiteAssessment } from "./engine";
import { criterionDefinition, serviceAreaOptionalVerticals } from "./rubric";
import { agentReadinessForArtifact } from "./agent-readiness-adapters";
import { evaluateArtifactVisualQuality } from "./visual-quality-artifact";
import { assessmentVerticalForDomainContext } from "./vertical";
import { siteToolchainIdentity } from "@/packages/site-contracts/platform-manifest";

export async function assessSiteArtifact(input: {
  artifact: SiteBuildArtifact;
  buildInput: SitePublicBuildInput;
  versionId?: string;
  assessmentId?: string;
  signal?: AbortSignal;
}): Promise<WebsiteAssessment> {
  const { artifact, buildInput } = input;
  if (artifact.publicBuildInputId !== buildInput.id) {
    throw new Error("Artifact assessment requires the exact public build input used at finalization.");
  }
  const generatedAt = new Date().toISOString();
  const findings = artifact.qa.findings;
  const finding = (pattern: RegExp) => findings.filter((item) => pattern.test(`${item.id} ${item.message}`));
  const routePurposes = new Map(buildInput.intent.pageRequirements.map((route) => [
    route.slug ? `/${route.slug}` : "/",
    route.purpose
  ]));
  const serviceRoutes = artifact.routes.filter((route) => routePurposes.get(route.path) === "service");
  const aboutRoutes = artifact.routes.filter((route) => routePurposes.get(route.path) === "about");
  const contactRoutes = artifact.routes.filter((route) => ["contact", "location"].includes(routePurposes.get(route.path) ?? ""));
  const formBindings = artifact.capabilityBindings.filter((binding) => binding.kind === "form");
  const verifiedContactValues = [buildInput.business.contacts.phone, buildInput.business.contacts.email].filter((value): value is string => Boolean(value));
  const renderedContactBindings = artifact.factBindings.filter((binding) => verifiedContactValues.some((value) => contactValueMatches(binding.text, value)));
  const serviceAreaNotApplicable = Boolean(
    buildInput.domainContext
    && serviceAreaOptionalVerticals.has(buildInput.domainContext.id)
    && buildInput.business.serviceAreas.length === 0
  );
  const screenshotKey = artifact.qa.screenshotKeys.find((key) => /mobile/i.test(key)) ?? artifact.qa.screenshotKeys[0];
  const screenshotExtra = screenshotKey ? { artifactKey: screenshotKey } : {};
  const currentBrowserEvidence = artifact.toolchainVersion === siteToolchainIdentity
    && artifact.qa.routesChecked > 0
    && artifact.qa.screenshotKeys.length > 0;
  const objectiveFunctionalFindings = finding(/render\.(?:managed_content_clipped|empty_control)/);
  const browserRuntimeFindings = finding(/render\.(?:console|page_error)/);
  const brokenLinkFindings = findings.filter((item) => item.id.startsWith("link."));
  const orphanFindings = finding(/route\.orphan/);
  const serviceQualityFindings = finding(/route\.(?:thin_service_content|repetitive_content)|fact\.service_detail_source/);
  const altQualityFindings = finding(/render\.image_alt_quality/);
  const titleFailures = artifact.routes.filter((route) => !descriptiveRouteTitle(route.title, buildInput.business.name));
  const uniqueDescriptions = new Set(artifact.routes.map((route) => normalized(route.description)).filter(Boolean));
  const descriptionFailures = artifact.routes.filter((route) => route.description.trim().length < 50);
  const criteria: AssessmentCriterionInput[] = [
    gateResult("functional.home_reachable", artifact.routes.some((route) => route.path === "/") && !finding(/route\.response/).length ? "pass" : "fail", artifact, generatedAt, "The finalized artifact contains a homepage and its browser gate returned a usable response.", "The homepage route or its browser response failed."),
    gateResult("functional.https", "unknown", artifact, generatedAt, "", "HTTPS is enforced at the public hostname boundary and cannot be proven from this unpublished artifact alone."),
    gateResult("functional.internal_destinations", artifact.qa.linksChecked > 0 && !brokenLinkFindings.length && !orphanFindings.length ? "pass" : brokenLinkFindings.length ? "fail" : artifact.qa.linksChecked || orphanFindings.length ? "warning" : "unknown", artifact, generatedAt, `${artifact.qa.linksChecked} link destination(s) passed the artifact browser gate.`, `${brokenLinkFindings.length} broken link finding(s) and ${orphanFindings.length} orphan-route advisory finding(s) were recorded.`),
    gateResult("functional.primary_external_destinations", "unknown", artifact, generatedAt, "", "The retained artifact gate did not independently probe third-party destinations."),
    gateResult("functional.images_load", finding(/broken_image|asset\./).length ? "fail" : "pass", artifact, generatedAt, "No broken image or asset finding was recorded across browser-gated routes.", `${finding(/broken_image|asset\./).length} broken image or asset finding(s) were recorded.`),
    gateResult(
      "functional.browser_errors",
      objectiveFunctionalFindings.length ? "fail" : browserRuntimeFindings.length ? "warning" : "pass",
      artifact,
      generatedAt,
      "No browser runtime error, clipped managed capability, or visually empty control was recorded.",
      `${objectiveFunctionalFindings.length} objective functional finding(s) and ${browserRuntimeFindings.length} browser runtime finding(s) were recorded.`
    ),
    gateResult("functional.form_path", formBindings.length === 0 ? "not_applicable" : finding(/capability\.form/).length ? "fail" : "pass", artifact, generatedAt, `${formBindings.length} managed form binding(s) passed static capability verification.`, `${finding(/capability\.form/).length} managed form capability finding(s) were recorded.`),

    gateResult("performance.mobile_viewport", "pass", artifact, generatedAt, "The trusted document compiler includes the responsive viewport contract.", ""),
    gateResult("performance.mobile_overflow", finding(/render\.horizontal_overflow/).length ? "fail" : "pass", artifact, generatedAt, "No horizontal overflow was recorded at the artifact browser-gate viewports.", `${finding(/render\.horizontal_overflow/).length} overflow finding(s) were recorded.`, screenshotExtra),
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
    artifactResult("conversion.click_to_call", "unknown", artifact, generatedAt, "The retained artifact evidence does not currently prove that a verified phone number rendered as an actionable tel: link."),
    gateResult("conversion.primary_action_above_fold", finding(/primary.*action|above.*fold/i).length ? "warning" : "unknown", artifact, generatedAt, "", "The retained artifact gate does not preserve a definitive above-fold primary-action metric."),
    artifactResult("conversion.service_navigation", serviceRoutes.length >= 2 && !serviceRoutes.some((route) => orphanFindings.some((finding) => finding.route === route.path)) ? "pass" : serviceRoutes.length ? "warning" : "fail", artifact, generatedAt, `${serviceRoutes.length} dedicated service route(s) and ${orphanFindings.length} orphan-route advisory finding(s) were retained.`),
    artifactResult("conversion.contact_page", contactRoutes.length ? "pass" : "warning", artifact, generatedAt, `${contactRoutes.length} contact or location route(s) were retained.`),
    artifactResult("conversion.mobile_persistent_action", "unknown", artifact, generatedAt, "Persistent-action placement is not preserved as deterministic retained evidence."),

    artifactResult("local_content.service_detail", serviceRoutes.length >= 2 && !serviceQualityFindings.length ? "pass" : serviceRoutes.length ? "warning" : "fail", artifact, generatedAt, `${serviceRoutes.length} service route(s) and ${serviceQualityFindings.length} thin, repetitive, or missing-source-detail finding(s) were recorded.`),
    artifactResult("local_content.location_clarity", buildInput.business.locations.length || buildInput.business.serviceAreas.length ? "pass" : "fail", artifact, generatedAt, `${buildInput.business.locations.length} verified location(s) and ${buildInput.business.serviceAreas.length} verified service area(s) were available to the artifact.`),
    artifactResult(
      "local_content.service_area_depth",
      serviceAreaNotApplicable
        ? "not_applicable"
        : buildInput.business.serviceAreas.length >= 2
          ? "pass"
          : buildInput.business.serviceAreas.length
            ? "warning"
            : buildInput.domainContext
              ? "fail"
              : "unknown",
      artifact,
      generatedAt,
      serviceAreaNotApplicable
        ? `Service-area depth was excluded for fixed-location vertical ${buildInput.domainContext?.id}.`
        : `${buildInput.business.serviceAreas.length} verified service area(s) were available.`
    ),
    artifactResult(
      "local_content.vertical_requirements",
      buildInput.domainContext ? "unknown" : "not_applicable",
      artifact,
      generatedAt,
      buildInput.domainContext
        ? `The ${buildInput.domainContext.id} domain module supplied category-specific guidance, but retained artifact evidence does not prove that every vertical requirement rendered.`
        : "No verified domain module was attached, so vertical requirements were excluded."
    ),

    artifactResult("trust.business_identity", buildInput.business.name && (buildInput.business.contacts.phone || buildInput.business.contacts.email || buildInput.business.locations.length) ? "pass" : "warning", artifact, generatedAt, `Verified business identity: ${buildInput.business.name}; public contact or location facts: ${Boolean(buildInput.business.contacts.phone || buildInput.business.contacts.email || buildInput.business.locations.length)}.`),
    artifactResult("trust.about", aboutRoutes.length ? "pass" : "warning", artifact, generatedAt, `${aboutRoutes.length} about route(s) were retained.`),
    artifactResult("trust.proof", buildInput.business.proof.length ? "pass" : "warning", artifact, generatedAt, `${buildInput.business.proof.length} confirmed proof item(s) were available to the artifact.`),
    artifactResult("trust.privacy", formBindings.length === 0 ? "not_applicable" : artifact.routes.some((route) => /privacy/i.test(`${route.path} ${route.title}`)) ? "pass" : "fail", artifact, generatedAt, formBindings.length === 0 ? "No managed lead form was present." : "The artifact was checked for a privacy route alongside managed forms."),

    gateResult("accessibility.axe_critical", finding(/accessibility\.axe\.critical/).length ? "fail" : finding(/accessibility\.axe\.complete/).length ? "pass" : "unknown", artifact, generatedAt, "No critical axe-core finding was recorded across mobile browser-gated routes.", finding(/accessibility\.axe\.critical/).length ? `${finding(/accessibility\.axe\.critical/).length} critical axe-core finding(s) were recorded.` : "The retained artifact predates axe-core evidence."),
    gateResult("accessibility.axe_serious", finding(/accessibility\.axe\.serious|render\.contrast/).length ? "fail" : finding(/accessibility\.axe\.complete/).length ? "pass" : "unknown", artifact, generatedAt, "No serious axe-core or deterministic contrast finding was recorded across mobile browser-gated routes.", finding(/accessibility\.axe\.serious|render\.contrast/).length ? `${finding(/accessibility\.axe\.serious|render\.contrast/).length} serious accessibility or deterministic contrast finding(s) were recorded.` : "The retained artifact predates axe-core evidence."),
    artifactResult(
      "accessibility.image_alt",
      altQualityFindings.length ? "warning" : currentBrowserEvidence ? "pass" : "unknown",
      artifact,
      generatedAt,
      `Current retained browser evidence was checked for descriptive alt text on rendered business assets; ${altQualityFindings.length} rendered finding(s) were found.`
    ),
    gateResult("accessibility.heading_structure", finding(/heading/i).length ? "fail" : "unknown", artifact, generatedAt, "", finding(/heading/i).length ? `${finding(/heading/i).length} heading-related finding(s) were recorded.` : "The retained artifact gate does not preserve a complete heading-outline audit."),
    gateResult("accessibility.form_labels", formBindings.length === 0 ? "not_applicable" : finding(/capability\.form_label/).length ? "fail" : "pass", artifact, generatedAt, "All managed form fields passed the finalizer's label association check.", `${finding(/capability\.form_label/).length} form-label finding(s) were recorded.`)
  ];
  const location = buildInput.business.locations[0];
  const agentReadiness = agentReadinessForArtifact({ artifact, buildInput, generatedAt });
  const visualQuality = await evaluateArtifactVisualQuality({
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
      vertical: assessmentVerticalForDomainContext(buildInput.domainContext?.id),
      verticalConfidence: buildInput.domainContext ? 1 : 0.35,
      verticalEvidence: buildInput.domainContext ? ["Vertical supplied by the verified Lodesta domain-context module."] : ["No verified domain-context module was attached."],
      customerJourneys: buildInput.domainContext?.customerJourneys ?? inferredArtifactJourneys(buildInput)
    },
    criteria,
    agentReadinessChecks: agentReadiness.checks,
    agentReadinessLimitations: agentReadiness.limitations,
    visualQuality,
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
    buildInput.intent.pageRequirements.some((page) => page.purpose === "service") ? "Evaluate a specific service" : undefined,
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
  const business = normalized(businessName);
  return title.length >= 10
    && !/^(?:home|contact|services?|about|location)$/.test(title)
    && Boolean(business)
    && title.includes(business);
}

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
