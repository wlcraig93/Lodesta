import { canonicalSourceTokens } from "@/lib/source-text-blocks";
import {
  classifySourcePagePath,
  isLegalSourcePagePath,
  isLikelyInjectedSpamSourcePage,
  normalizedSourcePagePath
} from "./source-page-classification";

/**
 * First-party support: the one shared answer to "does this sentence, value,
 * link, or image host appear on the business's own retained pages, on which
 * kind of page, and how current is that page?"
 *
 * Owner-approved principle (September 24, 2026): the business's own verbatim
 * first-party content is trusted by default, with provenance. New claims the
 * author writes in its own voice are still verified against bound facts. This
 * module never authorizes an AI restatement: callers use it only for text,
 * values, links, and images that match the retained source exactly.
 */

export type FirstPartyPageRole =
  | "home"
  | "contact"
  | "about"
  /** Any other current customer page: services, FAQ, gallery, reviews. */
  | "service"
  | "blog"
  | "archive"
  | "legal"
  | "utility";

/** Current core pages: the business's standing statements about itself. */
export const coreFirstPartyPageRoles: ReadonlySet<FirstPartyPageRole> = new Set(["home", "contact", "about", "service"]);

export type FirstPartySupportPageInput = {
  url: string;
  path?: string;
  title?: string;
  text: string;
  /** Absolute hrefs shown on the page, including tel: and mailto:. */
  links?: readonly string[];
  /** Absolute image URLs the page loads. */
  imageUrls?: readonly string[];
  lastModified?: string;
  purposeTags?: readonly string[];
};

export type FirstPartyPageEvidence = {
  url: string;
  path: string;
  role: FirstPartyPageRole;
  core: boolean;
  /** Path/title name an injected off-topic spam post the homepage never mentions. */
  injected: boolean;
  lastModified?: string;
};

export function firstPartyPageRole(input: { path: string; title?: string; purposeTags?: readonly string[] }): FirstPartyPageRole {
  const path = normalizedSourcePagePath(input.path).toLocaleLowerCase();
  if (path === "/") return "home";
  if (isLegalSourcePagePath(path)) return "legal";
  const classification = classifySourcePagePath(path);
  if (classification === "mechanical_archive") return "archive";
  if (classification === "technical_or_utility") return "utility";
  const segments = path.split("/").filter(Boolean);
  const tags = input.purposeTags ?? [];
  if (tags.includes("blog")
    || segments.some((segment) => /^(?:blog|blogs|news|articles?|posts?|press|events?|archives?|updates?)$/.test(segment))
    || segments.some((segment) => /^(?:19|20)\d{2}$/.test(segment))) {
    return "blog";
  }
  if (tags.includes("contact") || /^(?:contact(?:-us)?|locations?|visit(?:-us)?|hours|directions|find-us)$/.test(segments[0] ?? "")) return "contact";
  if (tags.includes("about") || /^(?:about(?:-us)?|our-story|story|team|our-team|who-we-are|history|company)$/.test(segments[0] ?? "")) return "about";
  return "service";
}

type IndexedPage = FirstPartyPageEvidence & {
  tokens: string[];
  digits: string;
  emails: Set<string>;
  links: Set<string>;
  imageHosts: Set<string>;
};

export class FirstPartySupport {
  readonly pages: readonly FirstPartyPageEvidence[];
  private readonly indexed: IndexedPage[];

  constructor(pages: readonly FirstPartySupportPageInput[]) {
    const homepageText = pages
      .filter((page) => normalizedSourcePagePath(page.path ?? safePath(page.url)) === "/")
      .map((page) => `${page.title ?? ""}\n${page.text}`)
      .join("\n");
    this.indexed = pages.map((page) => {
      const path = normalizedSourcePagePath(page.path ?? safePath(page.url));
      const role = firstPartyPageRole({ path, title: page.title, purposeTags: page.purposeTags });
      return {
        url: page.url,
        path,
        role,
        core: coreFirstPartyPageRoles.has(role),
        injected: isLikelyInjectedSpamSourcePage({ path, title: page.title }, homepageText),
        ...(page.lastModified ? { lastModified: page.lastModified } : {}),
        tokens: canonicalSourceTokens(page.text).map((token) => token.value),
        digits: page.text.replace(/\D/g, " "),
        emails: new Set((page.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((value) => value.toLowerCase())),
        links: new Set((page.links ?? []).flatMap((href) => {
          const normalized = normalizedFirstPartyHref(href);
          return normalized ? [normalized] : [];
        })),
        imageHosts: new Set((page.imageUrls ?? []).flatMap((url) => {
          try {
            return [new URL(url).hostname.toLowerCase().replace(/^www\./, "")];
          } catch {
            return [];
          }
        }))
      };
    });
    this.pages = this.indexed.map(({ tokens: _tokens, digits: _digits, emails: _emails, links: _links, imageHosts: _hosts, ...page }) => page);
  }

  /** Pages (never injected spam) whose visible text contains this exact token sequence. */
  text(text: string, options: { minimumTokens?: number } = {}): FirstPartyPageEvidence[] {
    const needle = canonicalSourceTokens(text).map((token) => token.value);
    if (needle.length < (options.minimumTokens ?? 1)) return [];
    return this.evidence(this.indexed.filter((page) => !page.injected && containsTokenSequence(page.tokens, needle)));
  }

  /** Pages (never injected spam) that display this US phone number. */
  phone(value: string): FirstPartyPageEvidence[] {
    const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits.length !== 10) return [];
    const pattern = new RegExp(`(?:^|\\D)1?\\s*${digits.slice(0, 3)}\\s*${digits.slice(3, 6)}\\s*${digits.slice(6)}(?:\\D|$)`);
    return this.evidence(this.indexed.filter((page) => !page.injected
      && (pattern.test(page.digits) || page.links.has(`tel:+1${digits}`))));
  }

  /** Pages (never injected spam) that display or link this email address. */
  email(value: string): FirstPartyPageEvidence[] {
    const normalized = value.trim().toLowerCase();
    return this.evidence(this.indexed.filter((page) => !page.injected
      && (page.emails.has(normalized) || page.links.has(`mailto:${normalized}`))));
  }

  /** Pages (never injected spam) that link this exact destination. */
  link(href: string): FirstPartyPageEvidence[] {
    const normalized = normalizedFirstPartyHref(href);
    if (!normalized) return [];
    return this.evidence(this.indexed.filter((page) => !page.injected && page.links.has(normalized)));
  }

  /** Every outbound http(s) destination shown on a non-spam first-party page. */
  outboundLinks(): string[] {
    return [...new Set(this.indexed.filter((page) => !page.injected)
      .flatMap((page) => [...page.links].filter((href) => /^https?:\/\//.test(href))))];
  }

  /** Registrable domains of other websites the business links to (partners, suppliers, platforms). */
  linkedOtherSiteDomains(ownHost: string): Set<string> {
    const own = registrableDomain(ownHost.toLowerCase().replace(/^www\./, ""));
    return new Set(this.outboundLinks().flatMap((href) => {
      try {
        const domain = registrableDomain(new URL(href).hostname.toLowerCase().replace(/^www\./, ""));
        return domain === own ? [] : [domain];
      } catch {
        return [];
      }
    }));
  }

  private evidence(pages: IndexedPage[]): FirstPartyPageEvidence[] {
    return pages.map(({ tokens: _tokens, digits: _digits, emails: _emails, links: _links, imageHosts: _hosts, ...page }) => page);
  }
}

/** True when any supporting page is a current core page (home, contact, about, service). */
export function supportedOnCurrentCorePage(evidence: readonly FirstPartyPageEvidence[]) {
  return evidence.some((page) => page.core && !page.injected);
}

/**
 * Prominence of a first-party statement: the homepage, contact page, or
 * site-wide chrome (the header shown on most core pages) outranks another
 * core page body, which outranks blog, archive, legal, or utility pages.
 */
export function firstPartyProminence(evidence: readonly FirstPartyPageEvidence[], corePageCount: number) {
  const core = evidence.filter((page) => page.core && !page.injected);
  const siteWide = corePageCount >= 3 && core.length >= Math.ceil(corePageCount / 2);
  if (siteWide || core.some((page) => page.role === "home" || page.role === "contact")) return 3;
  if (core.length) return 2;
  return evidence.some((page) => !page.injected) ? 1 : 0;
}

export type FirstPartyValueCandidate<T> = {
  value: T;
  evidence: readonly FirstPartyPageEvidence[];
};

/**
 * Reconciles conflicting verbatim first-party values for one contact field.
 * The most prominent value wins, then the most recently modified page, then
 * the value shown on more pages. A tie at the top (equally prominent, equally
 * recent, equally repeated) has no winner: the field is withheld and every
 * value is returned as a conflict for owner review.
 */
export function reconcileFirstPartyValues<T>(input: {
  candidates: readonly FirstPartyValueCandidate<T>[];
  same: (left: T, right: T) => boolean;
  corePageCount: number;
}): { winner?: FirstPartyValueCandidate<T>; conflicts: FirstPartyValueCandidate<T>[] } {
  const merged: Array<{ value: T; evidence: FirstPartyPageEvidence[] }> = [];
  for (const candidate of input.candidates) {
    if (!candidate.evidence.some((page) => !page.injected)) continue;
    const existing = merged.find((entry) => input.same(entry.value, candidate.value));
    if (existing) {
      const urls = new Set(existing.evidence.map((page) => page.url));
      existing.evidence.push(...candidate.evidence.filter((page) => !urls.has(page.url)));
    } else {
      merged.push({ value: candidate.value, evidence: [...candidate.evidence] });
    }
  }
  if (merged.length <= 1) return { ...(merged[0] ? { winner: merged[0] } : {}), conflicts: [] };
  const score = (candidate: FirstPartyValueCandidate<T>) => [
    firstPartyProminence(candidate.evidence, input.corePageCount),
    Math.max(0, ...candidate.evidence.map((page) => Date.parse(page.lastModified ?? "") || 0)),
    candidate.evidence.filter((page) => !page.injected).length
  ];
  const ranked = merged.map((candidate) => ({ candidate, score: score(candidate) }))
    .sort((left, right) => compareScores(right.score, left.score));
  if (compareScores(ranked[0]!.score, ranked[1]!.score) === 0) {
    return { conflicts: ranked.map((entry) => entry.candidate) };
  }
  return { winner: ranked[0]!.candidate, conflicts: ranked.slice(1).map((entry) => entry.candidate) };
}

function compareScores(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

const monthName = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const promotionalPattern = /\b(?:limited[- ]time|for a limited|promotion(?:al)?|promo(?:tion)? code|special offer|this (?:month|week|season)(?:'s|’s)? (?:special|offer|deal)|while supplies last|offer (?:ends|expires|valid)|expires?|expiration|valid (?:through|thru|until)|good (?:through|thru|until)|now through|sale ends|coupon)\b/i;
const datedPattern = new RegExp(
  `\\b${monthName}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\b${monthName}\\.?\\s+(?:19|20)\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}/(?:19|20)?\\d{2}\\b`,
  "i"
);

/**
 * Text that is dated (a calendar date, or a year that is not a founding or
 * experience year) or promotional ("limited time", "expires", "promo").
 * Such statements may have lapsed, so they are not current standing claims.
 */
export function isDatedOrPromotionalText(text: string) {
  if (promotionalPattern.test(text) || datedPattern.test(text)) return true;
  return [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].some((match) => {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    return !/\b(?:since|established|est\.?|founded|serving [a-z ]+ since|in business since|opened in|started in)\s*$/i.test(before);
  });
}

const trackingParameterPattern = /^(?:utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|ref|ref_id|refid|affid|aff_id|affiliate|aff|clickid|tag|irclickid|subid|partner_id)$/i;
const affiliateHostPattern = /(?:^|\.)(?:amzn\.to|bit\.ly|tinyurl\.com|t\.co|ow\.ly|goo\.gl|shareasale\.com|awin1\.com|linksynergy\.com|anrdoezrs\.net|dpbolvw\.net|jdoqocy\.com|tkqlhce\.com|kqzyfj\.com|clickbank\.net|impact\.com|pxf\.io|sjv\.io|go2cloud\.org|rstyle\.me|skimlinks\.com|viglink\.com)$/i;

/** An affiliate, shortener, or click-tracking link: never a verified destination. */
export function isAffiliateOrTrackingLink(href: string) {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return true;
  }
  if (affiliateHostPattern.test(url.hostname)) return true;
  if ([...url.searchParams.keys()].some((key) => trackingParameterPattern.test(key))) return true;
  return /\/(?:aff|affiliate|go|out|click|track|redirect)\/?/i.test(url.pathname) && url.search.length > 0;
}

const stockOrMarketplaceHostPattern = /(?:^|\.)(?:shutterstock|istockphoto|gettyimages|stock\.adobe|adobestock|depositphotos|dreamstime|123rf|bigstockphoto|alamy|unsplash|pexels|pixabay|freepik|canva|envato|vecteezy|stocksy|pond5)\.(?:com|net|io)$/i;
const reviewOrWidgetPlatformHostPattern = /(?:^|\.)(?:yelp(?:cdn)?\.com|houzz\.com|hzcdn\.com|angi\.com|angieslist\.com|homeadvisor\.com|thumbtack\.com|nextdoor\.com|bbb\.org|trustpilot\.com|elfsight\.com|trustindex\.io|birdeye\.com|podium\.com)$/i;

/** Known stock-photo and photo-marketplace hosts. */
export function isStockOrMarketplaceImageHost(host: string) {
  return stockOrMarketplaceHostPattern.test(host.toLowerCase());
}

/**
 * An image is the business's own when a retained first-party page loads it
 * from the business's domain or from any media host that is not a stock or
 * photo marketplace, a review/widget platform, or another website the
 * business links to (a partner's or manufacturer's own domain).
 */
export function firstPartyImageHost(input: {
  imageUrl: string;
  pageUrl: string;
  linkedOtherSiteDomains?: ReadonlySet<string>;
}) {
  let image: URL;
  let page: URL;
  try {
    image = new URL(input.imageUrl);
    page = new URL(input.pageUrl);
  } catch {
    return false;
  }
  const imageHost = image.hostname.toLowerCase().replace(/^www\./, "");
  const pageHost = page.hostname.toLowerCase().replace(/^www\./, "");
  if (imageHost === pageHost || registrableDomain(imageHost) === registrableDomain(pageHost)) return true;
  if (isStockOrMarketplaceImageHost(imageHost) || reviewOrWidgetPlatformHostPattern.test(imageHost)) return false;
  if (input.linkedOtherSiteDomains?.has(registrableDomain(imageHost))) return false;
  return true;
}

export function registrableDomain(host: string) {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const depth = labels.at(-1)!.length === 2 && /^(?:co|com|net|org|gov|ac|edu)$/.test(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-depth).join(".");
}

export type SensitiveFirstPartyTopic = "price" | "offer" | "guarantee" | "credential" | "rating" | "availability" | "cadence" | "safety";

const topicPatterns: Array<[SensitiveFirstPartyTopic, RegExp]> = [
  ["price", /(?:\$\s?\d|\b\d+\s?(?:dollars|usd)\b|\bprice match|\bmatch (?:the|any) price|\bstarting at\b|\bper (?:hour|visit|month|sq(?:uare)?\.? ?f(?:oo)?t)\b|\bfinancing\b)/i],
  ["offer", /\b(?:discounts?|coupons?|specials?|promo(?:tion)?s?|loyalty program|% off|save \d+%|limited[- ]time offer|free (?:estimates?|inspections?|quotes?|consultations?)|at no (?:additional|extra) cost|free of charge|free re[- ]?(?:treat|service))\b/i],
  ["guarantee", /\b(?:guarantee(?:d|s)?|warrant(?:y|ies|ied))\b/i],
  ["rating", /\b(?:\d(?:\.\d)?\s*(?:stars?|out of 5)|five[- ]star|5[- ]star|a\+ rating|bbb|ratings?)\b/i],
  ["credential", /\b(?:licen[cs]ed|licensure|insured|bonded|certified|certification|accredited|award(?:ed|s)?|years? of experience|master (?:electrician|plumber))\b/i],
  ["availability", /\b(?:24\s*\/\s*7|24 hours|same[- ]day|next[- ]day|emergency|respond within|by appointment|business hours|open (?:daily|weekends|7 days)|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:s)?\s+(?:through|thru|to|-|–))\b/i],
  ["cadence", /\b(?:every \d+\s*(?:-|–|to)\s*\d+\s*(?:days?|weeks?|months?|years?)|every (?:\d+|one|two|three|other) (?:months?|weeks?)|every month|quarterly|bi[- ]?monthly|recurring visits?)\b/i],
  ["safety", /\b(?:safe(?:ty|r|st)?|eco[- ]?friendly|environmentally friendly|non[- ]?toxic|pet[- ]?safe|child[- ]?safe|organic|gentle on (?:your )?home|kind to the earth)\b/i]
];

/**
 * Sensitive topics a first-party passage touches. First-party content on these
 * topics is shown to the author tagged with its topic and source page, never
 * withheld; the tag tells the author to quote it verbatim rather than restate
 * it as a new claim in its own voice.
 */
export function sensitiveFirstPartyTopics(text: string): SensitiveFirstPartyTopic[] {
  return topicPatterns.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

function normalizedFirstPartyHref(href: string) {
  const value = href.trim();
  if (/^tel:/i.test(value)) {
    const digits = value.slice(4).split(/[?;]/, 1)[0]!.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    return digits.length === 10 ? `tel:+1${digits}` : undefined;
  }
  if (/^mailto:/i.test(value)) {
    const address = value.slice(7).split("?", 1)[0]!.trim().toLowerCase();
    return address.includes("@") ? `mailto:${address}` : undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The canonical comparable form of an outbound href for first-party matching. */
export function comparableFirstPartyHref(href: string) {
  return normalizedFirstPartyHref(href);
}

/**
 * Support pages from retained source snapshot pages. Only fetched pages on a
 * website source's own host count; `sourceHosts` maps a snapshot id to that
 * host (omit to accept every fetched page, e.g. when the caller already
 * filtered to first-party pages).
 */
export function firstPartySupportFromSnapshotPages(
  pages: readonly {
    sourceSnapshotId: string;
    requestedUrl: string;
    finalUrl?: string;
    path: string;
    title?: string;
    outcome: string;
    extractedText: string;
    externalLinks?: readonly string[];
    sitemap?: { lastModified?: string };
  }[],
  options: { sourceHosts?: ReadonlyMap<string, string>; imageUrlsByPageUrl?: ReadonlyMap<string, readonly string[]> } = {}
) {
  return new FirstPartySupport(pages.flatMap((page) => {
    if (page.outcome !== "fetched") return [];
    const url = page.finalUrl ?? page.requestedUrl;
    if (options.sourceHosts) {
      const host = options.sourceHosts.get(page.sourceSnapshotId);
      if (!host || safeHost(url) !== host) return [];
    }
    return [{
      url,
      path: page.path,
      title: page.title,
      text: page.extractedText,
      links: page.externalLinks ?? [],
      imageUrls: options.imageUrlsByPageUrl?.get(url) ?? options.imageUrlsByPageUrl?.get(page.requestedUrl) ?? [],
      ...(page.sitemap?.lastModified ? { lastModified: page.sitemap.lastModified } : {})
    }];
  }));
}

/** Support pages from a generation crawl's first-party page summaries. */
export function firstPartySupportFromCrawlPages(
  pages: readonly {
    url: string;
    title?: string;
    purposeTags: readonly string[];
    sourceTextBlocks: readonly { displayText: string }[];
    linkReferences: readonly { href: string }[];
    assetReferences?: readonly { url?: string; href?: string; kind?: string }[];
  }[],
  lastModifiedByUrl?: ReadonlyMap<string, string>
) {
  return new FirstPartySupport(pages.map((page) => ({
    url: page.url,
    title: page.title,
    purposeTags: page.purposeTags,
    text: page.sourceTextBlocks.map((block) => block.displayText).join("\n"),
    links: page.linkReferences.map((reference) => reference.href),
    ...(lastModifiedByUrl?.get(page.url) ? { lastModified: lastModifiedByUrl.get(page.url) } : {})
  })));
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function safePath(url: string) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

function containsTokenSequence(haystack: string[], needle: string[]) {
  if (!needle.length || needle.length > haystack.length) return false;
  outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}
