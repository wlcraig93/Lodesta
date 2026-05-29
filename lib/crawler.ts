import { getStandardCriterion } from "./standard";

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
  assetReferences: CrawlAssetReference[];
  sampledInternalPages: string[];
  score: CrawlQualityScore;
  findings: string[];
  error?: string;
};

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
  hours?: Record<string, string>;
  categories: string[];
  services: string[];
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

export async function crawlUrl(url: string): Promise<CrawlAssessment> {
  const base = new URL(url);
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
    assetReferences: [],
    sampledInternalPages: [],
    score: emptyScore(),
    findings: []
  };

  try {
    const response = await fetchWithPresenceHeaders(url);
    const html = await response.text();
    assessment.fetched = true;
    assessment.status = response.status;
    assessment.finalUrl = response.url;
    assessment.title = extractTagContent(html, "title");
    assessment.metaDescription = extractMetaContent(html, "description");
    assessment.canonical = extractLinkHref(html, "canonical");
    assessment.hasViewportMeta = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
    assessment.hasLocalBusinessSchema = /LocalBusiness|Restaurant|Dentist|LegalService|HomeAndConstructionBusiness/i.test(html);
    assessment.hasTelLink = /href=["']tel:/i.test(html);
    assessment.formCount = countMatches(html, /<form\b/gi);
    assessment.imageCount = countMatches(html, /<img\b/gi);
    assessment.imagesWithoutAlt = countImagesWithoutAlt(html);
    assessment.jsonLdTypes = extractJsonLdTypes(html);
    assessment.extractedFacts = extractBusinessFacts(html, assessment, base);
    assessment.assetReferences = extractAssetReferences(html, assessment.finalUrl ?? url).slice(0, 12);

    for (const href of extractHrefs(html)) {
      try {
        const resolved = new URL(href, assessment.finalUrl ?? url);
        if (!["http:", "https:"].includes(resolved.protocol)) continue;
        if (resolved.hostname === base.hostname) {
          assessment.internalLinkCount += 1;
          if (assessment.sampledInternalPages.length < 12) assessment.sampledInternalPages.push(stripHash(resolved.href));
        } else {
          assessment.externalLinkCount += 1;
        }
      } catch {
        // Ignore malformed hrefs during the cheap crawl pass.
      }
    }
    assessment.sampledInternalPages = unique(assessment.sampledInternalPages);
    const crawlBase = new URL(assessment.finalUrl ?? url);
    const [robots, sitemap] = await Promise.all([
      probeUrl(new URL("/robots.txt", crawlBase).href),
      probeUrl(new URL("/sitemap.xml", crawlBase).href)
    ]);
    assessment.robotsFound = robots;
    assessment.sitemapFound = sitemap;

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

export function scoreCrawlAssessment(assessment: CrawlAssessment): CrawlQualityScore {
  const checks: CrawlQualityCheck[] = [
    check("technical.healthy_response", "technical", Boolean(assessment.fetched && assessment.status && assessment.status < 400), 10),
    check("technical.mobile_viewport", "technical", assessment.hasViewportMeta, 10),
    check("seo.local_business_schema", "seo", assessment.hasLocalBusinessSchema, 15),
    check("seo.title.unique", "seo", Boolean(assessment.title && assessment.title.length >= 25), 10),
    check("seo.meta_description", "seo", Boolean(assessment.metaDescription && assessment.metaDescription.length >= 80), 10),
    check("seo.canonical", "seo", Boolean(assessment.canonical), 5),
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
  if (!assessment.fetched || (assessment.status && assessment.status >= 400)) findings.push("Site did not return a healthy HTML response.");
  if (!assessment.title || assessment.title.length < 25) findings.push("Title is missing or too short.");
  if (!assessment.metaDescription || assessment.metaDescription.length < 80) findings.push("Meta description is missing or too short.");
  if (!assessment.canonical) findings.push("Canonical link is missing.");
  if (!assessment.robotsFound) findings.push("robots.txt was not detected.");
  if (!assessment.sitemapFound) findings.push("sitemap.xml was not detected.");
  if (!assessment.hasViewportMeta) findings.push("Mobile viewport meta tag is missing.");
  if (!assessment.hasLocalBusinessSchema) findings.push("LocalBusiness structured data was not detected.");
  if (!assessment.hasTelLink) findings.push("Click-to-call tel link was not detected.");
  if (assessment.formCount === 0) findings.push("No lead/contact form was detected.");
  if (assessment.imageCount > 0 && assessment.imagesWithoutAlt > 0) findings.push("Some images are missing alt text.");
  return findings;
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

function emptyExtractedFacts(): ExtractedBusinessFacts {
  return {
    categories: [],
    services: [],
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

function extractBusinessFacts(html: string, assessment: CrawlAssessment, base: URL): ExtractedBusinessFacts {
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
    facts.hours = extractHours(localNode);
    facts.categories = unique([...facts.categories, ...typesToCategories(localNode["@type"])]);
    facts.services = unique([...facts.services, ...extractServices(localNode)]);
    facts.serviceAreas = unique([...facts.serviceAreas, ...extractAreas(localNode)]);
    facts.reviewsSummary = extractRating(localNode);
  }

  facts.name ||= cleanText(extractMetaContent(html, "og:site_name")) ?? inferNameFromTitle(assessment.title, base.hostname);
  facts.phone ||= normalizePhone(extractTelLinks(html)[0] ?? extractPhoneFromText(html));
  facts.email ||= normalizeEmail(extractMailtoLinks(html)[0] ?? extractEmailFromText(html));

  for (const href of extractHrefs(html)) {
    try {
      const resolved = new URL(href, assessment.finalUrl ?? assessment.url);
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
  facts.serviceAreas = unique(facts.serviceAreas).slice(0, 12);
  facts.socialLinks = unique(facts.socialLinks).slice(0, 10);
  facts.orderingLinks = unique(facts.orderingLinks).slice(0, 6);
  facts.bookingLinks = unique(facts.bookingLinks).slice(0, 6);
  facts.pressLinks = unique(facts.pressLinks).slice(0, 8);
  return facts;
}

function extractAssetReferences(html: string, sourceUrl: string): CrawlAssetReference[] {
  const references: CrawlAssetReference[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = extractAttribute(tag, "src") || extractAttribute(tag, "data-src");
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

function extractHours(node: Record<string, unknown>) {
  const values = toArray(node.openingHours);
  if (values.length === 0) return undefined;
  return Object.fromEntries(values.map((value, index) => [`hours_${index + 1}`, String(value)]));
}

function extractServices(node: Record<string, unknown>) {
  const services: string[] = [];
  for (const key of ["knowsAbout", "serviceType", "makesOffer"]) {
    for (const value of toArray(node[key])) {
      if (typeof value === "string") services.push(value);
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        services.push(...toArray(record.name).filter((item): item is string => typeof item === "string"));
        services.push(...extractServices(record));
      }
    }
  }
  return services.map((service) => cleanText(service)).filter((service): service is string => Boolean(service));
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
  return cleanText(html)?.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0];
}

function extractEmailFromText(html: string) {
  return cleanText(html)?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function normalizePhone(value?: string) {
  if (!value) return undefined;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.length < 10) return undefined;
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

function normalizeEmail(value?: string) {
  return value?.trim().toLowerCase();
}

function inferNameFromTitle(title: string | undefined, hostname: string) {
  const titleName = title?.split(/\s+[|-]\s+/)[0]?.trim();
  if (titleName && titleName.length >= 2 && titleName.length <= 80) return titleName;
  return hostname
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
