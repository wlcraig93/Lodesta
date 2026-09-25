const mechanicalArchivePrefixes = [
  "author",
  "category",
  "tag",
  "service_category",
  "portfolio_category"
];

const siteBuilderPrefixes = [
  "header",
  "footer",
  "trimprimblocks"
];

export type SourcePageRole = "customer_content" | "mechanical_archive" | "technical_or_utility";

export function isLegalSourcePagePath(value: string) {
  const path = normalizedSourcePagePath(value).toLocaleLowerCase();
  const segments = path.split("/").filter(Boolean);
  return segments.some((segment) =>
    /^(?:privacy(?:-policy)?|terms(?:-of-(?:service|use))?|terms-(?:and-)?conditions|legal|cookie(?:-policy)?|accessibility(?:-statement)?|disclaimer|cancellation-policy|refund-policy|return-policy|returns-policy)$/.test(segment)
    || /-(?:privacy-policy|terms-and-conditions|terms-of-service|terms-of-use|cookie-policy|accessibility-statement|disclaimer|cancellation-policy|refund-policy|return-policy|returns-policy)$/.test(segment));
}

/**
 * A path that is a broken-markup link artifact rather than a page the site
 * publishes, e.g. `/privacy-policy/%22tel:9256597405%22%3E925-659-7405%3C/a%3E%22`
 * produced by an unquoted href. Quotes, angle brackets, or an embedded URI
 * scheme never occur in a real local-business page path.
 */
export function isMalformedSourceLinkPath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] ?? "";
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return /["'<>`\\]/.test(decoded)
    || /(?:^|\/)[^/]*(?:tel|mailto|sms|javascript|data|https?|callto|whatsapp):/i.test(decoded);
}

const injectedSpamTopicPattern = /\b(?:casinos?|1win|1xbet|mostbet|pin-?up|betting|sportsbook|bookmakers?|slot-?machines?|jackpots?|roulette|blackjack|poker|viagra|cialis|payday[- ]loans?|escorts?|crypto(?:currency)?|forex)\b/i;

/**
 * Hacked CMS installs inject off-topic posts (casino, pharma, loans) into a
 * local business blog. A page whose path or title names such a topic that the
 * homepage never mentions is not the business's own content.
 */
export function isLikelyInjectedSpamSourcePage(
  page: { path: string; title?: string | null },
  homepageText: string
) {
  const signal = `${page.path.replace(/[-_/]+/g, " ")} ${page.title ?? ""}`;
  const topic = signal.match(injectedSpamTopicPattern)?.[0];
  if (!topic || normalizedSourcePagePath(page.path) === "/") return false;
  return !new RegExp(`\\b${topic.replace(/[^a-z0-9]/gi, ".?")}\\b`, "i").test(homepageText);
}

/** Drops injected spam pages from any first-party page set, judged against its homepage. */
export function withoutInjectedSpamSourcePages<Page extends { path: string; title?: string | null; extractedText: string }>(pages: readonly Page[]) {
  const homepageText = pages
    .filter((page) => normalizedSourcePagePath(page.path) === "/")
    .map((page) => `${page.title ?? ""}\n${page.extractedText}`)
    .join("\n");
  return pages.filter((page) => !isLikelyInjectedSpamSourcePage(page, homepageText));
}

export function normalizedSourcePagePath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * Separates deterministic CMS plumbing from customer-authored content. This is
 * intentionally conservative: ambiguous pages remain customer content and are
 * available to the author. The classification only removes known archive and
 * site-builder surfaces from fact aggregation and content-estate counts.
 */
export function classifySourcePagePath(value: string): SourcePageRole {
  const path = normalizedSourcePagePath(value).toLocaleLowerCase();
  const firstSegment = path.split("/").filter(Boolean)[0] ?? "";
  if (mechanicalArchivePrefixes.includes(firstSegment)
    || /\/page\/\d+(?:\/|$)/.test(path)
    || /\/feed$/.test(path)) {
    return "mechanical_archive";
  }
  if (siteBuilderPrefixes.includes(firstSegment)
    || isLegalSourcePagePath(path)
    || /^\/(?:test|llms-txt)$/.test(path)
    || /^\/(?:wp-admin|wp-json)(?:\/|$)/.test(path)) {
    return "technical_or_utility";
  }
  return "customer_content";
}

export function isSourceCustomerContentPath(value: string) {
  return classifySourcePagePath(value) === "customer_content";
}

const cmsSystemOptionPattern = /^(?:com_users|com_config|com_ajax|com_search|com_finder)$/i;
const cmsPresentationOptionPattern = /^(?:com_jdbuilder|com_sppagebuilder)$/i;
const templatePlaceholderPattern = /\b(?:lorem ipsum|contrary to popular belief,? lorem ipsum|astroid framework|joomdev|mega menu builder|off canvas menu|bootstrap [345]|font awesome [456])\b/i;
const genericTemplateTitlePattern = /^(?:blank|blog types?|business|coming soon|design|gallery|horizontal style \d+|left sidebar|lifestyle|mega menu|off canvas|one page|pages?|quote|regular|review|right sidebar|sidebar style \d+|stacked style \d+|technology|typography|video|without sidebar|with sidebar)$/i;

/**
 * Identifies CMS administration, presentation-demo, and placeholder pages that
 * are technically first-party URLs but are not business authority. The
 * supplied page always remains eligible; only discovered pages can be
 * downgraded. Ambiguous content is retained.
 */
export function isLikelyCmsTemplateOrSystemSourcePage(input: {
  url: string;
  sourceUrl: string;
  title?: string;
  text?: string;
}) {
  let candidate: URL;
  let source: URL;
  try {
    candidate = new URL(input.url);
    source = new URL(input.sourceUrl);
  } catch {
    return false;
  }
  if (sameSourceLocation(candidate, source)) return false;
  const option = candidate.searchParams.get("option") ?? "";
  const path = candidate.pathname.toLocaleLowerCase();
  if (cmsSystemOptionPattern.test(option)
    || /(?:^|\/)administrator(?:\/|$)/.test(path)
    || /(?:^|\/)(?:wp-login\.php|user\/login|account\/login)(?:\/|$)/.test(path)) {
    return true;
  }
  const title = input.title?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";
  const text = input.text?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";
  // A leftover placeholder component does not identify the whole page as a
  // template. Require page-identity evidence; ambiguous customer pages remain
  // available, while content-level proof filters still reject placeholder copy.
  if (templatePlaceholderPattern.test(title)) return true;
  if (genericTemplateTitlePattern.test(title)
    && (templatePlaceholderPattern.test(text)
      || /^com_content$/i.test(option) || cmsPresentationOptionPattern.test(option) || path === "/index.php")) {
    return true;
  }
  return false;
}

function sameSourceLocation(left: URL, right: URL) {
  const normalizeHost = (value: string) => value.toLocaleLowerCase().replace(/^www\./, "");
  const normalizePath = (value: string) => value.replace(/\/+$/, "") || "/";
  return normalizeHost(left.hostname) === normalizeHost(right.hostname)
    && normalizePath(left.pathname) === normalizePath(right.pathname)
    && normalizedSearch(left) === normalizedSearch(right);
}

function normalizedSearch(value: URL) {
  return [...value.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, entry]) => `${key}=${entry}`)
    .join("&");
}
