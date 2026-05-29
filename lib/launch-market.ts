import type { CrawlAssessment, ExtractedBusinessFacts } from "./crawler";
import type { PublicPresenceEnrichment } from "./public-presence";

export class LaunchMarketError extends Error {
  code = "unsupported_launch_market" as const;

  constructor(message: string) {
    super(message);
    this.name = "LaunchMarketError";
  }
}

type LaunchMarketInput = {
  url?: string;
  prompt?: string;
  crawl?: CrawlAssessment;
  publicPresence?: PublicPresenceEnrichment;
  facts?: Partial<ExtractedBusinessFacts>;
};

const allowedUsCountries = new Set(["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"]);
const unsupportedCountryTlds = new Set([
  "ar",
  "au",
  "be",
  "br",
  "ca",
  "ch",
  "cl",
  "cn",
  "co",
  "de",
  "dk",
  "es",
  "fi",
  "fr",
  "ie",
  "in",
  "it",
  "jp",
  "kr",
  "mx",
  "nl",
  "no",
  "nz",
  "pl",
  "pt",
  "se",
  "sg",
  "uk",
  "za"
]);

const unsupportedMarketTerms = [
  "argentina",
  "australia",
  "belgium",
  "brazil",
  "canada",
  "chile",
  "china",
  "colombia",
  "denmark",
  "england",
  "finland",
  "france",
  "germany",
  "india",
  "ireland",
  "italy",
  "japan",
  "mexico",
  "netherlands",
  "new zealand",
  "norway",
  "portugal",
  "scotland",
  "singapore",
  "south africa",
  "spain",
  "sweden",
  "switzerland",
  "united kingdom",
  "wales"
];

export function assertLaunchMarket(input: LaunchMarketInput) {
  const result = validateLaunchMarket(input);
  if (!result.ok) throw new LaunchMarketError(result.reason);
}

export function validateLaunchMarket(input: LaunchMarketInput): { ok: true } | { ok: false; reason: string } {
  const hostname = input.url ? safeHostname(input.url) : "";
  const tld = hostname.split(".").at(-1) ?? "";
  if (unsupportedCountryTlds.has(tld)) {
    return {
      ok: false,
      reason: `Lodesta launch intake is US-only; ${hostname} appears to use a non-US country-code domain.`
    };
  }

  const promptMarketTerm = input.prompt ? unsupportedMarketTerms.find((term) => containsTerm(input.prompt!, term)) : undefined;
  if (promptMarketTerm) {
    return {
      ok: false,
      reason: `Lodesta launch intake is US-only; the prompt mentions ${promptMarketTerm}.`
    };
  }

  const countries = [
    input.facts?.address?.country,
    input.crawl?.extractedFacts.address?.country,
    input.publicPresence?.facts.address?.country
  ].filter((country): country is string => Boolean(country));

  const unsupportedCountry = countries.find((country) => !isUsCountry(country));
  if (unsupportedCountry) {
    return {
      ok: false,
      reason: `Lodesta launch intake is US-only; extracted business country was ${unsupportedCountry}.`
    };
  }

  return { ok: true };
}

export function isLaunchMarketError(error: unknown): error is LaunchMarketError {
  return error instanceof LaunchMarketError || (error instanceof Error && error.name === "LaunchMarketError");
}

function isUsCountry(country: string) {
  return allowedUsCountries.has(country.trim().toLowerCase());
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function containsTerm(text: string, term: string) {
  return new RegExp(`(^|[^a-z])${escapeRegExp(term)}([^a-z]|$)`, "i").test(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
