import { createHash } from "node:crypto";

export const websiteHealthRequestedRouteSlots = [
  "home",
  "primary_service",
  "secondary_same_family",
  "conversion_or_faq"
] as const;

export type WebsiteHealthRouteSlot = (typeof websiteHealthRequestedRouteSlots)[number];

export type WebsiteHealthRouteCandidate = {
  route: string;
  sourceUrl?: string;
  purposeTags: string[];
  contentLength?: number;
  priority?: number;
};

export type WebsiteHealthRouteSemanticsInput = {
  route: string;
  title?: string;
  description?: string;
};

export type ArtifactVisualRouteInput = {
  path: string;
  title: string;
  description: string;
};

export type ArtifactVisualPageRequirement = {
  slug?: string | null;
  purpose: string;
};

export type WebsiteHealthRouteSelection = {
  identity: `route-selection@sha256:${string}`;
  requestedSlots: [...typeof websiteHealthRequestedRouteSlots];
  selected: Array<{
    slot: WebsiteHealthRouteSlot;
    route?: string;
    sourceUrl?: string;
    purpose?: string;
  }>;
};

export const websiteHealthRouteSelectionPolicy = {
  version: 4,
  requestedSlots: websiteHealthRequestedRouteSlots,
  maximumRoutes: 4,
  selection: {
    home: "canonical homepage or primary crawl entry",
    primaryService: "highest-priority service-intent route; specificity, declared priority, and substantive content break ties",
    secondarySameFamily: "a second route from the primary material family when one exists",
    conversionOrFaq: "contact/location, otherwise FAQ, otherwise about, otherwise the strongest remaining route",
    missingSlot: "retain the requested slot without a resolved route"
  },
  semanticPurposeTags: {
    home: ["home"],
    service: ["service_detail", "service", "services"],
    contact: ["contact", "location"],
    about: ["about"]
  },
  missingPurposeFallback: {
    source: "finalized route path, title, and description",
    scope: "broad home, service, contact/location, and about semantics only",
    precedence: "explicit retained purpose tags remain authoritative"
  },
  viewportPolicy: {
    desktop: { width: 1280, height: 900 },
    mobile: { width: 390, height: 844 }
  },
  framePolicy: {
    positions: ["top", "middle", "bottom"],
    interactiveStates: ["navigation"],
    overview: "low-resolution rhythm-only evidence",
    malformedViewportRejection: "reject images whose pixel dimensions do not match the declared native viewport frame"
  }
} as const;

export const websiteHealthRouteSelectionIdentity = contentIdentity(
  "route-selection",
  websiteHealthRouteSelectionPolicy
) as `route-selection@sha256:${string}`;

/**
 * Infer only the broad semantics required to select representative visual
 * evidence. Explicit retained purpose tags remain authoritative. This
 * fallback intentionally avoids content-quality or vertical-specific rules.
 */
export function inferWebsiteHealthPurposeTags(
  input: WebsiteHealthRouteSemanticsInput
): string[] {
  const route = normalizeRoute(input.route);
  if (route === "/") return ["home"];

  const routeWords = normalizedWords(route);
  const titleWords = normalizedWords(input.title ?? "");
  const descriptionWords = normalizedWords(input.description ?? "");
  const routeSegments = route.slice(1).split("/").filter(Boolean);
  const lastSegment = routeSegments.at(-1) ?? "";

  if (matchesSegment(lastSegment, [
    "contact", "contact-us", "get-in-touch", "request-a-quote", "get-a-quote", "quote",
    "request-estimate", "request-an-estimate", "get-estimate", "get-an-estimate", "estimate",
    "request-service", "service-request"
  ]) || matchesPhrase(titleWords, [
    "contact", "contact us", "get in touch", "request a quote", "request estimate",
    "request an estimate", "get an estimate", "request service"
  ])) {
    return ["contact"];
  }
  if (matchesSegment(lastSegment, [
    "location", "locations", "service-area", "service-areas", "areas-served", "service-locations"
  ]) || matchesPhrase(titleWords, ["locations", "service areas", "areas served"])) {
    return ["location"];
  }
  if (matchesSegment(lastSegment, ["about", "about-us", "our-story", "our-company", "company", "team"])
    || matchesPhrase(titleWords, ["about", "about us", "our story", "our company", "meet the team"])) {
    return ["about"];
  }

  if (routeSegments.some((segment) => matchesSegment(segment, ["faq", "faqs", "frequently-asked-questions"]))) {
    return ["faq"];
  }

  if (routeSegments.some((segment) => matchesSegment(segment, [
    "blog", "blogs", "guide", "guides", "resources", "privacy", "terms", "accessibility"
  ]))) {
    return [];
  }

  if (matchesSegment(lastSegment, ["service", "services", "pest-control", "commercial-pest-control"])
    || /(?:^|-)(?:control|treatment|removal|repair|installation|replacement|management|extermination)$/.test(lastSegment)
    || routeSegments.some((segment) => segment === "services" || segment === "service")) {
    return lastSegment === "service" || lastSegment === "services" ? ["services"] : ["service_detail"];
  }

  // Metadata is a deliberately weak final fallback. Require service language
  // in both the title and description so a business name such as "Kind Pest
  // Control" does not classify every route as a service page.
  const serviceTerms = ["service", "services", "treatment", "removal", "repair", "installation"];
  if (serviceTerms.some((term) => titleWords.includes(term))
    && serviceTerms.some((term) => descriptionWords.includes(term))) {
    return ["service"];
  }
  return [];
}

export function selectWebsiteHealthRoutes(
  candidates: WebsiteHealthRouteCandidate[]
): WebsiteHealthRouteSelection {
  const normalized = uniqueCandidates(candidates);
  const home = normalized.find((candidate) => candidate.route === "/")
    ?? normalized.find((candidate) => candidate.purposeTags.includes("home"))
    ?? normalized[0];
  const services = normalized
    .filter((candidate) => candidate !== home && hasPurpose(candidate, ["service_detail", "service", "services"]))
    .sort((left, right) => routeRank(right) - routeRank(left));
  const contact = normalized.find((candidate) =>
    candidate !== home && hasPurpose(candidate, ["contact"])
  ) ?? normalized.find((candidate) =>
    candidate !== home && hasPurpose(candidate, ["location"])
  );
  const about = normalized.find((candidate) =>
    candidate !== home && candidate !== contact && hasPurpose(candidate, ["about"])
  );
  const faq = normalized.find((candidate) =>
    candidate !== home && candidate !== contact && candidate !== about && hasPurpose(candidate, ["faq"])
  );
  const primary = services[0];
  const secondary = services.find((candidate) => candidate !== primary);
  const used = new Set([home, primary, secondary].filter(Boolean));
  const remaining = normalized
    .filter((candidate) => !used.has(candidate))
    .sort((left, right) => routeRank(right) - routeRank(left));
  const selections = [
    selection("home", home, "home"),
    selection("primary_service", primary, "primary service intent"),
    selection(
      "secondary_same_family",
      secondary,
      secondary ? "second route from the primary material family" : undefined
    ),
    selection(
      "conversion_or_faq",
      (!used.has(contact) ? contact : undefined)
        ?? (!used.has(faq) ? faq : undefined)
        ?? (!used.has(about) ? about : undefined)
        ?? remaining[0],
      contact && !used.has(contact)
        ? "contact or location"
        : faq && !used.has(faq)
          ? "frequently asked questions"
          : about && !used.has(about)
            ? "about"
            : remaining[0]
              ? "strongest remaining customer route"
              : undefined
    )
  ] satisfies WebsiteHealthRouteSelection["selected"];

  return {
    identity: websiteHealthRouteSelectionIdentity,
    requestedSlots: [...websiteHealthRequestedRouteSlots],
    selected: selections
  };
}

/**
 * Canonical representative-route selection for retained site artifacts.
 * Authoring verification and later visual evaluation must use this same
 * selection so labels cannot drift from the routes rendered into the sheets.
 */
export function selectArtifactVisualRoutes(
  routes: ArtifactVisualRouteInput[],
  pageRequirements: ArtifactVisualPageRequirement[]
) {
  const requirementByRoute = new Map(pageRequirements.map((requirement, index) => [
    requirement.slug ? `/${requirement.slug}` : "/",
    { requirement, index }
  ]));
  return selectWebsiteHealthRoutes(routes.map((route, routeIndex) => {
    const matched = requirementByRoute.get(route.path);
    return {
      route: route.path,
      purposeTags: matched
        ? [matched.requirement.purpose]
        : inferWebsiteHealthPurposeTags({
          route: route.path,
          title: route.title,
          description: route.description
        }),
      contentLength: route.description.length,
      priority: matched
        ? pageRequirements.length - matched.index
        : routes.length - routeIndex
    };
  }));
}

/** Deterministic four-route evidence set used by the advisory visual/IA review. */
export function selectArtifactReviewRoutePaths(
  routes: ArtifactVisualRouteInput[],
  pageRequirements: ArtifactVisualPageRequirement[]
) {
  return selectArtifactVisualRoutes(routes, pageRequirements).selected
    .flatMap((item) => item.route ? [item.route] : []);
}

function selection(
  slot: WebsiteHealthRouteSlot,
  candidate: WebsiteHealthRouteCandidate | undefined,
  purpose: string | undefined
) {
  return {
    slot,
    ...(candidate ? {
      route: normalizeRoute(candidate.route),
      sourceUrl: candidate.sourceUrl,
      purpose
    } : {})
  };
}

function routeRank(candidate: WebsiteHealthRouteCandidate) {
  const specificity = candidate.purposeTags.includes("service_detail") ? 100_000 : 0;
  return (candidate.priority ?? 0) * 1_000_000
    + specificity
    + Math.min(candidate.contentLength ?? 0, 9_999);
}

function hasPurpose(candidate: WebsiteHealthRouteCandidate, purposes: string[]) {
  return purposes.some((purpose) => candidate.purposeTags.includes(purpose));
}

function uniqueCandidates(candidates: WebsiteHealthRouteCandidate[]) {
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const route = normalizeRoute(candidate.route);
    if (seen.has(route)) return [];
    seen.add(route);
    return [{ ...candidate, route }];
  });
}

function normalizeRoute(value: string) {
  const pathname = value.startsWith("http://") || value.startsWith("https://")
    ? new URL(value).pathname
    : value;
  const normalized = `/${pathname}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSegment(value: string, candidates: string[]) {
  return candidates.includes(value.toLowerCase());
}

function matchesPhrase(value: string, phrases: string[]) {
  return phrases.some((phrase) => new RegExp(`(?:^|\\s)${phrase.replaceAll(" ", "\\s+")}(?:$|\\s)`, "i").test(value));
}

function contentIdentity(name: string, value: unknown) {
  return `${name}@sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
