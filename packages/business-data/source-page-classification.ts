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
  if (templatePlaceholderPattern.test(`${title} ${text}`)) return true;
  if (genericTemplateTitlePattern.test(title)
    && (/^com_content$/i.test(option) || cmsPresentationOptionPattern.test(option) || path === "/index.php")) {
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
