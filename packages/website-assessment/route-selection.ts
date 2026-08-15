import { createHash } from "node:crypto";

export const websiteHealthRequestedRouteSlots = [
  "home",
  "primary_service",
  "contact_or_about"
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
  version: 2,
  requestedSlots: websiteHealthRequestedRouteSlots,
  maximumRoutes: 3,
  selection: {
    home: "canonical homepage or primary crawl entry",
    primaryService: "highest-priority service-intent route; specificity, declared priority, and substantive content break ties",
    contactOrAbout: "contact/location, otherwise about, otherwise the second service-intent route",
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
    "contact", "contact-us", "get-in-touch", "request-a-quote", "get-a-quote", "quote"
  ]) || matchesPhrase(titleWords, ["contact", "contact us", "get in touch", "request a quote"])) {
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

  if (routeSegments.some((segment) => matchesSegment(segment, [
    "blog", "blogs", "guide", "guides", "resources", "faq", "faqs", "privacy", "terms", "accessibility"
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
    candidate !== home && hasPurpose(candidate, ["contact", "location"])
  );
  const about = normalized.find((candidate) =>
    candidate !== home && candidate !== contact && hasPurpose(candidate, ["about"])
  );
  const selections = [
    selection("home", home, "home"),
    selection("primary_service", services[0], "primary service intent"),
    selection(
      "contact_or_about",
      contact ?? about ?? services[1],
      contact ? "contact or location" : about ? "about" : services[1] ? "secondary service intent" : undefined
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
  return selectWebsiteHealthRoutes(routes.map((route) => {
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
        : 0
    };
  }));
}

/** Deterministic four-route evidence set used by the advisory visual/IA review. */
export function selectArtifactReviewRoutePaths(
  routes: ArtifactVisualRouteInput[],
  pageRequirements: ArtifactVisualPageRequirement[]
) {
  const normalizedRoutes = routes.map((route) => ({ ...route, path: normalizeRoute(route.path) }));
  const routeByPath = new Map(normalizedRoutes.map((route) => [route.path, route]));
  const requirementByPath = new Map(pageRequirements.map((requirement, index) => [
    requirement.slug ? normalizeRoute(requirement.slug) : "/",
    { requirement, index }
  ]));
  const rank = (route: ArtifactVisualRouteInput) => {
    const matched = requirementByPath.get(route.path);
    return matched ? pageRequirements.length - matched.index : 0;
  };
  const purpose = (route: ArtifactVisualRouteInput) => requirementByPath.get(route.path)?.requirement.purpose
    ?? inferWebsiteHealthPurposeTags({ route: route.path, title: route.title, description: route.description })[0]
    ?? "";
  const prominence = [...normalizedRoutes]
    .filter((route) => route.path !== "/")
    .sort((left, right) => rank(right) - rank(left)
      || right.description.length - left.description.length
      || left.path.localeCompare(right.path));
  const selected: string[] = [];
  const add = (path?: string) => {
    if (path && routeByPath.has(path) && !selected.includes(path)) selected.push(path);
  };
  add(routeByPath.has("/") ? "/" : normalizedRoutes[0]?.path);
  const primary = prominence[0];
  add(primary?.path);
  if (primary) {
    const primaryPurpose = routeFamilyPurpose(purpose(primary));
    const primaryParent = primary.path.split("/").filter(Boolean)[0] ?? "";
    add(prominence.find((route) => route.path !== primary.path && (
      (primaryPurpose && routeFamilyPurpose(purpose(route)) === primaryPurpose)
      || (!primaryPurpose && primaryParent && route.path.split("/").filter(Boolean)[0] === primaryParent)
    ))?.path);
  }
  const remaining = prominence.filter((route) => !selected.includes(route.path));
  const conversion = remaining.find((route) => /(?:^|\/)(?:contact|contact-us|get-a-quote|request-a-quote|quote)(?:\/|$)/i.test(route.path))
    ?? remaining.find((route) => /(?:^|\/)(?:faq|faqs|frequently-asked-questions)(?:\/|$)/i.test(route.path))
    ?? remaining[0];
  add(conversion?.path);
  for (const route of prominence) {
    if (selected.length >= 4) break;
    add(route.path);
  }
  return selected.slice(0, 4);
}

function routeFamilyPurpose(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (/service|treatment|solution|product/.test(normalized)) return "service";
  if (/location|service_area/.test(normalized)) return "location";
  if (/resource|blog|guide|article/.test(normalized)) return "resource";
  return normalized;
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
  const specificity = candidate.purposeTags.includes("service_detail") ? 1_000_000 : 0;
  return specificity
    + (candidate.priority ?? 0) * 10_000
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
