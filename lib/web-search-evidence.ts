import type { FactCandidate } from "./business-evidence";

/**
 * Web search evidence pass (Phase 1/source posture). Allowlisted source
 * CLASSES, not open SERP scraping; each fetched page must match a class
 * before any candidate is written. Off by default until a search provider is
 * configured (LODESTA_WEB_SEARCH_MODE=provider + key) — the allowlist and the
 * candidate contract are the stable part, the fetcher is pluggable.
 *
 * Excluded until per-source ToS decisions: Yelp, Facebook, Google results
 * pages.
 */

export type AllowedSourceClass = "first_party_website" | "owner_controlled_profile" | "government_registry" | "linkable_public_source";

const excludedHostPatterns = [/(^|\.)yelp\.com$/i, /(^|\.)facebook\.com$/i, /(^|\.)google\.[a-z.]+$/i, /(^|\.)instagram\.com$/i];

const governmentHostPattern = /\.(gov|us)$/i;

export function classifySearchSource(url: string, businessWebsiteHost?: string): AllowedSourceClass | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (excludedHostPatterns.some((pattern) => pattern.test(host))) return undefined;
  if (businessWebsiteHost && (host === businessWebsiteHost.toLowerCase() || host.endsWith(`.${businessWebsiteHost.toLowerCase()}`))) {
    return "first_party_website";
  }
  if (governmentHostPattern.test(host)) return "government_registry";
  // Owner-controlled profiles require an explicit per-platform ToS decision;
  // none are approved yet, so everything else is a generic linkable source.
  return "linkable_public_source";
}

export function webSearchEvidenceEnabled(): boolean {
  return (process.env.LODESTA_WEB_SEARCH_MODE ?? "off") !== "off";
}

/**
 * Candidate contract for search-derived facts: minimal excerpt + URL, same
 * storage rules as crawl. The provider integration fills `runWebSearchPass`
 * when LODESTA_WEB_SEARCH_MODE is configured; the contract and tests exist
 * now so the integration is a fetcher, not a redesign.
 */
export function searchCandidate(input: {
  businessId: string;
  fieldKey: string;
  value: unknown;
  excerpt: string;
  url: string;
  sourceClass: AllowedSourceClass;
  now?: string;
}): FactCandidate {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `factcand_${input.businessId}_${input.fieldKey}_websearch_${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    businessId: input.businessId,
    sourceType: "web_search",
    fieldKey: input.fieldKey,
    proposedValue: input.value,
    confidence: input.sourceClass === "first_party_website" ? 0.8 : input.sourceClass === "government_registry" ? 0.75 : 0.55,
    status: "discovered",
    evidenceLabel:
      input.sourceClass === "first_party_website"
        ? "Found on your website"
        : input.sourceClass === "government_registry"
          ? "Found in a public registry"
          : "Found on a public page",
    evidenceUrl: input.url,
    observedAt: now,
    createdAt: now
  };
}
