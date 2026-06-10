import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CrawlAssessment } from "./crawler";
import { crawlUrl, scoreCrawlAssessment, summarizeCrawlHtml } from "./crawler";
import type { RenderInspectionResult, RenderViewportMetrics } from "./models";
import { inspectHtmlRender, inspectUrlRender } from "./render-inspection";

export type MarketBenchmarkMode = "fixture" | "google_places" | "csv";

export type MarketBenchmarkCandidateStatus = "accepted" | "rejected" | "needs_review";

export type MarketBenchmarkRawCandidate = {
  placeId?: string;
  name: string;
  websiteUrl?: string;
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  query: string;
  observedAt: string;
  source: MarketBenchmarkMode;
  types: string[];
  primaryTypeDisplayName?: string;
  businessStatus?: string;
  fixtureHtmlPath?: string;
};

export type MarketBenchmarkCandidate = MarketBenchmarkRawCandidate & {
  id: string;
  status: MarketBenchmarkCandidateStatus;
  normalizedWebsiteUrl?: string;
  rootDomain?: string;
  reasons: string[];
};

export type MarketBenchmarkSectionType =
  | "hero"
  | "nav"
  | "trust_strip"
  | "services"
  | "gallery_before_after"
  | "reviews"
  | "process"
  | "faq"
  | "quote_contact"
  | "map_location"
  | "footer"
  | "unknown";

export type MarketBenchmarkSection = {
  index: number;
  type: MarketBenchmarkSectionType;
  confidence: number;
  tagName: string;
  heading?: string;
  textSample: string;
  top: number;
  height: number;
  width: number;
  ctaCount: number;
  imageCount: number;
  formCount: number;
  linkCount: number;
  signals: string[];
};

export type MarketBenchmarkSectionMap = {
  sourceUrl: string;
  capturedAt: string;
  adapter: "playwright" | "static_fallback";
  sections: MarketBenchmarkSection[];
  notes: string[];
};

export type MarketBenchmarkDimension =
  | "technicalHealth"
  | "mobileUsability"
  | "conversionClarity"
  | "localTrust"
  | "autoSpecificProof"
  | "visualSectionQuality";

export type MarketBenchmarkScoreCheck = {
  id: string;
  label: string;
  points: number;
  max: number;
  evidence: string;
};

export type MarketBenchmarkDimensionScore = {
  score: number;
  checks: MarketBenchmarkScoreCheck[];
};

export type MarketBenchmarkScores = {
  dimensions: Record<MarketBenchmarkDimension, MarketBenchmarkDimensionScore>;
  composites: {
    defaultComposite: number;
  };
  weights: Record<MarketBenchmarkDimension, number>;
  rawSignals: Record<string, unknown>;
};

export type MarketBenchmarkSiteResult = {
  candidate: MarketBenchmarkCandidate;
  crawl: CrawlAssessment;
  render?: RenderInspectionResult;
  sections: MarketBenchmarkSectionMap;
  scores: MarketBenchmarkScores;
  artifactDir: string;
};

export type MarketBenchmarkRunResult = {
  runId: string;
  artifactRoot: string;
  reportPath: string;
  candidates: {
    accepted: MarketBenchmarkCandidate[];
    rejected: MarketBenchmarkCandidate[];
    needsReview: MarketBenchmarkCandidate[];
  };
  siteResults: MarketBenchmarkSiteResult[];
};

export type RunMarketBenchmarkOptions = {
  mode: MarketBenchmarkMode;
  csvPath?: string;
  fixtureRoot?: string;
  artifactRoot?: string;
  runId?: string;
  limit?: number;
  render?: boolean;
  screenshots?: boolean;
};

type PlacesApiPlace = Record<string, unknown>;

type RawMarketBenchmarkSection = Omit<MarketBenchmarkSection, "type" | "confidence" | "signals"> & {
  className?: string;
  role?: string | null;
  id?: string;
};

const austinAutoQueries = [
  "auto body shop Austin TX",
  "collision repair Austin TX",
  "tire shop Austin TX",
  "mechanic Austin TX",
  "auto repair Austin TX",
  "dent repair Austin TX",
  "paint repair Austin TX",
  "windshield repair Austin TX",
  "auto glass Austin TX"
];

const dealerTerms = [
  "ford",
  "toyota",
  "chevrolet",
  "honda",
  "nissan",
  "kia",
  "hyundai",
  "subaru",
  "bmw",
  "mercedes",
  "audi",
  "mazda",
  "volkswagen",
  "dealer",
  "dealership",
  "sales",
  "pre-owned",
  "preowned",
  "inventory"
];

const franchiseTerms = [
  "caliber",
  "gerber",
  "crash champions",
  "maaco",
  "service king",
  "midas",
  "meineke",
  "firestone",
  "pep boys",
  "jiffy lube",
  "take 5",
  "discount tire",
  "christian brothers"
];

const listingDomains = ["facebook.com", "yelp.com", "repairpal.com", "carwise.com", "bbb.org", "yellowpages.com"];

export const defaultMarketBenchmarkWeights: Record<MarketBenchmarkDimension, number> = {
  technicalHealth: 0.15,
  mobileUsability: 0.15,
  conversionClarity: 0.2,
  localTrust: 0.2,
  autoSpecificProof: 0.2,
  visualSectionQuality: 0.1
};

const dimensions: MarketBenchmarkDimension[] = [
  "technicalHealth",
  "mobileUsability",
  "conversionClarity",
  "localTrust",
  "autoSpecificProof",
  "visualSectionQuality"
];

export async function runMarketBenchmark(options: RunMarketBenchmarkOptions): Promise<MarketBenchmarkRunResult> {
  const limit = clampInteger(options.limit ?? 50, 1, 100);
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = join(options.artifactRoot ?? join(process.cwd(), ".data", "market-benchmarks", "austin-auto"), runId);
  const fixtureRoot = options.fixtureRoot ?? join(process.cwd(), "fixtures", "market-benchmark", "austin-auto");
  await mkdir(artifactRoot, { recursive: true });

  const rawCandidates = await discoverMarketBenchmarkCandidates({ ...options, fixtureRoot });
  const candidates = filterMarketBenchmarkCandidates(rawCandidates, { limit });
  await writeJson(join(artifactRoot, "candidates.json"), candidates);

  const siteResults: MarketBenchmarkSiteResult[] = [];
  for (const candidate of candidates.accepted) {
    if (!candidate.normalizedWebsiteUrl) continue;
    const artifactDir = join(artifactRoot, "sites", candidate.id);
    await mkdir(artifactDir, { recursive: true });
    const fixtureHtml = await readFixtureHtml(candidate, fixtureRoot);

    const crawl = fixtureHtml
      ? crawlAssessmentFromFixtureHtml(fixtureHtml, candidate.normalizedWebsiteUrl)
      : await crawlUrl(candidate.normalizedWebsiteUrl);
    await writeJson(join(artifactDir, "crawl.json"), crawl);

    const render =
      options.render === false
        ? undefined
        : fixtureHtml
          ? await inspectHtmlRender({
              html: fixtureHtml,
              sourceUrl: candidate.normalizedWebsiteUrl,
              target: "source_site",
              captureScreenshots: options.screenshots ?? true,
              artifactRoot: artifactDir
            })
          : await inspectUrlRender({
              url: candidate.normalizedWebsiteUrl,
              target: "source_site",
              captureScreenshots: options.screenshots ?? true,
              artifactRoot: artifactDir
            });
    if (render) await writeJson(join(artifactDir, "render.json"), render);

    const sections = await extractMarketBenchmarkSections({
      sourceUrl: candidate.normalizedWebsiteUrl,
      html: fixtureHtml
    });
    await writeJson(join(artifactDir, "sections.json"), sections);

    const scores = scoreMarketBenchmarkSite({ candidate, crawl, render, sections });
    await writeJson(join(artifactDir, "scores.json"), scores);

    siteResults.push({ candidate, crawl, render, sections, scores, artifactDir });
  }

  const reportPath = join(artifactRoot, "report.md");
  await writeFile(reportPath, renderMarketBenchmarkReport({ runId, artifactRoot, reportPath, candidates, siteResults }), "utf8");
  return { runId, artifactRoot, reportPath, candidates, siteResults };
}

export async function discoverMarketBenchmarkCandidates(options: {
  mode: MarketBenchmarkMode;
  csvPath?: string;
  fixtureRoot?: string;
}): Promise<MarketBenchmarkRawCandidate[]> {
  if (options.mode === "fixture") return readFixtureCandidates(options.fixtureRoot ?? defaultFixtureRoot());
  if (options.mode === "csv") {
    if (!options.csvPath) throw new Error("CSV mode requires --csv <path>.");
    return readCsvCandidates(options.csvPath);
  }
  return fetchGooglePlacesCandidates();
}

export function filterMarketBenchmarkCandidates(
  rawCandidates: MarketBenchmarkRawCandidate[],
  options: { limit?: number } = {}
): MarketBenchmarkRunResult["candidates"] {
  const limit = clampInteger(options.limit ?? 50, 1, 100);
  const accepted: MarketBenchmarkCandidate[] = [];
  const rejected: MarketBenchmarkCandidate[] = [];
  const needsReview: MarketBenchmarkCandidate[] = [];
  const seenPlaceIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenDomains = new Set<string>();

  for (const raw of rawCandidates) {
    const normalizedWebsiteUrl = raw.websiteUrl ? normalizeWebsiteUrl(raw.websiteUrl) : undefined;
    const rootDomain = normalizedWebsiteUrl ? rootDomainForUrl(normalizedWebsiteUrl) : undefined;
    const candidate: MarketBenchmarkCandidate = {
      ...raw,
      id: candidateId(raw, normalizedWebsiteUrl),
      status: "needs_review",
      normalizedWebsiteUrl,
      rootDomain,
      reasons: []
    };

    const duplicateReason = duplicateCandidateReason(candidate, seenPlaceIds, seenUrls, seenDomains);
    if (duplicateReason) {
      rejected.push({ ...candidate, status: "rejected", reasons: [duplicateReason] });
      continue;
    }

    if (candidate.placeId) seenPlaceIds.add(candidate.placeId);
    if (candidate.normalizedWebsiteUrl) seenUrls.add(candidate.normalizedWebsiteUrl);
    if (candidate.rootDomain) seenDomains.add(candidate.rootDomain);

    const classification = classifyCandidate(candidate);
    if (classification.status === "accepted" && accepted.length >= limit) {
      rejected.push({ ...candidate, status: "rejected", reasons: ["accepted_limit_reached"] });
      continue;
    }
    const classified = { ...candidate, status: classification.status, reasons: classification.reasons };
    if (classification.status === "accepted") accepted.push(classified);
    else if (classification.status === "rejected") rejected.push(classified);
    else needsReview.push(classified);
  }

  return { accepted, rejected, needsReview };
}

export async function extractMarketBenchmarkSections(input: {
  sourceUrl: string;
  html?: string;
}): Promise<MarketBenchmarkSectionMap> {
  const capturedAt = new Date().toISOString();
  try {
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({ headless: true, timeout: 15000 });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        if (input.html) {
          await page.setContent(input.html, { waitUntil: "domcontentloaded", timeout: 15000 });
        } else {
          await page.goto(input.sourceUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        }
        await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
        const sections = await page.evaluate<RawMarketBenchmarkSection[]>(collectMarketBenchmarkSectionsScript());
        return {
          sourceUrl: input.sourceUrl,
          capturedAt,
          adapter: "playwright",
          sections: sections.map(classifyRawSection),
          notes: []
        };
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    return staticSectionFallback(input.sourceUrl, input.html, capturedAt, error instanceof Error ? error.message : String(error));
  }
}

export function scoreMarketBenchmarkSite(input: {
  candidate: MarketBenchmarkCandidate;
  crawl: CrawlAssessment;
  render?: RenderInspectionResult;
  sections: MarketBenchmarkSectionMap;
}): MarketBenchmarkScores {
  const { candidate, crawl, render, sections } = input;
  const dimensionsByName: Record<MarketBenchmarkDimension, MarketBenchmarkDimensionScore> = {
    technicalHealth: scoreDimension([
      check("healthy_response", "Healthy HTML response", Boolean(crawl.fetched && crawl.status && crawl.status < 400), 25, `${crawl.status ?? "no"} status observed.`),
      check("https", "HTTPS final URL", isHttps(crawl.finalUrl ?? crawl.url), 15, crawl.finalUrl ?? crawl.url),
      check("viewport", "Mobile viewport meta", crawl.hasViewportMeta, 15, crawl.hasViewportMeta ? "Viewport meta detected." : "Viewport meta not detected."),
      check("title_description", "Useful title and description", Boolean(crawl.title && crawl.title.length >= 25 && crawl.metaDescription && crawl.metaDescription.length >= 80), 15, `${crawl.title?.length ?? 0} title chars; ${crawl.metaDescription?.length ?? 0} description chars.`),
      check("robots_sitemap", "Robots or sitemap signal", crawl.robotsFound || crawl.sitemapFound, 10, `robots=${crawl.robotsFound}; sitemap=${crawl.sitemapFound}.`),
      check("local_business_schema", "LocalBusiness-like schema", crawl.hasLocalBusinessSchema, 10, crawl.jsonLdTypes.join(", ") || "No local schema type detected."),
      ratioCheck("image_health", "Image alt and render health", imageHealthRatio(crawl, render), 10, `${crawl.imagesWithoutAlt}/${crawl.imageCount} crawled images missing alt; ${render?.metrics.brokenImageCount ?? 0} broken rendered images.`)
    ]),
    mobileUsability: scoreDimension([
      check("render_available", "Render metrics available", Boolean(render && !render.unavailableReason), 10, render?.unavailableReason ?? render?.adapter ?? "No render run."),
      ratioCheck("overflow", "No horizontal overflow", noOverflowRatio(render), 25, `${render?.metrics.horizontalOverflowPx ?? "unknown"} max overflow px.`),
      ratioCheck("font_size", "Readable mobile text sizing", fontSizeRatio(render?.metricsByViewport?.mobile), 20, `${render?.metricsByViewport?.mobile?.minReadableTextFontSizePx ?? "unknown"}px minimum readable mobile text.`),
      ratioCheck("contrast", "Readable contrast", contrastRatioScore(render), 20, `${render?.metrics.minTextContrastRatio ?? "unknown"} minimum detected contrast.`),
      ratioCheck("loaded_media", "Rendered images load", loadedImageRatio(render), 15, `${render?.metrics.loadedImageCount ?? 0}/${render?.metrics.imageCount ?? 0} rendered images loaded.`),
      ratioCheck("layout_stability", "No severe cramped or overlap signals", layoutCleanRatio(render), 10, `${render?.metrics.crampedTextCount ?? 0} cramped samples; ${render?.metrics.visualOverlapCount ?? 0} overlap samples.`)
    ]),
    conversionClarity: scoreDimension([
      check("above_fold_cta", "CTA appears in first viewport", Boolean(render?.metrics.aboveFoldCtaDetected || sections.sections.some((section) => section.type === "hero" && section.ctaCount > 0)), 25, render?.metrics.aboveFoldCtaDetected ? "Render metrics detected an above-fold CTA." : "Hero section CTA inferred from geometry."),
      check("tel_link", "Click-to-call available", crawl.hasTelLink, 20, `${crawl.linkReferences.filter((link) => link.kind === "tel").length} tel links detected.`),
      check("form_or_quote", "Estimate/contact form path", crawl.formCount > 0 || sectionsContain(sections, "quote_contact") || textMatches(crawlText(crawl), /quote|estimate|appointment|schedule|contact/i), 25, `${crawl.formCount} forms; quote/contact section=${sectionsContain(sections, "quote_contact")}.`),
      check("repeated_action", "Repeated action path", (render?.metrics.ctaCount ?? 0) >= 2 || crawl.linkReferences.filter((link) => link.kind === "tel" || link.kind === "booking").length >= 2, 15, `${render?.metrics.ctaCount ?? 0} CTA-like rendered elements.`),
      check("service_next_step", "Service next step is clear", textMatches(crawlText(crawl), /repair|service|collision|paint|tire|dent|glass|windshield/i), 15, "Auto service language found in crawl text or extracted services.")
    ]),
    localTrust: scoreDimension([
      check("reviews", "Reviews or testimonials visible", trustText(crawl, sections, /review|testimonial|rating|stars?|google/i), 20, "Review/testimonial/rating language checked in crawl and sections."),
      check("address_hours_map", "Address, hours, or map clarity", hasLocationEvidence(crawl, sections), 25, `address=${Boolean(crawl.extractedFacts.address?.city || crawl.extractedFacts.address?.street)}; hours=${Boolean(crawl.extractedFacts.hours)}; mapSection=${sectionsContain(sections, "map_location")}.`),
      check("credentials", "Credentials, years, certification, or insurance proof", trustText(crawl, sections, /certified|certification|i-car|ase|insured|insurance|years|warranty|guarantee/i), 20, "Credential/trust keywords checked."),
      check("local_imagery", "Real shop/team/local imagery", (crawl.imageCount >= 3 || (render?.metrics.imageCount ?? 0) >= 3) && imageHealthRatio(crawl, render) >= 0.5, 15, `${crawl.imageCount} crawled images; ${render?.metrics.imageCount ?? 0} rendered images.`),
      check("consistent_contact", "Contact facts are consistent and visible", Boolean((crawl.extractedFacts.phone || crawl.hasTelLink) && (crawl.extractedFacts.address?.city || crawl.extractedFacts.hours || sectionsContain(sections, "map_location"))), 20, `phone=${Boolean(crawl.extractedFacts.phone || crawl.hasTelLink)}; local facts=${Boolean(crawl.extractedFacts.address?.city || crawl.extractedFacts.hours)}.`)
    ]),
    autoSpecificProof: scoreDimension([
      ratioCheck("specific_services", "Specific automotive services", serviceCoverageRatio(crawl, sections, candidate), 30, `${crawl.extractedFacts.services.length} extracted services.`),
      check("before_after_gallery", "Before/after or gallery proof", sectionsContain(sections, "gallery_before_after") || textMatches(crawlText(crawl), /before|after|gallery|photos?|portfolio|work/i), 25, `gallery section=${sectionsContain(sections, "gallery_before_after")}.`),
      check("claims_process", "Claims, insurance, or repair process", textMatches(crawlText(crawl), /claim|insurance|deductible|estimate|process|tow|rental|warranty/i) || sectionsContain(sections, "process"), 20, `process section=${sectionsContain(sections, "process")}.`),
      ratioCheck("category_coverage", "Category coverage matches automotive repair", categoryCoverageRatio(crawl, candidate), 15, `${candidate.query}; ${candidate.types.join(", ")}.`),
      check("expectation_cues", "Warranty, timeline, or customer expectation cues", textMatches(crawlText(crawl), /warranty|guarantee|same day|timeline|turnaround|lifetime|pickup|drop[- ]?off/i), 10, "Warranty/timeline/customer expectation keywords checked.")
    ]),
    visualSectionQuality: scoreDimension([
      check("hero", "Hero-like first viewport identified", sectionsContain(sections, "hero"), 20, `hero=${sectionsContain(sections, "hero")}.`),
      ratioCheck("section_variety", "Section variety and rhythm", sectionVarietyRatio(sections), 25, `${unique(sections.sections.map((section) => section.type)).length} section types detected.`),
      ratioCheck("media_quality", "Media loads without obvious failures", loadedImageRatio(render), 15, `${render?.metrics.loadedImageCount ?? 0}/${render?.metrics.imageCount ?? 0} rendered images loaded.`),
      ratioCheck("typography", "Typography hierarchy is readable", typographyRatio(render), 15, `${render?.metrics.heroH1LineCount ?? "unknown"} H1 lines; ${render?.metrics.minReadableTextFontSizePx ?? "unknown"}px min text.`),
      ratioCheck("known_geometry", "Low unknown-section share", knownGeometryRatio(sections), 15, `${sections.sections.filter((section) => section.type === "unknown").length}/${sections.sections.length} unknown sections.`),
      check("cta_rhythm", "CTA rhythm supports first-view action", Boolean(render?.metrics.aboveFoldCtaDetected || sections.sections.filter((section) => section.ctaCount > 0).length >= 2), 10, `${sections.sections.filter((section) => section.ctaCount > 0).length} sections with CTA-like actions.`)
    ])
  };

  return {
    dimensions: dimensionsByName,
    composites: {
      defaultComposite: computeDefaultComposite(dimensionScores(dimensionsByName))
    },
    weights: defaultMarketBenchmarkWeights,
    rawSignals: {
      crawlScore: crawl.score,
      renderAdapter: render?.adapter,
      renderUnavailableReason: render?.unavailableReason,
      sectionCount: sections.sections.length,
      unknownSectionCount: sections.sections.filter((section) => section.type === "unknown").length
    }
  };
}

export function computeDefaultComposite(scores: Record<MarketBenchmarkDimension, number>) {
  return roundScore(
    dimensions.reduce((total, dimension) => total + scores[dimension] * defaultMarketBenchmarkWeights[dimension], 0)
  );
}

export function dimensionScores(scores: Record<MarketBenchmarkDimension, MarketBenchmarkDimensionScore>) {
  return Object.fromEntries(dimensions.map((dimension) => [dimension, scores[dimension].score])) as Record<MarketBenchmarkDimension, number>;
}

export function renderMarketBenchmarkReport(input: {
  runId: string;
  artifactRoot: string;
  reportPath: string;
  candidates: MarketBenchmarkRunResult["candidates"];
  siteResults: MarketBenchmarkSiteResult[];
}) {
  const ranked = [...input.siteResults].sort((left, right) => right.scores.composites.defaultComposite - left.scores.composites.defaultComposite);
  const middle = ranked.length ? [ranked[Math.floor(ranked.length / 2)]].filter((item): item is MarketBenchmarkSiteResult => Boolean(item)) : [];
  const sectionCounts = countBy(input.siteResults.flatMap((site) => site.sections.sections.map((section) => section.type)));
  const lowConfidence = input.siteResults.flatMap((site) =>
    site.sections.sections
      .filter((section) => section.type === "unknown" || section.confidence < 0.5)
      .map((section) => `${site.candidate.name}: #${section.index} ${section.type} (${Math.round(section.confidence * 100)}%) ${section.heading ?? section.textSample.slice(0, 70)}`)
  );
  const lines = [
    "# Austin Automotive Website Benchmark Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Run ID: \`${input.runId}\``,
    `Artifact root: \`${input.artifactRoot}\``,
    "",
    "This report is internal research evidence. Automated scores and inferred section geometry are provisional until a human reviewer confirms the design conclusions.",
    "",
    "## Automated Facts",
    "",
    `- Accepted candidates: ${input.candidates.accepted.length}`,
    `- Rejected candidates: ${input.candidates.rejected.length}`,
    `- Needs review candidates: ${input.candidates.needsReview.length}`,
    `- Scored websites: ${input.siteResults.length}`,
    `- Section classifications: ${formatCounts(sectionCounts)}`,
    "",
    "## Ranked Sites",
    "",
    "| Rank | Site | Composite | Technical | Mobile | Conversion | Trust | Auto Proof | Visual | URL |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...ranked.map((site, index) => {
      const scores = dimensionScores(site.scores.dimensions);
      return [
        String(index + 1),
        site.candidate.name,
        String(site.scores.composites.defaultComposite),
        String(scores.technicalHealth),
        String(scores.mobileUsability),
        String(scores.conversionClarity),
        String(scores.localTrust),
        String(scores.autoSpecificProof),
        String(scores.visualSectionQuality),
        site.candidate.normalizedWebsiteUrl ?? ""
      ].join(" | ");
    }).map((row) => `| ${row} |`),
    "",
    "## Top Examples",
    "",
    ...siteSummaryLines(ranked.slice(0, 5)),
    "## Middle Example",
    "",
    ...siteSummaryLines(middle),
    "## Bottom Examples",
    "",
    ...siteSummaryLines(ranked.slice(-5).reverse()),
    "## Inferred Classifications",
    "",
    ...input.siteResults.flatMap((site) => [
      `### ${site.candidate.name}`,
      "",
      site.sections.sections.length
        ? site.sections.sections
            .map(
              (section) =>
                `- ${section.index}. ${section.type} (${Math.round(section.confidence * 100)}%): ${section.heading ?? section.textSample.slice(0, 80)}`
            )
            .join("\n")
        : "- No sections classified.",
      ""
    ]),
    "## Low-Confidence Geometry",
    "",
    ...(lowConfidence.length ? lowConfidence.map((item) => `- ${item}`) : ["- No low-confidence or unknown sections were detected in this run."]),
    "",
    "## Human Review Recommendations",
    "",
    ...humanReviewRecommendations(input.siteResults).map((item) => `- ${item}`),
    "",
    "## Candidate Lodesta Template Or Recipe Gaps",
    "",
    ...candidateTemplateGaps(input.siteResults).map((item) => `- ${item}`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

async function fetchGooglePlacesCandidates(): Promise<MarketBenchmarkRawCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is required for google_places mode. Use --fixture or --csv for offline runs.");
  const observedAt = new Date().toISOString();
  const candidates: MarketBenchmarkRawCandidate[] = [];
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.types",
    "places.primaryTypeDisplayName",
    "places.businessStatus"
  ].join(",");

  for (const query of austinAutoQueries) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: 20,
        regionCode: "US",
        locationBias: {
          rectangle: {
            low: { latitude: 30.05, longitude: -97.95 },
            high: { latitude: 30.55, longitude: -97.55 }
          }
        }
      }),
      signal: AbortSignal.timeout(12000)
    });
    const payload = (await response.json().catch(() => null)) as { places?: PlacesApiPlace[]; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(payload?.error?.message ?? `Google Places Text Search failed for "${query}" with ${response.status}.`);
    for (const place of payload?.places ?? []) {
      candidates.push(placeToCandidate(place, query, observedAt, "google_places"));
    }
  }
  return candidates;
}

async function readFixtureCandidates(fixtureRoot: string) {
  const path = join(fixtureRoot, "places.json");
  const payload = JSON.parse(await readFile(path, "utf8")) as { places: Array<Record<string, unknown>> };
  return payload.places.map((place) =>
    placeToCandidate(place, stringValue(place.query) ?? "fixture", stringValue(place.observedAt) ?? "2026-06-05T00:00:00.000Z", "fixture")
  );
}

async function readCsvCandidates(path: string): Promise<MarketBenchmarkRawCandidate[]> {
  const text = await readFile(path, "utf8");
  const [headerLine, ...lines] = text.split(/\r?\n/).filter((line) => line.trim());
  if (!headerLine) return [];
  const headers = parseCsvLine(headerLine).map((item) => item.trim());
  const observedAt = new Date().toISOString();
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return {
      placeId: row.placeId || undefined,
      name: row.name || row.businessName || "Unknown business",
      websiteUrl: row.websiteUrl || row.website || row.url || undefined,
      formattedAddress: row.formattedAddress || row.address || undefined,
      nationalPhoneNumber: row.nationalPhoneNumber || row.phone || undefined,
      query: row.query || "manual_csv",
      observedAt,
      source: "csv",
      types: (row.types ?? "").split(/[|;]/).map((item) => item.trim()).filter(Boolean),
      primaryTypeDisplayName: row.primaryTypeDisplayName || undefined,
      businessStatus: row.businessStatus || undefined
    };
  });
}

function placeToCandidate(place: PlacesApiPlace, query: string, observedAt: string, source: MarketBenchmarkMode): MarketBenchmarkRawCandidate {
  return {
    placeId: stringValue(place.id) ?? stringValue(place.name),
    name: localizedText(place.displayName) ?? stringValue(place.name) ?? "Unknown business",
    websiteUrl: stringValue(place.websiteUri) ?? stringValue(place.websiteUrl),
    formattedAddress: stringValue(place.formattedAddress),
    nationalPhoneNumber: stringValue(place.nationalPhoneNumber),
    query,
    observedAt,
    source,
    types: Array.isArray(place.types) ? place.types.filter((item): item is string => typeof item === "string") : [],
    primaryTypeDisplayName: localizedText(place.primaryTypeDisplayName),
    businessStatus: stringValue(place.businessStatus),
    fixtureHtmlPath: stringValue(place.fixtureHtmlPath)
  };
}

function classifyCandidate(candidate: MarketBenchmarkCandidate): { status: MarketBenchmarkCandidateStatus; reasons: string[] } {
  const haystack = [candidate.name, candidate.rootDomain, candidate.primaryTypeDisplayName, candidate.types.join(" "), candidate.query]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!candidate.normalizedWebsiteUrl) return { status: "needs_review", reasons: ["missing_website_url"] };
  const rootDomain = candidate.rootDomain;
  if (rootDomain && listingDomains.some((domain) => rootDomain === domain || rootDomain.endsWith(`.${domain}`))) {
    return { status: "needs_review", reasons: ["listing_or_social_profile_url"] };
  }
  if (dealerTerms.some((term) => haystack.includes(term))) return { status: "rejected", reasons: ["dealer_or_sales_keyword"] };
  if (franchiseTerms.some((term) => haystack.includes(term))) return { status: "rejected", reasons: ["franchise_or_chain_keyword"] };
  if (/car_dealer|auto_parts_store|used_car/i.test(candidate.types.join(" "))) return { status: "rejected", reasons: ["places_type_not_independent_repair"] };
  if (!/auto|body|collision|repair|mechanic|tire|dent|paint|glass|windshield|automotive|vehicle/.test(haystack)) {
    return { status: "needs_review", reasons: ["automotive_repair_fit_unclear"] };
  }
  return { status: "accepted", reasons: ["accepted_independent_automotive_candidate"] };
}

function duplicateCandidateReason(candidate: MarketBenchmarkCandidate, placeIds: Set<string>, urls: Set<string>, domains: Set<string>) {
  if (candidate.placeId && placeIds.has(candidate.placeId)) return "duplicate_place_id";
  if (candidate.normalizedWebsiteUrl && urls.has(candidate.normalizedWebsiteUrl)) return "duplicate_website_url";
  if (candidate.rootDomain && domains.has(candidate.rootDomain)) return "duplicate_root_domain";
  return undefined;
}

async function readFixtureHtml(candidate: MarketBenchmarkCandidate, fixtureRoot: string) {
  if (!candidate.fixtureHtmlPath) return undefined;
  return readFile(join(process.cwd(), candidate.fixtureHtmlPath), "utf8").catch(() => readFile(join(fixtureRoot, candidate.fixtureHtmlPath ?? ""), "utf8"));
}

function crawlAssessmentFromFixtureHtml(html: string, sourceUrl: string): CrawlAssessment {
  const summary = summarizeCrawlHtml(html, sourceUrl);
  const assessment: CrawlAssessment = {
    url: sourceUrl,
    fetched: true,
    status: 200,
    finalUrl: sourceUrl,
    title: summary.title,
    metaDescription: summary.metaDescription,
    canonical: summary.canonical,
    hasViewportMeta: summary.hasViewportMeta,
    hasLocalBusinessSchema: summary.hasLocalBusinessSchema,
    hasTelLink: summary.hasTelLink,
    robotsFound: true,
    sitemapFound: false,
    formCount: summary.formCount,
    imageCount: summary.imageCount,
    imagesWithoutAlt: summary.imagesWithoutAlt,
    internalLinkCount: summary.internalLinkCount,
    externalLinkCount: summary.externalLinkCount,
    jsonLdTypes: summary.jsonLdTypes,
    extractedFacts: summary.extractedFacts,
    formReferences: summary.formReferences,
    linkReferences: summary.linkReferences,
    assetReferences: summary.assetReferences,
    sampledInternalPages: summary.linkReferences.filter((link) => link.kind === "internal").map((link) => link.href),
    pageSummaries: [summary],
    score: { overall: 0, max: 100, percent: 0, grade: "poor", checks: [] },
    findings: []
  };
  return { ...assessment, score: scoreCrawlAssessment(assessment) };
}

function classifyRawSection(raw: Omit<MarketBenchmarkSection, "type" | "confidence" | "signals"> & { className?: string; role?: string | null; id?: string }): MarketBenchmarkSection {
  const text = `${raw.heading ?? ""} ${raw.textSample} ${raw.tagName} ${raw.className ?? ""} ${raw.id ?? ""} ${raw.role ?? ""}`.toLowerCase();
  const candidates: Array<{ type: MarketBenchmarkSectionType; score: number; signals: string[] }> = [
    scoreSection("nav", raw, text, [/navigation/, /nav/, /menu/, /header/], raw.top < 180 && raw.linkCount >= 3 ? 2 : 0),
    scoreSection("footer", raw, text, [/footer/, /copyright/, /privacy/, /terms/], raw.tagName === "footer" ? 3 : 0),
    scoreSection("hero", raw, text, [/hero/, /estimate/, /quote/, /collision/, /auto body/, /repair/], raw.top < 900 && (raw.heading || raw.ctaCount > 0) ? 2 : 0),
    scoreSection("gallery_before_after", raw, text, [/before/, /after/, /gallery/, /photos?/, /portfolio/, /work/], raw.imageCount >= 3 ? 2 : 0),
    scoreSection("reviews", raw, text, [/review/, /testimonial/, /rating/, /stars?/, /google/], 0),
    scoreSection("process", raw, text, [/process/, /how it works/, /insurance/, /claim/, /estimate/, /steps?/, /tow/, /rental/], 0),
    scoreSection("faq", raw, text, [/faq/, /questions?/, /answers?/], 0),
    scoreSection("quote_contact", raw, text, [/quote/, /estimate/, /contact/, /schedule/, /appointment/, /form/, /call/], raw.formCount > 0 || raw.ctaCount > 1 ? 2 : 0),
    scoreSection("map_location", raw, text, [/map/, /location/, /address/, /hours?/, /directions/, /austin/, /street/, /mon|tue|wed|thu|fri|sat|sun/], 0),
    scoreSection("trust_strip", raw, text, [/certified/, /insured/, /warranty/, /years/, /ase/, /i-car/, /locally owned/], raw.height < 220 && raw.linkCount <= 4 ? 1 : 0),
    scoreSection("services", raw, text, [/services?/, /collision/, /paint/, /dent/, /hail/, /tire/, /mechanic/, /glass/, /windshield/, /diagnostic/, /brake/, /repair/], 0)
  ];
  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  const confidence = selected ? Math.min(1, selected.score / 6) : 0;
  return {
    index: raw.index,
    type: selected && confidence >= 0.45 ? selected.type : "unknown",
    confidence: roundRatio(confidence),
    tagName: raw.tagName,
    heading: raw.heading,
    textSample: raw.textSample,
    top: raw.top,
    height: raw.height,
    width: raw.width,
    ctaCount: raw.ctaCount,
    imageCount: raw.imageCount,
    formCount: raw.formCount,
    linkCount: raw.linkCount,
    signals: selected?.signals ?? []
  };
}

function collectMarketBenchmarkSectionsScript() {
  return `(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 80 && rect.height > 32 && style.display !== "none" && style.visibility !== "hidden";
    };
    const textOf = (element) => (element.textContent || "").replace(/\\s+/g, " ").trim();
    const isCta = (element) => {
      const text = textOf(element).toLowerCase();
      const href = element instanceof HTMLAnchorElement ? element.href.toLowerCase() : "";
      return /call|quote|estimate|contact|schedule|book|get|request|directions|learn|service/.test(text) || href.startsWith("tel:");
    };
    const candidates = Array.from(
      document.querySelectorAll("header, nav, main > section, section, main > div, main > article, article, footer, [role='banner'], [role='navigation'], [role='contentinfo']")
    ).filter(visible);
    const fallback = candidates.length ? candidates : Array.from(document.body.children).filter(visible);
    return fallback.slice(0, 24).map((element, index) => {
      const rect = element.getBoundingClientRect();
      const links = Array.from(element.querySelectorAll("a, button"));
      return {
        index,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        className: String(element.className || ""),
        id: element.id || undefined,
        heading:
          Array.from(element.querySelectorAll("h1, h2, h3"))
            .map((heading) => textOf(heading))
            .filter(Boolean)[0] || undefined,
        textSample: textOf(element).slice(0, 500),
        top: Math.round(rect.top + window.scrollY),
        height: Math.round(rect.height),
        width: Math.round(rect.width),
        ctaCount: links.filter(isCta).length,
        imageCount: element.querySelectorAll("img, picture, svg").length,
        formCount: element.querySelectorAll("form, input, textarea, select").length,
        linkCount: links.length
      };
    });
  })()`;
}

function scoreSection(type: MarketBenchmarkSectionType, raw: { tagName: string }, text: string, patterns: RegExp[], bonus: number) {
  const signals = patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  const tagBonus =
    (type === "nav" && (raw.tagName === "nav" || raw.tagName === "header")) ||
    (type === "footer" && raw.tagName === "footer")
      ? 2
      : 0;
  return { type, score: signals.length + bonus + tagBonus, signals };
}

function staticSectionFallback(sourceUrl: string, html: string | undefined, capturedAt: string, reason: string): MarketBenchmarkSectionMap {
  const fallback = staticRawSectionsFromHtml(html).map(classifyRawSection);
  return {
    sourceUrl,
    capturedAt,
    adapter: "static_fallback",
    sections: fallback.length
      ? fallback
      : [
          classifyRawSection({
            index: 0,
            tagName: "body",
            heading: firstHeading(html),
            textSample: html ? stripHtml(html).slice(0, 1000) : "",
            top: 0,
            height: 0,
            width: 0,
            ctaCount: countMatches(html ?? "", /call|quote|estimate|contact/gi),
            imageCount: countMatches(html ?? "", /<img\b/gi),
            formCount: countMatches(html ?? "", /<form\b|<input\b|<textarea\b/gi),
            linkCount: countMatches(html ?? "", /<a\b/gi)
          })
        ],
    notes: [`Playwright geometry extraction unavailable: ${reason}`]
  };
}

function staticRawSectionsFromHtml(html: string | undefined): Array<Omit<MarketBenchmarkSection, "type" | "confidence" | "signals">> {
  if (!html) return [];
  const sections: Array<Omit<MarketBenchmarkSection, "type" | "confidence" | "signals">> = [];
  const regex = /<(header|nav|section|footer|article|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null && sections.length < 30) {
    const tagName = match[1].toLowerCase();
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    if (tagName === "div" && !/(class|id)=["'][^"']*(hero|banner|trust|service|gallery|review|process|contact|location|box|section|footer)/i.test(attrs)) {
      continue;
    }
    const textSample = stripHtml(inner).slice(0, 500);
    if (textSample.length < 12 && !/<img\b|<form\b|<input\b/i.test(inner)) continue;
    sections.push({
      index: sections.length,
      tagName,
      heading: firstHeading(inner),
      textSample,
      top: sections.length * 520,
      height: Math.max(80, Math.min(900, Math.round(textSample.length / 2))),
      width: 1280,
      ctaCount: countMatches(inner, /call|quote|estimate|contact|schedule|request|href=["']tel:/gi),
      imageCount: countMatches(inner, /<img\b|<picture\b|<svg\b/gi),
      formCount: countMatches(inner, /<form\b|<input\b|<textarea\b|<select\b/gi),
      linkCount: countMatches(inner, /<a\b|<button\b/gi)
    });
  }
  return sections;
}

function scoreDimension(checks: MarketBenchmarkScoreCheck[]): MarketBenchmarkDimensionScore {
  const max = checks.reduce((total, item) => total + item.max, 0);
  const points = checks.reduce((total, item) => total + item.points, 0);
  return {
    score: max > 0 ? roundScore((points / max) * 100) : 0,
    checks
  };
}

function check(id: string, label: string, passed: boolean, max: number, evidence: string): MarketBenchmarkScoreCheck {
  return { id, label, points: passed ? max : 0, max, evidence };
}

function ratioCheck(id: string, label: string, ratio: number | undefined, max: number, evidence: string): MarketBenchmarkScoreCheck {
  return { id, label, points: Math.round(max * clampRatio(ratio ?? 0)), max, evidence };
}

function imageHealthRatio(crawl: CrawlAssessment, render?: RenderInspectionResult) {
  const crawlRatio = crawl.imageCount > 0 ? (crawl.imageCount - crawl.imagesWithoutAlt) / crawl.imageCount : 1;
  const renderRatio = render && render.metrics.imageCount ? (render.metrics.imageCount - (render.metrics.brokenImageCount ?? 0)) / render.metrics.imageCount : 1;
  return clampRatio(Math.min(crawlRatio, renderRatio));
}

function noOverflowRatio(render?: RenderInspectionResult) {
  if (!render) return 0;
  const overflow = render.metrics.horizontalOverflowPx ?? 0;
  if (overflow <= 0) return 1;
  if (overflow <= 16) return 0.75;
  if (overflow <= 48) return 0.4;
  return 0;
}

function fontSizeRatio(metrics?: RenderViewportMetrics) {
  const size = metrics?.minReadableTextFontSizePx;
  if (!size) return 0.5;
  if (size >= 15) return 1;
  if (size >= 13) return 0.65;
  return 0.2;
}

function contrastRatioScore(render?: RenderInspectionResult) {
  const contrast = render?.metrics.minTextContrastRatio;
  if (!contrast) return 0.5;
  if (contrast >= 4.5) return 1;
  if (contrast >= 3) return 0.6;
  return 0.2;
}

function loadedImageRatio(render?: RenderInspectionResult) {
  if (!render || !render.metrics.imageCount) return 0.7;
  return clampRatio((render.metrics.loadedImageCount ?? 0) / render.metrics.imageCount);
}

function layoutCleanRatio(render?: RenderInspectionResult) {
  if (!render) return 0.5;
  const issues = (render.metrics.crampedTextCount ?? 0) + (render.metrics.visualOverlapCount ?? 0);
  if (issues === 0) return 1;
  if (issues <= 2) return 0.7;
  if (issues <= 5) return 0.35;
  return 0;
}

function serviceCoverageRatio(crawl: CrawlAssessment, sections: MarketBenchmarkSectionMap, candidate: MarketBenchmarkCandidate) {
  const text = `${crawlText(crawl)} ${candidate.query} ${candidate.types.join(" ")}`;
  const matches = [
    /collision/i,
    /paint/i,
    /dent|hail/i,
    /glass|windshield/i,
    /tire/i,
    /brake|mechanic|diagnostic|engine/i
  ].filter((pattern) => pattern.test(text)).length;
  const sectionBonus = sectionsContain(sections, "services") ? 1 : 0;
  return clampRatio((matches + sectionBonus) / 5);
}

function categoryCoverageRatio(crawl: CrawlAssessment, candidate: MarketBenchmarkCandidate) {
  const text = `${crawlText(crawl)} ${candidate.query} ${candidate.types.join(" ")}`;
  const matches = [
    /auto|automotive|vehicle/i,
    /repair|service|mechanic/i,
    /body|collision|paint|dent|tire|glass|windshield/i
  ].filter((pattern) => pattern.test(text)).length;
  return matches / 3;
}

function sectionVarietyRatio(sections: MarketBenchmarkSectionMap) {
  if (!sections.sections.length) return 0;
  const knownTypes = unique(sections.sections.map((section) => section.type).filter((type) => type !== "unknown"));
  return clampRatio(knownTypes.length / 6);
}

function typographyRatio(render?: RenderInspectionResult) {
  if (!render) return 0.5;
  const font = render.metrics.minReadableTextFontSizePx;
  const h1Lines = render.metrics.heroH1LineCount;
  const fontScore = font === undefined ? 0.5 : font >= 15 ? 1 : font >= 13 ? 0.6 : 0.2;
  const h1Score = h1Lines === undefined ? 0.7 : h1Lines <= 4 ? 1 : h1Lines <= 6 ? 0.7 : 0.3;
  return (fontScore + h1Score) / 2;
}

function knownGeometryRatio(sections: MarketBenchmarkSectionMap) {
  if (!sections.sections.length) return 0;
  return clampRatio(sections.sections.filter((section) => section.type !== "unknown").length / sections.sections.length);
}

function sectionsContain(sections: MarketBenchmarkSectionMap, type: MarketBenchmarkSectionType) {
  return sections.sections.some((section) => section.type === type);
}

function trustText(crawl: CrawlAssessment, sections: MarketBenchmarkSectionMap, pattern: RegExp) {
  return textMatches(`${crawlText(crawl)} ${sections.sections.map((section) => section.textSample).join(" ")}`, pattern);
}

function hasLocationEvidence(crawl: CrawlAssessment, sections: MarketBenchmarkSectionMap) {
  return Boolean(
    crawl.extractedFacts.address?.street ||
      crawl.extractedFacts.address?.city ||
      crawl.extractedFacts.hours ||
      sectionsContain(sections, "map_location") ||
      textMatches(crawlText(crawl), /directions|hours|location|austin|map/i)
  );
}

function crawlText(crawl: CrawlAssessment) {
  return [
    crawl.title,
    crawl.metaDescription,
    crawl.extractedFacts.description,
    crawl.extractedFacts.categories.join(" "),
    crawl.extractedFacts.services.join(" "),
    crawl.extractedFacts.serviceHighlights?.join(" "),
    crawl.pageSummaries.map((summary) => [summary.title, summary.metaDescription, summary.extractedFacts.services.join(" ")].join(" ")).join(" ")
  ]
    .filter(Boolean)
    .join(" ");
}

function humanReviewRecommendations(results: MarketBenchmarkSiteResult[]) {
  const recommendations = [
    "Review top-ranked screenshots side-by-side before treating geometry patterns as Lodesta product decisions.",
    "Inspect low-confidence `unknown` sections; they are the best candidates for either improved classifiers or truly missing geometry.",
    "Compare high conversion scores against visual scores to separate useful dated sites from genuinely well-designed sites.",
    "Validate whether before/after gallery proof is a recurring conversion pattern for independent Austin shops.",
    "Check mobile screenshots for sticky call/estimate access; automated raw metrics may miss third-party CTA labels."
  ];
  if (results.some((site) => site.sections.adapter === "static_fallback")) {
    recommendations.push("Re-run sites with static-fallback geometry after Playwright/browser availability is restored.");
  }
  return recommendations;
}

function candidateTemplateGaps(results: MarketBenchmarkSiteResult[]) {
  const high = results.filter((site) => site.scores.composites.defaultComposite >= 70);
  const all = high.length ? high : results;
  const hasGallery = all.some((site) => sectionsContain(site.sections, "gallery_before_after"));
  const hasProcess = all.some((site) => sectionsContain(site.sections, "process"));
  const hasMap = all.some((site) => sectionsContain(site.sections, "map_location"));
  const hasTrust = all.some((site) => sectionsContain(site.sections, "trust_strip") || sectionsContain(site.sections, "reviews"));
  return [
    hasGallery
      ? "Before/after or gallery proof appears in stronger candidates; verify Lodesta auto-body recipes make this easy to express with safe media."
      : "Before/after proof was not reliably detected; human review should decide whether this is a classifier miss or a market gap.",
    hasProcess
      ? "Insurance/claims/process explanation appears worth preserving as a named auto-body content pattern."
      : "Claims/process sections were weak or absent; review whether Lodesta should differentiate by adding this pattern.",
    hasMap ? "Location/hours/map clarity should remain close to conversion paths." : "Location clarity needs manual inspection; automated section extraction did not find strong map/location sections.",
    hasTrust ? "Trust strips, reviews, credentials, and warranty proof should be evaluated as compact sections near CTAs." : "Trust proof was not strongly classified; review screenshots for missed review badges or widgets.",
    "Keep candidate gaps separate from product changes until a human reviewer confirms at least a few concrete screenshot examples."
  ];
}

function siteSummaryLines(sites: MarketBenchmarkSiteResult[]) {
  if (!sites.length) return ["- No sites in this group.", ""];
  return sites.flatMap((site) => {
    const scores = dimensionScores(site.scores.dimensions);
    const topChecks = dimensions
      .map((dimension) => {
        const failed = site.scores.dimensions[dimension].checks.find((checkItem) => checkItem.points < checkItem.max);
        return failed ? `${dimension}: ${failed.label}` : undefined;
      })
      .filter(Boolean)
      .slice(0, 3);
    return [
      `### ${site.candidate.name}`,
      "",
      `- Composite: ${site.scores.composites.defaultComposite}; dimensions: ${JSON.stringify(scores)}`,
      `- URL: ${site.candidate.normalizedWebsiteUrl ?? "unknown"}`,
      `- Sections: ${site.sections.sections.map((section) => `${section.type}:${Math.round(section.confidence * 100)}%`).join(", ") || "none"}`,
      `- Review focus: ${topChecks.join("; ") || "No major automated gaps."}`,
      ""
    ];
  });
}

function defaultFixtureRoot() {
  return join(process.cwd(), "fixtures", "market-benchmark", "austin-auto");
}

function candidateId(candidate: MarketBenchmarkRawCandidate, normalizedWebsiteUrl?: string) {
  return safeId(candidate.placeId ?? rootDomainForUrl(normalizedWebsiteUrl) ?? candidate.name);
}

function normalizeWebsiteUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch {
    return undefined;
  }
}

function rootDomainForUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    const parts = hostname.split(".");
    return parts.length <= 2 ? hostname : parts.slice(-2).join(".");
  } catch {
    return undefined;
  }
}

function safeId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function localizedText(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function firstHeading(html: string | undefined) {
  const match = html?.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
  return match ? stripHtml(match[1]) : undefined;
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textMatches(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function isHttps(value: string | undefined) {
  try {
    return Boolean(value && new URL(value).protocol === "https:");
  } catch {
    return false;
  }
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function roundRatio(value: number) {
  return Math.round(clampRatio(value) * 100) / 100;
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function countBy(items: string[]) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

function formatCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
