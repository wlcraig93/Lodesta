import type { CrawlAssessment, CrawlPageSummary } from "@/lib/crawler";
import { inspectUrlRender } from "@/lib/render-inspection";
import { crawlWebsiteForGeneration, type WebsiteGenerationIngestion } from "@/packages/business-data/generation-crawler";
import type { RenderInspectionResult } from "@/packages/acquisition/presence-contracts";
import { normalizePublicFetchUrlInput } from "@/lib/url-safety";
import type {
  AssessmentCriterionInput,
  AssessmentCriterionStatus,
  AssessmentEvidence,
  WebsiteAssessment
} from "./contracts";
import { collectBrowserEvidence, type AutomatedAccessibilityEvidence, type PerformanceMetric, type WebPerformanceEvidence } from "./browser-evidence";
import { probeCrawlDestinations, type DestinationProbeResult } from "./destination-probes";
import { buildWebsiteAssessment } from "./engine";
import { criterionDefinition, serviceAreaOptionalVerticals } from "./rubric";
import { inferAssessmentVertical } from "./vertical";
import {
  collectAgentReadinessProbes,
  type AgentReadinessProbeResult
} from "./agent-readiness-probes";
import { agentReadinessForPublicUrl } from "./agent-readiness-adapters";
import {
  evaluateVisualQuality,
  visualQualityModelIsConfigured
} from "./visual-quality-evaluator";
import {
  capturePublicVisualQuality,
  type PublicVisualQualityCapture
} from "./visual-quality-capture";
import { unavailableVisualQuality } from "./visual-quality";
import type { SitePublicBuildInput } from "@/packages/site-contracts";
import { selectVisualQualityPages } from "./visual-quality-capture";
import { siteInventoryForPublicUrl } from "./site-inventory";

export type PublicUrlAssessmentRun = {
  assessment: WebsiteAssessment;
  crawl: CrawlAssessment;
  ingestion: WebsiteGenerationIngestion;
  render: RenderInspectionResult;
  destinationProbes: DestinationProbeResult;
  performance: WebPerformanceEvidence;
  accessibility: AutomatedAccessibilityEvidence;
  agentReadinessProbes: AgentReadinessProbeResult;
  visualQualityCapture?: PublicVisualQualityCapture;
};

export async function assessPublicUrl(input: {
  url: string;
  assessmentId?: string;
  sourceKey?: string;
  captureScreenshots?: boolean;
  signal?: AbortSignal;
  declaredVertical?: string;
  targetKind?: "public_url" | "published_site";
  siteId?: string;
  versionId?: string;
  canonicalBuildInput?: SitePublicBuildInput;
}): Promise<PublicUrlAssessmentRun> {
  const sourceUrl = normalizePublicFetchUrlInput(input.url);
  if (!sourceUrl) throw new Error("A public website URL is required.");
  const { ingestion, crawl, technicalEvidence } = await crawlWebsiteForGeneration({
    url: sourceUrl,
    signal: input.signal,
    limits: {
      concurrentPerOrigin: 2,
      minimumStartSpacingMs: 500
    }
  });
  const destinationProbes = await probeCrawlDestinations({ crawl, signal: input.signal });
  await delay(500);
  const agentReadinessProbes = await collectAgentReadinessProbes({
    url: crawl.finalUrl ?? sourceUrl,
    signal: input.signal,
    existingEvidence: technicalEvidence
  });
  await delay(500);
  const render = await inspectUrlRender({
    url: crawl.finalUrl ?? sourceUrl,
    target: "source_site",
    captureScreenshots: input.captureScreenshots !== false,
    siteId: input.assessmentId,
    enforcePublicUrlSafety: true
  });
  const browserEvidence = await collectBrowserEvidence({
    url: crawl.finalUrl ?? sourceUrl,
    cruxApiKey: process.env.GOOGLE_CRUX_API_KEY,
    signal: input.signal
  });
  const vertical = inferAssessmentVertical({ sourceUrl, crawl, declaredVertical: input.declaredVertical });
  const generatedAt = new Date().toISOString();
  const location = formattedLocation(crawl);
  const customerJourneys = inferredJourneys(crawl);
  const agentReadiness = agentReadinessForPublicUrl({
    crawl,
    ingestion,
    probes: agentReadinessProbes,
    generatedAt,
    vertical: vertical.vertical,
    verticalConfidence: vertical.confidence
  });
  let visualQualityCapture: PublicVisualQualityCapture | undefined;
  const visualQuality = input.captureScreenshots === false
    ? unavailableVisualQuality({
        observedAt: generatedAt,
        limitation: "Visual Quality was unavailable because screenshot capture was disabled."
      })
    : !visualQualityModelIsConfigured()
      ? unavailableVisualQuality({
          observedAt: generatedAt,
          limitation: "Visual Quality was unavailable because the multimodal evaluator is not configured."
        })
      : await (async () => {
          await delay(500);
          visualQualityCapture = await capturePublicVisualQuality({
            crawl,
            homepageRender: render,
            assessmentId: input.assessmentId,
            signal: input.signal
          });
          return evaluateVisualQuality({
            contactSheets: visualQualityCapture.contactSheets,
            screenshots: visualQualityCapture.screenshots,
            vertical: vertical.vertical,
            verticalConfidence: vertical.confidence,
            businessName: crawl.extractedFacts.name ?? crawl.title,
            primaryLocation: location,
            services: unique(crawl.extractedFacts.services).slice(0, 60),
            customerJourneys,
            deterministicContext: visualQualityCapture.deterministicContext,
            hasMeaningfulImagery: visualQualityCapture.hasMeaningfulImagery,
            limitations: visualQualityCapture.limitations,
            observedAt: generatedAt,
            signal: input.signal
          });
        })();
  const criteria = criteriaForPublicUrl({
    crawl,
    render,
    ingestion,
    probes: destinationProbes,
    performance: browserEvidence.performance,
    accessibility: browserEvidence.accessibility,
    generatedAt,
    vertical: vertical.vertical,
    verticalConfidence: vertical.confidence,
    canonicalBuildInput: input.canonicalBuildInput
  });
  const routeSelection = visualQualityCapture?.routeSelection
    ?? selectVisualQualityPages(crawl).selection;
  const limitations = [
    ...destinationProbes.limitations,
    ingestion.coverage === "complete"
      ? undefined
      : `The crawl reported ${ingestion.coverage} coverage (${ingestion.counts.fetched} of ${ingestion.counts.eligible} eligible pages fetched; ${ingestion.counts.unfinished} unfinished).`,
    render.unavailableReason ? `Browser render inspection was unavailable: ${render.unavailableReason}` : undefined,
    browserEvidence.performance.limitation,
    browserEvidence.accessibility.limitation,
    "Automated accessibility testing does not replace manual assistive-technology review.",
    "Third-party forms and transaction flows were not submitted."
  ].filter((value): value is string => Boolean(value));
  const assessment = buildWebsiteAssessment({
    id: input.assessmentId,
    target: {
      kind: input.targetKind ?? "public_url",
      sourceKey: input.sourceKey ?? canonicalSourceKey(crawl.finalUrl ?? sourceUrl),
      sourceUrl: crawl.finalUrl ?? sourceUrl,
      siteId: input.siteId,
      versionId: input.versionId
    },
    siteUnderstanding: {
      businessName: crawl.extractedFacts.name ?? crawl.title,
      primaryLocation: location,
      services: unique(crawl.extractedFacts.services).slice(0, 60),
      vertical: vertical.vertical,
      verticalConfidence: vertical.confidence,
      verticalEvidence: vertical.evidence,
      customerJourneys
    },
    canonicalFactAvailability: canonicalFactAvailabilityFor({
      crawl,
      buildInput: input.canonicalBuildInput
    }),
    routeSelection,
    siteInventory: siteInventoryForPublicUrl({ crawl, ingestion }),
    criteria,
    agentReadinessChecks: agentReadiness.checks,
    agentReadinessLimitations: agentReadiness.limitations,
    visualQuality,
    limitations,
    generatedAt,
    inputHashSource: {
      sourceUrl,
      crawl: { ingestion, crawl },
      render: { adapter: render.adapter, metrics: render.metrics, metricsByViewport: render.metricsByViewport, findings: render.findings },
      destinationProbes,
      agentReadinessProbes,
      visualQuality: {
        methodologyIdentity: visualQuality.methodologyIdentity,
        evaluatorIdentity: visualQuality.evaluator.identity,
        screenshotSetHash: visualQuality.evaluator.screenshotSetHash,
        selectedRoutes: visualQualityCapture?.selectedRoutes ?? []
      },
      performance: browserEvidence.performance,
      accessibility: browserEvidence.accessibility
    }
  });
  return {
    assessment,
    crawl,
    ingestion,
    render,
    destinationProbes,
    performance: browserEvidence.performance,
    accessibility: browserEvidence.accessibility,
    agentReadinessProbes,
    visualQualityCapture
  };
}

function criteriaForPublicUrl(input: {
  crawl: CrawlAssessment;
  render: RenderInspectionResult;
  ingestion: WebsiteGenerationIngestion;
  probes: DestinationProbeResult;
  performance: WebPerformanceEvidence;
  accessibility: AutomatedAccessibilityEvidence;
  generatedAt: string;
  vertical: string;
  verticalConfidence: number;
  canonicalBuildInput?: SitePublicBuildInput;
}): AssessmentCriterionInput[] {
  const { crawl, render, ingestion, probes, performance, accessibility, generatedAt } = input;
  const sourceUrl = crawl.finalUrl ?? crawl.url;
  const pages = crawl.pageSummaries;
  const primary = pages.find((page) => page.source === "primary") ?? pages[0];
  const mobile = render.metricsByViewport?.mobile;
  const visibleText = pages.map((page) => page.mainText ?? "").join("\n");
  const links = pages.flatMap((page) => page.linkReferences);
  const internalFailures = probes.probes.filter((probe) => probe.kind === "internal" && !probe.ok);
  const externalFailures = probes.probes.filter((probe) => probe.kind === "primary_external" && !probe.ok);
  const axeCritical = accessibility.violations.filter((violation) => violation.impact === "critical");
  const axeSerious = accessibility.violations.filter((violation) => violation.impact === "serious");
  const axeIds = new Set(accessibility.violations.map((violation) => violation.id));
  const forms = pages.flatMap((page) => page.formReferences);
  const servicePages = pages.filter((page) => page.purposeTags.some((tag) => tag === "services" || tag === "service_detail"));
  const contactPages = pages.filter((page) => page.purposeTags.some((tag) => tag === "contact" || tag === "location"));
  const aboutPages = pages.filter((page) => page.purposeTags.includes("about"));
  const privacyLinked = links.some((link) => /\bprivacy\b/i.test(link.text ?? "") || /\/privacy(?:\/|$)/i.test(link.href));
  const proofPattern = /\b(review|testimonial|licensed|insured|certified|award|years? (?:of )?experience|family[- ]owned|accredit)\b/i;
  const detailedServicePages = servicePages.filter((page) => (page.mainText?.length ?? 0) >= 500 || page.purposeTags.includes("service_detail"));
  const verifiedContactPath = crawl.hasTelLink
    || links.some((link) => link.kind === "mailto")
    || probes.probes.some((probe) => probe.kind === "primary_external" && probe.ok);
  const screenshot = render.screenshots.find((item) => item.viewport === "mobile");
  const screenshotEvidence = screenshot?.path
    ? { artifactKey: screenshot.path, viewport: "mobile" as const }
    : {};
  const canonicalValue = primary?.canonical;
  const titleCoverage = ratio(pages.filter((page) => usefulTitle(page.title)).length, pages.length);
  const uniqueTitleCoverage = ratio(new Set(pages.map((page) => normalized(page.title)).filter(Boolean)).size, pages.length);
  const descriptionCoverage = ratio(pages.filter((page) => usefulDescription(page.metaDescription)).length, pages.length);
  const serviceAreaNotApplicable = input.verticalConfidence >= 0.8
    && serviceAreaOptionalVerticals.has(input.vertical)
    && crawl.extractedFacts.serviceAreas.length === 0;
  const crawlInferenceConfidence = ingestion.coverage === "complete"
    ? 0.9
    : ingestion.coverage === "restricted"
      ? 0.8
      : 0.7;
  const canonicalPhone = input.canonicalBuildInput?.business.contacts.phone
    ?? crawl.extractedFacts.phone;
  const telephoneLinks = links.filter((link) => link.kind === "tel");
  const matchingTelephoneLinks = canonicalPhone
    ? telephoneLinks.filter((link) => phoneMatches(link.href, canonicalPhone))
    : [];
  const canonicalHours = input.canonicalBuildInput?.business.locations.find((location) => location.hours)?.hours
    ?? crawl.extractedFacts.hours;
  const hoursAgree = !input.canonicalBuildInput
    || !canonicalHours
    || !crawl.extractedFacts.hours
    || stableRecord(canonicalHours) === stableRecord(crawl.extractedFacts.hours);

  return [
    result(
      "trust.business_identity",
      crawl.extractedFacts.name && (crawl.extractedFacts.phone || crawl.extractedFacts.email || formattedLocation(crawl)) ? "pass" : crawl.extractedFacts.name ? "warning" : "fail",
      crawl.extractedFacts.name
        ? `Business identity detected as ${crawl.extractedFacts.name}${crawl.extractedFacts.phone || crawl.extractedFacts.email || formattedLocation(crawl) ? " with contact facts" : " without complete contact facts"}.`
        : "A clear business identity was not extracted.",
      evidence("trust.business_identity.content", "content", `Name: ${crawl.extractedFacts.name ?? "not detected"}; phone: ${crawl.extractedFacts.phone ? "detected" : "not detected"}; email: ${crawl.extractedFacts.email ? "detected" : "not detected"}; location: ${formattedLocation(crawl) ?? "not detected"}.`, generatedAt, { sourceUrl }),
      "inferred",
      crawl.extractedFacts.name ? 0.9 : crawlInferenceConfidence
    ),
    result(
      "truth.phone_consistency",
      !canonicalPhone ? "not_applicable" : telephoneLinks.length === 0 ? "warning" : matchingTelephoneLinks.length === telephoneLinks.length ? "pass" : "fail",
      !canonicalPhone
        ? "No canonical phone fact was available."
        : telephoneLinks.length === 0
          ? "A canonical phone fact was available, but no tap-to-call destination was detected."
          : `${matchingTelephoneLinks.length} of ${telephoneLinks.length} telephone links matched the canonical number.`,
      evidence("truth.phone_consistency.links", "crawl", `Canonical phone available: ${Boolean(canonicalPhone)}; tel links: ${telephoneLinks.length}; canonical matches: ${matchingTelephoneLinks.length}.`, generatedAt, { sourceUrl })
    ),
    result(
      "truth.hours_consistency",
      !canonicalHours ? "not_applicable" : hoursAgree ? "pass" : "fail",
      !canonicalHours
        ? "No publish-eligible canonical hours fact was available."
        : hoursAgree
          ? "Rendered source hours did not contradict the canonical hours fact."
          : "Rendered source hours contradicted the canonical hours fact.",
      evidence("truth.hours_consistency.content", "content", `Canonical hours available: ${Boolean(canonicalHours)}; rendered hours available: ${Boolean(crawl.extractedFacts.hours)}; agree: ${hoursAgree}.`, generatedAt, { sourceUrl })
    ),
    result(
      "truth.structured_data_consistency",
      crawl.hasLocalBusinessSchema ? "unknown" : "not_applicable",
      crawl.hasLocalBusinessSchema
        ? "Local-business structured data was present, but the retained crawl evidence did not preserve a complete visible-to-machine fact comparison."
        : "No LocalBusiness-compatible structured data was detected.",
      evidence("truth.structured_data_consistency.crawl", "crawl", `Detected JSON-LD types: ${crawl.jsonLdTypes.join(", ") || "none"}.`, generatedAt, { sourceUrl })
    ),
    result("functional.home_reachable", crawl.fetched && (crawl.status ?? 500) < 400 ? "pass" : "fail",
      crawl.fetched ? `Homepage returned HTTP ${crawl.status ?? "unknown"}.` : `Homepage could not be fetched: ${crawl.error ?? "unknown error"}.`,
      evidence("functional.home_reachable.http", "http", crawl.fetched ? `Final homepage response was HTTP ${crawl.status ?? "unknown"}.` : `Homepage fetch failed: ${crawl.error ?? "unknown error"}.`, generatedAt, { sourceUrl })),
    result("functional.https", new URL(sourceUrl).protocol === "https:" ? "pass" : "fail",
      new URL(sourceUrl).protocol === "https:"
        ? "The final assessed homepage used HTTPS."
        : "The final assessed homepage remained on an insecure HTTP connection.",
      evidence("functional.https.http", "http", `Final assessed URL: ${sourceUrl}`, generatedAt, { sourceUrl })),
    result("functional.internal_destinations",
      probes.probedInternal === 0 ? "unknown" : internalFailures.length === 0 ? "pass" : internalFailures.length / probes.probedInternal <= 0.02 ? "warning" : "fail",
      probes.probedInternal === 0
        ? "No internal destinations could be independently probed."
        : internalFailures.length
          ? `${internalFailures.length} of ${probes.probedInternal} probed internal destinations failed.`
          : `All ${probes.probedInternal} probed internal destinations returned usable responses.`,
      probeEvidence("functional.internal_destinations.probes", probes, "internal", generatedAt, sourceUrl)),
    result(
      "functional.navigation_reachability",
      render.adapter === "fetch_fallback"
        ? "unknown"
        : (mobile?.navigationUnreachableCount ?? 0) > 0
          ? "fail"
          : (mobile?.navigationDestinationCount ?? 0) > 0 || pages.length <= 1
            ? "pass"
            : "unknown",
      render.adapter === "fetch_fallback"
        ? "Browser interaction evidence was unavailable for primary navigation."
        : (mobile?.navigationUnreachableCount ?? 0) > 0
          ? `${mobile?.navigationUnreachableCount} of ${mobile?.navigationDestinationCount ?? 0} primary mobile destination(s) were not hit-testable after disclosure activation.`
          : (mobile?.navigationDestinationCount ?? 0) > 0
            ? `All ${mobile?.navigationDestinationCount} discovered primary mobile destination(s) were hit-testable.`
            : pages.length <= 1
              ? "No separate primary destination was required for this one-page site."
              : "No primary navigation destinations were discoverable in the measured mobile header.",
      evidence("functional.navigation_reachability.render", "render", `Mobile destinations: ${mobile?.navigationDestinationCount ?? "unknown"}; unreachable: ${mobile?.navigationUnreachableCount ?? "unknown"}; samples: ${mobile?.navigationUnreachableSamples?.join(", ") || "none"}.`, generatedAt, { sourceUrl, viewport: "mobile" })
    ),
    result("functional.primary_external_destinations",
      probes.probedPrimaryExternal === 0 ? "not_applicable" : externalFailures.length === 0 ? "pass" : "fail",
      probes.probedPrimaryExternal === 0
        ? "No primary external booking or ordering destination was detected."
        : externalFailures.length
          ? `${externalFailures.length} primary external destination${externalFailures.length === 1 ? "" : "s"} failed.`
          : `All ${probes.probedPrimaryExternal} primary external destinations responded successfully.`,
      probeEvidence("functional.primary_external_destinations.probes", probes, "primary_external", generatedAt, sourceUrl)),
    result("functional.images_load",
      render.adapter === "fetch_fallback" ? "unknown" : (mobile?.brokenImageCount ?? render.metrics.brokenImageCount ?? 0) > 0 ? "fail" : "pass",
      render.adapter === "fetch_fallback"
        ? "A browser was unavailable, so visible image loading could not be verified."
        : (mobile?.brokenImageCount ?? render.metrics.brokenImageCount ?? 0) > 0
          ? `${mobile?.brokenImageCount ?? render.metrics.brokenImageCount} visible mobile image(s) did not load.`
          : "Visible images loaded in the browser inspection.",
      evidence("functional.images_load.render", "render", `Mobile broken-image count: ${mobile?.brokenImageCount ?? render.metrics.brokenImageCount ?? "unknown"}.`, generatedAt, { sourceUrl, ...screenshotEvidence })),
    result("functional.browser_errors",
      render.adapter === "fetch_fallback" ? "unknown" : (mobile?.consoleErrorCount ?? render.metrics.consoleErrorCount ?? 0) > 0 ? "warning" : "pass",
      render.adapter === "fetch_fallback"
        ? "A browser was unavailable, so client-side errors could not be verified."
        : (mobile?.consoleErrorCount ?? render.metrics.consoleErrorCount ?? 0) > 0
          ? `${mobile?.consoleErrorCount ?? render.metrics.consoleErrorCount} mobile browser error(s) were observed.`
          : "No browser console or page errors were observed on mobile.",
      evidence("functional.browser_errors.render", "render", `Mobile browser error count: ${mobile?.consoleErrorCount ?? render.metrics.consoleErrorCount ?? "unknown"}.`, generatedAt, { sourceUrl, viewport: "mobile" })),
    result("functional.form_path",
      forms.length === 0 ? "not_applicable" : "unknown",
      forms.length === 0
        ? "No lead form was detected; customers use other contact paths."
        : `${forms.length} form${forms.length === 1 ? " was" : "s were"} detected, but third-party forms were intentionally not submitted.`,
      evidence("functional.form_path.crawl", "crawl", forms.length ? `Detected ${forms.length} form(s); submission was not attempted.` : "No forms were detected.", generatedAt, { sourceUrl })),

    result("performance.mobile_viewport", primary?.hasViewportMeta ? "pass" : "fail",
      primary?.hasViewportMeta ? "The homepage declares a mobile viewport." : "The homepage does not declare a mobile viewport.",
      evidence("performance.mobile_viewport.dom", "crawl", `Viewport meta present: ${Boolean(primary?.hasViewportMeta)}.`, generatedAt, { sourceUrl })),
    result("performance.mobile_overflow",
      render.adapter === "fetch_fallback" ? "unknown" : (mobile?.horizontalOverflowPx ?? 0) <= 8 ? "pass" : "fail",
      render.adapter === "fetch_fallback"
        ? "A mobile browser layout was unavailable."
        : (mobile?.horizontalOverflowPx ?? 0) <= 8
          ? "The mobile page fits the viewport without material horizontal overflow."
          : `The mobile layout overflows horizontally by ${mobile?.horizontalOverflowPx}px.`,
      evidence("performance.mobile_overflow.render", "render", `Mobile horizontal overflow: ${mobile?.horizontalOverflowPx ?? "unknown"}px.`, generatedAt, { sourceUrl, ...screenshotEvidence })),
    result("performance.readable_text",
      render.adapter === "fetch_fallback"
        ? "unknown"
        : (mobile?.minReadableTextFontSizePx ?? 16) >= 16
          ? "pass"
          : (mobile?.minReadableTextFontSizePx ?? 16) >= 14
            ? "warning"
            : "fail",
      render.adapter === "fetch_fallback"
        ? "Mobile text sizing could not be measured."
        : `Smallest measured readable mobile text was ${mobile?.minReadableTextFontSizePx ?? "unknown"}px.`,
      evidence("performance.readable_text.render", "render", `Minimum readable mobile text: ${mobile?.minReadableTextFontSizePx ?? "unknown"}px.`, generatedAt, { sourceUrl, viewport: "mobile" })),
    result(
      "responsive.target_size",
      render.adapter === "fetch_fallback"
        ? "unknown"
        : (mobile?.smallTargetCount ?? 0) === 0
          ? "pass"
          : (mobile?.smallTargetCount ?? 0) <= 2
            ? "warning"
            : "fail",
      render.adapter === "fetch_fallback"
        ? "Mobile target geometry was unavailable."
        : `${mobile?.smallTargetCount ?? 0} essential mobile control(s) measured below 44×44px.`,
      evidence("responsive.target_size.render", "render", `Small essential mobile targets: ${mobile?.smallTargetCount ?? "unknown"}; samples: ${mobile?.smallTargetSamples?.join(", ") || "none"}.`, generatedAt, { sourceUrl, viewport: "mobile" })
    ),
    result(
      "responsive.no_clipping_overlap",
      render.adapter === "fetch_fallback"
        ? "unknown"
        : (mobile?.clippedElementCount ?? 0) > 0 || (mobile?.hitTestFailureCount ?? 0) > 0
          ? "fail"
          : "pass",
      render.adapter === "fetch_fallback"
        ? "Mobile clipping, overlap, and hit-testing geometry was unavailable."
        : `${mobile?.clippedElementCount ?? 0} clipped element(s) and ${mobile?.hitTestFailureCount ?? 0} obscured essential control(s) were measured.`,
      evidence("responsive.no_clipping_overlap.render", "render", `Clipped: ${mobile?.clippedElementCount ?? "unknown"}; obscured controls: ${mobile?.hitTestFailureCount ?? "unknown"}; samples: ${[...(mobile?.clippedElementSamples ?? []), ...(mobile?.hitTestFailureSamples ?? [])].slice(0, 6).join(", ") || "none"}.`, generatedAt, { sourceUrl, viewport: "mobile" })
    ),
    performanceResult("performance.lcp", performance.lcp, performance, generatedAt, sourceUrl),
    performanceResult("performance.inp", performance.inp, performance, generatedAt, sourceUrl),
    performanceResult("performance.cls", performance.cls, performance, generatedAt, sourceUrl),

    result("discoverability.title",
      !pages.length ? "unknown" : titleCoverage >= 0.9 && uniqueTitleCoverage >= 0.9 ? "pass" : titleCoverage >= 0.5 ? "warning" : "fail",
      `${Math.round(titleCoverage * 100)}% of fetched pages had useful titles; ${Math.round(uniqueTitleCoverage * 100)}% were unique.`,
      evidence("discoverability.title.crawl", "crawl", `${pages.length} page(s) evaluated for useful, distinct titles.`, generatedAt, { sourceUrl })),
    result("discoverability.meta_description",
      !pages.length ? "unknown" : descriptionCoverage >= 0.8 ? "pass" : descriptionCoverage >= 0.4 ? "warning" : "fail",
      `${Math.round(descriptionCoverage * 100)}% of fetched pages had useful meta descriptions.`,
      evidence("discoverability.meta_description.crawl", "crawl", `${pages.length} page(s) evaluated for meta descriptions.`, generatedAt, { sourceUrl })),
    result("discoverability.canonical", canonicalValue ? "pass" : "warning",
      canonicalValue ? `The homepage declares ${canonicalValue} as canonical.` : "No homepage canonical URL was detected.",
      evidence("discoverability.canonical.dom", "crawl", canonicalValue ? `Canonical: ${canonicalValue}` : "No canonical link was detected.", generatedAt, { sourceUrl })),
    result("discoverability.robots", crawl.robotsFound ? "pass" : "warning",
      crawl.robotsFound ? "robots.txt was available and allowed the assessed homepage." : "No robots.txt file was detected.",
      evidence("discoverability.robots.http", "http", `robots.txt detected: ${crawl.robotsFound}.`, generatedAt, { sourceUrl: new URL("/robots.txt", sourceUrl).href })),
    result("discoverability.sitemap", crawl.sitemapFound ? "pass" : "warning",
      crawl.sitemapFound ? "An XML sitemap was discovered." : "No XML sitemap was discovered.",
      evidence("discoverability.sitemap.http", "http", `Sitemap discovered: ${crawl.sitemapFound}.`, generatedAt, { sourceUrl })),
    result("discoverability.local_schema", crawl.hasLocalBusinessSchema ? "pass" : "warning",
      crawl.hasLocalBusinessSchema ? "Local business structured data was detected." : "No LocalBusiness-compatible structured data was detected.",
      evidence("discoverability.local_schema.dom", "crawl", `Detected JSON-LD types: ${crawl.jsonLdTypes.join(", ") || "none"}.`, generatedAt, { sourceUrl })),

    result("conversion.contact_path", verifiedContactPath ? "pass" : forms.length ? "warning" : "fail",
      verifiedContactPath
        ? "At least one directly actionable call, email, booking, or ordering path was verified."
        : forms.length
          ? "A lead form was detected, but its submission was intentionally not attempted, so the contact path is only partially verified."
          : "No direct contact, booking, ordering, or inquiry path was detected.",
      evidence("conversion.contact_path.crawl", "crawl", `Phone links: ${crawl.hasTelLink ? "yes" : "no"}; forms: ${crawl.formCount}; booking/order/email links: ${links.filter((link) => ["booking", "ordering", "mailto"].includes(link.kind)).length}.`, generatedAt, { sourceUrl })),
    result("conversion.click_to_call",
      !canonicalPhone ? "not_applicable" : matchingTelephoneLinks.length ? "pass" : "warning",
      !canonicalPhone
        ? "No canonical phone fact was available for tap-to-call verification."
        : matchingTelephoneLinks.length
          ? `${matchingTelephoneLinks.length} tap-to-call link${matchingTelephoneLinks.length === 1 ? "" : "s"} matched the canonical phone number.`
          : "No tap-to-call link matched the canonical phone number.",
      evidence("conversion.click_to_call.crawl", "crawl", `Telephone links: ${telephoneLinks.length}; canonical matches: ${matchingTelephoneLinks.length}.`, generatedAt, { sourceUrl })),
    result("conversion.primary_action_above_fold",
      render.adapter === "fetch_fallback" ? "unknown" : mobile?.aboveFoldCtaDetected ? "pass" : "fail",
      render.adapter === "fetch_fallback"
        ? "The first mobile viewport could not be inspected."
        : mobile?.aboveFoldCtaDetected
          ? "An actionable control was visible in the first mobile viewport."
          : "No actionable control was visible in the first mobile viewport.",
      evidence("conversion.primary_action_above_fold.render", "render", `Above-fold mobile action detected: ${Boolean(mobile?.aboveFoldCtaDetected)}.`, generatedAt, { sourceUrl, ...screenshotEvidence }),
      "deterministic"),
    result("conversion.service_navigation",
      servicePages.length >= 2 ? "pass" : servicePages.length === 1 ? "warning" : "fail",
      servicePages.length >= 2
        ? `${servicePages.length} navigable service-oriented pages were fetched.`
        : servicePages.length === 1
          ? "Only one general service-oriented page was fetched."
          : "No navigable service page was detected.",
      pageEvidence("conversion.service_navigation.pages", servicePages, generatedAt, sourceUrl),
      "inferred",
      servicePages.length ? 0.9 : crawlInferenceConfidence),
    result("conversion.contact_page", contactPages.length ? "pass" : "warning",
      contactPages.length ? `${contactPages.length} contact or location page${contactPages.length === 1 ? " was" : "s were"} detected.` : "No dedicated contact or location page was detected.",
      pageEvidence("conversion.contact_page.pages", contactPages, generatedAt, sourceUrl),
      "inferred",
      contactPages.length ? 0.9 : crawlInferenceConfidence),
    result("conversion.mobile_persistent_action",
      render.adapter === "fetch_fallback" ? "unknown" : mobile?.rects?.stickyCta ? "pass" : "warning",
      render.adapter === "fetch_fallback"
        ? "A mobile browser layout was unavailable."
        : mobile?.rects?.stickyCta
          ? "A persistent mobile action was detected."
          : "No persistent mobile action was detected.",
      evidence("conversion.mobile_persistent_action.render", "render", `Persistent mobile action detected: ${Boolean(mobile?.rects?.stickyCta)}.`, generatedAt, { sourceUrl, viewport: "mobile" })),

    result("local_content.service_detail",
      detailedServicePages.length >= 2 ? "pass" : servicePages.length ? "warning" : "fail",
      detailedServicePages.length >= 2
        ? `${detailedServicePages.length} service pages contained substantive detail.`
        : servicePages.length
          ? "Service content was present but limited in depth or page coverage."
          : "No substantive service detail page was detected.",
      pageEvidence("local_content.service_detail.pages", detailedServicePages.length ? detailedServicePages : servicePages, generatedAt, sourceUrl),
      "inferred",
      detailedServicePages.length ? 0.9 : crawlInferenceConfidence),
    result("local_content.location_clarity",
      formattedLocation(crawl) || crawl.extractedFacts.serviceAreas.length ? "pass" : "fail",
      formattedLocation(crawl)
        ? `A business location was detected: ${formattedLocation(crawl)}.`
        : crawl.extractedFacts.serviceAreas.length
          ? `Service areas were detected: ${crawl.extractedFacts.serviceAreas.slice(0, 5).join(", ")}.`
          : "No specific business location or service area was detected.",
      evidence("local_content.location_clarity.content", "content", formattedLocation(crawl) ?? `Service areas: ${crawl.extractedFacts.serviceAreas.join(", ") || "none"}.`, generatedAt, { sourceUrl }),
      "inferred",
      formattedLocation(crawl) || crawl.extractedFacts.serviceAreas.length ? 0.9 : crawlInferenceConfidence),
    result("local_content.service_area_depth",
      serviceAreaNotApplicable
        ? "not_applicable"
        : crawl.extractedFacts.serviceAreas.length >= 2
          ? "pass"
          : crawl.extractedFacts.serviceAreas.length === 1 || Boolean(formattedLocation(crawl))
            ? "warning"
            : input.verticalConfidence < 0.8
              ? "unknown"
              : "fail",
      serviceAreaNotApplicable
        ? `Service-area depth was excluded because ${input.vertical.replaceAll("_", " ")} is a fixed-location category and no service-area claim was detected.`
        : crawl.extractedFacts.serviceAreas.length >= 2
          ? `${crawl.extractedFacts.serviceAreas.length} specific service areas were extracted.`
          : input.verticalConfidence < 0.8 && crawl.extractedFacts.serviceAreas.length === 0 && !formattedLocation(crawl)
            ? "Business-specific service-area applicability could not be established."
            : "Local service-area coverage was limited or not explicit.",
      evidence("local_content.service_area_depth.content", "content", `Extracted service areas: ${crawl.extractedFacts.serviceAreas.join(", ") || "none"}.`, generatedAt, { sourceUrl }),
      "inferred",
      serviceAreaNotApplicable || crawl.extractedFacts.serviceAreas.length ? 0.9 : crawlInferenceConfidence),
    result("local_content.vertical_requirements",
      input.verticalConfidence < 0.8 ? "not_applicable" : verticalContentStatus(input.vertical, visibleText),
      input.verticalConfidence < 0.8
        ? `Vertical-specific requirements were excluded because classification confidence was ${Math.round(input.verticalConfidence * 100)}%.`
        : `The site was checked for ${input.vertical.replaceAll("_", " ")} decision content using the fetched first-party text.`,
      evidence("local_content.vertical_requirements.content", "content", `Vertical: ${input.vertical}; confidence: ${Math.round(input.verticalConfidence * 100)}%.`, generatedAt, { sourceUrl }),
      "inferred",
      input.verticalConfidence),
    result(
      "content.priority_intent_coverage",
      detailedServicePages.length ? "pass" : servicePages.length ? "warning" : "fail",
      detailedServicePages.length
        ? "The highest-ranked service-intent route contained substantive content."
        : servicePages.length
          ? "A service-intent route existed but did not meet the substantive-content threshold."
          : "No service-intent route was available for the requested semantic slot.",
      pageEvidence("content.priority_intent_coverage.pages", detailedServicePages.length ? detailedServicePages : servicePages, generatedAt, sourceUrl),
      "deterministic"
    ),
    result(
      "content.hours_presence",
      !canonicalHours ? "not_applicable" : crawl.extractedFacts.hours ? "pass" : "warning",
      !canonicalHours
        ? "No publish-eligible canonical hours fact was available."
        : crawl.extractedFacts.hours
          ? "Canonical business hours were present in the rendered source evidence."
          : "Canonical business hours were available but not detected in rendered source evidence.",
      evidence("content.hours_presence.content", "content", `Canonical hours available: ${Boolean(canonicalHours)}; rendered hours detected: ${Boolean(crawl.extractedFacts.hours)}.`, generatedAt, { sourceUrl })
    ),

    result("trust.about", aboutPages.length ? "pass" : "warning",
      aboutPages.length ? "An about-oriented page was detected." : "No about-oriented page was detected.",
      pageEvidence("trust.about.pages", aboutPages, generatedAt, sourceUrl),
      "inferred",
      aboutPages.length ? 0.9 : crawlInferenceConfidence),
    result("trust.proof", proofPattern.test(visibleText) ? "pass" : "warning",
      proofPattern.test(visibleText) ? "Credibility proof language was detected in fetched first-party content." : "No clear review, credential, history, or affiliation proof was detected.",
      evidence("trust.proof.content", "content", proofPattern.test(visibleText) ? "First-party proof language matched the deterministic credibility pattern." : "No deterministic credibility pattern matched.", generatedAt, { sourceUrl }),
      "inferred",
      proofPattern.test(visibleText) ? 0.9 : 0.7),
    result("research.proof_availability", proofPattern.test(visibleText) ? "pass" : "warning",
      proofPattern.test(visibleText)
        ? "The first-party crawl supplied usable proof language."
        : "The first-party crawl supplied no usable verified proof; rendered proof quality was assessed separately.",
      evidence("research.proof_availability.content", "content", `First-party proof evidence detected: ${proofPattern.test(visibleText)}.`, generatedAt, { sourceUrl })),
    result("trust.privacy",
      forms.length === 0 ? "not_applicable" : privacyLinked ? "pass" : "fail",
      forms.length === 0
        ? "No lead form was detected, so the form privacy-link check was not applicable."
        : privacyLinked
          ? "A privacy path was linked from the assessed site."
          : "A lead form was detected without a discoverable privacy link.",
      evidence("trust.privacy.crawl", "crawl", `Forms: ${forms.length}; privacy link detected: ${privacyLinked}.`, generatedAt, { sourceUrl })),

    result("accessibility.axe_critical",
      accessibility.adapter === "unavailable" ? "unknown" : axeCritical.length ? "fail" : "pass",
      accessibility.adapter === "unavailable"
        ? "The automated accessibility engine was unavailable."
        : axeCritical.length
          ? `${axeCritical.length} critical rule violation${axeCritical.length === 1 ? " was" : "s were"} detected across ${axeCritical.reduce((total, violation) => total + violation.nodeCount, 0)} node(s).`
          : "No critical axe-core violations were detected on the mobile homepage.",
      axeEvidence("accessibility.axe_critical.axe", axeCritical, accessibility, generatedAt, sourceUrl)),
    result("accessibility.axe_serious",
      accessibility.adapter === "unavailable" ? "unknown" : axeSerious.length ? "fail" : "pass",
      accessibility.adapter === "unavailable"
        ? "The automated accessibility engine was unavailable."
        : axeSerious.length
          ? `${axeSerious.length} serious rule violation${axeSerious.length === 1 ? " was" : "s were"} detected across ${axeSerious.reduce((total, violation) => total + violation.nodeCount, 0)} node(s).`
          : "No serious axe-core violations were detected on the mobile homepage.",
      axeEvidence("accessibility.axe_serious.axe", axeSerious, accessibility, generatedAt, sourceUrl)),
    result("accessibility.image_alt",
      crawl.imageCount === 0 ? "not_applicable" : crawl.imagesWithoutAlt === 0 ? "pass" : crawl.imagesWithoutAlt / crawl.imageCount <= 0.1 ? "warning" : "fail",
      crawl.imageCount === 0
        ? "No images were detected."
        : crawl.imagesWithoutAlt === 0
          ? `All ${crawl.imageCount} crawled image elements included alt attributes.`
          : `${crawl.imagesWithoutAlt} of ${crawl.imageCount} crawled images were missing alt attributes.`,
      evidence("accessibility.image_alt.dom", "crawl", `Images: ${crawl.imageCount}; without alt: ${crawl.imagesWithoutAlt}.`, generatedAt, { sourceUrl })),
    result("accessibility.heading_structure",
      accessibility.adapter === "unavailable" ? "unknown" : axeIds.has("heading-order") || axeIds.has("page-has-heading-one") ? "fail" : "pass",
      accessibility.adapter === "unavailable"
        ? "Heading structure could not be audited."
        : axeIds.has("heading-order") || axeIds.has("page-has-heading-one")
          ? "axe-core detected a heading-order or primary-heading violation."
          : "axe-core did not detect a heading-order or primary-heading violation.",
      evidence("accessibility.heading_structure.axe", "render", `Relevant axe rules detected: ${["heading-order", "page-has-heading-one"].filter((id) => axeIds.has(id)).join(", ") || "none"}.`, generatedAt, { sourceUrl, viewport: "mobile" })),
    result("accessibility.form_labels",
      forms.length === 0 ? "not_applicable" : accessibility.adapter === "unavailable" ? "unknown" : axeIds.has("label") || axeIds.has("aria-input-field-name") ? "fail" : "pass",
      forms.length === 0
        ? "No form controls were detected."
        : accessibility.adapter === "unavailable"
          ? "Form labels could not be audited."
          : axeIds.has("label") || axeIds.has("aria-input-field-name")
            ? "axe-core detected form controls without accessible names."
            : "axe-core did not detect unnamed form controls.",
      evidence("accessibility.form_labels.axe", "render", `Forms: ${forms.length}; relevant axe rules: ${["label", "aria-input-field-name"].filter((id) => axeIds.has(id)).join(", ") || "none"}.`, generatedAt, { sourceUrl, viewport: "mobile" }))
  ];
}

function result(
  id: string,
  status: AssessmentCriterionStatus,
  explanation: string,
  evidenceItem: AssessmentEvidence,
  certainty: AssessmentCriterionInput["certainty"] = "deterministic",
  confidence?: number
): AssessmentCriterionInput {
  const definition = criterionDefinition(id);
  return {
    id,
    dimensionId: definition.dimensionId,
    title: definition.title,
    status,
    impact: definition.impact,
    certainty,
    confidence,
    applicability: definition.applicability,
    explanation,
    businessConsequence: definition.businessConsequence,
    recommendation: definition.recommendation,
    evidence: [evidenceItem],
    pointsPossible: definition.points
  };
}

function evidence(
  id: string,
  kind: AssessmentEvidence["kind"],
  summary: string,
  observedAt: string,
  extra: Partial<AssessmentEvidence> = {}
): AssessmentEvidence {
  return { id, kind, summary: summary.slice(0, 2_000), observedAt, ...extra };
}

function performanceResult(
  id: "performance.lcp" | "performance.inp" | "performance.cls",
  metric: PerformanceMetric,
  performance: WebPerformanceEvidence,
  generatedAt: string,
  sourceUrl: string
) {
  const name = id.split(".")[1].toUpperCase();
  const status = metric.rating === "good"
    ? "pass"
    : metric.rating === "needs_improvement"
      ? "warning"
      : metric.rating === "poor"
        ? "fail"
        : "unknown";
  const sourceLabel = performance.source === "crux_field"
    ? "Google CrUX field data"
    : performance.source === "lab_median"
      ? `the median of ${performance.sampleCount} mobile lab runs`
      : "no available measurement";
  return result(
    id,
    status,
    metric.value === undefined
      ? `${name} was unavailable from ${sourceLabel}.`
      : `${name} measured ${metric.value}${metric.unit === "ms" ? " ms" : ""} from ${sourceLabel}, rated ${metric.rating.replaceAll("_", " ")}.`,
    evidence(`${id}.${performance.source}`, performance.source === "crux_field" ? "field_metric" : "lab_metric", `${name}: ${metric.value ?? "unknown"}${metric.unit === "ms" ? " ms" : ""}; rating: ${metric.rating}; source: ${sourceLabel}.`, generatedAt, {
      sourceUrl,
      value: metric.value,
      unit: metric.unit
    })
  );
}

function probeEvidence(
  id: string,
  probes: DestinationProbeResult,
  kind: "internal" | "primary_external",
  generatedAt: string,
  sourceUrl: string
) {
  const relevant = probes.probes.filter((probe) => probe.kind === kind);
  const failures = relevant.filter((probe) => !probe.ok);
  const samples = failures.length ? failures : relevant.slice(0, 10);
  return evidence(id, "http", `${relevant.length} destination(s) probed; ${failures.length} failed. ${samples.slice(0, 10).map((probe) => `${probe.url} → ${probe.status ?? probe.error ?? "unavailable"}`).join("; ") || "No probe samples."}`, generatedAt, { sourceUrl });
}

function pageEvidence(id: string, pages: CrawlPageSummary[], generatedAt: string, sourceUrl: string) {
  return evidence(id, "crawl", pages.length ? pages.slice(0, 12).map((page) => `${page.url} (${page.purposeTags.join(", ")})`).join("; ") : "No matching pages were found in the crawl.", generatedAt, { sourceUrl });
}

function axeEvidence(
  id: string,
  violations: AutomatedAccessibilityEvidence["violations"],
  accessibility: AutomatedAccessibilityEvidence,
  generatedAt: string,
  sourceUrl: string
) {
  return evidence(id, "render", accessibility.adapter === "unavailable"
    ? `axe-core unavailable: ${accessibility.limitation ?? "unknown reason"}.`
    : violations.length
      ? violations.map((violation) => `${violation.id}: ${violation.nodeCount} node(s); ${violation.samples.slice(0, 2).join(" | ")}`).join("; ")
      : `axe-core ${accessibility.version ?? ""} reported no matching violations.`, generatedAt, { sourceUrl, viewport: "mobile" });
}

function usefulTitle(value?: string) {
  const length = value?.trim().length ?? 0;
  return length >= 10 && length <= 70;
}

function usefulDescription(value?: string) {
  const length = value?.trim().length ?? 0;
  return length >= 50 && length <= 180;
}

function normalized(value?: string) {
  return value?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function ratio(value: number, total: number) {
  return total ? value / total : 0;
}

function formattedLocation(crawl: CrawlAssessment) {
  const address = crawl.extractedFacts.address;
  if (!address) return undefined;
  const value = [address.street, address.city, address.region, address.postalCode].filter(Boolean).join(", ");
  return value || undefined;
}

function inferredJourneys(crawl: CrawlAssessment) {
  const links = crawl.pageSummaries.flatMap((page) => page.linkReferences);
  return unique([
    crawl.hasTelLink ? "Call the business" : undefined,
    crawl.formCount ? "Submit an inquiry" : undefined,
    links.some((link) => link.kind === "booking") ? "Book an appointment" : undefined,
    links.some((link) => link.kind === "ordering") ? "Place an order" : undefined,
    crawl.pageSummaries.some((page) => page.purposeTags.includes("service_detail")) ? "Evaluate a specific service" : undefined,
    crawl.pageSummaries.some((page) => page.purposeTags.includes("location")) ? "Confirm location or service area" : undefined
  ].filter((value): value is string => Boolean(value)));
}

function verticalContentStatus(vertical: string, text: string): AssessmentCriterionStatus {
  const patterns: Record<string, RegExp> = {
    restaurant: /\b(menu|reservation|hours|dietary|catering|takeout)\b/i,
    auto_body: /\b(estimate|insurance|collision|paint|repair process|warranty)\b/i,
    auto_services: /\b(appointment|diagnostic|maintenance|warranty|vehicle)\b/i,
    beauty_salon: /\b(service menu|appointment|stylist|pricing|cancellation)\b/i,
    med_spa: /\b(consultation|candidate|treatment|aftercare|provider)\b/i,
    law_firm: /\b(practice area|consultation|attorney|case|jurisdiction)\b/i,
    dental: /\b(insurance|new patient|appointment|treatment|emergency)\b/i,
    home_services: /\b(estimate|emergency|licensed|service area|warranty)\b/i,
    fitness: /\b(class schedule|membership|trainer|trial|program)\b/i,
    real_estate: /\b(listing|buyer|seller|property|neighborhood)\b/i,
    landscaping: /\b(estimate|seasonal|maintenance|service area|project)\b/i,
    veterinary: /\b(appointment|emergency|patient|vaccination|wellness)\b/i,
    creative_studio: /\b(portfolio|process|project|package|inquiry)\b/i
  };
  const matches = text.match(new RegExp(patterns[vertical]?.source ?? "$^", "gi"))?.length ?? 0;
  return matches >= 3 ? "pass" : matches ? "warning" : "fail";
}

function canonicalSourceKey(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return `url:${url.href}`;
}

function canonicalFactAvailabilityFor(input: {
  crawl: CrawlAssessment;
  buildInput?: SitePublicBuildInput;
}): WebsiteAssessment["canonicalFactAvailability"] {
  const facts = input.crawl.extractedFacts;
  const build = input.buildInput?.business;
  const locations = build?.locations ?? [];
  return {
    businessName: Boolean(build?.name ?? facts.name),
    phone: Boolean(build?.contacts.phone ?? facts.phone),
    email: Boolean(build?.contacts.email ?? facts.email),
    address: Boolean(locations.length || facts.address),
    hours: Boolean(locations.some((location) => location.hours) || facts.hours),
    coordinates: Boolean(
      locations.some((location) => location.latitude !== undefined && location.longitude !== undefined)
      || facts.geo
    ),
    serviceAreas: Boolean(build?.serviceAreas.length || facts.serviceAreas.length),
    proof: Boolean(build?.proof.length || facts.reviewsSummary)
  };
}

function phoneMatches(href: string, canonicalPhone: string) {
  const candidate = href.replace(/^tel:/i, "").replace(/\?.*$/, "");
  const left = candidate.replace(/\D/g, "");
  const right = canonicalPhone.replace(/\D/g, "");
  if (!left || !right) return false;
  return left === right || left.slice(-10) === right.slice(-10);
}

function stableRecord(value: Record<string, string>) {
  return JSON.stringify(Object.entries(value)
    .map(([key, entry]) => [normalized(key), normalized(entry)] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
