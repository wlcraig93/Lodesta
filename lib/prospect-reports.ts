import type { CrawlAssessment } from "./crawler";
import { inferVertical } from "./intake";
import type {
  ProspectPresenceReportResult,
  ProspectReportBucket,
  ProspectReportBucketId,
  ProspectReportFinding,
  ProspectReportGatedPlan,
  ProspectReportRecord,
  ProspectReportSignal,
  ProspectReportStage,
  ProspectWebsiteKind,
  RenderInspectionResult,
  StandardCheckResult,
  StandardCriterion
} from "./models";
import { runUrlPresenceAssessment } from "./presence-assessment-runner";
import { evaluateCrawlAgainstStandard } from "./standard-evaluation";
import { getCriteriaForVertical, standardCriteria } from "./standard";
import { normalizePublicFetchUrlInput } from "./url-safety";

export type ProspectPlaceSuggestion = {
  placeId: string;
  text: string;
};

export type ProspectPlaceDetails = {
  placeId: string;
  websiteUri?: string;
  usMarket: boolean;
};

type BudgetName = "places_autocomplete" | "prospect_scan";

const reusableReportWindowMs = 7 * 24 * 60 * 60 * 1000;
const minimumSignalsForBucketScore = 2;
const noOwnedWebsiteScore = 20;

const searchVisibilityCriteria = new Set([
  "technical.https",
  "technical.healthy_response",
  "seo.title.unique",
  "seo.meta_description",
  "seo.canonical",
  "seo.clean_urls",
  "seo.robots_txt",
  "seo.sitemap",
  "seo.local_business_schema"
]);
const websiteConversionCriteria = new Set([
  "conversion.mobile_click_to_call",
  "conversion.lead_form",
  "conversion.primary_action_above_fold",
  "conversion.mobile_sticky_action"
]);
const localContentCoverageCriteria = new Set(["seo.service_location_pages", "content.service_area_clarity", "content.faqs"]);
const trustMobileCriteria = new Set([
  "trust.reviews_visible",
  "trust.credentials_or_years",
  "technical.mobile_viewport",
  "technical.mobile_performance",
  "accessibility.image_alt"
]);

const bucketLabels: Record<ProspectReportBucketId, string> = {
  search_visibility: "Search Visibility",
  website_conversion: "Website Conversion",
  local_content_coverage: "Local Content Coverage",
  trust_mobile_readiness: "Trust & Mobile Readiness"
};

const socialOrAggregatorHosts = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "threads.net",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "yelp.com",
  "tripadvisor.com",
  "opentable.com",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "toasttab.com",
  "square.site",
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "maps.google.com",
  "google.com",
  "g.page"
];

const budgetState = globalThis as typeof globalThis & {
  __lodestaProspectReportBudget?: Partial<Record<BudgetName, { day: string; used: number }>>;
  __lodestaProspectReportActiveScans?: number;
};

export function recentProspectReportCutoff(now = new Date()) {
  return new Date(now.getTime() - reusableReportWindowMs).toISOString();
}

export function classifyProspectWebsite(value: string | undefined): { kind: ProspectWebsiteKind; url?: string; host?: string } {
  const normalized = value?.trim() ? normalizePublicFetchUrlInput(value) : undefined;
  if (!normalized) return { kind: "no_website" };
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { kind: "no_website" };
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (socialOrAggregatorHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return { kind: "social_or_aggregator", url: parsed.href, host };
  }
  return { kind: "owned_website", url: parsed.href, host };
}

export function consumeProspectBudget(name: BudgetName) {
  const today = new Date().toISOString().slice(0, 10);
  budgetState.__lodestaProspectReportBudget ??= {};
  const current = budgetState.__lodestaProspectReportBudget[name];
  const state = current?.day === today ? current : { day: today, used: 0 };
  const cap = budgetCap(name);
  if (state.used >= cap) {
    console.warn(`Prospect report ${name} daily cap reached (${cap}).`);
    budgetState.__lodestaProspectReportBudget[name] = state;
    return false;
  }
  state.used += 1;
  budgetState.__lodestaProspectReportBudget[name] = state;
  return true;
}

export async function withProspectScanSlot<T>(fn: () => Promise<T>): Promise<T> {
  const active = budgetState.__lodestaProspectReportActiveScans ?? 0;
  if (active >= prospectScanConcurrencyLimit()) {
    throw new Error("Prospect report scan concurrency limit reached.");
  }
  budgetState.__lodestaProspectReportActiveScans = active + 1;
  try {
    return await fn();
  } finally {
    budgetState.__lodestaProspectReportActiveScans = Math.max(0, (budgetState.__lodestaProspectReportActiveScans ?? 1) - 1);
  }
}

export async function searchGoogleProspectPlaces(input: { query: string; sessionToken?: string }): Promise<ProspectPlaceSuggestion[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Google Places search is not configured.");
  if (!consumeProspectBudget("places_autocomplete")) {
    throw new Error("Business search is temporarily over its daily budget.");
  }

  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text"
    },
    body: JSON.stringify({
      input: input.query,
      includedRegionCodes: ["us"],
      includePureServiceAreaBusinesses: true,
      languageCode: "en",
      regionCode: "us",
      ...(input.sessionToken ? { sessionToken: input.sessionToken } : {})
    }),
    signal: AbortSignal.timeout(5000)
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(googleErrorMessage(payload) ?? `Google Places Autocomplete failed with status ${response.status}`);
  return suggestionsFromAutocomplete(payload);
}

export async function resolveGoogleProspectPlace(input: {
  placeId: string;
  sessionToken?: string;
}): Promise<ProspectPlaceDetails> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Google Places details are not configured.");
  const params = new URLSearchParams();
  if (input.sessionToken) params.set("sessionToken", input.sessionToken);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(input.placeId)}${suffix}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,websiteUri,formattedAddress,addressComponents,businessStatus,types"
    },
    signal: AbortSignal.timeout(5000)
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(googleErrorMessage(payload) ?? `Google Place Details failed with status ${response.status}`);
  if (!isRecord(payload)) throw new Error("Google Place Details returned an invalid response.");
  return {
    placeId: stringValue(payload.id) ?? input.placeId,
    websiteUri: stringValue(payload.websiteUri),
    usMarket: isUsPlace(payload)
  };
}

export async function runProspectPresenceReport(report: ProspectReportRecord): Promise<ProspectPresenceReportResult> {
  if (report.websiteKind !== "owned_website" || !report.sourceUrl) {
    return noOwnedWebsiteReport(report);
  }
  return withProspectScanSlot(async () => {
    const run = await runUrlPresenceAssessment({
      url: report.sourceUrl!,
      render: true,
      captureScreenshots: false,
      publicPresence: "skip"
    });
    if (!run.renderInspection) throw new Error("Render inspection did not run.");
    return ownedWebsiteReport(report, run.crawl, run.renderInspection, run.url);
  });
}

export function publicProspectReport(report: ProspectReportRecord) {
  const unlocked = Boolean(report.unlockedAt);
  const result = report.result
    ? {
        ...report.result,
        gatedPlan: unlocked ? report.result.gatedPlan : undefined
      }
    : undefined;
  return {
    id: report.id,
    status: report.status,
    websiteKind: report.websiteKind,
    sourceUrl: report.sourceUrl,
    sourceHost: report.sourceHost,
    unlocked,
    result,
    error: report.status === "failed" ? "The scan could not finish. Try again later or contact Lodesta." : undefined,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    completedAt: report.completedAt
  };
}

export function prospectReportContainsForbiddenGoogleData(value: unknown) {
  const forbiddenKeys = new Set([
    "rating",
    "userratingcount",
    "reviewcount",
    "reviewcounts",
    "reviews",
    "review",
    "photos",
    "photo",
    "googlemapsuri",
    "googlemapsurl",
    "mapsurl"
  ]);
  const inspect = (candidate: unknown): boolean => {
    if (typeof candidate === "string") {
      const normalized = candidate.toLowerCase();
      return normalized.includes("maps.google") || normalized.includes("google.com/maps");
    }
    if (!candidate || typeof candidate !== "object") return false;
    if (Array.isArray(candidate)) return candidate.some(inspect);
    return Object.entries(candidate).some(([key, nested]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      return forbiddenKeys.has(normalizedKey) || inspect(nested);
    });
  };
  return inspect(value);
}

export function bucketForStandardCriterion(criterion: Pick<StandardCriterion, "id">): ProspectReportBucketId | undefined {
  if (searchVisibilityCriteria.has(criterion.id)) return "search_visibility";
  if (websiteConversionCriteria.has(criterion.id)) return "website_conversion";
  if (localContentCoverageCriteria.has(criterion.id) || criterion.id.startsWith("content.")) return "local_content_coverage";
  if (trustMobileCriteria.has(criterion.id)) return "trust_mobile_readiness";
  return undefined;
}

export function unmappedStandardCriteria() {
  return standardCriteria.filter((criterion) => !bucketForStandardCriterion(criterion)).map((criterion) => criterion.id);
}

function ownedWebsiteReport(
  report: ProspectReportRecord,
  crawl: CrawlAssessment,
  renderInspection: RenderInspectionResult,
  sourceUrl: string
): ProspectPresenceReportResult {
  const evaluation = evaluateCrawlAgainstStandard(crawl);
  const vertical = inferVertical({ url: sourceUrl });
  const criteria = getCriteriaForVertical(vertical);
  const buckets = buildBuckets(evaluation.checks, crawl, renderInspection, criteria);
  const findings = buildFindings(buckets);
  const result: ProspectPresenceReportResult = {
    version: "prospect-presence-report-v1",
    generatedAt: new Date().toISOString(),
    websiteKind: "owned_website",
    sourceUrl,
    sourceHost: hostFromUrl(sourceUrl),
    overallScore: evaluation.score.percent,
    overallLabel: labelForScore(evaluation.score.percent),
    scoreSource: "crawl_standard",
    buckets,
    findings,
    stages: [
      stage("place", "Business listing selected", "completed"),
      stage("website", "Owned website detected", "completed"),
      stage("crawl", "Website crawl completed", crawl.fetched ? "completed" : "failed"),
      stage("render", "Browser render inspection completed", renderInspection.adapter ? "completed" : "skipped"),
      stage("report", "Report assembled", "completed")
    ],
    gatedPlan: gatedPlanForFindings(findings, "owned_website")
  };
  return result;
}

function noOwnedWebsiteReport(report: ProspectReportRecord): ProspectPresenceReportResult {
  const sourceHost = report.sourceHost ?? hostFromUrl(report.sourceUrl);
  const socialOnly = report.websiteKind === "social_or_aggregator";
  const finding: ProspectReportFinding = {
    id: "no_owned_website",
    bucketId: "search_visibility",
    bucketLabel: bucketLabels.search_visibility,
    severity: "fail",
    title: socialOnly ? "The listing points to a profile, not an owned website" : "No owned website is attached to this listing",
    consequence: socialOnly
      ? "Local customers leave the business listing for a third-party profile instead of an owned conversion path."
      : "Searchers have no owned place to evaluate services, trust proof, and contact options.",
    evidence: socialOnly && sourceHost ? `Detected ${sourceHost} as the attached website.` : "No crawlable owned website URL was available.",
    lodestaFix: "Create an owned, mobile-ready website with service, trust, contact, schema, and local landing-page structure."
  };
  return {
    version: "prospect-presence-report-v1",
    generatedAt: new Date().toISOString(),
    websiteKind: report.websiteKind,
    sourceUrl: report.sourceUrl,
    sourceHost,
    overallScore: noOwnedWebsiteScore,
    overallLabel: "No owned website detected",
    scoreSource: "no_owned_website",
    buckets: [
      emptyBucket("search_visibility", [signal("no_owned_website", "Owned website attached", false, 0, 10, "crawl", finding.evidence)]),
      emptyBucket("website_conversion"),
      emptyBucket("local_content_coverage"),
      emptyBucket("trust_mobile_readiness")
    ],
    findings: [finding],
    stages: [
      stage("place", "Business listing selected", "completed"),
      stage("website", socialOnly ? "Social/profile link detected" : "No owned website detected", "completed"),
      stage("crawl", "Website crawl skipped", "skipped"),
      stage("render", "Browser render inspection skipped", "skipped"),
      stage("report", "Report assembled", "completed")
    ],
    gatedPlan: gatedPlanForFindings([finding], report.websiteKind)
  };
}

function buildBuckets(
  checks: StandardCheckResult[],
  crawl: CrawlAssessment,
  renderInspection: RenderInspectionResult,
  criteria: StandardCriterion[]
): ProspectReportBucket[] {
  const crawlChecksById = new Map(crawl.score.checks.map((check) => [check.standardCriterionId, check]));
  const standardChecksById = new Map(checks.map((check) => [check.criterionId, check]));
  const activeCriterionIds = new Set(criteria.map((criterion) => criterion.id));
  const signalsByBucket: Record<ProspectReportBucketId, ProspectReportSignal[]> = {
    search_visibility: [],
    website_conversion: [],
    local_content_coverage: [],
    trust_mobile_readiness: []
  };

  for (const criterion of criteria) {
    const bucket = bucketForStandardCriterion(criterion);
    if (!bucket || !activeCriterionIds.has(criterion.id)) continue;
    const crawlCheck = crawlChecksById.get(criterion.id);
    const standardCheck = standardChecksById.get(criterion.id);
    if (crawlCheck && standardCheck && (criterion.checkMethod === "crawl" || criterion.checkMethod === "dom")) {
      signalsByBucket[bucket].push(
        signal(
          criterion.id,
          standardCheck.title,
          crawlCheck.passed,
          crawlCheck.points,
          crawlCheck.maxPoints,
          "crawl",
          standardCheck.evidence
        )
      );
    }
  }

  signalsByBucket.website_conversion.push(...conversionRenderSignals(renderInspection));
  signalsByBucket.trust_mobile_readiness.push(...trustMobileRenderSignals(renderInspection));

  return (Object.keys(bucketLabels) as ProspectReportBucketId[]).map((bucketId) => scoreBucket(bucketId, signalsByBucket[bucketId]));
}

function conversionRenderSignals(renderInspection: RenderInspectionResult): ProspectReportSignal[] {
  const aboveFold = Boolean(renderInspection.metrics.aboveFoldCtaDetected);
  const mobileSticky = Boolean(renderInspection.metricsByViewport?.mobile?.rects?.stickyCta);
  return [
    signal(
      "conversion.primary_action_above_fold",
      "Primary action is visible above the fold",
      aboveFold,
      aboveFold ? 10 : 0,
      10,
      "render",
      aboveFold ? "A CTA-like action appeared in the first viewport." : "No CTA-like action appeared in the first viewport."
    ),
    signal(
      "conversion.mobile_sticky_action",
      "Mobile sticky action is available",
      mobileSticky,
      mobileSticky ? 10 : 0,
      10,
      "render",
      mobileSticky ? "A mobile sticky action was detected." : "No mobile sticky action was detected."
    )
  ];
}

function trustMobileRenderSignals(renderInspection: RenderInspectionResult): ProspectReportSignal[] {
  const mobile = renderInspection.metricsByViewport?.mobile;
  const noHorizontalOverflow = (mobile?.horizontalOverflowPx ?? renderInspection.metrics.horizontalOverflowPx ?? 0) <= 8;
  const readableText = (mobile?.minReadableTextFontSizePx ?? renderInspection.metrics.minReadableTextFontSizePx ?? 16) >= 14;
  return [
    signal(
      "render.mobile_no_overflow",
      "Mobile layout avoids horizontal overflow",
      noHorizontalOverflow,
      noHorizontalOverflow ? 5 : 0,
      5,
      "render",
      `${mobile?.horizontalOverflowPx ?? renderInspection.metrics.horizontalOverflowPx ?? 0}px horizontal overflow detected.`
    ),
    signal(
      "render.mobile_readable_text",
      "Mobile text remains readable",
      readableText,
      readableText ? 5 : 0,
      5,
      "render",
      `${mobile?.minReadableTextFontSizePx ?? renderInspection.metrics.minReadableTextFontSizePx ?? "unknown"}px minimum readable text size detected.`
    )
  ];
}

function scoreBucket(id: ProspectReportBucketId, signals: ProspectReportSignal[]): ProspectReportBucket {
  const points = signals.reduce((total, item) => total + item.points, 0);
  const maxPoints = signals.reduce((total, item) => total + item.maxPoints, 0);
  const scoredSignals = signals.length;
  const score = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : undefined;
  return {
    id,
    label: bucketLabels[id],
    score: scoredSignals >= minimumSignalsForBucketScore ? score : undefined,
    scoredSignals,
    maxPoints,
    points,
    status: scoredSignals >= minimumSignalsForBucketScore ? "scored" : "not_enough_signal",
    signals
  };
}

function emptyBucket(id: ProspectReportBucketId, signals: ProspectReportSignal[] = []): ProspectReportBucket {
  return scoreBucket(id, signals);
}

function buildFindings(buckets: ProspectReportBucket[]): ProspectReportFinding[] {
  const all = buckets.flatMap((bucket) =>
    bucket.signals
      .filter((item) => !item.passed)
      .map((item): ProspectReportFinding => ({
        id: item.id,
        bucketId: bucket.id,
        bucketLabel: bucket.label,
        severity: item.maxPoints >= 10 ? "fail" : "warning",
        title: item.label,
        consequence: consequenceForSignal(item.id),
        evidence: item.evidence,
        lodestaFix: lodestaFixForSignal(item.id)
      }))
  );
  return all.sort((left, right) => severityRank(right.severity) - severityRank(left.severity)).slice(0, 5);
}

function gatedPlanForFindings(findings: ProspectReportFinding[], websiteKind: ProspectWebsiteKind): ProspectReportGatedPlan {
  if (websiteKind !== "owned_website") {
    return {
      summary: "Lodesta would start with an owned website foundation before optimizing deeper local-presence signals.",
      priorities: [
        {
          title: "Create the owned website",
          detail: "Build a crawlable mobile site with services, location coverage, calls to action, and owner-verified business facts."
        },
        {
          title: "Connect local trust",
          detail: "Add proof, contact paths, and structured data without copying third-party review or photo content."
        }
      ]
    };
  }
  const priorities = findings.slice(0, 4).map((finding) => ({
    title: finding.title,
    detail: finding.lodestaFix
  }));
  return {
    summary: priorities.length
      ? "Lodesta would turn the scan findings into a managed website improvement plan."
      : "Lodesta would keep monitoring the website and improve the next useful local-presence opportunity.",
    priorities: priorities.length
      ? priorities
      : [
          {
            title: "Keep the site maintained",
            detail: "Continue monitoring conversion, search visibility, trust proof, and local content coverage."
          }
        ]
  };
}

function consequenceForSignal(id: string) {
  const criterion = standardCriteria.find((candidate) => candidate.id === id);
  if (criterion) return criterion.businessConsequence;
  if (id === "render.mobile_no_overflow") return "Mobile visitors may leave when content spills sideways or becomes hard to use.";
  if (id === "render.mobile_readable_text") return "Small mobile text makes service details and contact paths harder to evaluate.";
  return "This issue can reduce local-search confidence or conversion.";
}

function lodestaFixForSignal(id: string) {
  if (id.startsWith("seo.")) return "Repair the technical SEO structure and generate clean, page-specific metadata.";
  if (id.startsWith("technical.")) return "Fix the website foundation so visitors and search engines can reliably use the site.";
  if (id.startsWith("conversion.") || id.startsWith("render.")) return "Rebuild the page structure around clear mobile actions, forms, and call paths.";
  if (id.startsWith("trust.")) return "Add owner-verifiable trust proof near conversion paths.";
  if (id.startsWith("content.")) return "Add service, local-area, and FAQ content from verified business facts.";
  if (id.startsWith("accessibility.")) return "Improve image accessibility and descriptive media context.";
  return "Prioritize this issue in the managed improvement plan.";
}

function signal(
  id: string,
  label: string,
  passed: boolean,
  points: number,
  maxPoints: number,
  source: ProspectReportSignal["source"],
  evidence: string
): ProspectReportSignal {
  return { id, label, passed, points, maxPoints, source, evidence };
}

function stage(id: string, label: string, status: ProspectReportStage["status"]): ProspectReportStage {
  return { id, label, status };
}

function labelForScore(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 55) return "Needs work";
  return "Poor";
}

function severityRank(severity: ProspectReportFinding["severity"]) {
  return severity === "fail" ? 2 : 1;
}

function suggestionsFromAutocomplete(payload: unknown): ProspectPlaceSuggestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.suggestions)) return [];
  return payload.suggestions
    .map((suggestion) => (isRecord(suggestion) ? suggestion.placePrediction : undefined))
    .filter(isRecord)
    .map((prediction) => ({
      placeId: stringValue(prediction.placeId) ?? "",
      text: localizedPredictionText(prediction.text) ?? ""
    }))
    .filter((suggestion) => suggestion.placeId && suggestion.text)
    .slice(0, 5);
}

function localizedPredictionText(value: unknown) {
  if (!isRecord(value)) return undefined;
  return stringValue(value.text);
}

function isUsPlace(payload: Record<string, unknown>) {
  const formatted = stringValue(payload.formattedAddress);
  if (formatted && /,\s*USA$/i.test(formatted)) return true;
  const components = Array.isArray(payload.addressComponents) ? payload.addressComponents : [];
  return components.some((component) => {
    if (!isRecord(component)) return false;
    const types = Array.isArray(component.types) ? component.types.map(String) : [];
    return types.includes("country") && stringValue(component.shortText)?.toUpperCase() === "US";
  });
}

function budgetCap(name: BudgetName) {
  const envName =
    name === "places_autocomplete"
      ? "LODESTA_PROSPECT_REPORT_PLACES_DAILY_CAP"
      : "LODESTA_PROSPECT_REPORT_SCAN_DAILY_CAP";
  const fallback = name === "places_autocomplete" ? 500 : 100;
  const parsed = Number.parseInt(process.env[envName] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function prospectScanConcurrencyLimit() {
  const parsed = Number.parseInt(process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function googleErrorMessage(payload: unknown) {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (!isRecord(error)) return undefined;
  return stringValue(error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
