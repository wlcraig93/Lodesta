import { getStandardCriterion } from "./standard";
import { validatePublicFetchUrl } from "./url-safety";
import type { SiteEvidenceCandidateV1, SiteEvidenceKindV1 } from "./evidence-ledger-v1";
import { extractSourceTextBlocks, type SourceTextBlock } from "./source-text-blocks";

export type CrawlAssessment = {
  url: string;
  fetched: boolean;
  status?: number;
  finalUrl?: string;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  hasViewportMeta: boolean;
  hasLocalBusinessSchema: boolean;
  hasTelLink: boolean;
  robotsFound: boolean;
  sitemapFound: boolean;
  formCount: number;
  imageCount: number;
  imagesWithoutAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;
  jsonLdTypes: string[];
  extractedFacts: ExtractedBusinessFacts;
  formReferences: CrawlFormReference[];
  linkReferences: CrawlLinkReference[];
  assetReferences: CrawlAssetReference[];
  sampledInternalPages: string[];
  pageSummaries: CrawlPageSummary[];
  score: CrawlQualityScore;
  findings: string[];
  error?: string;
};

export type CrawlPageSummary = {
  url: string;
  source: "primary" | "sampled_internal";
  purposeTags: CrawlPagePurposeTag[];
  title?: string;
  metaDescription?: string;
  canonical?: string;
  /** Cleaned visible prose retained for evidence/dossier generation, capped per page. */
  mainText?: string;
  /** Semantic visible-text blocks retained with deterministic token-to-display provenance. */
  sourceTextBlocks: SourceTextBlock[];
  hasViewportMeta: boolean;
  hasLocalBusinessSchema: boolean;
  hasTelLink: boolean;
  formCount: number;
  imageCount: number;
  imagesWithoutAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;
  jsonLdTypes: string[];
  extractedFacts: ExtractedBusinessFacts;
  formReferences: CrawlFormReference[];
  linkReferences: CrawlLinkReference[];
  assetReferences: CrawlAssetReference[];
  evidenceCandidates: SiteEvidenceCandidateV1[];
};

export type CrawlUrlOptions = {
  maxInternalPages?: number;
};

export type CrawlPagePurposeTag =
  | "home"
  | "services"
  | "service_detail"
  | "about"
  | "location"
  | "contact"
  | "gallery"
  | "reviews"
  | "offers"
  | "faq"
  | "blog"
  | "legal"
  | "other";

const defaultMaxInternalPages = 12;
const hardMaxInternalPages = 16;
const maxMainTextCharsPerPage = 2800;

export type ExtractedBusinessFacts = {
  name?: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  geo?: {
    latitude: number;
    longitude: number;
  };
  hours?: Record<string, string>;
  categories: string[];
  services: string[];
  serviceHighlights?: string[];
  serviceAreas: string[];
  socialLinks: string[];
  bookingLinks: string[];
  orderingLinks: string[];
  pressLinks: string[];
  reviewsSummary?: {
    rating?: number;
    count?: number;
    sources: string[];
  };
};

export type CrawlAssetReference = {
  url: string;
  alt?: string;
  kind: "image" | "logo";
  rightsStatus: "reference_only";
};

export type CrawlFormReference = {
  action?: string;
  method: "get" | "post" | "dialog" | "unknown";
  fieldNames: string[];
  fieldTypes: string[];
  requiredFields: string[];
  hasEmailField: boolean;
  hasPhoneField: boolean;
  hasTextarea: boolean;
};

export type CrawlLinkReference = {
  href: string;
  text?: string;
  kind: "internal" | "external" | "tel" | "mailto" | "booking" | "ordering" | "social" | "press_video";
};

export type CrawlQualityScore = {
  overall: number;
  max: number;
  percent: number;
  grade: "excellent" | "good" | "needs_work" | "poor";
  checks: CrawlQualityCheck[];
};

export type CrawlQualityCheck = {
  id: string;
  standardCriterionId: string;
  label: string;
  category: "technical" | "seo" | "conversion" | "trust" | "accessibility";
  passed: boolean;
  points: number;
  maxPoints: number;
  consequence: string;
};

export async function crawlUrl(url: string, options: CrawlUrlOptions = {}): Promise<CrawlAssessment> {
  const assessment: CrawlAssessment = {
    url,
    fetched: false,
    hasViewportMeta: false,
    hasLocalBusinessSchema: false,
    hasTelLink: false,
    robotsFound: false,
    sitemapFound: false,
    formCount: 0,
    imageCount: 0,
    imagesWithoutAlt: 0,
    internalLinkCount: 0,
    externalLinkCount: 0,
    jsonLdTypes: [],
    extractedFacts: emptyExtractedFacts(),
    formReferences: [],
    linkReferences: [],
    assetReferences: [],
    sampledInternalPages: [],
    pageSummaries: [],
    score: emptyScore(),
    findings: []
  };
  const urlSafety = await validatePublicFetchUrl(url);
  if (!urlSafety.ok) {
    const failed = {
      ...assessment,
      error: urlSafety.error,
      findings: [urlSafety.error]
    };
    return {
      ...failed,
      score: scoreCrawlAssessment(failed)
    };
  }

  const safeUrl = urlSafety.url;
  const maxInternalPages = clampInteger(options.maxInternalPages ?? defaultMaxInternalPages, 0, hardMaxInternalPages);

  try {
    const crawlBase = new URL(safeUrl);
    const robotsPolicy = await fetchRobotsPolicy(crawlBase);
    assessment.robotsFound = robotsPolicy.found;
    if (!robotsPolicy.allowed(safeUrl)) {
      const blocked = {
        ...assessment,
        finalUrl: safeUrl,
        error: "Crawl blocked by robots.txt for this URL.",
        findings: ["robots.txt disallows crawling the requested URL."]
      };
      return {
        ...blocked,
        score: scoreCrawlAssessment(blocked)
      };
    }

    const response = await fetchWithPresenceHeaders(safeUrl);
    const html = await response.text();
    const finalUrl = response.url || safeUrl;
    const primarySummary = summarizeCrawlPage(html, finalUrl, "primary");

    assessment.fetched = true;
    assessment.status = response.status;
    assessment.finalUrl = finalUrl;
    assessment.title = primarySummary.title;
    assessment.metaDescription = primarySummary.metaDescription;
    assessment.canonical = primarySummary.canonical;
    assessment.hasViewportMeta = primarySummary.hasViewportMeta;
    assessment.hasLocalBusinessSchema = primarySummary.hasLocalBusinessSchema;
    assessment.hasTelLink = primarySummary.hasTelLink;
    assessment.formCount = primarySummary.formCount;
    assessment.imageCount = primarySummary.imageCount;
    assessment.imagesWithoutAlt = primarySummary.imagesWithoutAlt;
    assessment.internalLinkCount = primarySummary.internalLinkCount;
    assessment.externalLinkCount = primarySummary.externalLinkCount;
    assessment.jsonLdTypes = primarySummary.jsonLdTypes;
    assessment.extractedFacts = primarySummary.extractedFacts;
    assessment.formReferences = primarySummary.formReferences.slice(0, 12);
    assessment.linkReferences = primarySummary.linkReferences.slice(0, 40);
    assessment.assetReferences = capAssetReferences(primarySummary.assetReferences);
    assessment.sampledInternalPages = primarySummary.linkReferences
      .filter((reference) => reference.kind === "internal")
      .map((reference) => stripHash(reference.href))
      .slice(0, 12);
    assessment.pageSummaries = [primarySummary];

    const sitemapDiscovery = await discoverSitemapCrawlTargets(crawlBase, robotsPolicy, maxInternalPages);
    assessment.sitemapFound = sitemapDiscovery.found;
    assessment.sampledInternalPages = unique([...assessment.sampledInternalPages, ...sitemapDiscovery.urls]);
    const internalTargets = selectInternalCrawlTargets(assessment.sampledInternalPages, assessment.finalUrl ?? safeUrl, maxInternalPages)
      .filter((target) => robotsPolicy.allowed(target));
    for (const target of internalTargets) {
      const summary = await fetchInternalPageSummary(target);
      if (!summary) continue;
      assessment.pageSummaries.push(summary);
      mergePageSummaryIntoAssessment(assessment, summary);
      await delay(120);
    }

    assessment.findings = makeFindings(assessment);
    assessment.score = scoreCrawlAssessment(assessment);
    return assessment;
  } catch (error) {
    const failed = {
      ...assessment,
      error: error instanceof Error ? error.message : "Unknown crawl error",
      findings: ["Could not fetch the site with the cheap crawler; queue Playwright or external browser fallback."]
    };
    return {
      ...failed,
      score: scoreCrawlAssessment(failed)
    };
  }
}

export function extractCrawlPageSignals(html: string, sourceUrl: string) {
  const source = new URL(sourceUrl);
  return {
    jsonLdTypes: extractJsonLdTypes(html),
    formReferences: extractFormReferences(html, source.href),
    linkReferences: extractLinkReferences(html, source.href, source.hostname),
    assetReferences: extractAssetReferences(html, source.href)
  };
}

export function summarizeCrawlHtml(html: string, sourceUrl: string): CrawlPageSummary {
  return summarizeCrawlPage(html, sourceUrl, "primary");
}

function summarizeCrawlPage(html: string, sourceUrl: string, source: CrawlPageSummary["source"]): CrawlPageSummary {
  const sourcePage = new URL(sourceUrl);
  const title = extractTagContent(html, "title");
  const metaDescription = extractMetaContent(html, "description");
  const summary: CrawlPageSummary = {
    url: sourcePage.href,
    source,
    purposeTags: classifyCrawlPagePurpose(sourcePage, title, html),
    title,
    metaDescription,
    canonical: extractLinkHref(html, "canonical"),
    mainText: extractMainText(html, maxMainTextCharsPerPage),
    sourceTextBlocks: extractSourceTextBlocks(html, sourcePage.href),
    hasViewportMeta: /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html),
    hasLocalBusinessSchema: /LocalBusiness|Restaurant|Dentist|LegalService|HomeAndConstructionBusiness/i.test(html),
    hasTelLink: /href=["']tel:/i.test(html),
    formCount: countMatches(html, /<form\b/gi),
    imageCount: countMatches(html, /<img\b/gi),
    imagesWithoutAlt: countImagesWithoutAlt(html),
    internalLinkCount: 0,
    externalLinkCount: 0,
    jsonLdTypes: [],
    extractedFacts: emptyExtractedFacts(),
    formReferences: [],
    linkReferences: [],
    assetReferences: [],
    evidenceCandidates: []
  };
  const signals = extractCrawlPageSignals(html, sourcePage.href);
  summary.jsonLdTypes = signals.jsonLdTypes;
  summary.extractedFacts = extractBusinessFacts(html, { url: sourcePage.href, finalUrl: sourcePage.href, title }, sourcePage);
  summary.evidenceCandidates = extractSiteEvidenceCandidates(html, { url: sourcePage.href, title }, sourcePage);
  summary.formReferences = signals.formReferences.slice(0, 12);
  summary.linkReferences = signals.linkReferences.slice(0, 40);
  summary.assetReferences = capAssetReferences(signals.assetReferences);

  for (const href of extractHrefs(html)) {
    try {
      const resolved = new URL(href, sourcePage.href);
      if (!["http:", "https:"].includes(resolved.protocol)) continue;
      if (sameHostname(resolved.hostname, sourcePage.hostname)) {
        summary.internalLinkCount += 1;
      } else {
        summary.externalLinkCount += 1;
      }
    } catch {
      // Ignore malformed hrefs during the cheap crawl pass.
    }
  }
  return summary;
}

function extractMainText(html: string, maxChars: number) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(?:header|nav|footer)\b[\s\S]*?<\/(?:header|nav|footer)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|div|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const cleaned = decodeHtml(stripped)
    ?.replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars).trimEnd()}...` : cleaned;
}

function classifyCrawlPagePurpose(sourcePage: URL, title: string | undefined, html: string): CrawlPagePurposeTag[] {
  const path = sourcePage.pathname.toLowerCase();
  const text = `${path} ${title ?? ""} ${extractMetaContent(html, "description") ?? ""}`.toLowerCase();
  const tags: CrawlPagePurposeTag[] = [];
  if (path === "/" || /\/(?:home|index)(?:\/|$)/.test(path)) tags.push("home");
  if (/\bservices?\b|\/services?\//.test(text)) tags.push(path.split("/").filter(Boolean).length > 1 ? "service_detail" : "services");
  if (/\babout|story|team|who-we-are\b/.test(text)) tags.push("about");
  if (/\blocations?|areas?|directions?|visit\b/.test(text)) tags.push("location");
  if (/\bcontact|get-in-touch|quote|estimate|appointment|booking\b/.test(text)) tags.push("contact");
  if (/\bgallery|photos?|portfolio|work\b/.test(text)) tags.push("gallery");
  if (/\breviews?|testimonials?\b/.test(text)) tags.push("reviews");
  if (/\boffers?|specials?|coupons?|financ/i.test(text)) tags.push("offers");
  if (/\bfaq|questions?\b/.test(text)) tags.push("faq");
  if (/\bblog|news|articles?\b/.test(text)) tags.push("blog");
  if (/\bprivacy|terms|accessibility|legal\b/.test(text)) tags.push("legal");
  return tags.length ? unique(tags) : ["other"];
}

async function fetchInternalPageSummary(url: string) {
  try {
    const response = await fetchWithPresenceHeaders(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return null;
    const html = await response.text();
    return summarizeCrawlPage(html, response.url || url, "sampled_internal");
  } catch {
    return null;
  }
}

function mergePageSummaryIntoAssessment(assessment: CrawlAssessment, summary: CrawlPageSummary) {
  assessment.hasLocalBusinessSchema ||= summary.hasLocalBusinessSchema;
  assessment.hasTelLink ||= summary.hasTelLink;
  assessment.formCount += summary.formCount;
  assessment.imageCount += summary.imageCount;
  assessment.imagesWithoutAlt += summary.imagesWithoutAlt;
  assessment.internalLinkCount += summary.internalLinkCount;
  assessment.externalLinkCount += summary.externalLinkCount;
  assessment.jsonLdTypes = unique([...assessment.jsonLdTypes, ...summary.jsonLdTypes]);
  assessment.extractedFacts = mergeExtractedBusinessFacts(assessment.extractedFacts, summary.extractedFacts);
  assessment.formReferences = uniqueBy([...assessment.formReferences, ...summary.formReferences], formReferenceKey).slice(0, 12);
  assessment.linkReferences = uniqueBy([...assessment.linkReferences, ...summary.linkReferences], (reference) => `${reference.kind}:${reference.href}`).slice(0, 40);
  assessment.assetReferences = capAssetReferences(
    uniqueBy([...assessment.assetReferences, ...summary.assetReferences], (reference) => reference.url)
  );
}

/**
 * Cap logos and images separately: pages with many body images must not
 * crowd logo candidates out before logo selection sees them — at per-page
 * extraction, primary-page assignment, and cross-page merge alike.
 */
function capAssetReferences(references: CrawlAssetReference[]): CrawlAssetReference[] {
  return [
    ...references.filter((reference) => reference.kind === "logo").slice(0, 6),
    ...references.filter((reference) => reference.kind === "image").slice(0, 12)
  ];
}

export function scoreCrawlAssessment(assessment: CrawlAssessment): CrawlQualityScore {
  const checks: CrawlQualityCheck[] = [
    check("technical.https", "technical", isHttpsUrl(assessment.finalUrl ?? assessment.url), 10),
    check("technical.healthy_response", "technical", Boolean(assessment.fetched && assessment.status && assessment.status < 400), 10),
    check("technical.mobile_viewport", "technical", assessment.hasViewportMeta, 10),
    check("seo.local_business_schema", "seo", assessment.hasLocalBusinessSchema, 15),
    check("seo.title.unique", "seo", Boolean(assessment.title && assessment.title.length >= 25), 10),
    check("seo.meta_description", "seo", Boolean(assessment.metaDescription && assessment.metaDescription.length >= 80), 10),
    check("seo.canonical", "seo", Boolean(assessment.canonical), 5),
    check("seo.clean_urls", "seo", hasCleanUrl(assessment.finalUrl ?? assessment.url, assessment.canonical), 5),
    check("seo.robots_txt", "technical", assessment.robotsFound, 5),
    check("seo.sitemap", "technical", assessment.sitemapFound, 5),
    check("conversion.mobile_click_to_call", "conversion", assessment.hasTelLink, 15),
    check("conversion.lead_form", "conversion", assessment.formCount > 0, 10),
    check("accessibility.image_alt", "accessibility", assessment.imageCount === 0 || assessment.imagesWithoutAlt === 0, 5)
  ];
  const max = checks.reduce((total, item) => total + item.maxPoints, 0);
  const overall = checks.reduce((total, item) => total + item.points, 0);
  const percent = max > 0 ? Math.round((overall / max) * 100) : 0;
  return {
    overall,
    max,
    percent,
    grade: percent >= 90 ? "excellent" : percent >= 75 ? "good" : percent >= 55 ? "needs_work" : "poor",
    checks
  };
}

function makeFindings(assessment: CrawlAssessment) {
  const findings: string[] = [];
  if (!isHttpsUrl(assessment.finalUrl ?? assessment.url)) findings.push("Site is not served over HTTPS.");
  if (!assessment.fetched || (assessment.status && assessment.status >= 400)) findings.push("Site did not return a healthy HTML response.");
  if (!assessment.title || assessment.title.length < 25) findings.push("Title is missing or too short.");
  if (!assessment.metaDescription || assessment.metaDescription.length < 80) findings.push("Meta description is missing or too short.");
  if (!assessment.canonical) findings.push("Canonical link is missing.");
  if (!hasCleanUrl(assessment.finalUrl ?? assessment.url, assessment.canonical)) findings.push("Public URL or canonical URL is not clean and readable.");
  if (!assessment.robotsFound) findings.push("robots.txt was not detected.");
  if (!assessment.sitemapFound) findings.push("sitemap.xml was not detected.");
  if (!assessment.hasViewportMeta) findings.push("Mobile viewport meta tag is missing.");
  if (!assessment.hasLocalBusinessSchema) findings.push("LocalBusiness structured data was not detected.");
  if (!assessment.hasTelLink) findings.push("Click-to-call tel link was not detected.");
  if (assessment.formCount === 0) findings.push("No lead/contact form was detected.");
  if (assessment.imageCount > 0 && assessment.imagesWithoutAlt > 0) findings.push("Some images are missing alt text.");
  return findings;
}

function isHttpsUrl(value: string | undefined) {
  try {
    return Boolean(value && new URL(value).protocol === "https:");
  } catch {
    return false;
  }
}

function hasCleanUrl(url: string | undefined, canonical?: string) {
  return cleanUrlCandidate(url) && (!canonical || cleanUrlCandidate(canonical));
}

function cleanUrlCandidate(value: string | undefined) {
  try {
    if (!value) return false;
    const url = new URL(value);
    if (url.search) return false;
    return !/\.(php|asp|aspx|jsp|cfm|cgi|html?)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function emptyScore(): CrawlQualityScore {
  return {
    overall: 0,
    max: 100,
    percent: 0,
    grade: "poor",
    checks: []
  };
}

function check(
  standardCriterionId: string,
  category: CrawlQualityCheck["category"],
  passed: boolean,
  maxPoints: number
): CrawlQualityCheck {
  const criterion = getStandardCriterion(standardCriterionId);
  return {
    id: standardCriterionId,
    standardCriterionId,
    label: criterion?.title ?? standardCriterionId,
    category,
    passed,
    points: passed ? maxPoints : 0,
    maxPoints,
    consequence: criterion?.businessConsequence ?? "This issue may reduce local-business performance."
  };
}

async function fetchWithPresenceHeaders(url: string) {
  return fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "LodestaPresenceBot/0.1 (+https://example.com/bot)",
      Accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(8000)
  });
}

async function probeUrl(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "LodestaPresenceBot/0.1 (+https://example.com/bot)" },
      signal: AbortSignal.timeout(4000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function discoverSitemapCrawlTargets(baseUrl: URL, robotsPolicy: RobotsPolicy, limit: number) {
  const sitemapUrl = new URL("/sitemap.xml", baseUrl).href;
  const root = await fetchSitemapText(sitemapUrl);
  if (!root) return { found: false, urls: [] };
  const locs = extractSitemapLocs(root, sitemapUrl);
  const childSitemaps = locs
    .filter((url) => sameHostname(url.hostname, baseUrl.hostname))
    .filter((url) => /\.xml(?:$|\?)/i.test(url.pathname))
    .slice(0, 4);
  const pageUrls = locs.filter((url) => !/\.xml(?:$|\?)/i.test(url.pathname));
  for (const child of childSitemaps) {
    const childXml = await fetchSitemapText(child.href);
    if (!childXml) continue;
    pageUrls.push(...extractSitemapLocs(childXml, child.href));
  }

  return {
    found: true,
    urls: unique(
      pageUrls
        .filter((url) => sameHostname(url.hostname, baseUrl.hostname))
        .filter((url) => ["http:", "https:"].includes(url.protocol))
        .filter((url) => !isNonHtmlPath(url.pathname))
        .filter((url) => isBusinessFactSitemapPath(url.pathname))
        .map((url) => stripTracking(url).href)
        .filter((url) => robotsPolicy.allowed(url))
    ).slice(0, Math.max(limit * 2, limit))
  };
}

async function fetchSitemapText(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "LodestaPresenceBot/0.1 (+https://example.com/bot)",
        Accept: "application/xml,text/xml,text/plain"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/xml|text\/plain|octet-stream/i.test(contentType)) return undefined;
    return response.text();
  } catch {
    return undefined;
  }
}

function extractSitemapLocs(xml: string, baseUrl: string) {
  const urls: URL[] = [];
  const regex = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const value = decodeHtml(match[1]) ?? match[1];
    try {
      urls.push(new URL(value.trim(), baseUrl));
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return urls;
}

function isBusinessFactSitemapPath(pathname: string) {
  if (normalizePath(pathname) === "/") return true;
  return /contact|location|hours|about|service|menu|order|book|appointment|schedule|reserve|faq|review|testimonial|gallery|portfolio|work/i.test(pathname);
}

type RobotsRule = {
  directive: "allow" | "disallow";
  path: string;
};

type RobotsPolicy = {
  found: boolean;
  allowed(url: string): boolean;
};

async function fetchRobotsPolicy(base: URL): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", base).href;
  try {
    const response = await fetch(robotsUrl, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "LodestaPresenceBot/0.1 (+https://example.com/bot)" },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return allowAllRobotsPolicy(false);
    return parseRobotsTxt(await response.text(), base);
  } catch {
    return allowAllRobotsPolicy(false);
  }
}

export function parseRobotsTxt(text: string, base: URL | string): RobotsPolicy {
  const baseUrl = typeof base === "string" ? new URL(base) : base;
  const rules: RobotsRule[] = [];
  let currentApplies = false;
  let sawDirectiveInGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      currentApplies = false;
      sawDirectiveInGroup = false;
      continue;
    }
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "user-agent") {
      if (sawDirectiveInGroup) {
        currentApplies = false;
        sawDirectiveInGroup = false;
      }
      const agent = value.toLowerCase();
      currentApplies ||= agent === "*" || agent.includes("lodestapresencebot") || agent.includes("lodesta");
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    sawDirectiveInGroup = true;
    if (!currentApplies || !value) continue;
    rules.push({
      directive: key,
      path: normalizeRobotsPath(value)
    });
  }

  return {
    found: true,
    allowed(url: string) {
      const target = new URL(url, baseUrl);
      if (!sameHostname(target.hostname, baseUrl.hostname)) return true;
      const path = `${target.pathname}${target.search}`;
      const matched = rules
        .filter((rule) => robotsPathMatches(path, rule.path))
        .sort((left, right) => right.path.length - left.path.length)[0];
      return matched?.directive !== "disallow";
    }
  };
}

function allowAllRobotsPolicy(found: boolean): RobotsPolicy {
  return {
    found,
    allowed: () => true
  };
}

function normalizeRobotsPath(value: string) {
  return value.trim() || "/";
}

function robotsPathMatches(path: string, rulePath: string) {
  if (!rulePath) return false;
  const escaped = rulePath
    .split("*")
    .map((part) => escapeRegExp(part))
    .join(".*");
  const suffix = rulePath.endsWith("$") ? "$" : "";
  const body = suffix ? escaped.slice(0, -2) : escaped;
  return new RegExp(`^${body}${suffix}`).test(path);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyExtractedFacts(): ExtractedBusinessFacts {
  return {
    categories: [],
    services: [],
    serviceHighlights: [],
    serviceAreas: [],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    pressLinks: []
  };
}

function extractTagContent(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return cleanText(match?.[1]);
}

function extractMetaContent(html: string, name: string) {
  const metaRegex = /<meta\b[^>]*>/gi;
  const tags = html.match(metaRegex) ?? [];
  const tag = tags.find((candidate) => new RegExp(`(?:name|property)=["']${escapeRegExp(name)}["']`, "i").test(candidate));
  return cleanText(extractAttribute(tag ?? "", "content"));
}

function extractLinkHref(html: string, rel: string) {
  const linkRegex = /<link\b[^>]*>/gi;
  const tags = html.match(linkRegex) ?? [];
  const tag = tags.find((candidate) => new RegExp(`rel=["']${rel}["']`, "i").test(candidate));
  return tag?.match(/href=["']([^"']*)["']/i)?.[1]?.trim();
}

function extractHrefs(html: string) {
  const hrefs: string[] = [];
  const regex = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    hrefs.push(decodeHtml(match[1]) ?? match[1]);
  }
  return hrefs;
}

function extractFormReferences(html: string, sourceUrl: string): CrawlFormReference[] {
  const references: CrawlFormReference[] = [];
  const regex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const action = normalizeOptionalUrl(extractAttribute(attributes, "action"), sourceUrl);
    const method = normalizeFormMethod(extractAttribute(attributes, "method"));
    const fields = extractFormFields(body);
    const fieldNames = unique(fields.map((field) => field.name).filter((name): name is string => Boolean(name))).slice(0, 20);
    const fieldTypes = unique(fields.map((field) => field.type)).slice(0, 16);
    const requiredFields = unique(fields.filter((field) => field.required && field.name).map((field) => field.name as string)).slice(0, 20);
    references.push({
      action,
      method,
      fieldNames,
      fieldTypes,
      requiredFields,
      hasEmailField: fieldTypes.includes("email") || fieldNames.some((name) => /email/i.test(name)),
      hasPhoneField: fieldTypes.includes("tel") || fieldNames.some((name) => /phone|tel/i.test(name)),
      hasTextarea: fieldTypes.includes("textarea")
    });
  }
  return references.slice(0, 12);
}

function extractFormFields(html: string) {
  const fields: Array<{ name?: string; type: string; required: boolean }> = [];
  for (const tag of html.match(/<(?:input|textarea|select)\b[^>]*>/gi) ?? []) {
    const tagName = tag.match(/^<([a-z]+)/i)?.[1]?.toLowerCase() ?? "input";
    const name =
      cleanText(extractAttribute(tag, "name")) ??
      cleanText(extractAttribute(tag, "id")) ??
      cleanText(extractAttribute(tag, "aria-label")) ??
      cleanText(extractAttribute(tag, "placeholder"));
    const type = tagName === "input" ? (extractAttribute(tag, "type") ?? "text").toLowerCase() : tagName;
    fields.push({
      name,
      type,
      required: /\srequired(?:[\s=>]|$)/i.test(tag)
    });
  }
  return fields;
}

function normalizeFormMethod(value?: string): CrawlFormReference["method"] {
  const method = value?.toLowerCase();
  return method === "get" || method === "post" || method === "dialog" ? method : "unknown";
}

function extractLinkReferences(html: string, sourceUrl: string, sourceHostname: string): CrawlLinkReference[] {
  const references: CrawlLinkReference[] = [];
  const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attributes = match[1] ?? "";
    const rawHref = extractAttribute(attributes, "href");
    if (!rawHref) continue;
    const text = cleanText(match[2]);
    const reference = normalizeLinkReference(rawHref, sourceUrl, sourceHostname, text);
    if (reference) references.push(reference);
  }
  return uniqueBy(references, (reference) => `${reference.kind}:${reference.href}`).slice(0, 60);
}

function normalizeLinkReference(
  rawHref: string,
  sourceUrl: string,
  sourceHostname: string,
  text?: string
): CrawlLinkReference | null {
  const href = rawHref.trim();
  if (!href) return null;
  const lowerHref = href.toLowerCase();
  if (lowerHref.startsWith("tel:")) return { href, text, kind: "tel" };
  if (lowerHref.startsWith("mailto:")) return { href: href.split("?")[0], text, kind: "mailto" };

  try {
    const url = new URL(href, sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const normalized = stripTracking(url);
    const host = normalized.hostname.replace(/^www\./, "");
    const sourceHost = sourceHostname.replace(/^www\./, "");
    const pathAndText = `${normalized.pathname} ${text ?? ""}`;
    const kind: CrawlLinkReference["kind"] =
      isOrderingHost(host) || /order|menu|takeout|delivery/i.test(pathAndText)
        ? "ordering"
        : isBookingHost(host) || /book|appointment|reserve|schedule/i.test(pathAndText)
          ? "booking"
          : isPressOrVideoHost(host)
            ? "press_video"
            : isSocialHost(host)
              ? "social"
              : host === sourceHost
                ? "internal"
                : "external";
    return { href: normalized.href, text, kind };
  } catch {
    return null;
  }
}

function extractBusinessFacts(
  html: string,
  page: { url: string; finalUrl?: string; title?: string },
  base: URL
): ExtractedBusinessFacts {
  const facts = emptyExtractedFacts();
  const jsonLdNodes = flattenJsonLd(extractJsonLd(html));
  const localNode =
    jsonLdNodes.find((node) => hasType(node, ["LocalBusiness", "Restaurant", "Dentist", "LegalService", "HomeAndConstructionBusiness"])) ??
    jsonLdNodes.find((node) => typeof node.name === "string");

  if (localNode) {
    facts.name = normalizeFact(localNode.name);
    facts.description = normalizeFact(localNode.description);
    facts.phone = normalizePhone(normalizeFact(localNode.telephone));
    facts.email = normalizeEmail(normalizeFact(localNode.email));
    facts.address = extractAddress(localNode.address);
    facts.geo = extractGeo(localNode.geo);
    facts.hours = extractHours(localNode);
    facts.categories = unique([...facts.categories, ...typesToCategories(localNode["@type"])]);
    facts.services = unique([...facts.services, ...extractServices(localNode)]);
    facts.serviceAreas = unique([...facts.serviceAreas, ...extractAreas(localNode)]);
    facts.reviewsSummary = extractRating(localNode);
  }
  facts.name = normalizeBusinessNameCandidate(facts.name, base.hostname);
  facts.name ||= normalizeBusinessNameCandidate(cleanText(extractMetaContent(html, "og:site_name")), base.hostname);
  facts.name ||= inferNameFromTitle(page.title, base.hostname);
  facts.hours ||= extractVisibleHours(html);
  facts.address ||= extractVisibleAddress(html);
  facts.services = unique([
    ...facts.services,
    ...extractVisibleServices(html, page, facts.name),
    ...extractServiceMentionsFromText(html)
  ]).slice(0, 12);
  facts.serviceHighlights = unique([...(facts.serviceHighlights ?? []), ...extractServiceHighlightsFromText(html)]).slice(0, 8);
  facts.phone ||= normalizePhone(extractTelLinks(html)[0] ?? extractPhoneFromText(html));
  facts.email ||= normalizeEmail(extractMailtoLinks(html)[0] ?? extractEmailFromText(html));

  for (const href of extractHrefs(html)) {
    try {
      const resolved = new URL(href, page.finalUrl ?? page.url);
      const normalized = stripTracking(resolved);
      const host = normalized.hostname.replace(/^www\./, "");
      if (isSocialHost(host)) facts.socialLinks.push(normalized.href);
      if (isOrderingHost(host) || /order|menu|takeout|delivery/i.test(normalized.pathname)) facts.orderingLinks.push(normalized.href);
      if (isBookingHost(host) || /book|appointment|reserve|schedule/i.test(normalized.pathname)) facts.bookingLinks.push(normalized.href);
      if (isPressOrVideoHost(host)) facts.pressLinks.push(normalized.href);
    } catch {
      // Ignore malformed external links during fact extraction.
    }
  }

  facts.categories = unique(facts.categories).slice(0, 8);
  facts.services = unique(facts.services).slice(0, 12);
  facts.serviceHighlights = unique(facts.serviceHighlights).slice(0, 8);
  facts.serviceAreas = unique(facts.serviceAreas).slice(0, 12);
  facts.socialLinks = unique(facts.socialLinks).slice(0, 10);
  facts.orderingLinks = unique(facts.orderingLinks).slice(0, 6);
  facts.bookingLinks = unique(facts.bookingLinks).slice(0, 6);
  facts.pressLinks = unique(facts.pressLinks).slice(0, 8);
  return facts;
}

function extractAssetReferences(html: string, sourceUrl: string): CrawlAssetReference[] {
  const references: CrawlAssetReference[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = extractAttribute(tag, "rel") ?? "";
    if (!/\b(?:icon|apple-touch-icon|shortcut icon)\b/i.test(rel)) continue;
    const href = extractAttribute(tag, "href");
    if (!href) continue;
    try {
      const url = new URL(href, sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      references.push({ url: url.href, alt: "Website icon reference", kind: "logo", rightsStatus: "reference_only" });
    } catch {
      // Ignore malformed icon URLs.
    }
  }
  // Social share images are usually the site's best wide photo and are often
  // higher-resolution than anything in the page body.
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const property = extractAttribute(tag, "property") ?? extractAttribute(tag, "name") ?? "";
    if (!/^(?:og:image|twitter:image)(?::src)?$/i.test(property)) continue;
    const content = extractAttribute(tag, "content");
    if (!content) continue;
    try {
      const url = new URL(content, sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      references.push({ url: url.href, alt: "Social share image", kind: "image", rightsStatus: "reference_only" });
    } catch {
      // Ignore malformed share image URLs.
    }
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src =
      largestSrcsetCandidate(extractAttribute(tag, "srcset") ?? extractAttribute(tag, "data-srcset")) ||
      extractAttribute(tag, "src") ||
      extractAttribute(tag, "data-src");
    if (!src) continue;
    try {
      const url = new URL(src, sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const alt = cleanText(extractAttribute(tag, "alt"));
      const className = extractAttribute(tag, "class") ?? "";
      const kind = /logo|brand/i.test(`${alt ?? ""} ${className} ${url.pathname}`) ? "logo" : "image";
      references.push({ url: url.href, alt, kind, rightsStatus: "reference_only" });
    } catch {
      // Ignore malformed asset URLs.
    }
  }
  return uniqueBy(references, (reference) => reference.url);
}

/** Pick the highest-density srcset candidate so downloads get the best raster the site serves. */
function largestSrcsetCandidate(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  let bestUrl: string | undefined;
  let bestDensity = -1;
  for (const candidate of srcset.split(",")) {
    const parts = candidate.trim().split(/\s+/);
    const url = parts[0];
    if (!url) continue;
    const descriptor = parts[1] ?? "";
    // Width descriptors ("800w") and pixel-density descriptors ("2x") are
    // comparable enough for max-selection within one srcset.
    const match = descriptor.match(/^([\d.]+)([wx])$/i);
    const density = match ? Number.parseFloat(match[1]) * (match[2].toLowerCase() === "x" ? 1000 : 1) : 0;
    if (density > bestDensity) {
      bestDensity = density;
      bestUrl = url;
    }
  }
  return bestUrl;
}

function extractJsonLdTypes(html: string) {
  return unique(
    flattenJsonLd(extractJsonLd(html))
      .flatMap((node) => toArray(node["@type"]))
      .filter((type): type is string => typeof type === "string")
  );
}

function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const json = match[1].replace(/<!--|-->/g, "").trim();
    try {
      blocks.push(JSON.parse(json));
    } catch {
      // Ignore malformed schema blocks rather than failing the crawl.
    }
  }
  return blocks;
}

function flattenJsonLd(input: unknown[]): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    nodes.push(record);
    if (Array.isArray(record["@graph"])) record["@graph"].forEach(visit);
  };
  input.forEach(visit);
  return nodes;
}

function hasType(node: Record<string, unknown>, types: string[]) {
  const values = toArray(node["@type"]).map((value) => String(value).toLowerCase());
  return types.some((type) => values.includes(type.toLowerCase()));
}

function normalizeFact(value: unknown) {
  return typeof value === "string" ? cleanText(value) : undefined;
}

function cleanText(value?: string) {
  return decodeHtml(value)
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(attribute)}=["']([^"']*)["']`, "i"));
  return decodeHtml(match?.[1])?.trim();
}

function extractAddress(value: unknown): ExtractedBusinessFacts["address"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const address = value as Record<string, unknown>;
  return {
    street: normalizeFact(address.streetAddress),
    city: normalizeFact(address.addressLocality),
    region: normalizeFact(address.addressRegion),
    postalCode: normalizeFact(address.postalCode),
    country: normalizeFact(address.addressCountry)
  };
}

function extractGeo(value: unknown): ExtractedBusinessFacts["geo"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const geo = value as Record<string, unknown>;
  const latitude = toNumber(geo.latitude);
  const longitude = toNumber(geo.longitude);
  return latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
}

function extractHours(node: Record<string, unknown>) {
  const values = unique([
    ...toArray(node.openingHours).map((value) => String(value)),
    ...toArray(node.openingHoursSpecification).flatMap(openingHoursSpecificationEntries)
  ].map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean));
  if (values.length === 0) return undefined;
  return Object.fromEntries(values.map((value, index) => [`hours_${index + 1}`, value]));
}

function extractServices(node: Record<string, unknown>) {
  const services: string[] = [];
  for (const key of ["knowsAbout", "serviceType", "makesOffer", "offers", "itemOffered", "hasOfferCatalog", "itemListElement"]) {
    for (const value of toArray(node[key])) {
      if (typeof value === "string") services.push(value);
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        services.push(...toArray(record.name).filter((item): item is string => typeof item === "string"));
        services.push(...extractServices(record));
      }
    }
  }
  return services.map(cleanServiceCandidate).filter((service): service is string => Boolean(service));
}

function openingHoursSpecificationEntries(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const days = toArray(record.dayOfWeek)
    .map((day) => typeof day === "string" ? dayFromSchemaValue(day) : undefined)
    .filter((day): day is string => Boolean(day));
  const opens = formatSchemaTime(record.opens);
  const closes = formatSchemaTime(record.closes);
  if (!days.length || !opens) return [];
  const label = dayRangeLabel(days);
  const valueText = closes ? `${opens} - ${closes}` : opens;
  return [`${label}: ${valueText}`];
}

function dayFromSchemaValue(value: string) {
  const key = value.split("/").at(-1)?.trim().toLowerCase();
  const days: Record<string, string> = {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday"
  };
  return key ? days[key] : undefined;
}

function dayRangeLabel(days: string[]) {
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const sorted = unique(days).sort((left, right) => order.indexOf(left) - order.indexOf(right));
  if (sorted.length <= 1) return sorted[0] ?? "Hours";
  const indexes = sorted.map((day) => order.indexOf(day));
  const contiguous = indexes.every((index, position) => position === 0 || index === indexes[position - 1] + 1);
  return contiguous ? `${sorted[0]}-${sorted[sorted.length - 1]}` : sorted.join(", ");
}

function formatSchemaTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return value.trim();
  const hour24 = Number.parseInt(match[1], 10);
  const minutes = match[2] ?? "00";
  if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return value.trim();
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

function extractVisibleServices(html: string, page: { url: string; title?: string }, businessName?: string): string[] {
  const candidates: string[] = [];
  const pageUrl = new URL(page.url);
  if (isServicePath(pageUrl.pathname)) {
    const titleCandidate = page.title?.split(/\s+[|-]\s+/)[0];
    if (titleCandidate && safeTextId(titleCandidate) !== safeTextId(businessName)) candidates.push(titleCandidate);
    const pathCandidate = serviceNameFromPath(pageUrl.pathname);
    if (pathCandidate) candidates.push(pathCandidate);
  }

  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = extractAttribute(match[1] ?? "", "href");
    const text = cleanText(match[2]);
    if (!href || !text) continue;
    try {
      const url = new URL(href, page.url);
      if (!isServicePath(url.pathname) && !serviceTextLooksSpecific(text)) continue;
      candidates.push(text);
      const pathCandidate = serviceNameFromPath(url.pathname);
      if (pathCandidate) candidates.push(pathCandidate);
    } catch {
      // Ignore malformed service links.
    }
  }

  return unique(candidates.map(cleanServiceCandidate).filter((service): service is string => Boolean(service))).slice(0, 12);
}

function extractVisibleHours(html: string): Record<string, string> | undefined {
  const lines = htmlToTextLines(html);
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  const pushEntry = (value: string) => {
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact || compact.length > 120) return;
    const key = compact.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push([`hours_${entries.length + 1}`, compact]);
  };

  for (const line of lines) {
    if (!/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|hours?)\b/i.test(line)) continue;
    if (!/\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|closed|by appointment)\b/i.test(line)) continue;
    pushEntry(line);
    if (entries.length >= 7) break;
  }

  const dayOnlyPattern = /^(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s*[–—-]\s*(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))?$/i;
  const timeOnlyPattern = /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*[–—-]\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)$|^(?:closed|by appointment)$/i;
  for (let index = 0; index < lines.length - 1 && entries.length < 7; index += 1) {
    const dayMatch = lines[index].match(dayOnlyPattern);
    if (!dayMatch) continue;
    const next = lines[index + 1]?.trim();
    if (!next || !timeOnlyPattern.test(next)) continue;
    pushEntry(`${dayMatch[0]} ${next}`);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function extractVisibleAddress(html: string): ExtractedBusinessFacts["address"] | undefined {
  const text = htmlToTextLines(html).join(", ");
  const statePattern =
    "(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|DC|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Iowa|Idaho|Illinois|Indiana|Kansas|Kentucky|Louisiana|Massachusetts|Maryland|Maine|Michigan|Minnesota|Missouri|Mississippi|Montana|North Carolina|North Dakota|Nebraska|New Hampshire|New Jersey|New Mexico|Nevada|New York|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Virginia|Vermont|Washington|Wisconsin|West Virginia|Wyoming|District of Columbia)";
  const match = text.match(
    new RegExp(
      "\\b(\\d{2,6}\\s+(?:[A-Za-z0-9'.#-]+\\s+){1,8}(?:Street|St\\.?|Avenue|Ave\\.?|Road|Rd\\.?|Boulevard|Blvd\\.?|Drive|Dr\\.?|Lane|Ln\\.?|Court|Ct\\.?|Circle|Cir\\.?|Way|Highway|Hwy\\.?|Parkway|Pkwy\\.?|Place|Pl\\.?)\\.?(?:\\s+(?:Suite|Ste\\.?|Unit|#)\\s*[A-Za-z0-9-]+)?)\\s*,?\\s+([A-Z][A-Za-z'. -]{2,60}?),?\\s+" +
        statePattern +
        "\\s+(\\d{5}(?:-\\d{4})?)\\b",
      "i"
    )
  );
  if (!match) return undefined;
  return {
    street: cleanText(match[1]),
    city: titleCase(cleanText(match[2]) ?? ""),
    region: normalizeStateRegion(match[3]),
    postalCode: match[4],
    country: "US"
  };
}

function normalizeStateRegion(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const states: Record<string, string> = {
    alabama: "AL",
    alaska: "AK",
    arizona: "AZ",
    arkansas: "AR",
    california: "CA",
    colorado: "CO",
    connecticut: "CT",
    delaware: "DE",
    florida: "FL",
    georgia: "GA",
    hawaii: "HI",
    iowa: "IA",
    idaho: "ID",
    illinois: "IL",
    indiana: "IN",
    kansas: "KS",
    kentucky: "KY",
    louisiana: "LA",
    massachusetts: "MA",
    maryland: "MD",
    maine: "ME",
    michigan: "MI",
    minnesota: "MN",
    missouri: "MO",
    mississippi: "MS",
    montana: "MT",
    "north carolina": "NC",
    "north dakota": "ND",
    nebraska: "NE",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    nevada: "NV",
    "new york": "NY",
    ohio: "OH",
    oklahoma: "OK",
    oregon: "OR",
    pennsylvania: "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    tennessee: "TN",
    texas: "TX",
    utah: "UT",
    virginia: "VA",
    vermont: "VT",
    washington: "WA",
    wisconsin: "WI",
    "west virginia": "WV",
    wyoming: "WY",
    "district of columbia": "DC"
  };
  return states[normalized] ?? value.toUpperCase();
}

function extractServiceMentionsFromText(html: string) {
  const text = htmlToTextLines(html).join(" ");
  const likelyFoodBusiness = /\b(restaurant|cafe|pizza|taqueria|bakery|coffee|dine[- ]?in|kitchen|bar and grill|breakfast|lunch|dinner)\b/i.test(text);
  const servicePatterns: Array<[RegExp, string, { foodOnly?: boolean }?]> = [
    [/\bhigh[-\s]?quality auto body repair\b|\bauto body repair\b|\bbody repair\b/i, "Auto Body Repair"],
    [/\bpaintless dent repair\b|\bPDR\b/i, "Paintless Dent Repair"],
    [/\bhail(?: damage)? repair\b|\bhail damage\b/i, "Hail Damage Repair"],
    [/\bautomotive glass services?\b|\bauto glass\b|\bwindshields?\b|\bwindows alike\b/i, "Automotive Glass Services"],
    [/\bcollision repair\b|\bfender benders?\b/i, "Collision Repair"],
    [/\bprofessional paint services?\b|\bpaint services?\b|\bpaint\s*(?:and|&)\s*body\b|\bauto(?:motive)? paint\b|\bpaint repair\b/i, "Professional Paint Services"],
    [/\bminor scratches\b|\bscratch(?:es)? repair\b|\bscratch damage\b|\bscuffs?\b/i, "Scratch Repair"],
    [/\bframe repair\b|\bstructural repair\b/i, "Frame Repair"],
    [/\bbumper repair\b/i, "Bumper Repair"],
    [/\bdent repair\b/i, "Dent Repair"],
    [/\bcatering\b/i, "Catering", { foodOnly: true }],
    [/\btakeout\b|\bpickup\b/i, "Takeout And Pickup", { foodOnly: true }],
    [/\bdelivery\b/i, "Delivery", { foodOnly: true }],
    [/\bconsultations?\b/i, "Consultations"],
    [/\bpreventive care\b|\bdental exams?\b/i, "Preventive Care"],
    [/\bcosmetic dentistry\b|\bwhitening\b/i, "Cosmetic Dentistry"],
    [/\blawn care\b/i, "Lawn Care"],
    [/\blandscape design\b/i, "Landscape Design"],
    [/\bseasonal cleanup\b/i, "Seasonal Cleanup"],
    [/\bplumbing repairs?\b/i, "Plumbing Repair"],
    [/\bhvac\b|\bheating and cooling\b/i, "HVAC Service"],
    [/\belectrical repairs?\b/i, "Electrical Repair"]
  ];
  return servicePatterns.flatMap(([pattern, label, options]) => (!options?.foodOnly || likelyFoodBusiness) && pattern.test(text) ? [label] : []);
}

function extractServiceHighlightsFromText(html: string) {
  const text = htmlToTextLines(html).join(" ");
  const highlights: string[] = [];
  if (/\bPDR\b|\bpaintless dent repair\b/i.test(text) && /\bhail\b/i.test(text)) {
    highlights.push("PDR for smaller dents and hail repair");
  } else if (/\bPDR\b|\bpaintless dent repair\b/i.test(text)) {
    highlights.push("Paintless dent repair questions");
  }
  if (/\bautomotive glass services?\b|\bauto glass\b|\bwindshields?\b|\bwindows alike\b/i.test(text)) {
    highlights.push("Automotive glass for windshields and windows");
  }
  return unique(highlights).slice(0, 6);
}

function extractJsonLdReviewEvidence(
  nodes: Array<Record<string, unknown>>,
  page: { url: string; title?: string }
): SiteEvidenceCandidateV1[] {
  return nodes
    .filter((node) => hasType(node, ["Review"]))
    .map((node) => {
      const quote = normalizeTestimonialQuote(normalizeFact(node.reviewBody) ?? normalizeFact(node.description));
      if (!quote) return undefined;
      const author = node.author && typeof node.author === "object" ? normalizeFact((node.author as Record<string, unknown>).name) : normalizeFact(node.author);
      return testimonialEvidenceCandidate({
        quote,
        attribution: author,
        page,
        sourceType: "website_json_ld",
        extractionMethod: "json_ld_review",
        confidence: 0.95
      });
    })
    .filter((value): value is SiteEvidenceCandidateV1 => Boolean(value))
    .slice(0, 4);
}

function extractVisibleTestimonialEvidence(html: string, page: { url: string; title?: string }): SiteEvidenceCandidateV1[] {
  const urlText = `${page.url} ${page.title ?? ""}`.toLowerCase();
  const reviewPage = /\b(reviews?|testimonials?|customers?|feedback)\b/.test(urlText);
  if (!reviewPage) return [];
  const lines = htmlToTextLines(html);
  const candidates = lines
    .map((line) => normalizeTestimonialQuote(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => (reviewPage || testimonialTextSignal(line)) && visibleCustomerTestimonialSignal(line))
    .map((quote) => testimonialEvidenceCandidate({
      quote,
      page,
      sourceType: "website_visible_text",
      extractionMethod: "visible_testimonial_text",
      confidence: reviewPage ? 0.86 : 0.74
    }))
    .filter((candidate): candidate is SiteEvidenceCandidateV1 => Boolean(candidate));
  return unique(candidates).slice(0, 4);
}

function normalizeTestimonialQuote(value: string | undefined) {
  const cleaned = cleanText(decodeHtml(value)
    ?.replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'"))
    ?.replace(/^[“"']+|[”"']+$/g, "")
    .replace(/^\s*(?:★|⭐|\*)+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.length < 45 || cleaned.length > 220) return undefined;
  if (/@/.test(cleaned)) return undefined;
  if (/©|all rights reserved/i.test(cleaned)) return undefined;
  if (/\b(write|leave|read|see|view|submit)\s+(?:a\s+)?reviews?\b/i.test(cleaned)) return undefined;
  if (/\b(copyright|privacy policy|terms of (?:use|service)|login|view gallery)\b/i.test(cleaned)) return undefined;
  if (/\b(get started with a (?:free )?estimate|please call our|location nearest you|thank you for contacting us|we will get back to you|form (?:was )?submitted)\b/i.test(cleaned)) return undefined;
  if (/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i.test(cleaned)) return undefined;
  if (/(?:\.{3}|…)[\s"']*$/.test(cleaned) || /^[\s"']*(?:\.{3}|…)/.test(cleaned)) return undefined;
  const words = cleaned.split(/\s+/);
  if (words.length < 7 || words.length > 42) return undefined;
  if (!testimonialTextSignal(cleaned)) return undefined;
  return cleaned;
}

function testimonialTextSignal(value: string) {
  return /\b(great|excellent|amazing|professional|recommend|recommended|honest|helpful|friendly|fast|quality|perfect|happy|satisfied|best|thank|appreciate)\b/i.test(value);
}

function visibleCustomerTestimonialSignal(value: string) {
  if (/^(?:where|restore|from|texas weather|no matter|appointments?|ready to|get a|serving)\b/i.test(value)) return false;
  if (/\b(original condition|major structural damage|insurance companies|repair process|smooth and hassle-free|expert craftsmanship|exceptional results)\b/i.test(value)) return false;
  const positiveExperience =
    /\b(highly recommend|recommend(?:ed)?|great (?:service|job|work|experience)|excellent (?:service|work|job)|amazing|professional|honest|helpful|friendly|perfect|happy|satisfied|thank(?:s| you)?)\b/i.test(
      value
    );
  if (!positiveExperience) return false;
  return /\b(i|me|my|we|our|they|their|them|mencia|shop|team|staff|owner|service|job|work|repair)\b/i.test(value);
}

function testimonialEvidenceCandidate(input: {
  quote: string;
  attribution?: string;
  page: { url: string; title?: string };
  sourceType: "website_json_ld" | "website_visible_text";
  extractionMethod: string;
  confidence: number;
}): SiteEvidenceCandidateV1 | undefined {
  const quote = normalizeTestimonialQuote(input.quote);
  if (!quote || !visibleCustomerTestimonialSignal(quote)) return undefined;
  const attribution = input.attribution && !/@/.test(input.attribution) && input.attribution.length <= 60
    ? input.attribution
    : "Customer review";
  return {
    domain: "business_proof",
    kind: "testimonial",
    label: "First-party customer testimonial",
    value: { text: quote, quote, attribution },
    source: {
      type: input.sourceType,
      url: input.page.url,
      pageTitle: input.page.title,
      extractionMethod: input.extractionMethod,
      snippet: quote
    },
    confidence: input.confidence,
    renderPolicy: "durable_render",
    verification: "source_backed",
    notes: ["Exact quote retained from the business's own website with page-level provenance."]
  };
}

function extractSiteEvidenceCandidates(
  html: string,
  page: { url: string; title?: string },
  base: URL
): SiteEvidenceCandidateV1[] {
  const jsonLdNodes = flattenJsonLd(extractJsonLd(html));
  const testimonialEvidence = [
    ...extractJsonLdReviewEvidence(jsonLdNodes, page),
    ...extractVisibleTestimonialEvidence(html, page)
  ];
  const visibleClaims = extractVisibleClaimEvidence(html, page);
  return uniqueBy([...testimonialEvidence, ...visibleClaims], (candidate) =>
    `${candidate.kind}:${normalizeEvidenceKey(candidate.value.text)}:${base.hostname}`
  ).slice(0, 18);
}

function extractVisibleClaimEvidence(html: string, page: { url: string; title?: string }): SiteEvidenceCandidateV1[] {
  const lines = htmlToTextLines(html)
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line))
    .filter(isEvidenceClaimLine);
  const definitions: Array<{
    kind: SiteEvidenceKindV1;
    label: string;
    pattern: RegExp;
    renderPolicy: SiteEvidenceCandidateV1["renderPolicy"];
    confidence: number;
  }> = [
    {
      kind: "credential",
      label: "Source credential",
      pattern: /\b(?:I-CAR(?:\s+Gold Class)?|ASE(?:\s+Certified)?|OEM[-\s]?certified|factory[-\s]?certified|manufacturer[-\s]?certified|certified collision repair|BBB Accredited|licensed and insured)\b/i,
      renderPolicy: "durable_render",
      confidence: 0.9
    },
    {
      kind: "warranty",
      label: "Source warranty claim",
      pattern: /\b(?:(?:lifetime|limited|written|nationwide|manufacturer(?:'s)?)\s+)?warrant(?:y|ies)\b|\bguarantee(?:d|s)?\b/i,
      renderPolicy: "owner_review_required",
      confidence: 0.84
    },
    {
      kind: "insurance_support",
      label: "Source insurance-support claim",
      pattern: /\b(?:(?:handle|manage) communication with (?:all |your )?insurance compan(?:y|ies)|insurance claims?|claim assistance|work(?:ing)? with (?:all |your )?insurance(?: compan(?:y|ies))?|direct repair program)\b/i,
      renderPolicy: "durable_render",
      confidence: 0.88
    },
    {
      kind: "award",
      label: "Source award claim",
      pattern: /\b(?:award(?:ed|s)?|winner|best of|recognized by|top[-\s]?rated)\b/i,
      renderPolicy: "owner_review_required",
      confidence: 0.76
    },
    {
      kind: "years_in_business",
      label: "Source longevity claim",
      pattern: /\b(?:established(?:\s+in)?\s+(?:19|20)\d{2}|(?:founded|opened|started)\b[^.]{0,80}?\b(?:19|20)\d{2}|serving[^.]{0,40}since|since\s+(?:19|20)\d{2}|(?:over|more than)\s+\d{1,3}\s+years?|\d{1,3}\+\s+years?)\b/i,
      renderPolicy: "durable_render",
      confidence: 0.84
    },
    {
      kind: "offer",
      label: "Source offer",
      pattern: /\b(?:free\s+(?:repair\s+)?(?:quote|estimate)|complimentary\s+(?:quote|estimate|consultation))\b/i,
      renderPolicy: "owner_review_required",
      confidence: 0.86
    }
  ];
  const candidates: SiteEvidenceCandidateV1[] = [];
  for (const definition of definitions) {
    for (const line of lines.filter((candidate) => definition.pattern.test(candidate)).slice(0, 3)) {
      const matchedClaim = line.match(definition.pattern)?.[0]?.trim();
      candidates.push({
        domain: "business_proof",
        kind: definition.kind,
        label: definition.label,
        value: {
          text: line,
          displayText: evidenceClaimDisplayText(definition.kind, matchedClaim || line)
        },
        source: {
          type: "website_visible_text",
          url: page.url,
          pageTitle: page.title,
          extractionMethod: `visible_${definition.kind}_claim`,
          snippet: line
        },
        confidence: definition.confidence,
        renderPolicy: definition.renderPolicy,
        verification: "source_backed"
      });
    }
  }
  return candidates;
}

function evidenceClaimDisplayText(kind: SiteEvidenceKindV1, value: string) {
  const clean = value.trim().replace(/[.]+$/, "");
  if (kind !== "insurance_support") return clean;
  if (/^work(?:ing)? with all insurance(?: compan(?:y|ies))?$/i.test(clean)) {
    return "Works with all insurance companies";
  }
  if (/^work(?:ing)? with your insurance(?: compan(?:y|ies))?$/i.test(clean)) {
    return "Works with your insurance company";
  }
  if (/^insurance claims?$/i.test(clean)) return "Insurance claim support";
  if (/^claim assistance$/i.test(clean)) return "Insurance claim assistance";
  if (/^(?:handle|manage) communication with (?:all |your )?insurance compan(?:y|ies)$/i.test(clean)) return "Insurance claim assistance";
  return clean;
}

function isEvidenceClaimLine(value: string) {
  if (value.length < 12 || value.length > 260) return false;
  const wordCount = value.split(/\s+/).length;
  if (wordCount < 3 || wordCount > 48) return false;
  if (/\b(?:privacy|terms|copyright|all rights reserved|read more|learn more|click here|navigation|menu)\b/i.test(value)) return false;
  if (/\?$/.test(value)) return false;
  return true;
}

function normalizeEvidenceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isServicePath(pathname: string) {
  return /\/(?:services?|treatments?|practice-areas?|menu|repairs?|solutions?|what-we-do)(?:\/|$)/i.test(pathname);
}

function serviceNameFromPath(pathname: string) {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const serviceIndex = segments.findIndex((segment) => /^(services?|treatments?|practice-areas?|menu|repairs?|solutions?|what-we-do)$/i.test(segment));
  const candidate = serviceIndex >= 0 ? segments[serviceIndex + 1] : segments.at(-1);
  return candidate ? cleanServiceCandidate(candidate.replace(/[-_]+/g, " ")) : undefined;
}

function serviceTextLooksSpecific(value: string) {
  if (!/\b(repair|install|clean|cleaning|consult|consultation|treatment|service|menu|catering|delivery|booking|appointment|estate|planning|injury|hvac|plumbing|electrical|landscap|lawn|color|cut|crowns?|whitening|exam|portrait|photography|collision|automotive|paint|body|dent|hail|windshield|glass|pdr)\b/i.test(value)) {
    return false;
  }
  return Boolean(cleanServiceCandidate(value));
}

function cleanServiceCandidate(value: string | undefined) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  if (/^(?:&m?dash;|[–—-])\s*/i.test(raw)) return undefined;
  if (/^(skip\s+(?:to\s+)?content|view|learn more|read more|show more|close|back|next|previous)$/i.test(raw)) return undefined;
  const cleaned = raw
    ?.replace(/\b(learn more|read more|view all|all services|our services|services|service|menu|book now|schedule|contact|about|home)\b/gi, " ")
    .replace(/[|•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  if (/^(?:&m?dash;|[–—-])\s*/i.test(cleaned)) return undefined;
  if (/^(skip\s+(?:to\s+)?content|view|learn more|read more|show more|close|back|next|previous)$/i.test(cleaned)) return undefined;
  if (cleaned.length < 3 || cleaned.length > 64) return undefined;
  if (/[{}<>@]/.test(cleaned)) return undefined;
  if (/\b(home|about|contact|gallery|reviews?|testimonials?|blog|careers?|privacy|terms|login|sign in)\b/i.test(cleaned)) return undefined;
  const words = cleaned.split(/\s+/);
  if (words.length > 7) return undefined;
  if (words.every((word) => /^\d+$/.test(word))) return undefined;
  return cleaned.replace(/\b\w/g, (character) => character.toUpperCase());
}

function safeTextId(value: string | undefined) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function htmlToTextLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|section|article|header|footer|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    ?.split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean) ?? [];
}

function extractAreas(node: Record<string, unknown>) {
  return toArray(node.areaServed)
    .map((value) => {
      if (typeof value === "string") return cleanText(value);
      if (value && typeof value === "object") return normalizeFact((value as Record<string, unknown>).name);
      return undefined;
    })
    .filter((area): area is string => Boolean(area));
}

function extractRating(node: Record<string, unknown>) {
  const aggregateRating = node.aggregateRating;
  if (!aggregateRating || typeof aggregateRating !== "object") return undefined;
  const record = aggregateRating as Record<string, unknown>;
  return {
    rating: toNumber(record.ratingValue),
    count: toNumber(record.reviewCount ?? record.ratingCount),
    sources: ["website_schema"]
  };
}

function typesToCategories(types: unknown) {
  return toArray(types)
    .filter((type): type is string => typeof type === "string")
    .map((type) => type.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function extractTelLinks(html: string) {
  return extractHrefs(html).filter((href) => href.toLowerCase().startsWith("tel:")).map((href) => href.replace(/^tel:/i, ""));
}

function extractMailtoLinks(html: string) {
  return extractHrefs(html).filter((href) => href.toLowerCase().startsWith("mailto:")).map((href) => href.replace(/^mailto:/i, "").split("?")[0]);
}

function extractPhoneFromText(html: string) {
  const text = cleanText(html);
  if (!text) return undefined;
  const candidates = Array.from(
    text.matchAll(/(?:^|[^\d])((?:\+?1[\s.-]+)?(?:\(\d{3}\)|\d{3})[\s.-]+\d{3}[\s.-]+\d{4})(?=$|[^\d])/g)
  ).map((match) => match[1]);
  return candidates.find((candidate) => Boolean(normalizePhone(candidate)));
}

function extractEmailFromText(html: string) {
  return cleanText(html)?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function normalizePhone(value?: string) {
  if (!value) return undefined;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.length < 10) return undefined;
  if (digits.startsWith("+")) return /^\+\d{10,15}$/.test(digits) ? digits : undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

function normalizeEmail(value?: string) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  if (isPlaceholderEmail(email)) return undefined;
  return email;
}

function isPlaceholderEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return true;
  if (/^(example|domain|yourdomain|test)\./i.test(domain)) return true;
  return /^(user|name|email|you|yourname|test|example)$/i.test(local) && /(?:domain|example|yourdomain)\./i.test(domain);
}

function inferNameFromTitle(title: string | undefined, hostname: string) {
  const candidates = title
    ?.split(/\s+(?:[|\u2013\u2014-])\s+/)
    .map((candidate) => cleanText(candidate))
    .filter((candidate): candidate is string => Boolean(candidate && candidate.length >= 2 && candidate.length <= 80));
  const scored = (candidates ?? [])
    .map((candidate, index) => ({
      candidate,
      score: titleNameScore(candidate, hostname, index === (candidates?.length ?? 0) - 1)
    }))
    .sort((left, right) => right.score - left.score);
  const best = scored.find((candidate) => candidate.score > 0);
  if (best) return best.candidate;
  return hostname
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeBusinessNameCandidate(value: string | undefined, hostname: string) {
  if (!value) return undefined;
  const cleaned = cleanText(value);
  if (!cleaned) return undefined;
  const candidates = cleaned
    .split(/\s+(?:[|\u2013\u2014-])\s+/)
    .map((candidate) => cleanText(candidate))
    .filter((candidate): candidate is string => Boolean(candidate && candidate.length >= 2 && candidate.length <= 80))
    .filter((candidate) => !/^(home|about us|contact us|contact|gallery|portfolio|privacy policy|terms)$/i.test(candidate));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return cleaned;
  return (
    candidates
      .map((candidate, index) => ({
        candidate,
        score: titleNameScore(candidate, hostname, index === candidates.length - 1)
      }))
      .sort((left, right) => right.score - left.score)[0]?.candidate ?? cleaned
  );
}

function titleNameScore(candidate: string, hostname: string, lastSegment: boolean) {
  let score = lastSegment ? 1 : 0;
  const hostTokens = safeTextId(hostname.replace(/^www\./, "").split(".")[0]);
  const candidateTokens = safeTextId(candidate);
  if (hostTokens && (candidateTokens.includes(hostTokens) || hostTokens.includes(candidateTokens))) score += 4;
  const hostWords = new Set(hostname.replace(/^www\./, "").split(".")[0]?.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3) ?? []);
  const candidateWords = new Set(candidate.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
  const overlap = Array.from(hostWords).filter((word) => candidateWords.has(word)).length;
  score += Math.min(overlap * 2, 4);
  if (/\b(auto|automotive|body|paint|collision|repair|restaurant|cafe|taco|dental|law|salon|spa|clinic|plumbing|hvac|landscap|studio|shop|company|co\.?|llc|inc\.?)\b/i.test(candidate)) score += 2;
  if (/\b(done right|welcome|official|quality|best|affordable|professional)\b/i.test(candidate)) score -= 3;
  if (/[!?]/.test(candidate)) score -= 2;
  if (candidate.split(/\s+/).length < 2) score -= 1;
  return score;
}

function isSocialHost(host: string) {
  return /(?:instagram|facebook|linkedin|twitter|x\.com|tiktok|youtube|pinterest)\.com$/.test(host);
}

function isOrderingHost(host: string) {
  return /(?:toasttab|squareup|doordash|ubereats|grubhub|chownow|clover)\.com$/.test(host);
}

function isBookingHost(host: string) {
  return /(?:opentable|resy|booksy|vagaro|mindbodyonline|fresha|calendly|acuityscheduling|squareup)\.com$/.test(host);
}

function isPressOrVideoHost(host: string) {
  return /(?:youtube|vimeo|youtu\.be|medium|substack|news)\.com$/.test(host);
}

function stripTracking(url: URL) {
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url;
}

function stripHash(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function normalizeOptionalUrl(value: string | undefined, sourceUrl: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, sourceUrl);
    return stripTracking(url).href;
  } catch {
    return value.trim() || undefined;
  }
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function toNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function countMatches(html: string, regex: RegExp) {
  return html.match(regex)?.length ?? 0;
}

function countImagesWithoutAlt(html: string) {
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  return imgTags.filter((tag) => !/\balt=["'][^"']*["']/i.test(tag)).length;
}

function selectInternalCrawlTargets(urls: string[], sourceUrl: string, limit: number) {
  if (limit <= 0) return [];
  const source = new URL(sourceUrl);
  return unique(urls)
    .map((value) => {
      try {
        const url = new URL(value, source.href);
        url.hash = "";
        return url;
      } catch {
        return null;
      }
    })
    .filter((url): url is URL => Boolean(url))
    .filter((url) => ["http:", "https:"].includes(url.protocol))
    .filter((url) => sameHostname(url.hostname, source.hostname))
    .filter((url) => normalizePath(url.pathname) !== normalizePath(source.pathname))
    .filter((url) => !isNonHtmlPath(url.pathname))
    .sort((left, right) => internalCrawlPriority(left) - internalCrawlPriority(right))
    .map((url) => stripTracking(url).href)
    .slice(0, limit);
}

function mergeExtractedBusinessFacts(left: ExtractedBusinessFacts, right: ExtractedBusinessFacts): ExtractedBusinessFacts {
  return {
    name: left.name ?? right.name,
    description: left.description ?? right.description,
    phone: left.phone ?? right.phone,
    email: left.email ?? right.email,
    address: mergeAddress(left.address, right.address),
    geo: left.geo ?? right.geo,
    hours: left.hours ?? right.hours,
    categories: unique([...left.categories, ...right.categories]).slice(0, 8),
    services: unique([...left.services, ...right.services]).slice(0, 12),
    serviceHighlights: unique([...(left.serviceHighlights ?? []), ...(right.serviceHighlights ?? [])]).slice(0, 8),
    serviceAreas: unique([...left.serviceAreas, ...right.serviceAreas]).slice(0, 12),
    socialLinks: unique([...left.socialLinks, ...right.socialLinks]).slice(0, 10),
    bookingLinks: unique([...left.bookingLinks, ...right.bookingLinks]).slice(0, 6),
    orderingLinks: unique([...left.orderingLinks, ...right.orderingLinks]).slice(0, 6),
    pressLinks: unique([...left.pressLinks, ...right.pressLinks]).slice(0, 8),
    reviewsSummary: left.reviewsSummary ?? right.reviewsSummary
  };
}

function mergeAddress(left: ExtractedBusinessFacts["address"], right: ExtractedBusinessFacts["address"]) {
  if (!left && !right) return undefined;
  return {
    street: left?.street ?? right?.street,
    city: left?.city ?? right?.city,
    region: left?.region ?? right?.region,
    postalCode: left?.postalCode ?? right?.postalCode,
    country: left?.country ?? right?.country
  };
}

function formReferenceKey(reference: CrawlFormReference) {
  return [
    reference.action ?? "",
    reference.method,
    reference.fieldNames.join(","),
    reference.fieldTypes.join(","),
    reference.requiredFields.join(",")
  ].join(":");
}

function internalCrawlPriority(url: URL) {
  const value = `${url.pathname} ${url.search}`.toLowerCase();
  if (/contact|get-in-touch|quote|estimate|request/.test(value)) return 0;
  if (/review|testimonial|gallery|showroom|portfolio|work|before|after/.test(value)) return 1;
  if (/service|menu|order|book|appointment|schedule|reserve/.test(value)) return 2;
  if (/location|hours|about|team|staff/.test(value)) return 2;
  if (/faq/.test(value)) return 3;
  return 9;
}

function isNonHtmlPath(pathname: string) {
  return /\.(?:pdf|zip|jpg|jpeg|png|gif|webp|svg|ico|css|js|json|xml|mp4|mov|mp3|webmanifest)$/i.test(pathname);
}

function normalizePath(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

function sameHostname(left: string, right: string) {
  return left.replace(/^www\./, "") === right.replace(/^www\./, "");
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value?: string) {
  return value
    ?.replace(/&#x([0-9a-f]+);/gi, (_, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)))
    .replace(/&#(\d+);/g, (_, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'");
}
