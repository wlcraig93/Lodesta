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
    || /^\/(?:privacy-policy|terms-of-service|terms-conditions|test|llms-txt)$/.test(path)
    || /^\/(?:wp-admin|wp-json)(?:\/|$)/.test(path)) {
    return "technical_or_utility";
  }
  return "customer_content";
}

export function isSourceCustomerContentPath(value: string) {
  return classifySourcePagePath(value) === "customer_content";
}
