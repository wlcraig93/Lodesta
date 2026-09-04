import { DomUtils, parseDocument } from "htmlparser2";
import { normalizeRoutePath, type ArtifactGateFinding } from "./contracts";

export type InformationArchitectureAdvisoryReport = {
  sourcePathCount: number;
  liveRouteCount: number;
  newRouteCount: number;
  routeFamilies: Array<{ family: string; count: number }>;
  routeWordCounts: Array<{ path: string; family: string; wordCount: number }>;
  wordCountDistribution: {
    minimum: number;
    firstQuartile: number;
    median: number;
    thirdQuartile: number;
    maximum: number;
  };
  distinctMainImageCount: number;
  routesWithMainImages: number;
  repeatedOpeningImages: Array<{ source: string; routes: string[] }>;
  metadataCoverage: {
    titledRoutes: number;
    describedRoutes: number;
    duplicateTitles: string[][];
    duplicateDescriptions: string[][];
  };
  headingCoverage: {
    exactlyOneH1Routes: number;
    missingH1Routes: string[];
    multipleH1Routes: Array<{ path: string; count: number }>;
  };
  internalArtifactRoutes: string[];
  rawDataStringRoutes: string[];
  unreachableFromHome: string[];
  highSimilarityPairCount: number;
  highSimilarityPairs: Array<{ left: string; right: string; similarity: number }>;
  repeatedMainStructureGroups: Array<{ routes: string[] }>;
  adjacentSectionRepetition: Array<{ path: string; firstSection: number; secondSection: number; smallerSectionContainment: number }>;
  suspectedThinRoutes: string[];
  suspectedCartesianRoutes: string[];
  largeExpansion: boolean;
};

export function buildInformationArchitectureAdvisory(input: {
  routes: Array<{ path: string; title: string; description: string; html: string }>;
  sourcePaths: string[];
}): { report: InformationArchitectureAdvisoryReport; findings: ArtifactGateFinding[] } {
  const routes = input.routes.map((route) => ({ ...route, path: normalizeRoutePath(route.path) }));
  const live = new Set(routes.map((route) => route.path));
  const source = new Set(input.sourcePaths.map(normalizeRoutePath));
  const familyCounts = new Map<string, number>();
  const links = new Map<string, Set<string>>();
  const routeText = new Map<string, Set<string>>();
  const routeWordCounts: InformationArchitectureAdvisoryReport["routeWordCounts"] = [];
  const openingImageRoutes = new Map<string, string[]>();
  const mainImageSources = new Set<string>();
  const internalArtifactRoutes: string[] = [];
  const rawDataStringRoutes: string[] = [];
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();
  const missingH1Routes: string[] = [];
  const multipleH1Routes: Array<{ path: string; count: number }> = [];
  const mainStructureRoutes = new Map<string, string[]>();
  const adjacentSectionRepetition: InformationArchitectureAdvisoryReport["adjacentSectionRepetition"] = [];
  const suspectedThinRoutes: string[] = [];
  for (const route of routes) {
    const family = routeFamily(route.path);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    const document = parseDocument(route.html, { decodeEntities: true });
    const main = DomUtils.findOne((node) => node.type === "tag" && node.name === "main", document.children, true);
    const mainText = main ? DomUtils.textContent(main) : DomUtils.textContent(document);
    const words = normalizedWords(mainText);
    routeText.set(route.path, new Set(words));
    routeWordCounts.push({ path: route.path, family, wordCount: words.length });
    const utilityRoute = isUtilityRoute(route.path);
    if (!utilityRoute && route.path !== "/" && words.length < 90) {
      suspectedThinRoutes.push(route.path);
    }
    const h1Count = DomUtils.findAll(
      (node) => node.type === "tag" && node.name === "h1",
      main ? [main] : document.children
    ).length;
    if (h1Count === 0) missingH1Routes.push(route.path);
    if (h1Count > 1) multipleH1Routes.push({ path: route.path, count: h1Count });
    if (main && !utilityRoute) {
      const signature = structuralMainSignature(DomUtils.getOuterHTML(main));
      mainStructureRoutes.set(signature, [...(mainStructureRoutes.get(signature) ?? []), route.path]);
      const sections = main.children.filter((node) => (
        node.type === "tag" && /^(?:section|article|div)$/.test(node.name)
      ));
      for (let index = 0; index < sections.length - 1; index += 1) {
        const firstWords = new Set(normalizedWords(DomUtils.textContent(sections[index])));
        const secondWords = new Set(normalizedWords(DomUtils.textContent(sections[index + 1])));
        if (firstWords.size < 24 || secondWords.size < 24) continue;
        const containment = smallerSetContainment(firstWords, secondWords);
        if (containment < 0.82) continue;
        adjacentSectionRepetition.push({
          path: route.path,
          firstSection: index + 1,
          secondSection: index + 2,
          smallerSectionContainment: Math.round(containment * 1000) / 1000
        });
      }
    }
    if (/\b(?:source website|source material|retained (?:story|evidence|source|material)|available evidence|public materials|the company describes|the business reports)\b/i.test(mainText)) {
      internalArtifactRoutes.push(route.path);
    }
    if (/\b(?:12:00\s*[ap]m\s*[–—-]\s*11:59\s*[ap]m|00:00\s*[–—-]\s*23:59|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s*:\s*\d{1,2}:\d{2}:\d{2})\b/i.test(mainText)) {
      rawDataStringRoutes.push(route.path);
    }
    const normalizedTitle = normalizeMetadata(route.title);
    const normalizedDescription = normalizeMetadata(route.description);
    if (normalizedTitle) titles.set(normalizedTitle, [...(titles.get(normalizedTitle) ?? []), route.path]);
    if (normalizedDescription) descriptions.set(normalizedDescription, [...(descriptions.get(normalizedDescription) ?? []), route.path]);
    const mainImages = main && main.type === "tag"
      ? DomUtils.findAll((node) => node.type === "tag" && node.name === "img", main.children)
      : [];
    for (const image of mainImages) {
      if (image.type !== "tag") continue;
      const source = normalizedImageSource(image.attribs.src);
      if (source) mainImageSources.add(source);
    }
    const openingImage = mainImages.find((image) => image.type === "tag" && normalizedImageSource(image.attribs.src));
    if (openingImage?.type === "tag") {
      const source = normalizedImageSource(openingImage.attribs.src)!;
      openingImageRoutes.set(source, [...(openingImageRoutes.get(source) ?? []), route.path]);
    }
    const destinations = new Set<string>();
    for (const anchor of DomUtils.findAll((node) => node.type === "tag" && node.name === "a", document.children)) {
      if (anchor.type !== "tag") continue;
      const href = anchor.attribs.href;
      const target = internalRouteDestination(href, route.path);
      if (!target) continue;
      if (live.has(target)) destinations.add(target);
    }
    links.set(route.path, destinations);
  }
  const reachable = new Set<string>();
  const pending = live.has("/") ? ["/"] : [];
  while (pending.length) {
    const path = pending.shift()!;
    if (reachable.has(path)) continue;
    reachable.add(path);
    for (const destination of links.get(path) ?? []) if (!reachable.has(destination)) pending.push(destination);
  }
  const highSimilarityPairs: InformationArchitectureAdvisoryReport["highSimilarityPairs"] = [];
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      const score = jaccard(routeText.get(routes[left].path) ?? new Set(), routeText.get(routes[right].path) ?? new Set());
      if (score >= 0.35) highSimilarityPairs.push({ left: routes[left].path, right: routes[right].path, similarity: Math.round(score * 1000) / 1000 });
    }
  }
  const gridGroups = new Map<string, string[]>();
  for (const route of routes) {
    const parts = route.path.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const key = `${parts.length}:${parts[0]}`;
    gridGroups.set(key, [...(gridGroups.get(key) ?? []), route.path]);
  }
  const suspectedCartesianRoutes = [...gridGroups.values()].filter((paths) => paths.length >= 8).flat().sort();
  const sortedHighSimilarityPairs = highSimilarityPairs
    .sort((left, right) => right.similarity - left.similarity || left.left.localeCompare(right.left));
  const repeatedMainStructureGroups = [...mainStructureRoutes.values()]
    .filter((paths) => paths.length >= 3)
    .map((paths) => ({ routes: [...paths].sort() }))
    .sort((left, right) => right.routes.length - left.routes.length || left.routes[0].localeCompare(right.routes[0]));
  const report: InformationArchitectureAdvisoryReport = {
    sourcePathCount: source.size,
    liveRouteCount: live.size,
    newRouteCount: [...live].filter((path) => !source.has(path)).length,
    routeFamilies: [...familyCounts].map(([family, count]) => ({ family, count })).sort((left, right) => right.count - left.count || left.family.localeCompare(right.family)),
    routeWordCounts: routeWordCounts.sort((left, right) => left.path.localeCompare(right.path)),
    wordCountDistribution: wordCountDistribution(routeWordCounts.map((route) => route.wordCount)),
    distinctMainImageCount: mainImageSources.size,
    routesWithMainImages: [...openingImageRoutes.values()].reduce((total, paths) => total + paths.length, 0),
    repeatedOpeningImages: [...openingImageRoutes]
      .filter(([, paths]) => paths.length >= 3)
      .map(([imageSource, paths]) => ({ source: imageSource, routes: paths.sort() }))
      .sort((left, right) => right.routes.length - left.routes.length || left.source.localeCompare(right.source)),
    metadataCoverage: {
      titledRoutes: routes.filter((route) => route.title.trim()).length,
      describedRoutes: routes.filter((route) => route.description.trim()).length,
      duplicateTitles: duplicateMetadataGroups(titles),
      duplicateDescriptions: duplicateMetadataGroups(descriptions)
    },
    headingCoverage: {
      exactlyOneH1Routes: routes.length - missingH1Routes.length - multipleH1Routes.length,
      missingH1Routes: missingH1Routes.sort(),
      multipleH1Routes: multipleH1Routes.sort((left, right) => left.path.localeCompare(right.path))
    },
    internalArtifactRoutes: internalArtifactRoutes.sort(),
    rawDataStringRoutes: rawDataStringRoutes.sort(),
    unreachableFromHome: [...live].filter((path) => !reachable.has(path)).sort(),
    highSimilarityPairCount: sortedHighSimilarityPairs.length,
    highSimilarityPairs: sortedHighSimilarityPairs.slice(0, 100),
    repeatedMainStructureGroups,
    adjacentSectionRepetition: adjacentSectionRepetition.sort((left, right) => left.path.localeCompare(right.path) || left.firstSection - right.firstSection),
    suspectedThinRoutes: suspectedThinRoutes.sort(),
    suspectedCartesianRoutes,
    largeExpansion: source.size > 0 && live.size > Math.max(source.size + 10, Math.ceil(source.size * 1.5))
  };
  const findings: ArtifactGateFinding[] = [{
    id: "advisory.ia_inventory",
    severity: "info",
    area: "route",
    message: `Whole-site inventory: ${report.sourcePathCount} retained source paths, ${report.liveRouteCount} live routes, ${report.newRouteCount} new routes; families ${report.routeFamilies.map((item) => `${item.family}:${item.count}`).join(", ") || "none"}; main-content words min/q1/median/q3/max ${report.wordCountDistribution.minimum}/${report.wordCountDistribution.firstQuartile}/${report.wordCountDistribution.median}/${report.wordCountDistribution.thirdQuartile}/${report.wordCountDistribution.maximum}; ${report.distinctMainImageCount} distinct main image source(s) across ${report.routesWithMainImages} route(s).`
  }];
  const structural = [
    report.unreachableFromHome.length ? `${report.unreachableFromHome.length} route(s) are not reachable from the homepage link graph: ${report.unreachableFromHome.slice(0, 12).join(", ")}` : "",
    report.suspectedThinRoutes.length ? `${report.suspectedThinRoutes.length} route(s) may be thin or title-led: ${report.suspectedThinRoutes.slice(0, 12).join(", ")}` : "",
    report.headingCoverage.missingH1Routes.length ? `${report.headingCoverage.missingH1Routes.length} route(s) have no H1: ${report.headingCoverage.missingH1Routes.slice(0, 12).join(", ")}` : "",
    report.headingCoverage.multipleH1Routes.length ? `${report.headingCoverage.multipleH1Routes.length} route(s) have multiple H1s: ${report.headingCoverage.multipleH1Routes.slice(0, 12).map((item) => `${item.path} (${item.count})`).join(", ")}` : "",
    report.adjacentSectionRepetition.length ? `${report.adjacentSectionRepetition.length} route(s) contain adjacent substantial sections with near-duplicate customer content: ${report.adjacentSectionRepetition.slice(0, 12).map((item) => `${item.path} (sections ${item.firstSection}/${item.secondSection}, ${item.smallerSectionContainment})`).join(", ")}` : "",
    report.largeExpansion ? "live route count is materially larger than the retained source inventory" : ""
  ].filter(Boolean);
  if (structural.length) findings.push({ id: "advisory.ia_structure", severity: "warning", area: "route", message: structural.join("; ") });
  const repetition = [
    report.highSimilarityPairCount ? `${report.highSimilarityPairCount} main-content pair(s) are highly similar: ${report.highSimilarityPairs.slice(0, 8).map((pair) => `${pair.left} ↔ ${pair.right} (${pair.similarity})`).join(", ")}` : "",
    report.repeatedMainStructureGroups.length ? `${report.repeatedMainStructureGroups.length} complete main-structure group(s) repeat across at least three commercial routes: ${report.repeatedMainStructureGroups.slice(0, 6).map((group) => group.routes.slice(0, 8).join(" ↔ ")).join("; ")}. Assess whether the shared structure suits each route's customer purpose.` : "",
    report.suspectedCartesianRoutes.length ? `${report.suspectedCartesianRoutes.length} routes form a possible repeated route product beneath a common family` : ""
  ].filter(Boolean);
  if (repetition.length) findings.push({ id: "advisory.ia_repetition", severity: "warning", area: "route", message: repetition.join("; ") });
  if (report.repeatedOpeningImages.length) {
    findings.push({
      id: "advisory.asset_reuse",
      severity: "warning",
      area: "asset",
      message: `${report.repeatedOpeningImages.length} opening image source(s) repeat across at least three routes: ${report.repeatedOpeningImages.slice(0, 4).map((item) => `${item.source} on ${item.routes.slice(0, 6).join(", ")}`).join("; ")}. Reuse is acceptable only when the image still contributes to each page's distinct customer job.`
    });
  }
  if (report.internalArtifactRoutes.length) {
    findings.push({
      id: "render.internal_provenance_copy",
      severity: "warning",
      area: "render",
      message: `Internal research or authoring language appears in customer-facing main content on ${report.internalArtifactRoutes.length} route(s): ${report.internalArtifactRoutes.slice(0, 12).join(", ")}. Rewrite it as direct customer language.`
    });
  }
  if (report.rawDataStringRoutes.length) {
    findings.push({
      id: "advisory.raw_data_copy",
      severity: "warning",
      area: "render",
      message: `Raw data-shaped time strings appear on ${report.rawDataStringRoutes.length} route(s): ${report.rawDataStringRoutes.slice(0, 12).join(", ")}. Render supported facts in ordinary customer-readable language.`
    });
  }
  // Artifact QA stores concise messages; the structured report above retains
  // every route/group. A large advisory must never crash final verification.
  const suffix = "… Full details are retained in the informationArchitecture report.";
  return { report, findings: findings.map((finding) => finding.message.length <= 1000 ? finding : {
    ...finding,
    message: finding.message.slice(0, 1000 - suffix.length) + suffix
  }) };
}

function normalizedWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((word) => word.length > 2);
}

function routeFamily(path: string) {
  if (path === "/") return "home";
  return path.split("/").filter(Boolean)[0] ?? "other";
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function smallerSetContainment(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

function structuralMainSignature(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "<$1></$1>")
    .replace(/>[^<]+</g, "><")
    .replace(/\s(?:class|id|style|href|src|alt|title|content|aria-label|data-[\w-]+)=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUtilityRoute(path: string) {
  return /(?:^|\/)(?:contact|request-service|thank-you|privacy-policy|terms|accessibility|sitemap|faqs?|image-credit)(?:\.(?:html?|php|aspx?))?$/.test(path);
}

function wordCountDistribution(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) => sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
    : 0;
  return {
    minimum: percentile(0),
    firstQuartile: percentile(0.25),
    median: percentile(0.5),
    thirdQuartile: percentile(0.75),
    maximum: percentile(1)
  };
}

function normalizeMetadata(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function duplicateMetadataGroups(values: Map<string, string[]>) {
  return [...values.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => [...paths].sort())
    .sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));
}

function normalizedImageSource(value: string | undefined) {
  if (!value) return "";
  return value.replace(/[?#].*$/, "").trim();
}

function internalRouteDestination(href: string | undefined, currentPath: string) {
  if (!href || href.startsWith("//") || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) return undefined;
  try {
    const basePath = currentPath === "/" || currentPath.endsWith("/") ? currentPath : `${currentPath}/`;
    const resolved = new URL(href, `https://lodesta.invalid${basePath}`);
    if (resolved.origin !== "https://lodesta.invalid") return undefined;
    return normalizeRoutePath(resolved.pathname || "/");
  } catch {
    return undefined;
  }
}
